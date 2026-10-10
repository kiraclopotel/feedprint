// @vitest-environment jsdom
//
// Every YouTube /watch comment was cancelled before it could be protected, and
// each one was signed with a reason that had not happened.
//
// Found 2026-09-19 by a read of src/content/platforms/yt-watch-comments.ts.
// The scanner captured `text` from `#content-text`, the comment body, and set
// `domRef` to the whole `ytd-comment-thread-renderer`. The render gate
// (src/forensics/anchor-revalidation.ts) recomputes the anchor as
// `id::liveElement.textContent.slice(0,200)` and compares it to
// `computeAnchorKey(post)`, which is `id::post.text.slice(0,200)`. A thread's
// textContent is the author, the timestamp, the body, the like count, "Reply"
// and every loaded reply, so the two can never be equal for any comment on any
// video. The gate read 'dom-recycled' every time: no marker, no hide, no
// rewrite ever landed on a YouTube comment, and
// src/content/comment-batch/flush.ts wrote a signed record saying
// `cancelled-dom-recycled`, which states that the platform reused the node for
// different content. That did not happen. A false statement of fact in signed
// evidence is worse than the missing protection beside it.
//
// Recovery could not save it either: tryRecoverCommentAnchor walks up from the
// deref'd element with `closest('ytd-comment-view-model')`, and a view-model is
// a CHILD of a thread renderer, never an ancestor, so the walk returns null.
//
// The fix anchors on the body element, which is what every other platform does
// and what the recovery table has always expected (COMMENT_RECOVERY_SELECTORS
// names `#content-text` as YouTube's marker host). These cases hold both ends:
// the gate matches on an untouched comment, and recovery finds the right
// sibling when the node really is recycled.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { PostContent } from '../../../../src/types/post';

const flagState = { ytWatchComments: true };

vi.mock('../../../../src/storage/feature-flags', () => ({
  isFeatureEnabled: vi.fn(async (flag: string) =>
    flag === 'ytWatchComments' ? flagState.ytWatchComments : false),
}));

import { initYtWatchComments, __ytWatchScanNowForTest } from '../../../../src/content/platforms/yt-watch-comments';
import { verifyAnchorMatch } from '../../../../src/forensics/anchor-revalidation';
import { computeAnchorKey } from '../../../../src/core/anchor-key';
import { tryRecoverCommentAnchor } from '../../../../src/content/post-path/dom-recycle-recovery';
import { createProtectionTerminals } from '../../../../src/content/protection/protection-terminals';
import { buildCommentEntryForRoot } from '../../../../src/content/protection/comment-overlay';

const terminals = createProtectionTerminals({
  childProtection: {
    enabled: true,
    protect: vi.fn(() => null),
    prepareMutation: vi.fn(() => true),
    commit: vi.fn(),
    release: vi.fn(),
  } as never,
  isCurrentClassification: () => true,
  writeCancelledStaleRecord: vi.fn(),
});

/**
 * A thread as YouTube actually renders one: the body is one element among
 * several, and the wrapper carries the author, the time, the like count and
 * the Reply control. The noise IS the test — a fixture holding the body alone
 * would have passed before the fix.
 */
function addComment(container: HTMLElement, text: string, author: string, id: string): HTMLElement {
  const thread = document.createElement('ytd-comment-thread-renderer');
  thread.innerHTML = `
    <ytd-comment-view-model id="comment">
      <a id="author-text"><span>${author}</span></a>
      <span id="published-time-text">3 days ago</span>
      <a href="/watch?v=vid1&lc=${id}"></a>
      <yt-attributed-string id="content-text"><span>${text}</span></yt-attributed-string>
      <span id="vote-count-middle">241</span>
      <button aria-label="Reply">Reply</button>
    </ytd-comment-view-model>
  `;
  container.appendChild(thread);
  return thread;
}

function buildWatchPage(): HTMLElement {
  window.history.replaceState({}, '', '/watch?v=vid1');
  document.body.innerHTML = '';
  const meta = document.createElement('div');
  meta.innerHTML = `
    <h1 class="ytd-watch-metadata"><yt-formatted-string>A video title</yt-formatted-string></h1>
    <div id="owner"><ytd-channel-name id="channel-name"><a href="/@ch">A Channel</a></ytd-channel-name></div>
  `;
  document.body.appendChild(meta);
  const comments = document.createElement('ytd-comments');
  comments.id = 'comments';
  document.body.appendChild(comments);
  return comments;
}

let cleanup: (() => void) | null = null;
let emitted: PostContent[] = [];

beforeEach(() => {
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
});

