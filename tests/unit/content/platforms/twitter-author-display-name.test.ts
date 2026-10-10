// @vitest-environment jsdom
//
// X's `author` field holds only the handle, with no display name captured at
// all (record-feed-study/C-NOTES.md fault 5: "X records hold only the handle
// in `author`, with no display name captured at all"). The permalink path
// already reads both (`extractArticleAuthorHandle` + `extractArticleDisplayName`,
// used together for PostNode/CommentNode); the everyday feed path in
// `extractPosts()` discarded the display name it could have read the same
// way. This captures it into the new optional `authorName` field so the
// export can show "Display Name @handle" instead of the handle alone.
//
// authorName is gated the same way `author` already is: when the identity
// gate refused the visible header (the M66 recycled-slot case, `author ===
// 'unknown'`), a display name read from that same untrustworthy slot would
// carry the identical misattribution risk, so it must stay absent too.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TwitterAdapter } from '../../../../src/content/platforms/twitter';

function setLocation(url: string): void {
  delete (window as unknown as { location?: unknown }).location;
  (window as unknown as { location: URL }).location = new URL(url);
}

/** A feed slot whose header shows a display name distinct from the handle. */
function mountSlotWithDisplayName(handle: string, displayName: string, statusId: string, body: string): void {
  document.body.innerHTML = `
    <div data-testid="cellInnerDiv">
      <article role="article" data-testid="tweet">
        <a data-testid="User-Name" href="/${handle}" role="link"><span>${displayName}</span></a>
        <a href="/${handle}/status/${statusId}" role="link">5h</a>
        <div data-testid="tweetText" lang="en" dir="ltr">${body}</div>
      </article>
    </div>
  `;
}

function extract(adapter: TwitterAdapter): ReturnType<TwitterAdapter['extractPosts']> {
  return adapter.extractPosts(document.querySelectorAll('article[role="article"]'));
}

let adapter: TwitterAdapter;

beforeEach(() => {
  setLocation('https://x.com/home');
  adapter = new TwitterAdapter();
  document.body.innerHTML = '';
});

afterEach(() => { document.body.innerHTML = ''; });

describe('the feed path reads the display name alongside the handle', () => {
  it('captures authorName from the header span when it differs from the handle', () => {
    mountSlotWithDisplayName('sample_channel', 'Sample Channel Name', '100', 'an ordinary post body with enough words in it');

    const posts = extract(adapter);

    expect(posts).toHaveLength(1);
    expect(posts[0].author).toBe('sample_channel');
    expect(posts[0].authorName).toBe('Sample Channel Name');
  });

  it('leaves authorName absent when the identity gate refused the header (recycled-slot case)', () => {
    mountSlotWithDisplayName('first_author', 'First Author Name', '100', 'the first occupant body, read whole');
    expect(extract(adapter)[0].author).toBe('first_author');

    // Same recycled-slot XOR as twitter-author-withheld.test.ts: the body
    // changes while the header + status link stay put.
    document.querySelector<HTMLElement>('[data-testid="tweetText"]')!.outerHTML =
      '<div data-testid="tweetText" lang="en" dir="ltr">a completely different next occupant body</div>';

    const posts = extract(adapter);

    expect(posts).toHaveLength(1);
    expect(posts[0].author).toBe('unknown');
    expect(posts[0].authorCapture).toBe('withheld');
    expect(posts[0].authorName).toBeUndefined();
  });

  // Cold read finding 3 (COLD-READ-ee35374f-74c9ea6a-2026-09-28.md #3): the
  // broad selector `a[href^="/"][role="link"] span` (the fallback half of
  // extractArticleDisplayName's comma list) also matches a quoted tweet's
  // own author header, nested earlier in DOM order than the outer article's
  // real header — the display name of the person QUOTED, attributed to the
  // person who quoted them.
  it('reads the real author\'s name, not a quoted tweet\'s nested one', () => {
    document.body.innerHTML = `
      <div data-testid="cellInnerDiv">
        <article role="article" data-testid="tweet">
          <article role="link" data-testid="tweet">
            <a data-testid="User-Name" href="/quoted_handle" role="link"><span>Quoted Author</span></a>
          </article>
          <a data-testid="User-Name" href="/real_handle" role="link"><span>Real Author</span></a>
          <a href="/real_handle/status/100" role="link">5h</a>
          <div data-testid="tweetText" lang="en" dir="ltr">quoting something interesting here</div>
        </article>
      </div>
    `;

    const posts = extract(adapter);

    expect(posts).toHaveLength(1);
    expect(posts[0].author).toBe('real_handle');
    expect(posts[0].authorName).toBe('Real Author');
  });

  it('leaves authorName absent when there is no display name span to read', () => {
    document.body.innerHTML = `
      <div data-testid="cellInnerDiv">
        <article role="article" data-testid="tweet">
          <a data-testid="User-Name" href="/plain_handle" role="link"></a>
          <a href="/plain_handle/status/200" role="link">5h</a>
          <div data-testid="tweetText" lang="en" dir="ltr">a body with a handle but no name span</div>
        </article>
      </div>
    `;

    const posts = extract(adapter);

    expect(posts).toHaveLength(1);
    expect(posts[0].author).toBe('plain_handle');
    expect(posts[0].authorName).toBeUndefined();
  });
});
