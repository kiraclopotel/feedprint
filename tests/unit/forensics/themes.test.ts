// Sequence analysis — themes.ts ask-functions.
// Locks: predominant ordering, cross-day filtering. (sessionize deleted
// 2026-07-14 — zero runtime callers; the dashboard ledger's inline
// derivation is the app's one session mechanism.)

import { describe, it, expect } from 'vitest';
import type { ForensicRecord } from '../../../src/types/forensic';
import type { Theme } from '../../../src/forensics/topics';
import {
  predominantThemes,
  crossDayThemes,
} from '../../../src/forensics/themes';

let seq = 0;
function rec(text: string, opts: Partial<ForensicRecord> = {}): ForensicRecord {
  seq++;
  return {
    id: opts.id ?? `r${seq}`,
    timestamp: opts.timestamp ?? new Date(Date.UTC(2026, 5, 1, 10, seq)).toISOString(),
    platform: (opts.platform ?? 'tiktok') as ForensicRecord['platform'],
    originalText: text,
    author: opts.author ?? 'someone',
    ...opts,
  } as ForensicRecord;
}

function theme(partial: Partial<Theme>): Theme {
  return {
    id: 'id',
    label: 'l',
    topTerms: [],
    memberRecordIds: [],
    recordCount: 0,
    dateSpan: { start: '', end: '' },
    daysActive: 0,
    perDayCounts: {},
    platforms: {},
    flaggedCount: 0,
    severitySum: 0,
    topEntities: [],
    ...partial,
  };
}

describe('predominantThemes', () => {
  it('orders by count then daysActive and caps at top', () => {
    const themes = [
      theme({ id: 'a', recordCount: 5, daysActive: 1 }),
      theme({ id: 'b', recordCount: 9, daysActive: 2 }),
      theme({ id: 'c', recordCount: 5, daysActive: 4 }),
    ];
    expect(predominantThemes(themes).map((t) => t.id)).toEqual(['b', 'c', 'a']);
    expect(predominantThemes(themes, { top: 1 }).map((t) => t.id)).toEqual(['b']);
  });
});

describe('crossDayThemes', () => {
  it('keeps only themes active on >= minDays days, most persistent first', () => {
    const themes = [
      theme({ id: 'a', daysActive: 2, recordCount: 50 }),
      theme({ id: 'b', daysActive: 5, recordCount: 10 }),
      theme({ id: 'c', daysActive: 3, recordCount: 20 }),
    ];
    expect(crossDayThemes(themes).map((t) => t.id)).toEqual(['b', 'c']);
    expect(crossDayThemes(themes, { minDays: 2 }).map((t) => t.id)).toEqual(['b', 'c', 'a']);
  });
});
