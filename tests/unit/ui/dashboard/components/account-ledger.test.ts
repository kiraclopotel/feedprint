// The account ledger: one row per platform-scoped account over ALL its content
// records. Locks the contracts in account-ledger.ts:
// 1. pass and flag sit on the same row (the old panel counted flags only, so
//    a campaign the judge passed half the time looked half its size);
// 2. served (for-you), chosen (following) and sought (profile, permalink,
//    search) are split, so "the feed brought it" and "the reader went to it"
//    never merge;
// 3. a burst counts For You items only; opening a profile page loads that
//    account's posts in a burst by construction and must not count;
// 4. identity is authorProfileKey(handle, platform); unknown authors,
//    environment readings and system markers are out;
// 5. order is stable for the same records in any input order.
import { describe, it, expect } from 'vitest';
import type { ForensicRecord } from '../../../../../src/types/forensic';
import { authorProfileKey } from '../../../../../src/forensics/author-store';
import {
  computeAccountLedger,
  countBursts,
  BURST_WINDOW_MS,
  BURST_MIN_ITEMS,
} from '../../../../../src/ui/dashboard/components/account-ledger';

let seq = 0;
function rec(partial: Partial<ForensicRecord>): ForensicRecord {
  seq++;
  return {
    id: `r-${seq}`,
    timestamp: '2026-09-01T10:00:00.000Z',
    platform: 'twitter',
    originalText: 'text',
    originalHash: 'h',
    originalLength: 4,
    neutralizedText: '',
    author: 'acct',
    techniques: [],
    overallScore: 0,
    userAgeCategory: 'adult',
    aiSource: 'cloud',
    chainPosition: seq,
    kind: 'post',
    verdict: 'pass',
    feedSource: 'for-you',
    ...partial,
  } as ForensicRecord;
}

const plus = (baseIso: string, seconds: number) =>
  new Date(new Date(baseIso).getTime() + seconds * 1000).toISOString();

