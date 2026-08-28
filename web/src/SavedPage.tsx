import { useEffect, useState, type ReactNode } from "react";
import { icons } from "./icons.ts";
import { withoutState } from "./address.ts";
import { ScoreRing } from "./ScoreRing.tsx";
import { ZoneMap, type MapListing } from "./ZoneMap.tsx";
import { useMobile } from "./useMobile.ts";
import type { RealityCheck } from "./types.ts";

/**
 * Figma node 2130:4433 — "saved".
 *
 * A ranked column of saved listings beside the same commute-and-safety map the
 * board carries. The ranking is the point of the screen: the subtitle promises
 * an order, so the list is sorted rather than left in the order things were
 * saved, and the leader is called out.
 *
 * Clicking a card is the only interaction: it selects that listing, which
 * fills the right-hand column with its reality check. Selecting a second
 * compares the two, clicking a selected card again puts it back, and a third
 * rolls the older of the pair out. Opening and comparing used to be two
 * separate gestures -- the card body and a radio beside it -- which meant two
 * ways to fill one column and a card that could be "open" and "picked" at the
 * same time, wearing the same recessed look for two different reasons.
 */

export function SavedPage({
  saved,
  pairFull,
  onSelect,
  isSelected,
  onRemove,
  onBrowse,
  detail,
  at,
  listings = [],
  onCheck,
  onAdd,
}: {
  saved: RealityCheck[];
  /** Both comparison places on this page are taken. Not the board's slots. */
  pairFull: boolean;
  /**
   * Select this listing, or take the selection back off it. One click is the
   * whole interaction on this screen: selecting one listing shows its reality
   * check, selecting a second compares the two, and clicking a selected card
   * again puts it back.
   */
  onSelect: (check: RealityCheck) => void;
  isSelected: (check: RealityCheck) => boolean;
  onRemove: (check: RealityCheck) => void;
  onBrowse: () => void;
  /**
   * What the selection is showing: one listing's reality check, or the
   * side-by-side breakdown of two (Figma node 2135:5355). Rendered in the
   * right column in place of the map, and composed by the caller so this
   * screen does not have to carry every prop those pages need.
   */
  detail?: ReactNode;
  /** Where to centre the map: the workplace, as on the board. */
  at: { lat: number; lng: number } | null;
  listings?: MapListing[];
  onCheck?: (address: string) => void;
  onAdd?: (address: string) => void;
}) {
  /**
   * Best first. The composite already weighs commute, safety and cost by
   * whatever the renter said they cared about, so ranking on it is exactly the
   * promise the subtitle makes. Anything too sparse to score sits at the
   * bottom rather than being dropped -- it is still saved.
   */
  const ranked = [...saved].sort((a, b) => (b.score ?? -1) - (a.score ?? -1));

  /**
   * On the desktop what a selection does is visible while you do it: the
   * column beside the list fills in, and a second selection turns it into the
   * breakdown. On a phone there is no column -- a selection leaves this screen
   * for the page it opens -- so the screen has to say so beforehand.
   */
  const mobile = useMobile();

  return (
    <div className="saved">
      <div className="saved-list">
        {/* Title and subtitle are one block, so the list's own card spacing
            cannot get between them. */}
        <div className="saved-head">
          <h1>Saved</h1>
          <p className="saved-sub">
            {saved.length ? "Ranked by commute, safety, and cost." : "Nothing saved yet."}
          </p>
          {mobile && saved.length > 0 && (
            <p className="saved-how">
              Tap one for its reality check, or two to compare them side by side.
            </p>
          )}
        </div>

        {ranked.length === 0 ? (
          <div className="empty">
            <strong>No saved listings</strong>
            Check a listing, then tap the heart on its reality check to keep it here.
            <div style={{ marginTop: 16 }}>
              <button className="btn" style={{ width: 220 }} onClick={onBrowse}>
                Check a listing
              </button>
            </div>
          </div>
        ) : (
          ranked.map((check, i) => {
            const selected = isSelected(check);
            /**
             * Once both places are taken the two selected listings are the
             * subject of the whole right-hand column, so everything else steps
             * back rather than competing with them (Figma 2135:4846).
             */
            const dim = pairFull && !selected;
            /**
             * Node 2136:7321: a selected card is recessed and drops its circle,
             * with the text and the ring shifted into that lane. Selecting and
             * unselecting are both a click on the card itself, so the circle is
             * free to go -- see .saved-card.no-pick.
             */
            const state = [selected ? "on no-pick" : "", dim ? "dim" : ""]
              .filter(Boolean)
              .join(" ");
            return (
              <div className={`saved-card${state ? " " + state : ""}`} key={check.listing.address}>
                {/* The design's circle on the left edge: this listing's place
                    in the comparison, empty until it is selected. A redundant
                    hit target rather than a control of its own -- the card
                    behind it already toggles the selection -- so it is hidden
                    from assistive tech instead of announcing itself twice. */}
                {!selected && (
                  <button
                    className="saved-pick"
                    tabIndex={-1}
                    aria-hidden="true"
                    onClick={() => onSelect(check)}
                  />
                )}

                <button
                  className="saved-open"
                  onClick={() => onSelect(check)}
                  aria-pressed={selected}
                  title={
                    selected
                      ? "Unselect this listing"
                      : pairFull
                        ? "Compare this instead of the earlier selection"
                        : "Select this listing"
                  }
                >
                  <span className={i === 0 ? "saved-rank best" : "saved-rank"}>
                    {i === 0 ? "#1 Best match" : `#${i + 1}`}
                  </span>
                  <span className="saved-addr">{withoutState(check.listing.address)}</span>
                  <span className="saved-line">{check.summary}</span>
                  <span className="saved-rent">
                    {check.listing.rent ? (
                      <>
                        <b>${check.listing.rent.toLocaleString()}</b> / mo
                      </>
                    ) : (
                      "No rent given"
                    )}
                  </span>
                </button>

                <ScoreRing score={check.score} band={check.band} />

                {/* The design carries no remove control, but unsaving would
                    otherwise mean opening each listing to reach its heart. */}
                <button
                  className="saved-heart"
                  onClick={() => onRemove(check)}
                  aria-label={`Remove ${withoutState(check.listing.address)} from saved`}
                  title="Remove from saved"
                >
                  <img src={icons.heart} alt="" />
                </button>
              </div>
            );
          })
        )}
      </div>

      {/* Opening a listing swaps this column, so the ranking stays on screen and
          the reader can move between listings without losing their place. The
          map is what the column shows when nothing is open -- and the reality
          check carries its own copy of that map at the bottom anyway. */}
      {detail ? (
        <DetailPanel>{detail}</DetailPanel>
      ) : (
        <div className="saved-map">
          <h2>Commute &amp; safety zone</h2>
          <ZoneMap
            center={at}
            height={639}
            listings={listings}
            onCheck={onCheck}
            onAdd={onAdd}
          />
        </div>
      )}
    </div>
  );
}


