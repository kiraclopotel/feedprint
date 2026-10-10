// The Overview must state each quantity ONCE.
//
// The first outside review of this product (2026-08-21) called the dashboard
// redundant, and the count backed him up. The landing card held a briefing
// sentence carrying six numbers, and directly beneath it a row of six stat
// tiles. Five of the six tiles repeated a number the sentence immediately
// above them had just said, so the page stated the same three quantities
// across four time windows before saying anything about what had actually
// been prevented. Only "videos checked" appeared nowhere else.
//
// Redundancy is a countable property, not a matter of taste, which means it
// can be guarded. The rule this file enforces:
//
//   The figure the page leads with appears EXACTLY ONCE.
//
// The page now leads with the head above every tab (TodayHead), which says the
// day's items, sites, hidden and flagged in its three short lines. So the Overview's
// first card says none of those again: it answers where they came from.
//
// That is deliberately the narrow claim. It does not police prose or forbid
// a number appearing elsewhere on the page under a different question (the
// 7-day balance card asks a different question and keeps its own figures).
// It catches the specific regression that happened: a second restatement
// bolted next to the first because each looked reasonable on its own.

import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import { createElement } from 'react';
import { OverviewTab } from '../../../../../src/ui/dashboard/components/OverviewTab';
import { I18nProvider } from '../../../../../src/i18n/react';
import type { ForensicRecord } from '../../../../../src/types/forensic';

let seq = 0;
function rec(partial: Partial<ForensicRecord>): ForensicRecord {
  seq++;
  return {
    id: `r-${seq}`,
    timestamp: '2026-07-15T10:00:00.000Z',
    platform: 'twitter',
    originalText: 'text',
    originalHash: 'h',
    originalLength: 4,
    neutralizedText: '',
    techniques: [],
    overallScore: 0,
    userAgeCategory: 'teen',
    aiSource: 'rules',
    chainPosition: seq,
    kind: 'post',
    verdict: 'pass',
    ...partial,
  } as ForensicRecord;
}

// A day whose numbers are all DISTINCT, so a count of one number in the HTML
// can never be satisfied by a different quantity that happens to match. 31
// items: 7 flagged (3 of them hidden), 24 passed, on 2 platforms.
function aDay(): ForensicRecord[] {
  const out: ForensicRecord[] = [];
  for (let i = 0; i < 24; i++) {
    out.push(rec({ timestamp: `2026-07-15T10:${String(i).padStart(2, '0')}:00Z`, verdict: 'pass' }));
  }
  for (let i = 0; i < 4; i++) {
    out.push(rec({ timestamp: `2026-07-15T11:${String(i).padStart(2, '0')}:00Z`, verdict: 'flagged' }));
  }
  for (let i = 0; i < 3; i++) {
    out.push(rec({ timestamp: `2026-07-15T11:3${i}:00Z`, verdict: 'flagged-hidden' }));
  }
  out.push(rec({ timestamp: '2026-07-15T12:00:00Z', verdict: 'pass', platform: 'facebook' }));
  return out;
}

function render(records: ForensicRecord[]): string {
  return renderToString(
    createElement(
      I18nProvider,
      { lang: 'en', children: createElement(OverviewTab, {
        records,
        onDrill: () => {},
        onOpenStatistics: () => {},
      }) } as never,
    ),
  );
}

// The landing card only. Everything after it answers different questions on
// different windows and is out of scope for this rule.
function landingCard(html: string): string {
  const start = html.indexOf('ov-brief');
  expect(start).toBeGreaterThan(-1);
  const end = html.indexOf('ov-card', html.indexOf('</section>', start));
  return end > start ? html.slice(start, end) : html.slice(start);
}

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe('the Overview landing card does not restate the head', () => {
  const html = render(aDay());
  const card = landingCard(html);
  const text = card.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

  it('renders the card at all', () => {
    // Guard the guard: an empty or failed render would pass every count below.
    expect(card).toContain('ov-chip');
    expect(card.length).toBeGreaterThan(200);
  });

  it('says none of the day counts the head says', () => {
    // 32 items, 7 flagged: the head's sentence carries them, so neither prints here (31 is the twitter chip, a site's share).
    expect(occurrences(card, '>7<')).toBe(0);
    expect(occurrences(card, '>32<')).toBe(0);
    expect(text).not.toMatch(/\b32 items\b/);
    expect(card).not.toContain('ov-hero-value');
  });

  it('carries no stat-tile row', () => {
    // The six-tile row is the shape that caused this. Its return would be a
    // regression even if the tile labels changed.
    expect(card).not.toContain('ov-kpi-row');
    expect(card).not.toContain('ov-kpi"');
  });

  it('answers where the day came from: the sites, the sessions, the flagged trend', () => {
    expect(text).toContain('Where it came from');
    expect(text).toMatch(/It came in \d+ sessions?\./);
    expect(text).toContain('Flagged for review:');
  });

  it('keeps videos-checked, the one figure that lived nowhere else', () => {
    const withVideo = aDay();
    withVideo.push(rec({ timestamp: '2026-07-15T12:30:00Z', kind: 'video', verdict: 'pass' }));
    const c = landingCard(render(withVideo));
    expect(c).toMatch(/watched and checked/);
  });

  it('counts only the videos that were checked, and says so; the skipped ones belong to the head', () => {
    // Three checked videos and two that left before a check: the line says three, never five, and its words say why.
    const day = aDay();
    for (let i = 0; i < 3; i++) day.push(rec({ timestamp: `2026-07-15T12:3${i}:00Z`, kind: 'video', verdict: 'pass' }));
    for (let i = 3; i < 5; i++) day.push(rec({ timestamp: `2026-07-15T12:3${i}:00Z`, kind: 'video', verdict: 'skipped' }));
    const c = landingCard(render(day)).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    expect(c).toContain('3 videos were watched and checked.');
    expect(c).not.toMatch(/\b5 videos\b/);
  });

  it('a quiet day prints no zero and no trend', () => {
    const calm = [
      rec({ timestamp: '2026-07-15T10:00:00Z', verdict: 'pass' }),
      rec({ timestamp: '2026-07-15T10:05:00Z', verdict: 'pass' }),
    ];
    const c = landingCard(render(calm));
    // The head says the day was quiet; the card adds no zero and no flagged trend.
    expect(c).not.toContain('ov-hero-value');
    expect(c).not.toContain('Flagged for review:');
  });
});
