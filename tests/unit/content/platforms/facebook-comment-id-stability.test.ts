// @vitest-environment jsdom
//
// One comment, one id, however many times the page is walked.
//
// The chain id of a Facebook comment is `fb-cmt-<postId>-<commentId>`, and the
// session dedup key is id-bearing (content/record/forensic-gate.ts:
// forensicDedupKey). So the id IS the identity: if the same comment re-extracts
// under a different id, nothing dedups it and a second signed record is written
// with the same text, the same author and the same url.
//
// Two ways the counter that produced those ids could move under one comment:
//
//   • A route rescan. dom-interceptor.ts _clearExtractionStamps() strips
//     data-fw-processed and data-fw-comment-seen so the new surface is walked
//     again, but the post id survives on the article and so did
//     data-fw-comment-next-idx. The same comments re-extracted from c0.. as
//     c5.. and the chain took every one of them twice.
//   • A remount. The dataset counter lives on the article element, so a
//     virtualizer that replaces that element restarts at zero, and c0 then
//     names a different comment from the c0 already signed under the same
//     post id.
//
// Both are closed by taking identity from the comment itself: Facebook's own
// comment_id where the row carries a permalink (facebook-comment-signal.ts,
// live-attested 2026-08-11), the id this element was already given otherwise.

import { describe, it, expect, beforeEach } from 'vitest';
import { FacebookAdapter } from '../../../../src/content/platforms/facebook';
import type { PostContent } from '../../../../src/types/post';

interface Cmt { author: string; text: string; commentId?: string }

function toNodeList(elements: HTMLElement[]): NodeList {
  const container = document.createElement('div');
  for (const el of elements) container.appendChild(el);
  document.body.appendChild(container);
  return container.querySelectorAll('div[role="article"]');
}

function postWith(comments: Cmt[]): HTMLElement {
  const post = document.createElement('div');
  post.setAttribute('role', 'article');
  post.innerHTML = `
    <a href="/u/posts/postId001">2 h</a>
    <div dir="auto">The post body, long enough to clear the twenty character floor.</div>
  `;
  for (const c of comments) {
    const el = document.createElement('div');
    el.setAttribute('role', 'article');
    el.setAttribute('aria-label', `Comment by ${c.author}`);
    const stamp = c.commentId
      ? `<a href="/u/posts/postId001?comment_id=${c.commentId}">2 h</a>`
      : '';
    el.innerHTML = `
      <a role="link" href="/${c.author}"><span>${c.author}</span></a>
      ${stamp}
      <div dir="auto">${c.text}</div>
    `;
    post.appendChild(el);
  }
  return post;
}

/** Exactly what dom-interceptor.ts:_clearExtractionStamps does on a route change. */
function clearExtractionStamps(): void {
  document.querySelectorAll<HTMLElement>('[data-fw-processed], [data-fw-comment-seen]')
    .forEach((element) => {
      delete element.dataset.fwProcessed;
      delete element.dataset.fwCommentSeen;
    });
}

function commentIds(posts: PostContent[]): string[] {
  return posts.filter((p) => p.kind === 'top-comment').map((p) => p.id);
}

let adapter: FacebookAdapter;

beforeEach(() => {
  document.body.innerHTML = '';
  adapter = new FacebookAdapter();
  Object.defineProperty(window, 'location', {
    value: { hostname: 'www.facebook.com', pathname: '/' },
    writable: true,
    configurable: true,
  });
});

describe('a Facebook comment keeps its id across a route rescan', () => {
  it('re-extracts the same comments under the same ids when the page carries permalinks', () => {
    const post = postWith([
      { author: 'ana', text: 'the first comment on this post', commentId: '1001' },
      { author: 'bogdan', text: 'the second comment on this post', commentId: '1002' },
    ]);
    const nodes = toNodeList([post]);

    const firstPass = commentIds(adapter.extractPosts(nodes));
    expect(firstPass).toHaveLength(2);

    clearExtractionStamps();
    const secondPass = commentIds(adapter.extractPosts(nodes));

    expect(secondPass).toEqual(firstPass);
  });

  it('re-extracts the same comments under the same ids when no permalink is rendered', () => {
    const post = postWith([
      { author: 'ana', text: 'the first comment on this post' },
      { author: 'bogdan', text: 'the second comment on this post' },
    ]);
    const nodes = toNodeList([post]);

    const firstPass = commentIds(adapter.extractPosts(nodes));
    expect(firstPass).toHaveLength(2);

    clearExtractionStamps();
    const secondPass = commentIds(adapter.extractPosts(nodes));

    expect(secondPass).toEqual(firstPass);
  });
});

describe('a remount never signs two different comments under one id', () => {
  it('does not reissue an id the same post already used before the article was replaced', () => {
    const first = postWith([
      { author: 'ana', text: 'the first comment on this post' },
      { author: 'bogdan', text: 'the second comment on this post' },
    ]);
    const firstIds = commentIds(adapter.extractPosts(toNodeList([first])));
    expect(firstIds).toHaveLength(2);

    // The virtualizer replaces the article. Same post, different element, no
    // dataset counter, and a later page of comments.
    document.body.innerHTML = '';
    const remounted = postWith([
      { author: 'carmen', text: 'a third comment that loaded later' },
      { author: 'sam', text: 'a fourth comment that loaded later' },
    ]);
    const remountedIds = commentIds(adapter.extractPosts(toNodeList([remounted])));
    expect(remountedIds).toHaveLength(2);

    expect(remountedIds.filter((id) => firstIds.includes(id))).toEqual([]);
  });
});
