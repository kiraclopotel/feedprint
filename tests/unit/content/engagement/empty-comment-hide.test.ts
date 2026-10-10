// @vitest-environment jsdom
//
// Empty-comment hider — TikTok structure live-probed 2026-07-02:
// `[data-e2e="comment-level-1"]` is the text SPAN, not the row. The old
// descriptor hid only that span, leaving the avatar/username row dangling
// (a live report: "the emoji removed but it leaves an empty comment"). The wrapper is
// now the `--DivCommentItemWrapper` row; these tests pin the probed DOM shape
// and the rotation null-guard. Also first coverage for this module.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { startEmptyCommentHider } from '../../../../src/content/engagement/empty-comment-hide';
import type { FWSettings } from '../../../../src/storage/settings';

const settings = {
  features: { 'strip-emojis': { enabled: true } },
} as unknown as FWSettings;

let cleanup: (() => void) | null = null;

afterEach(() => {
  cleanup?.();
  cleanup = null;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

/** The comment-row shape probed live on tiktok.com (2026-07-02). */
function tiktokCommentRow(text: string): HTMLElement {
  const row = document.createElement('div');
  row.className = 'css-116ki3l-7937d88b--DivCommentItemWrapper eb3imn60';
  row.innerHTML =
    '<div class="css-onjzj2-7937d88b--DivCommentContentWrapper">' +
    '<img alt=""><a href="/@someone">someone</a>' +
    `<span data-e2e="comment-level-1">${text}</span>` +
    '</div>';
  document.body.appendChild(row);
  return row;
}

describe('empty-comment hider — TikTok row semantics', () => {
  it('hides the WHOLE row (avatar + username included) when the text is empty', () => {
    const row = tiktokCommentRow('   ');
    cleanup = startEmptyCommentHider('tiktok', settings);
    expect(row.style.display).toBe('none');
    expect(row.getAttribute('data-fw-empty-comment')).toBe('true');
  });

  it('leaves rows with real text fully visible', () => {
    const row = tiktokCommentRow('mersi pentru clip');
    cleanup = startEmptyCommentHider('tiktok', settings);
    expect(row.style.display).not.toBe('none');
    expect(row.hasAttribute('data-fw-empty-comment')).toBe(false);
  });

  it('rotation guard: a row whose text selector matches NOTHING is never hidden', () => {
    // TikTok rotates data-e2e → body probe matches nothing → "we don't
    // know", not "empty". Without this guard a rotation hides every comment.
    const row = document.createElement('div');
    row.className = 'css-zzz-7937d88b--DivCommentItemWrapper';
    row.innerHTML = '<div><a href="/@x">x</a><span class="rotated-text"></span></div>';
    document.body.appendChild(row);
    cleanup = startEmptyCommentHider('tiktok', settings);
    expect(row.style.display).not.toBe('none');
  });

  it('cleanup restores hidden rows', () => {
    const row = tiktokCommentRow('');
    cleanup = startEmptyCommentHider('tiktok', settings);
    expect(row.style.display).toBe('none');
    cleanup();
    cleanup = null;
    expect(row.style.display).not.toBe('none');
  });

  it('is a no-op when strip-emojis is disabled', () => {
    const row = tiktokCommentRow('');
    cleanup = startEmptyCommentHider('tiktok', {
      features: { 'strip-emojis': { enabled: false } },
    } as unknown as FWSettings);
    expect(row.style.display).not.toBe('none');
  });
});

// Q28 — the FB/X wrapper selectors match whole POSTS as well as comments.
// A media-only post whose text nodes are empty must never qualify as an
// "empty comment"; only comment-shaped wrappers (FB aria-label stem) or
// media-free tweets are eligible.
describe('empty-comment hider — whole-post guards (Q28)', () => {
  it('facebook: a media-only POST with blank [dir=auto] shims is NOT hidden', () => {
    const post = document.createElement('div');
    post.setAttribute('role', 'article');
    post.innerHTML =
      '<div dir="auto"></div><div dir="auto">  </div>' +
      '<img src="photo.jpg" alt="holiday photo">';
    document.body.appendChild(post);
    cleanup = startEmptyCommentHider('facebook', settings);
    expect(post.style.display).not.toBe('none');
    expect(post.getAttribute('data-fw-empty-comment')).toBeNull();
  });

  it('facebook: a COMMENT article with an empty body still hides', () => {
    const comment = document.createElement('div');
    comment.setAttribute('role', 'article');
    comment.setAttribute('aria-label', 'Comentariu de la Ana');
    comment.innerHTML = '<div dir="auto"></div>';
    document.body.appendChild(comment);
    cleanup = startEmptyCommentHider('facebook', settings);
    expect(comment.getAttribute('data-fw-empty-comment')).toBe('true');
  });

  it('twitter: a photo tweet whose tweetText is empty after strip is NOT hidden', () => {
    const tweet = document.createElement('article');
    tweet.setAttribute('data-testid', 'tweet');
    tweet.innerHTML =
      '<div data-testid="tweetText"></div>' +
      '<div data-testid="tweetPhoto"><img src="pic.jpg"></div>';
    document.body.appendChild(tweet);
    cleanup = startEmptyCommentHider('twitter', settings);
    expect(tweet.style.display).not.toBe('none');
  });

  it('twitter: a media-free tweet with an empty body still hides', () => {
    const tweet = document.createElement('article');
    tweet.setAttribute('data-testid', 'tweet');
    tweet.innerHTML = '<div data-testid="tweetText">  </div>';
    document.body.appendChild(tweet);
    cleanup = startEmptyCommentHider('twitter', settings);
    expect(tweet.getAttribute('data-fw-empty-comment')).toBe('true');
  });
});
