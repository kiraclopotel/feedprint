/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it } from 'vitest';
import type { CommentEntry } from '../../../../src/content/protection/comment-overlay';
import type { HideEntry } from '../../../../src/content/protection/pre-rewrite-harm-floor-gate';
import { applyUniquePreRewriteHide } from '../../../../src/content/post-path/video-pipeline';

function hide(text: string, authorHandle?: string, row?: HTMLElement): HideEntry {
  return {
    raw: {
      text,
      likes: 0,
      replies: 0,
      isPinned: false,
      isCreatorReply: false,
      isHighlighted: false,
      authorHandle: authorHandle ?? '',
      timestamp: '',
      ...(row ? { domRef: new WeakRef(row) } : {}),
    },
    reason: 'profanity-tier',
    matches: ['match'],
    harmFloor: {
      score: 0,
      signals: [],
      triggers: false,
      language: 'en',
      dampener: 1,
    },
  };
}

function entry(author: string, text: string): CommentEntry {
  const rootEl = document.createElement('li');
  const textEl = document.createElement('span');
  textEl.textContent = text;
  rootEl.appendChild(textEl);
  document.body.appendChild(rootEl);
  return { rootEl, textEl, author, text };
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('legacy pre-rewrite comment hide outcome', () => {
  it('uses author plus exact text instead of hiding the first duplicate', () => {
    const first = entry('@first', 'duplicate harmful body');
    const target = entry('@target', 'duplicate harmful body');

    expect(
      applyUniquePreRewriteHide(
        hide('duplicate harmful body', '@target'),
        [first, target],
      ),
    ).toBe(true);
    expect(first.rootEl.dataset.fwHiddenFallback).toBeUndefined();
    expect(target.rootEl.dataset.fwHiddenFallback).toBe('true');
  });

  it('refuses an ambiguous duplicate when the author is unavailable', () => {
    const first = entry('@first', 'duplicate harmful body');
    const second = entry('@second', 'duplicate harmful body');

    expect(
      applyUniquePreRewriteHide(hide('duplicate harmful body'), [first, second]),
    ).toBe(false);
    expect(first.rootEl.dataset.fwHiddenFallback).toBeUndefined();
    expect(second.rootEl.dataset.fwHiddenFallback).toBeUndefined();
  });

  it('returns false when no exact target exists', () => {
    const other = entry('@target', 'different body');

    expect(
      applyUniquePreRewriteHide(hide('missing harmful body', '@target'), [other]),
    ).toBe(false);
    expect(other.rootEl.dataset.fwHiddenFallback).toBeUndefined();
  });

  it('refuses another author with identical text after the target row is gone', () => {
    const other = entry('@other', 'same harmful body');

    expect(
      applyUniquePreRewriteHide(hide('same harmful body', '@target'), [other]),
    ).toBe(false);
    expect(other.rootEl.dataset.fwHiddenFallback).toBeUndefined();
  });

  it('proves the hidden terminal for one unique target', () => {
    const target = entry('@target', 'unique harmful body');

    expect(
      applyUniquePreRewriteHide(hide('unique harmful body', '@target'), [target]),
    ).toBe(true);
    expect(target.rootEl.style.getPropertyValue('display')).toBe('none');
    expect(target.rootEl.style.getPropertyPriority('display')).toBe('important');
  });

  it('uses the extractor row when TikTok display name differs from the stable handle', () => {
    const other = entry('@other', 'duplicate harmful body');
    const target = entry('🐢 Example Name 🐢', 'duplicate harmful body');

    expect(
      applyUniquePreRewriteHide(
        hide('duplicate harmful body', 'example_commenter', target.rootEl),
        [other, target],
      ),
    ).toBe(true);
    expect(other.rootEl.dataset.fwHiddenFallback).toBeUndefined();
    expect(target.rootEl.dataset.fwHiddenFallback).toBe('true');
  });
});
