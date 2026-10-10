// The consent string of the IAB Europe Transparency and Consent Framework (TCF), version 2, decoded.
//
// The shapes follow the standard's own field tables ("Consent string and vendor list formats v2",
// IAB Tech Lab, read 9 Oct 2026; a copy is kept with the Contracts design). Every id set is a sorted
// array of numbers, so a decoded string is plain data: it compares with toEqual, serialises as it is,
// and needs no class to read.
//
// What this module decodes is what the page's consent tool stored. It says nothing about what any
// company did with it.

/** A set of numeric ids (vendors, purposes) with the highest id the string declared for it. */
export interface IdSet {
  /** The highest id the section declares it covers. Ids above it are refused at decode time. */
  maxId: number;
  /** The ids that are set, ascending, without repeats. */
  ids: number[];
}

/** An inclusive range of ids, first and last. */
export type IdSpan = readonly [number, number];

/**
 * 0: the purpose is not allowed for these vendors at all. 1: consent is required. 2: legitimate
 * interest is required. 3: undefined by the standard ("not used"), kept as read.
 */
export type RestrictionType = 0 | 1 | 2 | 3;

export interface PublisherRestriction {
  purposeId: number;
  restrictionType: RestrictionType;
  /**
   * Ascending, merged where they overlap or touch, never expanded: restrictions have no declared
   * maximum, so 256 purpose and type pairs over every id would be 16.7 million ids from a 2 KB string.
   * A range may span ids no vendor holds; they are kept.
   */
  vendorRanges: IdSpan[];
}

/** The core segment, the one every string starts with. */
export interface TcCore {
  version: 2;
  /** Epoch milliseconds. Since Dec 2021 both are the day the string was last updated, at 00:00 UTC. */
  created: number;
  lastUpdated: number;
  cmpId: number;
  cmpVersion: number;
  consentScreen: number;
  /** Two letters, lowercase (ISO 639-1), as the consent tool wrote them. */
  consentLanguage: string;
  vendorListVersion: number;
  tcfPolicyVersion: number;
  isServiceSpecific: boolean;
  useNonStandardTexts: boolean;
  /** Special feature ids opted in (1 = precise geolocation, 2 = device identification by scanning). */
  specialFeatureOptIns: number[];
  /** Purpose ids (1 to 24) consented to. */
  purposeConsents: number[];
  /** Purpose ids (1 to 24) for which legitimate interest was made known and not objected to. */
  purposeLegitimateInterests: number[];
  purposeOneTreatment: boolean;
  /** Two letters, uppercase (ISO 3166-1 alpha-2), as the consent tool wrote them. */
  publisherCountry: string;
  vendorConsents: IdSet;
  vendorLegitimateInterests: IdSet;
  publisherRestrictions: PublisherRestriction[];
}

/** The publisher's own purposes (segment type 3). */
export interface PublisherPurposes {
  consents: number[];
  legitimateInterests: number[];
  /** How many custom purposes the publisher declared (0 to 63). */
  customPurposeCount: number;
  customConsents: number[];
  customLegitimateInterests: number[];
}

export interface TcString {
  core: TcCore;
  /** Segment type 1: the vendors the consent tool showed the person. Mandatory since TCF 2.3. */
  disclosedVendors?: IdSet;
  /**
   * Segment type 2: out-of-band vendors allowed. Deprecated in 2021 and gone from the standard's
   * current text; read with the IAB library's layout when an old string carries it (decode.ts).
   */
  allowedVendors?: IdSet;
  publisherPurposes?: PublisherPurposes;
  /** Observations about a string that decoded cleanly but breaks a rule of the standard. */
  notes: TcNote[];
}

/**
 * A string that decodes but does not follow the standard. Never a decode failure: the record keeps
 * what the page reported, and a reader may say "this string breaks the standard's rule" beside it.
 */
export type TcNote =
  /** IsServiceSpecific is 0; the standard calls such a string invalid. */
  | 'not-service-specific'
  /** Policy version below 4 on a string last updated after 30 Sep 2023, when the standard made it invalid. */
  | 'policy-version-too-old'
  /** At policy version 4 or later, a legitimate interest bit for purposes 3 to 6, which TCF 2.2 forbids. */
  | 'legitimate-interest-not-allowed'
  /** No Disclosed Vendors segment on a string last updated from 1 Mar 2026, when TCF 2.3 made it mandatory. */
  | 'missing-disclosed-vendors'
  /** A bit past the last field is 1: the string carries data this decoder did not read. */
  | 'trailing-data';

export type TcSegmentName = 'core' | 'disclosed-vendors' | 'allowed-vendors' | 'publisher-purposes';

export type TcDecodeErrorCode =
  /** Nothing to decode. */
  | 'empty'
  /** Longer than any string the standard's sections can need (decode.ts, MAX_LENGTH); not read at all. */
  | 'too-long'
  /** A character outside the base64url alphabet (A-Z, a-z, 0-9, '-', '_'). */
  | 'bad-character'
  /** The version is not 2. Version 1 strings are invalid since 30 Sep 2020 under the standard. */
  | 'unsupported-version'
  /** The string ends before a field the standard says must be there. */
  | 'truncated'
  /** A 6-bit letter outside a to z. */
  | 'bad-letter'
  /** A range whose end is before its start. */
  | 'bad-range'
  /** An id of 0, or above the section's declared maximum. */
  | 'id-out-of-range'
  /** A segment after the core whose type is not 1, 2 or 3. */
  | 'unknown-segment'
  /** The same segment type twice. */
  | 'repeated-segment';

export interface TcDecodeError {
  code: TcDecodeErrorCode;
  segment: TcSegmentName | null;
  /** The field being read when the decode stopped, in the standard's own name. */
  field: string | null;
  /** Bit offset inside the segment, or the character offset in the whole string for 'bad-character'. */
  offset: number;
}

export type TcDecodeResult = { ok: true; value: TcString } | { ok: false; error: TcDecodeError };
