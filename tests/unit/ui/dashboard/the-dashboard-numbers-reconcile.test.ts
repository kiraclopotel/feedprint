// The header's entry count, the Statistics bar and the Activity badge count
// one record. On a chain holding every kind of entry, over two months with
// the older one archived, the sets must add up: entries are items, room
// summaries and markers; items are checked or not checked; the badge's
// flagged is the bar's flagged over the same months, and over all months it
// adds the archived month counted by the same rules (month-sets.ts), so it
// does not change when a tab loads that month. The month counts are derived
// data: counting reads the records and changes none of them, and no export
// reads the counts.

import { describe, expect, it } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ForensicRecord } from '../../../../src/types/forensic';
import type { ForensicStats } from '../../../../src/forensics/store';
import { SYSTEM_MARKER_KINDS } from '../../../../src/forensics/system-records';
import { summarizeMonth } from '../../../../src/forensics/archive-summary';
import { I18nProvider } from '../../../../src/i18n/react';
import { StatisticsTab } from '../../../../src/ui/dashboard/components/StatisticsTab';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { countRecordSets, RECORD_SET_NAMES } from '../../../../src/ui/dashboard/record-sets';
import {
  countMonthSets, entriesBreakdown, flaggedItemsAllMonths, olderMonthsNotCounted, type MonthSets,
} from '../../../../src/ui/dashboard/month-sets';

let n = 0;
function rec(day: string, verdict: ForensicRecord['verdict'], over: Partial<ForensicRecord> = {}): ForensicRecord {
  n += 1;
  return {
    id: `r${n}`, timestamp: `${day}T10:${String(n % 60).padStart(2, '0')}:00.000Z`, platform: 'tiktok',
    originalText: 't', originalHash: 'h', originalLength: 1, neutralizedText: '',
    author: 'a', postUrl: '', techniques: [], overallScore: 0,
    userAgeCategory: 'teen', aiSource: 'cloud', feedSource: 'foryou',
    integrityHash: 'ih', verdict, ...over,
  } as ForensicRecord;
}

// Every kind of entry, in a month of its own.
function month(day: string): ForensicRecord[] {
  return [
    rec(day, 'pass'), rec(day, 'pass'), rec(day, 'pass'),
    rec(day, 'flagged'), rec(day, 'flagged-hidden'), rec(day, undefined),
    rec(day, 'blocked'),
    rec(day, 'flagged-hidden', { accountType: 'advertiser' } as Partial<ForensicRecord>),
    rec(day, 'pass', { accountType: 'advertiser' } as Partial<ForensicRecord>),
    rec(day, 'masked'), rec(day, 'skipped'), rec(day, 'cancelled-stale'), rec(day, 'cancelled-video-unjudged'),
    rec(day, 'educational-reframe'), rec(day, 'harm-floor-trigger'),
    // A repeat-exposure mark alone: seen a lot, not flagged and not checked (10 Oct 2026).
    rec(day, 'flagged', { techniques: [{ name: 'repeat-exposure', present: true, confidence: 1, severity: 6 }] } as unknown as Partial<ForensicRecord>),
    rec(day, 'flagged', { kind: 'image' } as Partial<ForensicRecord>),
    rec(day, 'flagged', { detectionMode: 'read-this' }),
    rec(day, 'pass', { kind: 'environment' } as Partial<ForensicRecord>),
    rec(day, 'pass', { kind: 'environment' } as Partial<ForensicRecord>),
    ...[...SYSTEM_MARKER_KINDS].map((kind) => rec(day, 'pass', { kind } as Partial<ForensicRecord>)),
  ];
}

const SEPTEMBER = month('2026-09-14');
const OCTOBER = month('2026-10-05');
const SEP_SUMMARY = summarizeMonth('2026-09', SEPTEMBER);
const SEP_SETS = countMonthSets(SEP_SUMMARY, SEPTEMBER, 0);
// The header's total: the archived month's stored rows plus the active chain.
const WHOLE = SEPTEMBER.length + OCTOBER.length;

const STATS: ForensicStats = {
  total: 0, byTechnique: {}, byPlatform: {}, today: 0, thisWeek: 0, thisMonth: 0,
  blockedThisWeek: 0, blockedTotal: 0, unsignedRecordsCount: 0,
};

