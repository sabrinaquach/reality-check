/**
 * The API half of the web app. It exists for one reason: the Maps and Census
 * keys must never reach the browser, and this repo is public. The client sends
 * an address, this process does the scoring and sends back JSON.
 *
 *   npm run dev        # this plus the Vite dev server
 *   npm run dev:api    # just this, on :8787
 */
import { createServer } from "node:http";
import { geocode } from "../spike/src/geocode.ts";
import { quietNearby, scoredBlocksNear } from "../spike/src/nearby.ts";
import { rentalsNear } from "../spike/src/sources/listings.ts";
import { realityCheck, withPillar } from "../spike/src/score.ts";
import { commuteModes, type ModeTime } from "../spike/src/sources/commute.ts";
import { scoreCost } from "../spike/src/sources/cost.ts";
import { scoreSafety } from "../spike/src/sources/safety.ts";
import { affordableNear } from "../spike/src/sources/affordable.ts";
import type { Priority, RealityCheck } from "../spike/src/types.ts";
import {
  clearedSessionCookie,
  currentUser,
  googleCallback,
  googleConfigured,
  googleStart,
  publicUser,
  requestLink,
  sessionCookie,
  sessionIdOf,
  signInWithToken,
} from "./auth.ts";
import { deleteSession, getAvatar, replaceSaved, savedFor, setAvatar } from "./store.ts";

const PORT = Number(process.env.PORT ?? 8787);
const PRIORITIES: Priority[] = ["commute", "safety", "cost"];

/**
 * A score costs ~8 Google calls and about two and a half seconds, and people
 * comparing listings hit the same address repeatedly. Ten minutes is short
 * enough that the 8am traffic estimate stays honest and long enough to cover
 * a session of going back and forth between two places.
 */
const TTL_MS = 10 * 60 * 1000;
const MAX_ENTRIES = 200;
const cache = new Map<string, { at: number; value: RealityCheck }>();

const AUTOCOMPLETE = "https://places.googleapis.com/v1/places:autocomplete";

/**
 * Autocomplete is billed per request and fires while someone types, so the
 * client debounces and this caches. Prefixes repeat constantly -- typing one
 * address walks through "300", "300 e", "300 e s"... and backspacing revisits
 * every one of them -- so even a small cache takes a large bite out of the
 * call volume. Suggestions for a given prefix barely change, hence the hour.
 */
const SUGGEST_TTL_MS = 60 * 60 * 1000;
const SUGGEST_MAX = 500;
const suggestCache = new Map<string, { at: number; value: Suggestion[] }>();

type Suggestion = { main: string; secondary: string; full: string };

/**
 * Other travel modes cost two extra Directions calls, so they are fetched only
 * when someone expands the commute card, and the answer is kept for an hour --
 * the same trip does not change mode times minute to minute.
 */
const MODES_TTL_MS = 60 * 60 * 1000;
const modesCache = new Map<string, { at: number; value: ModeTime[] }>();

/**
 * The safety index only covers San Jose, so there is little point offering
 * addresses far outside it. 50km is the widest circle the API accepts and
 * reaches Cupertino, Sunnyvale, Fremont and the rest of the South Bay.
 */
const NEAR_SAN_JOSE = {
  circle: { center: { latitude: 37.3382, longitude: -121.8863 }, radius: 50_000 },
};

async function suggest(input: string, sessionToken: string): Promise<Suggestion[]> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return [];

  const cacheKey = input.toLowerCase();
  const hit = suggestCache.get(cacheKey);
  if (hit && Date.now() - hit.at < SUGGEST_TTL_MS) return hit.value;

  const res = await fetch(AUTOCOMPLETE, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key },
    body: JSON.stringify({
      input,
      sessionToken,
      includedRegionCodes: ["us"],
      locationRestriction: NEAR_SAN_JOSE,
    }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) return [];

  const body = (await res.json()) as any;
  const out: Suggestion[] = (body.suggestions ?? [])
    .map((s: any) => s.placePrediction)
    .filter(Boolean)
    .map((p: any) => {
      const main = p.structuredFormat?.mainText?.text ?? p.text?.text ?? "";
      const secondary = p.structuredFormat?.secondaryText?.text ?? "";
      // Our own geocoder takes text, so hand back something it can resolve.
      return { main, secondary, full: p.text?.text ?? [main, secondary].filter(Boolean).join(", ") };
    })
    .filter((s: Suggestion) => s.main);

  suggestCache.set(cacheKey, { at: Date.now(), value: out });
  while (suggestCache.size > SUGGEST_MAX) suggestCache.delete(suggestCache.keys().next().value!);
  return out;
}

