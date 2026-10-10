// Bug 4 (defense-in-depth) — the dashboard groups records by post/thread. The
// grouping key must be scoped by platform so two unrelated posts that happen to
// share a raw parentVideoId across platforms cannot merge into one thread (the
// wrong-parent / orphan-thread symptom: clicking one post showed another's
// thread). Records' own ids are globally unique (logger `fr-*`), so the
// no-parent fallback already can't collide; this locks the cross-platform case.

import { describe, it, expect } from 'vitest';
import { groupRecordsByPost } from '../../../../../src/ui/dashboard/components/group-records';
import type { ForensicRecord } from '../../../../../src/types/forensic';

let n = 0;
function rec(partial: Partial<ForensicRecord>): ForensicRecord {
  n += 1;
  return {
    id: `fr-${n}`,
    platform: 'twitter',
    kind: 'comment',
    verdict: 'flagged',
    timestamp: '2026-06-26T00:00:00.000Z',
    techniques: [],
    author: 'a',
    originalText: '',
    ...partial,
  } as unknown as ForensicRecord;
}

describe('groupRecordsByPost — cross-platform parentVideoId must not merge', () => {
  it('keeps the same raw parentVideoId on different platforms in separate groups', () => {
    const records = [
      rec({ platform: 'twitter', kind: 'video', parentVideoId: '123', roomAuthor: 'bilzerian', roomUrl: 'https://x.com/i/web/status/123' }),
      rec({ platform: 'facebook', kind: 'post', parentVideoId: '123', roomAuthor: 'charlie', roomUrl: 'https://facebook.com/charlie/posts/123' }),
    ];
    const groups = groupRecordsByPost(records);
    expect(groups).toHaveLength(2);
    const tw = groups.find(g => g.platform === 'twitter');
    const fb = groups.find(g => g.platform === 'facebook');
    expect(tw?.roomAuthor).toBe('bilzerian');
    expect(fb?.roomAuthor).toBe('charlie');
  });

  it('still groups comments under their parent post on the SAME platform', () => {
    const records = [
      rec({ platform: 'twitter', kind: 'video', parentVideoId: '999', roomAuthor: 'op' }),
      rec({ platform: 'twitter', kind: 'comment', parentVideoId: '999' }),
      rec({ platform: 'twitter', kind: 'comment', parentVideoId: '999' }),
    ];
    const groups = groupRecordsByPost(records);
    expect(groups).toHaveLength(1);
    expect(groups[0].children).toHaveLength(2);
  });

  it('records lacking parentVideoId become standalone groups (unique id key)', () => {
    const records = [
      rec({ platform: 'twitter', kind: 'video', parentVideoId: undefined }),
      rec({ platform: 'twitter', kind: 'video', parentVideoId: undefined }),
    ];
    const groups = groupRecordsByPost(records);
    expect(groups).toHaveLength(2);
  });

  it('treats empty-string parentVideoId as missing, not as one mega-group key', () => {
    const records = [
      rec({ platform: 'tiktok', kind: 'video', parentVideoId: '' }),
      rec({ platform: 'tiktok', kind: 'video', parentVideoId: '' }),
    ];
    const groups = groupRecordsByPost(records);
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.key).sort()).toEqual(records.map((r) => r.id).sort());
  });
});

describe('groupRecordsByPost — image-analysis records (kind:image)', () => {
  it('joins its post group as a CHILD and never displaces the post record, even when it arrives first', () => {
    // The image verdict is async — it can land in the chain BEFORE the
    // post's own record in pathological orders. kind:'image' is not a
    // post-kind, so the real post record must stay the group header.
    const records = [
      rec({ kind: 'image', parentVideoId: '555', roomAuthor: 'op', roomCaption: 'caption text' }),
      rec({ kind: 'post', parentVideoId: '555', author: 'op', originalText: 'caption text' }),
      rec({ kind: 'comment', parentVideoId: '555' }),
    ];
    const groups = groupRecordsByPost(records);
    expect(groups).toHaveLength(1);
    expect(groups[0].postRecord?.kind).toBe('post');
    expect(groups[0].children).toHaveLength(2);
    // Media-evidence records sort before comments.
    expect(groups[0].children[0].kind).toBe('image');
  });

  it('an orphan image record still renders header context from its denormalized room fields', () => {
    const records = [
      rec({ kind: 'image', parentVideoId: '777', roomAuthor: 'op', roomCaption: 'what the post said', roomUrl: 'https://x.com/op/status/777' }),
    ];
    const groups = groupRecordsByPost(records);
    expect(groups).toHaveLength(1);
    expect(groups[0].postRecord).toBeNull();
    expect(groups[0].roomAuthor).toBe('op');
    expect(groups[0].roomCaption).toBe('what the post said');
    expect(groups[0].roomUrl).toBe('https://x.com/op/status/777');
  });
});

