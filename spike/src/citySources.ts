import type { Severity } from "./sources/safety.ts";

/**
 * Where each city's incidents come from, and what its words mean.
 *
 * Build-time only -- the server never imports this. At run time a city is the
 * five fields in cities.ts; everything here exists to produce the index that
 * makes those five fields answerable.
 *
 * Two shapes of source, because the portals differ in one way that matters:
 *
 *   "grouped" -- the department publishes a block or intersection label, so
 *     Socrata can aggregate server-side and the whole city arrives as a few
 *     thousand rows. Cheap, fast, and the block keeps a name a person can read
 *     and a geocoder can find.
 *
 *   "raw" -- no such label (NYPD and Dallas publish coordinates and nothing
 *     else placeable), so the rows come down and are bucketed here by rounded
 *     coordinate. Slower, and the resulting "block" has no name -- which is why
 *     City.labelled exists and why those cities show a safety score and a map
 *     but no list of checkable addresses.
 */
export type Classified = { severity: Severity; group: string } | null;

export type CitySource = {
  /** Matches an id in cities.ts. */
  cityId: string;
  domain: string;
  dataset: string;
  mode: "grouped" | "raw";
  fields: {
    date: string;
    category: string;
    /** The block label. Required by "grouped", absent in "raw". */
    block?: string;
    lat?: string;
    lng?: string;
    /** A Socrata point column, when the portal offers no plain lat/lng. */
    point?: string;
  };
  /**
   * This city's own words, checked before the shared patterns.
   *
   * The shared classifier in safety.ts matches generic crime language --
   * ASSAULT, BURGLARY, NARCOTICS -- and most departments speak it. These are
   * the ones that do not: local coinages, NIBRS phrasings, and the values that
   * mean "an officer filed paperwork" rather than "something happened".
   *
   * `null` excludes, on the reasoning the SJPD filter uses: counting police
   * activity scores a heavily-patrolled block as dangerous.
   */
  overrides?: Record<string, Classified>;

  /**
   * An extra SoQL condition, for a portal's own quirks.
   *
   * Seattle types its coordinates as text and files the literal string
   * "REDACTED" where a location was withheld, which the numeric cast then
   * chokes on -- so those rows have to be excluded before the cast, in the
   * WHERE, rather than after it in this process.
   */
  where?: string;

  /**
   * Cast the coordinate columns to number before averaging.
   *
   * Only where the portal types them as text -- Seattle and Cincinnati both
   * do. It is not harmless to apply everywhere: on Chicago's already-numeric
   * columns the cast made a query that used to take seconds exceed a
   * three-minute timeout.
   */
  castCoords?: boolean;

  /**
   * Pull the classifiable part out of a messy category string.
   *
   * LAPD's NIBRS table does not publish an offence name; it publishes the
   * statute -- "422(A) - PC - F - Criminal Threats - 13C" -- which comes to
   * 985 distinct strings, unmappable by hand. The last token is the NIBRS
   * offence code, which is a national standard and only about seventy values.
   * The first capture group of this becomes the key looked up in overrides.
   */
  extract?: RegExp;

  /**
   * The date column is text, not a timestamp.
   *
   * Dallas stores every date as "2020-08-14 00:00:00.0000000". SoQL's date
   * functions refuse it, so the year comes from substring() and the window is
   * a plain string comparison -- which is sound because the format is
   * zero-padded and big-endian, so lexical order is chronological order.
   */
  textDate?: boolean;

  /**
   * A street centreline dataset, for a city whose incidents carry no address.
   *
   * "raw" mode names its blocks by rounded coordinate, which scores and maps
   * perfectly well but is useless as somewhere to send a reader. Given this,
   * the builder snaps each bucket to the nearest streets and names it after
   * them -- so the block becomes "E 14TH ST & 3RD AVE", which is both readable
   * and geocodable, and the city can carry the two address rails like the
   * others.
   */
  streets?: { dataset: string; nameField: string; geomField: string; where?: string };
};

