// platformPostIdFromUrl — the single source of truth for the post/video id the
// adapters stamp as parentVideoId. Must equal focusedTweetId (raw digits) for X
// so the dashboard can merge a focused tweet with its reply thread.

import { describe, it, expect } from 'vitest';
import { platformPostIdFromUrl } from '../../../src/core/platform-post-id';

describe('platformPostIdFromUrl', () => {
  it('twitter: extracts raw status digits from /<handle>/status/<id>', () => {
    expect(platformPostIdFromUrl('twitter', 'https://x.com/User/status/1948372615')).toBe('1948372615');
  });

  it('twitter: extracts from the /i/web/status/<id> form too', () => {
    expect(platformPostIdFromUrl('twitter', 'https://x.com/i/web/status/1948372615')).toBe('1948372615');
  });

  it('tiktok: extracts /video/<digits>', () => {
    expect(platformPostIdFromUrl('tiktok', 'https://www.tiktok.com/@example_creator/video/7100000000000000005'))
      .toBe('7100000000000000005');
  });

  it('instagram: extracts bare /p/ and /reel/ id', () => {
    expect(platformPostIdFromUrl('instagram', 'https://www.instagram.com/p/DXabc12345A/')).toBe('DXabc12345A');
    expect(platformPostIdFromUrl('instagram', 'https://www.instagram.com/reel/SYNTHREEL01/')).toBe('SYNTHREEL01');
  });

  it('facebook: synthetic ids are not derivable → undefined', () => {
    expect(platformPostIdFromUrl('facebook', 'https://www.facebook.com/reel/123')).toBeUndefined();
  });

  it('returns undefined for an unparseable URL or missing input', () => {
    expect(platformPostIdFromUrl('twitter', 'not a url')).toBeUndefined();
    expect(platformPostIdFromUrl('tiktok', undefined)).toBeUndefined();
    expect(platformPostIdFromUrl('twitter', 'https://x.com/User')).toBeUndefined(); // no /status/
  });
});
