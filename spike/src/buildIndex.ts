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
 *   npm run build-index -- --breakdown   # incident groups only, no geocoding
 */
import { readFile, writeFile } from "node:fs/promises";
import { classify, groupOf, GROUPS, WEIGHTS, type Block, type BlockIndex } from "./sources/safety.ts";
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

/**
 * Per-block counts of each renter-facing incident group.
 *
 * Grouping happens in SQL rather than here so the response stays small: 188
 * call types collapse to 14 labels before the rows are sent. The result is
 * still ~26k rows, comfortably inside CKAN's cap for the 2026 data but not by
 * enough to rely on, so it is paged.
 */
async function fetchBreakdown(resource: string): Promise<Map<string, Map<string, number>>> {
  const buckets = new Map<string, string[]>();
  const types = await sql(`SELECT DISTINCT "CALL_TYPE" FROM "${resource}"`);
  for (const { CALL_TYPE } of types) {
    const g = groupOf(CALL_TYPE);
    if (!g) continue;
    if (!buckets.has(g)) buckets.set(g, []);
    buckets.get(g)!.push(CALL_TYPE);
  }

  const caseSql = [...buckets]
    .map(([g, ts]) => `WHEN "CALL_TYPE" IN (${ts.map(quote).join(",")}) THEN ${quote(g)}`)
    .join(" ");
  const kept = [...buckets.values()].flat().map(quote).join(",");

  const out = new Map<string, Map<string, number>>();
  const PAGE = 20_000;
  for (let offset = 0; ; offset += PAGE) {
    const rows = await sql(`
      SELECT "ADDRESS", CASE ${caseSql} END AS grp, COUNT(*) AS n
      FROM "${resource}"
      WHERE "CALL_TYPE" IN (${kept})
        AND "FINAL_DISPO" NOT IN (${DEAD_DISPOS.map(quote).join(",")})
      GROUP BY "ADDRESS", grp
      ORDER BY "ADDRESS", grp
      LIMIT ${PAGE} OFFSET ${offset}
    `);
    for (const r of rows) {
      const addr = normalizeBlock(r.ADDRESS);
      if (!addr || !r.grp) continue;
      if (!out.has(addr)) out.set(addr, new Map());
      const m = out.get(addr)!;
      m.set(r.grp, (m.get(r.grp) ?? 0) + Number(r.n));
    }
    process.stdout.write(`  ${offset + rows.length} rows... `);
    if (rows.length < PAGE) break;
  }
  console.log("done");
  return out;
}

/** Group counts for one block, as the compact [index, count] pairs Block.g holds. */
function packGroups(counts: Map<string, number> | undefined, labels: string[]): [number, number][] {
  if (!counts) return [];
  return [...counts]
    .map(([label, n]) => [labels.indexOf(label), n] as [number, number])
    .filter(([i]) => i >= 0)
    .sort((a, b) => b[1] - a[1]);
}

/**
 * Sample real blocks to learn what a "normal" neighbourhood total looks like,
 * and how heavy the worst one gets.
 *
 * Sampling at blocks skews a little harsh -- these are the busiest blocks in
 * the city, so their surroundings are busier than a random address. Gridding
 * the bounding box instead was tried and measured worse: San Jose's box is full
 * of hillside and industrial land nobody rents in, which drags the median to
 * zero and pushes Almaden Valley -- genuinely one of the quietest parts of the
 * city -- down to 41. Indexing all ~26k blocks rather than the top 4k is the
 * real fix; until then blocks are the closest thing to a lived-in sample.
 */
function baseline(blocks: Block[]): { deciles: number[]; tailMax: number; sampled: number } {
  const sample = blocks.length > 400
    ? blocks.filter((_, i) => i % Math.floor(blocks.length / 400) === 0).slice(0, 400)
    : blocks;
  const totals = sample.map((origin) => {
    let w = 0;
    for (const b of blocks) if (milesBetween(origin, b) <= RADIUS_MILES) w += b.weight;
    return w;
  }).sort((a, b) => a - b);
  return {
    deciles: Array.from({ length: 9 }, (_, i) => totals[Math.floor((totals.length * (i + 1)) / 10)] ?? 0),
    tailMax: totals[totals.length - 1] ?? 0,
    sampled: totals.length,
  };
}

