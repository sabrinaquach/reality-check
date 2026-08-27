/**
 * Trimming addresses down to what a card has room for.
 *
 * Every address in this app arrives fully qualified -- RentCast and Google
 * both return "560 N 2nd St, Apt 6, San Jose, CA 95112" -- and no screen here
 * has room for the tail, or a reason to show it. Everything is one city.
 */

/** Drops the state and zip: "560 N 2nd St, Apt 6, San Jose". */
export function withoutState(address: string): string {
  return address.replace(/, (CA|USA)\b.*$/, "");
}

/**
 * Drops the city too: "560 N 2nd St, Apt 6".
 *
 * The city is always the last comma-segment once the state and zip are gone,
 * so this takes everything before it. The unit stays -- it is the only thing
 * telling two listings in one building apart. An address with no city segment
 * ("123 Main St") is returned untouched rather than emptied.
 */
export function street(address: string): string {
  const parts = withoutState(address).split(", ");
  return parts.length > 1 ? parts.slice(0, -1).join(", ") : address;
}

/**
 * "1200 AVIATION AV" -> "1200 Aviation Ave".
 *
 * SJPD publishes block addresses in capitals, and every screen that shows one
 * has to quieten it down first -- the safety rail and the cheaper-areas rail
 * both read from that same index.
 */
export function pretty(address: string): string {
  return address
    .toLowerCase()
    .replace(/\b[a-z]/g, (c) => c.toUpperCase())
    .replace(/\bAv\b/, "Ave")
    .replace(/\bDr\b/, "Dr")
    .replace(/\bCt\b/, "Ct");
}
