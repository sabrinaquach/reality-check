import type { RealityCheck } from "./types.ts";

/**
 * What someone was doing when they were asked to sign in.
 *
 * A sign-in link leaves the page and comes back through the inbox, usually in
 * a new tab, so this cannot live in a variable: by the time the account
 * arrives, the component that was waiting for it is gone. Pressing the heart,
 * signing in, and finding the listing still unsaved would mean doing the whole
 * thing twice.
 *
 * It is a single transient intent, thrown away as soon as it is used -- not a
 * store of anything. The saved list itself lives only on the account.
 */
const KEY = "reality-check.pending";

/** Longer than reading an email, shorter than walking away from a machine. */
const FRESH_MS = 30 * 60 * 1000;

export type Intent = { kind: "save"; check: RealityCheck } | { kind: "open-saved" };

type Stored = { intent: Intent; email: string | null; at: number };

function read(): Stored | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Stored) : null;
  } catch {
    return null;
  }
}

function write(value: Stored | null) {
  try {
    if (value) localStorage.setItem(KEY, JSON.stringify(value));
    else localStorage.removeItem(KEY);
  } catch {
    // Storage blocked. The intent is simply not carried across the redirect,
    // which costs a second click rather than breaking anything.
  }
}

export function rememberIntent(intent: Intent) {
  write({ intent, email: null, at: Date.now() });
}

/**
 * Stamp it with the address the link was sent to, once that is known. Google
 * leaves it unstamped -- nobody types an address on that path.
 */
export function addressIntent(email: string) {
  const stored = read();
  if (stored) write({ ...stored, email });
}

/**
 * Take it back, if it is still fresh and belongs to whoever just signed in.
 *
 * Matching on the address is what stops a request abandoned on a shared
 * browser being finished by the next person: they asked for a link to their
 * own address, so the waiting intent is not theirs.
 */
export function takeIntent(email: string): Intent | null {
  const stored = read();
  write(null);
  if (!stored || Date.now() - stored.at > FRESH_MS) return null;
  if (stored.email !== null && stored.email !== email) return null;
  return stored.intent;
}

export const forgetIntent = () => write(null);
