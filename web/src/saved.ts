import type { RealityCheck } from "./types.ts";
import { pushSavedToServer } from "./auth.ts";

/**
 * Saved listings live on the account, and only on the account.
 *
 * They used to live in localStorage, which meant they were per-browser rather
 * than per-person and vanished with the site data. Now that saving asks for an
 * account first there is nowhere else for them to be: signed out there is
 * nothing to save to, and signed in the server is the only copy. Nothing about
 * a person's list is left in a browser they walk away from.
 *
 * Storing the whole check, not just the address, means the Saved tab can
 * reopen a result without paying for the ~8 Google calls a rescore would cost.
 */

/**
 * A preview escape hatch, off unless VITE_SKIP_SIGNIN=1 is set in web/.env.
 *
 * Saving needs an account, and an account needs a working sign-in -- which on
 * a phone on the LAN it currently is not. This lets the Saved screen be looked
 * at without one: the heart works, the list fills, and it survives a reload by
 * sitting in this browser's localStorage instead of on an account.
 *
 * It is not a feature and it is not a fallback. It is per-browser, so the list
 * is not anybody's in the sense the real one is, and it must come out once
 * sign-in works. Delete the line from .env and everything below reverts.
 */
export const SKIP_SIGNIN = import.meta.env.VITE_SKIP_SIGNIN === "1";

const PREVIEW_KEY = "reality-check.saved-preview";

export function loadPreviewSaved(): RealityCheck[] {
  if (!SKIP_SIGNIN) return [];
  try {
    const raw = localStorage.getItem(PREVIEW_KEY);
    return raw ? (JSON.parse(raw) as RealityCheck[]) : [];
  } catch {
    return [];
  }
}

/**
 * Send the list as it now stands. A replace rather than a diff: it is a
 * handful of entries, the client owns their order, and a write that failed is
 * repaired whole by the next one.
 */
export function persistSaved(list: RealityCheck[]) {
  if (SKIP_SIGNIN) {
    // No account to write to, so this browser is the only place it can go.
    try {
      localStorage.setItem(PREVIEW_KEY, JSON.stringify(list));
    } catch {
      // Private window: the list still works for this session.
    }
    return;
  }
  // Fire and forget: the click has already been answered on screen.
  void pushSavedToServer(list);
}

/** Address is the identity -- the same place checked twice is one saved entry. */
export const keyOf = (check: RealityCheck) => check.listing.address.trim().toLowerCase();

export const isSaved = (list: RealityCheck[], check: RealityCheck) =>
  list.some((c) => keyOf(c) === keyOf(check));

export function toggleSaved(list: RealityCheck[], check: RealityCheck): RealityCheck[] {
  const next = isSaved(list, check)
    ? list.filter((c) => keyOf(c) !== keyOf(check))
    : [check, ...list];
  persistSaved(next);
  return next;
}

export function removeSaved(list: RealityCheck[], check: RealityCheck): RealityCheck[] {
  const next = list.filter((c) => keyOf(c) !== keyOf(check));
  persistSaved(next);
  return next;
}
