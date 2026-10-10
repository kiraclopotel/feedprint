import { describe, it, expect } from 'vitest';
import type { ForensicRecord } from '../../../src/types/forensic';
import {
  periodWindow, previousPeriodWindow,
  aggregateByHour, topRepeatedRooms, aggregateByActionFamily,
} from '../../../src/forensics/data-layer';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

describe('data-layer period arithmetic', () => {
  it('day window length equals 24h (DST-tolerant ±1h)', () => {
    const w = periodWindow('day', new Date(2026, 4, 2, 14, 30));
    const len = new Date(w.endISO).getTime() - new Date(w.startISO).getTime();
    expect(Math.abs(len - DAY_MS)).toBeLessThanOrEqual(HOUR_MS);
  });

  it('week window starts on local Sunday', () => {
    // 2026-05-02 is Saturday locally. Week-start should be Sunday 2026-04-26.
    const w = periodWindow('week', new Date(2026, 4, 2));
    expect(new Date(w.startISO).getDay()).toBe(0); // 0 = Sunday
  });

  it('week window length equals 7 days (DST-tolerant ±1h)', () => {
    const w = periodWindow('week', new Date(2026, 4, 2));
    const len = new Date(w.endISO).getTime() - new Date(w.startISO).getTime();
    expect(Math.abs(len - 7 * DAY_MS)).toBeLessThanOrEqual(HOUR_MS);
  });

  it('month window starts day 1 of anchor month + ends day 1 of next month', () => {
    const w = periodWindow('month', new Date(2026, 4, 15));
    expect(new Date(w.startISO).getDate()).toBe(1);
    expect(new Date(w.startISO).getMonth()).toBe(4); // May = 4 (0-indexed)
    expect(new Date(w.endISO).getDate()).toBe(1);
    expect(new Date(w.endISO).getMonth()).toBe(5); // June
  });

  it('previousPeriodWindow on January rolls year back to December', () => {
    const jan = periodWindow('month', new Date(2026, 0, 15));
    const prev = previousPeriodWindow(jan);
    expect(new Date(prev.startISO).getMonth()).toBe(11); // December = 11
    expect(new Date(prev.startISO).getFullYear()).toBe(2025);
    // G5 (2026-08-04): previousPeriodWindow steps back by local calendar
    // days (31 for a January window), so the start lands deterministically
    // on Dec 1. Behavioral contract: same day-count, ends at current.startISO.
    expect(new Date(prev.startISO).getDate()).toBe(1);
    expect(prev.endISO).toBe(jan.startISO);
  });

  it('previousPeriodWindow same-length contract on week (DST-tolerant ±1h)', () => {
    const w = periodWindow('week', new Date(2026, 4, 2));
    const prev = previousPeriodWindow(w);
    const wLen = new Date(w.endISO).getTime() - new Date(w.startISO).getTime();
    const prevLen = new Date(prev.endISO).getTime() - new Date(prev.startISO).getTime();
    expect(Math.abs(wLen - prevLen)).toBeLessThanOrEqual(HOUR_MS);
  });
});

function rec(overrides: Partial<ForensicRecord>): ForensicRecord {
  return {
    id: 'fr-stub',
    timestamp: '2026-05-09T00:00:00.000Z',
    platform: 'twitter',
    originalText: 'stub',
    originalHash: 'stub-hash',
    originalLength: 4,
    neutralizedText: '',
    author: '@stub',
    postUrl: 'https://x.com/.../status/0',
    techniques: [],
    overallScore: 0,
    userAgeCategory: 'teen',
    aiSource: 'cloud',
    feedSource: 'for-you',
    integrityHash: 'stub-integrity',
    ...overrides,
  };
}

