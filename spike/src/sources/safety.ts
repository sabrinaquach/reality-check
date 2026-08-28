import { bandFor } from "../bands.ts";
import { milesBetween } from "../geocode.ts";
import type { IncidentGroup, LatLng, Pillar } from "../types.ts";
import { readFile, stat } from "node:fs/promises";
import { cityAt, cityNames, type City } from "../cities.ts";

/**
 * SJPD publishes CALLS FOR SERVICE, not confirmed crimes, and the top call
 * types are things like VEHICLE STOP and PARKING VIOLATION. Counting raw calls
 * would score a heavily-patrolled block as dangerous and a neglected one as
 * safe -- it measures policing, not risk. So we drop police-initiated and
 * non-crime calls entirely, then weight what's left by severity.
 */
const EXCLUDED = [
  /VEHICLE STOP/, /PEDESTRIAN STOP/, /PARKING/, /MEET THE CITIZEN/,
  /FIRE DEPARTMENT/, /TRAFFIC HAZARD/, /UNK TYPE 911/, /WELFARE CHECK/,
  /ALARM/, /VEHICLE ACCIDENT/, /RECOVERED STOLEN/, /ABANDONED/,
  /TOW/, /911 HANGUP/, /FOLLOW UP/, /SERVICE/,
];

const VIOLENT = [
  /SHOOTING/, /SHOTS/, /BATTERY/, /ROBBERY/, /ASSAULT/, /STABBING/,
  /HOMICIDE/, /MURDER/, /RAPE/, /WEAPON/, /BRANDISH/, /KIDNAP/,
  /CARJACK/, /ARSON/, /STRONG ARM/,
];

const PROPERTY = [
  /THEFT/, /BURGLARY/, /STOLEN/, /MALICIOUS MISCHIEF/, /VANDAL/,
  /HIT AND RUN/, /FRAUD/, /SHOPLIFT/, /PROWLER/,
];

const DISORDER = [/DISTURBANCE/, /TRESPASS/, /SUSPICIOUS/, /INDECENT/, /DRUNK/, /NARCOTIC/];

export type Severity = "violent" | "property" | "disorder" | "excluded";

export const WEIGHTS: Record<Exclude<Severity, "excluded">, number> = {
  violent: 10,
  property: 3,
  disorder: 1,
};

export function classify(callType: string): Severity {
  const t = (callType ?? "").toUpperCase();
  if (EXCLUDED.some((r) => r.test(t))) return "excluded";
  if (VIOLENT.some((r) => r.test(t))) return "violent";
  if (PROPERTY.some((r) => r.test(t))) return "property";
  if (DISORDER.some((r) => r.test(t))) return "disorder";
  return "excluded";
}

/**
 * The renter-facing name for a kind of call.
 *
 * SJPD publishes 188 distinct CALL_TYPE strings, many of them near-duplicates
 * ("BURGLARY (460)" and "BURGLARY  REPORT  (460)"), and all of them written
 * for dispatchers rather than for someone deciding where to live. Nobody asks
 * "how many MALICIOUS MISCHIEF calls were there" -- they ask whether the
 * trouble nearby is break-ins or noise complaints. These are those words.
 *
 * First match wins, so specific patterns sit above general ones: VEHICLE
 * BURGLARY above BURGLARY, and anything involving a weapon above the
 * DISTURBANCE it may also be filed under, because that is the fact that
 * matters most about the call.
 *
 * Checked against all 188 published types: every one of the 77 that survives
 * `classify` lands in exactly one group, with none left over.
 */
