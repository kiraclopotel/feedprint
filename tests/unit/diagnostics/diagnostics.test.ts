// FeelingWise — diagnostics heap-trend summary (pure). The sampling/persistence
// is live (performance.memory + chrome.storage); this locks the trend logic that
// decides whether the heap is "climbing" (a leak signal) vs normal sawtooth.

import { afterEach, describe, it, expect, vi } from 'vitest';
import {
  summarizeHeapTrend,
  pickWorstClimbingSnapshot,
  coerceMultiHost,
  aggregateDiagnosticCounters,
  aggregateDiagnosticCounterFirstSeen,
  pruneDiagnosticHeapSessions,
  bumpCounter,
  readDiagnosticsResult,
  beginPostIntervention,
  finishPostIntervention,
  notePostPassAfterIntervention,
  _getDiagnosticCountersForTesting,
  _getDiagnosticCounterFirstSeenForTesting,
  _resetDiagnosticsForTesting,
  type HeapSample,
  type DiagnosticsSnapshot,
} from '../../../src/diagnostics/diagnostics';

afterEach(() => {
  _resetDiagnosticsForTesting();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const samples = (mbs: number[]): HeapSample[] =>
  mbs.map((usedMB, i) => ({ t: `2026-06-06T00:${String(i).padStart(2, '0')}:00Z`, usedMB, path: '/' }));

/**
 * The heap series from the owner's 2026-08-20 Copy Diagnostics paste, exactly
 * as captured (59 samples, 30s apart, www.tiktok.com). Kept verbatim so the
 * regression is pinned to real data rather than a reconstruction of it.
 */
const OWNER_0820_TIKTOK = [
  3, 175, 124, 133, 124, 126, 125, 123, 122, 125, 147, 153, 195, 168, 141, 142,
  226, 152, 146, 158, 185, 195, 216, 165, 201, 206, 179, 177, 226, 205, 213,
  190, 200, 207, 212, 215, 227, 229, 214, 207, 232, 222, 310, 234, 220, 220,
  238, 283, 270, 255, 249, 252, 223, 230, 225, 232, 235, 232, 239,
];

const snap = (host: string, mbs: number[]): DiagnosticsSnapshot => ({
  date: '2026-06-06', host, samples: samples(mbs), peakMB: Math.max(0, ...mbs), counters: {}, gauges: {},
});

describe('summarizeHeapTrend', () => {
  it('handles an empty series', () => {
    const t = summarizeHeapTrend([], 0);
    expect(t.sampleCount).toBe(0);
    expect(t.climbing).toBe(false);
  });

  it('flags a clear unbounded climb as a leak signal', () => {
    // 200 → 1800 MB over the session.
    const t = summarizeHeapTrend(samples([200, 500, 900, 1400, 1800]), 1800);
    expect(t.firstMB).toBe(200);
    expect(t.lastMB).toBe(1800);
    expect(t.deltaMB).toBe(1600);
    expect(t.climbing).toBe(true);
    // A real leak's baseline is never mistaken for warm-up, however steep the
    // first step: 200 MB is a loaded page, not a tick that beat the page to it.
    expect(t.warmupDropped).toBe(0);
  });

  it('does NOT call a settled band climbing because the first tick beat the page', () => {
    // The owner's 2026-08-20 TikTok series, verbatim: 59 samples opening at
    // 3 MB (reader ticked before the site allocated), then 175, then a noisy
    // 120-310 band ending at 239. Against the 3 MB anchor BOTH climb paths
    // fired and the panel said "CLIMBING (+236 MB)"; the settled baseline is
    // 175 and the delta is 64, under the 80 MB gate.
    const t = summarizeHeapTrend(samples(OWNER_0820_TIKTOK), 310);
    expect(t.warmupDropped).toBe(1);
    expect(t.firstMB).toBe(175);
    expect(t.lastMB).toBe(239);
    expect(t.deltaMB).toBe(64);
    expect(t.climbing).toBe(false);
  });

  it('still catches a leak that genuinely starts from a cold page', () => {
    // Warm-up is discarded, the leak underneath is not: dropping the sub-floor
    // head leaves 40 → 1600, which is still unmistakably a climb.
    const t = summarizeHeapTrend(samples([3, 10, 40, 200, 800, 1600]), 1600);
    expect(t.warmupDropped).toBe(2);
    expect(t.firstMB).toBe(40);
    expect(t.climbing).toBe(true);
  });

  it('does NOT call two points a climb, even when the first is a cold-start artifact', () => {
    // The owner's 2026-08-24 01:07 dashboard capture, verbatim: exactly two
    // heap samples, 30s apart, the first taken at content-script init before
    // the host page had loaded its own code.
    //   2026-08-24T00:03:20.025Z -> 3 MB
    //   2026-08-24T00:03:50.060Z -> 237 MB
    // The panel read this as "CLIMBING (+234 MB): whole-page memory keeps
    // growing". "Keeps growing" is not supportable from two points where the
    // first is a pre-load baseline — the warmup-drop guard above needs at
    // least 3 samples left over to even engage (`samples.length - warmupDropped
    // >= 3`), so it cannot rescue a 2-sample series at all. A dedicated
    // minimum-sample floor is required before `climbing` may fire.
    const twoPoints: HeapSample[] = [
      { t: '2026-08-24T00:03:20.025Z', usedMB: 3, path: '/' },
      { t: '2026-08-24T00:03:50.060Z', usedMB: 237, path: '/' },
    ];
    const t = summarizeHeapTrend(twoPoints, 237);
    expect(t.sampleCount).toBe(2);
    expect(t.climbing).toBe(false);
  });

  it('does not mutate the caller-supplied series', () => {
    const input = samples([3, 175, 180, 190]);
    summarizeHeapTrend(input, 190);
    expect(input.map(s => s.usedMB)).toEqual([3, 175, 180, 190]);
  });

  it('does NOT flag normal allocate-then-GC sawtooth as climbing', () => {
    const t = summarizeHeapTrend(samples([300, 420, 280, 410, 300]), 420);
    expect(t.climbing).toBe(false);
  });

  it('does NOT flag a small steady-state drift', () => {
    const t = summarizeHeapTrend(samples([300, 320, 330, 340, 350]), 350); // +50MB only
    expect(t.climbing).toBe(false);
  });

  it('carries the peak through', () => {
    expect(summarizeHeapTrend(samples([100, 200]), 950).peakMB).toBe(950);
  });

  it('flags a slow steady slope once there are enough samples (≥6)', () => {
    // +50 MB/sample over 7 samples — a slow leak the old first-vs-last check
    // (which needed a 40% jump) could miss on noisy data.
    const t = summarizeHeapTrend(samples([300, 350, 400, 450, 500, 550, 600]), 600);
    expect(t.sampleCount).toBe(7);
    expect(t.climbing).toBe(true);
  });

  it('does NOT trust a slope with too few samples (no big jump)', () => {
    // A real upward drift but only 5 samples and under the big-jump bar → not
    // flagged (the premature "stable/climbing on 2 samples" verdict is gone).
    const t = summarizeHeapTrend(samples([300, 330, 360, 390, 420]), 420); // +120, not a 40% jump
    expect(t.climbing).toBe(false);
  });

  it('does NOT flag sawtooth even with ≥6 samples', () => {
    const t = summarizeHeapTrend(samples([300, 420, 280, 410, 290, 400, 300]), 420);
    expect(t.climbing).toBe(false);
  });
});

describe('pickWorstClimbingSnapshot', () => {
  it('returns null when there are no hosts', () => {
    expect(pickWorstClimbingSnapshot({})).toBeNull();
  });

  it('surfaces the climbing YouTube host over a calm x.com host', () => {
    const hosts = {
      'x.com': snap('x.com', [100, 110, 105, 112, 108, 114]),                 // stable
      'youtube.com': snap('youtube.com', [200, 500, 900, 1400, 1800, 2200]),  // climbing
    };
    expect(pickWorstClimbingSnapshot(hosts)?.host).toBe('youtube.com');
  });

  it('among non-climbing hosts, prefers the one that grew most', () => {
    const hosts = {
      'a.com': snap('a.com', [100, 110]),
      'b.com': snap('b.com', [100, 145]), // +45, still not climbing, but grew more
    };
    expect(pickWorstClimbingSnapshot(hosts)?.host).toBe('b.com');
  });
});

describe('coerceMultiHost', () => {
  it('migrates a legacy flat same-day snapshot into a host slot', () => {
    const legacy = snap('youtube.com', [300, 800]);
    const doc = coerceMultiHost(legacy, '2026-06-06');
    expect(Object.keys(doc.hosts)).toEqual(['youtube.com']);
    expect(doc.hosts['youtube.com'].peakMB).toBe(800);
  });

  it('keeps an existing same-day multi-host doc', () => {
    const existing = { date: '2026-06-06', hosts: { 'x.com': snap('x.com', [100]) } };
    const doc = coerceMultiHost(existing, '2026-06-06');
    expect(Object.keys(doc.hosts)).toEqual(['x.com']);
    expect(doc.counterSessions['x.com']).toBeDefined();
  });

  it('drops stale prior-day data', () => {
    const stale = { date: '2026-06-05', hosts: { 'x.com': snap('x.com', [100]) } };
    expect(coerceMultiHost(stale, '2026-06-06').hosts).toEqual({});
  });
});

describe('aggregateDiagnosticCounters', () => {
  it('sums failures from separate tabs, including two tabs on the same host', () => {
    expect(aggregateDiagnosticCounters({
      'ss-x-1': { observedAt: 1, host: 'x.com', counters: { imageAnalysisFailed: 2 } },
      'ss-x-2': { observedAt: 2, host: 'x.com', counters: { imageAnalysisFailed: 1, videoAnalysisOverlapReleased: 1 } },
      'ss-fb': { observedAt: 3, host: 'facebook.com', counters: { videoAnalysisOverlapReleased: 2 } },
    })).toEqual({
      imageAnalysisFailed: 3,
      videoAnalysisOverlapReleased: 3,
    });
  });
});

describe('aggregateDiagnosticCounterFirstSeen', () => {
  it('keeps the earliest first bump per counter and ignores sessions without stamps', () => {
    expect(aggregateDiagnosticCounterFirstSeen({
      'ss-1': {
        observedAt: 3, host: 'x.com',
        counters: { videoAnalysisOverlapReleased: 9, videoAnalysisQueued: 1 },
        counterFirstSeen: { videoAnalysisOverlapReleased: 5_000, videoAnalysisQueued: 90_000 },
      },
      'ss-2': {
        observedAt: 4, host: 'facebook.com',
        counters: { videoAnalysisOverlapReleased: 8 },
        counterFirstSeen: { videoAnalysisOverlapReleased: 2_000 },
      },
      // Persisted before stamping existed: contributes totals, no stamp.
      'ss-legacy': { observedAt: 1, host: 'x.com', counters: { videoAnalysisOverlapReleased: 4 } },
    })).toEqual({
      videoAnalysisOverlapReleased: 2_000,
      videoAnalysisQueued: 90_000,
    });
  });

  it('stamps a counter once, at its first bump, not at every bump', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-02T01:55:00Z'));
    bumpCounter('videoAnalysisOverlapReleased');
    vi.setSystemTime(new Date('2026-08-02T21:15:00Z'));
    bumpCounter('videoAnalysisOverlapReleased');
    bumpCounter('videoAnalysisQueued');

    const stamps = _getDiagnosticCounterFirstSeenForTesting();
    expect(new Date(stamps.videoAnalysisOverlapReleased).toISOString()).toBe('2026-08-02T01:55:00.000Z');
    expect(new Date(stamps.videoAnalysisQueued).toISOString()).toBe('2026-08-02T21:15:00.000Z');
  });
});

describe('post intervention outcomes', () => {
  it('distinguishes concurrent attempts, terminal outcomes, and a later PASS', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const first = beginPostIntervention('twitter:42', 'hide', 'twitter 42');
    const second = beginPostIntervention('twitter:42', 'hide', 'twitter 42');

    expect(first.concurrent).toBe(false);
    expect(second.concurrent).toBe(true);

    finishPostIntervention(first, 'applied', 'visual-applied', 'accepted');
    finishPostIntervention(second, 'suppressed', 'stale-classification', 'not-sent');
    expect(notePostPassAfterIntervention('twitter:42', 'twitter 42')).toBe(true);

    expect(_getDiagnosticCountersForTesting()).toMatchObject({
      postInterventionRequested: 2,
      postInterventionConcurrent: 1,
      postInterventionApplied: 1,
      postInterventionSuppressed: 1,
      postInterventionReceiptAccepted: 1,
      postInterventionReceiptNotSent: 1,
      postInterventionPassAfterRequest: 1,
    });
    expect(log.mock.calls.some(([message]) => String(message).includes('post intervention applied'))).toBe(true);
    expect(log.mock.calls.some(([message]) => String(message).includes('reclassified as pass'))).toBe(true);
  });
});