afterEach(() => {
  cleanup?.();
  cleanup = null;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

async function scan(): Promise<void> {
  emitted = [];
  cleanup = initYtWatchComments({ emitPost: (post) => emitted.push(post) });
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  __ytWatchScanNowForTest();
}

const commentsOnly = (): PostContent[] => emitted.filter((p) => p.kind === 'top-comment');

describe('a YouTube comment can be protected (2026-09-19)', () => {
  it('passes the render gate that decides whether any marker or hide lands', async () => {
    const container = buildWatchPage();
    addComment(container, 'you are genuinely the stupidest person alive', '@someone', 'c1');
    await scan();

    const comments = commentsOnly();
    expect(comments, 'the comment was captured at all').toHaveLength(1);
    const post = comments[0];

    // The exact call the render gate makes, in flush.ts and result-apply.ts.
    // Before the fix this returned 'dom-recycled' for every comment on every
    // video, and the batch then signed a record saying the node was recycled.
    expect(verifyAnchorMatch(computeAnchorKey(post), post, post.domRef))
      .toBe('match');
  });

  it('the anchor is the body, not the thread, so the wrapper noise cannot break it', async () => {
    const container = buildWatchPage();
    addComment(container, 'a plain comment', '@someone', 'c1');
    await scan();

    const post = commentsOnly()[0];
    const el = post.domRef.deref();
    expect(el, 'the node is still reachable').toBeTruthy();
    // The body text alone, with none of the author, time, likes or Reply that
    // sit beside it in the thread.
    expect((el!.textContent ?? '').trim()).toBe('a plain comment');
    expect(el!.closest('ytd-comment-thread-renderer'), 'still inside its thread').toBeTruthy();
  });

  it('every comment on a busy video passes, not just the first', async () => {
    const container = buildWatchPage();
    for (let i = 0; i < 6; i++) addComment(container, `comment number ${i}`, `@user${i}`, `c${i}`);
    await scan();

    const comments = commentsOnly();
    expect(comments).toHaveLength(6);
    const verdicts = comments.map((p) => verifyAnchorMatch(computeAnchorKey(p), p, p.domRef));
    expect(verdicts.every((v) => v === 'match'), 'one cancel is one comment left unprotected').toBe(true);
  });

  it('the watch-session record carries the same defect one record up, and no longer does', async () => {
    // Its text is the video title and its anchor was document.documentElement,
    // so the gate compared a title against the whole page. Same shape, same
    // consequence: a signed record saying the node was recycled.
    const container = buildWatchPage();
    addComment(container, 'a plain comment', '@someone', 'c1');
    await scan();

    const room = emitted.filter((p) => p.kind === 'video');
    expect(room, 'the watch-session record was emitted').toHaveLength(1);
    expect(verifyAnchorMatch(computeAnchorKey(room[0]), room[0], room[0].domRef)).toBe('match');
  });

  it('can actually be hidden, which it never could be, and the thread survives it', async () => {
    // The second half of the same defect. `applyCommentHide` compares the live
    // text against the text that was judged, and with the anchor on the thread
    // those two could never be equal, so the hide terminal returned false for
    // every YouTube comment ever flagged. Worse if it had not: for YouTube
    // buildCommentEntryForRoot sets `textEl: rootEl`, so hiding would have put
    // display:none on the whole thread, taking the author, the timestamp, the
    // like count and every reply with it.
    const container = buildWatchPage();
    addComment(container, 'you are genuinely the stupidest person alive', '@someone', 'c1');
    await scan();

    const post = commentsOnly()[0];
    expect(terminals.applyCommentHide(post, null), 'the hide lands').toBe(true);

    const body = post.domRef.deref()!;
    expect(body.style.getPropertyValue('display'), 'the body is closed').toBe('none');
    const thread = container.querySelector('ytd-comment-thread-renderer')!;
    expect(thread.textContent, 'the author line is still there').toContain('@someone');
    expect((thread as HTMLElement).style.getPropertyValue('display'), 'and the thread itself is not hidden').toBe('');
  });

  it('the shape that would have taken the whole thread down, named rather than described', () => {
    // No scan here: this asks buildCommentEntryForRoot directly what it would
    // do with a thread as its root, which is what the anchor used to hand it.
    // The entry's own rootEl IS the thread, and the hide writes display:none on
    // the entry's rootEl.
    const container = buildWatchPage();
    const thread = addComment(container, 'a comment', '@someone', 'c1');
    const entry = buildCommentEntryForRoot(thread, 'youtube');
    expect(entry, 'a thread does build an entry, which is why this was not caught').toBeTruthy();
    expect(entry!.rootEl, 'and that entry closes the whole thread').toBe(thread);
    expect(entry!.text, 'with the author and the Reply control read as the comment').toContain('Reply');
  });

  it('a genuinely recycled node is recovered onto the right sibling, which it never could be before', async () => {
    const container = buildWatchPage();
    addComment(container, 'first comment here', '@a', 'c1');
    addComment(container, 'second comment here', '@b', 'c2');
    await scan();

    const comments = commentsOnly();
    expect(comments).toHaveLength(2);
    const first = comments[0];

    // Recycle for real: the node the first comment was captured on now holds
    // the second comment's text. This is the case the cancel verdict names,
    // and the one recovery exists for.
    const firstEl = first.domRef.deref()!;
    firstEl.textContent = 'something else entirely';
    expect(verifyAnchorMatch(computeAnchorKey(first), first, first.domRef)).toBe('dom-recycled');

    // Put the original text on a sibling comment, which is what a virtualizer
    // shuffle looks like from here, and recovery must find it.
    const secondEl = comments[1].domRef.deref()!;
    secondEl.textContent = 'first comment here';
    const recovered = tryRecoverCommentAnchor(first.domRef, first.text, 'youtube');
    expect(recovered, 'recovery returned null for every YouTube comment before the fix').toBe(secondEl);
  });

  it('and does not recover onto a comment that says something else', async () => {
    // The other side of the selector, per the platform rule: a walk widened
    // from the view-model to the whole thread now sees every comment on the
    // page, so it has to be shown refusing the ones that do not match. A
    // marker landing on the wrong person's comment is the failure the render
    // gate exists to prevent, and recovery is the one path around that gate.
    const container = buildWatchPage();
    addComment(container, 'first comment here', '@a', 'c1');
    addComment(container, 'second comment here', '@b', 'c2');
    await scan();

    const first = commentsOnly()[0];
    first.domRef.deref()!.textContent = 'something else entirely';
    // Nothing on the page carries the original text any more.
    expect(tryRecoverCommentAnchor(first.domRef, first.text, 'youtube')).toBeNull();
  });
});
