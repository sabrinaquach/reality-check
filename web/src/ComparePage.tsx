import { useEffect, useRef, useState } from "react";
import { icons } from "./icons.ts";
import { street, withoutState } from "./address.ts";
import { compare, type PillarPair, type Side } from "./compare.ts";
import { ZoneMap, type MapListing } from "./ZoneMap.tsx";
import { ScoreRing } from "./ScoreRing.tsx";
import { useMobile } from "./useMobile.ts";
import { CommuteModes, CostBasis, IncidentBreakdown } from "./PillarDetail.tsx";
import type { Pillar, RealityCheck } from "./types.ts";

/**
 * Figma node 2136:6930 — "detailed breakdown of comparison".
 *
 * Reached by filling the second comparison slot. The page is one column of
 * pillars, each holding the two listings side by side, with the better of the
 * pair tinted green. The design's own tint is rgba(58,219,58,0.2); the
 * amenities row uses the flat #d8f8d8 that the Good chip already uses, so both
 * live as tokens rather than as two spellings of "green" scattered through the
 * stylesheet.
 *
 * The design also carries a share control in the top-right. There is nothing
 * to share yet -- this app has no routing, so a comparison has no URL -- and a
 * button that does nothing is worse than no button, so it is left out until
 * there is something for it to do.
 */

/**
 * One listing's side of a pillar row.
 *
 * Every pillar opens to the same panel its card opens to on the single-listing
 * reality check -- the components come from PillarDetail, so "the breakdown
 * shows what the reality check shows" holds by construction rather than by two
 * copies happening to agree. Cost is the one addition: the reality check
 * prints its basis as a caption, which a two-up page has no room for and more
 * reason to show, since the two listings can be judged against the medians of
 * two different Census tracts.
 */