describe('diagnostics session retention', () => {
  it('retains the highest-risk climb alongside recent calm sessions', () => {
    const hosts: Record<string, DiagnosticsSnapshot> = {
      climb: snap('youtube.com', [200, 500, 900, 1400, 1800, 2200]),
    };
    const sessions: Record<string, { observedAt: number; host: string; counters: Record<string, number> }> = {
      climb: { observedAt: 1, host: 'youtube.com', counters: {} },
    };
    for (let i = 0; i < 25; i++) {
      const id = `calm-${i}`;
      hosts[id] = snap('x.com', [100, 101]);
      sessions[id] = { observedAt: 100 + i, host: 'x.com', counters: {} };
    }

    const pruned = pruneDiagnosticHeapSessions(hosts, sessions, 20);

    expect(Object.keys(pruned)).toHaveLength(20);
    expect(pruned.climb).toBeDefined();
    expect(pruned['calm-24']).toBeDefined();
  });

  it('keeps same-day legacy heap evidence through the first session persist and read', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-06T12:00:00Z'));
    const storage: Record<string, unknown> = {
      fw_diagnostics: {
        date: '2026-06-06',
        hosts: {
          'youtube.com': snap('youtube.com', [200, 500, 900, 1400, 1800, 2200]),
        },
      },
    };
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: vi.fn(async () => ({ ...storage })),
          set: vi.fn(async (values: Record<string, unknown>) => { Object.assign(storage, values); }),
        },
      },
    });

    bumpCounter('videoAnalysisOverlapReleased');
    await vi.advanceTimersByTimeAsync(5_100);
    const result = await readDiagnosticsResult();

    expect(result.snapshot.host).toBe('youtube.com');
    expect(result.snapshot.peakMB).toBe(2200);
    expect(result.counterTotals.videoAnalysisOverlapReleased).toBe(1);
  });
});