describe('groupRecordsByPost — X focused tweet merges with its reply thread (orphan fix)', () => {
  it('groups a focused tweet (no parentVideoId) with replies that reference its id', () => {
    // twitter.ts stamps parentVideoId only on the focused tweet's CHILDREN, so
    // the focused tweet itself has none. Its id lives in its postUrl; the replies
    // carry that id as parentVideoId. They must land in ONE group with the tweet
    // as the header, not an orphan reply-group + a lone tweet.
    const records = [
      rec({ kind: 'post', parentVideoId: undefined, author: 'op',
            postUrl: 'https://x.com/op/status/555', originalText: 'the original tweet' }),
      rec({ kind: 'reply', parentVideoId: '555', author: 'r1' }),
      rec({ kind: 'reply', parentVideoId: '555', author: 'r2' }),
    ];
    const groups = groupRecordsByPost(records);
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe('twitter:555');
    expect(groups[0].postRecord?.author).toBe('op');
    expect(groups[0].children).toHaveLength(2);
  });

  it('merges a post with its video-context record even when NO comment was captured', () => {
    // The common scroll-past case: a video tweet whose comments were never
    // opened. forensic-join stamps the video record with parentVideoId = the
    // tweet id (from the post URL); the post itself has none. They must still
    // land in one group (video evidence under the tweet), not split.
    const records = [
      rec({ kind: 'post', parentVideoId: undefined, author: 'op', postUrl: 'https://x.com/op/status/4242' }),
      rec({ kind: 'video', parentVideoId: '4242', verdict: 'flagged-hidden' }),
    ];
    const groups = groupRecordsByPost(records);
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe('twitter:4242');
    expect(groups[0].postRecord?.author).toBe('op');
    expect(groups[0].children).toHaveLength(1); // the video-context record
  });

  it('is order-independent (replies seen before the focused tweet)', () => {
    const records = [
      rec({ kind: 'reply', parentVideoId: '777', author: 'r1' }),
      rec({ kind: 'post', parentVideoId: undefined, author: 'op', postUrl: 'https://x.com/op/status/777' }),
    ];
    const groups = groupRecordsByPost(records);
    expect(groups).toHaveLength(1);
    expect(groups[0].postRecord?.author).toBe('op');
    expect(groups[0].children).toHaveLength(1);
  });

  it('does NOT merge a post into a thread key no comment references (stays standalone)', () => {
    // A post with a derivable id but no captured comments keeps its own-id key,
    // so two unrelated home-feed tweets never collapse into one group.
    const records = [
      rec({ kind: 'post', parentVideoId: undefined, postUrl: 'https://x.com/a/status/111' }),
      rec({ kind: 'post', parentVideoId: undefined, postUrl: 'https://x.com/b/status/222' }),
    ];
    const groups = groupRecordsByPost(records);
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.key).sort()).toEqual(records.map((r) => r.id).sort());
  });

  it('does not cross-merge: a FB post sharing a raw id with an X reply stays separate', () => {
    const records = [
      rec({ platform: 'twitter', kind: 'post', parentVideoId: undefined, postUrl: 'https://x.com/op/status/888' }),
      rec({ platform: 'twitter', kind: 'reply', parentVideoId: '888' }),
      rec({ platform: 'facebook', kind: 'post', parentVideoId: undefined, postUrl: 'https://www.facebook.com/op/posts/888' }),
    ];
    const groups = groupRecordsByPost(records);
    // X tweet+reply merge (twitter:888); FB post is its own group (FB ids are
    // not URL-derivable → r.id key).
    expect(groups).toHaveLength(2);
    const tw = groups.find((g) => g.key === 'twitter:888');
    expect(tw?.children).toHaveLength(1);
    expect(groups.some((g) => g.platform === 'facebook')).toBe(true);
  });
});

describe('groupRecordsByPost — deterministic feed order (no same-timestamp flip)', () => {
  it('tie-breaks same-timestamp groups by newest serial, descending', () => {
    // Two posts captured in the SAME second (the #797-above-#799 bug). Without a
    // tie-break the order is undefined; it must be newest-serial-first.
    const ts = '2026-06-28T20:05:01.000Z';
    const records = [
      rec({ kind: 'post', parentVideoId: undefined, postUrl: 'https://x.com/a/status/1', timestamp: ts, chainPosition: 797 }),
      rec({ kind: 'post', parentVideoId: undefined, postUrl: 'https://x.com/b/status/2', timestamp: ts, chainPosition: 799 }),
    ];
    const groups = groupRecordsByPost(records);
    expect(groups.map((g) => g.postRecord?.chainPosition)).toEqual([799, 797]);
  });

  it('still orders by latest activity (timestamp) first when timestamps differ', () => {
    const records = [
      rec({ kind: 'post', parentVideoId: undefined, postUrl: 'https://x.com/a/status/1', timestamp: '2026-06-28T19:41:12.000Z', chainPosition: 999 }),
      rec({ kind: 'post', parentVideoId: undefined, postUrl: 'https://x.com/b/status/2', timestamp: '2026-06-28T20:05:01.000Z', chainPosition: 100 }),
    ];
    const groups = groupRecordsByPost(records);
    // Newer timestamp (20:05) wins even though its serial (100) is lower — the
    // tie-break only applies when timestamps are equal.
    expect(groups[0].postRecord?.chainPosition).toBe(100);
    expect(groups[1].postRecord?.chainPosition).toBe(999);
  });
});

