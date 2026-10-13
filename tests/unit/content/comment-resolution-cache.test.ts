// @vitest-environment jsdom
//
// CORE-1 (P1) + CORE-2 (P2) — batched-comment resolution cache.
//
// Batched comments never reach the post-path hide/late-verdict replay:
// onPostDetected routes every isBatchedComment through routeBatchedComment and
// RETURNS before the sessionHideCollapse / late-verdict fast paths. Before this
// fix, a comment already hidden/rewritten this session that was re-extracted on
// a FRESH virtualizer node (TikTok #column-list-container, IG/FB modals):
//   • lost its residual display:none / rewrite (fresh node has no FW stamps),
//   • was re-protected + re-bucketed, then skipped at flushBatch's
//     `hasLoggedForensic` gate (no re-hide applied),
//   • and was UNCOVERED in the finally block → the raw harmful text rendered
//     again in Child mode (SHIELD violation, CORE-1),
//   • while a full scoreBatch LLM round-trip was paid for the re-formed bucket
//     whose every member was dropped at `hasLoggedForensic` (CORE-2).
//
// The fix mirrors the VIDEO path (video-context/verdict-store.ts): a bounded
// session set of PROVEN terminal dispositions, keyed by sessionVerdictKey,
// populated ONLY by verified hide/rewrite terminals (never failure paths), and
// consulted in routeBatchedComment to (a) re-apply the disposition to the fresh
// node BEFORE any uncover cycle and (b) skip re-bucketing (no scoreBatch).
//
// These tests drive the exact production admission boundary
// (_routeBatchedCommentForTesting === routeBatchedComment, the function
// onPostDetected calls for every batched comment) and seed the cache via the
// SAME production write path the flushBatch terminals use
// (_rememberResolvedCommentForTesting === rememberResolvedComment). The
// "no scoreBatch" guarantee is proven by asserting `enqueue` is NOT called:
// enqueue (→ enqueueCommentForBatch) is the sole gateway into the
// bucket → flushBatch → scoreBatch path, so not-enqueued ⟹ no scoreBatch.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  _routeBatchedCommentForTesting as routeBatchedComment,
  _reapplyDuplicateTextVerdictForTesting as reapplyDuplicateTextVerdict,
  _setChildProtectionModeForTesting as setMode,
  _releaseProtectionForTesting as releaseProtection,
  _childProtectionActiveCountForTesting as activeCount,
} from '../../../src/content/index';
import {
  _rememberResolvedCommentForTesting as rememberResolvedComment,
  _peekResolvedCommentForTesting as peekResolvedComment,
  _clearSessionVerdictCachesOnModeChangeForTesting as clearSessionCaches,
} from '../../../src/content/post-path/late-verdict-cache';
import { _resetViewportTrackerForTesting } from '../../../src/content/post-path/viewport-tracker';
import type { PostContent } from '../../../src/types/post';

// A YouTube-shaped comment: `ytd-comment-view-model` is the protection host
// (resolveProtectionHost), so the provisional cover mounts on the WRAPPER while
// the text element stays the mutation anchor — the production separation.
// tryRecoverCommentHideAnchor returns the live domRef for non-Facebook
// platforms, and buildCommentEntryForRoot treats the text rootEl's own
// textContent as the comment text.
function makeCommentNode(text: string): { host: HTMLElement; textEl: HTMLElement } {
  const host = document.createElement('ytd-comment-view-model');
  const textEl = document.createElement('div');
  textEl.id = 'content-text';
  textEl.textContent = text;
  host.appendChild(textEl);
  document.body.appendChild(host);
  return { host, textEl };
}

function makeComment(
  text: string,
  overrides: Partial<PostContent> = {},
): { post: PostContent; host: HTMLElement; textEl: HTMLElement } {
  const { host, textEl } = makeCommentNode(text);
  const post: PostContent = {
    id: 'yt-comment-1',
    text,
    author: 'hostile-user',
    timestamp: '',
    platform: 'youtube',
    kind: 'top-comment',
    parentVideoId: 'vid-1',
    depth: 1,
    domRef: new WeakRef(textEl),
    ...overrides,
  } as PostContent;
  return { post, host, textEl };
}

