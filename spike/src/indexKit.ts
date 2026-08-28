import { milesBetween } from "./geocode.ts";
import type { Block } from "./sources/safety.ts";

/**
 * The parts of building a safety index that are the same in every city.
 *
 * A city builder's job is only to answer one question: for each block, how
 * many incidents of what kind. Turning that into a scoreable index -- packing
 * the group counts, and learning what a normal neighbourhood looks like here
 * -- is identical whether the source was SJPD's CKAN portal or SFPD's Socrata
 * one, so it lives here rather than being written twice and drifting.
 *
 * This module deliberately holds no city in it at all.
 */

/**
 * How far around a point counts as "the neighbourhood".
 *
 * Shared with the scorer through BlockIndex.radiusMiles: the builder writes
 * it into the index, and scoreSafety reads it back, so the baseline and the
 * lookups can never disagree about what radius they meant.
 */
export const RADIUS_MILES = 0.4;

/** Group counts for one block, as the compact [index, count] pairs Block.g holds. */
export function packGroups(
  counts: Map<string, number> | undefined,
  labels: string[],
): [number, number][] {
  if (!counts) return [];
  return [...counts]
    .map(([label, n]) => [labels.indexOf(label), n] as [number, number])
    .filter(([i]) => i >= 0)
    .sort((a, b) => b[1] - a[1]);
}

/**
 * Sample real blocks to learn what a "normal" neighbourhood total looks like
 * in this city, and how heavy the worst one gets.
 *
 * Sampling at blocks skews a little harsh -- these are places that appear in
 * the data, so their surroundings are busier than a random address. Gridding
 * the bounding box instead was tried and measured worse: San Jose's box is
 * full of hillside and industrial land nobody rents in, which drags the median
 * to zero and pushes Almaden Valley -- genuinely one of the quietest parts of
 * the city -- down to 41. Blocks are the closest thing to a lived-in sample.
 *
 * Every city gets its own deciles, and that is what makes the score portable
 * without the underlying data being comparable: San Jose publishes calls for
 * service and San Francisco publishes filed reports, and there is no honest
 * conversion between them. A block is only ever ranked against its own city.
 */
export function baseline(blocks: Block[]): { deciles: number[]; tailMax: number; sampled: number } {
  const sample =
    blocks.length > 400
      ? blocks.filter((_, i) => i % Math.floor(blocks.length / 400) === 0).slice(0, 400)
      : blocks;
  const totals = sample
    .map((origin) => {
      let w = 0;
      for (const b of blocks) if (milesBetween(origin, b) <= RADIUS_MILES) w += b.weight;
      return w;
    })
    .sort((a, b) => a - b);
  return {
    deciles: Array.from({ length: 9 }, (_, i) => totals[Math.floor((totals.length * (i + 1)) / 10)] ?? 0),
    tailMax: totals[totals.length - 1] ?? 0,
    sampled: totals.length,
  };
}
