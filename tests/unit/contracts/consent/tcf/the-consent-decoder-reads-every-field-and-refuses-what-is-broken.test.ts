// The consent decoder, field by field, on strings written here from the standard's field tables (and,
// for the deprecated segment type 2, which the standard no longer lays out, the IAB library's layout).
//
// The published strings (the other test in this folder) leave most fields at zero and never reach the
// edges: a 36-bit timestamp at full width, the last purpose, a range that overlaps another, a custom
// purpose, a segment out of order. The writer below sets each of those on purpose. It is written from
// the same tables as the decoder, so on its own it would only show the two agree with each other; with
// the published strings beside it, a misread table shows up in one test or the other.

import { describe, expect, it } from 'vitest';
import { MAX_LENGTH, decodeTcString } from '../../../../../src/contracts/consent/tcf/decode';
import type { TcDecodeError, TcString } from '../../../../../src/contracts/consent/tcf/types';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** Writes fields as bits, then the bits as base64url characters, zero-padded to the last character. */
class Bits {
  private s = '';
  int(value: number, width: number): this {
    const b = value.toString(2);
    if (b.length > width) throw new Error(`${value} does not fit ${width} bits`);
    this.s += b.padStart(width, '0');
    return this;
  }
  bool(v: boolean): this { return this.int(v ? 1 : 0, 1); }
  flags(ids: number[], width: number): this {
    for (let id = 1; id <= width; id++) this.s += ids.includes(id) ? '1' : '0';
    return this;
  }
  letters(two: string): this {
    return this.int(two.charCodeAt(0) - 97, 6).int(two.charCodeAt(1) - 97, 6);
  }
  ranges(entries: ([number] | [number, number])[]): this {
    this.int(entries.length, 12);
    for (const e of entries) {
      this.bool(e.length === 2).int(e[0], 16);
      if (e.length === 2) this.int(e[1], 16);
    }
    return this;
  }
  vendorBitfield(maxId: number, ids: number[]): this { return this.int(maxId, 16).bool(false).flags(ids, maxId); }
  vendorRanges(maxId: number, entries: ([number] | [number, number])[]): this {
    return this.int(maxId, 16).bool(true).ranges(entries);
  }
  raw(bits: string): this { this.s += bits; return this; }
  toString(): string {
    const padded = this.s.padEnd(Math.ceil(this.s.length / 6) * 6, '0');
    let out = '';
    for (let i = 0; i < padded.length; i += 6) out += ALPHABET[parseInt(padded.slice(i, i + 6), 2)];
    return out;
  }
}

interface CoreFields {
  version: number; created: number; lastUpdated: number; cmpId: number; cmpVersion: number; consentScreen: number;
  language: string; vendorListVersion: number; policy: number; serviceSpecific: boolean; nonStandardTexts: boolean;
  specialFeatures: number[]; purposes: number[]; purposeLI: number[]; purposeOne: boolean; country: string;
  vendors: (b: Bits) => Bits; vendorLI: (b: Bits) => Bits; restrictions: (b: Bits) => Bits;
}

const PLAIN: CoreFields = {
  version: 2, created: 17_489_088_000, lastUpdated: 17_489_088_000, cmpId: 7, cmpVersion: 1, consentScreen: 1,
  language: 'en', vendorListVersion: 180, policy: 5, serviceSpecific: true, nonStandardTexts: false,
  specialFeatures: [], purposes: [1], purposeLI: [], purposeOne: false, country: 'ro',
  vendors: (b) => b.vendorBitfield(3, [2]), vendorLI: (b) => b.vendorBitfield(0, []), restrictions: (b) => b.int(0, 12),
};

/** Deciseconds, as the string holds them: 30 Sep 2023 at 00:00 UTC, and 1 Mar 2026 at 00:00 UTC. */
const BEFORE_OCT_2023 = Date.UTC(2023, 8, 30) / 100;
const MAR_1_2026 = Date.UTC(2026, 2, 1) / 100;

