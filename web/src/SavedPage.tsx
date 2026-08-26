import { icons } from "./icons.ts";
import type { RealityCheck } from "./types.ts";

/**
 * Figma node 2169:7396 — a saved listing is a rounded grey bar: address and
 * rent on the left, a white "Add listing" pill on the right that drops it into
 * the comparison.
 *
 * The design shows no remove control, so the heart on a listing's reality
 * check stays the canonical way to unsave. One is offered here on hover as
 * well, since otherwise removing means opening each listing first.
 */
export function SavedPage({
  saved,
  slotsFull,
  onOpen,
  onAdd,
  onRemove,
  onBrowse,
}: {
  saved: RealityCheck[];
  slotsFull: boolean;
  onOpen: (check: RealityCheck) => void;
  onAdd: (check: RealityCheck) => void;
  onRemove: (check: RealityCheck) => void;
  onBrowse: () => void;
}) {
  return (
    <div className="rc">
      <h1>Saved</h1>
      <p className="rc-sub" style={{ marginBottom: 32 }}>
        {saved.length
          ? `${saved.length} listing${saved.length === 1 ? "" : "s"} you've kept. Stored in this browser.`
          : "Nothing saved yet."}
      </p>

      {saved.length === 0 ? (
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
        <div className="saved-grid">
          {saved.map((check) => (
            <div className="saved-card" key={check.listing.address}>
              <button className="saved-open" onClick={() => onOpen(check)}>
                <span className="saved-addr">{check.listing.address}</span>
                <span className="saved-meta">
                  {check.listing.rent ? `$${check.listing.rent.toLocaleString()} / mo` : "No rent given"}
                </span>
                <span className="saved-line">{check.summary}</span>
                {check.score !== null && (
                  <span className={`rc-score ${check.band ?? ""}`}>{check.score}% score</span>
                )}
              </button>
              <div className="saved-actions">
                <button className="saved-add" onClick={() => onAdd(check)} disabled={slotsFull}>
                  Add to comparison
                </button>
              </div>
              <button
                className="saved-heart"
                onClick={() => onRemove(check)}
                aria-label={`Remove ${check.listing.address} from saved`}
                title="Remove from saved"
              >
                <img src={icons.heart} alt="" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
