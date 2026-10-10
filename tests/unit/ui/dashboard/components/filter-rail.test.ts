// Filter-rail pure logic (redesign 2026-08-01, mockup B):
// the two NEW axes (When, Severity), the Kind-of-content axis, and the
// showing-line token derivation — the trust anchor that must name EVERY
// active narrowing (no hidden narrowing, ever).

import { describe, it, expect } from 'vitest';
import {
  matchesWhen, matchesSeverity, matchesKind,
  deriveShowingTokens, formatHourRange,
  WHEN_OPTIONS, SEVERITY_OPTIONS, KIND_OPTIONS, RAIL_WHAT_OPTIONS,
  type ShowingTokenState,
} from '../../../../../src/ui/dashboard/components/filter-rail';
import type { ForensicRecord } from '../../../../../src/types/forensic';

function rec(over: Partial<ForensicRecord>): ForensicRecord {
  return {
    id: 'r', timestamp: '2026-06-14T00:00:00.000Z', platform: 'tiktok',
    originalText: '', originalHash: 'h', originalLength: 0, neutralizedText: '',
    author: 'a', postUrl: '', techniques: [], overallScore: 0,
    userAgeCategory: 'teen', aiSource: 'cloud', feedSource: 'foryou', integrityHash: 'ih',
    ...over,
  } as ForensicRecord;
}

/** Local-time ISO stamp for a given local Y/M/D h:m. */
function localTs(y: number, mo: number, d: number, h = 12, mi = 0): string {
  return new Date(y, mo - 1, d, h, mi, 0).toISOString();
}

// Fixed "now": 2026-08-01 14:00 local.
const NOW = new Date(2026, 7 - 0, 1, 14, 0, 0);

describe('matchesWhen', () => {
  it('any matches everything, including unparseable timestamps', () => {
    expect(matchesWhen(rec({}), 'any', NOW)).toBe(true);
    expect(matchesWhen(rec({ timestamp: 'not-a-date' }), 'any', NOW)).toBe(true);
  });

  it('unparseable timestamps match NOTHING but any (never silently included)', () => {
    for (const w of WHEN_OPTIONS.filter((x) => x !== 'any')) {
      expect(matchesWhen(rec({ timestamp: 'not-a-date' }), w, NOW)).toBe(false);
    }
  });

  it('today = same local calendar day', () => {
    expect(matchesWhen(rec({ timestamp: localTs(2026, 8, 1, 0, 1) }), 'today', NOW)).toBe(true);
    expect(matchesWhen(rec({ timestamp: localTs(2026, 8, 1, 23, 59) }), 'today', NOW)).toBe(true);
    expect(matchesWhen(rec({ timestamp: localTs(2026, 7, 31, 23, 59) }), 'today', NOW)).toBe(false);
  });

  it('yesterday = previous local calendar day, incl. across a month edge', () => {
    expect(matchesWhen(rec({ timestamp: localTs(2026, 7, 31, 5) }), 'yesterday', NOW)).toBe(true);
    expect(matchesWhen(rec({ timestamp: localTs(2026, 8, 1, 5) }), 'yesterday', NOW)).toBe(false);
    expect(matchesWhen(rec({ timestamp: localTs(2026, 7, 30, 5) }), 'yesterday', NOW)).toBe(false);
    // month edge: now = Aug 1 → yesterday is Jul 31 (checked above); also check Mar 1 → Feb 28
    const marchFirst = new Date(2026, 2, 1, 10, 0, 0);
    expect(matchesWhen(rec({ timestamp: localTs(2026, 2, 28, 5) }), 'yesterday', marchFirst)).toBe(true);
  });

  it('last7 = within the trailing 7×24h window', () => {
    expect(matchesWhen(rec({ timestamp: localTs(2026, 7, 26, 12) }), 'last7', NOW)).toBe(true);
    expect(matchesWhen(rec({ timestamp: localTs(2026, 7, 24, 12) }), 'last7', NOW)).toBe(false);
  });

  it('evening = local hour 18-23 (the "Evening (18-24)" option)', () => {
    expect(matchesWhen(rec({ timestamp: localTs(2026, 6, 1, 18, 0) }), 'evening', NOW)).toBe(true);
    expect(matchesWhen(rec({ timestamp: localTs(2026, 6, 1, 23, 59) }), 'evening', NOW)).toBe(true);
    expect(matchesWhen(rec({ timestamp: localTs(2026, 6, 1, 17, 59) }), 'evening', NOW)).toBe(false);
    expect(matchesWhen(rec({ timestamp: localTs(2026, 6, 1, 0, 30) }), 'evening', NOW)).toBe(false);
  });
});

describe('matchesSeverity', () => {
  it('bands split at 5 and 8 (same thresholds as the card severity classes)', () => {
    expect(matchesSeverity(rec({ overallScore: 10 }), 'high')).toBe(true);
    expect(matchesSeverity(rec({ overallScore: 8 }), 'high')).toBe(true);
    expect(matchesSeverity(rec({ overallScore: 7.9 }), 'high')).toBe(false);
    expect(matchesSeverity(rec({ overallScore: 7.9 }), 'medium')).toBe(true);
    expect(matchesSeverity(rec({ overallScore: 5 }), 'medium')).toBe(true);
    expect(matchesSeverity(rec({ overallScore: 4.9 }), 'medium')).toBe(false);
    expect(matchesSeverity(rec({ overallScore: 4.9 }), 'low')).toBe(true);
    expect(matchesSeverity(rec({ overallScore: 0 }), 'low')).toBe(true);
  });

  it('every record falls in exactly one band', () => {
    for (const s of [0, 1, 4.99, 5, 7.99, 8, 10]) {
      const bands = SEVERITY_OPTIONS.filter((b) => matchesSeverity(rec({ overallScore: s }), b));
      expect(bands).toHaveLength(1);
    }
  });

  it('a non-finite score matches no band', () => {
    for (const b of SEVERITY_OPTIONS) {
      expect(matchesSeverity(rec({ overallScore: NaN }), b)).toBe(false);
    }
  });
});

