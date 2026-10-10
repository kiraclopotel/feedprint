// Feed behavior data derivation — semantics locks.
//
// The load-bearing contracts:
// 1. Verdict buckets and sittings mirror overview-data (one definition of
//    "flagged" and "a sitting" across the dashboard).
// 2. Runs read the whole-set serve order; skew reads thirds of 6+ sittings.
// 3. A return item is the first record after a 2h+ quiet gap.
// 4. Level 5 cautions and the prediction are RULE-GATED: no line without its
//    evidence threshold, so the interpretation card can never outrun the
//    record.
import { describe, it, expect } from 'vitest';
import type { ForensicRecord } from '../../../../../src/types/forensic';
import {
  computeFeedBehavior,
  pct1,
  CAUTION_RUN_MIN,
  CAUTION_RETURN_MIN_SAMPLES,
  CAUTION_CHAIN_MIN,
} from '../../../../../src/ui/dashboard/components/feed-behavior-data';

let seq = 0;
function rec(partial: Partial<ForensicRecord>): ForensicRecord {
  seq++;
  return {
    id: `r-${seq}`,
    timestamp: '2026-07-15T10:00:00.000Z',
    platform: 'twitter',
    originalText: 'text',
    originalHash: 'h',
    originalLength: 4,
    neutralizedText: '',
    techniques: [],
    overallScore: 0,
    userAgeCategory: 'teen',
    aiSource: 'rules',
    chainPosition: seq,
    kind: 'post',
    verdict: 'pass',
    ...partial,
  } as ForensicRecord;
}

const at = (iso: string, p: Partial<ForensicRecord> = {}) => rec({ timestamp: iso, ...p });

/** N records one minute apart starting at `startIso`, all inside one sitting. */
function minuteRun(startIso: string, verdicts: Array<ForensicRecord['verdict']>, extra: Partial<ForensicRecord> = {}): ForensicRecord[] {
  const start = new Date(startIso).getTime();
  return verdicts.map((verdict, i) =>
    at(new Date(start + i * 60_000).toISOString(), { verdict, ...extra }));
}