function core(over: Partial<CoreFields> = {}): Bits {
  const f = { ...PLAIN, ...over };
  const b = new Bits()
    .int(f.version, 6).int(f.created, 36).int(f.lastUpdated, 36).int(f.cmpId, 12).int(f.cmpVersion, 12)
    .int(f.consentScreen, 6).letters(f.language).int(f.vendorListVersion, 12).int(f.policy, 6)
    .bool(f.serviceSpecific).bool(f.nonStandardTexts).flags(f.specialFeatures, 12).flags(f.purposes, 24)
    .flags(f.purposeLI, 24).bool(f.purposeOne).letters(f.country);
  return f.restrictions(f.vendorLI(f.vendors(b)));
}

function ok(s: string): TcString {
  const r = decodeTcString(s);
  if (!r.ok) throw new Error(`expected a decode, got ${JSON.stringify(r.error)}`);
  return r.value;
}

function refused(s: string): TcDecodeError {
  const r = decodeTcString(s);
  if (r.ok) throw new Error('expected a refusal, got a decode');
  return r.error;
}

describe('the core segment, every field at a value of its own', () => {
  it('reads each field back, including a 36-bit timestamp at full width and the last purpose', () => {
    const s = core({
      created: 2 ** 36 - 1, lastUpdated: 17_489_088_001, cmpId: 4095, cmpVersion: 4094, consentScreen: 63,
      language: 'zz', vendorListVersion: 4093, policy: 63, nonStandardTexts: true,
      specialFeatures: [1, 12], purposes: [1, 11, 24], purposeLI: [2, 7, 24], purposeOne: true, country: 'az',
    }).toString();
    expect(ok(s).core).toMatchObject({
      version: 2,
      created: (2 ** 36 - 1) * 100,
      lastUpdated: 1_748_908_800_100,
      cmpId: 4095, cmpVersion: 4094, consentScreen: 63, consentLanguage: 'zz', vendorListVersion: 4093,
      tcfPolicyVersion: 63, isServiceSpecific: true, useNonStandardTexts: true,
      specialFeatureOptIns: [1, 12], purposeConsents: [1, 11, 24], purposeLegitimateInterests: [2, 7, 24],
      purposeOneTreatment: true, publisherCountry: 'AZ',
    });
  });

  it('reads a range-encoded vendor section with singles and overlapping ranges as one sorted set', () => {
    const s = core({
      vendors: (b) => b.vendorRanges(900, [[900], [5, 9], [7, 12], [3]]),
      vendorLI: (b) => b.vendorRanges(40, [[40]]),
    }).toString();
    const { core: c } = ok(s);
    expect(c.vendorConsents).toEqual({ maxId: 900, ids: [3, 5, 6, 7, 8, 9, 10, 11, 12, 900] });
    expect(c.vendorLegitimateInterests).toEqual({ maxId: 40, ids: [40] });
  });

  it('reads 4,095 overlapping ranges over every possible id quickly, as one set', () => {
    const every: [number, number][] = Array.from({ length: 4095 }, () => [1, 65_535]);
    const s = core({ vendors: (b) => b.vendorRanges(65_535, every) }).toString();
    const started = performance.now();
    const ids = ok(s).core.vendorConsents.ids;
    expect(ids).toHaveLength(65_535);
    expect(ids[0]).toBe(1);
    expect(ids.at(-1)).toBe(65_535);
    // Generous for a slow machine; the unmerged loop took seconds.
    expect(performance.now() - started).toBeLessThan(1500);
  });

  it('reads 4,095 restrictions that repeat one pair over every possible id quickly, as one entry', () => {
    const s = core({
      restrictions: (b) => {
        b.int(4095, 12);
        for (let i = 0; i < 4095; i++) b.int(1, 6).int(1, 2).ranges([[1, 65_535]]);
        return b;
      },
    }).toString();
    const started = performance.now();
    const restrictions = ok(s).core.publisherRestrictions;
    expect(restrictions).toEqual([{ purposeId: 1, restrictionType: 1, vendorRanges: [[1, 65_535]] }]);
    // Generous for a slow machine; merging per repeat rebuilt and sorted 65,535 ids 4,095 times.
    expect(performance.now() - started).toBeLessThan(1500);
  });

  it('reads all 256 purpose and type pairs over every possible id quickly, as ranges and not 16.7 million ids', () => {
    const s = core({
      restrictions: (b) => {
        b.int(256, 12);
        for (let purposeId = 0; purposeId < 64; purposeId++) {
          for (let type = 0; type < 4; type++) b.int(purposeId, 6).int(type, 2).ranges([[1, 65_535]]);
        }
        return b;
      },
    }).toString();
    expect(s.length).toBeLessThan(2400);
    const started = performance.now();
    const restrictions = ok(s).core.publisherRestrictions;
    expect(restrictions).toHaveLength(256);
    for (const r of restrictions) expect(r.vendorRanges).toEqual([[1, 65_535]]);
    expect(performance.now() - started).toBeLessThan(1500);
  });

  it('merges a purpose and restriction type that the string gives twice', () => {
    const s = core({
      restrictions: (b) => b.int(3, 12)
        .int(2, 6).int(0, 2).ranges([[8, 9]])
        .int(7, 6).int(1, 2).ranges([[4]])
        .int(2, 6).int(0, 2).ranges([[1], [9]]),
    }).toString();
    // 1 and 8 to 9 stay apart; 9 given twice is kept once.
    expect(ok(s).core.publisherRestrictions).toEqual([
      { purposeId: 2, restrictionType: 0, vendorRanges: [[1, 1], [8, 9]] },
      { purposeId: 7, restrictionType: 1, vendorRanges: [[4, 4]] },
    ]);
  });

  it('joins restriction ranges that touch, so one id range is one entry', () => {
    const s = core({ restrictions: (b) => b.int(1, 12).int(3, 6).int(2, 2).ranges([[5, 6], [1, 4], [7]]) }).toString();
    expect(ok(s).core.publisherRestrictions).toEqual([{ purposeId: 3, restrictionType: 2, vendorRanges: [[1, 7]] }]);
  });
});

