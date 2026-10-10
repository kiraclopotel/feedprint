// The Feed log's numbers (10 Oct 2026): what each row says Feedprint did, the window, the chips' counts, and the
// bound on a large record. Every count below is worked out by hand from the fixture beside it.

import { describe, expect, it } from 'vitest';
import type { ForensicRecord } from '../../../../../src/types/forensic';
import { PLATFORM_LABELS } from '../../../../../src/ui/dashboard/components/color-maps';
import { FEED_ACTION_OF_KEY, feedAction, feedLogSlice, feedSeverity, feedWhy, windowReachesBefore, windowStart, OLDER_RUN_STOP } from '../../../../../src/ui/dashboard/components/feed-log';
import { feedActionKeyFor } from '../../../../../src/forensics/feed-action';

// Noon on 10 Oct 2026, local time.
const NOW = new Date(2026, 9, 10, 12, 0, 0);
const at = (day: number, hour: number) => new Date(2026, 9, day, hour, 0, 0).toISOString();

let seq = 0;
function rec(over: Partial<ForensicRecord>): ForensicRecord {
  seq++;
  return {
    id: `r${seq}`, chainPosition: seq, timestamp: at(10, 9), platform: 'youtube', kind: 'post',
    originalText: 'text', techniques: [], verdict: 'pass', ...over,
  } as unknown as ForensicRecord;
}

describe('what Feedprint did, said in one word per thing', () => {
  it.each([
    [{ verdict: 'pass' }, 'passed'],
    [{ verdict: 'flagged-hidden' }, 'hidden'],
    [{ verdict: 'blocked' }, 'hidden'],
    [{ verdict: 'masked' }, 'masked'],
    [{ verdict: 'pass', decision: { applied: 'mask' } }, 'masked'],
    [{ verdict: 'flagged' }, 'flagged'],
    [{ verdict: 'flagged', techniques: [{ name: 'repeat-exposure', severity: 6 }] }, 'seenALot'],
    [{ verdict: undefined, techniques: [{ name: 'repeat-exposure', severity: 6 }] }, 'seenALot'],
    [{ verdict: 'flagged', techniques: [{ name: 'repeat-exposure', severity: 6 }, { name: 'shame-attack', severity: 5 }] }, 'flagged'],
    [{ verdict: undefined }, 'flagged'],
    [{ verdict: 'flagged', originalText: 'a', neutralizedText: 'b' }, 'rewritten'],
    [{ verdict: 'educational-reframe' }, 'rewritten'],
    [{ verdict: 'skipped' }, 'notChecked'],
    [{ verdict: 'cancelled-stale' }, 'notChecked'],
  ] as const)('%j is %s', (over, action) => {
    expect(feedAction(rec(over as Partial<ForensicRecord>))).toBe(action);
  });

  it('severity is the worst present technique, and none on an ad', () => {
    const r = rec({ verdict: 'flagged', techniques: [{ name: 'shame-attack', severity: 3 }, { name: 'self-harm', severity: 9 }, { name: 'gone', severity: 10, present: false }] as never });
    expect(feedSeverity(r)).toBe(9);
    expect(feedWhy(r)).toEqual({ kind: 'technique', id: 'self-harm' });
    expect(feedWhy(rec({ verdict: 'masked' }))).toEqual({ kind: 'swearing' });
    expect(feedWhy(rec({ verdict: 'pass' }))).toBeNull();
    // A hidden row says why: the rule's category from the record, or that no reason was saved (never empty).
    expect(feedWhy(rec({ verdict: 'blocked', detectionMode: 'block:hashtag:cheap' } as never))).toEqual({ kind: 'blocked', category: 'Blocked hashtags' });
    expect(feedWhy(rec({ verdict: 'blocked', detectionMode: 'late-after-rotation:block:ai-label:x' } as never))).toEqual({ kind: 'blocked', category: 'AI-content videos' });
    expect(feedWhy(rec({ verdict: 'blocked' }))).toEqual({ kind: 'noReason' });
    expect(feedWhy(rec({ verdict: 'flagged-hidden', detectionMode: 'block:mystery:x' } as never))).toEqual({ kind: 'noReason' });
    expect(PLATFORM_LABELS.twitter, 'the product calls it X').toBe('x.com');
    expect(feedSeverity(rec({ verdict: 'flagged', techniques: [{ name: 'repeat-exposure', severity: 6 }] as never })), 'a fixed 6 is not a reading').toBe(0);
  });
});

