/** @vitest-environment jsdom */
//
// The Facebook comment-block filter had no private-surface gate.
//
// The standing rule is one sentence: "Private surfaces (Messenger dock, DMs,
// chat overlays) are out of scope for every filter, not only the emoji
// stripper; the gate is by DOM region, not by URL alone."
//
// Found 2026-09-19 by a read that put this filter beside its six siblings.
// word-filter, empty-comment-hide, ai-content-blocker, feed-ad-blocker,
// section-model and structural-finder all consult isInPrivateChatSubtree.
// This one consulted nothing, because it is not a scan: it is a document-wide
// stylesheet of bare attribute-substring matches ending in
// `display: none !important`, started for the whole document. A stylesheet
// cannot call a predicate, so it had no gate at all.
//
// What was at stake: `form[role="presentation"]` is a bare match on a form
// wrapper; the reply stems match "Reply to" and "Răspuns"; and the Messenger
// dock renders replies and its own composer inside a chat dialog on the same
// page as the feed. A filter that hides comment threads could take a private
// conversation with them, and the person would not be told.
//
// The fix keeps the stylesheet and appends the gate as a selector, built from
// the one marker list in adapter.ts (privateChatSubtreeCss) so the CSS form and
// the predicate form cannot drift. These cases are the two sides: the filter
// still hides what it is for, and stops at the edge of a private surface.

import { describe, it, expect, beforeEach } from 'vitest';
import { blockCommentInputCSS } from '../../../../src/content/engagement/facebook-engagement';

/**
 * The selector list the sheet applies, without the declaration block, so a
 * test can ask the DOM what it would hide. Splitting on the final '{' is
 * enough: the sheet is one rule.
 */
function hiddenSelector(): string {
  const css = blockCommentInputCSS();
  const brace = css.indexOf('{');
  expect(brace, 'the sheet is one rule with one declaration block').toBeGreaterThan(0);
  return css.slice(0, brace).trim();
}

const hides = (id: string): boolean =>
  Array.from(document.querySelectorAll<HTMLElement>(hiddenSelector())).some((el) => el.id === id);

beforeEach(() => { document.body.innerHTML = ''; });

describe('the comment-block filter leaves private chats alone (2026-09-19)', () => {
  it('still hides a comment in the feed, or this is not a fix', () => {
    document.body.innerHTML = '<div id="c" aria-label="Comment by Ann Smith">nice one</div>';
    expect(hides('c')).toBe(true);
  });

  it('still hides the feed composer', () => {
    document.body.innerHTML = '<form id="f" role="presentation"><div contenteditable="true" role="textbox" aria-label="Write a comment"></div></form>';
    expect(hides('f')).toBe(true);
  });

  it('leaves a reply control inside a chat log alone', () => {
    // role="log" is Messenger's own marker, per adapter.ts. Messenger has its
    // own reply-to-a-message control, and this stem matches it.
    document.body.innerHTML = '<div role="log"><div id="r" aria-label="Reply to Ann"></div></div>';
    expect(hides('r')).toBe(false);
  });

  it('leaves the composer inside a chat dialog alone', () => {
    // The chat-head dock: a role=dialog whose label names a conversation. The
    // dock's own composer is a form, and the sheet matches a bare form.
    document.body.innerHTML = `
      <div role="dialog" aria-label="Chat with Ann Smith">
        <form id="dock" role="presentation"><div contenteditable="true" role="textbox" aria-label="Message"></div></form>
      </div>`;
    expect(hides('dock')).toBe(false);
  });

  it('leaves a Romanian chat dialog alone, since the marker list is not English-only', () => {
    document.body.innerHTML = `
      <div role="dialog" aria-label="Conversație cu Ana">
        <div id="rom" aria-label="Răspuns de la Ana"></div>
      </div>`;
    expect(hides('rom')).toBe(false);
  });

  it('does not treat every dialog as private, so a comment in a photo viewer is still hidden', () => {
    // The gate is the chat marker list, not role=dialog on its own. A post
    // opened in a modal is a dialog too, and its comments are in scope.
    document.body.innerHTML = `
      <div role="dialog" aria-label="Photo">
        <div id="modal" aria-label="Comment by Ann Smith">nice one</div>
      </div>`;
    expect(hides('modal')).toBe(true);
  });

  it('gates the parent-of-comment rules too, not only the direct ones', () => {
    // The :has() rules hide a comment's PARENT, to take the avatar column with
    // it. A gate on the direct selectors alone would still let a parent inside
    // a chat dialog be hidden, which removes the conversation around it.
    document.body.innerHTML = `
      <div role="dialog" aria-label="Messages">
        <div id="wrap"><div aria-label="Comment by Ann Smith">nice one</div></div>
      </div>`;
    expect(hides('wrap')).toBe(false);

    document.body.innerHTML = '<div id="feedwrap"><div aria-label="Comment by Ann Smith">nice one</div></div>';
    expect(hides('feedwrap'), 'and the same shape in the feed is still hidden').toBe(true);
  });

  it('every selector in the sheet carries the gate, counted rather than eyeballed', () => {
    // A selector added later without the suffix is the way this comes back, and
    // it would come back silently: the sheet still works, and only the private
    // surface changes. The selectors are one per line, so the two counts must
    // agree.
    // Split on a comma that ends a LINE: the gate itself is a :is() list whose
    // commas are inline, and splitting on every comma tears it apart. The first
    // draft of this case did exactly that and reported 1,931 ungated selectors.
    const selectors = hiddenSelector().split(/,\s*\n\s*/).map((s) => s.trim()).filter(Boolean);
    expect(selectors.length, 'the sheet still carries its whole selector list').toBeGreaterThan(20);
    const ungated = selectors.filter((s) => !s.includes(':not(:is([role="log"]'));
    expect(ungated, 'a selector with no private gate').toEqual([]);
  });
});