describe('the segments after the core', () => {
  const disclosed = new Bits().int(1, 3).vendorRanges(300, [[1, 3], [300]]).toString();
  const allowed = new Bits().int(2, 3).vendorBitfield(5, [5]).toString();
  const publisher = new Bits().int(3, 3).flags([1, 2], 24).flags([24], 24).int(3, 6).raw('101').raw('010').toString();

  it('reads disclosed vendors, the deprecated allowed vendors, and publisher purposes with custom purposes', () => {
    const v = ok([core().toString(), disclosed, allowed, publisher].join('.'));
    expect(v.disclosedVendors).toEqual({ maxId: 300, ids: [1, 2, 3, 300] });
    expect(v.allowedVendors).toEqual({ maxId: 5, ids: [5] });
    expect(v.publisherPurposes).toEqual({
      consents: [1, 2], legitimateInterests: [24], customPurposeCount: 3, customConsents: [1, 3], customLegitimateInterests: [2],
    });
  });

  it('reads them in any order, as the standard allows', () => {
    const a = ok([core().toString(), publisher, disclosed].join('.'));
    const b = ok([core().toString(), disclosed, publisher].join('.'));
    expect(a).toEqual(b);
  });

  it('accepts trailing base64 padding, which carries no bits (the standard names no rule for it)', () => {
    expect(ok(`${core().toString()}==.${disclosed}=`)).toEqual(ok(`${core().toString()}.${disclosed}`));
  });

  it('refuses a long run of padding that does not end the segment, quickly, at its first character', () => {
    const c = core().toString();
    const started = performance.now();
    // Under MAX_LENGTH, so the string is read and the cut itself is what is timed.
    expect(refused(`${c}.${'='.repeat(60_000)}A`)).toMatchObject({ code: 'bad-character', offset: c.length + 1 });
    // A trailing-'=' regular expression backtracks quadratically over this input.
    expect(performance.now() - started).toBeLessThan(1500);
  });
});

