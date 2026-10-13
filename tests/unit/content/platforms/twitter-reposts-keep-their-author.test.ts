// @vitest-environment jsdom
//
// A repost keeps its author and its link.
//
// In the owner's export of 13 Oct 2026, one X record in five had no author and about 1,200 of them no link to
// the post. A repost or a liked post opens with a line ("Name reposted") whose link goes to the account that put
// it in front of the reader. That link came first in the article, so it was read as the author's handle; the
// post's own status link names the real author, the two disagreed, and the gate refused both the name and the
// address. The gate is right to refuse a name it cannot bind (a status link of another account may be left over from
// a recycled slot); the bug was that the wrong link was offered to it.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TwitterAdapter } from '../../../../src/content/platforms/twitter';

function setLocation(url: string): void {
  delete (window as unknown as { location?: unknown }).location;
  (window as unknown as { location: URL }).location = new URL(url);
}

function extract(adapter: TwitterAdapter): ReturnType<TwitterAdapter['extractPosts']> {
  return adapter.extractPosts(document.querySelectorAll('article[role="article"]'));
}

const repostSlot = (body: string): string => `
  <div data-testid="cellInnerDiv">
    <article role="article" data-testid="tweet">
      <div data-testid="socialContext"><a href="/the_reposter" role="link">The Reposter reposted</a></div>
      <a data-testid="User-Name" href="/real_author" role="link"><span>Real Author</span></a>
      <a href="/real_author/status/555" role="link">2h</a>
      <div data-testid="tweetText" lang="en" dir="ltr">${body}</div>
    </article>
  </div>`;

let adapter: TwitterAdapter;
beforeEach(() => { setLocation('https://x.com/home'); adapter = new TwitterAdapter(); document.body.innerHTML = ''; });
afterEach(() => { document.body.innerHTML = ''; });

describe('a repost on X', () => {
  it('is signed by the author of the post, not by the account that reposted it', () => {
    document.body.innerHTML = repostSlot('a post somebody else wrote, with enough words in it');
    const posts = extract(adapter);
    expect(posts).toHaveLength(1);
    expect(posts[0].author).toBe('real_author');
    expect(posts[0].authorCapture).toBeUndefined();
    expect(posts[0].sourceUrl).toBe('https://x.com/real_author/status/555');
  });

  it('keeps its author when the post grows from "Show more" in the same slot', () => {
    document.body.innerHTML = repostSlot('the first lines of a long post');
    expect(extract(adapter)[0].author).toBe('real_author');
    document.querySelector<HTMLElement>('[data-testid="tweetText"]')!.textContent =
      'the first lines of a long post and then the rest of it once opened';
    const posts = extract(adapter);
    expect(posts[0].author).toBe('real_author');
    expect(posts[0].sourceUrl).toBe('https://x.com/real_author/status/555');
  });
});

describe('when the header handle disagrees with a post link and the page gives no reason', () => {
  const unlabelled = `
    <div data-testid="cellInnerDiv">
      <article role="article" data-testid="tweet">
        <a href="/someone_else" role="link"><span>someone</span></a>
        <a href="/real_author/status/777" role="link">1h</a>
        <div data-testid="tweetText" lang="en" dir="ltr">a body whose header link is not the author</div>
      </article>
    </div>`;

  it('refuses the name and the address: the link may be left over from a recycled slot', () => {
    document.body.innerHTML = unlabelled;
    const posts = extract(adapter);
    expect(posts).toHaveLength(1);
    expect(posts[0].author).toBe('unknown');
    expect(posts[0].authorCapture).toBe('withheld');
    expect(posts[0].sourceUrl).toBe('');
  });

  it('refuses both when the slot was recycled under the same two links', () => {
    document.body.innerHTML = unlabelled;
    extract(adapter);
    document.querySelector<HTMLElement>('[data-testid="tweetText"]')!.outerHTML =
      '<div data-testid="tweetText" lang="en" dir="ltr">a wholly different next occupant of the slot</div>';
    const posts = extract(adapter);
    expect(posts[0].author).toBe('unknown');
    expect(posts[0].sourceUrl).toBe('');
  });
});
