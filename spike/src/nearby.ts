import { bandFor } from "./bands.ts";
import { milesBetween } from "./geocode.ts";
import { loadIndex, localWeight, percentileOf, type Block } from "./sources/safety.ts";
import type { Band, LatLng } from "./types.ts";

export type QuietSpot = {
  /** The indexed block, e.g. "1300 LINCOLN AV". */
  address: string;
  lat: number;
  lng: number;
  /** Same 0-100 safety scale the pillar uses. */
  score: number;
  band: Band;
  /** Distance from the point asked about. */
  miles: number;
};

/**
 * Two spots on the same street are the same recommendation twice, so once a
 * block is picked, everything within this radius of it is skipped.
 */
const SPREAD_MILES = 0.5;

/**
 * The quietest indexed blocks near a point.
 *
 * A caveat worth carrying into the UI: every candidate is a block that appears
 * in SJPD's data, so this ranks *places with at least one call* from quietest
 * up. It is not a claim that nowhere else is quieter -- somewhere with no
 * calls at all never enters the index and so can never be recommended here.
 */
/** Raw indexed blocks within `radius`, for a caller that wants to draw them. */
export async function blocksNear(at: LatLng, radiusMiles = 1.5) {
  const index = await loadIndex();
  if (!index) return null;
  return index.blocks.filter((b) => milesBetween(at, b) <= radiusMiles);
}

export type ScoredBlock = Block & { score: number; band: Band };

/**
 * The same blocks, each carrying the safety score of the neighbourhood around
 * it -- the identical figure the safety pillar reports for an address there.
 *
 * A block's own weight is NOT that number: one quiet block can sit inside a
 * busy quarter mile. Colouring a map by raw block weight and labelling it with
 * the pillar's words would mean two different things by the same label, so
 * this runs every block through localWeight -> percentileOf -> bandFor exactly
 * as scoreSafety does.
 *
 * Neighbours are gathered out to radius + the scoring radius, so blocks at the
 * edge of the requested area are still scored against a complete surround.
 */
export async function scoredBlocksNear(at: LatLng, radiusMiles = 1.5): Promise<ScoredBlock[] | null> {
  const index = await loadIndex();
  if (!index) return null;

  const targets = index.blocks.filter((b) => milesBetween(at, b) <= radiusMiles);
  const surround = index.blocks.filter((b) => milesBetween(at, b) <= radiusMiles + index.radiusMiles);

  return targets.map((b) => {
    let weight = 0;
    for (const other of surround) {
      if (milesBetween(b, other) <= index.radiusMiles) weight += other.weight;
    }
    const score = Math.round(100 - percentileOf(weight, index.baselineDeciles, index.tailMax));
    return { ...b, score, band: bandFor(score) };
  });
}

export async function quietNearby(at: LatLng, radiusMiles = 4, limit = 5): Promise<QuietSpot[] | null> {
  const index = await loadIndex();
  if (!index) return null;

  const candidates = index.blocks
    .map((b) => ({ block: b, miles: milesBetween(at, b) }))
    .filter((c) => c.miles <= radiusMiles);
  if (!candidates.length) return [];

  const scored = candidates
    .map(({ block, miles }) => {
      const { weight } = localWeight(index, block, index.radiusMiles);
      const score = Math.round(100 - percentileOf(weight, index.baselineDeciles, index.tailMax));
      return { address: block.address, lat: block.lat, lng: block.lng, score, band: bandFor(score), miles };
    })
    .sort((a, b) => b.score - a.score || a.miles - b.miles);

  const picked: QuietSpot[] = [];
  for (const s of scored) {
    if (picked.length >= limit) break;
    if (picked.some((p) => milesBetween(p, s) < SPREAD_MILES)) continue;
    picked.push(s);
  }

  return picked;
}
