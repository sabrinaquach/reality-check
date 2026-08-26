import { bandFor, GOOD, MODERATE } from "./bands.ts";
import { scoreAmenities } from "./sources/amenities.ts";
import { scoreCommute } from "./sources/commute.ts";
import { scoreCost } from "./sources/cost.ts";
import { scoreSafety } from "./sources/safety.ts";
import type { Listing, Pillar, Priority, RealityCheck } from "./types.ts";

/**
 * Commute, safety and cost are the three things people actually move for;
 * amenities colour the decision without driving it, so they weigh less.
 */
const BASE_WEIGHT: Record<Pillar["key"], number> = {
  commute: 1,
  safety: 1,
  cost: 1,
  amenities: 0.6,
};

/** Picking a priority roughly doubles its say; ranking it first more so. */
const PRIORITY_MULTIPLIER = [2.5, 1.75, 1.25];

/**
 * With half the weight missing, a composite is a guess dressed up as a number.
 * Better to show the pillars we do have and no total at all.
 */
const MIN_COVERAGE = 0.5;

export function weightFor(key: Pillar["key"], priorities: Priority[]): number {
  const rank = priorities.indexOf(key as Priority);
  const multiplier = rank === -1 ? 1 : (PRIORITY_MULTIPLIER[rank] ?? 1.25);
  return BASE_WEIGHT[key] * multiplier;
}

export function composite(
  pillars: Pillar[],
  priorities: Priority[],
): { score: number | null; coverage: number } {
  let weighted = 0;
  let live = 0;
  let all = 0;
  for (const p of pillars) {
    const w = weightFor(p.key, priorities);
    all += w;
    if (p.unavailable) continue;
    live += w;
    weighted += w * p.score;
  }
  const coverage = all ? live / all : 0;
  if (coverage < MIN_COVERAGE) return { score: null, coverage };
  return { score: Math.round(weighted / live), coverage };
}

function summarize(score: number | null, pillars: Pillar[], priorities: Priority[]): string {
  const live = pillars.filter((p) => !p.unavailable);
  if (score === null) {
    const missing = pillars.filter((p) => p.unavailable).map((p) => p.key);
    return `Not enough data to score this listing — ${missing.join(", ")} unavailable.`;
  }

  const verdict = score >= GOOD ? "Looks solid" : score >= MODERATE ? "Worth a look, with caveats" : "Hard to recommend";
  // Lead with whatever the renter said they cared about, then the worst pillar.
  const top = live.find((p) => p.key === priorities[0]);
  const worst = [...live].sort((a, b) => a.score - b.score)[0];
  const parts: string[] = [];
  if (top) parts.push(`${top.key} ${top.band}`);
  if (worst && worst.key !== top?.key && worst.band !== "good") parts.push(`${worst.key} is the weak point`);
  const tail = parts.length ? ` — ${parts.join("; ")}.` : ".";
  return `${verdict}${tail}`;
}

/**
 * Swap one pillar for a freshly computed version and recompute everything that
 * depends on it.
 *
 * Exists so a caller can rescore a single pillar -- entering a rent after the
 * fact, say -- without paying to re-run the three that did not change. The
 * composite, band and summary all follow from the pillar set, so they are
 * derived here rather than left to the caller to reproduce.
 */
export function withPillar(check: RealityCheck, next: Pillar): RealityCheck {
  const pillars = check.pillars.map((p) => (p.key === next.key ? next : p));
  const { score } = composite(pillars, check.priorities);
  return {
    ...check,
    pillars,
    score,
    band: score === null ? null : bandFor(score),
    summary: summarize(score, pillars, check.priorities),
  };
}

export async function realityCheck(
  listing: Listing,
  commuteTo: string,
  priorities: Priority[] = [],
): Promise<RealityCheck> {
  const at = { lat: listing.lat, lng: listing.lng };
  // Independent sources, so pay for the slowest one rather than the sum.
  const pillars = await Promise.all([
    scoreCommute(at, commuteTo),
    scoreSafety(at),
    scoreCost(at, listing.rent),
    scoreAmenities(at),
  ]);

  const { score } = composite(pillars, priorities);
  return {
    listing,
    commuteTo,
    priorities,
    score,
    band: score === null ? null : bandFor(score),
    summary: summarize(score, pillars, priorities),
    pillars,
  };
}
