/** @vitest-environment jsdom */
//
// F-4 — DOM-recycle anchor recovery primitive.
//
// Pins the contract for `tryRecoverDomRecycledAnchor` — the recovery layer
// above `verifyAnchorMatch` consumed by both the post-path render-gate at
// `src/content/index.ts:1318` and the comment-batch swap loop at
// `src/content/protection/comment-overlay.ts:585`. When the platform virtualizer
// recycles a tweet/comment node mid-flight, the helper re-locates the
// original target by content fingerprint among currently-mounted siblings
// under the parent ancestor.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  tryRecoverDomRecycledAnchor,
  tryRecoverCommentAnchor,
  tryRecoverCommentHideAnchor,
  tryRecoverExactPostInterventionAnchor,
} from '../../../../src/content/post-path/dom-recycle-recovery';
import type { PostContent } from '../../../../src/types/post';

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('tryRecoverExactPostInterventionAnchor', () => {
  function xArticle(scope: HTMLElement, id: string, text: string, author: string): HTMLElement {
    const article = document.createElement('article');
    article.innerHTML = `<a href="/${author}"></a><a href="/${author}/status/${id}"></a><div data-testid="tweetText"></div>`;
    article.querySelector<HTMLElement>('[data-testid="tweetText"]')!.textContent = text;
    scope.appendChild(article);
    return article;
  }

  it('recovers one exact X status only inside the original feed area', () => {
    const scope = document.createElement('main');
    const outside = document.createElement('main');
    document.body.append(scope, outside);
    xArticle(outside, '42', 'harmful text', 'alice');
    const exact = xArticle(scope, '42', 'harmful text', 'alice');
    const post = { id: '42', text: 'harmful text', author: 'alice', platform: 'twitter', kind: 'post',
      domRef: { deref: () => undefined }, recoveryScopeRef: new WeakRef(scope) } as unknown as PostContent;
    expect(tryRecoverExactPostInterventionAnchor(post)).toBe(exact.querySelector('[data-testid="tweetText"]'));
  });

  it('refuses duplicate X identities and changed text', () => {
    const scope = document.createElement('main');
    document.body.appendChild(scope);
    xArticle(scope, '42', 'harmful text', 'alice');
    xArticle(scope, '42', 'harmful text', 'alice');
    const post = { id: '42', text: 'harmful text', author: 'alice', platform: 'twitter', kind: 'post',
      domRef: { deref: () => undefined }, recoveryScopeRef: new WeakRef(scope) } as unknown as PostContent;
    expect(tryRecoverExactPostInterventionAnchor(post)).toBeNull();
    post.text = 'different text';
    expect(tryRecoverExactPostInterventionAnchor(post)).toBeNull();
  });

  it('recovers one exact TikTok video and refuses synthetic ids', () => {
    const scope = document.createElement('main');
    document.body.appendChild(scope);
    const card = document.createElement('div');
    card.dataset.e2e = 'recommend-list-item-container';
    card.innerHTML = '<a href="/@alice"></a><a href="/@alice/video/77"></a><div data-e2e="video-desc">travel ad</div>';
    scope.appendChild(card);
    const post = { id: 'tk-vid-77', parentVideoId: '77', text: 'travel ad', author: '@alice', platform: 'tiktok', kind: 'video',
      domRef: { deref: () => undefined }, recoveryScopeRef: new WeakRef(scope) } as unknown as PostContent;
    expect(tryRecoverExactPostInterventionAnchor(post)).toBe(card);
    post.parentVideoId = 'tk-music-random';
    expect(tryRecoverExactPostInterventionAnchor(post)).toBeNull();
  });

  it('recovers an exact TikTok FYP card by wrapper id and refuses mixed wrappers', () => {
    const scope = document.createElement('main');
    document.body.appendChild(scope);
    const card = document.createElement('div');
    card.dataset.e2e = 'recommend-list-item-container';
    card.innerHTML = [
      '<a href="/@alice"></a>',
      '<div id="xgwrapper-0-7900000000000000014"></div>',
      '<div data-e2e="video-desc">travel ad</div>',
    ].join('');
    scope.appendChild(card);
    const post = {
      id: 'tk-vid-7900000000000000014',
      parentVideoId: '7900000000000000014',
      text: 'travel ad',
      author: '@alice',
      platform: 'tiktok',
      kind: 'video',
      domRef: { deref: () => undefined },
      recoveryScopeRef: new WeakRef(scope),
    } as unknown as PostContent;

    expect(tryRecoverExactPostInterventionAnchor(post)).toBe(card);
    const conflicting = document.createElement('div');
    conflicting.id = 'xgwrapper-1-7900000000000000015';
    card.appendChild(conflicting);
    expect(tryRecoverExactPostInterventionAnchor(post)).toBeNull();
  });
});

