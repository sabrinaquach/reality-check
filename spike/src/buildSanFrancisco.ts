/**
 * Build of the San Francisco safety index.
 *
 *   SFPD incident reports  ->  filter + severity-weight  ->  per-block totals
 *   -> data/blocks-san-francisco.json
 *
 * Where San Jose's builder spends most of its effort geocoding -- SJPD ships
 * block ranges and no coordinates -- this one does almost none. SFPD publishes
 * a latitude and longitude on every report and an `intersection` label to group
 * them by, and Socrata will do the grouping server-side. So the whole city
 * arrives as ~6,000 aggregate rows instead of ~100,000 individual ones, and
 * the build takes seconds rather than the better part of an hour.
 *
 *   npm run build-sf
 *   npm run build-sf -- --months 24
 *
 * What this is NOT: comparable to San Jose's numbers. SJPD publishes calls for
 * service (someone rang, an officer went) and SFPD publishes filed incident
 * reports (an officer wrote it up). Neither converts into the other. That is
 * fine, and it is the reason every city gets its own baseline deciles: a block
 * is only ever ranked against its own city, and the 0-100 that comes out means
 * "compared to the rest of this city" in both places.
 */
import { writeFile } from "node:fs/promises";
import { GROUPS, WEIGHTS, type Block, type BlockIndex, type Severity } from "./sources/safety.ts";
import { baseline, packGroups, RADIUS_MILES } from "./indexKit.ts";
import { cityById } from "./cities.ts";

const DOMAIN = "data.sfgov.org";
const DATASET = "wg3w-h783"; // Police Department Incident Reports, 2018 to present

/**
 * Every value SFPD's `incident_category` takes, mapped onto the two things the
 * index needs: how much it counts, and what to call it.
 *
 * This is written out in full rather than matched by regex, because the list
 * is closed and short -- fifty values, all of them checked against the live
 * dataset -- and a mapping you can read down is a mapping you can argue with.
 * San Jose needs regexes because SJPD emits 188 free-text call types with
 * near-duplicates like "BURGLARY (460)" and "BURGLARY  REPORT  (460)".
 *
 * `null` means excluded, on the same reasoning the SJPD filter uses: it counts
 * police activity or paperwork rather than something that happened to a
 * resident. A warrant service, a courtesy report, a recovered vehicle and a
 * traffic-violation arrest all tell you where officers were, not where risk
 * is -- and counting them would score a heavily-patrolled block as dangerous.
 */
const CATEGORIES: Record<string, { severity: Severity; group: string } | null> = {
  // -- violent ------------------------------------------------------------
  "Assault":                                        { severity: "violent",  group: "Assault" },
  "Homicide":                                       { severity: "violent",  group: "Assault" },
  "Rape":                                           { severity: "violent",  group: "Assault" },
  "Sex Offense":                                    { severity: "violent",  group: "Assault" },
  "Robbery":                                        { severity: "violent",  group: "Robbery" },
  "Weapons Offense":                                { severity: "violent",  group: "Weapons" },
  "Weapons Offence":                                { severity: "violent",  group: "Weapons" },
  "Weapons Carrying Etc":                           { severity: "violent",  group: "Weapons" },
  "Human Trafficking (A), Commercial Sex Acts":     { severity: "violent",  group: "Assault" },
  "Human Trafficking, Commercial Sex Acts":         { severity: "violent",  group: "Assault" },
  "Human Trafficking (B), Involuntary Servitude":   { severity: "violent",  group: "Assault" },
  // Arson is violent in San Jose's scheme too, and grouped under Vandalism.
  "Arson":                                          { severity: "violent",  group: "Vandalism" },

  // -- property -----------------------------------------------------------
  "Larceny Theft":                                  { severity: "property", group: "Theft" },
  "Stolen Property":                                { severity: "property", group: "Theft" },
  "Burglary":                                       { severity: "property", group: "Break-ins" },
  "Motor Vehicle Theft":                            { severity: "property", group: "Car theft" },
  "Motor Vehicle Theft?":                           { severity: "property", group: "Car theft" },
  "Malicious Mischief":                             { severity: "property", group: "Vandalism" },
  "Vandalism":                                      { severity: "property", group: "Vandalism" },
  "Fraud":                                          { severity: "property", group: "Fraud" },
  "Forgery And Counterfeiting":                     { severity: "property", group: "Fraud" },
  "Embezzlement":                                   { severity: "property", group: "Fraud" },

  // -- disorder -----------------------------------------------------------
  "Drug Offense":                                   { severity: "disorder", group: "Drugs" },
  "Drug Violation":                                 { severity: "disorder", group: "Drugs" },
  "Disorderly Conduct":                             { severity: "disorder", group: "Disturbances" },
  "Suspicious Occ":                                 { severity: "disorder", group: "Suspicious activity" },
  "Suspicious":                                     { severity: "disorder", group: "Suspicious activity" },
  "Prostitution":                                   { severity: "disorder", group: "Suspicious activity" },
  "Liquor Laws":                                    { severity: "disorder", group: "Suspicious activity" },
  "Gambling":                                       { severity: "disorder", group: "Suspicious activity" },
  "Civil Sidewalks":                                { severity: "disorder", group: "Disturbances" },
  /*
   * A judgement call, and the least comfortable one here. This category is
   * mostly domestic -- child neglect, violation of a protective order -- which
   * is real harm but not the street risk someone choosing a block is asking
   * about, and the scheme has only three weights to put it at. Violent would
   * let a single household dominate its neighbourhood's score; excluding it
   * would pretend it is paperwork. Disorder is the honest middle.
   */
  "Offences Against The Family And Children":       { severity: "disorder", group: "Disturbances" },

  // -- excluded: police activity, paperwork, or not a crime ---------------
  "Warrant": null,
  "Traffic Violation Arrest": null,
  "Traffic Collision": null,
  "Recovered Vehicle": null,
  "Vehicle Impounded": null,
  "Vehicle Misplaced": null,
  "Non-Criminal": null,
  "Lost Property": null,
  "Missing Person": null,
  "Miscellaneous Investigation": null,
  "Case Closure": null,
  "Courtesy Report": null,
  "Fire Report": null,
  "Suicide": null,
  "Other Miscellaneous": null,
  "Other Offenses": null,
  "Other": null,
  "None": null,
};

