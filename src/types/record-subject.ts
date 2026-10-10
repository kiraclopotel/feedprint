// A record of something other than a feed item: a document seen at an address, a consent string a
// site's banner stored, or a note the person typed about an agreement.
//
// These records share the chain with every other record (the same hash, link, signature and time
// stamps) and carry none of a feed item's fields. A document has no platform, author or technique, and
// a record that filled those with stand-in values would sign a statement nobody observed. Absent keys
// are left out of the hashed bytes (src/forensics/canonical-payload.ts), so a subject record hashes
// exactly what it states.
//
// One key carries the body: `subject`, the last key of the canonical payload, hashed whole like
// `stamp` and `provenance`. `kind` alone says which body it is. A body only ever gains optional fields
// within its version `v`; a new kind of subject is a new `kind` value and a new body, never a new
// top-level key. Design: the Contracts design, sections 3 and 5.

import type { RecordStamp } from './forensic';

/** The fields every record of the chain has, with the same names and meanings as on ForensicRecord. */
export interface ChainFields {
  id: string;
  /** ISO time the record was written. */
  timestamp: string;
  prevRecordHash: string;
  chainPosition: number;
  publicKeyFingerprint?: string;
  integrityHash: string;
  signature?: string;
  chainAnchor?: string;
  stamp?: RecordStamp;
}

/** A document as the browser showed it at an address. */
export interface DocumentSubject {
  v: 1;
  /** Origin and path as the browser showed them. The query and the fragment are removed. */
  address: string;
  /** Present when a query or a fragment was removed: they can carry session ids, order numbers, emails. */
  addressTrimmed?: true;
  title: string;
  /** The page's declared language (its `lang` attribute), when it declared one. */
  language?: string;
  /** SHA-256, lowercase hex, of the text as `textReader` produced it. */
  textHash: string;
  /** Which reader produced the text, and its version: 'fw-visible-text/1'. */
  textReader: string;
  /** The text, the first time this chain keeps it. */
  text?: string;
  /** Otherwise the id of the earlier entry of this chain that holds the text with this hash. */
  textIn?: string;
  /** Card- or IBAN-like digit runs the reader replaced. Counted, never kept. */
  withheld?: { numbers: number };
  /**
   * The boxes as they stood: their label, whether they were checked, and, when the page's own markup
   * said so, whether they came checked (`preset`, the element's default state), so a box the site
   * ticked can be told from a box the person ticked. Never a typed value.
   */
  boxes?: { label: string; checked: boolean; preset?: boolean; type: 'checkbox' | 'radio' }[];
  /** Links on the page that look like terms, privacy or cancellation. */
  links?: { text: string; address: string }[];
  /**
   * What the reader saw and did not keep, each as a short reason: 'frame not readable', 'payment
   * field on page: text not kept', 'changed during capture'. A gap is stated, never left silent.
   */
  notCaptured?: string[];
  /** The person's button, or a site the person opted in. */
  by: 'click' | 'site';
}

/** The consent standards a consent record can hold. Each has its own decoder under src/contracts/consent/. */
export type ConsentStandard = 'tcf-eu-2';

/** A consent string as a site's consent tool reported it to the page. */
export interface ConsentSubject {
  v: 1;
  address: string;
  standard: ConsentStandard;
  /** Exactly as the consent tool reported it. Decoded at read time, never stored decoded. */
  string: string;
  /**
   * How it was asked for: the standard's message channel from the extension's own world, or a call
   * made in the page's world. Either way the answer is what the page reported, and can be wrong.
   */
  route: 'message' | 'page-world';
  /**
   * What the standard's page interface said beside the string. For 'tcf-eu-2', read through
   * __tcfapi: eventStatus, gdprApplies, cmpStatus.
   */
  api: Record<string, string | number | boolean>;
  by: 'click' | 'site';
}

/** What the person typed about an agreement. A correction is a new note; no note is ever edited. */
export interface NoteSubject {
  v: 1;
  /** The agreement this note is about: an id minted with its first note. */
  agreement: string;
  /** Ids of the document or consent entries the person attached to the agreement. */
  about?: string[];
  /** As typed: renews, notice, price, started. */
  fields: { name: string; value: string }[];
}

export type SubjectRecord = ChainFields & (
  | { kind: 'document'; subject: DocumentSubject }
  | { kind: 'consent'; subject: ConsentSubject }
  | { kind: 'note'; subject: NoteSubject }
);

export type SubjectKind = SubjectRecord['kind'];
export type RecordSubject = SubjectRecord['subject'];

/**
 * A subject record before it is hashed and signed. Omitted per kind, not over the union: a plain
 * Omit would merge the three kinds into one shape and let a consent body sit under kind 'note'.
 */
export type UnhashedSubjectRecord = SubjectRecord extends infer R
  ? R extends SubjectRecord ? Omit<R, 'integrityHash' | 'signature' | 'chainAnchor'> : never
  : never;
