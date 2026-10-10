// @vitest-environment jsdom
//
// Board item 61 — the feed divider. It read `SWITCHED INSTAGRAM -> FACEBOOK ·
// +961S`, and later `+0S` on every switch, and it was wrong in three
// independent ways at once:
//
//   1. measured on WRITE time while the feed sorts on SEEN time,
//   2. paired the wrong two groups, because within a session the sort is
//      ascending so the row above is the item served NEXT, not the one before,
//   3. clamped the resulting negative number to zero and printed it, which is
//      how a broken calculation came out looking like a measurement.
//
// The rule these lock: a divider names the gap between two CONSECUTIVELY
// SERVED groups, or it names no gap at all.
import { describe, expect, it } from 'vitest';
import { computeFeedDividers } from '../../../../../src/ui/dashboard/components/activity-drill';
import type { RecordGroup } from '../../../../../src/ui/dashboard/components/PostGroupCard';

function g(over: Partial<RecordGroup> & { key: string }): RecordGroup {
  return {
    postRecord: null, roomAuthor: '', roomCaption: '', roomUrl: '',
    platform: 'twitter', latestTs: '2026-07-01T10:00:00.000Z',
    firstSeenAt: '2026-07-01T10:00:00.000Z',
    lastSeenAt: '2026-07-01T10:00:00.000Z',
    sessionKey: 's1', children: [], flaggedCount: 0, blockedCount: 0,
    ...over,
  } as RecordGroup;
}

describe('feed dividers', () => {
  it('measures seen time, not write time', () => {
    // Write times say 1 second apart. Seen times say 5 minutes apart. The feed
    // sorts on seen, so the divider must speak seen.
    const groups = [
      g({ key: 'a', firstSeenAt: '2026-07-01T10:00:00Z', lastSeenAt: '2026-07-01T10:00:00Z', latestTs: '2026-07-01T12:00:00Z' }),
      g({ key: 'b', platform: 'facebook', firstSeenAt: '2026-07-01T10:05:00Z', lastSeenAt: '2026-07-01T10:05:00Z', latestTs: '2026-07-01T12:00:01Z' }),
    ];
    const d = computeFeedDividers(groups);
    expect(d[1]?.kind).toBe('switch');
    expect(d[1]?.gapSeconds).toBe(300);
  });

  it('inside a session the previous item is the row ABOVE, and the gap is positive', () => {
    const groups = [
      g({ key: 'a', firstSeenAt: '2026-07-01T10:00:00Z', lastSeenAt: '2026-07-01T10:00:10Z' }),
      g({ key: 'b', platform: 'facebook', firstSeenAt: '2026-07-01T10:00:40Z', lastSeenAt: '2026-07-01T10:00:50Z' }),
    ];
    const d = computeFeedDividers(groups);
    expect(d[0]).toBeNull();
    expect(d[1]?.gapSeconds).toBe(30);
  });

  it('at a session seam it pairs against the LAST served group of the older session', () => {
    // Newest session on top (s2, ascending inside), older session below.
    // The reader left s1 at 09:30:00 and arrived in s2 at 10:00:00.
    const groups = [
      g({ key: 'n1', sessionKey: 's2', platform: 'facebook', firstSeenAt: '2026-07-01T10:00:00Z', lastSeenAt: '2026-07-01T10:00:05Z' }),
      g({ key: 'n2', sessionKey: 's2', platform: 'facebook', firstSeenAt: '2026-07-01T10:01:00Z', lastSeenAt: '2026-07-01T10:01:05Z' }),
      g({ key: 'o1', sessionKey: 's1', firstSeenAt: '2026-07-01T09:00:00Z', lastSeenAt: '2026-07-01T09:00:05Z' }),
      g({ key: 'o2', sessionKey: 's1', firstSeenAt: '2026-07-01T09:29:50Z', lastSeenAt: '2026-07-01T09:30:00Z' }),
    ];
    const d = computeFeedDividers(groups);
    // 09:30:00 -> 10:00:00 is 1800s, which is the session threshold.
    expect(d[0]?.kind).toBe('session');
    expect(d[0]?.gapSeconds).toBe(1800);
    // NOT paired against o1 (the older session's FIRST item), which would have
    // produced 3600 and spanned that whole session instead of the real gap.
    expect(d[0]?.gapSeconds).not.toBe(3600);
  });

  it('never prints a fabricated zero when the order is backwards', () => {
    // b was seen BEFORE a, so they are not consecutive in serve order. The old
    // code clamped this to 0 and rendered "+0s".
    const groups = [
      g({ key: 'a', firstSeenAt: '2026-07-01T10:05:00Z', lastSeenAt: '2026-07-01T10:05:00Z' }),
      g({ key: 'b', platform: 'facebook', firstSeenAt: '2026-07-01T10:00:00Z', lastSeenAt: '2026-07-01T10:00:00Z' }),
    ];
    const d = computeFeedDividers(groups);
    expect(d[1]?.kind).toBe('switch');
    expect(d[1]?.gapSeconds).toBeNull();
  });

  it('a switch with no honest gap still says a switch happened', () => {
    const groups = [
      g({ key: 'a', firstSeenAt: '2026-07-01T10:05:00Z', lastSeenAt: '2026-07-01T10:05:00Z' }),
      g({ key: 'b', platform: 'tiktok', firstSeenAt: '2026-07-01T10:00:00Z', lastSeenAt: '2026-07-01T10:00:00Z' }),
    ];
    const d = computeFeedDividers(groups);
    expect(d[1]?.fromPlatform).toBe('twitter');
    expect(d[1]?.toPlatform).toBe('tiktok');
  });

  it('is empty for an empty feed and silent for a single group', () => {
    expect(computeFeedDividers([])).toEqual([]);
    expect(computeFeedDividers([g({ key: 'only' })])).toEqual([null]);
  });
});

describe('gap wording', () => {
  it('reads as a duration a person can parse, not raw seconds', async () => {
    const { DASHBOARD_STRINGS } = await import('../../../../../src/i18n/dashboard-strings');
    const en = DASHBOARD_STRINGS.en;
    // The reported label was "+961s". Nobody reads that as sixteen minutes.
    expect(en.feedPlatformSwitch('instagram', 'facebook', 961)).toContain('16m');
    expect(en.feedPlatformSwitch('instagram', 'facebook', 45)).toContain('45s');
    expect(en.feedPlatformSwitch('instagram', 'facebook', 7300)).toContain('2h');
    // No number at all when there is no honest one.
    expect(en.feedPlatformSwitch('instagram', 'facebook', null)).not.toContain('+');
  });

  it('says the same thing in Romanian', async () => {
    const { DASHBOARD_STRINGS } = await import('../../../../../src/i18n/dashboard-strings');
    const ro = DASHBOARD_STRINGS.ro;
    expect(ro.feedPlatformSwitch('instagram', 'facebook', 961)).toContain('16m');
    expect(ro.feedPlatformSwitch('instagram', 'facebook', null)).not.toContain('+');
  });
});
