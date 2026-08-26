import { readFile, writeFile } from "node:fs/promises";
import type { LatLng } from "../types.ts";

/**
 * Rental listings from RentCast.
 *
 * The free tier is small enough that a careless render loop would burn a
 * month's quota in seconds, so this module is deliberately paranoid:
 *
 *   - every response is cached to disk, surviving restarts
 *   - a call is only made on an explicit user action, never on page load
 *   - a persisted counter enforces a hard monthly ceiling and refuses past it
 *   - coordinates are rounded before they become a cache key, so panning a
 *     few metres reuses the same answer instead of buying a new one
 *
 * The budget is the point here, not the code.
 */
const API = "https://api.rentcast.io/v1/listings/rental/long-term";

/** Deliberately under the free allowance, leaving headroom for mistakes. */
const MONTHLY_CAP = Number(process.env.RENTCAST_MONTHLY_CAP ?? 40);

/** Listings move slowly; a stale one beats spending a request. */
const TTL_MS = 30 * 24 * 60 * 60 * 1000;

const STORE = new URL("../../data/rentcast-cache.json", import.meta.url);

export type Listing = {
  address: string;
  rent: number | null;
  beds: number | null;
  baths: number | null;
  lat: number;
  lng: number;
};

type Store = {
  /** Calendar month, e.g. "2026-08". Resets the counter when it rolls over. */
  month: string;
  used: number;
  entries: Record<string, { at: number; value: Listing[] }>;
};

const monthKey = () => new Date().toISOString().slice(0, 7);

async function load(): Promise<Store> {
  try {
    const store = JSON.parse(await readFile(STORE, "utf8")) as Store;
    if (store.month !== monthKey()) return { month: monthKey(), used: 0, entries: store.entries ?? {} };
    return store;
  } catch {
    return { month: monthKey(), used: 0, entries: {} };
  }
}

const save = (s: Store) => writeFile(STORE, JSON.stringify(s)).catch(() => {});

/** Three decimals is about 100m -- close enough to reuse an answer. */
const keyFor = (at: LatLng, radius: number, limit: number) =>
  `${at.lat.toFixed(3)},${at.lng.toFixed(3)},${radius},${limit}`;

export type ListingsResult = {
  listings: Listing[];
  cached: boolean;
  used: number;
  cap: number;
  /** Set when nothing could be fetched, with the reason. */
  unavailable?: string;
};

export async function rentalsNear(
  at: LatLng,
  radiusMiles = 2,
  limit = 20,
  /** Return what is already on disk and nothing else. Page loads use this. */
  cachedOnly = false,
): Promise<ListingsResult> {
  const store = await load();
  const key = keyFor(at, radiusMiles, limit);

  const hit = store.entries[key];
  if (hit && Date.now() - hit.at < TTL_MS) {
    return { listings: hit.value, cached: true, used: store.used, cap: MONTHLY_CAP };
  }

  if (cachedOnly) {
    return {
      listings: [], cached: false, used: store.used, cap: MONTHLY_CAP,
      unavailable: "not-fetched",
    };
  }

  const apiKey = process.env.RENTCAST_API_KEY;
  if (!apiKey) {
    return {
      listings: [], cached: false, used: store.used, cap: MONTHLY_CAP,
      unavailable: "RENTCAST_API_KEY is not set.",
    };
  }

  if (store.used >= MONTHLY_CAP) {
    return {
      listings: [], cached: false, used: store.used, cap: MONTHLY_CAP,
      unavailable: `Monthly RentCast budget used (${store.used}/${MONTHLY_CAP}). Resets next month, or raise RENTCAST_MONTHLY_CAP.`,
    };
  }

  const params = new URLSearchParams({
    latitude: String(at.lat),
    longitude: String(at.lng),
    radius: String(radiusMiles),
    status: "Active",
    limit: String(limit),
  });

  try {
    const res = await fetch(`${API}?${params}`, {
      headers: { "X-Api-Key": apiKey, Accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    });

    // Count the request whatever it returned -- the quota was spent either way.
    store.used += 1;

    if (!res.ok) {
      await save(store);
      return {
        listings: [], cached: false, used: store.used, cap: MONTHLY_CAP,
        unavailable: `RentCast returned HTTP ${res.status}.`,
      };
    }

    const body = (await res.json()) as any;
    const rows: any[] = Array.isArray(body) ? body : (body?.listings ?? []);
    const listings: Listing[] = rows
      .map((r) => ({
        address: r.formattedAddress ?? r.addressLine1 ?? "",
        rent: Number.isFinite(Number(r.price)) ? Number(r.price) : null,
        beds: Number.isFinite(Number(r.bedrooms)) ? Number(r.bedrooms) : null,
        baths: Number.isFinite(Number(r.bathrooms)) ? Number(r.bathrooms) : null,
        lat: Number(r.latitude),
        lng: Number(r.longitude),
      }))
      .filter((l) => l.address && Number.isFinite(l.lat) && Number.isFinite(l.lng));

    store.entries[key] = { at: Date.now(), value: listings };
    await save(store);
    return { listings, cached: false, used: store.used, cap: MONTHLY_CAP };
  } catch (e) {
    store.used += 1;
    await save(store);
    return {
      listings: [], cached: false, used: store.used, cap: MONTHLY_CAP,
      unavailable: (e as Error).message,
    };
  }
}

/** What the budget looks like without spending any of it. */
export async function rentalBudget() {
  const store = await load();
  return { used: store.used, cap: MONTHLY_CAP, month: store.month };
}
