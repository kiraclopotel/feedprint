// @vitest-environment jsdom
//
// Two people writing the same word are two comments.
//
// The walker drops a duplicate inside one pass, and the guard is real:
// Facebook renders one comment's body twice inside the same article and
// without it the record would carry the row twice. It was keyed on the exact
// text, so two different people writing the same short reply ("same", "amin",
// a lone emoji phrase) lost the second one, and the chain's whole claim is
// that every node the reader met leaves a record. The drop had no counter at
// all until 2026-09-02 and nothing on disk could say how often it happened.
//
// The key is now what identifies the comment: its own permalink id where the
// page carries one, otherwise the commenter's name beside the words. Two
// sides, per the platform rule: what must still be dropped, and what must not.

import { describe, it, expect, beforeEach } from 'vitest';
import { FacebookAdapter } from '../../../../src/content/platforms/facebook';

function toNodeList(elements: HTMLElement[]): NodeList {
  const container = document.createElement('div');
  for (const el of elements) container.appendChild(el);
  document.body.appendChild(container);
  return container.querySelectorAll('div[role="article"]');
}

interface Cmt { author: string; text: string; commentId?: string }

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

describe('the comment walker tells two people apart', () => {
  it('keeps both when two people write the same short reply', () => {
    const post = postWith([
      { author: 'ana', text: 'exactly', commentId: '1001' },
      { author: 'bogdan', text: 'exactly', commentId: '1002' },
    ]);

    const comments = adapter.extractPosts(toNodeList([post])).filter(p => p.kind === 'top-comment');

    expect(comments).toHaveLength(2);
    expect(comments.map(c => c.author).sort()).toEqual(['ana', 'bogdan']);
  });

  it('keeps both even when the page carries no permalink for either', () => {
    const post = postWith([
      { author: 'ana', text: 'amin frate' },
      { author: 'bogdan', text: 'amin frate' },
    ]);

    const comments = adapter.extractPosts(toNodeList([post])).filter(p => p.kind === 'top-comment');

    expect(comments).toHaveLength(2);
  });

  it('still drops one comment whose body the page rendered twice', () => {
    // The same person, the same words, the same permalink: one comment, drawn
    // twice by Facebook. This is what the guard is for and it must still bite.
    const post = postWith([
      { author: 'ana', text: 'the very same comment body', commentId: '1001' },
      { author: 'ana', text: 'the very same comment body', commentId: '1001' },
    ]);

    const comments = adapter.extractPosts(toNodeList([post])).filter(p => p.kind === 'top-comment');

    expect(comments).toHaveLength(1);
  });

  it('still drops a repeat by one person with no permalink to tell them apart', () => {
    const post = postWith([
      { author: 'ana', text: 'the very same comment body' },
      { author: 'ana', text: 'the very same comment body' },
    ]);

    const comments = adapter.extractPosts(toNodeList([post])).filter(p => p.kind === 'top-comment');

    expect(comments).toHaveLength(1);
  });

  it('one person writing two different things keeps both', () => {
    const post = postWith([
      { author: 'ana', text: 'the first thing she said' },
      { author: 'ana', text: 'and then the second thing' },
    ]);

    const comments = adapter.extractPosts(toNodeList([post])).filter(p => p.kind === 'top-comment');

    expect(comments).toHaveLength(2);
  });

  it('the name and the words cannot be re-cut to look like another pair', () => {
    // A key that simply glued the name to the words would make ("ab", "cd")
    // and ("a", "bcd") the same string. The length prefix is what stops it.
    const post = postWith([
      { author: 'ab', text: 'cdefg is a real comment' },
      { author: 'a', text: 'bcdefg is a real comment' },
    ]);

    const comments = adapter.extractPosts(toNodeList([post])).filter(p => p.kind === 'top-comment');

    expect(comments).toHaveLength(2);
  });
});
