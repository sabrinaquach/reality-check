import { useState } from "react";
import { icons } from "./icons.ts";
import { ZoneMap, type MapListing } from "./ZoneMap.tsx";
import { CommuteModes, CostBasis, IncidentBreakdown } from "./PillarDetail.tsx";
import { explainCheck } from "./explain.ts";
import { withoutState } from "./address.ts";
import { useMobile } from "./useMobile.ts";
import type { Pillar, RealityCheck } from "./types.ts";

/**
 * Figma node 2136:6532 — "reality check (1 listing)".
 *
 * The single-listing result, shown after Check listing. Each pillar becomes a
 * card: a coloured band chip, the headline, the supporting line, and the icon
 * for that pillar. Amenities gets a taller card because it lists what it found.
 */

const SECTIONS: { key: Pillar["key"]; title: string; icon: string; size: number }[] = [
  { key: "commute", title: "Commute", icon: icons.iconCar, size: 48 },
  { key: "safety", title: "Safety", icon: icons.iconWarn, size: 42 },
  { key: "cost", title: "Cost", icon: icons.iconMoney, size: 42 },
];

const BAND_LABEL = { good: "Good", moderate: "Moderate", poor: "Poor" } as const;

/**
 * The cost pillar reports the tract median even with no rent to compare it to,
 * so rather than a dead "not available" card it offers the missing input. The
 * rescore hits the Census only -- the other three pillars are untouched.
 */
function RentPrompt({
  pillar,
  busy,
  onSubmit,
  title,
}: {
  pillar: Pillar;
  busy: boolean;
  onSubmit: (rent: number) => void;
  title: string;
}) {
  const [rent, setRent] = useState("");
  const value = Number(rent);
  const ready = Number.isFinite(value) && value > 0 && !busy;

  return (
    <div className="rc-card">
      <span className="rc-chip">Needs a rent</span>
      <span className="rc-pillar-name">{title}</span>
      <p className="rc-headline">{pillar.headline}</p>
      <p className="rc-detail">{pillar.detail}</p>
      <form
        className="rent-prompt"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) onSubmit(value);
        }}
      >
        <span className="rent-field">
          <img src={icons.dollar} alt="" />
          <input
            value={rent}
            onChange={(e) => setRent(e.target.value)}
            placeholder="Enter the listed rent"
            inputMode="numeric"
            aria-label="Listed rent"
          />
        </span>
        <button className="rent-go" disabled={!ready}>
          {busy ? "Checking…" : "Check cost"}
        </button>
      </form>
    </div>
  );
}

/**
 * The commute card opens to show the trip by the other travel modes. The panel
 * itself is shared with the comparison page -- see PillarDetail.
 */
function CommuteCard({
  pillar,
  at,
  to,
  icon,
  size,
  title,
}: {
  pillar: Pillar;
  at: { lat: number; lng: number };
  to: string;
  icon: string;
  size: number;
  /** Shown beside the chip on the phone, where there is no heading above. */
  title: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className={open ? "rc-card open" : "rc-card"}>
      <div className="rc-head">
        <span className={`rc-chip ${pillar.band}`}>{BAND_LABEL[pillar.band]}</span>
        <span className="rc-pillar-name">{title}</span>
        <p className="rc-headline">{pillar.headline}</p>
        <p className="rc-detail">{pillar.detail}</p>
        <img className="rc-icon" src={icon} alt="" style={{ width: size, height: size, right: 65 - size }} />
      </div>
      <button
        className="rc-chev"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={open ? "Hide other travel modes" : "Show other travel modes"}
        title={open ? "Hide other ways to travel" : "Other ways to travel"}
      >
        <img src={icons.chevron} alt="" />
      </button>

      {open && <CommuteModes at={at} to={to} />}
    </div>
  );
}

/**
 * The safety card opens to show what the calls nearby actually were.
 *
 * The score answers "how much", which leaves the more useful question
 * unanswered: two neighbourhoods can land on the same number because one is
 * loud on weekends and the other has cars broken into all week, and a renter
 * would pick differently between them. The breakdown ships with the pillar --
 * it is read out of the same block index the score comes from -- so opening
 * this costs no request.
 */