const HARMFUL = 'you are worthless and everyone hates you';

beforeEach(() => {
  document.body.innerHTML = '';
  clearSessionCaches();
  _resetViewportTrackerForTesting();
});

afterEach(() => {
  setMode('adult');
  clearSessionCaches();
  _resetViewportTrackerForTesting();
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('CORE-1 — a resolved-hidden comment re-extracted on a fresh node is re-hidden, never uncovered', () => {
  it('re-hides the fresh Child-mode node and does NOT re-enqueue (no scoreBatch)', () => {
    setMode('child');
    // A prior flushBatch proved a hide for this comment (verified terminal).
    const { post: original } = makeComment(HARMFUL);
    rememberResolvedComment(original, { kind: 'hide' });
    expect(peekResolvedComment(original)).toEqual({ kind: 'hide' });

    // Virtualizer recycle: a FRESH DOM node for the SAME comment, carrying the
    // raw harmful text with NONE of FW's prior hide styling/stamps.
    const { textEl: fresh } = makeCommentNode(HARMFUL);
    const freshPost = { ...original, domRef: new WeakRef(fresh) } as PostContent;

    const enqueue = vi.fn(() => true);
    const routed = routeBatchedComment(freshPost, enqueue, performance.now());

    // Not bucketed → the sole gateway to scoreBatch was never entered.
    expect(routed).toBe(false);
    expect(enqueue).not.toHaveBeenCalled();
    // The raw harmful text is hidden on the fresh node — never uncovered.
    expect(fresh.dataset.fwHiddenFallback).toBe('true');
    expect(fresh.style.getPropertyValue('display')).toBe('none');
    expect(fresh.style.getPropertyPriority('display')).toBe('important');
    // Cover was committed (permanent hide), not left as a leaked provisional.
    expect(activeCount()).toBe(0);
  });
});

describe('CORE-2 / rewrite — a resolved-rewritten comment re-extracted on a fresh node is re-applied, never re-scored', () => {
  it('re-applies the proven rewrite to the fresh node and does NOT re-enqueue', () => {
    setMode('child');
    const REWRITE = 'i disagree with this';
    const { post: original } = makeComment(HARMFUL);
    rememberResolvedComment(original, { kind: 'rewrite', rewrite: REWRITE });

    const { textEl: fresh } = makeCommentNode(HARMFUL);
    const freshPost = { ...original, domRef: new WeakRef(fresh) } as PostContent;

    const enqueue = vi.fn(() => true);
    const routed = routeBatchedComment(freshPost, enqueue, performance.now());

    expect(routed).toBe(false);
    expect(enqueue).not.toHaveBeenCalled();
    // FW acted on the fresh node — the raw harmful text is no longer visible
    // (swapped to the safe rewrite, or hidden if the swap could not land).
    expect(fresh.dataset.fwRewritten).toBe('true');
    expect(fresh.textContent).not.toBe(HARMFUL);
  });
});

describe('Open — a comment whose calm version sits behind the red dot gets the dot back on a fresh node, and is never rewritten on the page', () => {
  it('keeps the author\'s words, mounts the red dot, and the dot\'s taps walk reason, calm version, original', () => {
    setMode('adult');
    const REWRITE = 'i disagree with this';
    const { post: original } = makeComment(HARMFUL);
    rememberResolvedComment(original, {
      kind: 'rewrite',
      rewrite: REWRITE,
      offer: {
        analysis: {
          postId: 'yt-comment-1', techniques: [], overallScore: 7, overallConfidence: 0.9, isManipulative: true,
          processingTimeMs: 1, primaryTechnique: 'shame-attack', explanation: 'it shames the reader',
        } as never,
        lang: 'en',
        mount: 'inside',
      },
    });

    const { textEl: fresh } = makeCommentNode(HARMFUL);
    const freshPost = { ...original, domRef: new WeakRef(fresh) } as PostContent;
    const enqueue = vi.fn(() => true);
    const routed = routeBatchedComment(freshPost, enqueue, performance.now());

    expect(routed).toBe(false);
    expect(enqueue).not.toHaveBeenCalled();
    expect(fresh.dataset.fwRewritten, 'nothing is swapped on an Open row').toBeUndefined();
    expect(fresh.textContent).toContain(HARMFUL);
    const dot = fresh.querySelector<HTMLButtonElement>('.fw-teen-marker');
    expect(dot, 'the red dot is back').not.toBeNull();
    expect(fresh.dataset.fwMarkerState).toBe('red');

    dot!.click();
    expect(fresh.dataset.fwMarkerState).toBe('yellow');
    dot!.click();
    expect(fresh.dataset.fwMarkerState).toBe('green');
    expect(fresh.textContent).toContain(REWRITE);
    dot!.click();
    expect(fresh.dataset.fwMarkerState).toBe('red');
    expect(fresh.textContent).toContain(HARMFUL);
  });
});

describe('inverse — a never-scored comment still flows to scoring normally', () => {
  it('enqueues a new comment (bucket → scoreBatch) and mounts a Child cover', () => {
    setMode('child');
    const { post } = makeComment('a perfectly ordinary comment', { id: 'yt-new-1' });
    expect(peekResolvedComment(post)).toBeUndefined();

    const enqueue = vi.fn(() => true);
    const routed = routeBatchedComment(post, enqueue, performance.now());

    // Admitted to the normal path: enqueue (→ bucket → scoreBatch) was called.
    expect(routed).toBe(true);
    expect(enqueue).toHaveBeenCalledTimes(1);
    // A provisional cover is held over the raw text until the verdict lands.
    expect(activeCount()).toBe(1);
    releaseProtection(post);
    expect(activeCount()).toBe(0);
  });

  it('does not consult the resolution cache for a PASS-bypassed comment', () => {
    // A resolved comment whose text CHANGED yields a different sessionVerdictKey
    // → not resolved → flows to scoring (proves the cache is identity-keyed).
    setMode('child');
    const { post: original } = makeComment(HARMFUL);
    rememberResolvedComment(original, { kind: 'hide' });

    const { textEl } = makeCommentNode('a different benign comment');
    const changed = {
      ...original,
      id: 'yt-comment-2',
      text: 'a different benign comment',
      domRef: new WeakRef(textEl),
    } as PostContent;

    const enqueue = vi.fn(() => true);
    expect(routeBatchedComment(changed, enqueue, performance.now())).toBe(true);
    expect(enqueue).toHaveBeenCalledTimes(1);
    releaseProtection(changed);
  });
});

// PROTECTION-PATH-3: the forensic dedup gate is keyed on TEXT alone, so a
// second comment with the same text from a DIFFERENT author (different id,
// different sessionVerdictKey) skips flushBatch's handling at
// hasLoggedForensic. It must inherit the verdict the first sighting earned,
// not be uncovered raw with no record.
describe('PROTECTION-PATH-3 — same text, different author, skipped at the text-dedup gate', () => {
  it('re-applies the prior hide to the second comment and keeps it out of the finally-release', () => {
    setMode('child');
    const { post: first } = makeComment(HARMFUL);
    rememberResolvedComment(first, { kind: 'hide' });

    const { textEl: secondEl } = makeCommentNode(HARMFUL);
    const second = {
      ...first,
      id: 'yt-comment-2',
      author: 'another-user',
      domRef: new WeakRef(secondEl),
    } as PostContent;
    // A different key: the per-comment resolution cache does not know it.
    expect(peekResolvedComment(second)).toBeUndefined();

    const retain = new Set<PostContent>();
    reapplyDuplicateTextVerdict(second, retain);

    expect(secondEl.dataset.fwHiddenFallback).toBe('true');
    expect(secondEl.style.getPropertyValue('display')).toBe('none');
    expect(retain.has(second)).toBe(true);
    expect(activeCount()).toBe(0);
  });

  it('does nothing for text that was never resolved', () => {
    setMode('child');
    const { post, textEl } = makeComment('a benign remark nobody acted on', { id: 'yt-comment-3' });
    const retain = new Set<PostContent>();
    reapplyDuplicateTextVerdict(post, retain);
    expect(textEl.style.getPropertyValue('display')).toBe('');
    expect(retain.size).toBe(0);
  });
});
