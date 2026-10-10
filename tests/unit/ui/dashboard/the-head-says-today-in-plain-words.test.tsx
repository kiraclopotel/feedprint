// @vitest-environment jsdom
//
// The dashboard's first screen says the latest day in three short lines (direction A, 9 Oct 2026). Its numbers must be
// the ones the rest of the page already prints: the Overview's items and flagged for that day, and the timeline filter's
// "Hidden" (a checked item a rule hid). Its words must be the page's own plain ones ("hidden", "flagged for review"),
// never a coined term a stranger cannot read (the head's note of 9 Oct 03:3x on "carried pressure"). And the product's
// name comes from one constant, because the name may change.

import { describe, it, expect, afterEach } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import type { ForensicRecord } from '../../../../src/types/forensic';
import { computeOverview } from '../../../../src/ui/dashboard/components/overview-data';
import { computeToday, TodayHead } from '../../../../src/ui/dashboard/components/TodayHead';
import { PRODUCT_NAME, dashboardWords } from '../../../../src/ui/dashboard/dashboard-words';
import { isBlockedItem } from '../../../../src/ui/dashboard/record-sets';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let seq = 0;
function rec(partial: Partial<ForensicRecord>): ForensicRecord {
  seq++;
  return {
    id: `r-${seq}`, timestamp: '2026-07-15T10:00:00.000Z', platform: 'twitter', originalText: 'text', originalHash: 'h',
    originalLength: 4, neutralizedText: '', techniques: [], overallScore: 0, userAgeCategory: 'teen', aiSource: 'rules',
    chainPosition: seq, kind: 'post', verdict: 'pass', ...partial,
  } as ForensicRecord;
}

// The latest day: five things on two sites, one flagged, two hidden by a rule; a housekeeping marker that is not an item.
const records: ForensicRecord[] = [
  rec({ timestamp: '2026-07-14T09:00:00', verdict: 'pass' }),
  rec({ timestamp: '2026-07-14T09:05:00', verdict: 'blocked' }),
  rec({ timestamp: '2026-07-15T08:00:00', verdict: 'pass' }),
  rec({ timestamp: '2026-07-15T08:01:00', verdict: 'flagged', platform: 'facebook' }),
  rec({ timestamp: '2026-07-15T08:02:00', verdict: 'blocked' }),
  rec({ timestamp: '2026-07-15T08:03:00', verdict: 'blocked', platform: 'facebook' }),
  rec({ timestamp: '2026-07-15T08:04:00', verdict: 'pass' }),
  rec({ timestamp: '2026-07-15T08:05:00', kind: 'reset-marker' }),
];

describe('the head says the latest day in three short lines', () => {
  it('counts what the Overview and the Hidden filter count, on the same day', () => {
    const today = computeToday(records, new Date('2026-07-15T20:00:00'))!;
    const ov = computeOverview(records)!;
    expect(today.items).toBe(ov.brief.items);
    expect(today.items).toBe(5);
    expect(today.sites).toBe(2);
    expect(today.flagged).toBe(ov.brief.flagged);
    expect(today.hidden).toBe(records.filter((r) => r.timestamp.startsWith('2026-07-15') && isBlockedItem(r)).length);
    expect(today.hidden).toBe(2);
    expect(today.when).toBe('today');
    expect(today.week).toHaveLength(7);
    expect(today.week[6]).toEqual({ dayKey: '2026-07-15', items: 5, hidden: 2 });
    expect(today.week[5]).toEqual({ dayKey: '2026-07-14', items: 2, hidden: 1 });
    // A day with nothing recorded is not a day of zero.
    expect(today.week[0].items).toBeNull();
  });

  it('names the day as yesterday, or by its date, when the latest records are older', () => {
    expect(computeToday(records, new Date('2026-07-16T09:00:00'))!.when).toBe('yesterday');
    expect(computeToday(records, new Date('2026-07-20T09:00:00'))!.when).toBe('date');
  });

  it('says nothing when there is nothing recorded', () => {
    expect(computeToday([])).toBeNull();
  });

  let host: HTMLDivElement | null = null;
  let root: Root | null = null;
  afterEach(async () => { if (root) await act(async () => { root!.unmount(); }); host?.remove(); host = null; root = null; });

  it('reads as three short lines about the day, in the page own words and the one product name', async () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => { root!.render(createElement(TodayHead, { records, lang: 'en' })); });
    const text = host.textContent ?? '';
    expect(text).toMatch(/your feed showed you 5 things on 2 sites\./);
    expect(text).toContain(`${PRODUCT_NAME} wrote down every one.`);
    expect(text).toContain('2 were hidden, 1 was flagged for review.');
    expect(text).not.toMatch(/pressure/i);
  });

  it('says how many were not checked, so the day total and the Overview decided share agree', async () => {
    // Six items, three skipped: the head says 6 things and 3 not checked; the Overview's balance says 3 of 3 decided.
    const day = [0, 1, 2].map((i) => rec({ timestamp: `2026-07-15T09:0${i}:00`, verdict: 'pass', kind: 'video' }))
      .concat([3, 4, 5].map((i) => rec({ timestamp: `2026-07-15T09:0${i}:00`, verdict: 'skipped', kind: 'video' })));
    const today = computeToday(day, new Date('2026-07-15T20:00:00'))!;
    expect(today.items).toBe(6);
    expect(today.notChecked).toBe(3);
    expect(computeOverview(day)!.kpis.find((k) => k.key === 'videos')!.value).toBe(3);
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => { root!.render(createElement(TodayHead, { records: day, lang: 'en' })); });
    expect(host.textContent).toContain('3 were not checked.');
  });

  it('gives a screen reader each day of the week chart, the hidden part counted inside the day', async () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => { root!.render(createElement(TodayHead, { records, lang: 'en' })); });
    const label = host.querySelector('[role="img"]')?.getAttribute('aria-label') ?? '';
    expect(label.startsWith(dashboardWords('en').weekCaption)).toBe(true);
    expect(label.slice(dashboardWords('en').weekCaption.length).split('; ')).toHaveLength(7);
    expect(label).toContain('Tue: 2 in the feed, 1 of them hidden; Wed: 5 in the feed, 2 of them hidden.');
    expect(label).toContain('Mon: nothing recorded');
    await act(async () => { root!.render(createElement(TodayHead, { records, lang: 'ro' })); });
    expect(host.querySelector('[role="img"]')?.getAttribute('aria-label')).toContain('5 în feed, dintre care 2 ascunse.');
  });

  it('has the same words in every language the dashboard speaks', () => {
    for (const lang of ['en', 'ro', 'es', 'pt-BR'] as const) {
      const w = dashboardWords(lang);
      expect(w.tabTimeline.length).toBeGreaterThan(3);
      expect(w.keptAll(PRODUCT_NAME)).toContain(PRODUCT_NAME);
      expect(w.showed(5, 2)).toContain('5');
      expect(w.hiddenClause(2)).toContain('2');
      expect(w.breakdownShow).not.toBe(w.breakdownHide);
    }
    expect(dashboardWords('ro').showed(20, 2)).toContain('20 de lucruri');
    expect(dashboardWords('en').tabTimeline).toBe('Your timeline');
  });
});
