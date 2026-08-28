import { bandFor } from "../bands.ts";
import type { LatLng, Pillar, Route } from "../types.ts";

const DIRECTIONS = "https://maps.googleapis.com/maps/api/directions/json";

/**
 * A listing's commute is only meaningful at the hour you'd actually make it.
 * Google will happily quote a 12-minute 101 run at midnight, so we always ask
 * for the next weekday 8am departure with live traffic modelling -- that is
 * the number the renter will live with five days a week.
 */
export function nextWeekdayMorning(from = new Date()): Date {
  const d = new Date(from);
  d.setHours(8, 0, 0, 0);
  if (d <= from) d.setDate(d.getDate() + 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return d;
}

/**
 * 10 minutes is as good as it gets before the difference stops mattering;
 * an hour each way is where people start moving again. Linear in between.
 */
export function commuteScore(minutes: number): number {
  return Math.max(0, Math.min(100, Math.round(100 - (minutes - 10) * 2)));
}

type Leg = { minutes: number; miles: number; route?: Route };

export type TravelMode = "driving" | "transit" | "walking" | "bicycling";

async function directions(
  from: LatLng,
  to: string,
  mode: TravelMode,
  key: string,
): Promise<Leg | null> {
  const params: Record<string, string> = {
    origin: `${from.lat},${from.lng}`,
    destination: to,
    mode,
    departure_time: String(Math.floor(nextWeekdayMorning().getTime() / 1000)),
    key,
  };
  if (mode === "driving") params.traffic_model = "best_guess";
  try {
    const res = await fetch(`${DIRECTIONS}?${new URLSearchParams(params)}`, {
      signal: AbortSignal.timeout(20_000),
    });
    const body = (await res.json()) as any;
    const top = body?.routes?.[0];
    const leg = top?.legs?.[0];
    if (!leg) return null;
    // duration_in_traffic is only present for driving with a departure time.
    const seconds = leg.duration_in_traffic?.value ?? leg.duration?.value;
    if (!Number.isFinite(seconds)) return null;

    // The shape of the route comes back on the same response, so keeping it
    // costs nothing -- drawing the commute later would otherwise mean paying
    // for a second identical call.
    const line = top?.overview_polyline?.points;
    const b = top?.bounds;
    const route: Route | undefined =
      line && b
        ? {
            polyline: line,
            bounds: {
              north: b.northeast.lat,
              south: b.southwest.lat,
              east: b.northeast.lng,
              west: b.southwest.lng,
            },
          }
        : undefined;

    return { minutes: Math.round(seconds / 60), miles: (leg.distance?.value ?? 0) / 1609.34, route };
  } catch {
    return null;
  }
}

export type ModeTime = { mode: TravelMode; minutes: number; miles: number };

/**
 * The same trip by the modes the pillar does not already report.
 *
 * Driving is excluded by default: it is the number in the pillar's headline,
 * so listing it again says nothing and costs an extra call. Rideshare is
 * absent for a different reason -- Uber and Lyft have no public ETA or fare
 * API, and a made-up number is worse than no number.
 */
export async function commuteModes(
  at: LatLng,
  destination: string,
  modes: TravelMode[] = ["transit", "bicycling", "walking"],
): Promise<ModeTime[]> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key || !destination.trim()) return [];

  const legs = await Promise.all(modes.map((m) => directions(at, destination, m, key)));
  return modes
    .map((mode, i) => ({ mode, leg: legs[i] }))
    .filter((x): x is { mode: TravelMode; leg: Leg } => x.leg !== null)
    .map(({ mode, leg }) => ({ mode, minutes: leg.minutes, miles: leg.miles }));
}

export async function scoreCommute(at: LatLng, destination: string): Promise<Pillar> {
  const base: Pillar = {
    key: "commute",
    score: 0,
    band: "moderate",
    headline: "",
    detail: "",
    basis: "Google Directions, weekday 8am departure with traffic",
  };

  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) {
    return {
      ...base,
      unavailable: "GOOGLE_MAPS_API_KEY is not set.",
      headline: "Unavailable",
      detail: "No Maps key, so drive time could not be checked.",
    };
  }
  if (!destination.trim()) {
    return {
      ...base,
      unavailable: "No commute destination given.",
      headline: "Unavailable",
      detail: "Add a workplace to score the commute.",
    };
  }

  const [drive, transit] = await Promise.all([
    directions(at, destination, "driving", key),
    directions(at, destination, "transit", key),
  ]);

  if (!drive) {
    return {
      ...base,
      unavailable: "Directions API returned no route.",
      headline: "Unavailable",
      detail: `Could not route to "${destination}".`,
    };
  }

  const score = commuteScore(drive.minutes);
  const band = bandFor(score);
  const transitNote = transit
    ? ` Transit is ${transit.minutes} min.`
    : " No usable transit route.";

  return {
    ...base,
    score,
    band,
    route: drive.route,
    minutes: drive.minutes,
    headline: `${drive.minutes} min drive`,
    /*
     * The destination used to be spelled out here, and Google returns it fully
     * qualified -- "San Jose State University, Washington Square, San Jose, CA
     * 95112, USA" -- which was most of the line, the same on every listing,
     * and already named at the top of the board. The miles and the hour are
     * what this card knows that nothing else says.
     */
    detail: `${drive.miles.toFixed(1)} mi in typical 8am traffic.` + transitNote,
  };
}