/**
 * The FBI's NIBRS offence codes.
 *
 * A national vocabulary, so every department that reports in NIBRS -- which is
 * all of them now, by federal mandate -- can share one mapping instead of each
 * being hand-read. Group A is the offences; the 90-series is Group B, which is
 * mostly the minor and the administrative.
 */
const NIBRS_CODES: Record<string, Classified> = {
  // violent
  "09A": { severity: "violent", group: "Assault" },   // murder
  "09B": { severity: "violent", group: "Assault" },   // negligent manslaughter
  "09C": null,                                        // justifiable homicide
  "100": { severity: "violent", group: "Assault" },   // kidnapping
  "11A": { severity: "violent", group: "Assault" },   // rape
  "11B": { severity: "violent", group: "Assault" },
  "11C": { severity: "violent", group: "Assault" },
  "11D": { severity: "violent", group: "Assault" },   // fondling
  "120": { severity: "violent", group: "Robbery" },
  "13A": { severity: "violent", group: "Assault" },   // aggravated assault
  "13B": { severity: "violent", group: "Assault" },   // simple assault
  "13C": { severity: "disorder", group: "Disturbances" }, // intimidation: a threat
  "200": { severity: "violent", group: "Vandalism" }, // arson
  "520": { severity: "violent", group: "Weapons" },
  "64A": { severity: "violent", group: "Assault" },   // human trafficking
  "64B": { severity: "violent", group: "Assault" },
  // property
  "210": { severity: "property", group: "Fraud" },    // extortion
  "220": { severity: "property", group: "Break-ins" },
  "23A": { severity: "property", group: "Theft" },
  "23B": { severity: "property", group: "Theft" },
  "23C": { severity: "property", group: "Theft" },    // shoplifting
  "23D": { severity: "property", group: "Theft" },
  "23E": { severity: "property", group: "Theft" },
  "23F": { severity: "property", group: "Car break-ins" },
  "23G": { severity: "property", group: "Car break-ins" },
  "23H": { severity: "property", group: "Theft" },
  "240": { severity: "property", group: "Car theft" },
  "250": { severity: "property", group: "Fraud" },    // counterfeiting
  "26A": { severity: "property", group: "Fraud" },
  "26B": { severity: "property", group: "Fraud" },
  "26C": { severity: "property", group: "Fraud" },
  "26D": { severity: "property", group: "Fraud" },
  "26E": { severity: "property", group: "Fraud" },
  "26F": { severity: "property", group: "Fraud" },
  "26G": { severity: "property", group: "Fraud" },
  "270": { severity: "property", group: "Fraud" },    // embezzlement
  "280": { severity: "property", group: "Theft" },    // stolen property
  "290": { severity: "property", group: "Vandalism" },
  // disorder
  "35A": { severity: "disorder", group: "Drugs" },
  "35B": { severity: "disorder", group: "Drugs" },
  "370": { severity: "disorder", group: "Suspicious activity" },
  "39A": { severity: "disorder", group: "Suspicious activity" },
  "39B": { severity: "disorder", group: "Suspicious activity" },
  "39C": { severity: "disorder", group: "Suspicious activity" },
  "39D": { severity: "disorder", group: "Suspicious activity" },
  "40A": { severity: "disorder", group: "Suspicious activity" },
  "40B": { severity: "disorder", group: "Suspicious activity" },
  "40C": { severity: "disorder", group: "Suspicious activity" },
  "90A": { severity: "property", group: "Fraud" },    // bad cheques
  "90B": { severity: "disorder", group: "Suspicious activity" },
  "90C": { severity: "disorder", group: "Disturbances" },
  "90E": { severity: "disorder", group: "Suspicious activity" },
  "90F": { severity: "disorder", group: "Disturbances" },
  "90G": { severity: "disorder", group: "Suspicious activity" },
  "90H": { severity: "disorder", group: "Suspicious activity" },
  "90J": { severity: "disorder", group: "Trespassing" },
  // Group B paperwork and traffic: an officer's day, not a resident's.
  "510": null, "90D": null, "90I": null, "90M": null, "90N": null, "90Z": null,
};