describe('feed-behavior-data', () => {
  it('returns null on an empty chain and on marker-only chains', () => {
    expect(computeFeedBehavior([])).toBeNull();
    expect(computeFeedBehavior([rec({ kind: 'reset-marker' })])).toBeNull();
  });

  it('finds the longest unbroken flagged run in serve order, with its end minute', () => {
    const records = minuteRun('2026-07-15T10:00:00Z', [
      'pass', 'flagged', 'flagged-hidden', undefined, 'pass', 'flagged',
    ]);
    const m = computeFeedBehavior(records)!;
    // flagged / flagged-hidden / legacy-undefined chain into one run of 3.
    expect(m.runs.length).toBe(3);
    // The model carries the raw instant now; the panel formats it in the
    // reader's language and clock (src/ui/shared/format-time.ts).
    expect(m.runs.endAt).toBe(records[3].timestamp);
    expect(m.flaggedCount).toBe(4);
    expect(m.baseRatePct).toBe(pct1(4, 6));
  });

  it('reports a zero run with no end time when nothing is flagged', () => {
    const m = computeFeedBehavior(minuteRun('2026-07-15T10:00:00Z', ['pass', 'pass']))!;
    expect(m.runs).toEqual({ length: 0, endAt: null });
  });

  it('skew reads thirds of 6+ item sittings only', () => {
    // Sitting A: 9 items, flags concentrated in the opening third.
    const a = minuteRun('2026-07-15T10:00:00Z', [
      'flagged', 'flagged', 'flagged', 'pass', 'pass', 'pass', 'pass', 'pass', 'pass',
    ]);
    // Sitting B (3h later = new sitting): 5 items, all flagged — too small to count.
    const b = minuteRun('2026-07-15T14:00:00Z', ['flagged', 'flagged', 'flagged', 'flagged', 'flagged']);
    const m = computeFeedBehavior([...a, ...b])!;
    expect(m.skew.bigSessions).toBe(1);
    expect(m.skew.totalSessions).toBe(2);
    expect(m.skew.openTotal).toBe(3);
    expect(m.skew.openFlagged).toBe(3);
    expect(m.skew.closeTotal).toBe(3);
    expect(m.skew.closeFlagged).toBe(0);
    expect(m.skew.openPct).toBe(100);
    expect(m.skew.closePct).toBe(0);
  });

  it('counts the first item after each 2h+ gap as a return item', () => {
    const records = [
      at('2026-07-15T08:00:00Z', { verdict: 'pass' }),      // opener: never a return
      at('2026-07-15T10:00:00Z', { verdict: 'flagged' }),   // exactly 2h: counts, flagged
      at('2026-07-15T10:30:00Z', { verdict: 'flagged' }),   // 30min: not a return
      at('2026-07-15T13:00:00Z', { verdict: 'pass' }),      // 2h30: counts, clean
    ];
    const m = computeFeedBehavior(records)!;
    expect(m.returns).toEqual({ flagged: 1, total: 2, pct: 50 });
  });

  it('tallies amplification readings from environment records and advertiser placement from content', () => {
    const records = [
      at('2026-07-15T10:00:00Z', { kind: 'environment', environment: { algorithmicAmplification: 'high' } as ForensicRecord['environment'] }),
      at('2026-07-15T10:01:00Z', { kind: 'environment', environment: { algorithmicAmplification: 'normal' } as ForensicRecord['environment'] }),
      at('2026-07-15T10:02:00Z', { kind: 'environment', environment: {} as ForensicRecord['environment'] }),
      at('2026-07-15T10:03:00Z', { accountType: 'advertiser', feedSource: 'for-you' }),
      at('2026-07-15T10:04:00Z', { accountType: 'advertiser', feedSource: 'following' }),
      at('2026-07-15T10:05:00Z', { feedSource: 'for-you' }),
    ];
    const m = computeFeedBehavior(records)!;
    expect(m.amplification).toEqual({ high: 1, normal: 1, low: 0, unknown: 1, total: 3 });
    expect(m.advertiser).toEqual({ forYou: 1, total: 2 });
    // Environment records never enter the content pool.
    expect(m.contentCount).toBe(3);
  });

  it('counts adjacent technique pairs within a sitting, splitting hand-offs from sustained', () => {
    const tech = (name: string) => ({ techniques: [{ name, severity: 5, confidence: 1 }] } as Partial<ForensicRecord>);
    const records = [
      ...minuteRun('2026-07-15T10:00:00Z', ['flagged'], tech('anger-trigger')),
      ...minuteRun('2026-07-15T10:01:00Z', ['flagged'], tech('violence-graphic')),
      ...minuteRun('2026-07-15T10:02:00Z', ['flagged'], tech('violence-graphic')),
      ...minuteRun('2026-07-15T10:03:00Z', ['pass']), // no technique: skipped, chain continues
      ...minuteRun('2026-07-15T10:04:00Z', ['flagged'], tech('anger-trigger')),
      // New sitting 3h later: pairs never bridge sittings.
      ...minuteRun('2026-07-15T14:00:00Z', ['flagged'], tech('fear-appeal')),
    ];
    const m = computeFeedBehavior(records)!;
    expect(m.chains.totalPairs).toBe(3);
    expect(m.chains.handoffs).toEqual([
      { a: 'anger-trigger', b: 'violence-graphic', n: 1, sustained: false },
      { a: 'violence-graphic', b: 'anger-trigger', n: 1, sustained: false },
    ]);
    expect(m.chains.sustained).toEqual([
      { a: 'violence-graphic', b: 'violence-graphic', n: 1, sustained: true },
    ]);
  });

  // CHANGED 2026-09-20: this case used to carry genuine-opinion on two PASSED
  // records and expect them in the pair total. A pass is in no pair: the
  // panel's own sentence over these rows says "which technique the next
  // flagged item carried" and its disclosure counts "adjacent pairs involved
  // an item the tool flagged", so the step now pairs flagged items only. Until
  // today any record with a first technique was paired, and on an export built
  // with the product's own writers that made 24 pairs over a file holding 19
  // flagged records: starred swearing with its verdict masked, an ad, a button
  // reading and a pass below the cut were all read as flagged items.
  // What this case protects is unchanged, and is carried here on flagged
  // records so the exclusion is still exercised: a genuine-opinion label never
  // makes a displayed row, and the pair it sits in is still counted in the
  // total the disclosure divides by. The passed record below is the new rule's
  // own half: it carries a technique, sits between two flagged items, and adds
  // nothing to the total.
  it('excludes genuine-opinion pairs from display while keeping them in the pair total', () => {
    const tech = (name: string) => ({ techniques: [{ name, severity: 2, confidence: 1 }] } as Partial<ForensicRecord>);
    const records = [
      ...minuteRun('2026-07-15T10:00:00Z', ['flagged'], tech('genuine-opinion')),
      ...minuteRun('2026-07-15T10:01:00Z', ['flagged'], tech('anger-trigger')),
      ...minuteRun('2026-07-15T10:02:00Z', ['pass'], tech('fear-appeal')),
      ...minuteRun('2026-07-15T10:03:00Z', ['flagged'], tech('genuine-opinion')),
    ];
    const m = computeFeedBehavior(records)!;
    expect(m.chains.totalPairs).toBe(2);
    expect(m.chains.handoffs).toEqual([]);
    expect(m.chains.sustained).toEqual([]);
  });

  // 'combined' is the UNCATEGORISED residual technique (the judge's free-text
  // concern matched no enum) - see tests/unit/ai/combined-technique-meaning.test.ts.
  // A "what follows what" row built on it asserts a narrative over a bucket
  // that names nothing, so it stays out of the rows and its share is disclosed.
  it('keeps the uncategorised bucket out of the narrative rows and discloses its share', () => {
    const tech = (name: string) => ({ techniques: [{ name, severity: 6, confidence: 1 }] } as Partial<ForensicRecord>);
    const records = [
      ...minuteRun('2026-07-15T10:00:00Z', ['flagged'], tech('combined')),
      ...minuteRun('2026-07-15T10:01:00Z', ['flagged'], tech('combined')),
      ...minuteRun('2026-07-15T10:02:00Z', ['flagged'], tech('anger-trigger')),
      ...minuteRun('2026-07-15T10:03:00Z', ['flagged'], tech('fear-appeal')),
    ];
    const m = computeFeedBehavior(records)!;
    expect(m.chains.totalPairs).toBe(3);
    // combined-then-combined and combined-then-anger-trigger are both suppressed.
    expect(m.chains.handoffs).toEqual([
      { a: 'anger-trigger', b: 'fear-appeal', n: 1, sustained: false },
    ]);
    expect(m.chains.sustained).toEqual([]);
    expect(m.chains.unnamedPairs).toBe(2);
  });

  it('never raises the chain caution off an uncategorised pair', () => {
    const tech = (name: string) => ({ techniques: [{ name, severity: 6, confidence: 1 }] } as Partial<ForensicRecord>);
    const base = new Date('2026-07-15T10:00:00Z').getTime();
    const records: ForensicRecord[] = [];
    for (let i = 0; i < CAUTION_CHAIN_MIN * 2 + 2; i++) {
      records.push(at(new Date(base + i * 60_000).toISOString(), {
        verdict: 'flagged',
        ...tech(i % 2 === 0 ? 'combined' : 'anger-trigger'),
      }));
    }
    const m = computeFeedBehavior(records)!;
    expect(m.chains.unnamedPairs).toBeGreaterThanOrEqual(CAUTION_CHAIN_MIN);
    expect(m.cautions.find((c) => c.kind === 'chain')).toBeUndefined();
  });

  it('lists voices only for accounts served on 3+ distinct days, skipping unnamed authors', () => {
    const records = [
      at('2026-07-13T10:00:00Z', { author: 'alice' }),
      at('2026-07-14T10:00:00Z', { author: 'alice', verdict: 'flagged' }),
      at('2026-07-15T10:00:00Z', { author: 'alice' }),
      at('2026-07-14T11:00:00Z', { author: 'bob' }),
      at('2026-07-15T11:00:00Z', { author: 'bob' }),
      at('2026-07-15T12:00:00Z', { author: 'unknown' }),
      at('2026-07-15T13:00:00Z', { author: '' }),
    ];
    const m = computeFeedBehavior(records)!;
    expect(m.voices).toEqual([
      { author: 'alice', platform: 'twitter', accountType: undefined, days: 3, seen: 3, flagged: 1 },
    ]);
    expect(m.namedSources).toBe(2); // alice + bob; unnamed rows never enter
  });

  it('gates every caution and the prediction on its evidence threshold', () => {
    // Nothing qualifying: quiet, short, unflagged.
    const calm = computeFeedBehavior(minuteRun('2026-07-15T10:00:00Z', ['pass', 'flagged', 'pass']))!;
    expect(calm.cautions).toEqual([]);
    expect(calm.predictionClauses).toEqual([]);

    // A run at exactly the gate fires the run caution + run clause.
    const runRecs = minuteRun('2026-07-15T10:00:00Z', [
      'pass', ...Array<'flagged'>(CAUTION_RUN_MIN).fill('flagged'), 'pass',
    ]);
    const withRun = computeFeedBehavior(runRecs)!;
    expect(withRun.cautions.map((c) => c.kind)).toEqual(['run']);
    expect(withRun.predictionClauses).toEqual(['run']);

    // Returns fire only with >= 3 samples AND a rate above twice the base.
    const returnRecs: ForensicRecord[] = [at('2026-07-15T00:00:00Z', { verdict: 'pass' })];
    for (let i = 0; i < CAUTION_RETURN_MIN_SAMPLES; i++) {
      returnRecs.push(at(`2026-07-15T0${3 * (i + 1)}:00:00Z`, { verdict: 'flagged' }));
    }
    // Pad with passes so the base rate stays low relative to the 100% return rate.
    for (let i = 0; i < 20; i++) {
      returnRecs.push(at(`2026-07-15T09:${String(i).padStart(2, '0')}:00Z`, { verdict: 'pass' }));
    }
    const withReturns = computeFeedBehavior(returnRecs)!;
    const returnCaution = withReturns.cautions.find((c) => c.kind === 'return');
    expect(returnCaution).toMatchObject({ flagged: CAUTION_RETURN_MIN_SAMPLES, total: CAUTION_RETURN_MIN_SAMPLES });
    expect(withReturns.predictionClauses).toContain('return');

    // The chain caution needs the top hand-off at >= 10 observations.
    const tech = (name: string) => ({ techniques: [{ name, severity: 5, confidence: 1 }] } as Partial<ForensicRecord>);
    const chainRecs: ForensicRecord[] = [];
    const base = new Date('2026-07-15T10:00:00Z').getTime();
    for (let i = 0; i < CAUTION_CHAIN_MIN; i++) {
      chainRecs.push(at(new Date(base + i * 120_000).toISOString(), { verdict: 'flagged', ...tech(i % 2 === 0 ? 'anger-trigger' : 'violence-graphic') }));
    }
    const withChain = computeFeedBehavior(chainRecs)!;
    // 10 alternating items produce 9 pairs: 5 anger>violence, 4 violence>anger — below the gate.
    expect(withChain.cautions.find((c) => c.kind === 'chain')).toBeUndefined();
  });

  it('fires the amplification caution only above a 25% high share', () => {
    const env = (a: 'high' | 'normal') =>
      at('2026-07-15T10:00:00Z', { kind: 'environment', environment: { algorithmicAmplification: a } as ForensicRecord['environment'] });
    const content = [at('2026-07-15T10:01:00Z', { verdict: 'pass' })];
    const below = computeFeedBehavior([...content, env('high'), env('normal'), env('normal'), env('normal')])!;
    expect(below.cautions.find((c) => c.kind === 'amplification')).toBeUndefined();
    const above = computeFeedBehavior([...content, env('high'), env('high'), env('normal'), env('normal')])!;
    expect(above.cautions.find((c) => c.kind === 'amplification')).toMatchObject({ high: 2, total: 4, pct: 50 });
  });
});