describe('tryRecoverCommentHideAnchor', () => {
  function makeFacebookPost(parentId: string): HTMLElement {
    const post = document.createElement('div');
    post.setAttribute('role', 'article');
    post.dataset.fwPostId = parentId;
    document.body.appendChild(post);
    return post;
  }

  function makeFacebookComment(
    parent: HTMLElement,
    author: string,
    commentText: string,
  ): { wrapper: HTMLElement; textEl: HTMLElement } {
    const wrapper = document.createElement('div');
    wrapper.setAttribute('role', 'article');
    wrapper.setAttribute('aria-label', `Comment by ${author}`);
    const authorEl = document.createElement('a');
    authorEl.setAttribute('role', 'link');
    authorEl.textContent = author;
    const textEl = document.createElement('div');
    textEl.setAttribute('dir', 'auto');
    textEl.textContent = commentText;
    wrapper.append(authorEl, textEl);
    parent.appendChild(wrapper);
    return { wrapper, textEl };
  }

  const identity = {
    parentId: 'post-42',
    author: 'Alice',
    depth: 1,
  } as const;

  it('recovers a unique exact remount inside the same parent after the old body detaches', () => {
    const post = makeFacebookPost(identity.parentId);
    const old = makeFacebookComment(post, identity.author, 'exact harmful comment');
    const ref = new WeakRef(old.textEl);
    old.wrapper.remove();
    const remount = makeFacebookComment(post, identity.author, 'exact harmful comment');

    expect(
      tryRecoverCommentHideAnchor(ref, 'exact harmful comment', 'facebook', identity),
    ).toBe(remount.textEl);
  });

  it('recovers the same unique target when the old WeakRef is fully cleared', () => {
    const post = makeFacebookPost(identity.parentId);
    const remount = makeFacebookComment(post, identity.author, 'exact harmful comment');
    const clearedRef = { deref: () => undefined } as unknown as WeakRef<HTMLElement>;

    expect(
      tryRecoverCommentHideAnchor(
        clearedRef,
        'exact harmful comment',
        'facebook',
        identity,
      ),
    ).toBe(remount.textEl);
  });

  it('never crosses to a different parent even when author and text are identical', () => {
    const expectedPost = makeFacebookPost(identity.parentId);
    const old = makeFacebookComment(expectedPost, identity.author, 'exact harmful comment');
    const ref = new WeakRef(old.textEl);
    old.wrapper.remove();
    const otherPost = makeFacebookPost('post-other');
    makeFacebookComment(otherPost, identity.author, 'exact harmful comment');

    expect(
      tryRecoverCommentHideAnchor(ref, 'exact harmful comment', 'facebook', identity),
    ).toBeNull();
  });

  it('uses the connected anchor scope when feed and modal mount the same parent id', () => {
    const feedPost = makeFacebookPost(identity.parentId);
    makeFacebookComment(feedPost, identity.author, 'another mounted copy');
    const modalPost = makeFacebookPost(identity.parentId);
    const modalComment = makeFacebookComment(
      modalPost,
      identity.author,
      'exact harmful comment',
    );

    expect(
      tryRecoverCommentHideAnchor(
        new WeakRef(modalComment.textEl),
        'exact harmful comment',
        'facebook',
        identity,
      ),
    ).toBe(modalComment.textEl);
  });

  it('refuses an ambiguous duplicate instead of hiding the first matching comment', () => {
    const post = makeFacebookPost(identity.parentId);
    const old = makeFacebookComment(post, identity.author, 'duplicate harmful comment');
    const ref = new WeakRef(old.textEl);
    old.wrapper.remove();
    makeFacebookComment(post, identity.author, 'duplicate harmful comment');
    makeFacebookComment(post, identity.author, 'duplicate harmful comment');

    expect(
      tryRecoverCommentHideAnchor(ref, 'duplicate harmful comment', 'facebook', identity),
    ).toBeNull();
  });

  it('recovers an unknown-author Facebook comment only when the remaining identity is unique', () => {
    const post = makeFacebookPost(identity.parentId);
    const only = makeFacebookComment(post, 'Visible author', 'unique harmful comment');

    expect(
      tryRecoverCommentHideAnchor(
        { deref: () => undefined } as unknown as WeakRef<HTMLElement>,
        'unique harmful comment',
        'facebook',
        { ...identity, author: 'unknown' },
      ),
    ).toBe(only.textEl);

    makeFacebookComment(post, 'Another author', 'unique harmful comment');
    expect(
      tryRecoverCommentHideAnchor(
        { deref: () => undefined } as unknown as WeakRef<HTMLElement>,
        'unique harmful comment',
        'facebook',
        { ...identity, author: 'unknown' },
      ),
    ).toBeNull();
  });

  it('refuses changed text under the same parent, author, and depth', () => {
    const post = makeFacebookPost(identity.parentId);
    const old = makeFacebookComment(post, identity.author, 'original harmful comment');
    const ref = new WeakRef(old.textEl);
    old.wrapper.remove();
    makeFacebookComment(post, identity.author, 'different benign comment');

    expect(
      tryRecoverCommentHideAnchor(ref, 'original harmful comment', 'facebook', identity),
    ).toBeNull();
  });

  it('refuses a connected node recycled to different text', () => {
    const post = makeFacebookPost(identity.parentId);
    const recycled = makeFacebookComment(post, identity.author, 'original harmful comment');
    const ref = new WeakRef(recycled.textEl);
    recycled.textEl.textContent = 'different benign comment';

    expect(
      tryRecoverCommentHideAnchor(ref, 'original harmful comment', 'facebook', identity),
    ).toBeNull();
  });

  it('does not use first-text sibling recovery for non-Facebook hides', () => {
    const list = document.createElement('ul');
    const first = document.createElement('li');
    const firstBody = document.createElement('span');
    firstBody.textContent = 'duplicate body';
    first.append('First author', firstBody);
    const second = document.createElement('li');
    const secondBody = document.createElement('span');
    secondBody.textContent = 'duplicate body';
    second.append('Second author', secondBody);
    list.append(first, second);
    document.body.appendChild(list);
    second.remove();

    expect(
      tryRecoverCommentHideAnchor(
        new WeakRef(second),
        'duplicate body',
        'instagram',
        identity,
      ),
    ).toBeNull();
  });
});

