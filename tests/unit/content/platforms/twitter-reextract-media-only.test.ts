// @vitest-environment jsdom
//
// D5 — X media-only tweets must not be re-extracted forever.
//
// `_reExtractTweetsOnPage` hands every `article[role="article"]` whose
// tweetText is un-stamped to the interceptor's re-extraction sink so the
// viewport-gate's un-stamp flow can re-route them into the BATCH path.
// Media-only tweets (photo/video/GIF with no body text) have NO tweetText
// element to carry the `fwProcessed` stamp, so pre-fix the gate could never
// terminate for them: every 250ms-debounced scroll pause re-processed them.
// Locks the terminating condition: a text-less article is not handed over
// on a second pass, while the legitimate re-walk for un-stamped text tweets
// stays intact. (Until 2026-09-02 the hand-over was a DOM detach/re-insert;
// see modal-scroll-reextract-no-dom-move.test.ts for why that is gone.)

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { TwitterAdapter } from '../../../../src/content/platforms/twitter';
import { setReExtractSink } from '../../../../src/content/post-path/scroll-trigger';

/** Direct access to the private re-extract pass (the scroll trigger's debounce
 *  target) — dispatching real scroll events would leave a window listener
 *  behind per adapter instance and add fake-timer noise without widening
 *  coverage (the debounce itself is locked by scroll-trigger.test.ts). */
function runReExtractPass(adapter: TwitterAdapter): void {
  (adapter as unknown as { _reExtractTweetsOnPage(): void })._reExtractTweetsOnPage();
}

let timeline: HTMLElement;
let sink: Mock<(roots: HTMLElement[]) => void>;

/** Count how many times `article` was handed to the sink across all passes. */
function handoverCount(article: HTMLElement): number {
  return sink.mock.calls.filter((call) => (call[0] as HTMLElement[]).includes(article)).length;
}

beforeEach(() => {
  document.body.innerHTML = '';
  timeline = document.createElement('div');
  document.body.appendChild(timeline);
  sink = vi.fn<(roots: HTMLElement[]) => void>();
  setReExtractSink(sink);
});

afterEach(() => {
  setReExtractSink(null);
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

function mountMediaOnlyArticle(): HTMLElement {
  const article = document.createElement('article');
  article.setAttribute('role', 'article');
  article.innerHTML = `
    <a href="/MediaUser" role="link"><span>Media User</span></a>
    <div data-testid="tweetPhoto"><img src="pic.jpg" alt=""></div>
  `;
  timeline.appendChild(article);
  return article;
}

function mountTextArticle(text: string, stamped: boolean): HTMLElement {
  const article = document.createElement('article');
  article.setAttribute('role', 'article');
  article.innerHTML = `
    <a href="/TextUser" role="link"><span>Text User</span></a>
    <div data-testid="tweetText" lang="en" dir="ltr">${text}</div>
  `;
  if (stamped) {
    article.querySelector<HTMLElement>('[data-testid="tweetText"]')!.dataset.fwProcessed = 'true';
  }
  timeline.appendChild(article);
  return article;
}

describe('TwitterAdapter._reExtractTweetsOnPage — media-only termination (D5)', () => {
  it('does not re-process an article without a tweetText element on a second pass', () => {
    const adapter = new TwitterAdapter();
    const mediaArticle = mountMediaOnlyArticle();

    runReExtractPass(adapter);
    const afterFirstPass = handoverCount(mediaArticle);

    runReExtractPass(adapter);
    // Terminating condition: whatever the first pass did, the second pass
    // must leave the media-only article alone — pre-fix it was re-processed
    // on EVERY pass with no exit.
    expect(handoverCount(mediaArticle)).toBe(afterFirstPass);

    runReExtractPass(adapter);
    expect(handoverCount(mediaArticle)).toBe(afterFirstPass);
  });

  it('keeps handing over an un-stamped text tweet on every pass', () => {
    const adapter = new TwitterAdapter();
    const unstamped = mountTextArticle('Un-stamped tweet body', false);

    runReExtractPass(adapter);
    runReExtractPass(adapter);

    // Legitimate behavior intact: the viewport-gate's un-stamp flow relies
    // on every pass re-routing un-stamped tweetText into extraction.
    expect(handoverCount(unstamped)).toBe(2);
  });

  it('never hands over a stamped text tweet', () => {
    const adapter = new TwitterAdapter();
    const stamped = mountTextArticle('Already-processed tweet body', true);

    runReExtractPass(adapter);
    runReExtractPass(adapter);

    expect(handoverCount(stamped)).toBe(0);
  });

  it('media-only sibling does not disturb the text-tweet re-walk', () => {
    const adapter = new TwitterAdapter();
    const mediaArticle = mountMediaOnlyArticle();
    const unstamped = mountTextArticle('Sibling tweet body', false);

    runReExtractPass(adapter);
    const mediaAfterFirstPass = handoverCount(mediaArticle);
    runReExtractPass(adapter);

    expect(handoverCount(mediaArticle)).toBe(mediaAfterFirstPass);
    expect(handoverCount(unstamped)).toBe(2);
  });

  it('never moves an article in the DOM', () => {
    const adapter = new TwitterAdapter();
    const unstamped = mountTextArticle('Un-stamped tweet body', false);
    const spy = vi.spyOn(timeline, 'insertBefore');

    runReExtractPass(adapter);

    expect(spy).not.toHaveBeenCalled();
    expect(unstamped.parentElement).toBe(timeline);
  });
});