describe('the window and the counts, by hand', () => {
  // Oldest first, as the store hands them. On 10 Oct: 3 passed (one on X), 1 hidden, 1 masked, 1 flagged, 1 reset marker, 1 comment-section summary.
  // On 8 Oct: 1 passed, 1 flagged. On 1 Oct: 2 passed. In September: 12 Sep 23:00 (one hour before Last 28 days
  // starts), 13 Sep 00:30 (inside it), 30 Sep 23:00 (inside Last 28 days, before Last 7 days).
  const sept = [
    rec({ timestamp: new Date(2026, 8, 12, 23, 0, 0).toISOString() }),
    rec({ timestamp: new Date(2026, 8, 13, 0, 30, 0).toISOString(), verdict: 'flagged' }),
    rec({ timestamp: new Date(2026, 8, 30, 23, 0, 0).toISOString() }),
  ];
  const oct = [
    rec({ timestamp: at(1, 10) }), rec({ timestamp: at(1, 11) }),
    rec({ timestamp: at(8, 10) }), rec({ timestamp: at(8, 11), verdict: 'flagged' }),
    rec({ timestamp: at(10, 8) }), rec({ timestamp: at(10, 9), platform: 'twitter' }), rec({ timestamp: at(10, 9) }),
    rec({ timestamp: at(10, 10), verdict: 'flagged-hidden' }), rec({ timestamp: at(10, 10), verdict: 'masked' }),
    rec({ timestamp: at(10, 11), verdict: 'flagged' }), rec({ timestamp: at(10, 11), kind: 'reset-marker' as never }),
    rec({ timestamp: at(10, 11), kind: 'environment' as never }),
  ];
  const records = [...sept, ...oct];

  it('windows start at local midnight today, and six days before it', () => {
    expect(windowStart('today', NOW)).toBe(new Date(2026, 9, 10).getTime());
    expect(windowStart('last7', NOW)).toBe(new Date(2026, 9, 4).getTime());
    expect(windowStart('last28', NOW)).toBe(new Date(2026, 8, 13).getTime());
    expect(windowStart('all', NOW)).toBe(Number.NEGATIVE_INFINITY);
  });

  it('Today: 6 items (the marker and the comment-section summary are not items of the feed), newest first, counted per action', () => {
    const s = feedLogSlice(records, { window: 'today' }, NOW);
    expect(s.inWindow).toBe(6);
    expect(s.counts).toEqual({ passed: 3, hidden: 1, masked: 1, flagged: 1, manual: 0, seenALot: 0, rewritten: 0, notChecked: 0 });
    expect(s.rows[0].id).toBe(oct[9].id);
  });

  it('Last 7 days: 8 items (4 Oct on); Last 28 days: 12 (13 Sep on: 1 Oct, 30 Sep, 13 Sep 00:30, not 12 Sep); All: 13', () => {
    expect(feedLogSlice(records, { window: 'last7' }, NOW).inWindow).toBe(8);
    const l28 = feedLogSlice(records, { window: 'last28' }, NOW);
    expect(l28.inWindow).toBe(12);
    expect(l28.counts.flagged, '8 Oct, 10 Oct and 13 Sep').toBe(3);
    expect(l28.counts.passed, '1 Oct twice, 30 Sep, 8 Oct, 10 Oct three times').toBe(7);
    expect(feedLogSlice(records, { window: 'all' }, NOW).inWindow).toBe(13);
  });

  it('an action chip filters the rows and keeps the counts of the window', () => {
    const s = feedLogSlice(records, { window: 'last7', action: 'flagged' }, NOW);
    expect(s.rows.length).toBe(2);
    expect(s.counts.flagged).toBe(2);
    expect(s.counts.passed).toBe(4);
  });

  it('a window that starts before the first entry needs the archived months; Today after it does not', () => {
    // October's first entry is 1 Oct, 10:00; with September read, the first is 12 Sep.
    expect(windowReachesBefore(oct, 'today', NOW)).toBe(false);
    expect(windowReachesBefore(oct, 'last7', NOW)).toBe(false);
    expect(windowReachesBefore(oct, 'last28', NOW), '13 Sep is before 1 Oct').toBe(true);
    expect(windowReachesBefore(records, 'last28', NOW), '12 Sep is before 13 Sep').toBe(false);
    expect(windowReachesBefore(records, 'all', NOW)).toBe(true);
    expect(windowReachesBefore([], 'today', NOW), 'nothing yet: read the months').toBe(true);
  });

  it('an entry whose time cannot be read is listed under All only', () => {
    const odd = [...records, rec({ timestamp: 'not a time' })];
    expect(feedLogSlice(odd, { window: 'today' }, NOW).inWindow).toBe(6);
    expect(feedLogSlice(odd, { window: 'all' }, NOW).inWindow).toBe(14);
  });

  it('a click-through filters by platform and by day', () => {
    expect(feedLogSlice(records, { window: 'all', platform: 'twitter' }, NOW).inWindow).toBe(1);
    expect(feedLogSlice(records, { window: 'all', day: '2026-10-08' }, NOW).inWindow).toBe(2);
    // Before any chosen button the window still holds its 13 items, so turning the site off shows more.
    expect(feedLogSlice(records, { window: 'all', platform: 'twitter' }, NOW).windowTotal).toBe(13);
  });
});

