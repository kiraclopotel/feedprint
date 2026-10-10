// Behavioral-signals survivor (design §2) — re-serve pattern analytics.
// Locks: within-session repeats are NOT re-serves; cross-session same-hash
// is; day/session counting; technique profile rollup; determinism.

import { describe, it, expect } from 'vitest';
import type { ForensicRecord } from '../../../src/types/forensic';
import { computeReservePatterns } from '../../../src/forensics/reserve';

let seq = 0;
function rec(hash: string, ts: string, opts: Partial<ForensicRecord> = {}): ForensicRecord {
  seq++;
  return {
    id: opts.id ?? `r${seq}`,
    timestamp: ts,
    platform: (opts.platform ?? 'tiktok') as ForensicRecord['platform'],
    originalText: opts.originalText ?? `content for ${hash}`,
    originalHash: hash,
    author: opts.author ?? 'creator',
    ...opts,
  } as ForensicRecord;
}

describe('computeReservePatterns', () => {
  it('returns nothing for empty / single / unique-content inputs', () => {
    expect(computeReservePatterns([])).toEqual([]);
    expect(computeReservePatterns([rec('h1', '2026-06-01T10:00:00Z')])).toEqual([]);
    expect(computeReservePatterns([
      rec('h1', '2026-06-01T10:00:00Z'),
      rec('h2', '2026-06-02T10:00:00Z'),
    ])).toEqual([]);
  });

  it('does NOT count within-session repeats (extraction noise) as re-serves', () => {
    const out = computeReservePatterns([
      rec('h1', '2026-06-01T10:00:00Z'),
      rec('h1', '2026-06-01T10:05:00Z'),
      rec('h1', '2026-06-01T10:20:00Z'),
    ]);
    expect(out).toEqual([]); // one session, minSessions=2 not met
  });

  it('detects a cross-session, cross-day re-serve with honest counts', () => {
    const out = computeReservePatterns([
      rec('h1', '2026-06-01T10:00:00Z'),
      rec('h1', '2026-06-01T10:05:00Z'), // same session — counts as a serve, not a new session
      rec('h1', '2026-06-03T18:00:00Z'),
      rec('h1', '2026-06-05T09:00:00Z'),
      rec('h2', '2026-06-01T10:01:00Z'), // unrelated unique content
    ]);
    expect(out).toHaveLength(1);
    const r = out[0];
    expect(r.contentHash).toBe('h1');
    expect(r.serveCount).toBe(4);
    expect(r.distinctSessions).toBe(3);
    expect(r.distinctDays).toBe(3);
    expect(r.daySpan).toBe(4);
    expect(r.recordIds).toHaveLength(4);
    expect(r.timestamps[0] < r.timestamps[3]).toBe(true);
  });

  it('rolls up the technique profile across serves (max severity, occurrences)', () => {
    const out = computeReservePatterns([
      rec('h1', '2026-06-01T10:00:00Z', {
        techniques: [{ name: 'fomo', severity: 5, confidence: 0.9 }],
      }),
      rec('h1', '2026-06-02T10:00:00Z', {
        techniques: [
          { name: 'fomo', severity: 7, confidence: 0.9 },
          { name: 'false-urgency', severity: 6, confidence: 0.8 },
        ],
      }),
    ]);
    expect(out[0].techniqueProfile).toEqual([
      { name: 'fomo', maxSeverity: 7, occurrences: 2 },
      { name: 'false-urgency', maxSeverity: 6, occurrences: 1 },
    ]);
  });

  it('sorts by serve count, is deterministic across input order', () => {
    const records = [
      rec('busy', '2026-06-01T10:00:00Z'), rec('busy', '2026-06-02T10:00:00Z'), rec('busy', '2026-06-03T10:00:00Z'),
      rec('quiet', '2026-06-01T11:00:00Z'), rec('quiet', '2026-06-04T11:00:00Z'),
    ];
    const a = computeReservePatterns(records);
    const b = computeReservePatterns([...records].reverse());
    expect(a.map((x) => x.contentHash)).toEqual(['busy', 'quiet']);
    expect(b).toEqual(a);
  });
});