describe('groupRecordsByPost — replay order (found 2026-07-02: first seen renders first)', () => {
  const S1 = 'ss-session-one';
  const S2 = 'ss-session-two';

  it('within one browsing session, groups render in SEEN order, not completion order', () => {
    // Seen 1st but written LAST (slow AI verdict) — must still render first.
    const records = [
      rec({ kind: 'post', parentVideoId: undefined, postUrl: 'https://x.com/a/status/1',
            timestamp: '2026-07-02T10:00:30.000Z', chainPosition: 12,
            surfaceSessionId: S1, observedSequence: 1, viewportSeenAt: '2026-07-02T10:00:01.000Z' }),
      rec({ kind: 'post', parentVideoId: undefined, postUrl: 'https://x.com/b/status/2',
            timestamp: '2026-07-02T10:00:05.000Z', chainPosition: 3,
            surfaceSessionId: S1, observedSequence: 4, viewportSeenAt: '2026-07-02T10:00:04.000Z' }),
      rec({ kind: 'post', parentVideoId: undefined, postUrl: 'https://x.com/c/status/3',
            timestamp: '2026-07-02T10:00:10.000Z', chainPosition: 7,
            surfaceSessionId: S1, observedSequence: 2, viewportSeenAt: '2026-07-02T10:00:02.000Z' }),
    ];
    const groups = groupRecordsByPost(records);
    expect(groups.map((g) => g.postRecord?.observedSequence)).toEqual([1, 2, 4]);
  });

  it('newer session renders ABOVE an older one; each session replays internally', () => {
    const records = [
      // Older session, seen 09:00
      rec({ kind: 'post', parentVideoId: undefined, postUrl: 'https://x.com/a/status/10',
            timestamp: '2026-07-02T09:00:02.000Z', chainPosition: 1,
            surfaceSessionId: S1, observedSequence: 1, viewportSeenAt: '2026-07-02T09:00:01.000Z' }),
      rec({ kind: 'post', parentVideoId: undefined, postUrl: 'https://x.com/b/status/11',
            timestamp: '2026-07-02T09:00:06.000Z', chainPosition: 2,
            surfaceSessionId: S1, observedSequence: 2, viewportSeenAt: '2026-07-02T09:00:05.000Z' }),
      // Newer session, seen 11:00
      rec({ kind: 'post', parentVideoId: undefined, postUrl: 'https://x.com/c/status/20',
            timestamp: '2026-07-02T11:00:02.000Z', chainPosition: 3,
            surfaceSessionId: S2, observedSequence: 1, viewportSeenAt: '2026-07-02T11:00:01.000Z' }),
      rec({ kind: 'post', parentVideoId: undefined, postUrl: 'https://x.com/d/status/21',
            timestamp: '2026-07-02T11:00:06.000Z', chainPosition: 4,
            surfaceSessionId: S2, observedSequence: 2, viewportSeenAt: '2026-07-02T11:00:05.000Z' }),
    ];
    const groups = groupRecordsByPost(records);
    expect(groups.map((g) => g.postRecord?.chainPosition)).toEqual([3, 4, 1, 2]);
  });

  it('legacy records (no impression fields) keep newest-first order', () => {
    const records = [
      rec({ kind: 'post', parentVideoId: undefined, postUrl: 'https://x.com/a/status/30',
            timestamp: '2026-06-01T10:00:00.000Z', chainPosition: 5 }),
      rec({ kind: 'post', parentVideoId: undefined, postUrl: 'https://x.com/b/status/31',
            timestamp: '2026-06-02T10:00:00.000Z', chainPosition: 6 }),
    ];
    const groups = groupRecordsByPost(records);
    expect(groups.map((g) => g.postRecord?.chainPosition)).toEqual([6, 5]);
  });

  it('comments inside a group render in seen order when stamped', () => {
    const records = [
      rec({ kind: 'video', parentVideoId: '900', roomAuthor: 'op',
            surfaceSessionId: S1, observedSequence: 1, viewportSeenAt: '2026-07-02T10:00:01.000Z' }),
      rec({ kind: 'comment', parentVideoId: '900', author: 'late-write-early-seen',
            timestamp: '2026-07-02T10:00:40.000Z',
            surfaceSessionId: S1, observedSequence: 2, viewportSeenAt: '2026-07-02T10:00:02.000Z' }),
      rec({ kind: 'comment', parentVideoId: '900', author: 'early-write-late-seen',
            timestamp: '2026-07-02T10:00:20.000Z',
            surfaceSessionId: S1, observedSequence: 5, viewportSeenAt: '2026-07-02T10:00:05.000Z' }),
    ];
    const groups = groupRecordsByPost(records);
    expect(groups).toHaveLength(1);
    expect(groups[0].children.map((c) => c.author)).toEqual(['late-write-early-seen', 'early-write-late-seen']);
  });
});
