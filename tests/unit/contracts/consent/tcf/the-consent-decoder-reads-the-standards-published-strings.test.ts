// The consent decoder held against strings other people published, not strings this repository made.
//
// Sources, read 9 Oct 2026 (copies kept with the Contracts design, design/sources/):
//   - the standard: "Consent string and vendor list formats v2", IAB Tech Lab, GDPR-Transparency-and-
//     Consent-Framework repository, file TCFv2/IAB Tech Lab - Consent string and vendor list formats v2.md;
//   - the IAB's own library, iabtcf-es, modules/core/test/ReportedIssues.test.ts at 9530951.
// Three strings come from pages not copied there; the Contracts research seat recorded each with its
// address and the fields the page prints (research/02-tcf.md, sections 4.8 and 4.9, vectors T2 to T4).
//
// Two kinds of expected value, kept apart on purpose:
//   ASSERTED: the source itself states or asserts the value (a library test's expect, the standard's text).
//   SECOND DECODER: the source states nothing, and the value was read by an independent decoder written
//   from the same standard by someone else (design/sources/tcf-second-decoder.py, rerunnable with Python).
// A disagreement with an ASSERTED value is a bug here. A disagreement with a SECOND DECODER value is a
// bug in one of the two, and is settled against the standard's text, never by editing the number.

import { describe, expect, it } from 'vitest';
import { decodeTcString } from '../../../../../src/contracts/consent/tcf/decode';
import type { IdSpan, PublisherRestriction, TcString } from '../../../../../src/contracts/consent/tcf/types';

function decoded(s: string): TcString {
  const result = decodeTcString(s);
  if (!result.ok) throw new Error(`expected a decode, got ${JSON.stringify(result.error)}`);
  return result.value;
}

/** Ranges spelled out as ids, the form the sources print. */
function idsIn(ranges: readonly IdSpan[]): number[] {
  return ranges.flatMap(([first, last]) => Array.from({ length: last - first + 1 }, (_, i) => first + i));
}

function spelledOut({ purposeId, restrictionType, vendorRanges }: PublisherRestriction) {
  return { purposeId, restrictionType, vendorIds: idsIn(vendorRanges) };
}

const DAY_2025_06_03 = Date.UTC(2025, 5, 3);

describe("the standard's own example string", () => {
  // ASSERTED, and only this: the standard prints the string as its example of a TC String made of the
  // core, the disclosed vendors and the publisher segment. It states no decoded value; every value
  // below that is not one of those three segments is SECOND DECODER, or this decoder's own rule.
  const EXAMPLE = 'CQSbk4AQSbk4ANwAAAENAwCgAAAAAAAAAAYgACPAAAAA.IDKQA4AAgAKAGQAygAAA.YAAAAAAAAAAA';

  it('decodes, with the three segments the standard names', () => {
    const v = decoded(EXAMPLE);
    expect(v.disclosedVendors).toBeDefined();
    expect(v.publisherPurposes).toBeDefined();
    expect(v.allowedVendors).toBeUndefined();
  });

  it("notes that its own policy version, 2, breaks the standard's rule for a string made in 2025", () => {
    expect(decoded(EXAMPLE).notes).toEqual(['policy-version-too-old']);
  });

  it('carries created and last updated as the same day at midnight UTC, as the standard has required since Dec 2021', () => {
    const { core } = decoded(EXAMPLE);
    expect(core.created).toBe(core.lastUpdated);
    expect(core.created % 86_400_000).toBe(0);
  });

  it('reads every core field as the second decoder does', () => {
    // SECOND DECODER, every value below.
    const { core } = decoded(EXAMPLE);
    expect(core).toEqual({
      version: 2,
      created: DAY_2025_06_03,
      lastUpdated: DAY_2025_06_03,
      cmpId: 880,
      cmpVersion: 0,
      consentScreen: 0,
      consentLanguage: 'en',
      vendorListVersion: 48,
      tcfPolicyVersion: 2,
      isServiceSpecific: true,
      useNonStandardTexts: false,
      specialFeatureOptIns: [],
      purposeConsents: [],
      purposeLegitimateInterests: [],
      purposeOneTreatment: false,
      publisherCountry: 'DE',
      vendorConsents: { maxId: 4, ids: [1, 2, 3, 4] },
      vendorLegitimateInterests: { maxId: 0, ids: [] },
      publisherRestrictions: [],
    });
  });

  it('reads the range-encoded disclosed vendors and the empty publisher segment as the second decoder does', () => {
    // SECOND DECODER.
    const v = decoded(EXAMPLE);
    expect(v.disclosedVendors).toEqual({ maxId: 404, ids: [1, 2, 3, 4, 5, 100, 404] });
    expect(v.publisherPurposes).toEqual({
      consents: [], legitimateInterests: [], customPurposeCount: 0, customConsents: [], customLegitimateInterests: [],
    });
  });
});