function SafetyCard({ pillar, icon, size, title }: { pillar: Pillar; icon: string; size: number; title: string }) {
  const [open, setOpen] = useState(false);
  const groups = pillar.incidents ?? [];

  return (
    <div className={open ? "rc-card open" : "rc-card"}>
      <div className="rc-head">
        <span className={`rc-chip ${pillar.band}`}>{BAND_LABEL[pillar.band]}</span>
        <span className="rc-pillar-name">{title}</span>
        <p className="rc-headline">{pillar.headline}</p>
        <p className="rc-detail">{pillar.detail}</p>
        <img className="rc-icon" src={icon} alt="" style={{ width: size, height: size, right: 65 - size }} />
      </div>
      <button
        className="rc-chev"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={open ? "Hide what the incidents were" : "Show what the incidents were"}
        title={open ? "Hide the incident breakdown" : "What kind of incidents?"}
      >
        <img src={icons.chevron} alt="" />
      </button>

      {open && <IncidentBreakdown incidents={groups} />}
    </div>
  );
}

/**
 * Cost opens to the two figures the score is made of.
 *
 * It is the pillar whose headline is hardest to act on -- "$195 more than
 * typical" is only bad news if you know what "typical" counts, and it counts
 * leases signed years ago. The panel says so, and it is the same one the
 * comparison page opens.
 */
function CostCard({ pillar, icon, size, title }: { pillar: Pillar; icon: string; size: number; title: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className={open ? "rc-card open" : "rc-card"}>
      <div className="rc-head">
        <span className={`rc-chip ${pillar.band}`}>{BAND_LABEL[pillar.band]}</span>
        <span className="rc-pillar-name">{title}</span>
        <p className="rc-headline">{pillar.headline}</p>
        <p className="rc-detail">{pillar.detail}</p>
        <img className="rc-icon" src={icon} alt="" style={{ width: size, height: size, right: 65 - size }} />
      </div>
      <button
        className="rc-chev"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={open ? "Hide how the cost was measured" : "Show how the cost was measured"}
        title={open ? "Hide the figures" : "Where does 'typical' come from?"}
      >
        <img src={icons.chevron} alt="" />
      </button>

      {open && <CostBasis pillar={pillar} />}
    </div>
  );
}

function PillarCard({ pillar, icon, size, title }: { pillar: Pillar; icon: string; size: number; title: string }) {
  if (pillar.unavailable) {
    return (
      <div className="rc-card out">
        <div className="rc-head">
          <span className="rc-chip">Not available</span>
          <span className="rc-pillar-name">{title}</span>
          <p className="rc-headline">No data</p>
          <p className="rc-detail">{pillar.unavailable}</p>
          <img className="rc-icon" src={icon} alt="" style={{ width: size, height: size, right: 65 - size }} />
        </div>
      </div>
    );
  }
  return (
    <div className="rc-card">
      <div className="rc-head">
        <span className={`rc-chip ${pillar.band}`}>{BAND_LABEL[pillar.band]}</span>
        <span className="rc-pillar-name">{title}</span>
        <p className="rc-headline">{pillar.headline}</p>
        <p className="rc-detail">{pillar.detail}</p>
        <img className="rc-icon" src={icon} alt="" style={{ width: size, height: size, right: 65 - size }} />
      </div>
    </div>
  );
}