function makeArticle(text: string): HTMLElement {
  const article = document.createElement('article');
  article.textContent = text;
  document.body.appendChild(article);
  return article;
}

describe('tryRecoverDomRecycledAnchor', () => {
  it('case (a): WeakRef alive + content matches → returns deref result directly', () => {
    const article = makeArticle('original tweet text alpha');
    const weakRef = new WeakRef(article);
    const recovered = tryRecoverDomRecycledAnchor(weakRef, 'original tweet text alpha', 'article');
    expect(recovered).toBe(article);
  });

  it('case (b): WeakRef recycled but fingerprint matches a sibling → returns the matching sibling', () => {
    // Recycled-into article (deref still connected, but text mutated)
    const recycled = makeArticle('completely different tweet recycled into this slot');
    // The original tweet is now mounted on a different article under the same parent
    const original = makeArticle('original tweet text beta');
    const weakRef = new WeakRef(recycled);

    const recovered = tryRecoverDomRecycledAnchor(weakRef, 'original tweet text beta', 'article');
    expect(recovered).toBe(original);
    expect(recovered).not.toBe(recycled);
  });

  it('case (c): WeakRef recycled + no fingerprint match → returns null', () => {
    const recycled = makeArticle('recycled text gamma');
    makeArticle('some other unrelated tweet');
    const weakRef = new WeakRef(recycled);

    const recovered = tryRecoverDomRecycledAnchor(weakRef, 'original text that is gone', 'article');
    expect(recovered).toBeNull();
  });

  // Was: "multiple fingerprint candidates → returns first in document order".
  // Picking the first of several is picking at random, and the pick is what
  // the verdict and the intervention are applied to. An ambiguous fingerprint
  // is now a refusal; the caller writes a cancel record instead.
  it('case (d): WeakRef recycled + multiple fingerprint candidates → returns null', () => {
    const recycled = makeArticle('recycled');
    makeArticle('duplicated tweet text delta');
    makeArticle('duplicated tweet text delta');
    const weakRef = new WeakRef(recycled);

    const recovered = tryRecoverDomRecycledAnchor(weakRef, 'duplicated tweet text delta', 'article');
    expect(recovered).toBeNull();
  });

  it('case (e): malformed input → returns null without throwing', () => {
    const article = makeArticle('some text');
    const weakRef = new WeakRef(article);

    // Empty originalText
    expect(tryRecoverDomRecycledAnchor(weakRef, '', 'article')).toBeNull();
    // Empty parentSelector
    expect(tryRecoverDomRecycledAnchor(weakRef, 'some text', '')).toBeNull();
    // Cleared WeakRef + no match in document
    const clearedRef = { deref: () => undefined } as unknown as WeakRef<HTMLElement>;
    expect(tryRecoverDomRecycledAnchor(clearedRef, 'nonexistent text', 'article')).toBeNull();
    // Invalid CSS selector — must not throw, returns null
    expect(tryRecoverDomRecycledAnchor(weakRef, 'some text different', '!!!invalid')).toBeNull();
  });

  // Was: "cleared WeakRef + fingerprint matches a mounted node under
  // document.body fallback" → returned that node. The document.body fallback
  // is a page-wide text search on a 200-character prefix, which the helper's
  // own docblock had always said it would refuse.
  it('case (f): cleared WeakRef → returns null rather than walking the document', () => {
    makeArticle('orphan tweet text epsilon');
    const clearedRef = { deref: () => undefined } as unknown as WeakRef<HTMLElement>;

    const recovered = tryRecoverDomRecycledAnchor(clearedRef, 'orphan tweet text epsilon', 'article');
    expect(recovered).toBeNull();
  });
});