describe("the IAB library's reported issue 201: a restriction encoded more than once", () => {
  const ISSUE_201 =
    'CO4VGswO4VGswAfZCBDEAzCsAP_AAH_AAAigGUNf_X9fb2vj-_599_t0eY1f9_63t-wzjheMs-8NyZ-X_J4Wv2MyvB34JqQKGRgkunLBAQdtHGncTQgBwIlViTLMY02MjzNKJrJEilsbe2dYGH9vn8XT_ZKZ70-_v__7v3___33_5Ayhr_6_r7e18f3_Pvv9ujzGr_v_W9v2GccLxln3huTPy_5PC1-xmV4O_BNSBQyMEl05YICDto407iaEAOBEqsSZZjGmxkeZpRNZIkUtjb2zrAw_t8_i6f7JTPen39___d-___--__ICgKAOAAcAA4AFAAjgB6AEYALcGACAW0AtoJAHAAOAAcACgARwA9ACMAFuFABALaAW0GgDgAHAAOABQAI4AegBGAC3DgAgFtALaEQBwADgAHAAoAEcAPQAjABbiQAQC2gFtCoA4ABwADgAUACOAHoARgAtxYAIBbQC2hkAcAA4ABwAKABHAD0AIwAW40AEAtoBbQ6AOAAcAA4AFAAjgB6AEYALceACAW0AtohAHAAOAAcACgARwA9ACMAFuRABALaAW0SgDgAHAAOABQAI4AegBGAC3JgAgFtALaKQBwADgAHAAoAEcAPQAjABblQAQC2gFtA';

  it('decodes as version 2', () => {
    // ASSERTED: `expect(tcModel.version).to.equal(2)`.
    expect(decoded(ISSUE_201).core.version).toBe(2);
  });

  it('gives purpose 1, restriction type 1, the vendors 7, 20, 71, 122, 140 and 183', () => {
    // ASSERTED: `getVendors(new PurposeRestriction(1, 1))` deep-equals this list.
    const r = decoded(ISSUE_201).core.publisherRestrictions.find((x) => x.purposeId === 1 && x.restrictionType === 1);
    expect(idsIn(r?.vendorRanges ?? [])).toEqual([7, 20, 71, 122, 140, 183]);
  });

  it('keeps one entry per purpose and type, however often the string repeats the pair', () => {
    const pairs = decoded(ISSUE_201).core.publisherRestrictions.map((x) => `${x.purposeId}:${x.restrictionType}`);
    expect(new Set(pairs).size).toBe(pairs.length);
  });

  it('reads the rest of the core as the second decoder does', () => {
    // SECOND DECODER.
    const { core } = decoded(ISSUE_201);
    expect(core.cmpId).toBe(31);
    expect(core.cmpVersion).toBe(1602);
    expect(core.vendorListVersion).toBe(51);
    expect(core.tcfPolicyVersion).toBe(2);
    expect(core.consentLanguage).toBe('de');
    expect(core.publisherCountry).toBe('EU');
    expect(core.specialFeatureOptIns).toEqual([1, 2]);
    expect(core.purposeConsents).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(core.purposeLegitimateInterests).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(core.vendorConsents.maxId).toBe(808);
    expect(core.vendorConsents.ids).toHaveLength(479);
    expect(core.vendorLegitimateInterests.maxId).toBe(808);
    expect(core.vendorLegitimateInterests.ids).toHaveLength(479);
    expect(core.publisherRestrictions).toHaveLength(20);
    for (let purposeId = 1; purposeId <= 10; purposeId++) {
      const forPurpose = core.publisherRestrictions.filter((x) => x.purposeId === purposeId).map(spelledOut);
      expect(forPurpose).toEqual([
        { purposeId, restrictionType: 1, vendorIds: [7, 20, 71, 122, 140, 183] },
        { purposeId, restrictionType: 2, vendorIds: [730] },
      ]);
    }
  });

  it('notes nothing: its legitimate interest bits for purposes 3 to 6 were allowed under policy 2, before the 2.2 rule', () => {
    expect(decoded(ISSUE_201).notes).toEqual([]);
  });
});

