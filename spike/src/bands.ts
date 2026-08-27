import type { Band } from "./types.ts";

/**
 * Where a 0-100 score stops being green, and where it goes red.
 *
 * These started at 67/34 -- even thirds -- which was arbitrary, and stopped
 * fitting once the safety index grew from 3,194 blocks to 7,271. The larger
 * index samples its baseline across every incident-bearing block rather than
 * only the worst few thousand, so percentiles shifted down across the board:
 * Willow Glen went from 79 to 61 without becoming a worse place to live.
 *
 * 60/30 is set against places we can check by hand. Almaden Valley (90) and
 * Willow Glen (61) read good; Rose Garden (49), Evergreen (42) and Berryessa
 * (38) read moderate; East San Jose (5) and Downtown (2) read poor. That
 * matches how people who live here would rank them.
 *
 * The same cut has to make sense for the other three pillars, since a green
 * card should mean the same thing on all four:
 *   commute    good is a drive of 30 min or less, poor past 45
 *   cost       good is within ~26% of the ACS median, poor past ~54%
 *   amenities  good is errands averaging under a mile away
 */
export const GOOD = 60;
export const MODERATE = 30;

export function bandFor(score: number): Band {
  return score >= GOOD ? "good" : score >= MODERATE ? "moderate" : "poor";
}

/**
 * The verdict on a whole listing is a stricter question than the verdict on
 * any one pillar.
 *
 * A composite of 65 is not one bad pillar dragging three good ones down -- the
 * weighting means it is more or less everything sitting around 65, nothing
 * broken and nothing good either. Calling that green oversells it to someone
 * about to sign a year's lease, so the overall score turns green only at 80
 * and red below 70.
 *
 * The pillar cuts above deliberately stay where the neighbourhood calibration
 * put them: they answer "is this commute good", which is a different and more
 * forgiving question than "should I take this place".
 */
export const VERDICT_GOOD = 80;
export const VERDICT_MODERATE = 70;

export function verdictBandFor(score: number): Band {
  return score >= VERDICT_GOOD ? "good" : score >= VERDICT_MODERATE ? "moderate" : "poor";
}

/** The words that go with each verdict band, so the page and the CLI agree. */
export const VERDICT_TEXT: Record<Band, string> = {
  good: "Looks solid",
  moderate: "Okay",
  poor: "Not the best choice",
};