describe('tryRecoverCommentAnchor — comment-batch render-gate recovery', () => {
  // Builds a tweet-shaped article: <article><div><div data-testid="tweetText">TEXT</div></div></article>
  function makeXTweet(parent: HTMLElement, text: string): { article: HTMLElement; textEl: HTMLElement } {
    const article = document.createElement('article');
    const wrapper = document.createElement('div');
    const textEl = document.createElement('div');
    textEl.setAttribute('data-testid', 'tweetText');
    textEl.textContent = text;
    wrapper.appendChild(textEl);
    article.appendChild(wrapper);
    parent.appendChild(article);
    return { article, textEl };
  }

  it('fast path: deref alive + textContent matches → returns deref directly', () => {
    const timeline = document.createElement('div');
    document.body.appendChild(timeline);
    const { textEl } = makeXTweet(timeline, 'hello world fingerprint match');
    const ref = new WeakRef(textEl);

    const recovered = tryRecoverCommentAnchor(ref, 'hello world fingerprint match', 'twitter');
    expect(recovered).toBe(textEl);
  });

  it('recovery: deref text was mutated by virtualizer → walks sibling tweets to find fingerprint match', () => {
    const timeline = document.createElement('div');
    document.body.appendChild(timeline);
    // Originally-tracked tweet: enqueue captured "original alpha".
    const a = makeXTweet(timeline, 'original alpha');
    // Sibling tweet still mounted with the original text we want to recover.
    const b = makeXTweet(timeline, 'recovered target text');
    // Simulate virtualizer mutating the captured tweet's text in place.
    a.textEl.textContent = 'recycled different content';
    const ref = new WeakRef(a.textEl);

    const recovered = tryRecoverCommentAnchor(ref, 'recovered target text', 'twitter');
    expect(recovered).toBe(b.textEl);
  });

  it('returns null when no sibling fingerprint matches', () => {
    const timeline = document.createElement('div');
    document.body.appendChild(timeline);
    const a = makeXTweet(timeline, 'alpha');
    makeXTweet(timeline, 'beta');
    a.textEl.textContent = 'recycled noise';
    const ref = new WeakRef(a.textEl);

    const recovered = tryRecoverCommentAnchor(ref, 'gamma', 'twitter');
    expect(recovered).toBeNull();
  });

  it('returns null when WeakRef is fully cleared (cleared deref skips recovery walk)', () => {
    const clearedRef = { deref: () => undefined } as unknown as WeakRef<HTMLElement>;
    const recovered = tryRecoverCommentAnchor(clearedRef, 'any text', 'twitter');
    expect(recovered).toBeNull();
  });

  it('returns null on empty originalText input (defensive)', () => {
    const timeline = document.createElement('div');
    document.body.appendChild(timeline);
    const { textEl } = makeXTweet(timeline, 'something');
    const ref = new WeakRef(textEl);

    const recovered = tryRecoverCommentAnchor(ref, '', 'twitter');
    expect(recovered).toBeNull();
  });

  it('YouTube selectors: walks ytd-comment-view-model wrappers + #content-text inner', () => {
    // Mirror the YT comment shape:
    //   <ytd-comment-thread-renderer>
    //     <ytd-comment-view-model>
    //       <div id="content-text">TEXT</div>
    //     </ytd-comment-view-model>
    //   </ytd-comment-thread-renderer>
    const thread = document.createElement('ytd-comment-thread-renderer') as HTMLElement;
    document.body.appendChild(thread);
    const wrap = document.createElement('ytd-comment-view-model') as HTMLElement;
    const textEl = document.createElement('div');
    textEl.id = 'content-text';
    textEl.textContent = 'yt comment text body';
    wrap.appendChild(textEl);
    thread.appendChild(wrap);

    const ref = new WeakRef(textEl);
    const recovered = tryRecoverCommentAnchor(ref, 'yt comment text body', 'youtube');
    expect(recovered).toBe(textEl);
  });
});

