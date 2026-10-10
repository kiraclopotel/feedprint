// @vitest-environment jsdom
//
// Room fallback for the "ORPHAN THREAD" cards (screenshots, 2026-07-02):
// TikTok profile-surface comment buckets shipped postUrl:'' / roomAuthor:
// 'unknown' because the caption record never arrived. Opening a TikTok
// comment section changes the page URL to /@author/video/<id> (live-probed
// 2026-07-02) and the bucket stamps that URL at creation — roomFromPermalink
// derives the room from it, gated on the URL's id equalling the bucket key.

import { describe, it, expect } from 'vitest';
import { roomFromPermalink } from '../../../../src/content/record/post-url';

describe('roomFromPermalink — id-gated room derivation', () => {
  it('derives url + author when the permalink id matches the bucket key', () => {
    expect(
      roomFromPermalink('https://www.tiktok.com/@example_room_author/video/7100000000000000004', '7100000000000000004'),
    ).toEqual({
      url: 'https://www.tiktok.com/@example_room_author/video/7100000000000000004',
      author: '@example_room_author',
    });
  });

  it('supports TikTok photo posts and strips query/fragment noise', () => {
    expect(
      roomFromPermalink('https://www.tiktok.com/@u/photo/123?lang=ro#x', '123'),
    ).toEqual({ url: 'https://www.tiktok.com/@u/photo/123', author: '@u' });
  });

  it('REFUSES a permalink whose id differs from the bucket key (stale page)', () => {
    // The child scrolled to the next video before the flush — the URL now
    // names a DIFFERENT video. Stamping it would attach comments to the
    // wrong room, worse than no room.
    expect(
      roomFromPermalink('https://www.tiktok.com/@u/video/999', '123'),
    ).toBeNull();
  });

  it('returns null for non-permalink pages, malformed URLs, empty inputs', () => {
    expect(roomFromPermalink('https://www.tiktok.com/foryou', '123')).toBeNull();
    expect(roomFromPermalink('https://www.tiktok.com/@u', '123')).toBeNull();
    expect(roomFromPermalink('not a url', '123')).toBeNull();
    expect(roomFromPermalink(undefined, '123')).toBeNull();
    expect(roomFromPermalink('https://www.tiktok.com/@u/video/123', '')).toBeNull();
  });
});
