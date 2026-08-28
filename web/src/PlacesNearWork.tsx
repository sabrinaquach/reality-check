import { useCallback, useEffect, useState } from "react";
import { useRail } from "./useRail.ts";
import { icons } from "./icons.ts";
import { beginCardDrag } from "./touchDrag.ts";
import { street } from "./address.ts";
import { milesBetween } from "./geo.ts";

export type Rental = {
  address: string;
  rent: number | null;
  beds: number | null;
  baths: number | null;
  lat: number;
  lng: number;
};

type Result = { listings: Rental[]; cached: boolean; used: number; cap: number; unavailable?: string };

/**
 * Rentals near the workplace, from RentCast.
 *
 * The free tier is small, so a page load only ever reads the disk cache. A
 * real request happens when someone asks for one, and the remaining budget is
 * shown rather than hidden -- if this is going to cost something, the person
 * spending it should be able to see the meter.
 */
export function PlacesNearWork({
  work,
  at,
  onCheck,
}: {
  work: string;
  at: { lat: number; lng: number } | null;
  onCheck: (address: string, rent: string) => void;
}) {
  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);
  const rail = useRail(result?.listings.length ?? 0);

  /**
   * The whole card is the control. A listing card has exactly one thing anyone
   * wants from it -- the reality check -- so a separate button was a second
   * target for the same intent, and a small one at that. The rent rides along
   * so the cost pillar scores immediately instead of asking for it.
   */
  const open = (l: Rental) => onCheck(l.address, l.rent ? String(l.rent) : "");

  /**
   * Dropping a listing into a slot should not throw away its price.
   *
   * The address goes on text/plain so the payload stays something any drop
   * target can read, and the rent rides on a private type beside it. A browser
   * that refuses the custom type simply drops an address, which is what this
   * did before -- the cost pillar then asks for the rent on the result page.
   */
  const RENT_TYPE = "application/x-reality-check-rent";

  const fetchRentals = useCallback(
    async (live: boolean) => {
      if (!at) return;
      setLoading(true);
      try {
        const res = await fetch(`/api/rentals?lat=${at.lat}&lng=${at.lng}${live ? "&live=1" : ""}`);
        setResult((await res.json()) as Result);
      } catch {
        setResult(null);
      } finally {
        setLoading(false);
      }
    },
    [at],
  );

  // Cache only. Never spends.
  useEffect(() => {
    void fetchRentals(false);
  }, [fetchRentals]);

  const listings = result?.listings ?? [];
  const budget = result ? `${result.used} of ${result.cap} monthly lookups used` : null;
  const noKey = result?.unavailable?.includes("RENTCAST_API_KEY");

  return (
    <section>
      <div className="section-head">
        <h2>Places near your work</h2>
        {listings.length > 0 && (
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
        <p className="sub">Rentals listed within two miles of {work || "your workplace"}.</p>
      </div>

      {listings.length > 0 ? (
        <>
          <div className="rail" ref={rail.ref}>
            {listings.map((l) => {
              return (
              <div
                className="spot"
                key={l.address}
                role="button"
                tabIndex={0}
                draggable
                title={`Reality check ${street(l.address)}, or drag it into a slot`}
                onDragStart={(e) => {
                  e.dataTransfer.setData("text/plain", l.address);
                  if (l.rent) e.dataTransfer.setData(RENT_TYPE, String(l.rent));
                  e.dataTransfer.effectAllowed = "copy";
                  e.currentTarget.classList.add("dragging");
                }}
                onDragEnd={(e) => e.currentTarget.classList.remove("dragging")}
                onPointerDown={(e) =>
                  beginCardDrag(e, {
                    address: l.address,
                    rent: l.rent ? String(l.rent) : undefined,
                    label: street(l.address),
                  })
                }
                onClick={() => open(l)}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && open(l)}
              >
                <img className="handle" src={icons.drag} alt="" />
                <div className="addr">{street(l.address)}</div>
                <p className="why">
                  {at
                    ? `${milesBetween(at, l).toFixed(1)} mi from your work.`
                    : "Listed rental near your work."}
                </p>
                <p className="metric">
                  <b>{l.rent ? `$${l.rent.toLocaleString()}` : "No price"}</b>
                  <span>{l.rent ? " / mo" : ""}</span>
                </p>
              </div>
              );
            })}
          </div>
          <p className="note" style={{ marginTop: 10 }}>
            {result?.cached ? "From cache — no lookup spent. " : "Fresh lookup. "}
            {budget}.{" "}
            <button className="linky" onClick={() => fetchRentals(true)} disabled={loading}>
              {loading ? "Refreshing…" : "Refresh listings"}
            </button>
          </p>
        </>
      ) : (
        <div className="empty">
          <strong>{noKey ? "No RentCast key" : "No listings loaded"}</strong>
          {noKey ? (
            <>
              Add <code>RENTCAST_API_KEY</code> to <code>spike/.env</code> to show rentals here.
            </>
          ) : (
            <>
              Loading these costs one lookup from a small monthly allowance, so it doesn't happen
              automatically. {budget ? `${budget}.` : ""}
              <div style={{ marginTop: 14 }}>
                <button
                  className="btn"
                  style={{ width: 260 }}
                  onClick={() => fetchRentals(true)}
                  disabled={loading || !at}
                >
                  {loading ? "Looking…" : "Find rentals near your work"}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
