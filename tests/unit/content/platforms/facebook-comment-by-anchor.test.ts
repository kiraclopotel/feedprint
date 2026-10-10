// @vitest-environment jsdom
//
// A Facebook comment is a comment in every language.
//
// The adapter told a comment from a post by its aria-label, and the label is
// localised: "Comentariu adăugat de X", "Comment by X", "Yorum: X". The stem
// list carries eight European languages; Facebook is read in about a hundred.
// A comment whose label the list did not carry was dropped by the comment
// walker or, when it reached the post path, written to the chain as a
// top-level post of its own, with a synthetic id, no thread and no parent.
//
// The structural signal is the comment's own permalink: Facebook renders a
// comment's timestamp as an anchor carrying ?comment_id=<id> (Q58). The word
// comment_id is the same in every language.
//
// Two sides, per the platform rule: what must match, and what must not. The
// must-nots are the shapes `[role="article"][aria-label]` also matches and
// that the walker is right to reject: the post itself on a page full of
// comment anchors, a shared post nested inside a post, an ad wrapper.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  FacebookAdapter,
  hasOwnFacebookCommentAnchor,
  isFacebookCommentArticle,
} from '../../../../src/content/platforms/facebook';

function toNodeList(elements: HTMLElement[]): NodeList {
  const container = document.createElement('div');
  for (const el of elements) container.appendChild(el);
  document.body.appendChild(container);
  return container.querySelectorAll('div[role="article"]');
}

function article(label?: string): HTMLElement {
  const el = document.createElement('div');
  el.setAttribute('role', 'article');
  if (label !== undefined) el.setAttribute('aria-label', label);
  return el;
}

/** A post with one comment under it, the comment carrying its own permalink. */
function postWithComment(commentLabel: string, commentId = '17861234'): {
  post: HTMLElement;
  comment: HTMLElement;
} {
  const post = article();
  post.innerHTML = `
    <a href="/u/posts/postId001">2 h</a>
    <div dir="auto">Main post body that is long enough to extract per the 20-char floor.</div>
  `;
  const comment = article(commentLabel);
  comment.innerHTML = `
    <a role="link" href="/commenter"><span>Someone</span></a>
    <a href="/u/posts/postId001?comment_id=${commentId}&amp;__cft__=abc&amp;__tn__=R">2 h</a>
    <div dir="auto">A comment body long enough to clear the five character floor.</div>
  `;
  post.appendChild(comment);
  return { post, comment };
}

describe('a Facebook comment is a comment in every language', () => {
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

  // MATCHES: labels no stem in the list carries, in languages Facebook serves.
  it.each([
    ['Turkish', 'Yorum: Ayşe Demir'],
    ['Polish', 'Komentarz użytkownika Jan Kowalski'],
    ['Dutch', 'Reactie van Jan de Vries'],
    ['Greek', 'Σχόλιο από τον Γιώργο'],
    ['Japanese', '田中さんのコメント'],
    ['Arabic', 'تعليق من محمد'],
    ['no label at all', ''],
  ])('%s: the comment permalink says comment where the label does not', (_language, label) => {
    const { post, comment } = postWithComment(label);
    expect(hasOwnFacebookCommentAnchor(comment)).toBe(true);
    expect(isFacebookCommentArticle(comment)).toBe(true);

    const posts = adapter.extractPosts(toNodeList([post]));
    // One post, and the comment filed under it as a comment, not beside it as
    // a post of its own. Before this, both rows came back kind 'post'.
    expect(posts.filter(p => p.kind === 'post')).toHaveLength(1);
    expect(posts.filter(p => p.kind === 'top-comment')).toHaveLength(1);
  });

  it('a reply under an unlabelled comment keeps its depth and its parent', () => {
    const { post, comment } = postWithComment('Yorum: Ayşe Demir', '1001');
    const reply = article('Yanıt: Mehmet');
    reply.innerHTML = `
      <a role="link" href="/replier"><span>Mehmet</span></a>
      <a href="/u/posts/postId001?comment_id=1002">1 h</a>
      <div dir="auto">A reply body long enough to clear the five character floor.</div>
    `;
    comment.appendChild(reply);

    const posts = adapter.extractPosts(toNodeList([post]));
    const kinds = posts.map(p => p.kind).sort();
    expect(kinds).toEqual(['post', 'reply', 'top-comment']);
    // Flat threads were the second half of the defect: without the structural
    // signal the depth walk found no comment ancestor above the reply, so the
    // reply read as depth 1 with no parent and the thread was flat in the
    // record even when both rows were extracted.
    const replyRecord = posts.find(p => p.kind === 'reply');
    expect(replyRecord?.depth).toBe(2);
    // The parent is named by Facebook's own comment_id since 2026-09-18, not
    // by the walk counter: a counter moves under one comment when the route is
    // rescanned or the article remounted, and the chain id is the dedup key.
    const parentRecord = posts.find(p => p.kind === 'top-comment');
    expect((replyRecord as unknown as { parent_id?: string | null }).parent_id).toBe('fbc-1001');
    expect(parentRecord?.id).toBe('fb-cmt-postId001-fbc-1001');
  });

  // MUST NOT MATCH: the shapes the walker is right to reject.
  it('the post itself is not a comment, however many comment anchors it holds', () => {
    const { post } = postWithComment('Comment by Jane');
    expect(hasOwnFacebookCommentAnchor(post)).toBe(false);
    expect(isFacebookCommentArticle(post)).toBe(false);
  });

  it('a shared post nested inside a post is not a comment', () => {
    const outer = article('Post by Jane Doe');
    outer.innerHTML = '<div dir="auto">Jane shared something, with body text over the floor.</div>';
    const shared = article('Post by Original Author');
    shared.innerHTML = `
      <a href="/original/posts/999">3 d</a>
      <div dir="auto">The original post body, also long enough to be extracted.</div>
    `;
    outer.appendChild(shared);

    expect(hasOwnFacebookCommentAnchor(shared)).toBe(false);
    expect(isFacebookCommentArticle(shared)).toBe(false);
  });

  it('an ad wrapper with no comment permalink is not a comment', () => {
    const ad = article('Sponsored');
    ad.innerHTML = `
      <div data-ad-preview="message">A sponsored message with enough text to be extracted.</div>
      <a href="/ads/about?entry=1">Sponsored</a>
    `;
    expect(isFacebookCommentArticle(ad)).toBe(false);
  });

  it('an anchor inside a nested comment belongs to that comment, never to the post', () => {
    // The anchor belongs to the comment, so climbing from it must stop at the
    // comment and never at the post. This is the containment mistake the
    // predicate is written to avoid.
    const { post, comment } = postWithComment('Comment by Jane');
    const anchor = comment.querySelector('a[href*="comment_id="]');
    expect(anchor?.closest('[role="article"]')).toBe(comment);
    expect(anchor?.closest('[role="article"]')).not.toBe(post);
  });
});