describe("the IAB library's reported issue 142: a bit field shorter than its declared maximum", () => {
  // ASSERTED: the library's test expects `TCString.decode` to throw on this string. Here the same
  // refusal is an error value, and it names where the string ran out.
  const ISSUE_142 =
    'CLSYjTaOngnCIAOABBENAXCMAGOAABBAAA7IA5n-m7fP6_3fbqVv6E__PoA5Aqff3aJx8tv_1967rfnQEQoAIAAQCrwkAEABAcACABIMACAAuApEVABABUSABgBCAVSAtIoACACIArYQAHACgAFgAVwBJgDcAI7AWgMAAgBiKgAgBMgFfKQAQBRkQAQA4AFiBAAoA-AEVAJlAVgAtYcACAJcAr4eABAK8OgBgFzAOmAqwgABAWyA.IFukWSQh';

  it('is refused, in the disclosed vendors segment, as truncated', () => {
    const result = decodeTcString(ISSUE_142);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('truncated');
    expect(result.error.segment).toBe('disclosed-vendors');
    expect(result.error.field).toBe('DisclosedVendors.BitField');
  });
});

describe("the IAB library's reported issues 156 and 191: version 1 strings", () => {
  // ASSERTED for 156 only: the library's test expects version 1. The test for 191 asserts only that
  // vendor consents are not empty; its string starts with the same six bits (B, version 1), read here
  // directly. The standard has called version 1 invalid since 30 Sep 2020, so this decoder refuses
  // both by name rather than reading an obsolete layout.
  it.each([
    ['156', 'BOhwdphOxFC7tAHABBFRC--AAAAuhr_7__7-_9_-_f__9uj3Or_v_f__32ccL59v_h_7v-_7fi_20nV4u_1vft9yfk1-5ctDztp507iakivXmqdeb9v_nz3_5pxP78k89r7337Ew_v8_v-b7BCON_YxEiA'],
    ['191', 'BO2e4qiO2e4qiB9ABADEDS-AAAAxKABgACBiQA'],
  ])('issue %s is refused as an unsupported version', (_issue, s) => {
    const result = decodeTcString(s);
    expect(result).toEqual({
      ok: false,
      error: { code: 'unsupported-version', segment: 'core', field: 'Version', offset: 0 },
    });
  });
});

describe("the IAB library's reported issue 220: a core with empty range-encoded vendor sections", () => {
  // Source: iabtcf-es modules/cmpapi/test/ReportedIssues.test.ts, test 220 (a different file from the
  // core one copied with the design), as the research seat recorded it (research/02-tcf.md, T4).
  // ASSERTED: nothing about the decode (that test checks event order only). SECOND DECODER: every value
  // below. It is kept because it is the one published string whose vendor sections are range-encoded
  // with no entries, and whose timestamps are the old, decisecond-exact kind.
  const ISSUE_220 = 'CO5dPi4O5dPx2B7DvCENA2CgAAAAAAAAAAAAGewAAM8gAAAA.YAAAAAAAAAAA';

  it('reads the empty ranges, the exact timestamps and the publisher segment', () => {
    const v = decoded(ISSUE_220);
    expect(v.core.created).toBe(15_996_352_696 * 100);
    expect(v.core.lastUpdated).toBe(15_996_353_654 * 100);
    expect(v.core.cmpId).toBe(123);
    expect(v.core.cmpVersion).toBe(239);
    expect(v.core.consentScreen).toBe(2);
    expect(v.core.vendorListVersion).toBe(54);
    expect(v.core.publisherCountry).toBe('AA');
    expect(v.core.vendorConsents).toEqual({ maxId: 829, ids: [] });
    expect(v.core.vendorLegitimateInterests).toEqual({ maxId: 828, ids: [] });
    expect(v.disclosedVendors).toBeUndefined();
    expect(v.publisherPurposes?.consents).toEqual([]);
  });
});

