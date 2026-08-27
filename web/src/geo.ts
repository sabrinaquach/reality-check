/**
 * Straight-line distance, for cards that already hold both sets of
 * coordinates.
 *
 * The engine has its own `milesBetween`, but web/src imports only types from
 * ../spike so nothing server-side reaches the browser bundle. Ten lines of
 * haversine is a smaller price than a round trip for arithmetic the page is
 * already holding both ends of.
 */
const EARTH_MILES = 3958.8;

export function milesBetween(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_MILES * Math.asin(Math.sqrt(h));
}
