// Overview tab data derivation — semantics locks.
//
// The load-bearing contracts:
// 1. Balance arithmetic mirrors StatisticsTab (pool + verdict buckets) so the
//    two surfaces can never answer the same question differently.
// 2. Sessions split on the 30-minute quiet gap.
// 3. KPI deltas are suppressed (null) when the prior window lacks coverage.
// 4. Sources exclude empty/unknown authors and never invent judgments.
import { describe, it, expect } from 'vitest';
import type { ForensicRecord } from '../../../../../src/types/forensic';
import {
  computeOverview,
  SESSION_GAP_MS,
} from '../../../../../src/ui/dashboard/components/overview-data';
import { isBalanceContent, isFlaggedVerdict } from '../../../../../src/ui/dashboard/record-sets';

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

describe('overview-data', () => {
  it('returns null on an empty chain', () => {
    expect(computeOverview([])).toBeNull();
  });

  it('balance pool mirrors StatisticsTab: markers and environment excluded, cancelled outside decided', () => {
    const records = [
      at('2026-07-15T10:00:00Z', { verdict: 'pass' }),
      at('2026-07-15T10:01:00Z', { verdict: 'flagged' }),
      at('2026-07-15T10:02:00Z', { verdict: 'flagged-hidden' }),
      at('2026-07-15T10:03:00Z', { verdict: undefined }), // legacy no-verdict counts flagged
      at('2026-07-15T10:04:00Z', { verdict: 'blocked' }),
      at('2026-07-15T10:05:00Z', { verdict: 'cancelled-dom-gone' as ForensicRecord['verdict'] }),
      at('2026-07-15T10:06:00Z', { kind: 'environment', verdict: 'pass' }),
      at('2026-07-15T10:07:00Z', { kind: 'reset-marker' }),
    ];
    expect(records.filter(isBalanceContent)).toHaveLength(6);
    expect(records.filter(isFlaggedVerdict)).toHaveLength(3);
    const m = computeOverview(records)!;
    expect(m.balance.passed).toBe(1);
    expect(m.balance.flagged).toBe(3);
    expect(m.balance.blocked).toBe(1);
    expect(m.balance.decided).toBe(5); // cancelled excluded from both sides
    expect(m.balance.flaggedHidden).toBe(1);
    expect(m.balance.flaggedVisible).toBe(2);
  });

  it('splits sessions at >= 30 minutes quiet (ActivityTab semantics) and carries record ids', () => {
    const base = new Date('2026-07-15T10:00:00Z').getTime();
    const iso = (offsetMin: number) => new Date(base + offsetMin * 60_000).toISOString();
    const m = computeOverview([
      at(iso(0)),
      at(iso(10), { verdict: 'flagged' }),
      at(iso(29)), // still session 1 (gap 19 min < 30)
      at(iso(29 + 30)), // NEW session at EXACTLY 30 min (>= boundary, SOL finding 2)
      at(iso(29 + 30 + 29)), // same session 2 (gap 29 min)
    ])!;
    expect(SESSION_GAP_MS).toBe(30 * 60 * 1000);
    expect(m.sessions).toHaveLength(2);
    expect(m.sessions[0].count).toBe(3);
    expect(m.sessions[0].flaggedTimes).toHaveLength(1);
    expect(m.sessions[1].count).toBe(2);
    expect(m.sessions[0].recordIds).toHaveLength(3);
    expect(m.brief.sessions).toBe(2);
  });

  it('blocked verdicts stay out of counts labeled flagged (sessions, sources, surfaces) but keep their balance segment', () => {
    const m = computeOverview([
      at('2026-07-15T10:00:00Z', { author: 'acct', feedSource: 'for-you', verdict: 'blocked' }),
      at('2026-07-15T10:01:00Z', { author: 'acct', feedSource: 'for-you', verdict: 'flagged' }),
    ])!;
    expect(m.sessions[0].flaggedTimes).toHaveLength(1);
    expect(m.sources[0].flagged).toBe(1);
    expect(m.surfaces[0].flagged).toBe(1);
    expect(m.balance.blocked).toBe(1);
    expect(m.balance.flagged).toBe(1);
  });

  it('brief platform chips carry the exact focus-day record ids they count', () => {
    const m = computeOverview([
      at('2026-07-14T10:00:00Z', { platform: 'tiktok' }), // prior day, must not leak in
      at('2026-07-15T10:00:00Z', { platform: 'twitter' }),
      at('2026-07-15T10:01:00Z', { platform: 'twitter' }),
      at('2026-07-15T10:02:00Z', { platform: 'facebook' }),
    ])!;
    const tw = m.brief.platforms.find((p) => p.platform === 'twitter')!;
    expect(tw.count).toBe(2);
    expect(tw.recordIds).toHaveLength(2);
    expect(m.brief.platforms.some((p) => p.platform === 'tiktok')).toBe(false);
  });

  it('a window of only cancelled checks yields decided=0 (UI shows the empty branch, never 0%)', () => {
    const m = computeOverview([
      at('2026-07-15T10:00:00Z', { verdict: 'cancelled-dom-gone' as ForensicRecord['verdict'] }),
      at('2026-07-15T10:01:00Z', { verdict: 'cancelled-dom-recycled' as ForensicRecord['verdict'] }),
    ])!;
    expect(m.balance.decided).toBe(0);
    expect(m.balance.passedPct).toBe(0);
  });

  it('suppresses KPI deltas when fewer than 4 prior days carry records', () => {
    const m = computeOverview([
      at('2026-07-14T10:00:00Z'),
      at('2026-07-15T10:00:00Z'),
      at('2026-07-15T11:00:00Z'),
    ])!;
    expect(m.priorActiveDays).toBe(1);
    for (const k of m.kpis) expect(k.deltaPct).toBeNull();
  });

  it('emits deltas when 4+ prior days carry records', () => {
    const days = ['09', '10', '11', '12', '13', '14'];
    const records = days.map((d) => at(`2026-07-${d}T10:00:00Z`));
    records.push(at('2026-07-15T10:00:00Z'), at('2026-07-15T11:00:00Z'));
    const m = computeOverview(records)!;
    expect(m.priorActiveDays).toBe(6);
    const items = m.kpis.find((k) => k.key === 'items')!;
    expect(items.deltaPct).not.toBeNull();
    expect(items.series).toHaveLength(7);
    expect(items.value).toBe(2);
  });

  it('sources exclude empty and unknown authors; advertiser type sticks; flag counts flagged verdicts only', () => {
    const m = computeOverview([
      at('2026-07-15T10:00:00Z', { author: 'ExampleSat', accountType: 'advertiser', verdict: 'flagged' }),
      at('2026-07-15T10:01:00Z', { author: 'ExampleSat', verdict: 'pass' }),
      at('2026-07-15T10:02:00Z', { author: 'unknown' }),
      at('2026-07-15T10:03:00Z', { author: '' }),
      at('2026-07-15T10:04:00Z', { author: 'friend', verdict: 'flagged' }),
    ])!;
    expect(m.sourceTotal).toBe(2);
    const star = m.sources.find((s) => s.author === 'ExampleSat')!;
    expect(star.count).toBe(2);
    // Both of ExampleSat's items are still SEEN, and the advertiser type still
    // sticks to the row, but an advertiser's ad is a paid placement and never
    // a flag (standing decision 1, 2026-09-14), so the flag count is 0 here
    // and 1 on the account whose flagged item a judge actually read.
    expect(star.flagged).toBe(0);
    expect(star.accountType).toBe('advertiser');
    expect(star.recordIds).toHaveLength(2);
    expect(m.sources.find((s) => s.author === 'friend')!.flagged).toBe(1);
  });

  it('served-surface rows tally per feedSource with flag counts; missing source is unknown', () => {
    const m = computeOverview([
      at('2026-07-15T10:00:00Z', { feedSource: 'for-you', verdict: 'flagged' }),
      at('2026-07-15T10:01:00Z', { feedSource: 'for-you', verdict: 'pass' }),
      at('2026-07-15T10:02:00Z', { feedSource: undefined, verdict: 'pass' }),
    ])!;
    const forYou = m.surfaces.find((s) => s.key === 'for-you')!;
    expect(forYou.count).toBe(2);
    expect(forYou.flagged).toBe(1);
    expect(m.surfaces.find((s) => s.key === 'unknown')!.count).toBe(1);
    expect(m.surfaceTotal).toBe(3);
  });

  it('attention takes the strongest flags, one per source, max 3, severity >= 5', () => {
    const m = computeOverview([
      at('2026-07-15T09:00:00Z', { author: 'a', verdict: 'flagged', techniques: [{ name: 'fear-appeal', severity: 9, confidence: 1 }] }),
      at('2026-07-15T09:01:00Z', { author: 'a', verdict: 'flagged', techniques: [{ name: 'fear-appeal', severity: 8, confidence: 1 }] }),
      at('2026-07-15T09:02:00Z', { author: 'b', verdict: 'flagged-hidden', techniques: [{ name: 'ragebait', severity: 7, confidence: 1 }] }),
      at('2026-07-15T09:03:00Z', { author: 'c', verdict: 'flagged', techniques: [{ name: 'fomo', severity: 4, confidence: 1 }] }), // below floor
      at('2026-07-15T09:04:00Z', { author: 'd', verdict: 'pass', techniques: [{ name: 'fomo', severity: 9, confidence: 1 }] }), // pass never listed
    ])!;
    expect(m.attention).toHaveLength(2);
    expect(m.attention[0].severity).toBe(9);
    expect(m.attention.map((a) => a.record.author)).toEqual(['a', 'b']);
  });

  it('heat grid is 7 rows x 24 hours ending at the focus day', () => {
    const m = computeOverview([
      at('2026-07-13T10:00:00Z'),
      at('2026-07-15T10:00:00Z'),
    ])!;
    expect(m.heat).toHaveLength(7);
    expect(m.heat[6].dayKey).toBe(m.focusDayKey);
    for (const row of m.heat) expect(row.hours).toHaveLength(24);
    const total = m.heat.flatMap((h) => h.hours).reduce((a, b) => a + b, 0);
    expect(total).toBe(2);
    expect(m.heatMax).toBeGreaterThanOrEqual(1);
  });

  it('focus day is the latest day with content records', () => {
    const m = computeOverview([
      at('2026-07-10T10:00:00Z'),
      at('2026-07-12T10:00:00Z'),
    ])!;
    expect(m.focusDayKey).toBe('2026-07-12');
    expect(m.brief.items).toBe(1);
  });
});