describe("a consent tool vendor's published sample, with the decoded fields its page prints", () => {
  // Source: OneTrust developer documentation, "TC String Encoder", read 9 Oct 2026 by the Contracts
  // research seat, which copied the printed fields into research/02-tcf.md section 4.8. ASSERTED, as
  // copied there: the fields the page prints beside the string, which it gives as bit strings
  // ("1111111111"); turned into id lists here, nothing else.
  const ONETRUST =
    'CQgipwAQgipwAAcABBENCUFtAP_AAEPAAAAAADNQLzgBAABAXmAIOABgAoAB0AuQgABAXISAAgAoKAAwAUAA6AXI.YAAAAAAAAAAA.IAEPcAAA';

  it('gives the fields the vendor printed', () => {
    const v = decoded(ONETRUST);
    expect(v.core).toMatchObject({
      cmpId: 28, cmpVersion: 1, tcfPolicyVersion: 5, isServiceSpecific: true, useNonStandardTexts: false,
      purposeOneTreatment: false, publisherCountry: 'AA',
      purposeConsents: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      purposeLegitimateInterests: [2, 7, 8, 9, 10],
      specialFeatureOptIns: [1, 2, 4],
    });
    expect(v.core.vendorConsents.ids).toEqual([1, 2, 4, 6]);
    expect(v.disclosedVendors?.ids).toEqual([1, 2, 3, 4, 6, 7, 8]);
  });

  it('reads the range-encoded legitimate interests and the four restrictions as two other decoders do', () => {
    // SECOND DECODER, and the research seat's own decoder gave the same (research/02-tcf.md 4.8).
    const v = decoded(ONETRUST);
    expect(v.core.created).toBe(Date.UTC(2026, 2, 4));
    expect(v.core.vendorListVersion).toBe(148);
    expect(v.core.vendorLegitimateInterests).toEqual({ maxId: 755, ids: [1, 755] });
    expect(v.core.publisherRestrictions.map(spelledOut)).toEqual([
      { purposeId: 7, restrictionType: 0, vendorIds: [40, 58, 740] },
      { purposeId: 8, restrictionType: 0, vendorIds: [740] },
      { purposeId: 9, restrictionType: 0, vendorIds: [40] },
      { purposeId: 10, restrictionType: 0, vendorIds: [40, 58, 740] },
    ]);
    expect(v.disclosedVendors?.maxId).toBe(8);
    expect(v.notes).toEqual([]);
  });
});

describe("the IAB library's command-line README example: nothing consented, global scope", () => {
  // Source: iabtcf-es modules/cli/README.md, read 9 Oct 2026 by the research seat, which copied the
  // printed fields into research/02-tcf.md 4.9, T3. ASSERTED, as copied there: every field below. Its
  // printed created date does not match the string's bits (T3), so no date is asserted.
  const README = 'COrVd1pOrVd1pACABCENAHCAAAAAAAAAAAiQAAAAAAAA';

  it('gives the fields the README printed, and notes the global scope the standard no longer allows', () => {
    const v = decoded(README);
    expect(v.core).toMatchObject({
      version: 2, cmpId: 2, cmpVersion: 1, consentScreen: 2, consentLanguage: 'en', tcfPolicyVersion: 2,
      isServiceSpecific: false, useNonStandardTexts: false, purposeOneTreatment: false, publisherCountry: 'ES',
      vendorListVersion: 7,
    });
    expect(v.core.purposeConsents).toEqual([]);
    expect(v.core.vendorConsents).toEqual({ maxId: 0, ids: [] });
    expect(v.notes).toEqual(['not-service-specific']);
  });
});

describe('a string kept in a comment of the IAB library, with all three segments and policy version 5', () => {
  // ASSERTED: nothing (it sits in a disabled test). SECOND DECODER: every value below.
  const IN_A_COMMENT = 'CPTtLAAPTtLAAAKAAAENAAFgALwAAEAAAAAAAOgAgABgAAAA.IAoAAgABgAAEAQAAEAAA.d4AACEAAAAAA';

  it('reads purposes, vendors, disclosed vendors and the publisher purposes', () => {
    const v = decoded(IN_A_COMMENT);
    expect(v.core.created).toBe(Date.UTC(2022, 1, 1));
    expect(v.core.cmpId).toBe(10);
    expect(v.core.tcfPolicyVersion).toBe(5);
    expect(v.core.purposeConsents).toEqual([1, 3, 4, 5, 6]);
    expect(v.core.purposeLegitimateInterests).toEqual([2]);
    expect(v.core.vendorConsents).toEqual({ maxId: 29, ids: [11, 28, 29] });
    expect(v.core.vendorLegitimateInterests).toEqual({ maxId: 0, ids: [] });
    expect(v.disclosedVendors).toEqual({ maxId: 80, ids: [11, 28, 29, 50, 60, 80] });
    expect(v.publisherPurposes).toEqual({
      consents: [1, 3, 4, 5, 6], legitimateInterests: [2, 7],
      customPurposeCount: 0, customConsents: [], customLegitimateInterests: [],
    });
    expect(v.notes).toEqual([]);
  });
});