describe('the Feed log and the CSV export name an item the same way', () => {
  it('on every verdict, with and without a rewrite, and on a reading asked for by hand', () => {
    const verdicts = [undefined, 'flagged', 'flagged-hidden', 'pass', 'masked', 'skipped', 'educational-reframe', 'blocked', 'harm-floor-trigger', 'cancelled-navigation'];
    for (const verdict of verdicts) for (const rewrite of [false, true]) for (const feedSource of [undefined, 'manual']) {
      const r = rec({ verdict: verdict as never, feedSource: feedSource as never, neutralizedText: rewrite ? 'softer' : undefined });
      const key = feedActionKeyFor(r);
      expect(feedAction(r), `${verdict}, rewrite ${rewrite}, ${feedSource}`).toBe(key ? FEED_ACTION_OF_KEY[key] : 'notChecked');
    }
    // A repeat mark alone is "seen a lot" in both (it was flagged in the CSV until 10 Oct 2026).
    const repeat = rec({ verdict: 'flagged', techniques: [{ name: 'repeat-exposure', severity: 6 }] as never });
    expect(feedActionKeyFor(repeat)).toBe('seenALot');
    expect(feedAction(repeat)).toBe('seenALot');
  });
});

describe('a large record: Today does not walk the whole record', () => {
  // The owner's shape: 13,700 entries in the active record over 21 days, oldest first; the 16,456 archived entries are
  // in other months and never reach this tab. 650 of the 13,700 are today's.
  function largeRecord(): ForensicRecord[] {
    const out: ForensicRecord[] = [];
    const older = 13_700 - 650;
    const start = new Date(2026, 8, 19).getTime();
    const end = new Date(2026, 9, 10).getTime();
    for (let i = 0; i < older; i++) out.push(rec({ timestamp: new Date(start + ((end - start - 1) * i) / older).toISOString() }));
    for (let i = 0; i < 650; i++) out.push(rec({ timestamp: new Date(end + i * 60_000).toISOString(), verdict: i % 10 === 0 ? 'flagged' : 'pass' }));
    return out;
  }

  it('reads today and a short run more, and is quick', () => {
    const big = largeRecord();
    const t0 = performance.now();
    const s = feedLogSlice(big, { window: 'today' }, NOW);
    const ms = performance.now() - t0;
    expect(s.inWindow).toBe(650);
    expect(s.counts.flagged).toBe(65);
    expect(s.read).toBe(650 + OLDER_RUN_STOP);
    expect(ms).toBeLessThan(50);
    console.info(`[feed-log] Today on 13,700 entries: read ${s.read}, ${ms.toFixed(1)} ms`);
  });

  it('All reads the whole active record once', () => {
    const big = largeRecord();
    const t0 = performance.now();
    const s = feedLogSlice(big, { window: 'all' }, NOW);
    const ms = performance.now() - t0;
    expect(s.read).toBe(13_700);
    expect(s.inWindow).toBe(13_700);
    expect(ms).toBeLessThan(400);
    console.info(`[feed-log] All on 13,700 entries: ${ms.toFixed(1)} ms`);
  });
});
