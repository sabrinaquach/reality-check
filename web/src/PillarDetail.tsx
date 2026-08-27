import { useEffect, useState } from "react";
import { icons } from "./icons.ts";
import type { IncidentGroup, Pillar } from "./types.ts";

/**
 * The expandable half of a pillar card.
 *
 * Both the single-listing reality check and the two-up detailed breakdown open
 * these, so they live here rather than inside either page. "The comparison
 * shows the same information as the reality check" is a promise that only a
 * shared component can actually keep -- written twice, the two would drift on
 * the first change to either.
 */

export type ModeTime = {
  mode: "driving" | "transit" | "walking" | "bicycling";
  minutes: number;
  miles: number;
};

/** Exported from the Figma file, same set and stroke weight as the rest. */
const MODE_LABEL: Record<ModeTime["mode"], { icon: string | null; label: string }> = {
  driving: { icon: null, label: "Driving" },
  transit: { icon: icons.modeTransit, label: "Transit" },
  bicycling: { icon: icons.modeBicycling, label: "Cycling" },
  walking: { icon: icons.modeWalking, label: "Walking" },
};

/**
 * Other travel modes cost two Directions calls, so an answer is worth keeping
 * for as long as the tab is open.
 *
 * The server caches these for an hour too; this second copy is what stops a
 * closed-and-reopened card from making even the local round trip, and it means
 * opening the commute card on the comparison page and then on that listing's
 * own reality check is one lookup rather than two.
 */
const modeCache = new Map<string, ModeTime[]>();

/**
 * The trip by the modes the headline does not already cover -- driving is the
 * headline, so repeating it here would just restate the line above.
 *
 * Mounted only when a card is actually open, which is what keeps the extra API
 * calls off every page load.
 *
 * No rideshare row: Uber and Lyft publish no ETA or fare API without a partner
 * account. Deriving one from the drive time would sit in this list looking
 * exactly as measured as the rows either side of it, so there is none.
 */
