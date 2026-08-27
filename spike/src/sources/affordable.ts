import { readFile, writeFile } from "node:fs/promises";
import { milesBetween } from "../geocode.ts";
import { tractAt } from "./cost.ts";
import { loadIndex } from "./safety.ts";
import type { LatLng } from "../types.ts";

/**
 * Which neighbourhoods near a point are cheap to rent in.
 *
 * The cost pillar answers "is this listing fairly priced for its tract". This
 * answers the question that comes before it -- "where should I be looking at
 * all" -- which is the one the board could not help with, because commute had
 * the map and safety had its block list and cost had nothing.
 *
 * Areas, not listings. A Census tract is not somewhere you can rent; it is a
 * few thousand households whose rents get summarised. So these are read as
 * "look here", never as "this is available".
 *
 * Costs nothing per user: two public Census requests for a whole county, then
 * everything is served from disk. No Google, no RentCast quota.
 */

const TIGERWEB =
  "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Tracts_Blocks/MapServer/0/query";

/** ACS 5-year releases land ~11 months after the year ends; try newest first. */
const ACS_YEARS = [2024, 2023, 2022];

/** County boundaries and their rents move slowly. A month is generous. */
const TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Bumped when the cached shape changes, so old files refetch instead of
 *  serving rows that are missing the newer fields. */
const CACHE_VERSION = 2;

const STORE = new URL("../../data/tracts-cache.json", import.meta.url);

export type AffordableArea = {
  /**
   * A real, checkable address in this area.
   *
   * A tract has no address of its own, so this is the nearest block the safety
   * index already knows -- which means it is a street that exists, that
   * geocodes, and that a reality check can be run on. It stands for the area
   * rather than being for rent itself.
   */
  address: string;
  /** The Census name, e.g. "5032.21". Provenance, not a place name. */
  tract: string;
  /** Median contract rent for the tract, dollars a month. */
  rent: number;
  /** Straight-line distance from the point asked about. */
  miles: number;
  /** Compass direction from that point, e.g. "southwest". */
  direction: string;
  /** ACS release the median came from. */
  year: number;
};

type Area = {
  tract: string;
  name: string;
  lat: number;
  lng: number;
  rent: number;
};
type County = { v: number; at: number; year: number; areas: Area[] };
type Store = Record<string, County>;

async function load(): Promise<Store> {
  try {
    return JSON.parse(await readFile(STORE, "utf8")) as Store;
  } catch {
    return {};
  }
}

const save = (s: Store) => writeFile(STORE, JSON.stringify(s)).catch(() => {});

/** Tract centroids for a county. Geometry is not requested -- only the middle. */
async function centroids(state: string, county: string) {
  const url = `${TIGERWEB}?${new URLSearchParams({
    where: `STATE='${state}' AND COUNTY='${county}'`,
    outFields: "TRACT,BASENAME,CENTLAT,CENTLON",
    returnGeometry: "false",
    f: "json",
  })}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  const body = (await res.json()) as any;
  const out = new Map<string, { name: string; lat: number; lng: number }>();
  for (const f of body?.features ?? []) {
    const a = f.attributes ?? {};
    const lat = Number(a.CENTLAT);
    const lng = Number(a.CENTLON);
    if (!a.TRACT || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    out.set(String(a.TRACT), { name: String(a.BASENAME ?? a.TRACT), lat, lng });
  }
  return out;
}

/**
 * Median contract rent for every tract in a county, in one request.
 *
 * B25058 is what a listing quotes; B25064 adds utilities and is only the
 * fallback where contract rent is suppressed -- the same pair, and the same
 * order of preference, the cost pillar uses for a single tract.
 */
async function medians(state: string, county: string, key: string) {
  for (const year of ACS_YEARS) {
    const url =
      `https://api.census.gov/data/${year}/acs/acs5?` +
      new URLSearchParams({
        get: "B25058_001E,B25064_001E",
        for: "tract:*",
        in: `state:${state} county:${county}`,
        key,
      });
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) continue;
      const rows = (await res.json()) as string[][];
      const out = new Map<string, number>();
      for (const row of rows.slice(1)) {
        const contract = Number(row[0]);
        const gross = Number(row[1]);
        const rent = contract > 0 ? contract : gross > 0 ? gross : 0;
        // The tract code is the last column; the "in" clause fills the ones before.
        const tract = row[row.length - 1]!;
        if (rent) out.set(tract, rent);
      }
      if (out.size) return { year, rents: out };
    } catch {
      // fall through to the next release
    }
  }
  return null;
}