function statistics(records: ForensicRecord[]): string {
  return renderToStaticMarkup(React.createElement(I18nProvider, {
    lang: 'en',
    children: React.createElement(StatisticsTab, {
      records, stats: STATS, now: new Date('2026-10-05T12:00:00.000Z'), allTimeCount: WHOLE,
    }),
  }));
}

function legendCount(html: string, label: string): number {
  const m = new RegExp('<strong>([\\d,]+)</strong><span class="fwc-item-label">' + label + '</span>').exec(html);
  if (!m) throw new Error('no legend ' + label);
  return Number(m[1].replace(/,/g, ''));
}

function barNumbers(html: string): { passed: number; checked: number } {
  const m = /(\d+)% passed untouched: ([\d,]+) of ([\d,]+) checked items\./.exec(html);
  if (!m) throw new Error('no balance line');
  return { passed: Number(m[2].replace(/,/g, '')), checked: Number(m[3].replace(/,/g, '')) };
}

describe('the dashboard numbers reconcile on a chain with every kind of entry', () => {
  it('the fixture holds every set the module names', () => {
    const c = countRecordSets([...SEPTEMBER, ...OCTOBER]);
    for (const name of RECORD_SET_NAMES) expect(c[name], name).toBeGreaterThan(0);
  });

  it('entries = items + room summaries + markers, and items = checked + seen a lot + not checked', () => {
    for (const list of [OCTOBER, [...SEPTEMBER, ...OCTOBER]]) {
      const c = countRecordSets(list);
      expect(c.entries).toBe(list.length);
      expect(c.items + c.roomSummaries + c.markers).toBe(c.entries);
      expect(c.checked + c.seenALot + c.notChecked).toBe(c.items);
      expect(c.passed + c.flagged + c.blocked).toBe(c.checked);
      expect(c.items + c.roomSummaries).toBe(c.seen);
    }
  });

  it('sorts the fixture the way the export decides: image and button readings are not checked', () => {
    const c = countRecordSets(OCTOBER);
    expect(c).toMatchObject({ passed: 4, flagged: 3, seenALot: 1, blocked: 2, notChecked: 8, roomSummaries: 2, markers: SYSTEM_MARKER_KINDS.size });
  });

  it('the Statistics bar shows the module checked and passed over the months it is given', () => {
    for (const list of [OCTOBER, [...SEPTEMBER, ...OCTOBER]]) {
      const c = countRecordSets(list);
      const html = statistics(list);
      expect(barNumbers(html)).toEqual({ passed: c.passed, checked: c.checked });
      expect(legendCount(html, 'flagged')).toBe(c.flagged);
      expect(legendCount(html, 'blocked')).toBe(c.blocked);
      expect(html).toContain(`${c.checked} checked items · `);
    }
  });

  it('badge flagged = bar flagged when both read the same months', () => {
    const loaded = [...SEPTEMBER, ...OCTOBER];
    expect(flaggedItemsAllMonths(loaded, [])).toBe(countRecordSets(loaded).flagged);
    const html = statistics(loaded);
    expect(html).toContain(`>${countRecordSets(loaded).flagged}<`);
  });

  it('until September is counted by the same rules, the badge adds its summary, which counts two more', () => {
    // The summary counts a flagged image or button reading as flagged; the module does not. A seen-a-lot mark is
    // out of both (MONTH_SUMMARY_VERSION 4). The badge names this as a month not counted yet.
    const extraInSummary = 2;
    expect(olderMonthsNotCounted([SEP_SUMMARY], new Map())).toBe(1);
    expect(SEP_SUMMARY.flagged).toBe(countRecordSets(SEPTEMBER).flagged + extraInSummary);
    expect(flaggedItemsAllMonths(OCTOBER, [SEP_SUMMARY])).toBe(countRecordSets(OCTOBER).flagged + SEP_SUMMARY.flagged);
  });

  it('with September counted by the same rules, the badge over all months is the module flagged over both months', () => {
    const counted = new Map([['2026-09', SEP_SETS]]);
    const bothLoaded = countRecordSets([...SEPTEMBER, ...OCTOBER]).flagged;
    expect(olderMonthsNotCounted([SEP_SUMMARY], counted)).toBe(0);
    expect(flaggedItemsAllMonths(OCTOBER, [SEP_SUMMARY], counted) - bothLoaded).toBe(0);
    expect(flaggedItemsAllMonths([...SEPTEMBER, ...OCTOBER], [], counted)).toBe(bothLoaded);
  });

  it('an item kept in the archived month and in the active chain counts once, as allRecords counts it', () => {
    const twice = OCTOBER.find((r) => r.verdict === 'flagged' && !r.kind && !r.detectionMode) as ForensicRecord;
    const sepWithCopy = [...SEPTEMBER, twice];
    const summary = summarizeMonth('2026-09', sepWithCopy);
    const counted = new Map([['2026-09', countMonthSets(summary, sepWithCopy, 0)]]);
    const deduped = [...sepWithCopy, ...OCTOBER].filter((r, i, all) => all.findIndex((o) => o.id === r.id) === i);
    expect(flaggedItemsAllMonths(OCTOBER, [summary], counted)).toBe(countRecordSets(deduped).flagged);
  });

  it('a count made against another state of the month is not used: the summary stands until it is counted again', () => {
    const changed = { ...SEP_SUMMARY, recordCount: SEP_SUMMARY.recordCount + 1 };
    const counted = new Map([['2026-09', SEP_SETS]]);
    expect(olderMonthsNotCounted([changed], counted)).toBe(1);
    expect(flaggedItemsAllMonths(OCTOBER, [changed], counted)).toBe(countRecordSets(OCTOBER).flagged + changed.flagged);
    const oldVersion: MonthSets = { ...SEP_SETS, version: 0 };
    expect(olderMonthsNotCounted([SEP_SUMMARY], new Map([['2026-09', oldVersion]]))).toBe(1);
  });

  it('a stored row that would not decode is in the month row count and named, never sorted', () => {
    const withBroken = { ...SEP_SUMMARY, recordCount: SEP_SUMMARY.recordCount + 1 };
    const counted = new Map([['2026-09', countMonthSets(withBroken, SEPTEMBER, 1)]]);
    const b = entriesBreakdown(WHOLE + 1, OCTOBER, [withBroken], counted);
    expect(b.olderSorted?.entries).toBe(SEPTEMBER.length);
    expect(b.olderUnreadable).toBe(1);
    expect(b.loaded.entries + (b.olderSorted?.entries ?? 0) + b.olderUnreadable + b.unaccounted).toBe(WHOLE + 1);
    expect(b.unaccounted).toBe(0);
  });

  it('the month counts are derived data: counting changes no record, and nothing under src/forensics reads them', () => {
    const before = JSON.stringify(SEPTEMBER);
    countMonthSets(SEP_SUMMARY, SEPTEMBER, 0);
    expect(JSON.stringify(SEPTEMBER)).toBe(before);
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
      const p = join(dir, name);
      return statSync(p).isDirectory() ? walk(p) : [p];
    });
    const readers = walk(join(process.cwd(), 'src/forensics')).filter((p) => /month-sets/.test(readFileSync(p, 'utf8')));
    expect(readers).toEqual([]);
  });

  it('the header breakdown sums to the header total, older months counted and not sorted', () => {
    const notLoaded = entriesBreakdown(WHOLE, OCTOBER, [SEP_SUMMARY]);
    expect(notLoaded.olderSorted).toBeNull();
    expect(notLoaded.loaded.entries + notLoaded.olderCounted + notLoaded.unaccounted).toBe(WHOLE);
    expect(notLoaded.olderCounted).toBe(SEPTEMBER.length);
    expect(notLoaded.unaccounted).toBe(0);
    const loaded = entriesBreakdown(WHOLE, [...SEPTEMBER, ...OCTOBER], []);
    expect(loaded.loaded.entries).toBe(WHOLE);
    expect(loaded.olderCounted + loaded.unaccounted).toBe(0);
  });

  it('once September is counted, the breakdown sorts it into the same sets and still sums to the total', () => {
    const b = entriesBreakdown(WHOLE, OCTOBER, [SEP_SUMMARY], new Map([['2026-09', SEP_SETS]]));
    expect(b.olderSorted).toEqual(countRecordSets(SEPTEMBER));
    expect(b.loaded.entries + (b.olderSorted?.entries ?? 0) + b.olderUnreadable + b.unaccounted).toBe(WHOLE);
  });
});
