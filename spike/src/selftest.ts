/**
 * npm run check -- asserts the scoring curves and weighting behave, with no
 * network and no dependencies. The API-shaped code is covered by running the
 * CLI; this covers the arithmetic that decides what a listing is worth.
 */
import { commuteScore } from "./sources/commute.ts";
import { costScore } from "./sources/cost.ts";
import { proximityScore } from "./sources/amenities.ts";
import { percentileOf } from "./sources/safety.ts";
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
