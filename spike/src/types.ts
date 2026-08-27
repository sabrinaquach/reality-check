export type Priority = "commute" | "safety" | "cost";

export type Band = "good" | "moderate" | "poor";

/** The drawn shape of a commute, for callers that render a map. */
export type Route = {
  /** Google's encoded polyline. Decode with any polyline algorithm reader. */
  polyline: string;
  bounds: { north: number; south: number; east: number; west: number };
};

/** One row in a pillar's breakdown, e.g. a single nearby amenity. */
export type PillarItem = {
  /** Emoji marker, matching how the design lists these. */
  icon: string;
  name: string;
  note: string;
  miles: number;
};

/**
 * One renter-facing category of police call, e.g. "Break-ins", with how many
 * landed near the listing. SJPD's own call types are operational and far too
 * numerous to show; safety.ts collapses them into these.
 */
export type IncidentGroup = {
  label: string;
  count: number;
  /** Percent of the nearby incidents this group accounts for, 0-100. */
  share: number;
};

/**
 * The numbers behind the cost score, so a card can lay them out instead of
 * making the reader parse them back out of a sentence.
 */
export type CostFacts = {
  /** The listing's rent, when one was given. */
  rent?: number;
  /** Median rent for the area, in dollars a month. */
  median: number;
  /** ACS release year the median came from. */
  year: number;
  /** Whether the median is the tract's own or the county's fallback. */
  level: "tract" | "county";
  /** The area the median describes, e.g. "Census Tract 5009.01". */
  area: string;
};

/** One pillar of the reality check (Commute / Safety / Cost / Amenities). */
export type Pillar = {
  key: "commute" | "safety" | "cost" | "amenities";
  /** 0-100. Higher is better, always. */
  score: number;
  band: Band;
  /** Short line shown in bold on the card, e.g. "10 min drive". */
  headline: string;
  /** Supporting line under it. */
  detail: string;
  /** Where the number came from, shown as the small grey caption. */
  basis: string;
  /** Optional breakdown behind the headline. Amenities uses this; others may not. */
  items?: PillarItem[];
  /** Commute only: the route Google returned, so a map can draw it. */
  route?: Route;
  /**
   * Commute only: the drive time behind the score.
   *
   * `commuteScore` clamps, so every trip of 10 minutes or less scores 100 and
   * everything past an hour scores 0. Comparing two listings on score alone
   * therefore calls a 5-minute drive and a 10-minute drive a draw. This is the
   * quantity that actually separates them.
   */
  minutes?: number;
  /** Cost only: the rent and the local median, for the breakdown panel. */
  cost?: CostFacts;
  /** Safety only: what the nearby calls actually were, commonest first. */
  incidents?: IncidentGroup[];
  /** Set when we could not get real data. Pillar is excluded from the total. */
  unavailable?: string;
};

export type Listing = {
  address: string;
  /** Listed rent in dollars/month. Optional in the UI. */
  rent?: number;
  lat: number;
  lng: number;
};

export type RealityCheck = {
  listing: Listing;
  commuteTo: string;
  priorities: Priority[];
  /** 0-100 weighted composite, or null if too little data to be honest. */
  score: number | null;
  /** Band for `score`, so callers never re-derive the thresholds. Null with it. */
  band: Band | null;
  summary: string;
  pillars: Pillar[];
};

export type LatLng = { lat: number; lng: number };