/**
 * The right-hand column, with a control for giving it the whole window.
 *
 * A reality check and a two-up breakdown are both wider than the 730px this
 * column has beside the list, and the breakdown especially -- two cards, four
 * pillars, side by side in half the room the standalone page gives them. So
 * the panel borrows the map's expand: the same circular button in the same
 * corner, the same scrim, the same Escape, because it is the same gesture
 * applied to the other half of the screen.
 */
function DetailPanel({ children }: { children: ReactNode }) {
  const [expanded, setExpanded] = useState(false);

  // Escape closes it, and the page behind it should not scroll.
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setExpanded(false);
    document.addEventListener("keydown", onKey);
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [expanded]);

  return (
    <>
      {expanded && (
        <div className="zone-scrim" onClick={() => setExpanded(false)} role="presentation" />
      )}
      <div className={`saved-detail${expanded ? " expanded" : ""}`}>
        <button
          className="saved-expand"
          onClick={() => setExpanded((v) => !v)}
          aria-label={expanded ? "Shrink back to the column" : "Expand to fill the window"}
          title={expanded ? "Shrink (Esc)" : "Expand"}
          aria-expanded={expanded}
        >
          {/* Figma 2181:7598 expanded, 2181:7597 to come back. Each asset is
              the whole control, circle included, so the button behind it draws
              nothing of its own. */}
          <img src={expanded ? icons.panelMinimize : icons.panelExpand} alt="" />
        </button>
        {children}
      </div>
    </>
  );
}