function cached(key: string): RealityCheck | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > TTL_MS) {
    cache.delete(key);
    return null;
  }
  // Refresh insertion order so the map evicts genuinely cold entries.
  cache.delete(key);
  cache.set(key, hit);
  return hit.value;
}

function remember(key: string, value: RealityCheck) {
  cache.set(key, { at: Date.now(), value });
  while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value!);
}

function send(
  res: import("node:http").ServerResponse,
  status: number,
  body: unknown,
  extra?: Record<string, string>,
) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(json),
    ...extra,
  });
  res.end(json);
}

/** The sign-in routes are the only ones that navigate rather than answer. */
function redirect(res: import("node:http").ServerResponse, to: string, extra?: Record<string, string>) {
  res.writeHead(302, { Location: to, ...extra });
  res.end();
}

/**
 * Read a request body, up to a limit. Returns null past it rather than
 * buffering something unbounded into this process's memory.
 */
async function readBody(
  req: import("node:http").IncomingMessage,
  limit: number,
): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    total += (chunk as Buffer).length;
    if (total > limit) return null;
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

/**
 * What an upload actually is, read from its first bytes rather than from the
 * Content-Type the browser claimed.
 *
 * This is the check that matters: these bytes get served back out of this
 * origin later, and a file that says "image/png" while holding markup would be
 * a script running on the app's own domain. Only these three formats, so SVG
 * -- which is a document and can carry script -- has no way through.
 */
