// Pure scan-activity summarizer — src/forensics/scan-activity.ts.

import { describe, it, expect } from 'vitest';
import { summarizeScanActivity } from '../../../src/forensics/scan-activity';
import type { ScanEvent } from '../../../src/forensics/scan-log';

function ev(partial: Partial<ScanEvent> & { action: ScanEvent['action'] }): ScanEvent {
  return {
    timestamp: '2026-06-06T10:00:00.000Z',
    platform: 'twitter',
    feedSource: 'for-you',
    author: 'someone',
    postId: 'p1',
    ...partial,
  };
}

describe('summarizeScanActivity', () => {
  it('returns zeros for no events', () => {
    const s = summarizeScanActivity([]);
    expect(s.totalScanned).toBe(0);
    expect(s.actedOn).toBe(0);
    expect(s.actedPct).toBe(0);
    expect(s.platforms).toEqual([]);
    expect(s.feedSources).toEqual([]);
    expect(s.busiestHour).toBeNull();
  });

  it('classifies pass / protective / cancelled distinctly', () => {
    const s = summarizeScanActivity([
      ev({ action: 'pass' }),
      ev({ action: 'pass' }),
      ev({ action: 'neutralize' }),
      ev({ action: 'hide' }),
      ev({ action: 'cancelled' }),
    ]);
    expect(s.totalScanned).toBe(5);
    expect(s.passed).toBe(2);
    expect(s.actedOn).toBe(2); // neutralize + hide
    expect(s.cancelled).toBe(1);
  });

  it('excludes cancelled from the acted-on denominator', () => {
    // 1 acted, 1 passed, 8 cancelled → completed = 2 → actedPct = 50, NOT 10.
    const events: ScanEvent[] = [
      ev({ action: 'neutralize' }),
      ev({ action: 'pass' }),
      ...Array.from({ length: 8 }, () => ev({ action: 'cancelled' })),
    ];
    const s = summarizeScanActivity(events);
    expect(s.cancelled).toBe(8);
    expect(s.actedPct).toBe(50);
  });

  it('treats every comments-* and collapse/mark action as protective', () => {
    const s = summarizeScanActivity([
      ev({ action: 'collapse' }),
      ev({ action: 'mark' }),
      ev({ action: 'comments-hidden' }),
      ev({ action: 'comments-educational' }),
      ev({ action: 'comments-rewritten' }),
    ]);
    expect(s.actedOn).toBe(5);
    expect(s.actedPct).toBe(100);
  });

  it('groups by platform sorted by scanned desc, with per-group acted%', () => {
    const s = summarizeScanActivity([
      ev({ platform: 'tiktok', action: 'pass' }),
      ev({ platform: 'tiktok', action: 'neutralize' }),
      ev({ platform: 'tiktok', action: 'pass' }),
      ev({ platform: 'facebook', action: 'hide' }),
    ]);
    expect(s.platforms.map(p => p.key)).toEqual(['tiktok', 'facebook']);
    const tt = s.platforms[0];
    expect(tt.scanned).toBe(3);
    expect(tt.actedOn).toBe(1);
    expect(tt.actedPct).toBe(33); // 1/3
    expect(s.platforms[1].actedPct).toBe(100); // facebook 1/1
  });

  it('groups by feed source and defaults blank feedSource to unknown', () => {
    const s = summarizeScanActivity([
      ev({ feedSource: 'following', action: 'pass' }),
      ev({ feedSource: '' as ScanEvent['feedSource'], action: 'pass' }),
    ]);
    const keys = s.feedSources.map(f => f.key).sort();
    expect(keys).toEqual(['following', 'unknown']);
  });

  it('reports the busiest local hour from stored timestamps', () => {
    const s = summarizeScanActivity([
      ev({ timestamp: '2026-06-06T03:00:00.000Z', action: 'pass' }),
      ev({ timestamp: '2026-06-06T03:30:00.000Z', action: 'pass' }),
      ev({ timestamp: '2026-06-06T07:00:00.000Z', action: 'pass' }),
    ]);
    // Two events share the same local hour (whatever TZ); busiest is defined.
    expect(s.busiestHour).not.toBeNull();
    expect(s.busiestHour).toBe(new Date('2026-06-06T03:00:00.000Z').getHours());
  });
});
