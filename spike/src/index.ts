/**
 * Reality Check CLI — one listing in, four pillars and a composite out.
 *
 *   npm run score -- "1 N Market St, San Jose" --to "Apple Park, Cupertino" \
 *                    --rent 2800 --priorities safety,commute
 *
 * Pillars that need a key you have not set report themselves as unavailable
 * instead of guessing, and drop out of the composite.
 */
import { geocode } from "./geocode.ts";
import { realityCheck } from "./score.ts";
import type { Priority } from "./types.ts";

const PRIORITIES: Priority[] = ["commute", "safety", "cost"];

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  const v = i > -1 ? process.argv[i + 1] : undefined;
  return v && !v.startsWith("--") ? v : undefined;
}

const BANDS = { good: "\x1b[32m", moderate: "\x1b[33m", poor: "\x1b[31m" } as const;
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const OFF = "\x1b[0m";

function bar(score: number): string {
  const filled = Math.round(score / 5);
  return "█".repeat(filled) + "·".repeat(20 - filled);
}

async function main() {
  const address = process.argv.slice(2).find((a, i, all) => !a.startsWith("--") && !all[i - 1]?.startsWith("--"));
  if (!address) {
    console.error(
      `\nusage: npm run score -- "<address>" [--to "<work address>"] [--rent 2800] [--priorities safety,commute]\n`,
    );
    process.exit(1);
  }

  const commuteTo = arg("to") ?? "";
  const rent = arg("rent") ? Number(arg("rent")) : undefined;
  const priorities = (arg("priorities") ?? "")
    .split(",")
    .map((p) => p.trim().toLowerCase())
    .filter((p): p is Priority => PRIORITIES.includes(p as Priority));

  process.stdout.write(`\nLocating "${address}"... `);
  const at = await geocode(address);
  if (!at) {
    console.error(`no match.\nTry a street address, or set GOOGLE_MAPS_API_KEY for named places.\n`);
    process.exit(1);
  }
  console.log(`${at.lat.toFixed(5)}, ${at.lng.toFixed(5)}`);

  const check = await realityCheck({ address, rent, ...at }, commuteTo, priorities);

  const total = check.score === null ? "--" : String(check.score);
  console.log(`\n${BOLD}${address}${OFF}`);
  console.log(`${BOLD}Reality Check: ${total}/100${OFF}  ${check.summary}\n`);

  for (const p of check.pillars) {
    const label = p.key.padEnd(10);
    if (p.unavailable) {
      console.log(`${DIM}${label} ${"·".repeat(20)}  --  ${p.headline}${OFF}`);
      console.log(`${DIM}${" ".repeat(11)}${p.unavailable}${OFF}`);
      continue;
    }
    console.log(
      `${label} ${BANDS[p.band]}${bar(p.score)}${OFF}  ${String(p.score).padStart(3)}  ${BOLD}${p.headline}${OFF}`,
    );
    console.log(`${" ".repeat(11)}${p.detail}`);
    console.log(`${DIM}${" ".repeat(11)}${p.basis}${OFF}`);
  }
  console.log();
}

main().catch((e) => {
  console.error(`\nscore failed: ${e.message}\n`);
  process.exit(1);
});