describe('a string that decodes but breaks a rule of the standard is decoded, with a note', () => {
  it('notes a string that is not service specific', () => {
    expect(ok(core({ serviceSpecific: false }).toString()).notes).toEqual(['not-service-specific']);
  });

  it('notes legitimate interest claimed for purposes 3 to 6 at policy version 4 or later, and only there', () => {
    expect(ok(core({ purposeLI: [3] }).toString()).notes).toEqual(['legitimate-interest-not-allowed']);
    expect(ok(core({ purposeLI: [6] }).toString()).notes).toEqual(['legitimate-interest-not-allowed']);
    expect(ok(core({ purposeLI: [1, 2, 7, 24] }).toString()).notes).toEqual([]);
    // Policy 2, before the rule: allowed then, so not held against the string.
    expect(ok(core({ policy: 2, created: BEFORE_OCT_2023, lastUpdated: BEFORE_OCT_2023, purposeLI: [3] }).toString()).notes)
      .toEqual([]);
  });

  it('notes a policy version below 4 on a string last updated after 30 Sep 2023, and not before', () => {
    expect(ok(core({ policy: 3 }).toString()).notes).toEqual(['policy-version-too-old']);
    expect(ok(core({ policy: 3, created: BEFORE_OCT_2023, lastUpdated: BEFORE_OCT_2023 }).toString()).notes).toEqual([]);
  });

  it('notes a string last updated from 1 Mar 2026 with no disclosed vendors segment, and not one with it or before', () => {
    const from = { created: MAR_1_2026, lastUpdated: MAR_1_2026 };
    expect(ok(core(from).toString()).notes).toEqual(['missing-disclosed-vendors']);
    const disclosed = new Bits().int(1, 3).vendorBitfield(1, [1]).toString();
    expect(ok(`${core(from).toString()}.${disclosed}`).notes).toEqual([]);
    expect(ok(core({ created: MAR_1_2026 - 1, lastUpdated: MAR_1_2026 - 1 }).toString()).notes).toEqual([]);
  });

  it('notes a 1 bit past the last field, and keeps everything it read', () => {
    const v = ok(core().raw('000001').toString());
    expect(v.notes).toEqual(['trailing-data']);
    expect(v.core.vendorConsents.ids).toEqual([2]);
  });

  it('notes a 1 bit past the last field of a later segment too', () => {
    const disclosed = new Bits().int(1, 3).vendorBitfield(2, [2]).raw('1').toString();
    const v = ok(`${core().toString()}.${disclosed}`);
    expect(v.notes).toEqual(['trailing-data']);
    expect(v.disclosedVendors).toEqual({ maxId: 2, ids: [2] });
  });

  it('says nothing about zero bits after the last field, which are padding', () => {
    expect(ok(core().raw('000000000000').toString()).notes).toEqual([]);
  });
});

