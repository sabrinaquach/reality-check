import { street } from "./address.ts";
import { explainComparison } from "./explain.ts";
import type { Pillar, RealityCheck } from "./types.ts";

/**
 * Reading two reality checks against each other.
 *
 * Presentation, not scoring -- the same reasoning as `headline` in
 * RealityCheckPage. Every number here was already computed by the engine; this
 * only decides which of two existing scores is the better one and says so in a
 * sentence. Keeping it client-side also means the comparison page opens the
 * instant the second slot fills, with no round trip for arithmetic the browser
 * is already holding both sides of.
 */

export type Side = 0 | 1;

const TITLES: Record<Pillar["key"], string> = {
  commute: "Commute",
  safety: "Safety",
  cost: "Cost",
  amenities: "Nearby amenities",
};

/** The order the design lays the sections out in. */
const ORDER: Pillar["key"][] = ["commute", "safety", "cost", "amenities"];

export type PillarPair = {
  key: Pillar["key"];
  title: string;
  /** The basis caption, from whichever side has one -- they agree in practice. */
  basis: string;
  pillars: [Pillar | undefined, Pillar | undefined];
  /** The better side, or null when they tie or cannot be honestly compared. */
  winner: Side | null;
};

export type Comparison = {
  /** The better listing overall, or null when there is nothing to separate them. */
  winner: Side | null;
  headline: string;
  /** Why, in plain words, starting from what the reader said they cared about. */
  summary: string;
  pillars: PillarPair[];
};

/**
 * A pillar is only comparable when both sides actually have a number.
 *
 * If one is unavailable, the other does NOT win by default: an address outside
 * the police data area has no safety score, which is not the same as scoring
 * badly, and colouring the other card green would be inventing a result the
 * data does not support.
 */
function winnerOf(a: Pillar | undefined, b: Pillar | undefined): Side | null {
  if (!a || !b || a.unavailable || b.unavailable) return null;

  /**
   * A tied score is not always a tie.
   *
   * `commuteScore` clamps at both ends, so every drive of 10 minutes or less
   * scores 100 -- which made a 5-minute commute and a 10-minute one draw, and
   * left the shorter one with no tick. Where the pillar carries the quantity
   * the score was derived from, fall back to it: fewer minutes wins.
   */
  if (a.score === b.score) {
    if (a.minutes !== undefined && b.minutes !== undefined && a.minutes !== b.minutes) {
      return a.minutes < b.minutes ? 0 : 1;
    }
    return null;
  }
  return a.score > b.score ? 0 : 1;
}

/** The pillars a listing could not score at all, named. */
function missing(check: RealityCheck): string[] {
  return ORDER.filter((k) => check.pillars.find((p) => p.key === k)?.unavailable).map((k) =>
    TITLES[k].toLowerCase(),
  );
}

/** Joins names the way a sentence would: "a", "a and b", "a, b and c". */
function list(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export function compare(a: RealityCheck, b: RealityCheck): Comparison {
  const pillars: PillarPair[] = ORDER.map((key) => {
    const pa = a.pillars.find((p) => p.key === key);
    const pb = b.pillars.find((p) => p.key === key);
    return {
      key,
      title: TITLES[key],
      basis: pa?.basis ?? pb?.basis ?? "",
      pillars: [pa, pb] as [Pillar | undefined, Pillar | undefined],
      winner: winnerOf(pa, pb),
    };
  }).filter((p) => p.pillars[0] || p.pillars[1]);

  const winner: Side | null =
    a.score === null || b.score === null || a.score === b.score ? null : a.score > b.score ? 0 : 1;

  const names: [string, string] = [street(a.listing.address), street(b.listing.address)];

  const wonBy = (side: Side) =>
    pillars.filter((p) => p.winner === side).map((p) => p.title.toLowerCase());

  let headline: string;
  let summary: string;

  if (winner === null) {
    headline =
      a.score === null || b.score === null
        ? "Not enough data to call this one."
        : "These two are hard to separate.";
    const split = pillars.filter((p) => p.winner !== null);
    summary = split.length
      ? `They score the same overall. ${names[0]} is ahead on ${list(wonBy(0))}; ` +
        `${names[1]} on ${list(wonBy(1))}.`
      : "Neither pulls ahead on any of the pillars we can compare.";
    if (a.score === null || b.score === null) {
      summary =
        "One of these is missing too much data to score, so there is no honest " +
        "overall comparison. The pillars below still stand on their own.";
    }
  } else {
    headline = `${names[winner]} is a better fit.`;
    summary = explainComparison(a, b, winner);
  }

  /**
   * Say when the two totals are not built from the same pillars.
   *
   * `composite` divides by the weight it could actually score, so a missing
   * pillar is left out rather than counted against. That is right for a single
   * listing -- guessing a number is worse than not having one -- but set two
   * side by side and the one with less data can look better simply for having
   * been asked fewer questions. A block address off the safety or cheaper-areas
   * rail has no rent, so this is the common case, not an edge one.
   *
   * The verdict still stands on the pillars they do share; this makes the
   * asymmetry visible instead of leaving it in the arithmetic.
   */
  const gaps: [string[], string[]] = [missing(a), missing(b)];
  const total = pillars.length;
  if (gaps[0].join() !== gaps[1].join()) {
    const short: Side = gaps[0].length > gaps[1].length ? 0 : 1;
    const other: Side = short === 0 ? 1 : 0;
    if (gaps[short].length) {
      const note =
        ` ${names[short]} has no ${list(gaps[short])} score, so its total rests on ` +
        `${total - gaps[short].length} of the four things we measure where ` +
        `${names[other]}'s rests on ${total - gaps[other].length}.`;
      summary += note;
    }
  }

  return { winner, headline, summary, pillars };
}
