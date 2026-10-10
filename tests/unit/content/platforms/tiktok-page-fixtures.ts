// The fake TikTok pages the adapter tests read.
//
// Cut out of tiktok-adapter.test.ts on 2026-09-16 (PLAN-2026-09-16 item 11.3), which was 1,411
// lines. Not a test file: vitest collects only names ending in .test, so these builders are
// shared without being run.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  TiktokAdapter,
  _resetTikTokVideoDedupForTesting,
  resetTikTokVideoDedup,
} from '../../../../src/content/platforms/tiktok';

// @vitest-environment jsdom
//
// 2026-04-25 (the record-split decision): TiktokAdapter produces 1 record for the caption
// (kind='video') + N records for visible comments (kind='comment'), all sharing
// `parentVideoId`. Replaces LOOP-025's single-bundle approach so the dashboard
// can show "1 video + N checks" instead of one merged record per video.
// Tests below assert the new contract: per-video record count, kind tags,
// parentVideoId linkage.




/* ── DOM helpers ── */

export interface CommentSpec {
  text: string;
  author: string;
}

export function makeFeedItem(opts: {
  caption?: string;
  author?: string;
  videoId?: string;
  comments?: CommentSpec[];
}): HTMLElement {
  const container = document.createElement('div');
  container.setAttribute('data-e2e', 'recommend-list-item-container');

  const desc = document.createElement('div');
  desc.setAttribute('data-e2e', 'browse-video-desc');
  const captionSpan = document.createElement('span');
  captionSpan.textContent = opts.caption ?? '';
  desc.appendChild(captionSpan);
  container.appendChild(desc);

  if (opts.author) {
    const browseUsername = document.createElement('a');
    browseUsername.setAttribute('data-e2e', 'browse-username');
    browseUsername.setAttribute('href', `/@${opts.author}`);
    browseUsername.textContent = `@${opts.author}`;
    container.appendChild(browseUsername);
  }

  if (opts.videoId) {
    const link = document.createElement('a');
    link.setAttribute('href', `/@someone/video/${opts.videoId}`);
    link.textContent = 'View';
    container.appendChild(link);
  }

  if (opts.comments && opts.comments.length > 0) {
    const list = document.createElement('div');
    list.className = 'css-1abc-7937d88b--DivCommentListContainer epprvxn5';
    for (const c of opts.comments) {
      list.appendChild(buildModernCommentRow(c));
    }
    container.appendChild(list);
  }

  return container;
}

export function makeSponsoredFeedItem(videoId: string): HTMLElement {
  const item = makeFeedItem({
    caption: 'A current TikTok campaign caption that is long enough for the normal extraction path',
    author: 'example_sponsor',
  });
  const adTag = document.createElement('span');
  adTag.setAttribute('data-e2e', 'ad-tag');
  adTag.textContent = 'Sponsored';
  const wrapper = document.createElement('div');
  wrapper.id = `xgwrapper-0-${videoId}`;
  item.append(adTag, wrapper);
  return item;
}

export function rehydrateSponsoredFeedItem(root: HTMLElement, videoId: string): void {
  const hydrated = makeSponsoredFeedItem(videoId);
  root.replaceChildren(...Array.from(hydrated.childNodes));
  root.removeAttribute('data-fw-ad-hidden');
  root.removeAttribute('data-fw-prev-display');
  root.style.removeProperty('display');
}

/** Build a comment row matching the current TikTok DOM shape:
 *  DivCommentObjectWrapper > DivCommentItemWrapper > DivCommentContentWrapper
 *  with avatar `<a>` (empty text) + username `<a>` (text=handle) +
 *  inner TUXText span. */
export function buildModernCommentRow(c: CommentSpec): HTMLElement {
  const objectWrapper = document.createElement('div');
  objectWrapper.className = 'css-2def-7937d88b--DivCommentObjectWrapper epprvxn10';

  const itemWrapper = document.createElement('div');
  itemWrapper.className = 'css-3ghi-7937d88b--DivCommentItemWrapper epprvxn0';

  const contentWrapper = document.createElement('div');
  contentWrapper.className = 'css-4jkl-7937d88b--DivCommentContentWrapper epprvxn2';

  const avatar = document.createElement('a');
  avatar.setAttribute('href', `/@${c.author}`);
  avatar.textContent = '';
  contentWrapper.appendChild(avatar);

  const username = document.createElement('a');
  username.setAttribute('href', `/@${c.author}`);
  username.textContent = `@${c.author}`;
  contentWrapper.appendChild(username);

  const textWrap = document.createElement('span');
  const inner = document.createElement('span');
  inner.className = 'TUXText TUXText--tiktok-sans';
  inner.textContent = c.text;
  textWrap.appendChild(inner);
  contentWrapper.appendChild(textWrap);

  itemWrapper.appendChild(contentWrapper);
  objectWrapper.appendChild(itemWrapper);
  return objectWrapper;
}

