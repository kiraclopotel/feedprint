// Three panels counted techniques and only one of them folded the spellings.
//
// technique-canonical.ts exists because the judge drifts between spellings of
// one technique, and its map is full of Romanian for the same reason:
// 'genuine-opinie' and 'opinie sincera' are 'genuine-opinion', 'batjocura' is
// 'mockery'. StatisticsTab has always run names through it. Group Behavior and
// the account ledger counted the raw name.
//
// Two consequences on a chain with variant spellings, which is every chain this
// judge has written in Romanian. One technique's votes split across its
// spellings, so the dominant technique can be named wrongly. And the label
// falls through to the raw id, because PRETTY_TECHNIQUE is keyed on the
// canonical names, so a reader sees 'opinie sincera' where the rest of the
// dashboard says 'Genuine opinion'.

import { describe, it, expect } from 'vitest';
import type { ForensicRecord } from '../../../../../src/types/forensic';
import { canonicalizeTechniqueForStats } from '../../../../../src/forensics/technique-canonical';
import { computeGroupBehavior } from '../../../../../src/ui/dashboard/components/group-behavior';
import { computeAccountLedger } from '../../../../../src/ui/dashboard/components/account-ledger';

let seq = 0;
function flagged(techniques: string[], over: Partial<ForensicRecord> = {}): ForensicRecord {
  seq += 1;
  return {
    id: `r-${seq}`,
    timestamp: new Date(Date.parse('2026-07-01T10:00:00Z') + seq * 600_000).toISOString(),
    platform: 'twitter',
    originalText: `item ${seq}`,
    originalHash: 'h',
    originalLength: 6,
    neutralizedText: '',
    author: '@someone',
    postUrl: '',
    techniques: techniques.map((name) => ({ name, severity: 6, confidence: 1 })),
    overallScore: 6,
    userAgeCategory: 'adult',
    aiSource: 'cloud',
    feedSource: 'for-you',
    integrityHash: 'deadbeef',
    signature: 'sig',
    publicKeyFingerprint: 'fp',
    chainPosition: seq,
    kind: 'post',
    verdict: 'flagged',
    ...over,
  } as unknown as ForensicRecord;
}

describe('one spelling of a technique (2026-09-19)', () => {
  it('the map really does fold the spellings this judge emits', () => {
    // The premise, asserted rather than assumed. If the map ever stops folding
    // these, the two panels below inherit that and this is where it shows.
    expect(canonicalizeTechniqueForStats('genuine-opinie')).toBe('genuine-opinion');
    expect(canonicalizeTechniqueForStats('opinie sinceră')).toBe('genuine-opinion');
    expect(canonicalizeTechniqueForStats('batjocură')).toBe('mockery');
    expect(canonicalizeTechniqueForStats('genuine-opinion')).toBe('genuine-opinion');
  });

  it('an unknown label is left exactly as it came', () => {
    // The map passes unknowns through, so folding cannot invent a technique.
    expect(canonicalizeTechniqueForStats('something-nobody-has-seen')).toBe('something-nobody-has-seen');
  });

  it('a group names the dominant technique across its spellings', () => {
    // Two records of one technique under two spellings, one of another. Raw,
    // the two spellings score one each and the single shame-attack ties or
    // wins; folded, the technique that really dominates is named.
    // computeGroupBehavior only looks at records from a Facebook group, so the
    // fixture has to say which group it came from or nothing is aggregated.
    const inGroup = { accountType: 'group', sourceContainer: 'A local group' } as Partial<ForensicRecord>;
    const records = [
      flagged(['genuine-opinie'], inGroup),
      flagged(['opinie sinceră'], inGroup),
      flagged(['shame-attack'], inGroup),
    ];
    const groups = computeGroupBehavior(records);
    expect(groups.length, 'the fixture reaches the aggregation at all').toBe(1);
    const dominant = groups.map((g) => g.dominantTechnique);

    expect(dominant, 'the folded name, never a raw spelling').toContain('genuine-opinion');
    expect(dominant).not.toContain('genuine-opinie');
    expect(dominant).not.toContain('opinie sinceră');
  });

  it('the account ledger does the same', () => {
    const records = [
      flagged(['batjocură']),
      flagged(['mockery']),
    ];
    const rows = computeAccountLedger(records, { minFlagged: 1 });
    const names = rows.flatMap((r) => r.techniques.map((t) => t.name));
    const mockery = rows.flatMap((r) => r.techniques).find((t) => t.name === 'mockery');

    expect(names, 'the Romanian spelling was folded, not counted apart')
      .not.toContain('batjocură');
    expect(mockery?.count, 'two spellings, one technique, two votes').toBe(2);
  });

  it('a chain with no drift in it is counted exactly as before', () => {
    const records = [flagged(['shame-attack']), flagged(['shame-attack'])];
    const rows = computeAccountLedger(records, { minFlagged: 1 });
    expect(rows[0]?.techniques.map((t) => t.name)).toEqual(['shame-attack']);
    expect(rows[0]?.techniques[0]?.count).toBe(2);
  });
});
