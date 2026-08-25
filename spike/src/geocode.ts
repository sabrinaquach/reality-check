import type { LatLng } from "./types.ts";

const CENSUS = "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress";

/**
 * Census first: it is free, needs no key, and handles the plain
 * "300 E SANTA CLARA ST" form that SJPD block addresses come in.
 * It misses named places ("1 Washington Square"), so Google covers those.
 */
export async function geocode(address: string): Promise<LatLng | null> {
  const viaCensus = await censusGeocode(address);
  if (viaCensus) return viaCensus;
  return googleGeocode(address);
}

export async function censusGeocode(address: string): Promise<LatLng | null> {
  const url = `${CENSUS}?${new URLSearchParams({
    address,
    benchmark: "Public_AR_Current",
    format: "json",
  })}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return null;
    const body = (await res.json()) as any;
    const match = body?.result?.addressMatches?.[0];
    if (!match) return null;
    return { lat: match.coordinates.y, lng: match.coordinates.x };
  } catch {
    return null;
  }
}

export async function googleGeocode(address: string): Promise<LatLng | null> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return null;
  const url = `https://maps.googleapis.com/maps/api/geocode/json?${new URLSearchParams(
    { address, key },
  )}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    const body = (await res.json()) as any;
    const loc = body?.results?.[0]?.geometry?.location;
    if (!loc) return null;
    return { lat: loc.lat, lng: loc.lng };
  } catch {
    return null;
  }
}

/** Great-circle distance in miles. */
export function milesBetween(a: LatLng, b: LatLng): number {
  const R = 3958.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