export const GROUPS: { label: string; test: RegExp }[] = [
  { label: "Weapons", test: /SHOOTING|SHOTS|FIREARM|WEAPON|BRANDISH/ },
  { label: "Robbery", test: /ROBBERY|CARJACK/ },
  { label: "Assault", test: /BATTERY|ASSAULT|STABBING|STRONG ARM|HOMICIDE|MURDER|RAPE|KIDNAP/ },
  { label: "Car break-ins", test: /VEHICLE BURGLARY/ },
  { label: "Break-ins", test: /BURGLARY|PROWLER/ },
  { label: "Car theft", test: /STOLEN VEHICLE|TAMPERING WITH A VEHICLE/ },
  { label: "Theft", test: /THEFT|SHOPLIFT|STOLEN/ },
  { label: "Vandalism", test: /MALICIOUS MISCHIEF|VANDAL|ARSON/ },
  { label: "Hit and run", test: /HIT AND RUN/ },
  { label: "Fraud", test: /FRAUD/ },
  { label: "Drugs", test: /NARCOTIC/ },
  { label: "Trespassing", test: /TRESPASS/ },
  { label: "Disturbances", test: /DISTURBANCE/ },
  { label: "Suspicious activity", test: /SUSPICIOUS|INDECENT|DRUNK/ },
];

/** The group a call type belongs to, or null when `classify` drops it. */
export function groupOf(callType: string): string | null {
  if (classify(callType) === "excluded") return null;
  const t = (callType ?? "").toUpperCase();
  return GROUPS.find((g) => g.test.test(t))?.label ?? null;
}

export type Block = {
  address: string;
  lat: number;
  lng: number;
  weight: number;
  incidents: number;
  /**
   * [groupIndex, count] pairs, indexing BlockIndex.groupLabels. Stored by
   * index rather than by name because the same fourteen labels would otherwise
   * repeat across 7k blocks, and this file is parsed into memory whole on the
   * first request. Absent on indexes built before breakdowns existed, which is
   * why every reader treats it as optional.
   */
  g?: [number, number][];
};
export type BlockIndex = {
  builtAt: string;
  year: number;
  radiusMiles: number;
  /** Weighted-incident totals at the 10th..90th percentile of sampled city points. */
  baselineDeciles: number[];
  /** The heaviest neighbourhood the baseline sample saw. Anchors the top decile. */
  tailMax?: number;
  /** Names for the group indices in Block.g. Absent on older indexes. */
  groupLabels?: string[];
  blocks: Block[];
};

/**
 * Keyed on the file's modification time, not just "have we read it yet".
 *
 * The index is 888KB of JSON and is read on nearly every request, so it has to
 * be cached. But it also gets rebuilt from the command line while the dev
 * server is running, and a cache that never looks again went on serving the
 * old copy until someone thought to restart -- which showed up as a freshly
 * rebuilt index still reporting no incident types, and sent the reader off to
 * re-run a build that had already worked. A stat is cheap; a stale index that
 * lies about its own contents is not.
 */
const cached = new Map<string, { mtimeMs: number; index: BlockIndex }>();

/** The index for one city, or null when it has not been built yet. */
export async function loadIndex(city: City): Promise<BlockIndex | null> {
  try {
    const { mtimeMs } = await stat(city.index);
    const hit = cached.get(city.id);
    if (hit?.mtimeMs === mtimeMs) return hit.index;
    const index = JSON.parse(await readFile(city.index, "utf8")) as BlockIndex;
    cached.set(city.id, { mtimeMs, index });
    return index;
  } catch {
    return null;
  }
}

/**
 * A coarse spatial grid over an index, built once and thrown away with it.
 *
 * Everything here used to walk every block in the city on every question, and
 * for one city of 3,194 blocks that was free. It stopped being free at eight:
 * quietNearby asks localWeight about each of thousands of candidate blocks, so
 * a full scan per candidate is quadratic, and Chicago's 27,410 blocks turned
 * that into hundreds of millions of trig calls -- enough to take a shared vCPU
 * down and have the host restart it.
 *
 * Cells are 0.02 degrees, about 1.4 miles of latitude, so the 0.4-mile scoring
 * radius touches four cells and the 4-mile rail search touches around fifty.
 *
 * A WeakMap keyed on the index object, so a rebuilt or evicted index takes its
 * grid with it and there is nothing to invalidate by hand.
 */
