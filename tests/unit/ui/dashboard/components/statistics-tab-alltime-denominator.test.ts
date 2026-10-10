// DASH-2 (2026-07-13 dashboard-ui audit): the "records today" snapshot tile's
// "X all-time" sub-caption was sourced from `stats.total`, which
// `computeStats()` (store.ts) deliberately scopes to FLAGGED-only records
// (its own comment: "Stats describe MANIPULATION presence, not pipeline
// throughput"). That mixed two counting rules under one "records ... all-time"
// label: the headline number is all-kinds/today, the sub-caption was
// flagged-only/all-time — and it silently diverged from DashHeader's own
// "Records" chip, which correctly shows `records.length` (the true grand
// total). This locks the tile to the TRUE all-time record count, matching
// DashHeader and the sibling "flagged" tile one line below it.
//
// useDashboardT() reads an I18n context with a safe default (no provider
// needed), same convention as feedcard-render.test.ts.

import { describe, it, expect } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StatisticsTab } from '../../../../../src/ui/dashboard/components/StatisticsTab';
import type { ForensicRecord } from '../../../../../src/types/forensic';
import type { ForensicStats } from '../../../../../src/forensics/store';

function makeRecord(over: Partial<ForensicRecord>): ForensicRecord {
  return {
    id: 'r1',
    timestamp: '2026-06-13T21:00:00.000Z',
    platform: 'tiktok',
    originalText: 'sample text',
    originalHash: 'h',
    originalLength: 11,
    neutralizedText: '',
    author: 'creator99',
    postUrl: 'https://www.tiktok.com/@creator99/video/123',
    techniques: [],
    overallScore: 0,
    userAgeCategory: 'teen',
    aiSource: 'cloud',
    feedSource: 'foryou',
    integrityHash: 'ih',
    ...over,
  } as ForensicRecord;
}

// stats.total intentionally set far LOWER than records.length, mirroring
// the real gap between "flagged all-time" and "true all-time" (computeStats
// scopes `total` to flagged/flagged-hidden/undefined-verdict records only).
function makeStats(over: Partial<ForensicStats> = {}): ForensicStats {
  return {
    total: 2, // flagged-only count — must NOT be what the tile renders
    byTechnique: {},
    byPlatform: {},
    today: 0,
    thisWeek: 0,
    thisMonth: 0,
    blockedThisWeek: 0,
    blockedTotal: 0,
    unsignedRecordsCount: 0,
    ...over,
  };
}

function renderTab(records: ForensicRecord[], stats: ForensicStats): string {
  return renderToStaticMarkup(
    React.createElement(StatisticsTab, {
      records,
      stats,
      now: new Date('2026-06-14T00:00:00.000Z'),
    }),
  );
}

describe('StatisticsTab "records today" all-time sub-caption (DASH-2)', () => {
  it('renders the TRUE all-time record total (records.length), not the flagged-only stats.total', () => {
    // 5 total records, only 2 flagged — stats.total (flagged-only) = 2,
    // records.length (true total) = 5. The tile must show 5.
    const records = [
      makeRecord({ id: 'p1', verdict: 'flagged' }),
      makeRecord({ id: 'p2', verdict: 'flagged' }),
      makeRecord({ id: 'p3', verdict: 'pass' }),
      makeRecord({ id: 'p4', verdict: 'pass' }),
      makeRecord({ id: 'p5', verdict: 'skipped' }),
    ];
    const stats = makeStats({ total: 2 });

    const html = renderTab(records, stats);

    // The true total (5) must appear in the "all-time" sub-caption...
    expect(html).toContain('of 5 entries, all months');
    // ...and the stale flagged-only denominator must not.
    expect(html).not.toContain('of 2 entries, all months');
  });

  it('matches DashHeader\'s "Records" chip convention: records.length, not stats.total', () => {
    const records = Array.from({ length: 12 }, (_, i) =>
      makeRecord({ id: `p${i}`, verdict: i < 3 ? 'flagged' : 'pass' }));
    const stats = makeStats({ total: 3 }); // flagged-only

    const html = renderTab(records, stats);

    expect(html).toContain('of 12 entries, all months');
    expect(html).not.toContain('of 3 entries, all months');
  });

  it('the sibling "flagged" tile keeps its own true-total denominator unaffected', () => {
    const records = [
      makeRecord({ id: 'p1', verdict: 'flagged' }),
      makeRecord({ id: 'p2', verdict: 'pass' }),
    ];
    const stats = makeStats({ total: 1 });

    const html = renderTab(records, stats);

    // "of 2 records seen" — records.length, untouched by this fix.
    expect(html).toContain('of 2 items seen, ');
  });
});