describe('what the decoder refuses, and how it says where', () => {
  it('refuses an empty string', () => {
    expect(refused('')).toEqual({ code: 'empty', segment: null, field: null, offset: 0 });
  });

  it('refuses a string longer than MAX_LENGTH without reading it, and reads one at the limit', () => {
    const c = core().toString();
    expect(refused(c + 'A'.repeat(MAX_LENGTH + 1 - c.length)))
      .toEqual({ code: 'too-long', segment: null, field: null, offset: MAX_LENGTH });
    // Zero bits after the last field are padding, so a string padded to the limit still decodes.
    expect(ok(c + 'A'.repeat(MAX_LENGTH - c.length)).core.cmpId).toBe(7);
  });

  it('refuses a character outside base64url and gives its place in the whole string', () => {
    const c = core().toString();
    expect(refused(`${c.slice(0, 4)}+${c.slice(5)}`)).toMatchObject({ code: 'bad-character', offset: 4 });
    expect(refused(`${c}.I/`)).toMatchObject({ code: 'bad-character', offset: c.length + 2 });
  });

  it('refuses any version but 2', () => {
    expect(refused(core({ version: 3 }).toString())).toMatchObject({ code: 'unsupported-version', field: 'Version' });
  });

  it('refuses a string cut inside a field and names the field', () => {
    // Fifteen characters are 90 bits: version, both timestamps and the CMP id, and nothing of its version.
    const full = core().toString();
    expect(refused(full.slice(0, 15))).toMatchObject({ code: 'truncated', segment: 'core', field: 'CmpVersion', offset: 90 });
  });

  it('refuses a letter outside a to z', () => {
    // ConsentLanguage starts at bit 108 (version 6, two timestamps 72, CMP id, version and screen 30),
    // which is exactly character 18, so replacing that character replaces the first letter. The value
    // 26 is the six-bit code one past z.
    const chars = [...core().toString()];
    chars[18] = ALPHABET[26];
    expect(refused(chars.join(''))).toMatchObject({ code: 'bad-letter', field: 'ConsentLanguage', offset: 108 });
  });

  it('refuses a range whose end is before its start', () => {
    const s = core({ vendors: (b) => b.vendorRanges(50, [[9, 4]]) }).toString();
    expect(refused(s)).toMatchObject({ code: 'bad-range', segment: 'core', field: 'VendorConsents' });
  });

  it('refuses an id above the declared maximum, and the id 0', () => {
    expect(refused(core({ vendors: (b) => b.vendorRanges(10, [[3, 11]]) }).toString()))
      .toMatchObject({ code: 'id-out-of-range', field: 'VendorConsents' });
    expect(refused(core({ vendors: (b) => b.vendorRanges(10, [[0]]) }).toString()))
      .toMatchObject({ code: 'id-out-of-range', field: 'VendorConsents' });
  });

  it('refuses a segment type the standard does not define', () => {
    const unknown = new Bits().int(5, 3).int(0, 21).toString();
    expect(refused(`${core().toString()}.${unknown}`)).toMatchObject({ code: 'unknown-segment', segment: null });
  });

  it('refuses the same segment twice', () => {
    const disclosed = new Bits().int(1, 3).vendorBitfield(1, [1]).toString();
    expect(refused(`${core().toString()}.${disclosed}.${disclosed}`))
      .toMatchObject({ code: 'repeated-segment', segment: 'disclosed-vendors' });
  });

  it('refuses an empty segment after a dot', () => {
    expect(refused(`${core().toString()}.`)).toMatchObject({ code: 'truncated', field: 'SegmentType' });
  });
});

describe('no input makes it throw', () => {
  // A seeded generator (mulberry32, in 32-bit integer steps so no product loses precision), so a
  // failure names an input that can be run again.
  function* strings(seed: number, count: number): Generator<string> {
    let x = seed >>> 0;
    const next = () => {
      x = (x + 0x6d2b79f5) >>> 0;
      let t = Math.imul(x ^ (x >>> 15), x | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return (t ^ (t >>> 14)) >>> 0;
    };
    const chars = `${ALPHABET}..=+/ `;
    for (let i = 0; i < count; i++) {
      const length = next() % 120;
      let s = '';
      for (let j = 0; j < length; j++) s += chars[next() % chars.length];
      yield s;
    }
  }

  it('returns a value for 3,000 random strings and for every prefix of a real one', () => {
    const real = 'CQSbk4AQSbk4ANwAAAENAwCgAAAAAAAAAAYgACPAAAAA.IDKQA4AAgAKAGQAygAAA.YAAAAAAAAAAA';
    const inputs = [...strings(20_261_009, 3000), ...[...real].map((_, i) => real.slice(0, i))];
    for (const s of inputs) {
      const r = decodeTcString(s);
      expect(typeof r.ok, s).toBe('boolean');
    }
  });
});