export function RealityCheckPage({
  check,
  onBack,
  inline = false,
  saved,
  onToggleSave,
  onRent,
  listings = [],
  onCheck,
  onAdd,
  onAddListing,
  slotsFull,
}: {
  check: RealityCheck;
  /**
   * Leave undefined when the page is embedded and there is nowhere to go back
   * to -- the Saved list beside it is already the way out.
   */
  onBack?: () => void;
  /**
   * Rendered inside another screen's column rather than as the whole page, so
   * it drops the centred 956px measure and fills whatever it is given.
   */
  inline?: boolean;
  saved: boolean;
  onToggleSave: () => void;
  /** Fill in a missing rent and rescore just the cost pillar. */
  onRent?: (rent: number) => Promise<void> | void;
  listings?: MapListing[];
  onCheck?: (address: string) => void;
  onAdd?: (address: string) => void;
  /**
   * Put this listing into the comparison. The phone's footer bar (node
   * 2113:469) is the only place this is offered: on the desktop the board's
   * own form and its rails are a scroll away, and on this page they are a
   * screen away.
   */
  onAddListing?: () => void;
  slotsFull?: boolean;
}) {
  const [pricing, setPricing] = useState(false);
  /**
   * The phone's version of this page, which the design rebuilds rather than
   * reflows: the map becomes the thing you land on, the rest rides up over it
   * on a panel, and the listing itself moves to a bar at the foot of the
   * screen. Embedded in the Saved column it stays the column it already was --
   * there is no screen there to take over.
   */
  const phone = useMobile() && !inline;
  const [why, setWhy] = useState(false);
  const amenities = check.pillars.find((p) => p.key === "amenities");
  const items = amenities?.items ?? [];
  const half = Math.ceil(items.length / 2);
  const columns = [items.slice(0, half), items.slice(half)];

  const heart = (
    <button
      className="circle"
      onClick={onToggleSave}
      aria-pressed={saved}
      title={saved ? "Remove from saved" : "Save this listing"}
      aria-label={saved ? "Remove from saved" : "Save this listing"}
    >
      <img className="ring" src={icons.circleBtn} alt="" />
      {/* Filled once saved; the outline is the same path with no fill. */}
      <img
        className="glyph"
        src={saved ? icons.heart : icons.heartOutline}
        alt=""
        style={{ width: 31, height: 31 }}
      />
    </button>
  );

  const scoreChip =
    check.score !== null ? (
      <span className={`rc-score ${check.band ?? ""}`}>{check.score}% score</span>
    ) : null;

  /*
   * Last on the desktop, where it is the closing section of a document; first
   * on the phone, where node 2113:377 makes it the top 369px of the screen and
   * everything else a panel drawn over its lower edge.
   */
  const mapSection = (
    <section className="rc-section rc-map">
      <h2>Commute &amp; safety zone</h2>
      <ZoneMap
        center={{ lat: check.listing.lat, lng: check.listing.lng }}
        route={check.pillars.find((p) => p.key === "commute")?.route}
        height={phone ? 369 : 404}
        listings={listings}
        onCheck={onCheck}
        onAdd={onAdd}
        slotsFull={slotsFull}
      />
    </section>
  );

  return (
    <div className={`rc${inline ? " rc-inline" : ""}${phone ? " rc-phone" : ""}`}>
      {/*
       * Embedded, the heading row carries the heart and the score with it
       * (Figma node 2135:5355): there is no back button to anchor a row of its
       * own, and the score sits opposite the title rather than trailing the
       * address. On the full page the score stays in the meta line, where node
       * 2136:6532 puts it.
       */}
      {/* On the full page the heart pairs with the back arrow, one control at
          each end of its own row. Embedded there is no back arrow and so no
          row, and the heart travels with the title instead. */}
      {!inline && (
        <div className="rc-top">
          {onBack && (
            <button className="circle" onClick={onBack} aria-label="Back to comparison">
              <img className="ring" src={icons.circleBtn} alt="" />
              <img className="glyph" src={icons.back} alt="" style={{ width: 24, height: 24 }} />
            </button>
          )}
          <span className="spacer" />
          {heart}
        </div>
      )}

      {/* The score sits beside the heading on both, because it is the headline
          fact about the listing rather than a tail on the address.
       *
       * Embedded, the heart is the row's last item rather than the title's
       * neighbour: the Saved column hangs its expand control off this same
       * line, and the two round 39px controls belong together at that end
       * instead of one by the title and one across the row from it.
       */}
      {phone && mapSection}

      {/* A plain wrapper on the desktop (display: contents), and the panel the
          phone lifts over the map's lower edge. */}
      <div className="rc-body">
      <div className="rc-head-row">
        <h1>Reality check</h1>
        <span className="spacer" />
        {scoreChip}
        {/* Node 2113:475. What the number is made of, which a percentage on
            its own cannot say -- and which changes with the priorities set
            during onboarding, so it is not the same answer for everyone. */}
        {phone && scoreChip && (
          <button
            className="rc-why"
            onClick={() => setWhy((v) => !v)}
            aria-expanded={why}
            aria-label="How this score is worked out"
          >
            <img src={icons.info} alt="" />
          </button>
        )}
        {inline && heart}
      </div>

      <div className="rc-meta">
        <span>{check.listing.address}</span>
        <img className="rc-dot" src={icons.dot} alt="" />
        <span>{check.listing.rent ? `$${check.listing.rent.toLocaleString()} / mo` : "No rent given"}</span>
      </div>

      {/* Why this scores what it does, in minutes and rent and police calls
          rather than in the words the scoring uses to itself. */}
      <p className="rc-summary">{explainCheck(check)}</p>

      {why && (
        <p className="rc-weighting">
          <img src={icons.info} alt="" />
          Your score is based on commute, safety, and cost — weighted toward what matters most
          to you.
        </p>
      )}

      {SECTIONS.map(({ key, title, icon, size }) => {
        const pillar = check.pillars.find((p) => p.key === key);
        if (!pillar) return null;
        // Missing rent is a gap the reader can close, unlike a missing key.
        const needsRent =
          key === "cost" && onRent && pillar.unavailable?.includes("No listed rent");
        return (
          <section className="rc-section rc-pillar" key={key}>
            <h3>{title}</h3>
            <p className="rc-sub">{pillar.basis}</p>
            {key === "commute" && !pillar.unavailable ? (
              <CommuteCard
                pillar={pillar}
                at={{ lat: check.listing.lat, lng: check.listing.lng }}
                to={check.commuteTo}
                icon={icon}
                size={size}
                title={title}
              />
            ) : key === "safety" && !pillar.unavailable ? (
              <SafetyCard pillar={pillar} icon={icon} size={size} title={title} />
            ) : key === "cost" && !pillar.unavailable ? (
              <CostCard pillar={pillar} icon={icon} size={size} title={title} />
            ) : needsRent ? (
              <RentPrompt
                pillar={pillar}
                title={title}
                busy={pricing}
                onSubmit={async (rent) => {
                  setPricing(true);
                  try {
                    await onRent(rent);
                  } finally {
                    setPricing(false);
                  }
                }}
              />
            ) : (
              <PillarCard pillar={pillar} icon={icon} size={size} title={title} />
            )}
          </section>
        );
      })}

      {amenities && (
        <section className="rc-section">
          <h3>Nearby amenities</h3>
          <p className="rc-sub">{amenities.basis}</p>
          {amenities.unavailable ? (
            <div className="rc-card out">
              <span className="rc-chip">Not available</span>
              <p className="rc-headline">No data</p>
              <p className="rc-detail">{amenities.unavailable}</p>
            </div>
          ) : (
            <div className="rc-card tall">
              <p className="rc-headline">
                {items.filter((i) => i.miles <= 0.5).length} amenities within 0.5 mi
              </p>
              <p className="rc-detail">{amenities.detail}</p>
              <div className="rc-amenities">
                {columns.map((col, i) => (
                  <ul key={i}>
                    {col.map((it) => (
                      <li key={it.name}>
                        <span className="a-name">
                          {it.icon} {it.name}
                        </span>
                        <span className="a-dist">{it.miles < 0.05 ? "<0.1" : it.miles.toFixed(1)} mi</span>
                        <span className="a-note">{it.note}</span>
                      </li>
                    ))}
                  </ul>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      </div>

      {!phone && mapSection}

      {/* Node 2113:469: the listing itself, parked at the foot of the screen.
          Everything above is about it, and by the third card its address has
          long since scrolled away. */}
      {phone && (
        <div className="rc-bar">
          <div className="rc-bar-id">
            <div className="rc-bar-addr">{withoutState(check.listing.address)}</div>
            <p className="rc-bar-rent">
              {check.listing.rent ? (
                <>
                  <b>${check.listing.rent.toLocaleString()}</b> / mo
                </>
              ) : (
                "No rent given"
              )}
            </p>
          </div>
          {onAddListing && (
            <button className="rc-bar-add" onClick={onAddListing} disabled={slotsFull}>
              {slotsFull ? "Slots full" : "Add listing"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
