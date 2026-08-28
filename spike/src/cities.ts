import type { LatLng } from "./types.ts";

/**
 * The cities this app has a safety index for.
 *
 * Everything else it scores is national -- commute is Google Directions, cost
 * is Census tracts and ACS medians, amenities is Google Places -- and all three
 * work anywhere in the country today. Safety is the one pillar that has to be
 * built city by city, because there is no national feed of it: every police
 * department publishes its own data, in its own vocabulary, on its own portal.
 *
 * So this file is the list of places the fourth pillar can answer for, and the
 * only place in the engine that knows any city's name.
 *
 * Adding one is three things: a builder that turns that department's data into
 * a BlockIndex, a mapping from its offence names onto the shared groups in
 * safety.ts, and an entry here. The scoring itself needs no changes at all --
 * percentileOf ranks a block against its OWN city's baseline deciles, so the
 * numbers mean the same thing in each city without ever being compared across
 * them.
 */
export type City = {
  /** Stable id, and the suffix on this city's index file. */
  id: string;

  /** The city in a sentence: "quieter than most of San Jose". */
  name: string;

  /**
   * What turns a block into something a geocoder can find.
   *
   * An index stores what the department published -- "1200 AVIATION AV", or an
   * SF intersection like "04TH ST \ MISSION ST" -- which is not an address
   * until it is told which city it is in. The UI used to append ", San Jose"
   * itself, in three separate files.
   */
  addressSuffix: string;

  /**
   * What the numbers are, in the pillar's own basis line. Not decoration: San
   * Jose publishes calls for service and San Francisco publishes filed
   * incident reports, which are different things counted differently, and a
   * reader comparing two cities deserves to know which they are looking at.
   */
  basis: string;

  /** Roughly where it is. Only ever used to pick a candidate index. */
  centre: LatLng;

  /**
   * How far from `centre` this index is worth consulting.
   *
   * Deliberately generous, because it is a filter and not the answer: whether
   * a point is really covered is decided by scoreSafety, which asks how far
   * the nearest indexed block actually is. This exists so that question can be
   * asked of one index instead of all of them.
   */
  radiusMiles: number;

  /**
   * Whether this city's blocks have a name.
   *
   * Most departments publish a block or intersection label, which is what the
   * "safest neighbourhoods" rail offers as a checkable address. NYPD and
   * Dallas publish a point and nothing placeable, so their blocks are named by
   * coordinate -- fine for scoring an address and for colouring a map, useless
   * as something to hand back to a reader. Those cities get the pillar and the
   * map, and no list.
   */
  labelled: boolean;

  index: URL;
};

export const CITIES: City[] = [
  {
    id: "san-jose",
    name: "San Jose",
    addressSuffix: ", San Jose, CA",
    basis: "Based on SJPD calls for service",
    centre: { lat: 37.3382, lng: -121.8863 },
    radiusMiles: 14,
    labelled: true,
    index: new URL("../data/blocks.json", import.meta.url),
  },
  {
    id: "san-francisco",
    name: "San Francisco",
    basis: "Based on SFPD incident reports",
    addressSuffix: ", San Francisco, CA",
    centre: { lat: 37.7749, lng: -122.4194 },
    radiusMiles: 9,
    labelled: true,
    index: new URL("../data/blocks-san-francisco.json", import.meta.url),
  },
  {
    id: "chicago",
    name: "Chicago",
    addressSuffix: ", Chicago, IL",
    basis: "Based on Chicago PD reported crimes",
    centre: { lat: 41.8781, lng: -87.6298 },
    radiusMiles: 16,
    labelled: true,
    index: new URL("../data/blocks-chicago.json", import.meta.url),
  },
  {
    id: "los-angeles",
    name: "Los Angeles",
    addressSuffix: ", Los Angeles, CA",
    basis: "Based on LAPD reported crimes",
    centre: { lat: 34.0522, lng: -118.2437 },
    radiusMiles: 22,
    labelled: true,
    index: new URL("../data/blocks-los-angeles.json", import.meta.url),
  },
  {
    id: "seattle",
    name: "Seattle",
    addressSuffix: ", Seattle, WA",
    basis: "Based on SPD reported offenses",
    centre: { lat: 47.6062, lng: -122.3321 },
    radiusMiles: 11,
    labelled: true,
    index: new URL("../data/blocks-seattle.json", import.meta.url),
  },
  {
    id: "cincinnati",
    name: "Cincinnati",
    addressSuffix: ", Cincinnati, OH",
    basis: "Based on CPD reported offenses",
    centre: { lat: 39.1031, lng: -84.512 },
    radiusMiles: 11,
    labelled: true,
    index: new URL("../data/blocks-cincinnati.json", import.meta.url),
  },
  {
    id: "new-york",
    name: "New York",
    addressSuffix: ", New York, NY",
    basis: "Based on NYPD complaint reports",
    centre: { lat: 40.7128, lng: -74.006 },
    radiusMiles: 18,
    // NYPD publishes no address, so buildCity snaps each block to the two
    // nearest streets from the city's own centreline data -- see `streets`
    // in citySources.ts. That is what earns this the two address rails.
    labelled: true,
    index: new URL("../data/blocks-new-york.json", import.meta.url),
  },
  {
    id: "dallas",
    name: "Dallas",
    addressSuffix: ", Dallas, TX",
    basis: "Based on Dallas PD incident reports",
    centre: { lat: 32.7767, lng: -96.797 },
    radiusMiles: 17,
    labelled: true,
    index: new URL("../data/blocks-dallas.json", import.meta.url),
  },
];

/** Every city's name, for the sentence that says what is not covered. */
export const cityNames = () => CITIES.map((c) => c.name);

export const cityById = (id: string): City | null =>
  CITIES.find((c) => c.id === id) ?? null;

/**
 * The city whose index to consult for a point, or null when none is close
 * enough to be worth opening.
 *
 * Nearest centre wins rather than first match, so two cities whose circles
 * overlap resolve to the closer one instead of to whichever was declared
 * first. San Jose and San Francisco are 40 miles apart and do not overlap;
 * Oakland and Berkeley would.
 */
export function cityAt(at: LatLng): City | null {
  let best: City | null = null;
  let bestMiles = Infinity;
  for (const city of CITIES) {
    const miles = milesBetween(at, city.centre);
    if (miles <= city.radiusMiles && miles < bestMiles) {
      best = city;
      bestMiles = miles;
    }
  }
  return best;
}

/**
 * Great-circle distance in miles. Duplicated from geocode.ts on purpose: that
 * module reaches for the network, and this one is a lookup table.
 */
function milesBetween(a: LatLng, b: LatLng): number {
  const R = 3958.8;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
