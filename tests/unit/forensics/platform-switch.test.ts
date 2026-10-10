// Capability audit 2026-09-06, P1 item 6: platform switches as a countable
// event over the time-ordered chain, and the after-switch window share against
// the baseline, both with k, n and an interval. The claims locked here: a
// switch is inside a sitting only; a window is cut by the next switch or the
// sitting boundary; environment and marker records never enter; the two shares
// partition the content pool.

import { describe, it, expect } from 'vitest';
import type { ForensicRecord } from '../../../src/types/forensic';
import { computePlatformSwitches } from '../../../src/forensics/platform-switch';

const T0 = Date.UTC(2026, 8, 1, 10, 0, 0);
function rec(i: number, minute: number, platform: ForensicRecord['platform'], over: Partial<ForensicRecord> = {}): ForensicRecord {
  return {
    id: `r${i}`, timestamp: new Date(T0 + minute * 60_000).toISOString(), platform, kind: 'post',
    originalText: 'x', originalHash: 'h', originalLength: 1, neutralizedText: '', author: 'a',
    postUrl: 'https://example.test/p', techniques: [], overallScore: 0, userAgeCategory: 'adult',
    aiSource: 'cloud', feedSource: 'foryou', integrityHash: 'ih', verdict: 'pass',
    ...over,
  } as ForensicRecord;
}

describe('computePlatformSwitches', () => {
  it('counts switches inside a sitting, by direction, and never across a sitting gap', () => {
    const chain = [
      rec(1, 0, 'tiktok'), rec(2, 1, 'tiktok'),
      rec(3, 2, 'twitter'),                       // switch tiktok>twitter
      rec(4, 3, 'twitter'),
      rec(5, 4, 'tiktok'),                        // switch twitter>tiktok
      rec(6, 60, 'twitter'),                      // 56 min later: new sitting, not a switch
      rec(7, 61, 'tiktok'),                       // switch twitter>tiktok
    ];
    const s = computePlatformSwitches(chain);
    expect(s.content).toBe(7);
    expect(s.switches).toBe(3);
    expect(s.pairs).toEqual([
      { from: 'twitter', to: 'tiktok', count: 2 },
      { from: 'tiktok', to: 'twitter', count: 1 },
    ]);
  });

  it('the window is the next N on the new platform, cut by the next switch or the sitting boundary', () => {
    const chain = [
      rec(1, 0, 'tiktok', { verdict: 'flagged' }),
      rec(2, 1, 'twitter', { verdict: 'flagged' }),   // switch: window opens r2..
      rec(3, 2, 'twitter', { verdict: 'pass' }),
      rec(4, 3, 'tiktok', { verdict: 'flagged' }),    // switch: previous window cut at 2, new window r4..
      rec(5, 4, 'tiktok', { verdict: 'pass' }),
      rec(6, 5, 'tiktok', { verdict: 'pass' }),
      rec(7, 90, 'tiktok', { verdict: 'flagged' }),   // new sitting: window closed at 3
      rec(8, 91, 'tiktok', { verdict: 'pass' }),
    ];
    const s = computePlatformSwitches(chain, { windowSize: 3 });
    expect(s.windowRecordIds).toEqual(['r2', 'r3', 'r4', 'r5', 'r6']);
    expect(s.window).toMatchObject({ k: 2, n: 5 });
    expect(s.baseline).toMatchObject({ k: 2, n: 3 });
    expect(s.window!.n + s.baseline!.n).toBe(s.content);
    expect(s.window!.lowerPct).toBeLessThanOrEqual(s.window!.pct);
    expect(s.baseline!.upperPct).toBeGreaterThanOrEqual(s.baseline!.pct);
  });

  it('a verdict-less record is flagged, blocked is content but not flagged, environment and markers are out', () => {
    const chain = [
      rec(1, 0, 'tiktok', { verdict: undefined }),
      rec(2, 1, 'twitter', { verdict: 'blocked' }),
      rec(3, 2, 'twitter', { kind: 'environment', verdict: 'flagged' } as Partial<ForensicRecord>),
      rec(4, 3, 'twitter', { kind: 'reset-marker', verdict: 'pass' } as Partial<ForensicRecord>),
      rec(5, 4, 'twitter', { verdict: 'skipped' }),
    ];
    const s = computePlatformSwitches(chain, { windowSize: 1 });
    expect(s.content).toBe(2);
    expect(s.switches).toBe(1);
    expect(s.window).toMatchObject({ k: 0, n: 1 });
    expect(s.baseline).toMatchObject({ k: 1, n: 1 });
  });

  it('no switch: window is null, baseline is the whole pool; empty input is all zero', () => {
    const one = computePlatformSwitches([rec(1, 0, 'tiktok'), rec(2, 1, 'tiktok', { verdict: 'flagged' })]);
    expect(one.switches).toBe(0);
    expect(one.window).toBeNull();
    expect(one.baseline).toMatchObject({ k: 1, n: 2 });
    const none = computePlatformSwitches([]);
    expect(none).toMatchObject({ content: 0, switches: 0, pairs: [], window: null, baseline: null, windowRecordIds: [] });
  });

  it('walks timestamp order regardless of input order', () => {
    const chain = [rec(3, 2, 'twitter'), rec(1, 0, 'tiktok'), rec(2, 1, 'tiktok')];
    expect(computePlatformSwitches(chain).switches).toBe(1);
    expect(computePlatformSwitches(chain).windowRecordIds).toEqual(['r3']);
  });
});