const INDEX_PATH = new URL("../data/blocks.json", import.meta.url);

/** Recompute the baseline from blocks already on disk -- no refetch, no regeocode. */
async function rebaseline() {
  const index = JSON.parse(await readFile(INDEX_PATH, "utf8")) as BlockIndex;
  console.log(`\nRe-baselining ${index.blocks.length} blocks from ${index.year}...`);
  const { deciles, tailMax, sampled } = baseline(index.blocks);
  const next: BlockIndex = { ...index, builtAt: new Date().toISOString(), baselineDeciles: deciles, tailMax };
  await writeFile(INDEX_PATH, JSON.stringify(next));
  console.log(`   ${sampled} blocks sampled`);
  console.log(`   deciles: ${deciles.join(", ")}`);
  console.log(`   tailMax: ${tailMax}\n`);
}

/**
 * Add (or refresh) the per-block incident breakdown on an index already on
 * disk. Joins on address, so it costs one CKAN query and no geocoding -- the
 * expensive half of a full build is exactly what this exists to skip.
 */
async function addBreakdown() {
  const index = JSON.parse(await readFile(INDEX_PATH, "utf8")) as BlockIndex;
  const resource = RESOURCES[index.year];
  if (!resource) throw new Error(`No resource id for ${index.year}. Known: ${Object.keys(RESOURCES)}`);

  console.log(`\nAdding incident breakdown to ${index.blocks.length} blocks from ${index.year}...`);
  const breakdown = await fetchBreakdown(resource);
  const labels = GROUPS.map((g) => g.label);

  let matched = 0;
  const blocks = index.blocks.map((b) => {
    const g = packGroups(breakdown.get(b.address), labels);
    if (g.length) matched++;
    return g.length ? { ...b, g } : b;
  });

  const next: BlockIndex = { ...index, builtAt: new Date().toISOString(), groupLabels: labels, blocks };
  await writeFile(INDEX_PATH, JSON.stringify(next));
  console.log(`   ${matched} of ${blocks.length} blocks matched a breakdown`);
  console.log(`   groups: ${labels.join(", ")}\n`);
}

async function main() {
  if (process.argv.includes("--rebaseline")) return rebaseline();
  if (process.argv.includes("--breakdown")) return addBreakdown();
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
  console.log("3. Counting incident groups per block...");
  const breakdown = await fetchBreakdown(resource);
  const labels = GROUPS.map((g) => g.label);

  console.log(`4. Geocoding ${ranked.length} blocks (of ${byAddress.size} total)...`);
  const coords = await batchGeocode(ranked.map(([a]) => a));

  const blocks: Block[] = ranked
    .filter(([a]) => coords.has(a))
    .map(([address, v]) => {
      const g = packGroups(breakdown.get(address), labels);
      return { address, ...coords.get(address)!, ...v, ...(g.length ? { g } : {}) };
    });
  console.log(`   ${blocks.length} geocoded (${Math.round((blocks.length / ranked.length) * 100)}%).\n`);

  console.log("5. Computing city baseline...");
  const { deciles, tailMax, sampled } = baseline(blocks);
  const index: BlockIndex = {
    builtAt: new Date().toISOString(),
    year,
    radiusMiles: RADIUS_MILES,
    baselineDeciles: deciles,
    tailMax,
    groupLabels: labels,
    blocks,
  };
  await writeFile(INDEX_PATH, JSON.stringify(index));
  console.log(`   ${sampled} blocks sampled`);
  console.log(`   deciles: ${index.baselineDeciles.join(", ")}`);
  console.log(`   tailMax: ${tailMax}`);
  console.log(`\nWrote ${blocks.length} blocks to data/blocks.json\n`);
}

main().catch((e) => { console.error(`\nbuild-index failed: ${e.message}\n`); process.exit(1); });
