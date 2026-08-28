/**
 * Build a safety index for any city whose department publishes to Socrata.
 *
 *   npm run build-city -- chicago
 *   npm run build-city -- new-york --months 12
 *
 * San Jose keeps its own builder: SJPD is on CKAN, redacts addresses to block
 * ranges, and ships no coordinates, so most of that script is geocoding. San
 * Francisco keeps its own too, because its category list is closed and short
 * enough to map by hand and reads better written out. This one is for the rest
 * -- the cities that differ only in field names and vocabulary.
 *
 * What it does NOT do is make cities comparable. Every index gets its own
 * baseline deciles, so a block is ranked against its own city and a 0-100
 * means "compared to the rest of here" everywhere. Chicago counts reported
 * crimes and San Jose counts calls for service; there is no honest conversion,
 * and this never attempts one.
 */
import { writeFile } from "node:fs/promises";
import { classify, groupOf, GROUPS, WEIGHTS, type Block, type BlockIndex } from "./sources/safety.ts";
import { baseline, packGroups, RADIUS_MILES } from "./indexKit.ts";
import { milesBetween } from "./geocode.ts";
import { cityById } from "./cities.ts";
import { sourceFor, type Classified, type CitySource } from "./citySources.ts";

/**
 * How coarsely "raw" mode buckets coordinates into blocks.
 *
 * Three decimal places is about 110m of latitude -- a city block, near enough,
 * and the same order as the block labels the other cities publish. Finer would
 * split one corner into four; coarser would merge streets that feel different
 * to walk down.
 */
const BUCKET_DP = 3;