function CompareCard({
  check,
  pillar,
  won,
  label,
  onRent,
}: {
  check: RealityCheck;
  pillar: Pillar | undefined;
  won: boolean;
  /** Screen-reader context, since "Good" alone does not say whose. */
  label: string;
  /** Fill in a missing rent and rescore just this listing's cost pillar. */
  onRent?: (check: RealityCheck, rent: number) => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const [rent, setRent] = useState("");
  const [pricing, setPricing] = useState(false);

  /**
   * A block address off the safety or cheaper-areas rail has no asking price,
   * so its cost pillar cannot score and its total quietly rests on one pillar
   * fewer than the listing beside it. That is a gap the reader can close, so
   * ask rather than annotate.
   */
  const needsRent = !!onRent && pillar?.unavailable?.includes("No listed rent");
  if (needsRent) {
    const value = Number(rent);
    const ready = Number.isFinite(value) && value > 0 && !pricing;
    return (
      <div className="cmp-card out">
        <p className="cmp-headline">{pillar!.headline}</p>
        <p className="cmp-detail">Add this listing's rent to score it against the area.</p>
        <form
          className="rent-prompt"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!ready) return;
            setPricing(true);
            try {
              await onRent!(check, value);
            } finally {
              setPricing(false);
            }
          }}
        >
          <span className="rent-field">
            <img src={icons.dollar} alt="" />
            <input
              value={rent}
              onChange={(e) => setRent(e.target.value)}
              placeholder="Rent"
              inputMode="numeric"
              aria-label={`Listed rent for ${label}`}
            />
          </span>
          <button className="rent-go" disabled={!ready}>
            {pricing ? "…" : "Score"}
          </button>
        </form>
      </div>
    );
  }

  if (!pillar) {
    return (
      <div className="cmp-card out">
        <p className="cmp-headline">Not scored</p>
        <p className="cmp-detail">This pillar was not part of the check.</p>
      </div>
    );
  }

  if (pillar.unavailable) {
    return (
      <div className="cmp-card out">
        <p className="cmp-headline">No data</p>
        <p className="cmp-detail">{pillar.unavailable}</p>
      </div>
    );
  }

  const items = pillar.items ?? [];
  const canOpen =
    pillar.key === "commute" ||
    pillar.key === "cost" ||
    pillar.key === "safety" ||
    items.length > 0;

  return (
    <div className={`cmp-card${won ? " won" : ""}${open ? " open" : ""}`}>
      {/* The card's bottom-right corner, under the chevron it shares that edge
          with. It is a verdict on the whole card rather than on the headline
          alone, and out of the text's flow it cannot shift where a line
          starts -- which in a two-up comparison is what the eye reads across
          on. */}
      {won && <img className="cmp-tick" src={icons.check} alt="" />}
      <p className="cmp-headline">{pillar.headline}</p>
      <p className="cmp-detail">{pillar.detail}</p>

      {canOpen && (
        <button
          className="rc-chev"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={`${open ? "Hide" : "Show"} the breakdown for ${label}`}
        >
          <img src={icons.chevron} alt="" />
        </button>
      )}

      {open && (
        <div className="cmp-open">
          {pillar.key === "commute" && (
            <CommuteModes
              at={{ lat: check.listing.lat, lng: check.listing.lng }}
              to={check.commuteTo}
            />
          )}
          {pillar.key === "safety" && <IncidentBreakdown incidents={pillar.incidents ?? []} />}
          {pillar.key === "cost" && <CostBasis pillar={pillar} />}
          {pillar.key === "amenities" &&
            items.map((item) => (
              <div className="cmp-item" key={`${item.icon}${item.name}`}>
                <span className="i-name">
                  {item.icon} {item.name}
                </span>
                <span className="i-miles">{item.miles.toFixed(1)} mi</span>
                <span className="i-note">{item.note}</span>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

function PillarRow({
  pair,
  names,
  checks,
  onRent,
}: {
  pair: PillarPair;
  names: [string, string];
  checks: [RealityCheck, RealityCheck];
  onRent?: (check: RealityCheck, rent: number) => Promise<void> | void;
}) {
  return (
    <section className={`cmp-section cmp-${pair.key}`}>
      <h3>{pair.title}</h3>
      {pair.basis && <p className="cmp-sub">{pair.basis}</p>}
      <div className="cmp-row">
        {([0, 1] as Side[]).map((side) => (
          <CompareCard
            key={side}
            check={checks[side]}
            pillar={pair.pillars[side]}
            won={pair.winner === side}
            label={`${names[side]}, ${pair.title.toLowerCase()}`}
            onRent={onRent}
          />
        ))}
      </div>
    </section>
  );
}

export function ComparePage({
  a,
  b,
  onBack,
  inline = false,
  onOpen,
  onRent,
  listings = [],
  onCheck,
  onAdd,
}: {
  a: RealityCheck;
  b: RealityCheck;
  /** Absent when embedded: the Saved list beside it is the way out. */
  onBack?: () => void;
  /** Rendered inside another screen's column rather than as the whole page. */
  inline?: boolean;
  /** Open one side's full single-listing reality check. */
  onOpen: (check: RealityCheck) => void;
  /** Fill in a missing rent so a priceless side can score its cost pillar. */
  onRent?: (check: RealityCheck, rent: number) => Promise<void> | void;
  listings?: MapListing[];
  onCheck?: (address: string) => void;
  onAdd?: (address: string) => void;
}) {
  /**
   * The phone's version of this page: Figma nodes 2113:146 and 2113:223.
   *
   * Same page, reordered and re-proportioned. The two listings come first and
   * become a pair of heads rather than a sticky bar of buttons; the verdict
   * moves under them, ruled off above and below; and the pillar rows keep the
   * two-up shape they already have, at a size that fits 177px columns.
   *
   * Embedded in the Saved column it stays what it was -- there is no screen
   * there for it to take over.
   */
  const phone = useMobile() && !inline;

  /**
   * Whether the two heads have parked at the top of the screen, and so
   * compressed to the single pill of node 2219:7618.
   *
   * A sentinel above them is watched rather than the heads themselves: once
   * they are stuck their own position stops changing, so they can no longer
   * report anything. Same bargain the board's comparison box strikes.
   */
  const [stuck, setStuck] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = sentinel.current;
    if (!phone || !node) {
      setStuck(false);
      return;
    }
    const io = new IntersectionObserver(([entry]) => setStuck(!entry?.isIntersecting), {
      rootMargin: "-9px 0px 0px 0px",
    });
    io.observe(node);
    return () => io.disconnect();
  }, [phone]);

  const result = compare(a, b);
  const checks: [RealityCheck, RealityCheck] = [a, b];
  const names: [string, string] = [
    withoutState(a.listing.address),
    withoutState(b.listing.address),
  ];

  /* The verdict and its reasoning. Ruled off top and bottom on the phone
     (nodes 2113:159 and 2113:160), which is what the wrapper is for. */
  const verdict = (
    <div className="cmp-verdict-block">
      <p className="cmp-verdict">{result.headline}</p>
      <p className="cmp-summary">{result.summary}</p>
    </div>
  );

  /* The two column headers, and the only place the full address appears. Each
     is a button: having compared them, the next thing anyone wants is the
     whole reality check for the one that won.
   *
     On the phone the design gives each a 107px circle above its address. Those
     are image placeholders and there are no photographs to put in them, so the
     score ring goes there instead -- it is already round, already per-listing,
     and it is the number the desktop head shows as a chip anyway. */
  const heads = (
    <div className={`cmp-row cmp-heads${stuck ? " stuck" : ""}`}>
      {([0, 1] as Side[]).map((side) => (
        <button
          key={side}
          className={`cmp-head${result.winner === side ? " won" : ""}`}
          onClick={() => onOpen(checks[side])}
          title={`Open the full reality check for ${names[side]}`}
        >
          {result.winner === side && <img className="cmp-tick" src={icons.check} alt="" />}
          {phone && <ScoreRing score={checks[side].score} band={checks[side].band} label={null} />}
          <span className="cmp-addr">{names[side]}</span>
          {/* Compressed, the pill has 155px a side on the narrowest phone and
              "123 Apple St, San Jose" wants most of that on its own. The city
              is the same for both listings and says nothing about either. */}
          {phone && <span className="cmp-addr-short">{street(checks[side].listing.address)}</span>}
          {phone ? (
            <span className="cmp-rent">
              {checks[side].listing.rent
                ? `$${checks[side].listing.rent!.toLocaleString()} / mo`
                : "No rent given"}
            </span>
          ) : (
            checks[side].score !== null && (
              <span className={`cmp-score ${checks[side].band ?? ""}`}>{checks[side].score}%</span>
            )
          )}
        </button>
      ))}
    </div>
  );

  return (
    <div className={`rc cmp${inline ? " rc-inline" : ""}${phone ? " cmp-phone" : ""}`}>
      {onBack && (
        <div className="rc-top">
          <button className="circle" onClick={onBack} aria-label="Back to the board">
            <img className="ring" src={icons.circleBtn} alt="" />
            <img className="glyph" src={icons.back} alt="" style={{ width: 24, height: 24 }} />
          </button>
          {/* The design's bar carries the app's name here (node 2113:158). The
              page's own name is the more useful thing to put in it, and it is
              the <h1> this bar replaces. */}
          {phone && <span className="cmp-title">Detailed breakdown</span>}
          <div className="spacer" />
        </div>
      )}

      {!phone && <h1>Detailed breakdown</h1>}

      {/* Heads first on the phone: the design opens with the two listings and
          puts the verdict under them, where it reads as a conclusion about the
          pair rather than a headline arriving before its subject. */}
      {phone ? (
        <>
          {/* Watched, not drawn. */}
          <div ref={sentinel} className="stick-sentinel" aria-hidden="true" />
          {heads}
          {verdict}
        </>
      ) : (
        <>
          {verdict}
          {heads}
        </>
      )}

      {result.pillars.map((pair) => (
        <PillarRow key={pair.key} pair={pair} names={names} checks={checks} onRent={onRent} />
      ))}

      <section className="cmp-section">
        <h2>Commute &amp; safety zone</h2>
        <ZoneMap
          center={{ lat: a.listing.lat, lng: a.listing.lng }}
          height={phone ? 300 : 404}
          listings={listings}
          onCheck={onCheck}
          onAdd={onAdd}
        />
      </section>
    </div>
  );
}
