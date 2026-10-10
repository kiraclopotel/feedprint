// "View original" URL resolution for the dashboard forensic entries.
// Locks the preference order: anchorUrl (exact comment) → canonical (post) →
// postUrl → roomUrl — matching the standalone export's "open the exact
// comment" link and keeping the dashboard and export consistent.

import { describe, it, expect } from 'vitest';
import { resolveViewOriginalUrl } from '../../../../../src/ui/dashboard/components/FeedCard';
import type { ForensicRecord } from '../../../../../src/types/forensic';

function rec(overrides: Partial<ForensicRecord> = {}): ForensicRecord {
  return {
    id: 'r-1',
    timestamp: '2026-05-30T12:00:00Z',
    platform: 'twitter',
    originalText: 't',
    originalHash: 'h',
    originalLength: 1,
    neutralizedText: '',
    author: '@u',
    postUrl: '',
    techniques: [],
    overallScore: 0,
    userAgeCategory: 'teen',
    aiSource: 'cloud',
    feedSource: 'for-you',
    integrityHash: 'd',
    signature: 's',
    publicKeyFingerprint: 'f',
    chainPosition: 0,
    ...overrides,
  };
}

describe('resolveViewOriginalUrl — preference order', () => {
  it('prefers anchorUrl (the exact comment) over everything else', () => {
    const r = rec({
      anchorUrl: 'https://x.com/u/status/999',
      parentVideoId: '123',
      postUrl: 'https://x.com/u/status/100',
      roomUrl: 'https://x.com/u',
    });
    expect(resolveViewOriginalUrl(r)).toBe('https://x.com/u/status/999');
  });

  it('falls back to canonical-from-parentVideoId when no anchorUrl', () => {
    const r = rec({ platform: 'twitter', parentVideoId: '456', postUrl: 'https://x.com/u/status/100' });
    expect(resolveViewOriginalUrl(r)).toBe('https://x.com/i/web/status/456');
  });

  it('falls back to postUrl when no anchor and no parentVideoId', () => {
    const r = rec({ postUrl: 'https://x.com/u/status/100', roomUrl: 'https://x.com/u' });
    expect(resolveViewOriginalUrl(r)).toBe('https://x.com/u/status/100');
  });

  it('falls back to roomUrl when nothing else is present', () => {
    const r = rec({ roomUrl: 'https://www.tiktok.com/@c/video/7' });
    expect(resolveViewOriginalUrl(r)).toBe('https://www.tiktok.com/@c/video/7');
  });

  it('returns null when no URL is available (button renders disabled)', () => {
    expect(resolveViewOriginalUrl(rec())).toBeNull();
  });

  it('ignores an empty-string anchorUrl and falls through', () => {
    const r = rec({ anchorUrl: '', postUrl: 'https://x.com/u/status/100' });
    expect(resolveViewOriginalUrl(r)).toBe('https://x.com/u/status/100');
  });

  // Exact-comment deep-link in postUrl must BEAT the bare canonical URL — the
  // locked-position fix (found 2026-06-04). Pre-fix the YouTube &lc= link was
  // shadowed by the canonical video URL rebuilt from parentVideoId.
  it('prefers a YouTube &lc= comment deep-link in postUrl over the canonical video URL', () => {
    const r = rec({
      platform: 'youtube',
      parentVideoId: 'VID123',
      postUrl: 'https://www.youtube.com/watch?v=VID123&lc=UgxComment42',
    });
    expect(resolveViewOriginalUrl(r)).toBe('https://www.youtube.com/watch?v=VID123&lc=UgxComment42');
  });

  it('prefers a Facebook comment_id deep-link in postUrl over the canonical URL', () => {
    const r = rec({
      platform: 'facebook',
      parentVideoId: '789',
      postUrl: 'https://www.facebook.com/page/posts/789?comment_id=555',
    });
    expect(resolveViewOriginalUrl(r)).toBe('https://www.facebook.com/page/posts/789?comment_id=555');
  });

  it('prefers an Instagram /c/ deep-link in postUrl over the canonical URL', () => {
    const r = rec({
      platform: 'instagram',
      parentVideoId: 'ABC',
      postUrl: 'https://www.instagram.com/p/ABC/c/17900000000000000/',
    });
    expect(resolveViewOriginalUrl(r)).toBe('https://www.instagram.com/p/ABC/c/17900000000000000/');
  });

  it('does NOT mis-detect a plain X /status/ post URL as a comment deep-link', () => {
    const r = rec({ platform: 'twitter', parentVideoId: '456', postUrl: 'https://x.com/u/status/100' });
    // no deep-link marker → canonical still wins (unchanged behavior)
    expect(resolveViewOriginalUrl(r)).toBe('https://x.com/i/web/status/456');
  });

  // Bare platform-root URLs are the home-feed fallback captured when no
  // permalink existed — "view original" landing on facebook.com is misleading
  // (a live report 2026-06-11), so they are treated as no-URL.
  it('treats a bare facebook.com root postUrl as no URL (button disables)', () => {
    const r = rec({ platform: 'facebook', postUrl: 'https://www.facebook.com/' });
    expect(resolveViewOriginalUrl(r)).toBeNull();
  });

  it('treats x.com/home and tiktok.com/foryou roots as no URL', () => {
    expect(resolveViewOriginalUrl(rec({ platform: 'twitter', postUrl: 'https://x.com/home' }))).toBeNull();
    expect(resolveViewOriginalUrl(rec({ platform: 'tiktok', postUrl: 'https://www.tiktok.com/foryou' }))).toBeNull();
  });

  it('falls through a bare-root postUrl to a real roomUrl', () => {
    const r = rec({
      platform: 'facebook',
      postUrl: 'https://www.facebook.com/',
      roomUrl: 'https://www.facebook.com/groups/12345/',
    });
    expect(resolveViewOriginalUrl(r)).toBe('https://www.facebook.com/groups/12345/');
  });

  it('keeps a real group permalink linkable (path is not a bare root)', () => {
    const r = rec({ platform: 'facebook', postUrl: 'https://www.facebook.com/groups/12345/posts/678/' });
    expect(resolveViewOriginalUrl(r)).toBe('https://www.facebook.com/groups/12345/posts/678/');
  });

  it('keeps a photo permalink with fbid query linkable', () => {
    const r = rec({ platform: 'facebook', postUrl: 'https://www.facebook.com/photo/?fbid=111&set=gm.222' });
    expect(resolveViewOriginalUrl(r)).toBe('https://www.facebook.com/photo/?fbid=111&set=gm.222');
  });

  // TikTok canonical needs the creator @handle — the username-less `@/video/<id>`
  // form does not resolve, which dead-ended View original + hid Update Metrics
  // (found 2026-06-16). Build it from the captured author.
  it('builds the TikTok canonical with the captured @handle', () => {
    const r = rec({ platform: 'tiktok', author: '@example_creator', parentVideoId: 'tk-vid-7' });
    expect(resolveViewOriginalUrl(r)).toBe('https://www.tiktok.com/@example_creator/video/7');
  });

  it('adds the @ when the TikTok author handle lacks it', () => {
    const r = rec({ platform: 'tiktok', author: 'example_creator', parentVideoId: 'tk-vid-7' });
    expect(resolveViewOriginalUrl(r)).toBe('https://www.tiktok.com/@example_creator/video/7');
  });

  it('with no usable TikTok handle, falls back to a real postUrl instead of a dead @/video/ link', () => {
    const r = rec({
      platform: 'tiktok', author: 'unknown', parentVideoId: 'tk-vid-7',
      postUrl: 'https://www.tiktok.com/@creator/video/7',
    });
    expect(resolveViewOriginalUrl(r)).toBe('https://www.tiktok.com/@creator/video/7');
  });

  it('with no usable TikTok handle and no postUrl, returns null (button disables) — not a broken link', () => {
    const r = rec({ platform: 'tiktok', author: 'unknown', parentVideoId: 'tk-vid-7' });
    expect(resolveViewOriginalUrl(r)).toBeNull();
  });
});