/** "southwest" and friends, from a bearing between two points. */
const POINTS = ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"];

export function directionFrom(from: LatLng, to: LatLng): string {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLng = toRad(to.lng - from.lng);
  const y = Math.sin(dLng) * Math.cos(toRad(to.lat));
  const x =
    Math.cos(toRad(from.lat)) * Math.sin(toRad(to.lat)) -
    Math.sin(toRad(from.lat)) * Math.cos(toRad(to.lat)) * Math.cos(dLng);
  const deg = (Math.atan2(y, x) * 180) / Math.PI;
  return POINTS[Math.round(((deg + 360) % 360) / 45) % 8]!;
}

export type AffordableResult = {
  areas: AffordableArea[];
  /** The middle of the pack nearby, so a cheap one can be read against it. */
  typical: number | null;
  year: number | null;
  unavailable?: string;
};

export async function affordableNear(
  at: LatLng,
  radiusMiles = 5,
  limit = 5,
): Promise<AffordableResult> {
  const key = process.env.CENSUS_API_KEY;
  if (!key) {
    return { areas: [], typical: null, year: null, unavailable: "CENSUS_API_KEY is not set." };
  }

  const tract = await tractAt(at);
  if (!tract) {
    return { areas: [], typical: null, year: null, unavailable: "No Census tract for this location." };
  }

  const cacheKey = `${tract.state}${tract.county}`;
  const store = await load();
  let county = store[cacheKey];

  if (!county || county.v !== CACHE_VERSION || Date.now() - county.at > TTL_MS) {
    const [places, rents] = await Promise.all([
      centroids(tract.state, tract.county),
      medians(tract.state, tract.county, key),
    ]);
    if (!rents || !places.size) {
      return { areas: [], typical: null, year: null, unavailable: "No ACS rents for this county." };
    }
    const areas: Area[] = [];
    for (const [code, place] of places) {
      const rent = rents.rents.get(code);
      if (rent) {
        areas.push({ tract: place.name, name: place.name, lat: place.lat, lng: place.lng, rent });
      }
    }
    county = { v: CACHE_VERSION, at: Date.now(), year: rents.year, areas };
    store[cacheKey] = county;
    await save(store);
  }

  const near = county.areas
    .map((a) => ({
      ...a,
      miles: milesBetween(at, { lat: a.lat, lng: a.lng }),
      direction: directionFrom(at, { lat: a.lat, lng: a.lng }),
    }))
    .filter((a) => a.miles <= radiusMiles);

  if (!near.length) {
    return { areas: [], typical: null, year: county.year, unavailable: "No tracts within range." };
  }

  const sorted = [...near].sort((a, b) => a.rent - b.rent);
  const typical = sorted[Math.floor(sorted.length / 2)]!.rent;

  /**
   * Give each area a street someone can actually check.
   *
   * Only the cheapest few are resolved, not all of them -- finding the nearest
   * of 7,000 blocks is cheap once and wasteful 140 times over for rows nobody
   * will see. An area with no indexed block within this radius is dropped
   * rather than shown: the safety index only covers San Jose, and a card that
   * cannot be opened would be worse than one that is missing.
   */
  const index = await loadIndex();
  const NEAREST_MILES = 1.2;
  const areas: AffordableArea[] = [];
  for (const a of sorted) {
    if (areas.length >= limit) break;
    if (!index) break;
    let best: { address: string; d: number } | null = null;
    for (const b of index.blocks) {
      const d = milesBetween({ lat: a.lat, lng: a.lng }, b);
      if (!best || d < best.d) best = { address: b.address, d };
    }
    if (!best || best.d > NEAREST_MILES) continue;
    areas.push({
      address: best.address,
      tract: a.tract,
      rent: a.rent,
      miles: a.miles,
      direction: a.direction,
      year: county.year,
    });
  }

  if (!areas.length) {
    return {
      areas: [],
      typical,
      year: county.year,
      unavailable: "No indexed streets in the cheaper areas near here.",
    };
  }

  return { areas, typical, year: county.year };
}
