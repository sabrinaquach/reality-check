/**
 * One-time (well, yearly) build of the San Jose safety index.
 *
 *   SJPD calls-for-service  ->  filter + severity-weight  ->  per-block totals
 *   -> Census batch geocoder -> data/blocks.json
 *
 * SJPD redacts addresses to a block range ("[300]-[400] E SANTA CLARA ST") and
 * ships no coordinates, so geocoding is on us. There are only ~26k distinct
 * blocks per year, which is cheap to do once and useless to redo per request.
 *
 *   npm run build-index -- --year 2026 --limit 4000
 */
import { writeFile } from "node:fs/promises";
import { classify, WEIGHTS, type Block, type BlockIndex } from "./sources/safety.ts";
import { milesBetween } from "./geocode.ts";

const CKAN = "https://data.sanjoseca.gov/api/3/action";
const RESOURCES: Record<number, string> = {
  2024: "df207219-ba82-407d-8190-5b31edaded79",
  2025: "0bc5ea69-fcc7-4998-ab6c-70c3a0df778b",
  2026: "dc0ec99c-0c6b-45fb-b1ec-faf072fe4833",
};

/** Calls where nothing was confirmed to have happened. */
const DEAD_DISPOS = ["Unfounded event", "Canceled", "Gone on Arrival/unable to locate"];

const RADIUS_MILES = 0.4;

function arg(name: string, fallback: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function sql(query: string) {
  const res = await fetch(`${CKAN}/datastore_search_sql`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sql: query }),
    signal: AbortSignal.timeout(120_000),
  });
  const body = (await res.json()) as any;
  if (!body?.success) throw new Error(`CKAN: ${JSON.stringify(body?.error)?.slice(0, 300)}`);
  return body.result.records as any[];
}

const quote = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** "[300]-[400] E SANTA CLARA ST " -> "300 E SANTA CLARA ST" (low end of range). */
export function normalizeBlock(raw: string): string | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  const m = s.match(/^\[(\d+)\]\s*-\s*\[(\d+)\]\s*(.+)$/);
  if (m) return `${m[1]} ${m[3]}`.replace(/\s+/g, " ").trim();
  if (/^\d+\s+\S/.test(s)) return s.replace(/\s+/g, " ").trim();
  return null; // intersections ("1ST ST & SANTA CLARA ST") -- skipped for now
}