/** Paperwork and police activity, phrased the way most NIBRS portals phrase it. */
const NIBRS_NOISE: Record<string, Classified> = {
  "All Other Offenses": null,
  "ALL OTHER OFFENSES": null,
  "MISCELLANEOUS": null,
  "None": null,
  "OTHER OFFENSE": null,
  "NON - CRIMINAL": null,
  "NON-CRIMINAL": null,
  "NON-CRIMINAL (SUBJECT SPECIFIED)": null,
  "FOUND": null,
  "Justifiable Homicide": null,
  // Seattle files 6,690 of these a year: an incident that exists as a record
  // but that NIBRS has no offence for. Paperwork, by definition.
  "Not Reportable to NIBRS": null,
};

/**
 * Words that turn up in several cities' vocabularies and that the shared
 * patterns in safety.ts do not carry, because SJPD does not use them. Mapped
 * once here rather than repeated in every city's overrides.
 */
const COMMON: Record<string, Classified> = {
  "SEX OFFENSE": { severity: "violent", group: "Assault" },
  "STALKING": { severity: "disorder", group: "Disturbances" },
  "INTIMIDATION": { severity: "disorder", group: "Disturbances" },
  "PROSTITUTION": { severity: "disorder", group: "Suspicious activity" },
  "GAMBLING": { severity: "disorder", group: "Suspicious activity" },
  "KIDNAPPING": { severity: "violent", group: "Assault" },
  "ARSON": { severity: "violent", group: "Vandalism" },
  "EXTORTION": { severity: "property", group: "Fraud" },
  "BRIBERY": null,
  // NIBRS phrasings, shared by every department that reports in it.
  "Hacking/Computer Invasion": { severity: "property", group: "Fraud" },
  "Animal Cruelty": { severity: "disorder", group: "Disturbances" },
  "Fondling": { severity: "violent", group: "Assault" },
  "Purse-snatching": { severity: "property", group: "Theft" },
  "Embezzlement": { severity: "property", group: "Fraud" },
  "Curfew/Loitering/Vagrancy Violations": { severity: "disorder", group: "Suspicious activity" },
  "Violation of No Contact Orders": { severity: "disorder", group: "Disturbances" },
  "Bad Checks": { severity: "property", group: "Fraud" },
  "Counterfeiting/Forgery": { severity: "property", group: "Fraud" },
  "False Pretenses/Swindle/Confidence Game": { severity: "property", group: "Fraud" },
  "Impersonation": { severity: "property", group: "Fraud" },
  "Wire Fraud": { severity: "property", group: "Fraud" },
  "Pocket-picking": { severity: "property", group: "Theft" },
  "Theft of Motor Vehicle Parts or Accessories": { severity: "property", group: "Car break-ins" },
  "Shoplifting": { severity: "property", group: "Theft" },
  "Stolen Property Offenses": { severity: "property", group: "Theft" },
  "Robbery": { severity: "violent", group: "Robbery" },
  "Rape": { severity: "violent", group: "Assault" },
  "Kidnapping/Abduction": { severity: "violent", group: "Assault" },
  "Extortion/Blackmail": { severity: "property", group: "Fraud" },
  "Prostitution": { severity: "disorder", group: "Suspicious activity" },
  "Pornography/Obscene Material": { severity: "disorder", group: "Suspicious activity" },
  "Liquor Law Violations": { severity: "disorder", group: "Suspicious activity" },
  "Arson": { severity: "violent", group: "Vandalism" },
  // A withheld or absent value, in the portals that write one.
  "Assisting or Promoting Prostitution": { severity: "disorder", group: "Suspicious activity" },
  "Purchasing Prostitution": { severity: "disorder", group: "Suspicious activity" },
  "Peeping Tom": { severity: "disorder", group: "Suspicious activity" },
  "Incest": { severity: "violent", group: "Assault" },
  "Betting/Wagering": { severity: "disorder", group: "Suspicious activity" },
  "Gambling Equipment Violation": { severity: "disorder", group: "Suspicious activity" },
  "Operating/Promoting/Assisting Gambling": { severity: "disorder", group: "Suspicious activity" },
  "Bribery": null,
  "-": null,
  "UNKNOWN": null,
  "Unknown": null,
};