function arg(name: string, fallback: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

/** This city's own words first, then the shared crime-language patterns. */
function classifyFor(src: CitySource, raw: string): Classified | undefined {
  // A source may publish the statute rather than the offence; extract pulls
  // the part that can actually be looked up.
  const key = src.extract ? (raw.match(src.extract)?.[1] ?? raw) : raw;
  if (src.overrides && key in src.overrides) return src.overrides[key];
  const severity = classify(raw);
  if (severity === "excluded") return undefined; // matched nothing -- report it
  const group = groupOf(raw);
  return group ? { severity, group } : undefined;
}

type Counted = { lat: number; lng: number; weight: number; incidents: number; counts: Map<string, number> };

/**
 * The street address inside a legacy location point, when there is one.
 *
 * `human_address` is a JSON string, not an object, and it is frequently blank
 * -- so this returns null rather than an empty label whenever it cannot find a
 * real street, and the caller falls back to bucketing by coordinate.
 */
function streetOf(pt: any): string | null {
  if (!pt?.human_address) return null;
  try {
    const addr = JSON.parse(pt.human_address)?.address?.trim();
    return addr && addr.length > 3 ? addr : null;
  } catch {
    return null;
  }
}

async function fetchJson(url: string) {
  const res = await fetch(url, {
    headers: { "User-Agent": "reality-check" },
    signal: AbortSignal.timeout(300_000),
  });
  if (!res.ok) throw new Error(`Socrata ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as any[];
}

/**
 * Server-side aggregation, for portals that publish a block label.
 *
 * `::number` on the coordinates because several portals type them as text --
 * Seattle and Cincinnati both do -- and avg() refuses a string. It is a no-op
 * where the column is already numeric.
 *
 * Paged, because 50,000 is Socrata's ceiling per response and a year of
 * Chicago is four times that. Reading one page and stopping looked like it
 * worked: it wrote a plausible index that was quietly missing three quarters
 * of the city.
 */
async function grouped(src: CitySource, since: string) {
  const { block, category, date, lat, lng } = src.fields;
  const cast = src.castCoords ? "::number" : "";
  const out: any[] = [];
  const PAGE = 50_000;
  for (let offset = 0; ; offset += PAGE) {
    const params = new URLSearchParams({
      $select:
        `${block} as _blk, ${category} as _cat, count(*) as _n, ` +
        `avg(${lat}${cast}) as _lat, avg(${lng}${cast}) as _lng`,
      $where:
        `${date} > '${since}' AND ${lat} IS NOT NULL AND ${block} IS NOT NULL` +
        (src.where ? ` AND ${src.where}` : ""),
      $group: `${block}, ${category}`,
      $limit: String(PAGE),
      $offset: String(offset),
    });
    const page = await fetchJson(`https://${src.domain}/resource/${src.dataset}.json?${params}`);
    out.push(...page);
    process.stdout.write(`   ${out.length.toLocaleString()} rows... \r`);
    if (page.length < PAGE) break;
  }
  console.log();
  return out;
}

/**
 * Paginated download, for portals with coordinates but nothing to group by.
 *
 * NYPD and Dallas both publish a point and no street, so there is no label for
 * Socrata to aggregate on -- the bucketing has to happen here, which means the
 * rows have to come here. Only the four fields that matter are requested, so
 * this is far smaller than it sounds.
 */
async function raw(src: CitySource, since: string) {
  const { category, date, lat, lng, point } = src.fields;
  const cols = point ? `${category} as _cat, ${point} as _pt` : `${category} as _cat, ${lat} as _lat, ${lng} as _lng`;
  const out: any[] = [];
  const PAGE = 50_000;
  for (let offset = 0; ; offset += PAGE) {
    const params = new URLSearchParams({
      $select: cols,
      $where:
        `${date} > '${since}'` +
        (point ? "" : ` AND ${lat} IS NOT NULL`) +
        (src.where ? ` AND ${src.where}` : ""),
      $limit: String(PAGE),
      $offset: String(offset),
    });
    const page = await fetchJson(`https://${src.domain}/resource/${src.dataset}.json?${params}`);
    out.push(...page);
    process.stdout.write(`   ${out.length.toLocaleString()} rows... \r`);
    if (page.length < PAGE) break;
  }
  console.log();
  return out;
}

/**
 * Where the window should end: the newest point the data is actually dense at.
 *
 * Not max(date), which was the first attempt and is a trap. Cincinnati's feed
 * stopped in 2024 but carries a single stray row stamped 2026 -- anchoring on
 * it produced a twelve-month window containing three incidents. So the years
 * are counted first and the newest one with real volume wins; within that
 * year, max(date) is precise enough.
 */
const MIN_YEAR_ROWS = 1000;

async function windowEnd(src: CitySource): Promise<Date> {
  const { date } = src.fields;
  const yearOf = src.textDate ? `substring(${date}, 1, 4)` : `date_trunc_y(${date})`;
  const byYear = await fetchJson(
    `https://${src.domain}/resource/${src.dataset}.json?` +
      new URLSearchParams({
        $select: `${yearOf} as y, count(*) as n`,
        $group: yearOf,
        $order: "y DESC",
        $limit: "40",
      }),
  );

  const dense = byYear.find((r) => r.y && Number(r.n) >= MIN_YEAR_ROWS);
  if (!dense) throw new Error(`no year of ${date} has ${MIN_YEAR_ROWS}+ rows`);
  const year = Number(String(dense.y).slice(0, 4));

  const [row] = await fetchJson(
    `https://${src.domain}/resource/${src.dataset}.json?` +
      new URLSearchParams({
        $select: `max(${date}) as mx`,
        $where: `${date} < '${year + 1}-01-01${src.textDate ? "" : "T00:00:00"}'`,
      }),
  );
  const at = new Date(row?.mx);
  if (Number.isNaN(at.getTime())) throw new Error(`${date} has no usable maximum`);
  return at;
}

/**
 * Give coordinate-named blocks a street name.
 *
 * Every point of every centreline segment goes into the same kind of coarse
 * grid the scorer uses, then each block takes the names of the two nearest
 * distinct streets -- which is an intersection, and reads and geocodes like
 * one. A block that finds nothing keeps its coordinates rather than being
 * dropped: it still counts towards the neighbourhood totals.
 */
const STREET_CELL = 0.005; // ~0.35 mi of latitude
const SNAP_MILES = 0.25;

async function labelByStreets(
  src: CitySource,
  blocks: Block[],
): Promise<{ named: number; missed: number }> {
  const { dataset, nameField, geomField, where } = src.streets!;
  console.log(`   fetching street centrelines from ${src.domain}/${dataset}...`);

  const names: string[] = [];
  const grid = new Map<string, { lat: number; lng: number; n: number }[]>();
  const PAGE = 25_000;
  for (let offset = 0; ; offset += PAGE) {
    const params = new URLSearchParams({
      $select: `${nameField}, ${geomField}`,
      $where: `${nameField} IS NOT NULL` + (where ? ` AND ${where}` : ""),
      $limit: String(PAGE),
      $offset: String(offset),
    });
    const page = await fetchJson(`https://${src.domain}/resource/${dataset}.json?${params}`);
    for (const seg of page) {
      const name = String(seg[nameField]).trim();
      if (!name) continue;
      const n = names.push(name) - 1;
      // MultiLineString: an array of lines, each an array of [lng, lat].
      for (const line of seg[geomField]?.coordinates ?? []) {
        for (const [lng, lat] of line) {
          const key = `${Math.floor(lat / STREET_CELL)},${Math.floor(lng / STREET_CELL)}`;
          const cell = grid.get(key);
          if (cell) cell.push({ lat, lng, n });
          else grid.set(key, [{ lat, lng, n }]);
        }
      }
    }
    process.stdout.write(`   ${names.length.toLocaleString()} segments... \r`);
    if (page.length < PAGE) break;
  }
  console.log();

  let named = 0;
  let missed = 0;
  for (const b of blocks) {
    // Nearest point per distinct street name, within the snapping radius.
    const best = new Map<string, number>();
    const y = Math.floor(b.lat / STREET_CELL);
    const x = Math.floor(b.lng / STREET_CELL);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        for (const p of grid.get(`${y + dy},${x + dx}`) ?? []) {
          const d = milesBetween(b, p);
          if (d > SNAP_MILES) continue;
          const name = names[p.n]!;
          const had = best.get(name);
          if (had === undefined || d < had) best.set(name, d);
        }
      }
    }
    const two = [...best].sort((a, c) => a[1] - c[1]).slice(0, 2);
    if (!two.length) {
      missed++;
      continue;
    }
    b.address = two.length > 1 ? `${two[0]![0]} & ${two[1]![0]}` : two[0]![0];
    named++;
  }
  return { named, missed };
}

