// F3a (2026-08 dashboard honesty audit): the "active platforms · 24h" KPI
// scanned only records.slice(-100), so on any day with >100 records the
// platforms whose activity happened earlier in the trailing-24h window
// silently vanished from the count — the tile under-reported exactly on the
// heavy days a parent most needs it to be right. The KPI must count over the
// ACTUAL 24h window, anchored on the `now` prop the rest of the tab already
// uses (not Date.now()), so the tile agrees with its sibling "today" figures
// and stays deterministic under test.
//
// useDashboardT() reads an I18n context with a safe default (no provider
// needed), same convention as statistics-tab-alltime-denominator.test.ts.

import { describe, it, expect } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StatisticsTab } from '../../../../../src/ui/dashboard/components/StatisticsTab';
import type { ForensicRecord } from '../../../../../src/types/forensic';
import type { ForensicStats } from '../../../../../src/forensics/store';

const NOW = new Date('2026-06-14T00:00:00.000Z');
const HOUR_MS = 60 * 60 * 1000;

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

function makeStats(): ForensicStats {
  return {
    total: 0,
    byTechnique: {},
    byPlatform: {},
    today: 0,
    thisWeek: 0,
    thisMonth: 0,
    blockedThisWeek: 0,
    blockedTotal: 0,
    unsignedRecordsCount: 0,
  };
}

function renderTab(records: ForensicRecord[]): string {
  return renderToStaticMarkup(
    React.createElement(StatisticsTab, {
      records,
      stats: makeStats(),
      now: NOW,
    }),
  );
}

// The tile renders as
//   <span class="fwc-num" ...>N</span><span class="fwc-tile-label">active platforms · 24h</span>
// (chart-kit.tsx KitTile + dashboard-strings kpiActivePlatforms).
function activePlatformsValue(html: string): number {
  const m = html.match(
    /<span class="fwc-num"[^>]*>(\d+)<\/span><span class="fwc-tile-label">active platforms/,
  );
  if (!m) throw new Error('active-platforms tile not found in markup');
  return Number(m[1]);
}

describe('StatisticsTab "active platforms · 24h" KPI window (F3a)', () => {
  it('counts platforms over the whole trailing-24h window on a >100-records day', () => {
    // 150 in-window records. The FIRST 50 are the only instagram activity —
    // a records.slice(-100) scan never sees them and reports 1 platform.
    const records: ForensicRecord[] = [
      ...Array.from({ length: 50 }, (_, i) =>
        makeRecord({
          id: `ig${i}`,
          platform: 'instagram',
          timestamp: new Date(NOW.getTime() - 20 * HOUR_MS + i * 60_000).toISOString(),
        })),
      ...Array.from({ length: 100 }, (_, i) =>
        makeRecord({
          id: `tt${i}`,
          platform: 'tiktok',
          timestamp: new Date(NOW.getTime() - 8 * HOUR_MS + i * 60_000).toISOString(),
        })),
    ];

    expect(activePlatformsValue(renderTab(records))).toBe(2);
  });

  it('still excludes platforms whose only activity is older than 24h', () => {
    const records: ForensicRecord[] = [
      // twitter activity exists, but 30h ago — outside the window.
      makeRecord({
        id: 'old',
        platform: 'twitter',
        timestamp: new Date(NOW.getTime() - 30 * HOUR_MS).toISOString(),
      }),
      ...Array.from({ length: 120 }, (_, i) =>
        makeRecord({
          id: `tt${i}`,
          platform: 'tiktok',
          timestamp: new Date(NOW.getTime() - 5 * HOUR_MS + i * 60_000).toISOString(),
        })),
    ];

    expect(activePlatformsValue(renderTab(records))).toBe(1);
  });

  it('skips records with unparseable timestamps instead of counting their platform', () => {
    const records: ForensicRecord[] = [
      makeRecord({ id: 'bad', platform: 'facebook', timestamp: 'not-a-date' }),
      makeRecord({
        id: 'ok',
        platform: 'tiktok',
        timestamp: new Date(NOW.getTime() - 1 * HOUR_MS).toISOString(),
      }),
    ];

    expect(activePlatformsValue(renderTab(records))).toBe(1);
  });
});