describe('computeAccountLedger', () => {
  it('puts pass and flag on the same row and splits served from sought', () => {
    const base = '2026-09-01T10:00:00.000Z';
    const records = [
      rec({ timestamp: plus(base, 0), verdict: 'flagged', feedSource: 'for-you', techniques: [{ name: 'scapegoating', severity: 5, confidence: 0.9 }] }),
      rec({ timestamp: plus(base, 600), verdict: 'flagged-hidden', feedSource: 'for-you', techniques: [{ name: 'scapegoating', severity: 6, confidence: 0.9 }, { name: 'anger-trigger', severity: 4, confidence: 0.8 }] }),
      rec({ timestamp: plus(base, 1200), verdict: 'pass', feedSource: 'profile' }),
      rec({ timestamp: '2026-09-02T10:00:00.000Z', verdict: 'pass', feedSource: 'permalink' }),
      rec({ timestamp: '2026-09-03T10:00:00.000Z', verdict: 'blocked', feedSource: 'following' }),
    ];
    const [row, ...rest] = computeAccountLedger(records);
    expect(rest).toHaveLength(0);
    expect(row.key).toBe(authorProfileKey('acct', 'twitter'));
    expect(row.seen).toBe(5);
    expect(row.flagged).toBe(2);
    expect(row.passed).toBe(2);
    expect(row.other).toBe(1);
    expect(row.forYou).toBe(2);
    expect(row.following).toBe(1);
    expect(row.sought).toBe(2);
    expect(row.distinctDays).toBe(3);
    expect(row.techniques).toEqual([
      { name: 'scapegoating', count: 2 },
      { name: 'anger-trigger', count: 1 },
    ]);
    expect(row.recordIds).toEqual(records.map((r) => r.id));
  });

  it('counts a burst on For You only; the same three posts on a profile page are not one', () => {
    const base = '2026-09-01T10:00:00.000Z';
    const served = [0, 20, 40].map((s) => rec({ timestamp: plus(base, s), feedSource: 'for-you' }));
    const sought = [0, 20, 40].map((s) => rec({ timestamp: plus('2026-09-02T10:00:00.000Z', s), feedSource: 'profile' }));
    const [row] = computeAccountLedger([...served, ...sought]);
    expect(row.bursts).toBe(1);
    expect(row.forYou).toBe(3);
    expect(row.sought).toBe(3);
  });

  it('keeps the same handle on two platforms as two rows, and drops unknown authors, environment readings and markers', () => {
    const records = [
      rec({ platform: 'twitter', author: 'acct', verdict: 'flagged' }),
      rec({ platform: 'facebook', author: 'acct', verdict: 'flagged' }),
      rec({ platform: 'twitter', author: 'unknown', verdict: 'flagged' }),
      rec({ platform: 'twitter', author: '', verdict: 'flagged' }),
      rec({ platform: 'twitter', author: 'acct', kind: 'environment' }),
      rec({ platform: 'twitter', author: 'acct', kind: 'reset-marker' }),
    ];
    const rows = computeAccountLedger(records);
    expect(rows.map((r) => r.key).sort()).toEqual(
      [authorProfileKey('acct', 'twitter'), authorProfileKey('acct', 'facebook')].sort(),
    );
    for (const r of rows) expect(r.seen).toBe(1);
  });

  it('honours minFlagged and limit, and sorts by flagged then seen', () => {
    const records = [
      rec({ author: 'a', verdict: 'flagged' }),
      rec({ author: 'a', verdict: 'flagged' }),
      rec({ author: 'b', verdict: 'flagged' }),
      rec({ author: 'b', verdict: 'flagged' }),
      rec({ author: 'b', verdict: 'pass' }),
      rec({ author: 'c', verdict: 'flagged' }),
      rec({ author: 'd', verdict: 'pass' }),
    ];
    const all = computeAccountLedger(records);
    expect(all.map((r) => r.author)).toEqual(['b', 'a', 'c', 'd']);
    const frequent = computeAccountLedger(records, { minFlagged: 2 });
    expect(frequent.map((r) => r.author)).toEqual(['b', 'a']);
    expect(computeAccountLedger(records, { minFlagged: 2, limit: 1 }).map((r) => r.author)).toEqual(['b']);
  });

  it('is order-independent', () => {
    const base = '2026-09-01T10:00:00.000Z';
    const records = [
      rec({ author: 'a', timestamp: plus(base, 0), verdict: 'flagged' }),
      rec({ author: 'a', timestamp: plus(base, 30), verdict: 'pass' }),
      rec({ author: 'a', timestamp: plus(base, 60), verdict: 'flagged' }),
      rec({ author: 'b', timestamp: plus(base, 90), verdict: 'flagged' }),
    ];
    const forward = computeAccountLedger(records);
    const reversed = computeAccountLedger(records.slice().reverse());
    expect(reversed).toEqual(forward);
    expect(forward[0].recordIds).toEqual(records.slice(0, 3).map((r) => r.id));
  });
});

describe('countBursts', () => {
  it('closes a run at the first item outside the window, so one dense minute is one burst', () => {
    const t0 = 1_000_000;
    expect(countBursts([t0, t0 + 10_000, t0 + 20_000])).toBe(1);
    expect(countBursts([t0, t0 + 10_000])).toBe(0);
    expect(countBursts([t0, t0 + BURST_WINDOW_MS, t0 + BURST_WINDOW_MS + 1])).toBe(0);
    const two = [t0, t0 + 1000, t0 + 2000, t0 + 500_000, t0 + 501_000, t0 + 502_000];
    expect(countBursts(two)).toBe(2);
    expect(BURST_MIN_ITEMS).toBe(3);
  });

  it('ignores unparseable times and does not depend on input order', () => {
    const t0 = 1_000_000;
    expect(countBursts([t0 + 20_000, Number.NaN, t0, t0 + 10_000])).toBe(1);
  });
});