async function main() {
  const id = process.argv[2];
  if (!id || id.startsWith("--")) throw new Error("Usage: npm run build-city -- <city-id>");

  const city = cityById(id);
  if (!city) throw new Error(`${id} is not in cities.ts`);
  const src = sourceFor(id);
  if (!src) throw new Error(`${id} has no source in citySources.ts`);

  /*
   * The window runs back from the newest row the portal actually has, not from
   * today. Cincinnati's feed lags about seven months, so a window measured
   * from now fell entirely into the gap and the build "succeeded" with nothing
   * in it. Anchoring on the data means a slow portal yields a smaller, older
   * index rather than an empty one.
   */
  const months = Number(arg("months", "12"));
  const latest = await windowEnd(src);
  const since = new Date(latest.getTime() - months * 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    // A text date column is compared as a string, and these formats agree on
    // the date part but not the separator -- so only the date part is used.
    .slice(0, src.textDate ? 10 : 19);

  console.log(`\nReality Check — building the ${city.name} safety index\n`);
  const lag = Math.round((Date.now() - latest.getTime()) / 86_400_000);
  console.log(
    `1. Reading ${src.domain} since ${since.slice(0, 10)} (${src.mode})` +
      (lag > 45 ? `\n   note: this feed's newest row is ${lag} days old` : "") + "...",
  );
  const rows = src.mode === "grouped" ? await grouped(src, since) : await raw(src, since);
  console.log(`   ${rows.length.toLocaleString()} rows`);

  const milesFromCentre = (lat: number, lng: number) => {
    const R = 3958.8, rad = Math.PI / 180;
    const dLat = (lat - city.centre.lat) * rad;
    const dLng = (lng - city.centre.lng) * rad;
    const s = Math.sin(dLat / 2) ** 2 +
      Math.cos(city.centre.lat * rad) * Math.cos(lat * rad) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
  };

  const labels = GROUPS.map((g) => g.label);
  const blocks = new Map<string, Counted>();
  const unknown = new Map<string, number>();
  let counted = 0;
  let excluded = 0;
  let unplaced = 0;

  for (const r of rows) {
    const n = src.mode === "grouped" ? Number(r._n) : 1;
    const cat = r._cat;
    if (!cat) {
      excluded += n;
      continue;
    }

    const mapped = classifyFor(src, cat);
    if (mapped === undefined) {
      unknown.set(cat, (unknown.get(cat) ?? 0) + n);
      continue;
    }
    if (mapped === null) {
      excluded += n;
      continue;
    }

    /*
     * Three shapes, because Socrata has two point types and some portals
     * publish neither. GeoJSON puts the pair in `coordinates` (lng first);
     * the older "location" type -- which Dallas still uses -- names them, and
     * carries the street address alongside, which is what lets Dallas have
     * labelled blocks despite having no address column of its own.
     */
    const pt = r._pt;
    const lat = pt ? Number(pt.latitude ?? pt.coordinates?.[1]) : Number(r._lat);
    const lng = pt ? Number(pt.longitude ?? pt.coordinates?.[0]) : Number(r._lng);
    /*
     * Departments use sentinels for "we do not know where": Seattle files
     * latitude -1, others file 0. Rather than chase each one, anything that
     * lands implausibly far from the city it is supposed to be in is dropped
     * -- which also catches ordinary geocoding junk.
     */
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || milesFromCentre(lat, lng) > city.radiusMiles * 2) {
      unplaced += n;
      continue;
    }

    const key =
      src.mode === "grouped" ? String(r._blk) : (streetOf(pt) ?? `${lat.toFixed(BUCKET_DP)},${lng.toFixed(BUCKET_DP)}`);

    let block = blocks.get(key);
    if (!block) {
      block = { lat, lng, weight: 0, incidents: 0, counts: new Map() };
      blocks.set(key, block);
    }
    block.weight += n * WEIGHTS[mapped.severity as "violent" | "property" | "disorder"];
    block.incidents += n;
    block.counts.set(mapped.group, (block.counts.get(mapped.group) ?? 0) + n);
    counted += n;
  }

  console.log(
    `   ${counted.toLocaleString()} counted, ${excluded.toLocaleString()} excluded` +
      (unplaced ? `, ${unplaced.toLocaleString()} with no usable point` : ""),
  );

  if (unknown.size) {
    const total = [...unknown.values()].reduce((a, b) => a + b, 0);
    console.log(`\n   ! ${unknown.size} unmapped categories (${total.toLocaleString()} incidents).`);
    console.log(`     Add the ones that matter to overrides in citySources.ts:`);
    for (const [cat, n] of [...unknown].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
      console.log(`     ${String(n).padStart(8)}  ${cat}`);
    }
    console.log();
  }

  const packed: Block[] = [...blocks].map(([address, b]) => ({
    address,
    lat: b.lat,
    lng: b.lng,
    weight: b.weight,
    incidents: b.incidents,
    g: packGroups(b.counts, labels),
  }));

  /*
   * A near-empty index is worse than none: it loads, scores, and reports
   * confident nonsense off a handful of blocks. Cincinnati wrote one with a
   * single block in it before the window was anchored to the data.
   */
  if (packed.length < 100) {
    throw new Error(
      `only ${packed.length} blocks -- refusing to write an index this thin. ` +
        `Check the date field (${src.fields.date}) and the category field (${src.fields.category}).`,
    );
  }

  if (src.streets) {
    console.log(`2. Naming ${packed.length.toLocaleString()} blocks from street centrelines...`);
    const { named, missed } = await labelByStreets(src, packed);
    console.log(`   ${named.toLocaleString()} named, ${missed.toLocaleString()} left as coordinates`);
  }

  console.log(`3. Learning what a normal ${city.name} neighbourhood looks like...`);
  const { deciles, tailMax, sampled } = baseline(packed);
  console.log(`   ${sampled} blocks sampled`);
  console.log(`   deciles: ${deciles.join(", ")}`);
  console.log(`   tailMax: ${tailMax}`);

  const index: BlockIndex = {
    builtAt: new Date().toISOString(),
    /*
     * The year of the DATA, not of the build. It is shown to the reader --
     * "12 incidents within 0.4 mi in 2024" -- so a feed that has stopped
     * updating says so on the card rather than passing itself off as current.
     */
    year: latest.getFullYear(),
    radiusMiles: RADIUS_MILES,
    baselineDeciles: deciles,
    tailMax,
    groupLabels: labels,
    blocks: packed,
  };

  await writeFile(city.index, JSON.stringify(index));
  console.log(`\nWrote ${packed.length.toLocaleString()} blocks to ${city.index.pathname.split("/").pop()}\n`);
}

main().catch((e) => {
  console.error(`\nbuild-city failed: ${e.message}\n`);
  process.exit(1);
});
