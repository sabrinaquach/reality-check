import { useRail } from "./useRail.ts";
import { icons } from "./icons.ts";
import { Coverage } from "./Coverage.tsx";
import { beginCardDrag } from "./touchDrag.ts";
import { pretty } from "./address.ts";
import type { Band } from "./types.ts";

export type QuietSpot = {
  address: string;
  lat: number;
  lng: number;
  score: number;
  band: Band;
  miles: number;
  /** Supplied by the engine: a block is not an address until it says where. */
  city: string;
};

export function QuietNearby({
  work,
  spots,
  loading,
  error,
  onCheck,
  cities,
}: {
  work: string;
  spots: QuietSpot[] | null;
  loading: boolean;
  error: string | null;
  /**
   * Open this block's own reality check. Clicking used to drop the address
   * into the sidebar form, which left the reader to press a second button to
   * get the thing they had already asked for.
   */
  onCheck: (address: string) => void;
  /** The cities safety covers, named under the rail. */
  cities: string[];
}) {
  const rail = useRail(spots?.length ?? 0);
  const has = spots && spots.length > 0;

  return (
    <section>
      <div className="section-head">
        <h2>Safest neighborhoods nearby</h2>
        {has && (
          <div className="carousel-nav">
            <button onClick={() => rail.scroll(-1)} disabled={rail.atStart} aria-label="Scroll left">
              <img className="ring" src={icons.circleRing} alt="" />
              <img className="glyph glyph-prev" src={icons.arrowLeft} alt="" />
            </button>
            <button onClick={() => rail.scroll(1)} disabled={rail.atEnd} aria-label="Scroll right">
              <img className="ring" src={icons.circleRing} alt="" />
              <img className="glyph glyph-next" src={icons.arrowRight} alt="" />
            </button>
          </div>
        )}
        <p className="sub">
          Quietest blocks in the police data, within four miles of {work || "your workplace"}.
        </p>
      </div>

      {loading && <p className="note">Reading the block index…</p>}
      {error && <p className="form-error">{error}</p>}

      {spots && spots.length === 0 && (
        <div className="empty">
          <strong>Nothing to show here</strong>
          No indexed blocks within four miles of {work}. Safety is scored per city, from that
          city’s own police data.
        </div>
      )}

      {has && (
        <div className="rail" ref={rail.ref}>
          {spots.map((s) => {
            const full = `${pretty(s.address)}, ${s.city}`;
            return (
              <div
                className="spot"
                key={s.address}
                role="button"
                tabIndex={0}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData("text/plain", full);
                  e.dataTransfer.effectAllowed = "copy";
                  e.currentTarget.classList.add("dragging");
                }}
                onDragEnd={(e) => e.currentTarget.classList.remove("dragging")}
                onPointerDown={(e) => beginCardDrag(e, { address: full, label: pretty(s.address) })}
                title={`Reality check ${pretty(s.address)}, or drag it into a slot`}
                onClick={() => onCheck(full)}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onCheck(full)}
              >
                <img className="handle" src={icons.drag} alt="" />
                <div className="addr">{pretty(s.address)}</div>
                <p className="why">
                  Quieter than most blocks we have data for, {s.miles.toFixed(1)} mi from your work.
                </p>
                <p className="metric">
                  <b className={s.band}>{s.score}</b>
                  <span> / 100 safety</span>
                </p>
              </div>
            );
          })}
        </div>
      )}

      <Coverage cities={cities} />
    </section>
  );
}
