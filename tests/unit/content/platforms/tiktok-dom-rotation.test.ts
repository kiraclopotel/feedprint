// @vitest-environment jsdom
// TiktokAdapter — DOM rotation: DivCommentItemWrapper as comment row
//
// Cut out of tiktok-adapter.test.ts on 2026-09-16 (PLAN-2026-09-16 item 11.3).

import { describe, it, expect, beforeEach } from 'vitest';
import {
  TiktokAdapter,
  _resetTikTokVideoDedupForTesting,
  resetTikTokVideoDedup,
} from '../../../../src/content/platforms/tiktok';
import { makeFeedItem, toNodeList, makeRotatedFeedItem } from './tiktok-page-fixtures';

describe('TiktokAdapter — DOM rotation: DivCommentItemWrapper as comment row', () => {
  let adapter: TiktokAdapter;

  beforeEach(() => {
    adapter = new TiktokAdapter();
    Object.defineProperty(window, 'location', {
      value: { hostname: 'www.tiktok.com', pathname: '/' },
      writable: true,
      configurable: true,
    });
    document.body.innerHTML = '';
  });

  it('extracts comment row via DivCommentItemWrapper class match (modern DOM)', () => {
    const item = makeRotatedFeedItem({
      caption: 'Caption text long enough to pass the bundle extractor minimum length floor',
      author: 'creator1',
      videoId: '7200000000000000001',
      comments: [
        { author: 'viewer1', text: 'first comment under the rotated row layout' },
        { author: 'viewer2', text: 'second comment under the rotated row layout' },
      ],
    });

    const posts = adapter.extractPosts(toNodeList([item]));
    const comments = posts.filter((p) => p.kind === 'top-comment');
    expect(comments).toHaveLength(2);
    expect(comments[0].text).toContain('first comment under the rotated row layout');
    expect(comments[1].text).toContain('second comment under the rotated row layout');
  });

  it('captures author from username link (avatar `<a>` empty, second `<a>` has text)', () => {
    const item = makeRotatedFeedItem({
      caption: 'Caption text long enough to pass the bundle extractor minimum length floor',
      author: 'creator1',
      videoId: '7200000000000000001',
      comments: [{ author: 'rotateduser', text: 'a substantive comment from a known author' }],
    });

    const posts = adapter.extractPosts(toNodeList([item]));
    const comment = posts.find((p) => p.kind === 'top-comment');
    expect(comment).toBeDefined();
    // Author resolved via the row's `a[href^="/@"]` first-non-empty walk per
    // the bundle extractor contract. Avatar's empty text is skipped.
    expect(comment!.author).toBe('@rotateduser');
  });

  it('domRef points at the body text element so the marker mounts inline next to visible text', () => {
    const item = makeRotatedFeedItem({
      caption: 'Caption text long enough to pass the bundle extractor minimum length floor',
      author: 'creator1',
      videoId: '7200000000000000001',
      comments: [{ author: 'viewer1', text: 'a comment whose marker host must be the body element' }],
    });
    document.body.appendChild(item);

    const posts = adapter.extractPosts(toNodeList([item]));
    const comment = posts.find((p) => p.kind === 'top-comment');
    const refEl = comment!.domRef.deref();
    expect(refEl).toBeDefined();
    // Body element: NOT the outer wrapper DIV. Appending the marker as a
    // child of the row results in React reconciliation removing it within
    // a tick. Anchoring on the body span keeps the marker mounted inline
    // next to the visible text — matches X / FB patterns. The
    // SHELL_SELECTOR walk in viewport-tracker still finds the row from
    // the body via `closest('[class*="DivCommentItemWrapper"]')` for
    // stamp clearing on viewport re-entry.
    expect(refEl!.tagName).not.toBe('DIV');
    expect(refEl!.closest('[class*="DivCommentItemWrapper"]')).not.toBeNull();
  });

  it('lazy-load: appended row gets extracted on second pass (per-row dedup)', () => {
    // Mirror the §CT-30 lazy-load regression cover for the rotated DOM.
    // Per-comment-seen stamp lives on the ROW element. A row appended after
    // the first scan is a new DOM node without the stamp → it surfaces.
    const item = makeRotatedFeedItem({
      caption: 'Caption text long enough to pass the bundle extractor minimum length floor',
      author: 'creator1',
      videoId: '7200000000000000001',
      comments: [{ author: 'viewer1', text: 'first reaction comment under the rotated row' }],
    });
    document.body.appendChild(item);

    const first = adapter.extractPosts(toNodeList([item]));
    expect(first.filter((p) => p.kind === 'top-comment')).toHaveLength(1);

    // Append a new row to the existing list container.
    const list = item.querySelector<HTMLElement>('.DivCommentListContainer');
    expect(list).not.toBeNull();
    const newWrapper = document.createElement('div');
    newWrapper.className = 'css-DivCommentObjectWrapper epprvxn10';
    const newItem = document.createElement('div');
    newItem.className = 'css-DivCommentItemWrapper epprvxn0';
    const newContent = document.createElement('div');
    newContent.className = 'css-DivCommentContentWrapper epprvxn2';
    const newAvatar = document.createElement('a');
    newAvatar.setAttribute('href', '/@viewer2');
    newAvatar.textContent = '';
    newContent.appendChild(newAvatar);
    const newUsername = document.createElement('a');
    newUsername.setAttribute('href', '/@viewer2');
    newUsername.textContent = '@viewer2';
    newContent.appendChild(newUsername);
    const newTextWrap = document.createElement('span');
    newTextWrap.setAttribute('data-e2e', 'comment-level-1');
    const newInner = document.createElement('span');
    newInner.className = 'TUXText TUXText--tiktok-sans';
    newInner.textContent = 'second reaction comment lazy-loaded after the first pass';
    newTextWrap.appendChild(newInner);
    newContent.appendChild(newTextWrap);
    newItem.appendChild(newContent);
    newWrapper.appendChild(newItem);
    list?.appendChild(newWrapper);

    const second = adapter.extractPosts(toNodeList([item]));
    // Caption already emitted → no new caption record.
    expect(second.filter((p) => p.kind === 'video')).toHaveLength(0);
    // Only the newly-appended row surfaces on the second pass.
    const newComments = second.filter((p) => p.kind === 'top-comment');
    expect(newComments).toHaveLength(1);
    expect(newComments[0].text).toContain('lazy-loaded after the first pass');
  });

  it('makeFeedItem fixture (now modern shape) extracts comments through the same row selector path', () => {
    // Sanity check that the modernized `makeFeedItem` helper yields the same
    // single-comment extraction as the inline-built `makeRotatedFeedItem`.
    // Both helpers now produce DivCommentItemWrapper-rooted rows; the
    // pre-rotation `data-e2e="comment-level-1"`-as-row shape is no longer
    // covered (TikTok stripped those attributes from the comment panel).
    const item = makeFeedItem({
      caption: 'Caption text long enough to pass the bundle extractor minimum length floor',
      author: 'creator1',
      videoId: '7200000000000000001',
      comments: [
        { author: 'sole', text: 'a single comment under the modern row layout' },
      ],
    });

    const posts = adapter.extractPosts(toNodeList([item]));
    const comments = posts.filter((p) => p.kind === 'top-comment');
    expect(comments).toHaveLength(1);
    expect(comments[0].text).toContain('single comment under the modern row layout');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Empty-caption video records (forensic chain-mirror, VISION §1.1).
//
// A real 862-record export showed 40 distinct TikTok videos referenced by
// comment records but only 20 video records — half the watched videos had
// their comments recorded with no signed video node. Root cause: the bundle
// extractor returns null on an empty caption (music-only / "original sound"),
// the fallback path emitted comment records but NO video record, so a
// captionless video produced zero video nodes while its (unique-text)
// comments survived. These tests lock the corrected contract: every distinct
// video whose comments are recorded ALSO emits exactly one video record, and
// the record is deduped by video IDENTITY (id), not caption text.
// ─────────────────────────────────────────────────────────────────────────────
