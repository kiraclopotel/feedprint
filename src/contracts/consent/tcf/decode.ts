// The TCF v2 consent string, decoded from its text into plain data.
//
// Field order and widths are the standard's ("Consent string and vendor list formats v2", IAB Tech
// Lab; the copy read on 9 Oct 2026 is kept with the Contracts design). The core segment comes first;
// any others follow it, each naming its own type in its first three bits, in any order.
//
// The decoder returns a value for every input and never guesses. A string it cannot read comes back as an error value
// that names the segment, the field and the bit; a string that reads cleanly but breaks a rule of the
// standard comes back decoded, with a note. It imports nothing outside this folder and keeps to plain
// syntax, because the exported file will carry a generated copy of it (Contracts design, section 5).

import { BitReader, TcReadStop, mergeSpans, sixBitValues } from './bit-reader';
import type {
  IdSet, IdSpan, PublisherPurposes, PublisherRestriction, RestrictionType, TcCore, TcDecodeResult, TcNote, TcSegmentName,
} from './types';

const DECISECOND_MS = 100;

/**
 * The longest string read at all. Every section the standard lays out, at its 16-bit maximum and as a
 * bit field (both core vendor sections, disclosed and allowed vendors), takes 43,690 characters
 * together, and a consent cookie holds about 4 KB. Past this the decoder does no work, so the time it
 * takes stays bounded however much text a page hands it; the record keeps the string either way.
 */
export const MAX_LENGTH = 65_536;

/**
 * Segment types after the core. The standard's current text names 1 and 3; type 2 (out-of-band
 * vendors allowed, deprecated in 2021) is not in it any more, and is read with the layout the IAB's
 * own library gives it (iabtcf-es, SegmentIDs and its vendor vector encoder), so an old string that
 * carries it is still readable rather than refused whole.
 */
const SEGMENT_NAMES: Readonly<Record<number, TcSegmentName>> = {
  1: 'disclosed-vendors',
  2: 'allowed-vendors',
  3: 'publisher-purposes',
};

/**
 * The standard's rules a note is made for, each from its text: "Bits 2 to 5 are required to be set
 * to 0" in PurposesLITransparency with TCF v2.2 (policy version 4 and later); a policy version below 4
 * is invalid after 30 Sep 2023; the Disclosed Vendors segment is mandatory for strings made from
 * 1 Mar 2026 (TCF 2.3). A rule that did not yet apply to a string is not held against it.
 */
const NO_LEGITIMATE_INTEREST_FROM_POLICY_4 = new Set([3, 4, 5, 6]);
const POLICY_4_REQUIRED_AFTER = Date.UTC(2023, 9, 1);
const DISCLOSED_VENDORS_REQUIRED_FROM = Date.UTC(2026, 2, 1);

function readCore(r: BitReader, notes: TcNote[]): TcCore {
  if (r.int(6, 'Version') !== 2) throw new TcReadStop('unsupported-version', 'core', 'Version', 0);
  const version = 2 as const;
  const created = r.int(36, 'Created') * DECISECOND_MS;
  const lastUpdated = r.int(36, 'LastUpdated') * DECISECOND_MS;
  const cmpId = r.int(12, 'CmpId');
  const cmpVersion = r.int(12, 'CmpVersion');
  const consentScreen = r.int(6, 'ConsentScreen');
  const consentLanguage = r.letters('ConsentLanguage');
  const vendorListVersion = r.int(12, 'VendorListVersion');
  const tcfPolicyVersion = r.int(6, 'TcfPolicyVersion');
  const isServiceSpecific = r.bool('IsServiceSpecific');
  const useNonStandardTexts = r.bool('UseNonStandardTexts');
  const specialFeatureOptIns = r.flags(12, 'SpecialFeatureOptIns');
  const purposeConsents = r.flags(24, 'PurposesConsent');
  const purposeLegitimateInterests = r.flags(24, 'PurposesLITransparency');
  const purposeOneTreatment = r.bool('PurposeOneTreatment');
  const publisherCountry = r.letters('PublisherCC').toUpperCase();
  const vendorConsents = r.vendorSection('VendorConsents');
  const vendorLegitimateInterests = r.vendorSection('VendorLegitimateInterests');
  const publisherRestrictions = readRestrictions(r);

  if (!isServiceSpecific) notes.push('not-service-specific');
  if (tcfPolicyVersion < 4 && lastUpdated >= POLICY_4_REQUIRED_AFTER) notes.push('policy-version-too-old');
  if (tcfPolicyVersion >= 4 && purposeLegitimateInterests.some((id) => NO_LEGITIMATE_INTEREST_FROM_POLICY_4.has(id))) {
    notes.push('legitimate-interest-not-allowed');
  }
  return {
    version, created, lastUpdated, cmpId, cmpVersion, consentScreen, consentLanguage, vendorListVersion,
    tcfPolicyVersion, isServiceSpecific, useNonStandardTexts, specialFeatureOptIns, purposeConsents,
    purposeLegitimateInterests, purposeOneTreatment, publisherCountry, vendorConsents, vendorLegitimateInterests,
    publisherRestrictions,
  };
}