/** Census batch geocoder: CSV in, CSV out, 10k rows max, no key needed. */
async function batchGeocode(addresses: string[]): Promise<Map<string, { lat: number; lng: number }>> {
  const out = new Map<string, { lat: number; lng: number }>();
  const CHUNK = 5000;
  for (let i = 0; i < addresses.length; i += CHUNK) {
    const chunk = addresses.slice(i, i + CHUNK);
    const csv = chunk.map((a, j) => `${i + j},"${a}","San Jose","CA",""`).join("\n");
    const form = new FormData();
    form.set("addressFile", new Blob([csv], { type: "text/csv" }), "addresses.csv");
    form.set("benchmark", "Public_AR_Current");
    process.stdout.write(`  geocoding ${i + 1}-${i + chunk.length} of ${addresses.length}... `);
    try {
      const res = await fetch("https://geocoding.geo.census.gov/geocoder/locations/addressbatch", {
        method: "POST",
        body: form,
        signal: AbortSignal.timeout(600_000),
      });
      const text = await res.text();
      let hits = 0;
      for (const line of text.split("\n")) {
        // id,"input","Match","Exact","matched addr","lon,lat",...
        const cols = line.match(/(".*?"|[^,]+)/g);
        if (!cols || cols.length < 6) continue;
        if (!/Match/.test(cols[2] ?? "")) continue;
        const coords = (cols[5] ?? "").replace(/"/g, "").split(",");
        const lng = Number(coords[0]);
        const lat = Number(coords[1]);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
        const id = Number((cols[0] ?? "").replace(/"/g, ""));
        const original = addresses[id];
        if (original) { out.set(original, { lat, lng }); hits++; }
      }
      console.log(`${hits} matched`);
    } catch (err) {
      console.log(`failed (${(err as Error).message})`);
    }
  }
  return out;
}

/** Sample real blocks to learn what a "normal" neighbourhood total looks like. */
function baselineDeciles(blocks: Block[]): number[] {
  const sample = blocks.length > 400
    ? blocks.filter((_, i) => i % Math.floor(blocks.length / 400) === 0).slice(0, 400)
    : blocks;
  const totals = sample.map((origin) => {
    let w = 0;
    for (const b of blocks) if (milesBetween(origin, b) <= RADIUS_MILES) w += b.weight;
    return w;
  }).sort((a, b) => a - b);
  return Array.from({ length: 9 }, (_, i) =>
    totals[Math.floor((totals.length * (i + 1)) / 10)] ?? 0);
}

async function main() {
  const year = Number(arg("year", "2026"));
  const limit = Number(arg("limit", "4000"));
  const resource = RESOURCES[year];
  if (!resource) throw new Error(`No resource id for ${year}. Known: ${Object.keys(RESOURCES)}`);

  console.log(`\nReality Check — building safety index for ${year}\n`);

  console.log("1. Reading call types from SJPD...");
  const types = await sql(`SELECT DISTINCT "CALL_TYPE" FROM "${resource}"`);
  const buckets: Record<string, string[]> = { violent: [], property: [], disorder: [] };
  for (const { CALL_TYPE } of types) {
    const sev = classify(CALL_TYPE);
    if (sev !== "excluded") buckets[sev].push(CALL_TYPE);
  }
  const kept = Object.values(buckets).flat().length;
  console.log(`   ${types.length} call types -> ${kept} kept ` +
    `(${buckets.violent.length} violent, ${buckets.property.length} property, ${buckets.disorder.length} disorder)`);
  console.log(`   ${types.length - kept} dropped as police-initiated or non-crime.\n`);

  console.log("2. Aggregating weighted incidents per block...");
  const caseSql = (Object.keys(buckets) as (keyof typeof WEIGHTS)[])
    .filter((k) => buckets[k].length)
    .map((k) => `WHEN "CALL_TYPE" IN (${buckets[k].map(quote).join(",")}) THEN ${WEIGHTS[k]}`)
    .join(" ");
  const allKept = Object.values(buckets).flat().map(quote).join(",");
  const rows = await sql(`
    SELECT "ADDRESS",
           SUM(CASE ${caseSql} ELSE 0 END) AS weight,
           COUNT(*) AS incidents
    FROM "${resource}"
    WHERE "CALL_TYPE" IN (${allKept})
      AND "FINAL_DISPO" NOT IN (${DEAD_DISPOS.map(quote).join(",")})
    GROUP BY "ADDRESS"
    ORDER BY weight DESC
  `);
  console.log(`   ${rows.length} blocks with at least one real incident.\n`);

  const byAddress = new Map<string, { weight: number; incidents: number }>();
  for (const r of rows) {
    const addr = normalizeBlock(r.ADDRESS);
    if (!addr) continue;
    const prev = byAddress.get(addr) ?? { weight: 0, incidents: 0 };
    byAddress.set(addr, {
      weight: prev.weight + Number(r.weight),
      incidents: prev.incidents + Number(r.incidents),
    });
  }
  const ranked = [...byAddress.entries()]
    .sort((a, b) => b[1].weight - a[1].weight)
    .slice(0, limit);
  console.log(`3. Geocoding ${ranked.length} blocks (of ${byAddress.size} total)...`);
  const coords = await batchGeocode(ranked.map(([a]) => a));

  const blocks: Block[] = ranked
    .filter(([a]) => coords.has(a))
    .map(([address, v]) => ({ address, ...coords.get(address)!, ...v }));
  console.log(`   ${blocks.length} geocoded (${Math.round((blocks.length / ranked.length) * 100)}%).\n`);

  console.log("4. Computing city baseline...");
  const index: BlockIndex = {
    builtAt: new Date().toISOString(),
    year,
    radiusMiles: RADIUS_MILES,
    baselineDeciles: baselineDeciles(blocks),
    blocks,
  };
  const path = new URL("../data/blocks.json", import.meta.url);
  await writeFile(path, JSON.stringify(index));
  console.log(`   deciles: ${index.baselineDeciles.join(", ")}`);
  console.log(`\nWrote ${blocks.length} blocks to data/blocks.json\n`);
}

main().catch((e) => { console.error(`\nbuild-index failed: ${e.message}\n`); process.exit(1); });
