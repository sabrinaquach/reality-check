import { bandFor } from "../bands.ts";
import { milesBetween } from "../geocode.ts";
import type { LatLng, Pillar } from "../types.ts";

const NEARBY = "https://places.googleapis.com/v1/places:searchNearby";

/**
 * What actually changes daily life is how far the errands are, not how many
 * coffee shops exist. So each category scores on the distance to its NEAREST
 * option, and groceries and transit count for more than a gym.
 */
const CATEGORIES = [
  { key: "groceries", label: "groceries", icon: "\u{1F6D2}", weight: 2, types: ["supermarket", "grocery_store"] },
  { key: "transit", label: "transit", icon: "\u{1F689}", weight: 1.5, types: ["transit_station", "light_rail_station", "bus_station"] },
  { key: "food", label: "food", icon: "\u{1F374}", weight: 1, types: ["restaurant", "cafe"] },
  { key: "parks", label: "a park", icon: "\u{1F333}", weight: 1, types: ["park"] },
  { key: "pharmacy", label: "the pharmacy", icon: "\u{1F48A}", weight: 1, types: ["pharmacy", "drugstore"] },
  { key: "gym", label: "the gym", icon: "\u{1F3CB}\u{FE0F}", weight: 0.5, types: ["gym", "fitness_center"] },
] as const;

/** A quarter mile is a stroll, half a mile a walk; past that you drive. */
function howFar(miles: number, label: string): string {
  if (miles <= 0.25) return `A couple of minutes on foot for ${label}.`;
  if (miles <= 0.5) return `A short walk for ${label}.`;
  if (miles <= 1) return `Walkable for ${label}, or a two-minute drive.`;
  return `A short drive for ${label}.`;
}

const SEARCH_RADIUS_M = 3_200; // ~2 mi, the distance where the score bottoms out

/** A quarter mile is a walk; two miles is a drive you make anyway. */
export function proximityScore(miles: number): number {
  if (miles <= 0.25) return 100;
  if (miles >= 2) return 0;
  return Math.round(100 - ((miles - 0.25) / 1.75) * 100);
}

async function nearest(
  at: LatLng,
  types: readonly string[],
  key: string,
): Promise<{ miles: number; name: string } | null> {
  try {
    const res = await fetch(NEARBY, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": "places.displayName,places.location",
      },
      body: JSON.stringify({
        includedTypes: types,
        maxResultCount: 1,
        rankPreference: "DISTANCE",
        locationRestriction: {
          circle: { center: { latitude: at.lat, longitude: at.lng }, radius: SEARCH_RADIUS_M },
        },
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as any;
    const place = body?.places?.[0];
    if (!place?.location) return null;
    return {
      miles: milesBetween(at, { lat: place.location.latitude, lng: place.location.longitude }),
      name: place.displayName?.text ?? "unnamed",
    };
  } catch {
    return null;
  }
}

export async function scoreAmenities(at: LatLng): Promise<Pillar> {
  const base: Pillar = {
    key: "amenities",
    score: 0,
    band: "moderate",
    headline: "",
    detail: "",
    basis: "Google Places, distance to the nearest of each kind",
  };

  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) {
    return {
      ...base,
      unavailable: "GOOGLE_MAPS_API_KEY is not set.",
      headline: "Unavailable",
      detail: "No Maps key, so nearby places could not be checked.",
    };
  }

  const found = await Promise.all(
    CATEGORIES.map(async (c) => ({ cat: c, hit: await nearest(at, c.types, key) })),
  );

  // Nothing at all within two miles is a real signal, but so is a dead API key.
  if (found.every(({ hit }) => hit === null)) {
    return {
      ...base,
      unavailable: "Places API returned nothing nearby.",
      headline: "Unavailable",
      detail: "No places came back for this location.",
    };
  }

  let weighted = 0;
  let total = 0;
  for (const { cat, hit } of found) {
    // A missing category is not a gap in the data -- it means nothing of that
    // kind is within two miles, which scores zero rather than being skipped.
    weighted += cat.weight * (hit ? proximityScore(hit.miles) : 0);
    total += cat.weight;
  }
  const score = Math.round(weighted / total);
  const band = bandFor(score);

  // Surface the per-category detail so a results view can list it rather than
  // re-querying Places for something we already paid for.
  const items = found
    .filter((f): f is { cat: (typeof CATEGORIES)[number]; hit: { miles: number; name: string } } => f.hit !== null)
    .sort((a, b) => a.hit.miles - b.hit.miles)
    .map(({ cat, hit }) => ({
      icon: cat.icon,
      name: hit.name,
      note: howFar(hit.miles, cat.label),
      miles: hit.miles,
    }));

  const grocery = found.find(({ cat }) => cat.key === "groceries")?.hit;
  const walkable = found.filter(({ hit }) => hit && hit.miles <= 0.5).length;
  const headline = grocery
    ? `${grocery.miles.toFixed(1)} mi to groceries`
    : "No grocery store within 2 mi";
  const detail =
    `${walkable} of ${CATEGORIES.length} daily errands within a half-mile walk` +
    (grocery ? ` (nearest market: ${grocery.name}).` : ".");

  return { ...base, score, band, headline, detail, items };
}