const CELL_DEG = 0.02;
const grids = new WeakMap<BlockIndex, Map<string, Block[]>>();

function gridFor(index: BlockIndex): Map<string, Block[]> {
  const had = grids.get(index);
  if (had) return had;
  const grid = new Map<string, Block[]>();
  for (const b of index.blocks) {
    const key = `${Math.floor(b.lat / CELL_DEG)},${Math.floor(b.lng / CELL_DEG)}`;
    const cell = grid.get(key);
    if (cell) cell.push(b);
    else grid.set(key, [b]);
  }
  grids.set(index, grid);
  return grid;
}

/** Blocks within `radius` miles of a point, without touching the rest of the city. */
export function blocksWithin(index: BlockIndex, at: LatLng, radius: number): Block[] {
  const grid = gridFor(index);
  const dLat = radius / 69;
  // Longitude degrees shrink towards the poles; the clamp keeps this finite.
  const dLng = dLat / Math.max(0.2, Math.cos((at.lat * Math.PI) / 180));

  const out: Block[] = [];
  const yMin = Math.floor((at.lat - dLat) / CELL_DEG);
  const yMax = Math.floor((at.lat + dLat) / CELL_DEG);
  const xMin = Math.floor((at.lng - dLng) / CELL_DEG);
  const xMax = Math.floor((at.lng + dLng) / CELL_DEG);
  for (let y = yMin; y <= yMax; y++) {
    for (let x = xMin; x <= xMax; x++) {
      const cell = grid.get(`${y},${x}`);
      if (!cell) continue;
      // The cells are square and the radius is round, so the corners still
      // have to be measured properly.
      for (const b of cell) if (milesBetween(at, b) <= radius) out.push(b);
    }
  }
  return out;
}

/**
 * Weighted incident total within `radius` miles of a point.
 *
 * `nearest` answers a different question -- is this address covered at all --
 * so it looks out to `reach`, which the caller sets to the coverage limit.
 * Without that a point with nothing in its 0.4 miles would report Infinity and
 * read as out of coverage while standing in the middle of the city.
 */
export function localWeight(index: BlockIndex, at: LatLng, radius: number, reach = radius) {
  let weight = 0;
  let incidents = 0;
  let nearest = Infinity;
  for (const b of blocksWithin(index, at, Math.max(radius, reach))) {
    const d = milesBetween(at, b);
    if (d < nearest) nearest = d;
    if (d <= radius) {
      weight += b.weight;
      incidents += b.incidents;
    }
  }
  return { weight, incidents, nearest };
}

/**
 * What the nearby calls actually were, commonest first.
 *
 * The score says how much; this says what kind, which is the question a
 * headline number cannot answer. Two blocks can score the same because one is
 * loud on weekends and the other gets cars broken into, and a renter would
 * choose differently between them.
 *
 * Shares are of the incidents counted here, not of every call SJPD logged --
 * the excluded types never make it into the index in the first place.
 */
export function groupsNear(
  index: BlockIndex,
  at: LatLng,
  radius: number,
  limit = 5,
): IncidentGroup[] {
  const labels = index.groupLabels;
  if (!labels?.length) return [];

  const totals = new Map<string, number>();
  let all = 0;
  for (const b of blocksWithin(index, at, radius)) {
    if (!b.g?.length) continue;
    for (const [gi, n] of b.g) {
      const label = labels[gi];
      if (!label) continue;
      totals.set(label, (totals.get(label) ?? 0) + n);
      all += n;
    }
  }
  if (!all) return [];

  return [...totals]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([label, count]) => ({ label, count, share: Math.round((count / all) * 100) }));
}

/**
 * Each index covers one police department's jurisdiction. An address in Palo
 * Alto would otherwise find zero incidents nearby and score a perfect 100 --
 * silence from a source that never listened. In-city addresses sit within a
 * mile of an indexed block; anything past two miles is out of coverage, not
 * calm.
 *
 * This is the real coverage test. City.radiusMiles only decides which index is
 * worth opening; this decides whether the answer in it means anything.
 */
