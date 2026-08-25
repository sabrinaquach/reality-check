export type Priority = "commute" | "safety" | "cost";

export type Band = "good" | "moderate" | "poor";

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
  summary: string;
  pillars: Pillar[];
};

export type LatLng = { lat: number; lng: number };
