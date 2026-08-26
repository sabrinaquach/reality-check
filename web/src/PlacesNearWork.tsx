import { useCallback, useEffect, useState } from "react";
import { useRail } from "./useRail.ts";
import { icons } from "./icons.ts";

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
        <div>
          <h2>Places near your work</h2>
          <p className="sub">Rentals listed within two miles of {work || "your workplace"}.</p>
        </div>
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
      </div>

      {listings.length > 0 ? (
        <>
          <div className="rail" ref={rail.ref}>
            {listings.map((l) => (
              <div className="spot" key={l.address}>
                <div className="addr">{l.address.replace(/, (CA|USA)\b.*$/, "")}</div>
                <p className="why">
                  {[
                    l.beds !== null ? (l.beds === 0 ? "Studio" : `${l.beds} bed`) : null,
                    l.baths !== null ? `${l.baths} bath` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ") || "Listed rental"}
                </p>
                <p className="metric">
                  <b>{l.rent ? `$${l.rent.toLocaleString()}` : "No price"}</b>
                  <span>{l.rent ? " / mo" : ""}</span>
                </p>
                <button
                  className="zone-check spot-check"
                  onClick={() => onCheck(l.address, l.rent ? String(l.rent) : "")}
                >
                  Check
                </button>
              </div>
            ))}
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