describe('tryRecoverDomRecycledAnchor — the verdict must not land on someone else', () => {
  // A copypasta, a repost and two replies quoting the same block all share a
  // 200-character prefix, so the fingerprint that identifies a recycled node
  // among its own siblings identifies several strangers across a whole page.
  // The helper's own docblock already promised the strict behaviour ("Return
  // null when ... the recovery walk would have unbounded scope"); the code
  // scoped the walk to document.body and returned the FIRST match. The two
  // sibling helpers in this module (tryRecoverCommentAnchor,
  // tryRecoverCommentHideAnchor) were already strict on both counts, which is
  // what established the shape of the fix here.

  function makeArticleIn(parent: HTMLElement, text: string): HTMLElement {
    const article = document.createElement('article');
    article.textContent = text;
    parent.appendChild(article);
    return article;
  }

  function makeCell(): HTMLElement {
    const cell = document.createElement('div');
    document.body.appendChild(cell);
    return cell;
  }

  it('refuses a cleared WeakRef instead of walking the whole document', () => {
    makeArticleIn(document.body, 'a copypasta that is also mounted somewhere else');
    const clearedRef = { deref: () => undefined } as unknown as WeakRef<HTMLElement>;

    expect(
      tryRecoverDomRecycledAnchor(clearedRef, 'a copypasta that is also mounted somewhere else', 'article'),
    ).toBeNull();
  });

  it('refuses a detached WeakRef instead of walking the whole document', () => {
    const detached = document.createElement('article');
    detached.textContent = 'a quoted block';
    // Never appended: deref succeeds, isConnected is false.
    makeArticleIn(document.body, 'a quoted block');

    expect(
      tryRecoverDomRecycledAnchor(new WeakRef(detached), 'a quoted block', 'article'),
    ).toBeNull();
  });

  it('refuses when two mounted candidates share the fingerprint', () => {
    const cell = makeCell();
    const recycled = makeArticleIn(cell, 'recycled into this slot');
    makeArticleIn(cell, 'the same block quoted twice');
    makeArticleIn(cell, 'the same block quoted twice');

    expect(
      tryRecoverDomRecycledAnchor(new WeakRef(recycled), 'the same block quoted twice', 'article'),
    ).toBeNull();
  });

  it('still recovers the one unambiguous sibling', () => {
    const cell = makeCell();
    const recycled = makeArticleIn(cell, 'recycled into this slot');
    const original = makeArticleIn(cell, 'the post we actually judged');

    expect(
      tryRecoverDomRecycledAnchor(new WeakRef(recycled), 'the post we actually judged', 'article'),
    ).toBe(original);
  });

  it('refuses when the live ref sits outside any node the selector names', () => {
    // closest(parentSelector) is null here, so there is no ancestor to scope
    // the walk to and the old code fell back to document.body.
    const stray = document.createElement('div');
    document.body.appendChild(stray);
    makeArticleIn(document.body, 'the post we actually judged');

    expect(
      tryRecoverDomRecycledAnchor(new WeakRef(stray), 'the post we actually judged', 'article'),
    ).toBeNull();
  });
});
