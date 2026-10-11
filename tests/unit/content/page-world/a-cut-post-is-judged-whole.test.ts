// @vitest-environment jsdom
//
// A post cut at a "See more" or "Show more" control was judged as if the fragment were the whole post, though the
// platform's own data for the same item often carried the whole text: Facebook items with "… See more" kept the
// fragment, and X "Show more" tweets were skipped altogether. When the platform's text is longer and begins with what
// the page showed, it now replaces the fragment, and the record says 'platform', since that text was not read off the
// screen. Where the platform's text does not continue the fragment, the page's text stays.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearWireStore, enrichPostFromWire, rememberWireItem } from '../../../../src/content/page-world/wire-store';
import { stampTextFold } from '../../../../src/content/record/text-fold';
import { TwitterAdapter } from '../../../../src/content/platforms/twitter';
import { _resetSelectorHealthForTesting } from '../../../../src/diagnostics/selector-health';
import type { PostContent } from '../../../../src/types/post';

const FB_WHOLE = 'Our street is collecting winter coats for the shelter this weekend. Bring anything warm to the school gate '
  + 'between nine and noon, and tell your neighbours, because last year we ran out by ten.';
const FB_SHOWN = 'Our street is collecting winter coats for the shelter this weekend. Bring anything warm to the… See more';

function item(platform: PostContent['platform'], id: string, text: string): PostContent {
  const el = document.createElement('div');
  el.textContent = text;
  document.body.appendChild(el);
  return { id, text, author: 'someone', timestamp: '2026-10-10T20:00:00.000Z', platform, domRef: new WeakRef(el), feedSource: 'home' } as unknown as PostContent;
}

function wire(platform: PostContent['platform'], id: string, text: string): void {
  rememberWireItem({ id, text, platform, author: 'someone', feedSource: 'home' } as unknown as PostContent);
}

beforeEach(() => { clearWireStore(); document.body.innerHTML = ''; _resetSelectorHealthForTesting(); });
afterEach(() => { clearWireStore(); document.body.innerHTML = ''; });

describe('a Facebook post cut at "See more"', () => {
  it('takes the whole text from the platform data and is marked platform, and the fold stamp keeps that mark', () => {
    wire('facebook', 'fb-post-1', FB_WHOLE);
    const post = item('facebook', 'fb-post-1', FB_SHOWN);
    expect(enrichPostFromWire(post)).toContain('text');
    expect(post.text).toBe(FB_WHOLE);
    expect(post.textCapture).toBe('platform');
    stampTextFold(post);
    expect(post.textCapture).toBe('platform');
  });

  it('keeps the page text when the platform text does not continue it', () => {
    wire('facebook', 'fb-post-2', 'A completely different caption that is much longer than the fragment on the page, for sure.');
    const post = item('facebook', 'fb-post-2', FB_SHOWN);
    expect(enrichPostFromWire(post)).not.toContain('text');
    expect(post.text).toBe(FB_SHOWN);
  });

  it('keeps a whole page text even when the platform text is longer', () => {
    wire('facebook', 'fb-post-3', `${FB_WHOLE} Edited to add: thank you all.`);
    const post = item('facebook', 'fb-post-3', FB_WHOLE);
    expect(enrichPostFromWire(post)).not.toContain('text');
    expect(post.text).toBe(FB_WHOLE);
  });
});

describe('an X tweet behind "Show more"', () => {
  const X_SHOWN = 'Thread on what the new school rules actually say, because most of the takes I have seen today are wrong and';
  const X_WHOLE = `${X_SHOWN} worth correcting before the meeting on Thursday. First, nobody is banning phones in the yard.`;
  const html = `
    <article role="article" data-testid="tweet">
      <a data-testid="User-Name" href="/Teacher" role="link"><span>Teacher</span></a>
      <a href="/Teacher/status/555" role="link">2h</a>
      <div data-testid="tweetText" lang="en" dir="ltr">${X_SHOWN}</div>
      <button data-testid="tweet-text-show-more-link">Show more</button>
    </article>`;

  it('is recorded, marked cut, and takes the whole text when the platform data holds it', () => {
    wire('twitter', '555', X_WHOLE);
    document.body.innerHTML = html;
    const found = new TwitterAdapter().extractPosts(document.body.childNodes).find((p) => p.id === '555');
    expect(found, 'the tweet is no longer skipped').toBeTruthy();
    expect(found!.textCapture).toBe('cut');
    enrichPostFromWire(found!);
    expect(found!.text).toBe(X_WHOLE);
    expect(found!.textCapture).toBe('platform');
  });

  it('is still skipped, as before, when the platform data does not hold it', () => {
    document.body.innerHTML = html;
    const posts = new TwitterAdapter().extractPosts(document.body.childNodes);
    expect(posts.some((p) => p.id === '555')).toBe(false);
  });
});
