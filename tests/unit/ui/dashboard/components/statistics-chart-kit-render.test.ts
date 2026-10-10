// Render test for the turn-13 chart-kit re-skin of the Statistics tab.
// Locks the DISPLAY-ONLY port (mockup docs/redesign/mockups/2026-07-17/
// chart-kit.html): the daily trend renders as a 14-column chart with a
// self-describing tooltip per column (kit law: color is never the only
// channel), the feed-balance bar renders as gap-separated segments, and the
// severity distribution uses the locked marker-ramp tokens so severity reads
// the same here as on the in-feed dots. Counting rules are asserted unchanged
// by the sibling test (stats-feed-balance-render.test.ts).

import { describe, it, expect } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StatisticsTab } from '../../../../../src/ui/dashboard/components/StatisticsTab';
import { I18nProvider } from '../../../../../src/i18n/react';
import type { ForensicRecord } from '../../../../../src/types/forensic';
import type { ForensicStats } from '../../../../../src/forensics/store';
import { DASHBOARD_STRINGS } from '../../../../../src/i18n/dashboard-strings';

function rec(id: string, verdict: ForensicRecord['verdict'], over: Partial<ForensicRecord> = {}): ForensicRecord {
  return {
    id, timestamp: '2026-07-03T10:00:00.000Z', platform: 'tiktok',
    originalText: 't', originalHash: 'h', originalLength: 1, neutralizedText: '',
    author: 'a', postUrl: '', techniques: [], overallScore: 0,
    userAgeCategory: 'teen', aiSource: 'cloud', feedSource: 'foryou',
    integrityHash: 'ih', verdict, ...over,
  } as ForensicRecord;
}

const STATS: ForensicStats = {
  total: 0, byTechnique: {}, byPlatform: { tiktok: 3 }, today: 0, thisWeek: 0, thisMonth: 0,
  blockedThisWeek: 0, blockedTotal: 0, unsignedRecordsCount: 0,
};

function render(records: ForensicRecord[]): string {
  return renderToStaticMarkup(
    React.createElement(I18nProvider, {
      lang: 'en',
      children: React.createElement(StatisticsTab, {
        records, stats: STATS, now: new Date('2026-07-03T12:00:00.000Z'),
      }),
    }),
  );
}

describe('StatisticsTab chart kit', () => {
  const records = [
    rec('p1', 'pass'),
    rec('p2', 'pass', { timestamp: '2026-07-02T09:00:00.000Z' }),
    rec('f1', 'flagged', { overallScore: 6 }),
    rec('f2', 'flagged-hidden', { overallScore: 9, timestamp: '2026-07-01T22:00:00.000Z' }),
  ];

  it('renders the daily trend as a 14-column chart with per-column tooltips', () => {
    const html = render(records);
    // one column per day in the 14-day window, each self-describing
    const cols = html.match(/class="fwc-col"/g) ?? [];
    expect(cols.length).toBeGreaterThanOrEqual(14);
    // The per-day tooltip names the day in the interface language, not as the
    // raw bucket key's month-first tail.
    expect(html).toContain('data-tip="Jul 3');
    // legend gives the two series their names (color never the only channel)
    expect(html).toContain('items seen that day');
  });

  it('renders the feed balance as gap-separated kit segments with a legend', () => {
    const html = render(records);
    expect(html).toContain('fwc-stack');
    expect(html).toContain('fwc-legend');
    // the benign majority renders neutral, not a status hue
    expect(html).toContain('--fwc-neutral');
  });

  it('colors the severity distribution with the locked marker ramp', () => {
    const html = render(records);
    expect(html).toContain('--fw-marker-mid');
    expect(html).toContain('--fw-marker-high');
  });
});

describe('the flags-over-time caption says where the count is', () => {
  // The caption said "Count at right" in all four languages. The count is not
  // at the right of anything: it rides the per-bar tooltip, which is where
  // this chart has always put it. A caption that promises a number the screen
  // does not carry is the same mistake as a number without its method, and it
  // is the kind a reader checks first (2026-09-17).
  const records = [rec('f1', 'flagged', { overallScore: 6 })];

  it.each(['en', 'ro', 'es', 'pt-BR'] as const)('%s: names the bar, not a column of numbers', lang => {
    const html = renderToStaticMarkup(
      React.createElement(I18nProvider, {
        lang,
        children: React.createElement(StatisticsTab, {
          records, stats: STATS, now: new Date('2026-07-03T12:00:00.000Z'),
        }),
      }),
    );
    const sub = DASHBOARD_STRINGS[lang].statsManipSub;
    expect(html).toContain(sub.replace(/&/g, '&amp;'));
    for (const promise of ['Count at right', 'Numărul în dreapta', 'recuento va a la derecha', 'contagem fica à direita']) {
      expect(sub).not.toContain(promise);
    }
    // And the count is where the caption now says it is: on the bar itself.
    expect(html).toMatch(/data-tip="[^"]*· \d+/);
  });
});

