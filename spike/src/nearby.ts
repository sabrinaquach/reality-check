import { bandFor } from "./bands.ts";
import { milesBetween } from "./geocode.ts";
import { blocksWithin, loadIndex, localWeight, percentileOf, type Block } from "./sources/safety.ts";
import { cityAt } from "./cities.ts";
import type { Band, LatLng } from "./types.ts";

/**
 * The index that answers for a point, or null when no city covers it.
 *
 * Each of the three functions below used to open one global index. They now
 * ask which city they are in first -- and a caller outside every city gets
 * null, which is the same answer they already gave for a missing index and is
 * handled the same way upstream.
 */
async function indexFor(at: LatLng) {
  const city = cityAt(at);
  if (!city) return null;
  const index = await loadIndex(city);
  return index ? { city, index } : null;
}

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
  /**
   * Which city's data this came from. The block is stored as the department
   * published it -- "1200 AVIATION AV", or an SF intersection -- which is not
   * an address until it says where. Three screens used to append ", San Jose"
   * themselves; now the thing that knows says so.
   */
  city: string;
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
  const found = await indexFor(at);
  if (!found) return null;
  // Raw blocks only -- the caller draws them, so the city never comes up.
  return blocksWithin(found.index, at, radiusMiles);
}

export type ScoredBlock = Block & { score: number; band: Band; city: string };

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
  const found = await indexFor(at);
  if (!found) return null;
  const { city, index } = found;

  // Both through the grid: this used to filter the whole city twice and then
  // compare every target against every neighbour, which is quadratic and was
  // what took the server down on the larger cities.
  const targets = blocksWithin(index, at, radiusMiles);

  return targets.map((b) => {
    let weight = 0;
    for (const other of blocksWithin(index, b, index.radiusMiles)) weight += other.weight;
    const score = Math.round(100 - percentileOf(weight, index.baselineDeciles, index.tailMax));
    return { ...b, score, band: bandFor(score), city: city.name };
  });
}

export async function quietNearby(at: LatLng, radiusMiles = 4, limit = 5): Promise<QuietSpot[] | null> {
  const found = await indexFor(at);
  if (!found) return null;
  const { city, index } = found;

  /*
   * This rail offers addresses to go and check. NYPD publishes a point and
   * nothing placeable, so its blocks are named by coordinate -- fine for
   * scoring an address and for colouring a map, useless as somewhere to send
   * a reader. An empty list is the honest answer; the screen already has a
   * state for it.
   */
  if (!city.labelled) return [];

  const candidates = blocksWithin(index, at, radiusMiles).map((b) => ({
    block: b,
    miles: milesBetween(at, b),
  }));
  if (!candidates.length) return [];

  const scored = candidates
    .map(({ block, miles }) => {
      const { weight } = localWeight(index, block, index.radiusMiles);
      const score = Math.round(100 - percentileOf(weight, index.baselineDeciles, index.tailMax));
      return { address: block.address, lat: block.lat, lng: block.lng, score, band: bandFor(score), miles, city: city.name };
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
