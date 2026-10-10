// @vitest-environment jsdom
//
// record-feed-study/C-NOTES.md fault, #3875-#3883: a real export had a
// Facebook Reel whose comments' roomCaption all read "Facebook" instead of
// the reel's real caption. `_extractReelCaption`'s selector
// (`[data-ad-rendering-role="story_message"], [dir="auto"] > span`) is broad
// enough to also match the site's own brand/chrome text when it appears
// earlier in `[role="main"]`'s DOM order than the real caption, and the first
// length-3-to-2000 match wins.

import { describe, it, expect, afterEach } from 'vitest';
import { FacebookAdapter } from '../../../../src/content/platforms/facebook';

function setLocation(pathname: string): void {
  Object.defineProperty(window, 'location', {
    value: { hostname: 'www.facebook.com', pathname, search: '', href: `https://www.facebook.com${pathname}` },
    writable: true,
    configurable: true,
  });
}

function mountReelPanelWithBrandChrome(reelId: string, realCaption: string): void {
  document.body.innerHTML = `
    <div role="main">
      <div dir="auto"><span>Facebook</span></div>
      <div data-ad-rendering-role="profile_name">Reel Author</div>
      <div dir="auto"><span>${realCaption}</span></div>
    </div>
    <div role="complementary" aria-label="Comments">
      <div role="article" aria-label="Comment by Someone">
        <div dir="auto">a comment on this reel</div>
      </div>
    </div>
  `;
  setLocation(`/reel/${reelId}`);
}

describe('the reel caption is not the site\'s own brand text', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  it('skips a "Facebook" chrome span and reads the real caption after it', () => {
    const adapter = new FacebookAdapter();
    mountReelPanelWithBrandChrome('555', 'a real caption someone actually wrote for this reel');

    const posts = adapter.extractPosts(document.body.childNodes);
    const video = posts.find((p) => p.id === 'fb-vid-555' && p.kind === 'video');

    expect(video).toBeDefined();
    expect(video!.text).toBe('a real caption someone actually wrote for this reel');
    expect(video!.text).not.toBe('Facebook');
  });
});
