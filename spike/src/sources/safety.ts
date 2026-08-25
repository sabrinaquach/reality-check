import { milesBetween } from "../geocode.ts";
import type { LatLng, Pillar } from "../types.ts";
import { readFile } from "node:fs/promises";

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

export type Block = { address: string; lat: number; lng: number; weight: number; incidents: number };
export type BlockIndex = {
  builtAt: string;
  year: number;
  radiusMiles: number;
  /** Weighted-incident totals at the 10th..90th percentile of sampled city blocks. */
  baselineDeciles: number[];
  blocks: Block[];
};

let cached: BlockIndex | null = null;

export async function loadIndex(path = new URL("../../data/blocks.json", import.meta.url)) {
  if (cached) return cached;
  try {
    cached = JSON.parse(await readFile(path, "utf8")) as BlockIndex;
    return cached;
  } catch {
    return null;
  }
}

/** Weighted incident total within `radius` miles of a point. */
export function localWeight(index: BlockIndex, at: LatLng, radius: number) {
  let weight = 0;
  let incidents = 0;
  let nearest = Infinity;
  for (const b of index.blocks) {
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
 * The index only covers SJPD's jurisdiction. An address in Palo Alto would
 * otherwise find zero incidents nearby and score a perfect 100 -- silence
 * from a source that never listened. In-city addresses sit within a mile of
 * an indexed block; anything past two miles is out of coverage, not calm.
 */
const COVERAGE_MILES = 2;

/**
 * Deciles give nine steps, which makes neighbouring blocks land on the same
 * round number. Interpolating between them keeps the ranking honest without
 * pretending to more precision than the sample supports.
 */
export function percentileOf(weight: number, deciles: number[]): number {
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
  return 100;
}

export async function scoreSafety(at: LatLng): Promise<Pillar> {
  const index = await loadIndex();
  const base: Pillar = {
    key: "safety",
    score: 0,
    band: "moderate",
    headline: "",
    detail: "",
    basis: "Based on SJPD calls for service",
  };

  if (!index) {
    return {
      ...base,
      unavailable: "No block index. Run `npm run build-index` first.",
      headline: "Unavailable",
      detail: "Safety data has not been indexed yet.",
    };
  }

  const { weight, incidents, nearest } = localWeight(index, at, index.radiusMiles);

  if (nearest > COVERAGE_MILES) {
    return {
      ...base,
      unavailable: "Outside the San Jose police data area.",
      headline: "Unavailable",
      detail: `Nearest indexed block is ${nearest.toFixed(1)} mi away.`,
    };
  }

  // Percentile-rank this block against the sampled city distribution, then
  // invert: fewer weighted incidents than most of the city == a higher score.
  const score = Math.round(100 - percentileOf(weight, index.baselineDeciles));

  const band = score >= 67 ? "good" : score >= 34 ? "moderate" : "poor";
  const headline =
    band === "good" ? "Safe area" : band === "moderate" ? "Mixed area" : "Higher incident area";
  const comparison =
    band === "good" ? "quieter than most of San Jose" :
    band === "moderate" ? "about average for San Jose" :
    "busier than most of San Jose";
  const detail = `${incidents} incidents within ${index.radiusMiles} mi in ${index.year} — ${comparison}.`;

  return { ...base, score, band, headline, detail };
}