describe('days on record', () => {
  // A day with no record is not a day with a value of zero. The delta beside
  // the seven-day line has been gated on how many days are actually on record
  // since it was written; the line itself drew all seven, so a fresh install
  // showed six days on the floor and then a climb, which reads as "this is
  // new" when the truth is "there was nothing to read" (seen 2026-09-17 in the
  // dashboard probe's screenshot).
  it('marks only the days that carry a record', () => {
    const model = computeOverview([
      at('2026-08-01T10:00:00.000Z'),
      at('2026-08-01T11:00:00.000Z'),
    ])!;

    expect(model.daysOnRecord).toHaveLength(7);
    // Six days before the focus day hold nothing; the focus day holds two.
    expect(model.daysOnRecord.slice(0, 6)).toEqual([false, false, false, false, false, false]);
    expect(model.daysOnRecord[6]).toBe(true);
    expect(model.priorActiveDays).toBe(0);
  });

  it('marks a day that carries a record, whatever its verdict', () => {
    const model = computeOverview([
      at('2026-07-30T10:00:00.000Z'),
      at('2026-08-01T10:00:00.000Z'),
    ])!;

    expect(model.daysOnRecord[4]).toBe(true);   // 30 July
    expect(model.daysOnRecord[5]).toBe(false);  // 31 July
    expect(model.daysOnRecord[6]).toBe(true);   // 1 August
    expect(model.priorActiveDays).toBe(1);
  });
});

