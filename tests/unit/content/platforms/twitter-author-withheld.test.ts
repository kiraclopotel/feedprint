// @vitest-environment jsdom
//
// The record says when the recorder refused an author it could see.
//
// X's feed is virtualised: one article slot is reused for a new item while the
// recorder is reading it, so the header can belong to one account and the body
// to another. The identity gate (M66) catches that and throws the visible
// handle away, which is right: signing one account's words under another's is
// the worst thing this product could do.
//
// Until 2026-09-17 the record did not admit it had happened. About 179 rows a
// day in the owner's own export read as ordinary posts by an account called
// "unknown", with no status id and the page's own address: an observation a
// recipient cannot check against the platform and cannot tell from a header
// that simply never rendered. The record now carries authorCapture:'withheld'
// on exactly those, and on nothing else.
//
// What this does not do: it does not move a verdict, a count or a share. The
// question of whether these encounters should instead be recorded as cancelled
// under the render gate's own 'cancelled-dom-recycled' verdict is still open
// and is the owner's, with this field supplying its number.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TwitterAdapter } from '../../../../src/content/platforms/twitter';

function setLocation(url: string): void {
  delete (window as unknown as { location?: unknown }).location;
  (window as unknown as { location: URL }).location = new URL(url);
}

/** One recyclable feed slot with a header, a status link and a body. */
function mountSlot(handle: string, statusId: string, body: string): HTMLElement {
  document.body.innerHTML = `
    <div data-testid="cellInnerDiv">
      <article role="article" data-testid="tweet">
        <a data-testid="User-Name" href="/${handle}" role="link"><span>${handle}</span></a>
        <a href="/${handle}/status/${statusId}" role="link">5h</a>
        <div data-testid="tweetText" lang="en" dir="ltr">${body}</div>
      </article>
    </div>
  `;
  return document.body;
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

describe('the record says when an author was refused', () => {
  it('says nothing on an ordinary post: the author is the one the page showed', () => {
    mountSlot('stable_author', '100', 'an ordinary post body with enough words in it');

    const posts = extract(adapter);

    expect(posts).toHaveLength(1);
    expect(posts[0].author).toBe('stable_author');
    expect(posts[0].authorCapture).toBeUndefined();
  });

  it('says withheld when the slot was reused under a stale header', () => {
    mountSlot('first_author', '100', 'the first occupant body, read whole');
    // First pass: coherent, the identity is bound to the slot.
    expect(extract(adapter)[0].authorCapture).toBeUndefined();

    // The virtualiser swaps in the next occupant's body while the header and
    // the /status/100 link still belong to the previous one. The body changed
    // and the identity did not, which is the XOR the gate refuses.
    document.querySelector<HTMLElement>('[data-testid="tweetText"]')!.outerHTML =
      '<div data-testid="tweetText" lang="en" dir="ltr">a completely different next occupant body</div>';

    const posts = extract(adapter);

    expect(posts).toHaveLength(1);
    // The visible handle is thrown away, as it must be.
    expect(posts[0].author).toBe('unknown');
    // And the record says that is what happened, instead of leaving the row
    // to read as an ordinary post by somebody called unknown.
    expect(posts[0].authorCapture).toBe('withheld');
    // The address falls back to the page, which is what such a row honestly
    // is: there is no status to point a recipient at.
    expect(posts[0].sourceUrl).toBe('');
  });

  it('says nothing when there was no author to refuse', () => {
    // No status link at all: the header never resolved, which is a failed
    // read and not a refusal. The field must stay absent, or "withheld" would
    // stop meaning what it says.
    document.body.innerHTML = `
      <div data-testid="cellInnerDiv">
        <article role="article" data-testid="tweet">
          <div data-testid="tweetText" lang="en" dir="ltr">a body with no header and no status link</div>
        </article>
      </div>
    `;

    const posts = extract(adapter);

    expect(posts).toHaveLength(1);
    expect(posts[0].authorCapture).toBeUndefined();
  });

  it('says nothing on a genuine recycle, where the identity and the body moved together', () => {
    mountSlot('first_author', '100', 'the first occupant body');
    extract(adapter);

    const slot = document.querySelector<HTMLElement>('[data-testid="cellInnerDiv"]')!;
    slot.querySelector<HTMLAnchorElement>('a[href*="/status/"]')!
      .setAttribute('href', '/second_author/status/999');
    slot.querySelector<HTMLAnchorElement>('[data-testid="User-Name"]')!
      .setAttribute('href', '/second_author');
    slot.querySelector<HTMLElement>('[data-testid="tweetText"]')!.outerHTML =
      '<div data-testid="tweetText" lang="en" dir="ltr">the second occupant body, whole</div>';

    const posts = extract(adapter);

    expect(posts).toHaveLength(1);
    expect(posts[0].authorCapture).toBeUndefined();
    expect(posts[0].author).toBe('second_author');
  });
});
