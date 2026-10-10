/** @vitest-environment jsdom */
//
// The last-mile renderer could pick a different comment's text than the one
// that was judged, and the pipeline then reported success.
//
// buildEntryFromStructuralChild walks child.querySelectorAll('span, p, div'),
// which is the whole subtree, and takes the longest candidate. Instagram hands
// this function a ROW, the li, and Instagram nests a comment's replies inside
// that row. So the longest text under a parent comment can be a REPLY's text,
// or a wrapper holding both, and the wrapper wins on length by construction.
//
// Instagram and TikTok's fallback, not Facebook: buildCommentEntryForRoot's own
// map says Facebook's domRef is already the text element, so the structural
// walk never runs for it. The first draft of this file tested Facebook and
// proved nothing.
//
// The entry then came back with rootEl belonging to one comment and textEl
// belonging to another. applyCommentRewriteTerminal writes the rewrite into
// textEl and verifies textEl.textContent equals what it just wrote, which is
// true however wrong the element is. So the flagged comment stayed untouched
// and visible, an unrelated reply was overwritten with a rewrite meant for
// somebody else, and the terminal returned 'rewritten'.
//
// The guard is bounded to the subtree it was given: skip a candidate inside a
// nested comment root, and skip one that contains a nested comment root.

import { describe, it, expect, beforeEach } from 'vitest';
import { buildCommentEntryForRoot } from '../../../../src/content/protection/comment-overlay';

const PARENT_TEXT = 'short toxic line';
const REPLY_TEXT = 'a much longer and entirely unrelated reply from somebody else';

beforeEach(() => { document.body.innerHTML = ''; });

/** A Facebook/Instagram comment row with its replies nested inside it. */
function nestedComment(wrapReplyInDiv: boolean): HTMLElement {
  const reply = `
    <li>
      <a href="/@b" role="link">authorB</a>
      <span>${REPLY_TEXT}</span>
    </li>`;
  document.body.innerHTML = `
    <ul>
      <li id="parent">
        <a href="/@a" role="link">authorA</a>
        <span>${PARENT_TEXT}</span>
        ${wrapReplyInDiv ? `<div class="replies"><ul>${reply}</ul></div>` : `<ul>${reply}</ul>`}
      </li>
    </ul>`;
  return document.getElementById('parent') as HTMLElement;
}

describe('a comment is not its replies (2026-09-19)', () => {
  it('takes the parent comment’s own text, not the longer reply under it', () => {
    const entry = buildCommentEntryForRoot(nestedComment(false), 'instagram');
    expect(entry, 'an entry was built at all').toBeTruthy();
    expect(entry!.text, 'the comment that was judged').toBe(PARENT_TEXT);
    expect(entry!.text, 'never the reply').not.toBe(REPLY_TEXT);
  });

  it('refuses a wrapper that holds the comment and its replies together', () => {
    // The case that wins on length: a div whose textContent is both. Writing a
    // rewrite into it would replace the comment and every reply under it at
    // once.
    const entry = buildCommentEntryForRoot(nestedComment(true), 'instagram');
    expect(entry).toBeTruthy();
    expect(entry!.text).toBe(PARENT_TEXT);
    expect(entry!.textEl.textContent, 'the element written to holds one comment')
      .not.toContain(REPLY_TEXT);
  });

  it('the element it writes to does not contain the reply', () => {
    const entry = buildCommentEntryForRoot(nestedComment(false), 'instagram');
    expect(entry!.textEl.querySelector('li'), 'no nested comment under the write target').toBeNull();
  });

  it('an ordinary comment with no replies is unchanged', () => {
    document.body.innerHTML = `
      <ul>
        <li id="solo">
          <a href="/@a" role="link">authorA</a>
          <span>an ordinary comment with nothing nested inside it</span>
        </li>
      </ul>`;
    const entry = buildCommentEntryForRoot(document.getElementById('solo') as HTMLElement, 'instagram');
    expect(entry!.text).toBe('an ordinary comment with nothing nested inside it');
  });

  it('a comment whose only text is its own longest span still resolves', () => {
    // The guard must not starve the picker into the leaf fallback for the
    // ordinary multi-span case.
    document.body.innerHTML = `
      <ul>
        <li id="multi">
          <a href="/@a" role="link">authorA</a>
          <span>short</span>
          <span>the longer half of the same comment, which is the one to take</span>
        </li>
      </ul>`;
    const entry = buildCommentEntryForRoot(document.getElementById('multi') as HTMLElement, 'instagram');
    expect(entry!.text).toBe('the longer half of the same comment, which is the one to take');
  });
});