export const SOURCES: CitySource[] = [
  {
    cityId: "chicago",
    domain: "data.cityofchicago.org",
    dataset: "ijzp-q8t2",
    mode: "grouped",
    fields: { date: "date", category: "primary_type", block: "block", lat: "latitude", lng: "longitude" },
    overrides: {
      ...NIBRS_NOISE,
      ...COMMON,
      "CRIMINAL DAMAGE": { severity: "property", group: "Vandalism" },
      "CRIMINAL TRESPASS": { severity: "disorder", group: "Trespassing" },
      "DECEPTIVE PRACTICE": { severity: "property", group: "Fraud" },
      "CRIM SEXUAL ASSAULT": { severity: "violent", group: "Assault" },
      "CRIMINAL SEXUAL ASSAULT": { severity: "violent", group: "Assault" },
      "OFFENSE INVOLVING CHILDREN": { severity: "disorder", group: "Disturbances" },
      "PUBLIC PEACE VIOLATION": { severity: "disorder", group: "Disturbances" },
      "INTERFERENCE WITH PUBLIC OFFICER": null,
      "LIQUOR LAW VIOLATION": { severity: "disorder", group: "Suspicious activity" },
      "CONCEALED CARRY LICENSE VIOLATION": { severity: "violent", group: "Weapons" },
      "OTHER NARCOTIC VIOLATION": { severity: "disorder", group: "Drugs" },
      "PUBLIC INDECENCY": { severity: "disorder", group: "Suspicious activity" },
      "OBSCENITY": { severity: "disorder", group: "Suspicious activity" },
      "HUMAN TRAFFICKING": { severity: "violent", group: "Assault" },
      "RITUALISM": null,
      "NON-CRIMINAL (SUBJECT SPECIFIED)": null,
    },
  },
  {
    cityId: "los-angeles",
    domain: "data.lacity.org",
    /*
     * The NIBRS dataset, not "Crime Data from 2020 to 2024". That one is the
     * better known and is 600 days stale -- LAPD moved to NIBRS reporting and
     * kept the old table frozen. This one is current and speaks the same
     * vocabulary Seattle and Dallas do, so it shares their mappings.
     */
    dataset: "y8y3-fqfu",
    mode: "grouped",
    fields: { date: "date_occ", category: "nibr_description", block: "location", lat: "lat", lng: "lon" },
    /** "422(A) - PC - F - Criminal Threats - 13C" -> "13C". */
    extract: /-\s*([0-9]{2,3}[A-Z]?)\s*$/,
    overrides: {
      ...NIBRS_CODES,
      "THEFT OF IDENTITY": { severity: "property", group: "Fraud" },
      "INTIMATE PARTNER - SIMPLE ASSAULT": { severity: "violent", group: "Assault" },
      "INTIMATE PARTNER - AGGRAVATED ASSAULT": { severity: "violent", group: "Assault" },
      "CRIMINAL THREATS - NO WEAPON DISPLAYED": { severity: "disorder", group: "Disturbances" },
      "TRESPASSING": { severity: "disorder", group: "Trespassing" },
      "DOCUMENT FORGERY / STOLEN FELONY": { severity: "property", group: "Fraud" },
      "VIOLATION OF RESTRAINING ORDER": { severity: "disorder", group: "Disturbances" },
      "VIOLATION OF COURT ORDER": null,
      "OTHER MISCELLANEOUS CRIME": null,
      "CONTEMPT OF COURT": null,
      "FAILURE TO YIELD": null,
    },
  },
  {
    cityId: "seattle",
    domain: "data.seattle.gov",
    dataset: "tazs-3rd5",
    mode: "grouped",
    fields: {
      date: "offense_date",
      category: "nibrs_offense_code_description",
      block: "block_address",
      lat: "latitude",
      lng: "longitude",
    },
    where: "latitude != 'REDACTED' AND longitude != 'REDACTED'",
    castCoords: true,
    overrides: {
      ...NIBRS_NOISE,
      ...COMMON,
      "Destruction/Damage/Vandalism of Property": { severity: "property", group: "Vandalism" },
      "Burglary/Breaking & Entering": { severity: "property", group: "Break-ins" },
      "All Other Larceny": { severity: "property", group: "Theft" },
      "Theft From Motor Vehicle": { severity: "property", group: "Car break-ins" },
      "Motor Vehicle Theft": { severity: "property", group: "Car theft" },
      "Theft From Building": { severity: "property", group: "Theft" },
      "Identity Theft": { severity: "property", group: "Fraud" },
      "Credit Card/Automated Teller Machine Fraud": { severity: "property", group: "Fraud" },
      "Simple Assault": { severity: "violent", group: "Assault" },
      "Aggravated Assault": { severity: "violent", group: "Assault" },
      "Intimidation": { severity: "disorder", group: "Disturbances" },
      "Drug/Narcotic Violations": { severity: "disorder", group: "Drugs" },
      "Drug Equipment Violations": { severity: "disorder", group: "Drugs" },
      "Trespass of Real Property": { severity: "disorder", group: "Trespassing" },
      "Disorderly Conduct": { severity: "disorder", group: "Disturbances" },
      "Weapon Law Violations": { severity: "violent", group: "Weapons" },
      "Driving Under the Influence": null,
      "Family Offenses, Nonviolent": { severity: "disorder", group: "Disturbances" },
    },
  },
  {
    cityId: "cincinnati",
    domain: "data.cincinnati-oh.gov",
    dataset: "k59e-2pvf",
    mode: "grouped",
    fields: {
      date: "date_reported",
      category: "offense",
      block: "address_x",
      lat: "latitude_x",
      lng: "longitude_x",
    },
    castCoords: true,
    overrides: {
      ...NIBRS_NOISE,
      ...COMMON,
      "CRIMINAL DAMAGING/ENDANGERING": { severity: "property", group: "Vandalism" },
      "BREAKING AND ENTERING": { severity: "property", group: "Break-ins" },
      "DOMESTIC VIOLENCE": { severity: "disorder", group: "Disturbances" },
      "AGGRAVATED ROBBERY": { severity: "violent", group: "Robbery" },
      "FELONIOUS ASSAULT": { severity: "violent", group: "Assault" },
      "MENACING": { severity: "disorder", group: "Disturbances" },
      "TELEPHONE HARASSMENT": null,
      "MISUSE OF CREDIT CARD": { severity: "property", group: "Fraud" },
      "UNAUTHORIZED USE OF VEHICLE": { severity: "property", group: "Car theft" },
      "TAKING IDENTITY OF ANOTHER": { severity: "property", group: "Fraud" },
      "CRIMINAL TRESPASS": { severity: "disorder", group: "Trespassing" },
      "DISORDERLY CONDUCT": { severity: "disorder", group: "Disturbances" },
      // Threats without contact sit in disorder, as SJPD's DISTURBANCE does;
      // only a weapon actually used or shown reaches violent.
      "AGGRAVATED MENACING": { severity: "disorder", group: "Disturbances" },
      "MENACING BY STALKING": { severity: "disorder", group: "Disturbances" },
      "INDUCING PANIC": { severity: "disorder", group: "Disturbances" },
      "TAKING THE IDENTITY OF ANOTHER": { severity: "property", group: "Fraud" },
      "IMPROPERLY DISCHARGING FIREARM AT/INTO HABITATION/SCHOOL": { severity: "violent", group: "Weapons" },
      "VIOLATE PROTECTION ORDER/CONSENT AGREEMENT": { severity: "disorder", group: "Disturbances" },
      "UNAUTHORIZED USE OF MOTOR VEHICLE": { severity: "property", group: "Car theft" },
      "ENDANGERING CHILDREN": { severity: "disorder", group: "Disturbances" },
      "FORGERY": { severity: "property", group: "Fraud" },
      "ABDUCTION": { severity: "violent", group: "Assault" },
      "CRIMINAL MISCHIEF": { severity: "property", group: "Vandalism" },
      "SEXUAL IMPOSITION": { severity: "violent", group: "Assault" },
      "INTERFERENCE WITH CUSTODY": { severity: "disorder", group: "Disturbances" },
      "PUBLIC INDECENCY": { severity: "disorder", group: "Suspicious activity" },
      // Police activity, not something that happened to a resident.
      "FAIL COMPLY ORDER/SIGNAL OF PO-ELUDE/FLEE": null,
    },
  },
  {
    cityId: "new-york",
    domain: "data.cityofnewyork.us",
    dataset: "5uac-w243",
    mode: "raw",
    fields: { date: "cmplnt_fr_dt", category: "ofns_desc", lat: "latitude", lng: "longitude" },
    // NYC Centerline: 122k segments, same free portal as the incidents.
    streets: {
      dataset: "inkn-q76z",
      nameField: "full_street_name",
      geomField: "the_geom",
      /*
       * rw_type 1 is "Street". The rest of the centreline is bridges, ramps,
       * ferry routes, footpaths and driveways -- which score wonderfully,
       * because nobody lives on them, and named blocks things like
       * "KOSCIUSZKO BRG" and "PEDESTRIAN AND BIKE PATH LINK". A rail that
       * offers somewhere to live should only offer streets.
       */
      where: "rw_type = '1'",
    },
    overrides: {
      ...NIBRS_NOISE,
      ...COMMON,
      "PETIT LARCENY": { severity: "property", group: "Theft" },
      "GRAND LARCENY": { severity: "property", group: "Theft" },
      "GRAND LARCENY OF MOTOR VEHICLE": { severity: "property", group: "Car theft" },
      "PETIT LARCENY OF MOTOR VEHICLE": { severity: "property", group: "Car theft" },
      "HARRASSMENT 2": { severity: "disorder", group: "Disturbances" },
      "CRIMINAL MISCHIEF & RELATED OF": { severity: "property", group: "Vandalism" },
      "ASSAULT 3 & RELATED OFFENSES": { severity: "violent", group: "Assault" },
      "FELONY ASSAULT": { severity: "violent", group: "Assault" },
      "VEHICLE AND TRAFFIC LAWS": null,
      "MISCELLANEOUS PENAL LAW": null,
      "OFF. AGNST PUB ORD SENSBLTY &": { severity: "disorder", group: "Disturbances" },
      "DANGEROUS DRUGS": { severity: "disorder", group: "Drugs" },
      "DANGEROUS WEAPONS": { severity: "violent", group: "Weapons" },
      "OFFENSES AGAINST PUBLIC ADMINI": null,
      "ADMINISTRATIVE CODE": null,
      "INTOXICATED & IMPAIRED DRIVING": null,
      "CRIMINAL TRESPASS": { severity: "disorder", group: "Trespassing" },
      "OTHER STATE LAWS (NON PENAL LA": null,
      "OTHER STATE LAWS": null,
      "FRAUDS": { severity: "property", group: "Fraud" },
      "FORGERY": { severity: "property", group: "Fraud" },
      "THEFT-FRAUD": { severity: "property", group: "Fraud" },
      "OFFENSES INVOLVING FRAUD": { severity: "property", group: "Fraud" },
      "SEX CRIMES": { severity: "violent", group: "Assault" },
      "OFFENSES AGAINST THE PERSON": { severity: "violent", group: "Assault" },
      "UNAUTHORIZED USE OF A VEHICLE": { severity: "property", group: "Car theft" },
      "PROSTITUTION & RELATED OFFENSES": { severity: "disorder", group: "Suspicious activity" },
      "BURGLAR'S TOOLS": { severity: "property", group: "Break-ins" },
      "CANNABIS RELATED OFFENSES": { severity: "disorder", group: "Drugs" },
      "OFFENSES AGAINST PUBLIC SAFETY": { severity: "disorder", group: "Disturbances" },
      "OTHER STATE LAWS (NON PENAL LAW)": null,
      "NYS LAWS-UNCLASSIFIED FELONY": null,
      "AGRICULTURE & MRKTS LAW-UNCLASSIFIED": null,
      "OTHER TRAFFIC INFRACTION": null,
      "ALCOHOLIC BEVERAGE CONTROL LAW": { severity: "disorder", group: "Suspicious activity" },
      "DISORDERLY CONDUCT": { severity: "disorder", group: "Disturbances" },
      "ENDAN WELFARE INCOMP": { severity: "disorder", group: "Disturbances" },
      "CHILD ABANDONMENT/NON SUPPORT": { severity: "disorder", group: "Disturbances" },
      "ANTICIPATORY OFFENSES": null,
      "LOITERING/GAMBLING (CARDS, DICE, ETC)": { severity: "disorder", group: "Suspicious activity" },
      "NEW YORK CITY HEALTH CODE": null,
      "UNLAWFUL POSS. WEAP. ON SCHOOL": { severity: "violent", group: "Weapons" },
    },
  },
  {
    cityId: "dallas",
    domain: "www.dallasopendata.com",
    dataset: "qv6i-rri7",
    mode: "raw",
    fields: { date: "date1", category: "nibrs_crime", point: "geocoded_column" },
    textDate: true,
    overrides: {
      ...NIBRS_NOISE,
      ...COMMON,
      "UUMV": { severity: "property", group: "Car theft" },
      "THEFT FROM MOTOR VEHICLE": { severity: "property", group: "Car break-ins" },
      "DESTRUCTION/ DAMAGE/ VANDALISM OF PROPERTY": { severity: "property", group: "Vandalism" },
      "ALL OTHER LARCENY": { severity: "property", group: "Theft" },
      "BURGLARY OF HABITATION": { severity: "property", group: "Break-ins" },
      "BURGLARY OF BUSINESS": { severity: "property", group: "Break-ins" },
      "SIMPLE ASSAULT": { severity: "violent", group: "Assault" },
      "AGGRAVATED ASSAULT": { severity: "violent", group: "Assault" },
      "INTIMIDATION": { severity: "disorder", group: "Disturbances" },
      "DRUG/ NARCOTIC VIOLATIONS": { severity: "disorder", group: "Drugs" },
      "DRUG EQUIPMENT VIOLATIONS": { severity: "disorder", group: "Drugs" },
      "IDENTITY THEFT": { severity: "property", group: "Fraud" },
      "CREDIT CARD/ ATM FRAUD": { severity: "property", group: "Fraud" },
      "THEFT OF MOTOR VEHICLE PARTS OR ACCESSORY": { severity: "property", group: "Car break-ins" },
      "SHOPLIFTING": { severity: "property", group: "Theft" },
      "TRESPASS OF REAL PROPERTY": { severity: "disorder", group: "Trespassing" },
      "DRIVING UNDER THE INFLUENCE": null,
      "TRAFFIC VIOLATION - HAZARDOUS": null,
      "TRAFFIC VIOLATION - NON HAZARDOUS": null,
      "DUI": null,
      "PUBLIC INTOXICATION": { severity: "disorder", group: "Suspicious activity" },
      "FALSE PRETENSES/ SWINDLE/ CONFIDENCE GAME": { severity: "property", group: "Fraud" },
      "DISORDERLY CONDUCT": { severity: "disorder", group: "Disturbances" },
      "FAMILY OFFENSES, NONVIOLENT": { severity: "disorder", group: "Disturbances" },
      "EMBEZZELMENT": { severity: "property", group: "Fraud" },
      "COUNTERFEITING/ FORGERY": { severity: "property", group: "Fraud" },
      "WEAPON LAW VIOLATIONS": { severity: "violent", group: "Weapons" },
      "STOLEN PROPERTY OFFENSES": { severity: "property", group: "Theft" },
      "POCKET-PICKING": { severity: "property", group: "Theft" },
      "PURSE-SNATCHING": { severity: "property", group: "Theft" },
    },
  },
];

export const sourceFor = (cityId: string): CitySource | null =>
  SOURCES.find((s) => s.cityId === cityId) ?? null;