export function makeDetailPage(opts: {
  caption?: string;
  author?: string;
  videoId?: string;
  comments?: CommentSpec[];
}): HTMLElement {
  // Modern TT permalink DOM (live MCP probe 2026-05-28): focused video
  // is a recommend-list-item-container at data-scroll-index="0", NOT a
  // separate video-detail element (which TT retired).
  const detail = document.createElement('div');
  detail.setAttribute('data-e2e', 'recommend-list-item-container');
  detail.setAttribute('data-scroll-index', '0');

  const desc = document.createElement('div');
  desc.setAttribute('data-e2e', 'video-desc');
  const captionSpan = document.createElement('span');
  captionSpan.textContent = opts.caption ?? '';
  desc.appendChild(captionSpan);
  detail.appendChild(desc);

  if (opts.author) {
    const authorLink = document.createElement('a');
    authorLink.setAttribute('data-e2e', 'video-author-uniqueid');
    authorLink.setAttribute('href', `/@${opts.author}`);
    authorLink.textContent = opts.author;
    detail.appendChild(authorLink);
  }

  if (opts.videoId) {
    const link = document.createElement('a');
    link.setAttribute('href', `/@someone/video/${opts.videoId}`);
    link.textContent = 'View';
    detail.appendChild(link);
  }

  if (opts.comments && opts.comments.length > 0) {
    const list = document.createElement('div');
    list.className = 'css-1abc-7937d88b--DivCommentListContainer epprvxn5';
    for (const c of opts.comments) {
      list.appendChild(buildModernCommentRow(c));
    }
    detail.appendChild(list);
  }

  return detail;
}

/** A standalone comment (no surrounding video container). After LOOP-025 the
 * adapter no longer treats these as posts in their own right — they only
 * surface as comments INSIDE a video container. */
export function makeOrphanComment(opts: { text: string; author: string }): HTMLElement {
  // Wraps a single modern row in an empty DIV so it has no
  // recommend-list-item-container / video-detail ancestor — the adapter's
  // video-container scan returns zero containers and emits nothing.
  const item = document.createElement('div');
  item.appendChild(buildModernCommentRow({ author: opts.author, text: opts.text }));
  return item;
}

export function toNodeList(elements: HTMLElement[]): NodeList {
  const container = document.createElement('div');
  for (const el of elements) container.appendChild(el);
  return container.childNodes;
}

/* ── Tests ── */


export interface RotatedCommentSpec {
  text: string;
  author: string;
}

export function makeRotatedFeedItem(opts: {
  caption?: string;
  author?: string;
  videoId?: string;
  comments?: RotatedCommentSpec[];
}): HTMLElement {
  const container = document.createElement('div');
  container.setAttribute('data-e2e', 'recommend-list-item-container');

  const desc = document.createElement('div');
  desc.setAttribute('data-e2e', 'browse-video-desc');
  const captionSpan = document.createElement('span');
  captionSpan.textContent = opts.caption ?? '';
  desc.appendChild(captionSpan);
  container.appendChild(desc);

  if (opts.author) {
    const browseUsername = document.createElement('a');
    browseUsername.setAttribute('data-e2e', 'browse-username');
    browseUsername.setAttribute('href', `/@${opts.author}`);
    browseUsername.textContent = `@${opts.author}`;
    container.appendChild(browseUsername);
  }

  if (opts.videoId) {
    const link = document.createElement('a');
    link.setAttribute('href', `/@someone/video/${opts.videoId}`);
    link.textContent = 'View';
    container.appendChild(link);
  }

  if (opts.comments && opts.comments.length > 0) {
    const list = document.createElement('div');
    list.className = 'css-1abc DivCommentListContainer epprvxn5';
    let idx = 0;
    for (const c of opts.comments) {
      const objectWrapper = document.createElement('div');
      objectWrapper.className = 'css-DivCommentObjectWrapper epprvxn10';
      const itemWrapper = document.createElement('div');
      itemWrapper.className = 'css-DivCommentItemWrapper epprvxn0';
      const contentWrapper = document.createElement('div');
      contentWrapper.className = 'css-DivCommentContentWrapper epprvxn2';

      // Avatar link (empty text — matches MCP probe).
      const avatar = document.createElement('a');
      avatar.setAttribute('href', `/@${c.author}`);
      avatar.textContent = '';
      contentWrapper.appendChild(avatar);

      // Username link (text = handle). The `data-e2e="comment-username-N"`
      // marker mirrors current TikTok DOM and anchors the adapter's
      // row-walker (tiktok.ts:findTikTokCommentRows) at the
      // DivCommentItemWrapper ancestor.
      const username = document.createElement('a');
      username.setAttribute('href', `/@${c.author}`);
      username.setAttribute('data-e2e', `comment-username-${idx}`);
      username.textContent = `@${c.author}`;
      contentWrapper.appendChild(username);
      idx++;

      // Text wrapper SPAN.
      const textWrap = document.createElement('span');
      textWrap.setAttribute('data-e2e', 'comment-level-1');
      const innerText = document.createElement('span');
      innerText.className = 'TUXText TUXText--tiktok-sans';
      innerText.textContent = c.text;
      textWrap.appendChild(innerText);
      contentWrapper.appendChild(textWrap);

      itemWrapper.appendChild(contentWrapper);
      objectWrapper.appendChild(itemWrapper);
      list.appendChild(objectWrapper);
    }
    container.appendChild(list);
  }

  return container;
}
