// The owner read a large entries count in the header and a smaller checked count in Statistics and took the gap for
// lost statistics. It is not: Entries counts every row the record holds, and checked counts only the items that got a
// verdict. An item scrolled away or skipped before a verdict, a comment-section summary and the record's own markers
// are entries too. The balance card now says so in numbers that add up to the entries. It also counts the whole
// record: the archived months outside the loaded window come in through their saved counts, so the share keeps
// describing all of the record as it grows.
//
// The fixture's counts, in the shape a real export has: 4,506 entries, 3,082 checked (2,782 passed, 221 flagged,
// 79 blocked), 774 items not checked, 190 comment-section summaries and 460 markers.

import { describe, expect, it } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StatisticsTab } from '../../../../src/ui/dashboard/components/StatisticsTab';
import { I18nProvider } from '../../../../src/i18n/react';
import { countMonthSets } from '../../../../src/ui/dashboard/month-sets';
import { summarizeMonth } from '../../../../src/forensics/archive-summary';
import type { ForensicRecord } from '../../../../src/types/forensic';
import type { ForensicStats } from '../../../../src/forensics/store';

let seq = 0;
function rec(verdict: ForensicRecord['verdict'], over: Partial<ForensicRecord> = {}, day = '2026-09-25'): ForensicRecord {
  seq++;
  return {
    id: `r${seq}`, timestamp: `${day}T10:00:00.000Z`, platform: 'facebook', kind: 'post',
    originalText: 't', originalHash: 'h', originalLength: 1, neutralizedText: '',
    author: 'a', postUrl: '', techniques: [], overallScore: verdict === 'flagged' ? 6 : 0,
    userAgeCategory: 'adult', aiSource: 'cloud', feedSource: 'home', integrityHash: 'ih', verdict, ...over,
  } as ForensicRecord;
}
const many = (n: number, make: () => ForensicRecord) => Array.from({ length: n }, make);

function shapedLikeHisRecord(): ForensicRecord[] {
  return [
    ...many(2782, () => rec('pass')),
    ...many(221, () => rec('flagged')),
    ...many(79, () => rec('blocked')),
    ...many(393, () => rec('cancelled-stale' as ForensicRecord['verdict'])),
    ...many(127, () => rec('skipped' as ForensicRecord['verdict'])),
    ...many(254, () => rec('cancelled-post-llm-failure' as ForensicRecord['verdict'])),
    ...many(190, () => rec('pass', { kind: 'environment' } as Partial<ForensicRecord>)),
    ...many(452, () => rec('pass', { kind: 'heartbeat-marker' } as Partial<ForensicRecord>)),
    ...many(8, () => rec('pass', { kind: 'gap-marker' } as Partial<ForensicRecord>)),
  ];
}
// Two days at the window's ends, so the card names the whole span.
function withEnds(records: ForensicRecord[]): ForensicRecord[] {
  records[0] = { ...records[0], timestamp: '2026-09-19T08:00:00.000Z' };
  records[1] = { ...records[1], timestamp: '2026-10-10T08:00:00.000Z' };
  return records;
}

const STATS: ForensicStats = {
  total: 0, byTechnique: {}, byPlatform: {}, today: 0, thisWeek: 0, thisMonth: 0,
  blockedThisWeek: 0, blockedTotal: 0, unsignedRecordsCount: 0,
};

function render(props: Partial<React.ComponentProps<typeof StatisticsTab>> & { records: ForensicRecord[] }): string {
  return renderToStaticMarkup(React.createElement(I18nProvider, {
    lang: 'en',
    children: React.createElement(StatisticsTab, { stats: STATS, now: new Date('2026-10-10T20:00:00.000Z'), ...props }),
  }));
}
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ');

describe('Statistics counts the whole record and says what its entries are', () => {
  it('names the entries that are not checked items, in numbers that add up to the entries', () => {
    const records = withEnds(shapedLikeHisRecord());
    const out = text(render({ records, allTimeCount: records.length }));
    expect(out).toContain('90% passed untouched: 2,782 of 3,082 checked items.');
    expect(out).toContain('4,506 entries: 3,082 checked items, 774 items not checked, 190 comment-section summaries, 460 record-keeping markers');
    expect(3082 + 774 + 190 + 460).toBe(4506);
  });

  it('counts an archived month outside the loaded window, from its saved counts', () => {
    const records = withEnds(shapedLikeHisRecord());
    const older = [...many(1000, () => rec('pass', {}, '2026-06-10')), ...many(50, () => rec('flagged', {}, '2026-06-11'))];
    const summary = summarizeMonth('2026-06', older);
    const monthSets = new Map([['2026-06', countMonthSets(summary, older, 0)]]);
    const out = text(render({ records, allTimeCount: records.length + older.length, unloadedSummaries: [summary], monthSets }));
    expect(out).toContain('of 4,132 checked items.');
    expect(out).toContain('5,556 entries: 4,132 checked items');
    expect(out).toContain('4,132 checked items · Jun 10 to Oct 10');
  });

  it('while an older month is still being counted, the card says so and counts what it has', () => {
    const records = withEnds(shapedLikeHisRecord());
    const summary = summarizeMonth('2026-06', many(1050, () => rec('pass', {}, '2026-06-10')));
    const out = text(render({
      records, allTimeCount: records.length + 1050, unloadedSummaries: [summary], monthSets: new Map(),
      olderMonthsProgress: { done: 0, total: 1 },
    }));
    expect(out).toContain('of 3,082 checked items.');
    expect(out).toContain('Recounting older months by the dashboard');
  });
});