describe('aggregateByHour', () => {
  it('counts by local hour-of-day', () => {
    // Local-time constructor → hour is unambiguous regardless of test TZ.
    const records = [
      rec({ timestamp: new Date(2026, 4, 2, 23, 15).toISOString() }),
      rec({ timestamp: new Date(2026, 4, 3, 23, 59).toISOString() }),
      rec({ timestamp: new Date(2026, 4, 3, 7, 0).toISOString() }),
    ];
    const out = aggregateByHour(records);
    expect(out[23]).toBe(2);
    expect(out[7]).toBe(1);
    expect(Object.values(out).reduce((a, b) => a + b, 0)).toBe(3);
  });

  it('skips records with invalid timestamps', () => {
    const records = [
      rec({ timestamp: 'not-a-date' }),
      rec({ timestamp: new Date(2026, 4, 2, 1, 0).toISOString() }),
    ];
    const out = aggregateByHour(records);
    expect(out[1]).toBe(1);
    expect(Object.values(out).reduce((a, b) => a + b, 0)).toBe(1);
  });
});

describe('topRepeatedRooms', () => {
  it('groups on the first 60 caption chars and returns top n by count', () => {
    const long = 'A'.repeat(60);
    const records = [
      rec({ roomCaption: long + ' first-seen tail kept for display' }),
      rec({ roomCaption: long + ' DIFFERENT tail, same 60-char group key' }),
      rec({ roomCaption: long + ' third sighting' }),
      rec({ roomCaption: 'lone caption' }),
    ];
    const out = topRepeatedRooms(records, 1);
    expect(out).toHaveLength(1);
    expect(out[0].count).toBe(3);
    // Display value is the full first-seen caption, capped at 120 chars.
    expect(out[0].caption).toBe((long + ' first-seen tail kept for display').slice(0, 120));
  });

  it('caps the display caption at 120 chars', () => {
    const records = [rec({ roomCaption: 'B'.repeat(200) })];
    expect(topRepeatedRooms(records, 5)[0].caption).toHaveLength(120);
  });

  it('skips records with empty or missing captions', () => {
    const records = [
      rec({ roomCaption: '' }),
      rec({}), // roomCaption undefined
      rec({ roomCaption: 'real caption' }),
    ];
    const out = topRepeatedRooms(records, 5);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      caption: 'real caption',
      count: 1,
      url: 'https://x.com/.../status/0',
      platform: 'twitter',
      lastSeen: '2026-05-09T00:00:00.000Z',
    });
  });

  it('carries a drill-down url (roomUrl preferred, postUrl fallback) and the latest sighting time', () => {
    const records = [
      rec({ roomCaption: 'thread', postUrl: '', timestamp: '2026-05-09T00:00:00.000Z' }),
      rec({ roomCaption: 'thread', roomUrl: 'https://x.com/a/status/1', timestamp: '2026-05-10T00:00:00.000Z' }),
    ];
    const out = topRepeatedRooms(records, 5);
    expect(out[0].count).toBe(2);
    // First record had no URL; the later sighting backfills it.
    expect(out[0].url).toBe('https://x.com/a/status/1');
    expect(out[0].lastSeen).toBe('2026-05-10T00:00:00.000Z');
  });
});

