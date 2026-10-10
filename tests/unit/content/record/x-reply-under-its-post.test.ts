// @vitest-environment jsdom
//
// The owner's 2026-09-05 export: 24 X replies filed at post level, each with
// its own status URL and no parent, so the dashboard and the export showed
// "post, under it comments" as comments beside posts. Two causes, both here.
//
//   1. A reply on a permalink page whose focused tweet's identity is not
//      coherent gets no `parentVideoId` (that field routes it into a comment
//      batch, which a doubtful room must not receive) and takes the per-post
//      path, where every emit site stamped `parentVideoId: post.parentVideoId`
//      onto the record: nothing. The tree's `parent_id` was on the post the
//      whole time. `recordParentId` carries it onto the record, record only.
//   2. `/status/` pages were stamped feedSource 'profile', which the dashboard
//      reads as "the reader's choice" and the served-versus-sought analysis
//      reads as profile browsing. A permalink is its own surface now, and a
//      profile page is a profile.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { recordParentId } from '../../../../src/content/record/forensic-emit';
import { groupRecordsByPost } from '../../../../src/ui/dashboard/components/group-records';
import { TwitterAdapter } from '../../../../src/content/platforms/twitter';
import { DASHBOARD_STRINGS } from '../../../../src/i18n/dashboard-strings';
import { UI_LANGUAGES } from '../../../../src/i18n';
import type { ForensicRecord } from '../../../../src/types/forensic';

describe('recordParentId', () => {
  it('keeps the adapter\'s parentVideoId when there is one', () => {
    expect(recordParentId({ kind: 'comment', parentVideoId: 'yt-vid-1', parent_id: 'other' })).toBe('yt-vid-1');
  });

  it('falls back to the tree\'s parent_id for a reply that took the per-post path', () => {
    expect(recordParentId({ kind: 'top-comment', parentVideoId: undefined, parent_id: '100' })).toBe('100');
    expect(recordParentId({ kind: 'reply', parentVideoId: undefined, parent_id: '200' })).toBe('200');
  });

  it('never invents a parent for a post, a video, or a reply with no known parent', () => {
    expect(recordParentId({ kind: 'post', parentVideoId: undefined, parent_id: '100' })).toBeUndefined();
    expect(recordParentId({ kind: 'video', parentVideoId: undefined, parent_id: '100' })).toBeUndefined();
    expect(recordParentId({ kind: 'top-comment', parentVideoId: undefined, parent_id: undefined })).toBeUndefined();
  });
});

function rec(over: Partial<ForensicRecord>): ForensicRecord {
  return {
    id: over.id ?? 'fr-x',
    timestamp: '2026-09-05T00:30:00.000Z',
    platform: 'twitter',
    originalText: 'x',
    originalHash: 'h',
    originalLength: 1,
    neutralizedText: '',
    author: 'a',
    postUrl: '',
    techniques: [],
    overallScore: 0,
    userAgeCategory: 'adult',
    aiSource: 'cloud',
    feedSource: 'permalink',
    integrityHash: 'i',
    verdict: 'pass',
    ...over,
  } as ForensicRecord;
}

describe('a reply with the tree parent on its record groups under its post', () => {
  it('the dashboard files the reply under the post whose status id it names', () => {
    const post = rec({ id: 'fr-post', kind: 'post', postUrl: 'https://x.com/root/status/100' });
    const reply = rec({ id: 'fr-reply', kind: 'top-comment', postUrl: 'https://x.com/bob/status/101', anchorUrl: 'https://x.com/bob/status/101', parentVideoId: '100' });
    const groups = groupRecordsByPost([post, reply]);
    expect(groups).toHaveLength(1);
    expect(groups[0].postRecord?.id).toBe('fr-post');
    expect(groups[0].children.map(c => c.id)).toEqual(['fr-reply']);
  });

  it('without the parent on the record the same reply is a post of its own, which is the shape his export had', () => {
    const post = rec({ id: 'fr-post', kind: 'post', postUrl: 'https://x.com/root/status/100' });
    const reply = rec({ id: 'fr-reply', kind: 'top-comment', postUrl: 'https://x.com/bob/status/101', anchorUrl: 'https://x.com/bob/status/101' });
    expect(groupRecordsByPost([post, reply])).toHaveLength(2);
  });
});

function setLocation(url: string): void {
  delete (window as unknown as { location?: unknown }).location;
  (window as unknown as { location: URL }).location = new URL(url);
}

function feedSourceAt(url: string): string | undefined {
  setLocation(url);
  document.body.innerHTML = `
    <article role="article" data-testid="tweet">
      <a href="/User" role="link"><span>U</span></a>
      <a href="/User/status/1" role="link">12:00</a>
      <div data-testid="tweetText" lang="en" dir="ltr">hello there</div>
    </article>`;
  const posts = new TwitterAdapter().extractPosts(document.body.childNodes);
  return posts[0]?.feedSource;
}

describe('X feed source', () => {
  beforeEach(() => { document.body.innerHTML = ''; });
  afterEach(() => { document.body.innerHTML = ''; setLocation('https://x.com/'); });

  it('a permalink is a permalink, not a profile visit', () => {
    expect(feedSourceAt('https://x.com/root/status/100')).toBe('permalink');
  });

  it('a profile page, with or without a tab, is a profile visit', () => {
    expect(feedSourceAt('https://x.com/root')).toBe('profile');
    expect(feedSourceAt('https://x.com/root/with_replies')).toBe('profile');
    expect(feedSourceAt('https://x.com/root/media')).toBe('profile');
  });

  it('X\'s own pages are not handles', () => {
    expect(feedSourceAt('https://x.com/explore')).toBe('unknown');
    expect(feedSourceAt('https://x.com/notifications')).toBe('unknown');
    expect(feedSourceAt('https://x.com/i/bookmarks')).toBe('unknown');
    expect(feedSourceAt('https://x.com/search?q=x')).toBe('search');
  });

  it('has a label in every interface language', () => {
    for (const lang of UI_LANGUAGES) {
      const label = DASHBOARD_STRINGS[lang].ovSurfaceLabel('permalink');
      expect(label).not.toBe('permalink');
      expect(label.length).toBeGreaterThan(3);
    }
  });
});
