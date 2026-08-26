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
