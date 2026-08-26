import { bandFor } from "../bands.ts";
import type { LatLng, Pillar } from "../types.ts";

const GEOGRAPHIES = "https://geocoding.geo.census.gov/geocoder/geographies/coordinates";
/** ACS 5-year releases land ~11 months after the year ends; try newest first. */
const ACS_YEARS = [2024, 2023, 2022];

type Tract = { state: string; county: string; tract: string; name: string };

export async function tractAt(at: LatLng): Promise<Tract | null> {
  const url = `${GEOGRAPHIES}?${new URLSearchParams({
    x: String(at.lng),
    y: String(at.lat),
    benchmark: "Public_AR_Current",
    vintage: "Current_Current",
    format: "json",
  })}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    const body = (await res.json()) as any;
    const t = body?.result?.geographies?.["Census Tracts"]?.[0];
    if (!t) return null;
    return { state: t.STATE, county: t.COUNTY, tract: t.TRACT, name: t.NAME };
  } catch {
    return null;
  }
}

/** ACS suppresses medians it can't estimate and returns a sentinel, not null. */
const usable = (v: unknown) => Number.isFinite(Number(v)) && Number(v) > 0;

type Median = { rent: number; year: number; level: "tract" | "county" };

async function acsMedian(t: Tract, key: string): Promise<Median | null> {
  for (const year of ACS_YEARS) {
    for (const level of ["tract", "county"] as const) {
      const params = new URLSearchParams({
        // B25058 is median contract rent -- what a listing quotes. B25064 adds
        // utilities, so it is only a fallback when contract rent is suppressed.
        get: "B25058_001E,B25064_001E",
        key,
      });
      if (level === "tract") {
        params.set("for", `tract:${t.tract}`);
        params.set("in", `state:${t.state} county:${t.county}`);
      } else {
        params.set("for", `county:${t.county}`);
        params.set("in", `state:${t.state}`);
      }
      try {
        const res = await fetch(`https://api.census.gov/data/${year}/acs/acs5?${params}`, {
          signal: AbortSignal.timeout(20_000),
        });
        if (!res.ok) continue;
        const rows = (await res.json()) as string[][];
        const row = rows?.[1];
        if (!row) continue;
        const rent = usable(row[0]) ? Number(row[0]) : usable(row[1]) ? Number(row[1]) : 0;
        if (rent) return { rent, year, level };
      } catch {
        // fall through to the next year / geography
      }
    }
  }
  return null;
}

/**
 * ACS medians cover every lease in the tract, including ones signed years ago,
 * so today's asking rent normally sits above them. Parity with the median is
 * therefore already a good deal (85), and roughly double it scores zero.
 */
export function costScore(ratio: number): number {
  return Math.max(0, Math.min(100, Math.round(100 - (ratio - 0.9) * 110)));
}

export async function scoreCost(at: LatLng, rent?: number): Promise<Pillar> {
  const base: Pillar = {
    key: "cost",
    score: 0,
    band: "moderate",
    headline: "",
    detail: "",
    basis: "Census ACS 5-year median rent for this tract",
  };

  const key = process.env.CENSUS_API_KEY;
  if (!key) {
    return {
      ...base,
      unavailable: "CENSUS_API_KEY is not set.",
      headline: "Unavailable",
      detail: "No Census key, so local rents could not be compared.",
    };
  }

  const tract = await tractAt(at);
  const median = tract ? await acsMedian(tract, key) : null;
  if (!tract || !median) {
    return {
      ...base,
      unavailable: "No ACS rent estimate for this location.",
      headline: "Unavailable",
      detail: "The Census has no usable median rent nearby.",
    };
  }

  const where = median.level === "tract" ? tract.name : "the county";
  const basis = `Census ACS ${median.year} 5-year median rent for ${where}`;

  if (!rent) {
    return {
      ...base,
      basis,
      unavailable: "No listed rent given.",
      headline: `Median $${median.rent.toLocaleString()}/mo`,
      detail: `Typical rent around here. Enter the listing's rent to score it.`,
    };
  }

  const ratio = rent / median.rent;
  const score = costScore(ratio);
  const band = bandFor(score);
  const pct = Math.round((ratio - 1) * 100);
  const comparison =
    Math.abs(pct) <= 5
      ? "about the local median"
      : `${Math.abs(pct)}% ${pct > 0 ? "above" : "below"} the local median`;

  return {
    ...base,
    basis,
    score,
    band,
    headline: `$${rent.toLocaleString()}/mo — ${comparison}`,
    detail: `Median rent in ${where} is $${median.rent.toLocaleString()}. Existing leases pull that number below today's asking rents.`,
  };
}