export function CommuteModes({ at, to }: { at: { lat: number; lng: number }; to: string }) {
  const key = `${at.lat},${at.lng}|${to}`;
  const [modes, setModes] = useState<ModeTime[] | null>(() => modeCache.get(key) ?? null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!to || modeCache.has(key)) return;
    let cancelled = false;
    setLoading(true);
    fetch(`/api/commute?lat=${at.lat}&lng=${at.lng}&to=${encodeURIComponent(to)}`)
      .then((r) => r.json())
      .then((body) => {
        const next: ModeTime[] = body.modes ?? [];
        modeCache.set(key, next);
        if (!cancelled) setModes(next);
      })
      .catch(() => {
        // A failed lookup is not worth caching -- the next open should retry.
        if (!cancelled) setModes([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [key, to, at.lat, at.lng]);

  return (
    <div className="rc-modes">
      <p className="rc-modes-head">Other ways to make this trip</p>
      {!to && <p className="rc-detail">No workplace set, so there is no trip to route.</p>}
      {loading && <p className="rc-detail">Routing the other modes…</p>}
      {modes?.length === 0 && !loading && to && (
        <p className="rc-detail">No other routes available for this trip.</p>
      )}
      {modes?.map((m) => (
        <div className="rc-mode" key={m.mode}>
          {MODE_LABEL[m.mode].icon && (
            <img className="m-icon" src={MODE_LABEL[m.mode].icon!} alt="" />
          )}
          <span className="m-label">{MODE_LABEL[m.mode].label}</span>
          <span className="m-time">{m.minutes} min</span>
        </div>
      ))}
    </div>
  );
}

/**
 * What the calls nearby actually were.
 *
 * The score answers "how much", which leaves the more useful question
 * unanswered: two neighbourhoods can land on the same number because one is
 * loud on weekends and the other has cars broken into all week, and a renter
 * would pick differently between them. This ships with the pillar, read out of
 * the same block index the score comes from, so opening it costs no request.
 */
export function IncidentBreakdown({ incidents }: { incidents: IncidentGroup[] }) {
  if (!incidents.length) {
    return (
      <div className="rc-modes">
        <p className="rc-modes-head">What those incidents were</p>
        <p className="rc-detail">
          The safety index has no incident types yet. From the repo root, run{" "}
          <code>cd spike &amp;&amp; npm run build-index -- --breakdown</code> — it joins onto the
          blocks already indexed, so it needs no geocoding and takes about a minute.
        </p>
      </div>
    );
  }

  // Both figures describe the rows on screen. The headline's own incident total
  // is counted over a slightly fresher slice of the dataset, so quoting it here
  // as the denominator would invite arithmetic that does not come out.
  const shownCount = incidents.reduce((sum, g) => sum + g.count, 0);
  const shownShare = incidents.reduce((sum, g) => sum + g.share, 0);

  return (
    <div className="rc-modes">
      <p className="rc-modes-head">What those incidents were</p>
      {incidents.map((g) => (
        <div className="rc-incident" key={g.label}>
          <span className="i-label">{g.label}</span>
          {/* The bar is the share, so the eye ranks them before the numbers are
              read. Width is a percentage of the commonest group, not of 100 --
              against 100 the long tail is a row of invisible stubs. */}
          <span className="i-bar">
            <i style={{ width: `${Math.max(4, (g.count / incidents[0]!.count) * 100)}%` }} />
          </span>
          <span className="i-count">{g.count}</span>
          <span className="i-share">{g.share}%</span>
        </div>
      ))}
      <p className="rc-incident-note">
        The {incidents.length} commonest kinds — {shownCount.toLocaleString()} incidents,{" "}
        {shownShare}% of those counted nearby. These are police calls, not convictions.
      </p>
    </div>
  );
}

/**
 * What the cost score is actually made of.
 *
 * The rest of the pillar states a conclusion; this shows the two numbers
 * behind it and the one caveat that decides how to read them. The median
 * counts every lease currently being paid, including ones signed years ago at
 * yesterday's prices, so today's asking rents normally sit above it -- which
 * is why `costScore` treats merely matching it as a good deal rather than as
 * par. Without that sentence, "$195 more than typical" reads as a straight
 * mark against the listing, and it is not one.
 */
export function CostBasis({ pillar }: { pillar: Pillar }) {
  const facts = pillar.cost;
  if (!facts) return <div className="rc-modes"><p className="rc-detail">{pillar.detail}</p></div>;

  const diff = facts.rent === undefined ? null : facts.rent - facts.median;
  const pct = facts.rent === undefined ? null : Math.round((facts.rent / facts.median - 1) * 100);
  const money = (n: number) => `$${Math.abs(n).toLocaleString()}`;

  return (
    <div className="rc-modes">
      <p className="rc-modes-head">How this was measured</p>

      {facts.rent !== undefined && (
        <div className="rc-fact">
          <span className="f-label">This listing</span>
          <span className="f-value">{money(facts.rent)}/mo</span>
        </div>
      )}
      <div className="rc-fact">
        <span className="f-label">Typical nearby</span>
        <span className="f-value">{money(facts.median)}/mo</span>
      </div>
      {diff !== null && pct !== null && (
        <div className="rc-fact">
          <span className="f-label">Difference</span>
          <span className="f-value">
            {diff === 0 ? "None" : `${diff > 0 ? "+" : "−"}${money(diff)}/mo (${diff > 0 ? "+" : "−"}${Math.abs(pct)}%)`}
          </span>
        </div>
      )}

      <p className="rc-incident-note">
        “Typical” is the median rent for{" "}
        {facts.level === "tract" ? `your block's tract (${facts.area})` : facts.area}, from the
        Census ACS {facts.year} five-year estimate. It counts every lease being paid right now,
        including long-standing ones, so new listings normally ask more than it — a listing that
        merely matches it is already a good deal.
      </p>
    </div>
  );
}
