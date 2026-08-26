import type { RealityCheck } from "./types.ts";

/**
 * Saved listings live in this browser. There is no account system, so this is
 * per-device and per-browser rather than per-person -- clearing site data loses
 * them. Storing the whole check means the Saved tab can reopen a result without
 * paying for the ~8 Google calls a rescore would cost.
 */
const KEY = "reality-check.saved";

export function loadSaved(): RealityCheck[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as RealityCheck[]) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return []; // private window, blocked storage -- start empty
  }
}

export function persistSaved(list: RealityCheck[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Out of quota or storage disabled. The in-memory list still works for
    // this session; losing it on reload beats breaking the click.
  }
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
