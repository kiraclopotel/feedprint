/** @vitest-environment jsdom */
//
// The replay path could write a cached rewrite into somebody else's comment and
// record that it had re-applied it to the right one.
//
// Found 2026-09-19. `reapplyResolvedComment` in content/index.ts re-applies a
// disposition already proven for a comment when that comment is extracted
// again. Its HIDE branch went through `applyCommentHide`, which recovers the
// row and then compares the live text against the text that was judged. Its
// REWRITE branch did `post.domRef.deref()` and rewrote whatever it found.
//
// `deref()` is a handle to a NODE, not to a comment. On a virtualized feed the
// platform refills nodes as they scroll back into view, and replay is precisely
// the path that runs when a node comes back after a scroll. So the cached
// rewrite went into whatever comment now occupied that place, and
// `settleProtection(post, { record: 'replay', reason: 'comment-rewrite-reapplied' })`
// wrote that it had been re-applied to the comment that was judged. Somebody
// else's words replaced, and a signed record saying they were the right ones.
//
// The check is now one helper both branches call. These cases drive that
// helper, and the source lock at the end holds the wiring, because a helper
// nothing calls is the way this comes back.

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { readSource } from '../../../helpers/read-source';
import { createProtectionTerminals } from '../../../../src/content/protection/protection-terminals';
import type { PostContent } from '../../../../src/types/post';

const terminals = createProtectionTerminals({
  childProtection: {
    enabled: false,
    protect: vi.fn(() => null),
    prepareMutation: vi.fn(() => true),
  } as never,
  isCurrentClassification: () => true,
  writeCancelledStaleRecord: vi.fn(),
});

/** One X comment as the adapter captures it: domRef IS the text element. */
function anXComment(text: string): HTMLElement {
  const article = document.createElement('article');
  article.innerHTML = `<div data-testid="tweetText">${text}</div>`;
  document.body.appendChild(article);
  return article.querySelector<HTMLElement>('[data-testid="tweetText"]')!;
}

function postFor(el: HTMLElement, judgedText: string): PostContent {
  return {
    id: 'p1',
    text: judgedText,
    author: '@someone',
    timestamp: '2026-09-19T12:00:00.000Z',
    platform: 'twitter',
    domRef: new WeakRef(el),
    feedSource: 'for-you',
    kind: 'top-comment',
    depth: 1,
  } as unknown as PostContent;
}

beforeEach(() => { document.body.innerHTML = ''; });

describe('the replay proves the row first (2026-09-19)', () => {
  it('finds the row when the live text is still the text that was judged', () => {
    const el = anXComment('you are the worst person here');
    const row = terminals.resolveCommentRow(postFor(el, 'you are the worst person here'));
    expect(row, 'the ordinary case still resolves, or replay stops working').toBeTruthy();
    expect(row!.el).toBe(el);
  });

  it('refuses the row when the platform has refilled that node with another comment', () => {
    // The defect, reproduced. The node is the same node and it is connected;
    // only the words in it belong to somebody else now.
    const el = anXComment('you are the worst person here');
    const post = postFor(el, 'you are the worst person here');
    el.textContent = 'thanks, this was really helpful';
    expect(terminals.resolveCommentRow(post), 'a refilled node is not this comment').toBeNull();
  });

  it('refuses the row when the node has left the document', () => {
    const el = anXComment('a comment');
    const post = postFor(el, 'a comment');
    el.closest('article')!.remove();
    expect(terminals.resolveCommentRow(post)).toBeNull();
  });

  // Facebook's newline normalisation is carried through this helper too, and
  // is deliberately NOT driven here: its recovery contract wants one unique
  // full-text and depth match inside one named parent post, and a fixture
  // that satisfies it is a test of the recovery walk rather than of this
  // check. The hide terminal's own cases already drive that path, and a case
  // that passes for a reason it does not name is worse than no case.

  it('the rewrite replay goes through it, and no longer derefs on its own', () => {
    // A helper nothing calls is how this defect comes back. The source lock is
    // over the replay function specifically, not the whole file.
    const src = readSource('src/content/index.ts');
    const replay = src.match(/function reapplyResolvedComment\([\s\S]*?\n\}/)?.[0] ?? '';
    expect(replay, 'the replay function was found').not.toBe('');
    expect(replay, 'it asks for a proven row').toContain('resolveCommentRow(post)');
    expect(replay, 'and never takes the raw node handle again').not.toContain('post.domRef.deref()');
  });
});