/**
 * NumPubRestrictions, then per restriction a purpose, a type and its vendor ranges. The same purpose
 * and type may appear more than once in a real string (the IAB library's reported issue 201); their
 * ranges are merged into one entry, in the order the pair first appeared.
 */
function readRestrictions(r: BitReader): PublisherRestriction[] {
  const count = r.int(12, 'NumPubRestrictions');
  const byPair = new Map<string, { purposeId: number; restrictionType: RestrictionType; spans: IdSpan[] }>();
  for (let i = 0; i < count; i++) {
    const purposeId = r.int(6, 'PurposeId');
    const restrictionType = r.int(2, 'RestrictionType') as RestrictionType;
    const spans = r.rangeSpans('PubRestrictionEntry');
    const key = `${purposeId}:${restrictionType}`;
    const seen = byPair.get(key);
    if (seen) for (const span of spans) seen.spans.push(span);
    else byPair.set(key, { purposeId, restrictionType, spans });
  }
  return [...byPair.values()].map(({ purposeId, restrictionType, spans }) => ({
    purposeId, restrictionType, vendorRanges: mergeSpans(spans),
  }));
}

function readPublisherPurposes(r: BitReader): PublisherPurposes {
  const consents = r.flags(24, 'PubPurposesConsent');
  const legitimateInterests = r.flags(24, 'PubPurposesLITransparency');
  const customPurposeCount = r.int(6, 'NumCustomPurposes');
  const customConsents = r.flags(customPurposeCount, 'CustomPurposesConsent');
  const customLegitimateInterests = r.flags(customPurposeCount, 'CustomPurposesLITransparency');
  return { consents, legitimateInterests, customPurposeCount, customConsents, customLegitimateInterests };
}

/**
 * Decodes a TCF v2 consent string. Any input the standard does not allow comes back as an error
 * value; an exception escaping from here is a bug in this decoder, never a property of the input.
 */
export function decodeTcString(input: string): TcDecodeResult {
  if (typeof input !== 'string' || input.length === 0) {
    return { ok: false, error: { code: 'empty', segment: null, field: null, offset: 0 } };
  }
  if (input.length > MAX_LENGTH) {
    return { ok: false, error: { code: 'too-long', segment: null, field: null, offset: MAX_LENGTH } };
  }
  try {
    const parts = input.split('.');
    const notes: TcNote[] = [];

    const coreReader = new BitReader(sixBitValues(parts[0], 0), 'core');
    const core = readCore(coreReader, notes);
    if (coreReader.anyBitLeft()) notes.push('trailing-data');

    const optional: { disclosedVendors?: IdSet; allowedVendors?: IdSet; publisherPurposes?: PublisherPurposes } = {};
    let start = 0;
    for (let i = 1; i < parts.length; i++) {
      start += parts[i - 1].length + 1;
      const values = sixBitValues(parts[i], start);
      // A segment names its type in the first three bits of its first character.
      const name = values.length > 0 ? SEGMENT_NAMES[values[0] >> 3] : undefined;
      if (!name) throw new TcReadStop(values.length > 0 ? 'unknown-segment' : 'truncated', null, 'SegmentType', 0);
      const r = new BitReader(values, name);
      r.int(3, 'SegmentType');
      if (name === 'publisher-purposes') {
        if (optional.publisherPurposes) throw new TcReadStop('repeated-segment', name, 'SegmentType', 0);
        optional.publisherPurposes = readPublisherPurposes(r);
      } else if (name === 'disclosed-vendors') {
        if (optional.disclosedVendors) throw new TcReadStop('repeated-segment', name, 'SegmentType', 0);
        optional.disclosedVendors = r.vendorSection('DisclosedVendors');
      } else {
        if (optional.allowedVendors) throw new TcReadStop('repeated-segment', name, 'SegmentType', 0);
        optional.allowedVendors = r.vendorSection('AllowedVendors');
      }
      if (r.anyBitLeft()) notes.push('trailing-data');
    }
    if (!optional.disclosedVendors && core.lastUpdated >= DISCLOSED_VENDORS_REQUIRED_FROM) {
      notes.push('missing-disclosed-vendors');
    }
    return { ok: true, value: { core, ...optional, notes: [...new Set(notes)] } };
  } catch (stop) {
    if (!(stop instanceof TcReadStop)) throw stop;
    return { ok: false, error: { code: stop.code, segment: stop.segment, field: stop.field, offset: stop.offset } };
  }
}
