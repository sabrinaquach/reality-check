import type { RealityCheck } from "./types.ts";

/**
 * The browser half of signing in. The session itself is an httpOnly cookie, so
 * there is no token to hold here -- every call just goes out with credentials
 * and the server decides who is asking.
 */

export type Account = {
  email: string;
  google: boolean;
  /**
   * When their picture last changed, or null for an account with none. It is a
   * timestamp rather than a URL because the bytes live at one fixed address --
   * see avatarUrl, which puts the stamp in the query so a new upload is a new
   * URL and the browser cannot show the old one.
   */
  avatar: number | null;
};

export const avatarUrl = (account: Account) =>
  account.avatar ? `/api/avatar?v=${account.avatar}` : null;

/**
 * Send a picture, already squared and shrunk by the caller. Answers with the
 * account, so the new stamp comes back in the same round trip.
 */
export async function uploadAvatar(image: Blob): Promise<Account> {
  const body = await json(
    await fetch("/api/avatar", {
      method: "PUT",
      headers: { "Content-Type": image.type },
      body: image,
    }),
  );
  return body.user as Account;
}

/** What the server will and will not offer, asked once on load. */
export type Session = {
  user: Account | null;
  /** Whether this server has Google credentials configured at all. */
  google: boolean;
};

async function json(res: Response) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? "Something went wrong.");
  return body;
}

export async function fetchSession(): Promise<Session> {
  try {
    return (await json(await fetch("/api/me"))) as Session;
  } catch {
    // The API being down is not the same as being signed out, but there is
    // nothing to sign into either way, and the app works without an account.
    return { user: null, google: false };
  }
}

/**
 * Ask for a sign-in link. Signing up and signing in are the same request: an
 * address the server has never seen becomes an account the first time a link
 * to it is followed.
 *
 * Answers the same way whether or not that address has an account, so nothing
 * here can be used to find out which addresses do.
 */
export async function requestLink(email: string): Promise<void> {
  await json(
    await fetch("/api/auth/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    }),
  );
}

export async function signOut(): Promise<void> {
  await fetch("/api/auth/signout", { method: "POST" });
}

/** A plain navigation, not a fetch: the OAuth flow leaves and comes back. */
export const GOOGLE_SIGN_IN = "/api/auth/google/start";

/* ---------- saved listings, server side ---------- */

export async function fetchSavedFromServer(): Promise<RealityCheck[] | null> {
  try {
    const body = await json(await fetch("/api/saved"));
    return body.saved as RealityCheck[];
  } catch {
    return null; // signed out, or the API is unreachable
  }
}

export async function pushSavedToServer(saved: RealityCheck[]): Promise<void> {
  try {
    await fetch("/api/saved", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ saved }),
    });
  } catch {
    // Offline. localStorage still has the list, and the next write retries the
    // whole thing -- it is a replace, so nothing is lost by one failing.
  }
}