describe('matchesKind', () => {
  it('posts/videos/images map 1:1 to record.kind', () => {
    expect(matchesKind(rec({ kind: 'post' }), 'posts')).toBe(true);
    expect(matchesKind(rec({ kind: 'video' }), 'videos')).toBe(true);
    expect(matchesKind(rec({ kind: 'image' }), 'images')).toBe(true);
    expect(matchesKind(rec({ kind: 'video' }), 'posts')).toBe(false);
    expect(matchesKind(rec({ kind: 'post' }), 'videos')).toBe(false);
  });

  it('comments covers every comment-shaped kind', () => {
    for (const k of ['comment', 'top-comment', 'reply', 'reply-to-reply'] as const) {
      expect(matchesKind(rec({ kind: k }), 'comments')).toBe(true);
    }
    expect(matchesKind(rec({ kind: 'post' }), 'comments')).toBe(false);
  });

  it('marker / environment records match no kind option', () => {
    for (const k of KIND_OPTIONS) {
      expect(matchesKind(rec({ kind: 'environment' }), k)).toBe(false);
      expect(matchesKind(rec({ kind: 'reset-marker' }), k)).toBe(false);
      expect(matchesKind(rec({}), k)).toBe(false); // kind undefined
    }
  });
});

describe('RAIL_WHAT_OPTIONS', () => {
  it('exposes the verdict-shaped FeedFilter values (kinds live on the Kind axis)', () => {
    expect([...RAIL_WHAT_OPTIONS]).toEqual(
      ['all', 'flagged', 'hidden', 'blocked', 'rewritten', 'ai', 'passed', 'ads', 'repeat-offenders', 'disputed'],
    );
  });
});

// ── Showing-line tokens (trust anchor: every narrowing named, none hidden) ──
const CLEAN: ShowingTokenState = {
  filter: 'all', platform: 'all', account: 'all',
  when: 'any', severity: null, kind: null, mode: null, model: null, search: '',
  technique: null, hiddenCategory: null, safetyBucket: null,
  recordIdsCount: null, roomUrl: null, hourRange: null,
  surface: null, seen: null, author: null, session: null,
};

describe('deriveShowingTokens', () => {
  it('no active narrowing → no tokens', () => {
    expect(deriveShowingTokens(CLEAN)).toEqual([]);
  });

  it('every axis produces exactly one token when active', () => {
    const all = deriveShowingTokens({
      filter: 'flagged', platform: 'tiktok', account: 'person',
      when: 'today', severity: 'high', kind: 'comments', mode: 'relaxed', model: 'openai/gpt-oss-120b', search: 'shame',
      technique: 'shame-attack', hiddenCategory: 'Other blocks', safetyBucket: 'slurs',
      recordIdsCount: 4, roomUrl: 'https://x.com/p/1', hourRange: [18, 23],
      surface: null, seen: null, author: null, session: null,
    });
    expect(all.map((t) => t.axis)).toEqual([
      'place', 'what', 'who', 'when', 'severity', 'kind', 'mode', 'model', 'search',
      'technique', 'hidden-category', 'safety', 'record-ids', 'room', 'hour',
    ]);
  });

  it('local rail picks are NOT drill tokens; cross-tab drill filters ARE', () => {
    const all = deriveShowingTokens({
      ...CLEAN,
      platform: 'tiktok', filter: 'flagged', when: 'evening', severity: 'low',
      kind: 'posts', account: 'group', search: 'x',
      technique: 'shame-attack', hiddenCategory: 'c', safetyBucket: 's',
      recordIdsCount: 2, roomUrl: 'u', hourRange: [0, 5],
    });
    const drills = all.filter((t) => t.drill).map((t) => t.axis);
    const locals = all.filter((t) => !t.drill).map((t) => t.axis);
    expect(drills).toEqual(['technique', 'hidden-category', 'safety', 'record-ids', 'room', 'hour']);
    expect(locals).toEqual(['place', 'what', 'who', 'when', 'severity', 'kind', 'search']);
  });

  it('whitespace-only search produces no token; trimmed value is carried', () => {
    expect(deriveShowingTokens({ ...CLEAN, search: '   ' })).toEqual([]);
    expect(deriveShowingTokens({ ...CLEAN, search: '  hi ' })[0]).toMatchObject({ axis: 'search', value: 'hi' });
  });

  it('a zero-size drilled id set still shows (0 is a real narrowing)', () => {
    expect(deriveShowingTokens({ ...CLEAN, recordIdsCount: 0 })).toEqual([
      { axis: 'record-ids', value: '0', drill: true },
    ]);
  });

  it('hour range formats zero-padded', () => {
    expect(formatHourRange([8, 9])).toBe('08:00-09:59');
    expect(deriveShowingTokens({ ...CLEAN, hourRange: [22, 1] })[0].value).toBe('22:00-01:59');
  });
});
