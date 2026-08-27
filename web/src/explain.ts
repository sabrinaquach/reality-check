import { street } from "./address.ts";
import type { Pillar, Priority, RealityCheck } from "./types.ts";

/**
 * Saying why, in the reader's words.
 *
 * The scores explain themselves to whoever wrote them. "It scores 97 to 78,
 * winning on safety" tells you which column has a tick; it does not tell
 * someone who said commute mattered most why the place with the longer drive
 * came out ahead. That is the only question the page is really being asked,
 * and it has to be answered in the language of minutes and police calls and
 * rent, not of pillars and weights.
 *
 * So: name what they told us they cared about, say honestly how each place did
 * on it, and then say what outweighed it and by how much in real terms.
 */

/** What each pillar is called out loud. "Pillar" is our word, not theirs. */
const PLAIN: Record<Pillar["key"], string> = {
  commute: "the commute",
  safety: "safety",
  cost: "rent",
  amenities: "what's nearby",
};

const say = (key: Pillar["key"]) => PLAIN[key];

const get = (check: RealityCheck, key: Pillar["key"]) =>
  check.pillars.find((p) => p.key === key);

/** Scored on both sides, so the two can honestly be set against each other. */
function comparable(a: RealityCheck, b: RealityCheck, key: Pillar["key"]) {
  const x = get(a, key);
  const y = get(b, key);
  return x && y && !x.unavailable && !y.unavailable ? ([x, y] as const) : null;
}

/**
 * Two drives that are both short are not really a difference.
 *
 * Ten minutes against twelve is a rounding error in a day; ten against forty
 * is a life. Saying which is "better" without saying which of those it is
 * turns a true statement into a misleading one.
 */
function bothShortCommutes(x: Pillar, y: Pillar): boolean {
  return x.minutes !== undefined && y.minutes !== undefined && x.minutes <= 15 && y.minutes <= 15;
}

/**
 * The shortest true thing a pillar can say about itself.
 *
 * The headline and the detail are both written to stand alone on a card, so
 * strung together they make a paragraph nobody finishes. Everything after an
 * em dash is the card explaining itself a second time; the part before it is
 * the fact.
 */
function fact(p: Pillar): string {
  if (p.key === "commute" && p.minutes !== undefined) return `${p.minutes} min`;
  if (p.key === "safety") {
    // "406 incidents within 0.4 mi in 2026 — busier than..." -> "406 incidents
    // nearby". The radius and the year are the same on both sides of any
    // comparison, so repeating them twice in one sentence says nothing.
    const n = p.detail.match(/^([\d,]+) incidents/);
    return n ? `${n[1]} incidents nearby` : p.headline;
  }
  return p.headline.split(" — ")[0]!.replace(/\.$/, "");
}

export function explainComparison(a: RealityCheck, b: RealityCheck, winner: 0 | 1): string {
  const names: [string, string] = [street(a.listing.address), street(b.listing.address)];
  const loser: 0 | 1 = winner === 0 ? 1 : 0;
  const top: Priority | undefined = a.priorities[0];
  const parts: string[] = [];

  const sides = (key: Pillar["key"]) => {
    const pair = comparable(a, b, key);
    if (!pair) return null;
    return { mine: pair[winner]!, theirs: pair[loser]! };
  };

  // What separates them, whatever they said they cared about.
  const decider = (["safety", "cost", "commute", "amenities"] as Pillar["key"][])
    .map((key) => {
      const s = sides(key);
      return s ? { key, ...s, lead: s.mine.score - s.theirs.score } : null;
    })
    .filter((x): x is NonNullable<typeof x> => !!x && x.lead > 0)
    .sort((x, y) => y.lead - x.lead)[0];

  const priority = top ? sides(top) : null;
  const priorityLost = !!priority && priority.theirs.score > priority.mine.score;

  // 1. Their priority, answered honestly -- including when it loses.
  if (top && priority) {
    if (priorityLost) {
      const hedge =
        top === "commute" && bothShortCommutes(priority.mine, priority.theirs)
          ? ", though both are short trips"
          : "";
      parts.push(
        `You said ${say(top)} matters most, and ${names[loser]} is better there — ` +
          `${fact(priority.theirs)} against ${fact(priority.mine)}${hedge}.`,
      );
    } else if (decider && decider.key === top) {
      parts.push(
        `You said ${say(top)} matters most, and ${names[winner]} wins it — ` +
          `${fact(priority.mine)} against ${fact(priority.theirs)}.`,
      );
    } else {
      parts.push(
        `You said ${say(top)} matters most, and they are close on it — ` +
          `${fact(priority.mine)} against ${fact(priority.theirs)}.`,
      );
    }
  }

  // 2. The thing that actually decides it, when that is not what they asked for.
  if (decider && (!top || decider.key !== top)) {
    const size = decider.lead >= 40 ? "much" : decider.lead >= 15 ? "clearly" : "slightly";
    parts.push(
      `What separates them is ${say(decider.key)}: ${names[winner]} is ${size} better — ` +
        `${fact(decider.mine)} against ${fact(decider.theirs)}.`,
    );
  }

  /**
   * The trade, stated and left there.
   *
   * It used to end "unless the commute matters more to you than safety", which
   * reads as second-guessing a choice the reader already made at onboarding.
   * They said what they cared about; the job here is to report what the data
   * did with it, not to invite them to justify it.
   */
  if (decider && priorityLost) {
    parts.push(`That gap outweighs ${say(top!)}, so ${names[winner]} comes out ahead overall.`);
  }

  return parts.join(" ");
}

/**
 * Why one listing scores what it does.
 *
 * Same job, one listing: what they asked for, how this place answers it, and
 * the thing most likely to change their mind.
 */
export function explainCheck(check: RealityCheck): string {
  const top = check.priorities[0];
  const live = check.pillars.filter((p) => !p.unavailable);
  if (!live.length) return "There is not enough data on this address to say much yet.";

  const parts: string[] = [];
  const priority = top ? get(check, top) : undefined;

  if (top && priority && !priority.unavailable) {
    const verdict =
      priority.band === "good"
        ? "and this one delivers"
        : priority.band === "moderate"
          ? "and this one is middling"
          : "and this one struggles";
    parts.push(`You said ${say(top)} matters most, ${verdict} — ${fact(priority)}.`);
  }

  // The weakest thing worth knowing, since that is what changes a mind.
  const worst = [...live].sort((x, y) => x.score - y.score)[0]!;
  if (worst.band !== "good" && worst.key !== top) {
    parts.push(`Weigh that against ${say(worst.key)}: ${fact(worst)}.`);
  } else {
    const best = [...live].sort((x, y) => y.score - x.score).find((p) => p.key !== top);
    if (best) parts.push(`It is strong on ${say(best.key)} too — ${fact(best)}.`);
  }

  return parts.join(" ");
}