const COVERAGE_MILES = 2;

/**
 * Deciles give nine steps, which makes neighbouring blocks land on the same
 * round number. Interpolating between them keeps the ranking honest without
 * pretending to more precision than the sample supports.
 *
 * Above the top decile we interpolate again, out to `tailMax` -- the heaviest
 * neighbourhood the baseline sampled. Returning a flat 100 there collapsed the
 * worst tenth of the city onto one score: Downtown (1877 weighted) and East San
 * Jose (1525) both read 0, which is exactly where a renter needs the gap most.
 * Without a tailMax there is nothing to stretch against, so it still clamps.
 */
export function percentileOf(weight: number, deciles: number[], tailMax?: number): number {
  const step = 100 / (deciles.length + 1);
  for (let i = 0; i < deciles.length; i++) {
    const cut = deciles[i]!;
    if (weight <= cut) {
      const prev = i === 0 ? 0 : deciles[i - 1]!;
      const span = cut - prev;
      const within = span > 0 ? (weight - prev) / span : 0;
      return step * (i + within);
    }
  }
  const top = deciles[deciles.length - 1] ?? 0;
  if (!tailMax || tailMax <= top) return 100;
  const within = Math.min(1, (weight - top) / (tailMax - top));
  return step * deciles.length + within * step;
}

export async function scoreSafety(at: LatLng): Promise<Pillar> {
  /*
   * Which city's index answers for this point. Nothing else in the scoring
   * depends on the answer -- a block is ranked against its own city's baseline
   * either way -- but the words around the number do, and a reader deserves to
   * know whether they are being told about calls for service or filed reports.
   */
  const city = cityAt(at);
  const index = city ? await loadIndex(city) : null;
  const base: Pillar = {
    key: "safety",
    score: 0,
    band: "moderate",
    headline: "",
    detail: "",
    basis: city?.basis ?? "Based on local police data",
  };

  if (!city) {
    return {
      ...base,
      unavailable: `No police data for this area. Covered: ${cityNames().join(", ")}.`,
      headline: "Unavailable",
      detail: `Safety is scored per city, and this address is outside the ${cityNames().length} we have data for.`,
    };
  }

  if (!index) {
    return {
      ...base,
      unavailable: `No block index for ${city.name}. Run the builder for it first.`,
      headline: "Unavailable",
      detail: "Safety data has not been indexed yet.",
    };
  }

  // Reach out to the coverage limit, so "is this city at all" is answerable.
  const { weight, incidents, nearest } = localWeight(index, at, index.radiusMiles, COVERAGE_MILES);

  if (nearest > COVERAGE_MILES) {
    return {
      ...base,
      unavailable: `Outside the ${city.name} police data area.`,
      headline: "Unavailable",
      detail: `Nearest indexed block is ${nearest.toFixed(1)} mi away.`,
    };
  }

  // Percentile-rank this block against the sampled city distribution, then
  // invert: fewer weighted incidents than most of the city == a higher score.
  const score = Math.round(100 - percentileOf(weight, index.baselineDeciles, index.tailMax));

  const band = bandFor(score);
  /*
   * "Mixed area" was doing two jobs badly: it read as a judgement about the
   * neighbourhood rather than about the number, and it was the only one of the
   * three headlines whose word did not appear anywhere else in the app. The
   * bands are good / moderate / poor everywhere -- on the chip above this very
   * line, on the slot's bars, in the comparison -- so this says moderate too.
   */
  const headline =
    band === "good" ? "Safe area" : band === "moderate" ? "Moderate area" : "Higher incident area";
  const comparison =
    band === "good" ? `quieter than most of ${city.name}` :
    band === "moderate" ? `about average for ${city.name}` :
    `busier than most of ${city.name}`;
  const detail = `${incidents} incidents within ${index.radiusMiles} mi in ${index.year} — ${comparison}.`;

  return { ...base, score, band, headline, detail, incidents: groupsNear(index, at, index.radiusMiles) };
}
