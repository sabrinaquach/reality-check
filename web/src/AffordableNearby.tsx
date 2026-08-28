import { useRail } from "./useRail.ts";
import { icons } from "./icons.ts";
import { beginCardDrag } from "./touchDrag.ts";
import { pretty } from "./address.ts";

/**
 * The cheapest neighbourhoods near the workplace.
 *
 * The third pillar's rail. Commute has the map and safety has its block list;
 * cost had nothing on this page, which left the thing people filter hardest on
 * as the one the board could not help them explore.
 *
 * Each card leads with a street rather than a price, because a street is the
 * thing you can act on: the engine anchors every area to the nearest block the
 * safety index already knows, so the address exists, geocodes, and can be
 * dropped into a slot or opened like any other.
 *
 * What it is not is a listing. The rent underneath is the area's median, not
 * this address's asking price -- so the card says "typical around here", and
 * the footnote says what a median counts.
 */

export type AffordableArea = {
  /** A real block address standing in for the area. */
  address: string;
  city: string;
  tract: string;
  rent: number;
  miles: number;
  direction: string;
  year: number;
};

export type AffordableResult = {
  areas: AffordableArea[];
  typical: number | null;
  year: number | null;
  unavailable?: string;
};

export function AffordableNearby({
  work,
  result,
  loading,
  error,
  onCheck,
}: {
  work: string;
  result: AffordableResult | null;
  loading: boolean;
  error: string | null;
  /** Open a reality check for the street standing in for this area. */
  onCheck: (address: string) => void;
}) {
  /**
   * An area without a street cannot be opened or dragged, so it is not shown.
   * Guarding the shape rather than trusting it: an API process still running
   * an older build returns rows with no address, and one missing field should
   * cost a card, not the page.
   */
  const areas = (result?.areas ?? []).filter((a) => !!a.address);
  const rail = useRail(areas.length);

  return (
    <section>
      <div className="section-head">
        <h2>Cheaper areas nearby</h2>
        {areas.length > 0 && (
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
          {result?.typical
            ? `Where rents run below the $${result.typical.toLocaleString()}/mo typical of ${work || "your area"}.`
            : "Where rents run below the local norm."}
        </p>
      </div>

      {loading && <p className="note">Reading Census rents…</p>}
      {error && <p className="form-error">{error}</p>}

      {result?.unavailable && !loading && (
        <div className="empty">
          <strong>No rent figures here</strong>
          {result.unavailable}
        </div>
      )}

      {areas.length > 0 && (
        <>
          <div className="rail" ref={rail.ref}>
            {areas.map((a) => {
              const full = `${pretty(a.address)}, ${a.city}`;
              return (
                <div
                  className="spot"
                  key={a.tract}
                  role="button"
                  tabIndex={0}
                  draggable
                  title={`Reality check ${pretty(a.address)}, or drag it into a slot`}
                  onDragStart={(e) => {
                    e.dataTransfer.setData("text/plain", full);
                    e.dataTransfer.effectAllowed = "copy";
                    e.currentTarget.classList.add("dragging");
                  }}
                  onDragEnd={(e) => e.currentTarget.classList.remove("dragging")}
                  onPointerDown={(e) => beginCardDrag(e, { address: full, label: pretty(a.address) })}
                  onClick={() => onCheck(full)}
                  onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onCheck(full)}
                >
                  <img className="handle" src={icons.drag} alt="" />
                  <div className="addr">{pretty(a.address)}</div>
                  <p className="why">
                    Rents here run about ${a.rent.toLocaleString()}/mo, well under the{" "}
                    {result?.typical ? `$${result.typical.toLocaleString()}` : "local"} typical.
                  </p>
                  <p className="metric">
                    <b>${a.rent.toLocaleString()}</b>
                    <span> / mo typical</span>
                  </p>
                </div>
              );
            })}
          </div>
          {/* The caveat belongs with the numbers, not buried on another page:
              a median covers leases signed years ago, and a tract this cheap is
              usually cheap for a reason worth knowing before you go looking. */}
          <p className="note" style={{ marginTop: 10 }}>
            Median rent per Census tract, ACS {result?.year} five-year estimate. It counts every
            lease being paid now, including long-standing ones, so today's listings ask more — and
            an unusually low figure often means subsidised or student housing rather than a bargain.
          </p>
        </>
      )}
    </section>
  );
}