function arg(name: string, fallback: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

type Row = {
  intersection: string;
  incident_category: string;
  n: string;
  lat: string;
  lng: string;
};

/** One Socrata page. 50k is its ceiling; we are well under it. */
async function fetchGrouped(since: string): Promise<Row[]> {
  const params = new URLSearchParams({
    $select: "intersection, incident_category, count(*) as n, avg(latitude) as lat, avg(longitude) as lng",
    $where: `incident_datetime > '${since}' AND latitude IS NOT NULL AND intersection IS NOT NULL`,
    $group: "intersection, incident_category",
    $limit: "50000",
  });
  const res = await fetch(`https://${DOMAIN}/resource/${DATASET}.json?${params}`, {
    headers: { "User-Agent": "reality-check" },
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) throw new Error(`Socrata ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as Row[];
}

async function main() {
  const city = cityById("san-francisco");
  if (!city) throw new Error("san-francisco is not in cities.ts");

  const months = Number(arg("months", "12"));
  const since = new Date(Date.now() - months * 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 19);

  console.log(`\nReality Check — building the ${city.name} safety index\n`);
  console.log(`1. Reading SFPD incident reports since ${since.slice(0, 10)}...`);
  const rows = await fetchGrouped(since);
  console.log(`   ${rows.length.toLocaleString()} grouped rows`);

  // Anything the portal starts publishing that this file has never heard of.
  // Silently dropping it would quietly shrink the index instead of saying so.
  const unknown = new Map<string, number>();

  const labels = GROUPS.map((g) => g.label);
  const blocks = new Map<string, Block & { counts: Map<string, number> }>();
  let counted = 0;
  let excluded = 0;

  for (const r of rows) {
    const n = Number(r.n);
    const cat = r.incident_category;
    // Socrata omits null fields rather than sending them, so a report filed
    // without a category arrives with no key at all. Nothing to classify it
    // by, so it is excluded -- and counted as such rather than reported as a
    // category named "undefined".
    if (!cat) {
      excluded += n;
      continue;
    }
    if (!(cat in CATEGORIES)) {
      unknown.set(cat, (unknown.get(cat) ?? 0) + n);
      continue;
    }
    const mapped = CATEGORIES[cat];
    if (!mapped) {
      excluded += n;
      continue;
    }

    const key = r.intersection;
    let block = blocks.get(key);
    if (!block) {
      block = {
        address: key,
        lat: Number(r.lat),
        lng: Number(r.lng),
        weight: 0,
        incidents: 0,
        counts: new Map(),
      };
      blocks.set(key, block);
    }
    block.weight += n * WEIGHTS[mapped.severity as Exclude<Severity, "excluded">];
    block.incidents += n;
    block.counts.set(mapped.group, (block.counts.get(mapped.group) ?? 0) + n);
    counted += n;
  }

  console.log(`   ${counted.toLocaleString()} incidents counted, ${excluded.toLocaleString()} excluded`);
  if (unknown.size) {
    console.log(`\n   ! ${unknown.size} unmapped categories -- add them to CATEGORIES:`);
    for (const [cat, n] of [...unknown].sort((a, b) => b[1] - a[1])) {
      console.log(`     ${String(n).padStart(6)}  ${cat}`);
    }
    console.log();
  }

  const packed: Block[] = [...blocks.values()].map(({ counts, ...b }) => ({
    ...b,
    g: packGroups(counts, labels),
  }));

  console.log(`\n2. Learning what a normal ${city.name} neighbourhood looks like...`);
  const { deciles, tailMax, sampled } = baseline(packed);
  console.log(`   ${sampled} blocks sampled`);
  console.log(`   deciles: ${deciles.join(", ")}`);
  console.log(`   tailMax: ${tailMax}`);

  const index: BlockIndex = {
    builtAt: new Date().toISOString(),
    year: new Date().getFullYear(),
    radiusMiles: RADIUS_MILES,
    baselineDeciles: deciles,
    tailMax,
    groupLabels: labels,
    blocks: packed,
  };

  await writeFile(city.index, JSON.stringify(index));
  console.log(`\nWrote ${packed.length.toLocaleString()} blocks to data/blocks-san-francisco.json\n`);
}

main().catch((e) => {
  console.error(`\nbuild-sf failed: ${e.message}\n`);
  process.exit(1);
});