describe('aggregateByActionFamily', () => {
  it('classifies pass verdict before detectionMode', () => {
    const out = aggregateByActionFamily([
      rec({ verdict: 'pass', detectionMode: 'sponsored-ad' }),
    ]);
    expect(out.pass).toBe(1);
    expect(out.ads).toBe(0);
  });

  it('classifies the real pipeline detectionMode prefixes', () => {
    // Prefixes as emitted by src/analysis/pipeline.ts + src/forensics/logger.ts.
    const out = aggregateByActionFamily([
      rec({ verdict: 'blocked', detectionMode: 'sponsored-ad' }),
      rec({ verdict: 'flagged', detectionMode: 'profanity-soften:2' }),
      rec({ verdict: 'flagged', detectionMode: 'profanity:1' }),
      rec({ verdict: 'flagged', detectionMode: 'slur:1' }),
      rec({ verdict: 'blocked', detectionMode: 'block:ai-label:capcut' }),
      rec({ verdict: 'flagged', detectionMode: 'combined-detect-neutralize' }),
      rec({ verdict: 'flagged' }), // detectionMode undefined → detection
      // Observed and never judged: its own family, never 'detection'.
      rec({ verdict: 'skipped', skipReason: 'free-tier-no-ai', detectionMode: 'skip:free-tier-no-ai' }),
    ]);
    expect(out).toEqual({ ads: 1, 'house-rule': 3, 'ai-block': 1, detection: 2, pass: 0, 'not-judged': 1 });
  });

  // The hashtag blocklist is the household's OWN list, so it is a house rule,
  // not something FeelingWise judged. It counted as a detection until
  // 2026-09-08: 54 of the 227 in the `detection` bar on the 2026-09-08 export.
  it('routes the hashtag blocklist to house-rule, not ai-block and not detection', () => {
    const out = aggregateByActionFamily([
      rec({ verdict: 'blocked', detectionMode: 'block:hashtag:#ai' }),
    ]);
    expect(out['ai-block']).toBe(0);
    expect(out.detection).toBe(0);
    expect(out['house-rule']).toBe(1);
  });

  // The rename of `profanity-soften` to `profanity-mask` on 2026-09-07 orphaned
  // the branch that caught it, and the swear mask began counting as an AI
  // detection with nothing failing. Both names stay matched: one is what new
  // records carry, the other is what records already on disk carry.
  it('counts the swear mask as a house rule under either of its names', () => {
    const out = aggregateByActionFamily([
      rec({ verdict: 'flagged', detectionMode: 'profanity-mask:1', aiSource: 'rules' }),
      rec({ verdict: 'flagged', detectionMode: 'profanity-soften:1', aiSource: 'rules' }),
      rec({ verdict: 'flagged', detectionMode: 'pre-rewrite-hide:profanity-tier', aiSource: 'rules' }),
      rec({ verdict: 'flagged-hidden', detectionMode: 'blocklist:word:elon', aiSource: 'rules' }),
    ]);
    expect(out['house-rule']).toBe(4);
    expect(out.detection).toBe(0);
  });

  // The gate that makes the next rename harmless. A rule-decided record whose
  // mode this function does not recognise is wrong by one family in house-rule;
  // in `detection` it would be wrong by the product's whole central claim.
  it('a rule with an unrecognised mode can never become a detection', () => {
    const out = aggregateByActionFamily([
      rec({ verdict: 'flagged', detectionMode: 'some-future-rule:7', aiSource: 'rules' }),
      rec({ verdict: 'flagged', detectionMode: 'renamed-gate', aiSource: 'cloud', overrideOrigin: 'identity-slur' }),
    ]);
    expect(out.detection).toBe(0);
    expect(out['house-rule']).toBe(2);
  });

  // The caller filters cancels today, but this function must not depend on
  // being called correctly: a cancelled item was never judged.
  it('cancelled records are not-judged, whatever their mode says', () => {
    const out = aggregateByActionFamily([
      rec({ verdict: 'cancelled-dom-gone', detectionMode: 'cancel:cancelled-dom-gone' }),
      rec({ verdict: 'cancelled-stale', detectionMode: 'cancel:cancelled-stale' }),
    ]);
    expect(out['not-judged']).toBe(2);
    expect(out.detection).toBe(0);
  });

  // E1: adult Block Ads events land as 'block:ads:<token>' (BLOCKED_LOG) —
  // same parent-facing family as the child/teen 'sponsored-ad' verdicts.
  it('counts adult block:ads category events in the ads family', () => {
    const out = aggregateByActionFamily([
      rec({ verdict: 'blocked', detectionMode: 'block:ads:platform-ad-marker' }),
      rec({ verdict: 'blocked', detectionMode: 'sponsored-ad' }),
    ]);
    expect(out.ads).toBe(2);
    expect(out.detection).toBe(0);
  });
});
