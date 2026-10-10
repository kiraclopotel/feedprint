import { describe, expect, it } from 'vitest';
import { derivePlatformVideoId } from '../../../../src/content/post-path/video-pipeline';

// 2026-05-04 §CT-4 — parentVideoId derivation per platform URL pattern.
// Critical for forensic chain grouping: TikTok comment rewrites need a
// stable `parentVideoId` so dashboard can group records under their video.
// Pre-§CT-4 the comment-rewrite path emitted ZERO forensic events; the
// derive-helper is half of the fix (caller is video-pipeline.ts).
//
// URLs passed via the optional `urlOverride` parameter (jsdom blocks
// cross-origin `history.replaceState` so the helper accepts a URL string
// directly for testability).

describe('derivePlatformVideoId — per-platform URL → video-id extraction', () => {
  describe('TikTok', () => {
    // BARE digits — must match the parentVideoId the TikTok adapter
    // (platforms/tiktok.ts) and forensic-join.ts stamp, so the dashboard
    // groups pre-rewrite-hidden comments under the same video card.
    it('extracts BARE-digit video ID from /@user/video/<id> pattern', () => {
      expect(derivePlatformVideoId('tiktok', 'https://www.tiktok.com/@example_creator_a/video/7100000000000000002'))
        .toBe('7100000000000000002');
    });

    it('extracts BARE-digit video ID regardless of @user prefix variant', () => {
      expect(derivePlatformVideoId('tiktok', 'https://www.tiktok.com/@example_creator_b/video/7100000000000000003'))
        .toBe('7100000000000000003');
    });

    it('returns undefined on /foryou (no specific video URL)', () => {
      expect(derivePlatformVideoId('tiktok', 'https://www.tiktok.com/foryou')).toBeUndefined();
    });

    it('matches the adapter-stamped parentVideoId format (bare digits, no prefix)', () => {
      const id = derivePlatformVideoId('tiktok', 'https://www.tiktok.com/@u/video/12345');
      expect(id).toBe('12345');
      // The adapter stamps parentVideoId = the bare URL video id; grouping
      // in the dashboard keys on exact-string equality, so any prefix drift
      // re-splits the card.
      expect(id).not.toMatch(/^tk-vid-/);
    });
  });

  describe('YouTube', () => {
    it('extracts video ID from ?v=<id> param', () => {
      expect(derivePlatformVideoId('youtube', 'https://www.youtube.com/watch?v=SYNTHVID001'))
        .toBe('yt-vid-SYNTHVID001');
    });

    it('returns undefined when ?v param absent', () => {
      expect(derivePlatformVideoId('youtube', 'https://www.youtube.com/feed/trending')).toBeUndefined();
    });
  });

  describe('Instagram', () => {
    it('extracts post ID from /p/<id> pattern', () => {
      expect(derivePlatformVideoId('instagram', 'https://www.instagram.com/p/SYNTHPOST02/'))
        .toBe('ig-p-SYNTHPOST02');
    });

    it('extracts reel ID from /reel/<id> pattern', () => {
      expect(derivePlatformVideoId('instagram', 'https://www.instagram.com/reel/SYNTHREEL02/'))
        .toBe('ig-reel-SYNTHREEL02');
    });

    it('returns undefined on profile URL', () => {
      expect(derivePlatformVideoId('instagram', 'https://www.instagram.com/someuser/')).toBeUndefined();
    });
  });

  it('returns undefined for unknown platform', () => {
    expect(derivePlatformVideoId('twitter', 'https://x.com/user/status/12345')).toBeUndefined();
    expect(derivePlatformVideoId('facebook', 'https://www.facebook.com/watch/?v=12345')).toBeUndefined();
  });

  it('returns undefined for malformed URL string', () => {
    expect(derivePlatformVideoId('tiktok', 'not-a-url')).toBeUndefined();
  });
});
