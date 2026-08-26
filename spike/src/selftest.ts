/**
 * npm run check -- asserts the scoring curves and weighting behave, with no
 * network and no dependencies. The API-shaped code is covered by running the
 * CLI; this covers the arithmetic that decides what a listing is worth.
 */
import { commuteScore } from "./sources/commute.ts";
import { costScore } from "./sources/cost.ts";
import { proximityScore } from "./sources/amenities.ts";
import { percentileOf } from "./sources/safety.ts";
import { bandFor, GOOD, MODERATE } from "./bands.ts";
import { composite, weightFor } from "./score.ts";
import type { Pillar, Priority } from "./types.ts";

let failures = 0;
function check(name: string, ok: boolean, got?: unknown) {
  if (ok) return console.log(`  ok   ${name}`);
  failures++;
  console.log(`  FAIL ${name}${got === undefined ? "" : ` (got ${JSON.stringify(got)})`}`);
}

const pillar = (key: Pillar["key"], score: number, unavailable?: string): Pillar => ({
  key, score, band: "moderate", headline: "", detail: "", basis: "", ...(unavailable ? { unavailable } : {}),
});

console.log("\ncurves");
check("commute is capped at 100", commuteScore(2) === 100);
check("commute falls with time", commuteScore(20) > commuteScore(40));
check("an hour each way scores 0", commuteScore(60) === 0);
check("commute never goes negative", commuteScore(180) === 0);
check("cost rewards under-median rent", costScore(0.8) === 100);
check("cost punishes double the median", costScore(2) === 0);
check("cost is monotonic", costScore(1.1) > costScore(1.4));
check("a quarter-mile walk is full marks", proximityScore(0.2) === 100);
check("two miles scores 0", proximityScore(2) === 0);

console.log("\nsafety percentile");
const deciles = [100, 200, 300, 400, 500, 600, 700, 800, 900];
check("a quiet block ranks low", percentileOf(50, deciles) < 10, percentileOf(50, deciles));
check("the worst block ranks 100", percentileOf(5000, deciles) === 100);
check("percentile interpolates between deciles", percentileOf(150, deciles) !== percentileOf(190, deciles));
check("percentile is monotonic", percentileOf(250, deciles) < percentileOf(650, deciles));

console.log("\nsafety tail");
// Without a tailMax there is nothing to stretch against, so the old clamp stands.
check("clamps to 100 with no tailMax", percentileOf(5000, deciles) === 100);
// With one, the worst tenth of the city stops being a single flat number.
check("the tail separates two bad blocks", percentileOf(1525, deciles, 2033) < percentileOf(1877, deciles, 2033));
check("the tail is continuous at the top decile", percentileOf(900, deciles, 2033) === 90);
check("nothing beats the worst sampled neighbourhood", percentileOf(9999, deciles, 2033) === 100);
check("the tail stays inside the top decile band", percentileOf(1200, deciles, 2033) > 90);
check("a tailMax below the top decile is ignored", percentileOf(5000, deciles, 500) === 100);

console.log("\nbands");
check("the top of the range is good", bandFor(100) === "good");
check("the bottom of the range is poor", bandFor(0) === "poor");
check("the cutoffs are inclusive", bandFor(GOOD) === "good" && bandFor(MODERATE) === "moderate");
check("just under a cutoff drops a band", bandFor(GOOD - 1) === "moderate" && bandFor(MODERATE - 1) === "poor");
// The places we calibrated against, so a future retune has to face them.
check("Almaden Valley (90) reads good", bandFor(90) === "good");
check("Willow Glen (61) reads good", bandFor(61) === "good");
check("Berryessa (38) reads moderate", bandFor(38) === "moderate");
check("Downtown (2) reads poor", bandFor(2) === "poor");

console.log("\nweighting");
const priorities: Priority[] = ["safety", "commute"];
check("a first priority outweighs an unpicked pillar", weightFor("safety", priorities) > weightFor("cost", priorities));
check("first priority outweighs second", weightFor("safety", priorities) > weightFor("commute", priorities));
check("amenities weigh least by default", weightFor("amenities", []) < weightFor("cost", []));

console.log("\ncomposite");
const all = [pillar("commute", 80), pillar("safety", 40), pillar("cost", 60), pillar("amenities", 90)];
const flat = composite(all, []).score!;
const safetyFirst = composite(all, ["safety"]).score!;
check("prioritising a weak pillar lowers the total", safetyFirst < flat, { flat, safetyFirst });
check("full coverage scores", composite(all, []).coverage === 1);
check(
  "too little data scores null",
  composite([pillar("commute", 80, "no key"), pillar("safety", 40, "no index"), pillar("cost", 60, "no key"), pillar("amenities", 90)], []).score === null,
);
check(
  "unavailable pillars do not drag the total down",
  composite([pillar("commute", 80), pillar("safety", 80), pillar("cost", 0, "no key")], []).score === 80,
);

console.log(failures ? `\n${failures} failed\n` : "\nall passed\n");
process.exit(failures ? 1 : 0);
