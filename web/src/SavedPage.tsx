import type { ReactNode } from "react";
import { icons } from "./icons.ts";
import { withoutState } from "./address.ts";
import { ScoreRing } from "./ScoreRing.tsx";
import { ZoneMap, type MapListing } from "./ZoneMap.tsx";
import type { RealityCheck } from "./types.ts";

/**
 * Figma node 2130:4433 — "saved".
 *
 * A ranked column of saved listings beside the same commute-and-safety map the
 * board carries. The ranking is the point of the screen: the subtitle promises
 * an order, so the list is sorted rather than left in the order things were
 * saved, and the leader is called out.
 */

export function SavedPage({
  saved,
  pairFull,
  onOpen,
  onToggleCompare,
  inComparison,
  onRemove,
  onBrowse,
  detail,
  openKey,
  at,
  listings = [],
  onCheck,
  onAdd,
}: {
  saved: RealityCheck[];
  /** Both comparison places on this page are taken. Not the board's slots. */
  pairFull: boolean;
  onOpen: (check: RealityCheck) => void;
  /** Put this listing in a comparison slot, or take it back out. */
  onToggleCompare: (check: RealityCheck) => void;
  inComparison: (check: RealityCheck) => boolean;
  onRemove: (check: RealityCheck) => void;
  onBrowse: () => void;
  /**
   * The opened listing's reality check, rendered in the right column in place
   * of the map (Figma node 2135:5355). Composed by the caller so this screen
   * does not have to carry every prop the reality check needs.
   */
  detail?: ReactNode;
  /** Lowercased address of the opened listing, so its card can show as open. */
  openKey?: string | null;
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
            const picked = inComparison(check);
            const open = openKey === check.listing.address.trim().toLowerCase();
            /**
             * Once both comparison slots are full the two chosen listings are
             * the subject of the whole right-hand column, so everything else
             * steps back rather than competing with them (Figma 2135:4846).
             */
            const dim = pairFull && !picked && !open;
            /**
             * `on` is the recessed look, worn by whichever card the right-hand
             * column is about. `picked` is narrower: only a card actually in a
             * comparison slot gives up its radio.
             *
             * Conflating the two made comparing impossible with two saved
             * listings -- opening one hid its radio, picking the other hid
             * that one, and there was nothing left to click.
             */
            const state = [picked ? "picked" : "", picked || open ? "on" : "", dim ? "dim" : ""]
              .filter(Boolean)
              .join(" ");
            return (
              <div className={`saved-card${state ? " " + state : ""}`} key={check.listing.address}>
                {/* The design's circle on the left edge. It is the comparison
                    slot: filled when this listing is in one, which is the only
                    honest thing a control shaped like a radio can mean. */}
                <button
                  className={picked ? "saved-pick on" : "saved-pick"}
                  onClick={() => onToggleCompare(check)}
                  aria-pressed={picked}
                  title={
                    picked
                      ? "Remove from the comparison"
                      : pairFull
                        ? "Compare this instead of the earlier pick"
                        : "Add to the comparison"
                  }
                  aria-label={`${picked ? "Remove" : "Add"} ${withoutState(check.listing.address)} ${picked ? "from" : "to"} the comparison`}
                />

                <button className="saved-open" onClick={() => onOpen(check)}>
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
      {detail ?? (
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
