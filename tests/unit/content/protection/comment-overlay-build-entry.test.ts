/** @vitest-environment jsdom */
// §CT-34 (2026-05-05) — `buildCommentEntryForRoot` regression suite for the
// comment-batch FORENSIC_LOG rewrite-application path in `content/index.ts:
// flushBatch`. Pins per-platform dispatch + null-on-missing-text-holder so
// the swap-call in flushBatch can rely on the helper's contract:
//
//   • twitter → tweetText element-direct selector
//   • tiktok  → data-e2e first, structural fallback
//   • facebook / instagram / youtube / fallback → structural picker
//   • already-rewritten root → null (idempotency across re-flush)
//   • no recognizable text holder → null (graceful skip in caller)

import { describe, it, expect, beforeEach } from 'vitest';
import { buildCommentEntryForRoot } from '../../../../src/content/protection/comment-overlay';

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('buildCommentEntryForRoot', () => {
  it('twitter — finds tweetText element regardless of nesting depth', () => {
    document.body.innerHTML = `
      <article data-testid="tweet">
        <div>
          <div>
            <div data-testid="tweetText"><span>this is the toxic comment</span></div>
          </div>
        </div>
      </article>
    `;
    const root = document.querySelector<HTMLElement>('article')!;
    const entry = buildCommentEntryForRoot(root, 'twitter');
    expect(entry).not.toBeNull();
    expect(entry!.text).toBe('this is the toxic comment');
    expect(entry!.textEl.matches('[data-testid="tweetText"]')).toBe(true);
  });

  it('twitter — handles rootEl IS the tweetText element (production shape per twitter.ts:659)', () => {
    document.body.innerHTML = `
      <article data-testid="tweet">
        <div data-testid="tweetText"><span>direct rootEl is tweetText</span></div>
      </article>
    `;
    const tweetTextEl = document.querySelector<HTMLElement>('[data-testid="tweetText"]')!;
    const entry = buildCommentEntryForRoot(tweetTextEl, 'twitter');
    expect(entry).not.toBeNull();
    expect(entry!.text).toBe('direct rootEl is tweetText');
    expect(entry!.textEl).toBe(tweetTextEl);
  });

  it('twitter — null when tweetText element is missing', () => {
    document.body.innerHTML = `<article data-testid="tweet"><div>no text holder</div></article>`;
    const root = document.querySelector<HTMLElement>('article')!;
    expect(buildCommentEntryForRoot(root, 'twitter')).toBeNull();
  });

  it('tiktok — uses data-e2e selectors first', () => {
    document.body.innerHTML = `
      <div data-e2e="comment-level-1">
        <a href="/@someuser" data-e2e="comment-username-1">someuser</a>
        <p data-e2e="comment-text-1"><span>toxic tiktok comment text</span></p>
      </div>
    `;
    const root = document.querySelector<HTMLElement>('[data-e2e="comment-level-1"]')!;
    const entry = buildCommentEntryForRoot(root, 'tiktok');
    expect(entry).not.toBeNull();
    expect(entry!.text).toBe('toxic tiktok comment text');
  });

  it('facebook — rootEl IS the textEl per facebook.ts:426/449 (production shape)', () => {
    // FB _extractComments pushes `element: textEl` so the WeakRef on PostContent
    // points DIRECTLY to the text-bearing element. The helper takes textContent
    // verbatim instead of descending.
    document.body.innerHTML = `
      <div dir="auto" style="text-align: start;">
        <span>actual fb comment text content</span>
      </div>
    `;
    const textEl = document.querySelector<HTMLElement>('[dir="auto"]')!;
    const entry = buildCommentEntryForRoot(textEl, 'facebook');
    expect(entry).not.toBeNull();
    expect(entry!.text).toBe('actual fb comment text content');
    expect(entry!.textEl).toBe(textEl);
  });

  it('youtube — rootEl IS the textEl per youtube.ts:182 (production shape)', () => {
    // YT extractTextWithFallback returns the matched-selector element
    // (e.g. `#content-text`) which is the text container.
    document.body.innerHTML = `
      <div id="content-text"><span>youtube comment body text</span></div>
    `;
    const textEl = document.querySelector<HTMLElement>('#content-text')!;
    const entry = buildCommentEntryForRoot(textEl, 'youtube');
    expect(entry).not.toBeNull();
    expect(entry!.text).toBe('youtube comment body text');
    expect(entry!.textEl).toBe(textEl);
  });

  it('facebook / youtube — null on empty text element', () => {
    document.body.innerHTML = `<div dir="auto"></div>`;
    const empty = document.querySelector<HTMLElement>('[dir="auto"]')!;
    expect(buildCommentEntryForRoot(empty, 'facebook')).toBeNull();
    expect(buildCommentEntryForRoot(empty, 'youtube')).toBeNull();
  });

  it('instagram — descend from LI per instagram.ts:246 (ROW-level domRef)', () => {
    // IG pushes `domRef: new WeakRef(li as HTMLElement)`, the row container.
    // The structural picker walks down to find the longest non-author span.
    document.body.innerHTML = `
      <li>
        <a href="/usr" role="link">@usr</a>
        <span>some instagram comment with substance</span>
      </li>
    `;
    const root = document.querySelector<HTMLElement>('li')!;
    const entry = buildCommentEntryForRoot(root, 'instagram');
    expect(entry).not.toBeNull();
    expect(entry!.text).toBe('some instagram comment with substance');
  });

  it('idempotency — null when root already carries data-fw-rewritten', () => {
    document.body.innerHTML = `
      <article data-testid="tweet" data-fw-rewritten="true">
        <div data-testid="tweetText"><span>already swapped</span></div>
      </article>
    `;
    const root = document.querySelector<HTMLElement>('article')!;
    expect(buildCommentEntryForRoot(root, 'twitter')).toBeNull();
  });
});