function imageTypeOf(buf: Buffer): "image/png" | "image/jpeg" | "image/webp" | null {
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (
    buf.length > 12 &&
    buf.subarray(0, 4).toString("ascii") === "RIFF" &&
    buf.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

async function readJson(req: import("node:http").IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);

  /* ---------- accounts ---------- */

  /**
   * Who is signed in. The client asks once on load, so the nav can show an
   * account instead of a "Sign in" button without waiting for an action.
   */
  if (url.pathname === "/api/me") {
    const user = currentUser(req);
    return send(res, 200, { user: user ? publicUser(user) : null, google: googleConfigured() });
  }

  /**
   * Ask for a sign-in link. Signing up and signing in are the same request,
   * because from here they are indistinguishable: an address either owns its
   * inbox or it does not.
   */
  if (url.pathname === "/api/auth/email" && req.method === "POST") {
    try {
      const body = await readJson(req);
      const result = await requestLink(body?.email);
      if (!result.ok) return send(res, result.status, { error: result.error });
      /**
       * The same answer whether or not that address has an account. Anything
       * else -- a different message, a different delay -- would let a stranger
       * test addresses against this app one at a time.
       */
      return send(res, 200, { sent: true });
    } catch {
      return send(res, 400, { error: "Could not read that request." });
    }
  }

  /**
   * Following the link. A navigation, so it answers with a redirect either
   * way: signed in to the app, or back to it with the reason in the URL.
   */
  if (url.pathname === "/api/auth/callback") {
    const result = signInWithToken(url.searchParams.get("token"));
    if (!result.ok) return redirect(res, `/?authError=${encodeURIComponent(result.error)}`);
    return redirect(res, "/", { "Set-Cookie": sessionCookie(result.sessionId) });
  }

  if (url.pathname === "/api/auth/signout" && req.method === "POST") {
    deleteSession(sessionIdOf(req));
    return send(res, 200, { user: null }, { "Set-Cookie": clearedSessionCookie() });
  }

  /**
   * Google, as a redirect rather than an embedded script -- see auth.ts. The
   * button in the modal is a link to this route.
   */
  if (url.pathname === "/api/auth/google/start") {
    if (!googleConfigured()) {
      return send(res, 503, {
        error: "Google sign-in isn't configured on this server (GOOGLE_OAUTH_CLIENT_ID).",
      });
    }
    const { url: to, cookie } = googleStart();
    return redirect(res, to, { "Set-Cookie": cookie });
  }

  if (url.pathname === "/api/auth/google/callback") {
    /**
     * A redirect either way: the browser is mid-navigation, so an error has to
     * arrive as a page the app can read, not as JSON it would have to render
     * itself. The modal reopens and shows `authError`.
     */
    try {
      const result = await googleCallback(
        req,
        url.searchParams.get("code"),
        url.searchParams.get("state"),
      );
      if (!result.ok) {
        return redirect(res, `/?authError=${encodeURIComponent(result.error)}`);
      }
      return redirect(res, "/", { "Set-Cookie": sessionCookie(result.sessionId) });
    } catch (e) {
      console.error("google sign-in failed:", e);
      return redirect(res, `/?authError=${encodeURIComponent("Google sign-in failed. Try again.")}`);
    }
  }

  /**
   * A profile picture: the account's own, both ways. Nobody else's is
   * reachable, because in this app nobody else's is ever shown.
   *
   * The client resizes and re-encodes to a small square JPEG before sending,
   * so this ceiling is a backstop against something that skipped the UI rather
   * than the normal case -- a 256px avatar lands around 30 KB.
   */
  if (url.pathname === "/api/avatar") {
    const user = currentUser(req);

    if (req.method === "GET") {
      if (!user) return send(res, 401, { error: "Sign in first." });
      const avatar = getAvatar(user.id);
      if (!avatar) return send(res, 404, { error: "No picture." });
      res.writeHead(200, {
        "Content-Type": avatar.type,
        "Content-Length": avatar.bytes.length,
        // Never let a shared cache hold one person's face, and never sniff the
        // type back out of the bytes.
        "Cache-Control": "private, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      });
      return res.end(Buffer.from(avatar.bytes));
    }

    if (req.method === "PUT") {
      if (!user) return send(res, 401, { error: "Sign in first." });
      const body = await readBody(req, 1_000_000);
      if (!body) return send(res, 413, { error: "That picture is too large." });
      const type = imageTypeOf(body);
      if (!type) return send(res, 400, { error: "That doesn't look like a PNG, JPEG, or WebP." });
      setAvatar(user.id, body, type);
      return send(res, 200, { user: publicUser(user) });
    }
  }

  /* ---------- saved listings, once there is an account to hang them on ---------- */

  if (url.pathname === "/api/saved") {
    const user = currentUser(req);
    if (!user) return send(res, 401, { error: "Sign in first." });

    if (req.method === "GET") return send(res, 200, { saved: savedFor(user.id) });

    if (req.method === "PUT") {
      try {
        const body = await readJson(req);
        const list = body?.saved;
        if (!Array.isArray(list)) return send(res, 400, { error: "A list is required." });
        // Anything without an address has no identity here and cannot be a row.
        replaceSaved(
          user.id,
          list.filter((c: any) => typeof c?.listing?.address === "string" && c.listing.address.trim()),
        );
        return send(res, 200, { saved: savedFor(user.id) });
      } catch (e) {
        console.error("saving failed:", e);
        return send(res, 400, { error: "Could not read that request." });
      }
    }
  }

  /**
   * Rental listings. `cachedOnly` is the default on purpose: rendering a page
   * must never spend from a small monthly quota, so the client asks for cache
   * on load and only makes a real request when someone clicks.
   */
  if (url.pathname === "/api/rentals") {
    const lat = Number(url.searchParams.get("lat"));
    const lng = Number(url.searchParams.get("lng"));
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return send(res, 400, { error: "lat and lng are required." });
    }
    const live = url.searchParams.get("live") === "1";
    try {
      return send(res, 200, await rentalsNear({ lat, lng }, 2, 20, !live));
    } catch (e) {
      console.error("rentals failed:", e);
      return send(res, 500, { error: (e as Error).message });
    }
  }

  /**
   * Rescore just the cost pillar for a check that already exists.
   *
   * Someone who left the rent blank and fills it in later should not pay for a
   * whole new reality check -- the other three pillars have not changed, and
   * re-running them would mean about eight more Google calls. Cost reads the
   * Census only, which is free.
   */
  if (url.pathname === "/api/cost" && req.method === "POST") {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
        check?: RealityCheck;
        rent?: number;
      };
      const check = body.check;
      const rent = Number(body.rent);
      if (!check?.listing || !Number.isFinite(rent) || rent <= 0) {
        return send(res, 400, { error: "A check and a positive rent are required." });
      }
      const pillar = await scoreCost({ lat: check.listing.lat, lng: check.listing.lng }, rent);
      const updated = withPillar(
        { ...check, listing: { ...check.listing, rent } },
        pillar,
      );
      return send(res, 200, updated);
    } catch (e) {
      console.error("cost rescore failed:", e);
      return send(res, 500, { error: (e as Error).message });
    }
  }

  /**
   * Recompute just the safety pillar for a check the client already holds.
   *
   * Saved listings are stored whole, in the browser, forever -- that is what
   * lets the Saved tab reopen a result without paying for the Google calls
   * again. The cost is that a check scored before the index learned about
   * incident types keeps its old safety pillar for good, and the card goes on
   * saying the breakdown is missing however many times the index is rebuilt.
   *
   * This reads the local block index and nothing else, so refreshing costs no
   * quota from anyone -- unlike a full rescore, which would spend eight Google
   * calls to fix one pillar.
   */
  if (url.pathname === "/api/safety" && req.method === "POST") {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { check?: RealityCheck };
      const check = body.check;
      if (!check?.listing) return send(res, 400, { error: "A check is required." });
      const pillar = await scoreSafety({ lat: check.listing.lat, lng: check.listing.lng });
      return send(res, 200, withPillar(check, pillar));
    } catch (e) {
      console.error("safety rescore failed:", e);
      return send(res, 500, { error: (e as Error).message });
    }
  }

  // Every mode for one trip, for the commute card's expanded view.
  if (url.pathname === "/api/commute") {
    const lat = Number(url.searchParams.get("lat"));
    const lng = Number(url.searchParams.get("lng"));
    const to = (url.searchParams.get("to") ?? "").trim();
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !to) {
      return send(res, 400, { error: "lat, lng and to are required." });
    }
    const cacheKey = `${lat.toFixed(5)},${lng.toFixed(5)}|${to.toLowerCase()}`;
    const hit = modesCache.get(cacheKey);
    if (hit && Date.now() - hit.at < MODES_TTL_MS) {
      res.setHeader("X-Cache", "hit");
      return send(res, 200, { modes: hit.value });
    }
    try {
      const modes = await commuteModes({ lat, lng }, to);
      modesCache.set(cacheKey, { at: Date.now(), value: modes });
      res.setHeader("X-Cache", "miss");
      return send(res, 200, { modes });
    } catch (e) {
      console.error("commute modes failed:", e);
      return send(res, 500, { error: (e as Error).message });
    }
  }

  // Address autocomplete for both search inputs.
  if (url.pathname === "/api/suggest") {
    const q = (url.searchParams.get("q") ?? "").trim();
    // Below three characters the suggestions are noise not worth paying for.
    if (q.length < 3) return send(res, 200, { suggestions: [] });
    const session = (url.searchParams.get("session") ?? "").slice(0, 64) || "anon";
    try {
      return send(res, 200, { suggestions: await suggest(q, session) });
    } catch (e) {
      console.error("suggest failed:", e);
      return send(res, 200, { suggestions: [] }); // never block typing on this
    }
  }

  // Indexed blocks as GeoJSON, for the map's safety heatmap. Only what is
  // nearby -- the whole index is 721KB and has no business in a browser.
  if (url.pathname === "/api/blocks") {
    const lat = Number(url.searchParams.get("lat"));
    const lng = Number(url.searchParams.get("lng"));
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return send(res, 400, { error: "lat and lng are required." });
    }
    const radius = Number(url.searchParams.get("radius")) || 1.5;
    try {
      // Scored, not raw: the map must speak the same language as the pillar,
      // and a block's own weight is a different quantity from the score an
      // address there would get.
      const blocks = await scoredBlocksNear({ lat, lng }, radius);
      if (blocks === null) {
        return send(res, 503, { error: "No block index. Run `npm run build-index` in ../spike." });
      }
      return send(res, 200, {
        type: "FeatureCollection",
        features: blocks.map((b) => ({
          type: "Feature",
          geometry: { type: "Point", coordinates: [b.lng, b.lat] },
          properties: {
            address: b.address,
            incidents: b.incidents,
            weight: b.weight,
            score: b.score,
            band: b.band,
          },
        })),
      });
    } catch (e) {
      console.error("blocks failed:", e);
      return send(res, 500, { error: (e as Error).message });
    }
  }

  /**
   * The cheapest neighbourhoods near where you work.
   *
   * Two public Census requests for a whole county, then served from disk for a
   * month -- so unlike the rentals rail this one costs nothing per visitor and
   * needs no budget guard.
   */
  if (url.pathname === "/api/affordable") {
    const lat = Number(url.searchParams.get("lat"));
    const lng = Number(url.searchParams.get("lng"));
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return send(res, 400, { error: "lat and lng are required." });
    }
    const radius = Number(url.searchParams.get("radius")) || 5;
    try {
      return send(res, 200, await affordableNear({ lat, lng }, radius));
    } catch (e) {
      console.error("affordable failed:", e);
      return send(res, 500, { error: (e as Error).message });
    }
  }

  // The quietest indexed blocks near where you work, for the sidebar list.
  if (url.pathname === "/api/nearby") {
    const near = (url.searchParams.get("near") ?? "").trim();
    if (!near) return send(res, 400, { error: "A reference address is required." });
    try {
      const at = await geocode(near);
      if (!at) return send(res, 422, { error: `Could not find "${near}".` });
      const spots = await quietNearby(at);
      if (spots === null) {
        return send(res, 503, { error: "No block index. Run `npm run build-index` in ../spike." });
      }
      return send(res, 200, { at, spots });
    } catch (e) {
      console.error("nearby failed:", e);
      return send(res, 500, { error: (e as Error).message });
    }
  }

  if (url.pathname !== "/api/score") return send(res, 404, { error: "Not found" });

  const address = (url.searchParams.get("address") ?? "").trim();
  if (!address) return send(res, 400, { error: "An address is required." });

  const commuteTo = (url.searchParams.get("to") ?? "").trim();
  const rentRaw = url.searchParams.get("rent");
  const rent = rentRaw && Number.isFinite(Number(rentRaw)) && Number(rentRaw) > 0 ? Number(rentRaw) : undefined;
  const priorities = (url.searchParams.get("priorities") ?? "")
    .split(",")
    .map((p) => p.trim().toLowerCase())
    .filter((p): p is Priority => PRIORITIES.includes(p as Priority));

  const key = `${address}|${commuteTo}|${rent ?? ""}|${priorities.join(",")}`;
  const hit = cached(key);
  if (hit) {
    res.setHeader("X-Cache", "hit");
    return send(res, 200, hit);
  }

  try {
    const at = await geocode(address);
    if (!at) {
      return send(res, 422, {
        error: `Could not find "${address}". Try a street address with the city.`,
      });
    }
    const check = await realityCheck({ address, rent, ...at }, commuteTo, priorities);
    remember(key, check);
    res.setHeader("X-Cache", "miss");
    send(res, 200, check);
  } catch (e) {
    console.error("score failed:", e);
    send(res, 500, { error: (e as Error).message });
  }
});

server.listen(PORT, () => console.log(`  api    http://localhost:${PORT}/api/score`));
