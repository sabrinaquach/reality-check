import { useState } from "react";
import { icons } from "./icons.ts";
import { ZoneMap, type MapListing } from "./ZoneMap.tsx";
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
 * The design writes one sentence across the pillars. Composed here rather than
 * in the engine because it is presentation: the engine's own `summary` stays
 * the single source for the verdict at the end.
 */
function headline(check: RealityCheck): string {
  const get = (k: Pillar["key"]) => check.pillars.find((p) => p.key === k);
  const commute = get("commute");
  const safety = get("safety");
  const cost = get("cost");

  const parts: string[] = [];
  if (commute && !commute.unavailable) parts.push(commute.headline.toLowerCase());
  if (safety && !safety.unavailable) parts.push(`${safety.band} safety`);
  if (cost && !cost.unavailable && check.listing.rent) {
    parts.push(`rent of $${check.listing.rent.toLocaleString()}/mo`);
  }

  const verdict = check.summary.split(" — ")[0]!.toLowerCase().replace(/\.$/, "");
  if (!parts.length) return check.summary;
  const last = parts.pop()!;
  const list = parts.length ? `${parts.join(", ")}, and ${last}` : last;
  return `${list[0]!.toUpperCase()}${list.slice(1)} — ${verdict}.`;
}

/**
 * The cost pillar reports the tract median even with no rent to compare it to,
 * so rather than a dead "not available" card it offers the missing input. The
 * rescore hits the Census only -- the other three pillars are untouched.
 */
function RentPrompt({
  pillar,
  busy,
  onSubmit,
}: {
  pillar: Pillar;
  busy: boolean;
  onSubmit: (rent: number) => void;
}) {
  const [rent, setRent] = useState("");
  const value = Number(rent);
  const ready = Number.isFinite(value) && value > 0 && !busy;

  return (
    <div className="rc-card">
      <span className="rc-chip">Needs a rent</span>
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

type ModeTime = { mode: "driving" | "transit" | "walking" | "bicycling"; minutes: number; miles: number };

/** Exported from the Figma file, same set and stroke weight as the rest. */
const MODE_LABEL: Record<ModeTime["mode"], { icon: string | null; label: string }> = {
  driving: { icon: null, label: "Driving" },
  transit: { icon: icons.modeTransit, label: "Transit" },
  bicycling: { icon: icons.modeBicycling, label: "Cycling" },
  walking: { icon: icons.modeWalking, label: "Walking" },
};

/**
 * The commute card opens to show the trip by the modes the headline does not
 * already cover -- driving is the headline, so repeating it here would just
 * restate the line above.
 *
 * These are extra API calls, so nothing is fetched until the card is actually
 * opened.
 *
 * No rideshare row: Uber and Lyft publish no ETA or fare API without a partner
 * account. Deriving one from the drive time would sit in this list looking
 * exactly as measured as the rows either side of it, so there is none.
 */
function CommuteCard({
  pillar,
  at,
  to,
  icon,
  size,
}: {
  pillar: Pillar;
  at: { lat: number; lng: number };
  to: string;
  icon: string;
  size: number;
}) {
  const [open, setOpen] = useState(false);
  const [modes, setModes] = useState<ModeTime[] | null>(null);
  const [loading, setLoading] = useState(false);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (!next || modes || !to) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/commute?lat=${at.lat}&lng=${at.lng}&to=${encodeURIComponent(to)}`);
      const body = await res.json();
      setModes(body.modes ?? []);
    } catch {
      setModes([]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={open ? "rc-card open" : "rc-card"}>
      <div className="rc-head">
        <span className={`rc-chip ${pillar.band}`}>{BAND_LABEL[pillar.band]}</span>
        <p className="rc-headline">{pillar.headline}</p>
        <p className="rc-detail">{pillar.detail}</p>
        <img className="rc-icon" src={icon} alt="" style={{ width: size, height: size, right: 65 - size }} />
      </div>
      <button
        className="rc-chev"
        onClick={toggle}
        aria-expanded={open}
        aria-label={open ? "Hide other travel modes" : "Show other travel modes"}
        title={open ? "Hide other ways to travel" : "Other ways to travel"}
      >
        <img src={icons.chevron} alt="" />
      </button>

      {open && (
        <div className="rc-modes">
          <p className="rc-modes-head">Other ways to make this trip</p>
          {loading && <p className="rc-detail">Routing the other modes…</p>}
          {modes?.length === 0 && !loading && (
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
      )}
    </div>
  );
}

function PillarCard({ pillar, icon, size }: { pillar: Pillar; icon: string; size: number }) {
  if (pillar.unavailable) {
    return (
      <div className="rc-card out">
        <div className="rc-head">
          <span className="rc-chip">Not available</span>
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
  saved,
  onToggleSave,
  onRent,
  listings = [],
  onCheck,
  onAdd,
  slotsFull,
}: {
  check: RealityCheck;
  onBack: () => void;
  saved: boolean;
  onToggleSave: () => void;
  /** Fill in a missing rent and rescore just the cost pillar. */
  onRent?: (rent: number) => Promise<void> | void;
  listings?: MapListing[];
  onCheck?: (address: string) => void;
  onAdd?: (address: string) => void;
  slotsFull?: boolean;
}) {
  const [pricing, setPricing] = useState(false);
  const amenities = check.pillars.find((p) => p.key === "amenities");
  const items = amenities?.items ?? [];
  const half = Math.ceil(items.length / 2);
  const columns = [items.slice(0, half), items.slice(half)];

  return (
    <div className="rc">
      <div className="rc-top">
        <button className="circle" onClick={onBack} aria-label="Back to comparison">
          <img className="ring" src={icons.circleBtn} alt="" />
          <img className="glyph" src={icons.back} alt="" style={{ width: 24, height: 24 }} />
        </button>
        <span className="spacer" />
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
      </div>

      <h1>Reality check</h1>

      <div className="rc-meta">
        <span>{check.listing.address}</span>
        <img className="rc-dot" src={icons.dot} alt="" />
        <span>{check.listing.rent ? `$${check.listing.rent.toLocaleString()} / mo` : "No rent given"}</span>
        {check.score !== null && (
          <span className={`rc-score ${check.band ?? ""}`}>{check.score}% score</span>
        )}
      </div>

      <p className="rc-summary">{headline(check)}</p>

      {SECTIONS.map(({ key, title, icon, size }) => {
        const pillar = check.pillars.find((p) => p.key === key);
        if (!pillar) return null;
        // Missing rent is a gap the reader can close, unlike a missing key.
        const needsRent =
          key === "cost" && onRent && pillar.unavailable?.includes("No listed rent");
        return (
          <section className="rc-section" key={key}>
            <h3>{title}</h3>
            <p className="rc-sub">{pillar.basis}</p>
            {key === "commute" && !pillar.unavailable ? (
              <CommuteCard
                pillar={pillar}
                at={{ lat: check.listing.lat, lng: check.listing.lng }}
                to={check.commuteTo}
                icon={icon}
                size={size}
              />
            ) : needsRent ? (
              <RentPrompt
                pillar={pillar}
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
              <PillarCard pillar={pillar} icon={icon} size={size} />
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

      <section className="rc-section">
        <h2>Commute &amp; safety zone</h2>
        <ZoneMap
          center={{ lat: check.listing.lat, lng: check.listing.lng }}
          route={check.pillars.find((p) => p.key === "commute")?.route}
          height={404}
          listings={listings}
          onCheck={onCheck}
          onAdd={onAdd}
          slotsFull={slotsFull}
        />
      </section>
    </div>
  );
}
