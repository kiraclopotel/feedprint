/** @vitest-environment jsdom */
//
// Three readers for one rule, and two of them were copies.
//
// `facebook-comment-signal.ts` exports `isFacebookCommentLabel`, which anchors
// the stems at the START of an aria-label and strips a parenthesised prefix
// first, with a docblock saying why. `facebook.ts` had its own line doing
// `COMMENT_LABEL_STEMS.some(s => label.includes(s))`, and its depth walk had a
// third copy whose own comment read "same two signals as the gate above" —
// true of the copy, not of the rule.
//
// `includes` and `startsWith` differ on a label that merely CONTAINS a stem.
// The candidate set here is `[role="article"][aria-label]` under a post, which
// on a shared-post layout holds other posts, so a post whose label mentions a
// comment was extracted as a comment and written into the chain as one, with a
// parent it does not have.
//
// The helper was already imported into facebook.ts and already re-exported
// from it. Only these two lines had gone on with their own copy. Found
// 2026-09-19.
//
// The label in the first case is invented, because the live one cannot be read
// from here. What is measured is not that Facebook emits that string: it is
// that the two readers disagree on it, and that this file now uses the one
// with the rule written down.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FacebookAdapter, isFacebookCommentLabel } from '../../../../src/content/platforms/facebook';
import { readSource } from '../../../helpers/read-source';

function at(url: string): void {
  Object.defineProperty(window, 'location', {
    value: new URL(url), writable: true, configurable: true,
  });
}

/** One post, with one nested `[role="article"][aria-label]` under it. */
function mount(innerLabel: string, innerBody: string, extra = ''): void {
  document.body.innerHTML = `
    <div role="article" aria-label="Timeline post by Maria">
      <div data-ad-rendering-role="story_message">
        <div dir="auto">post body long enough for the extraction threshold to accept it</div>
      </div>
      <div role="article" aria-label="${innerLabel}">
        <a href="/ana" role="link">Ana</a>
        <div dir="auto">${innerBody}</div>
      </div>
      ${extra}
    </div>`;
}

const comments = () => {
  const adapter = new FacebookAdapter();
  return adapter.extractPosts(document.querySelectorAll('[role="article"]'))
    .filter((p) => p.kind === 'top-comment' || p.kind === 'reply');
};

beforeEach(() => {
  at('https://www.facebook.com/');
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('one reader for a Facebook comment label (2026-09-19)', () => {
  it('the two readings really do differ, which is the whole finding', () => {
    // Stated as a measurement rather than as a claim about the code: the loose
    // form says yes and the rule says no, on the same string.
    const label = 'shared post mentioning a comment by ana';
    expect(label.includes('comment by'), 'the copy in facebook.ts said comment').toBe(true);
    expect(isFacebookCommentLabel(label), 'the rule says post').toBe(false);
  });

  it('a real comment is still read as one', () => {
    // The control. A reader that refused everything would be the same defect
    // pointing the other way, and the chain would simply lose comments.
    mount('Comment by Ana Smith', 'a comment long enough to clear the floor');
    expect(comments().length, 'the comment survived the stricter reader').toBeGreaterThan(0);
  });

  it("a parenthesised prefix is still read as a comment, which is the helper's own tolerance", () => {
    mount('(Ana Smith) Comment by Ana Smith', 'a comment long enough to clear the floor');
    expect(comments().length).toBeGreaterThan(0);
  });

  it('a reply label is still read as one', () => {
    mount('Răspuns de la Ana Smith', 'un raspuns suficient de lung pentru prag');
    expect(comments().length).toBeGreaterThan(0);
  });

  it('neither copy is left in the file', () => {
    // The point of the change is that there is ONE reader. A copy reintroduced
    // later would diverge again the first time the rule learns something, which
    // is what the signal file's own docblock says happened before.
    const src = readSource('src/content/platforms/facebook.ts');
    // The source of this guard cannot contain the shape it forbids, or it
    // finds itself. The first draft did, in the very comment explaining the
    // change (2026-09-19), which is the same trap an exemption list falls into
    // when the exemption makes the path findable.
    expect(src, 'no hand-rolled stem scan').not.toMatch(/FB_COMMENT_LABEL_STEMS|COMMENT_LABEL_STEMS\s*\.\s*some/);
    expect(src, 'the gate asks the shared reader').toContain('isFacebookCommentLabel(cmtEl.getAttribute');
    expect(src, 'and so does the depth walk').toContain('isFacebookCommentArticle(ancestor)');
  });
});
