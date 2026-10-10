/** @vitest-environment jsdom */
//
// Facebook's per-comment signals were read off the comment's own words.
//
// extractFacebookCommentSignals was handed `c.element`, and `_extractComments`
// sets `element: textEl`, the body container, because a rewrite replaces its
// textContent. So every text scan in that function, the likes counter, the
// reply counter, the Author badge and the edit marker, could only ever see the
// words the person wrote, and `isVerified`, which asks for an
// `svg[aria-label*="erif"]`, was looking for a header badge inside the body
// where it does not live.
//
// Four fields that could only produce false positives, and one that could only
// produce false negatives. All five ride into the signed record.
//
// This is the false-positive shape the codebase had already diagnosed and fixed
// for sponsored detection, where an organic caption merely mentioning
// advertising flipped the flag. It was never carried to this function.
//
// How it stayed hidden: the RO edit-marker case in edit-marker.test.ts asserted
// that `<span>Editat</span>` was detected, and it passed. It passed because its
// fixture's comment body reads "romanian edited comment text", and the regex
// matched the English word "edited" inside the body. The marker it names was
// never being read. Measured 2026-09-19 by pointing the function at the article
// instead: the chrome the signals saw was the single character " ".
//
// So each case below states which element it is about, and the body text is
// deliberately clean of every word being searched for.

import { describe, it, expect, beforeEach } from 'vitest';
import { FacebookAdapter } from '../../../../src/content/platforms/facebook';

function at(url: string): void {
  Object.defineProperty(window, 'location', {
    value: new URL(url), writable: true, configurable: true,
  });
}

/** One post with one comment, the comment's chrome and body given separately. */
function mount(body: string, chrome: string): void {
  document.body.innerHTML = `
    <div role="article">
      <div data-ad-rendering-role="story_message">
        <div dir="auto">post body long enough for threshold</div>
      </div>
      <div role="article" aria-label="Comment by Maria">
        <a href="/maria" role="link">Maria</a>
        <div dir="auto">${body}</div>
        ${chrome}
      </div>
    </div>`;
}

type FbSignals = {
  isEdited?: boolean; isAuthor?: boolean; isVerified?: boolean;
  // The two counters sit under metrics, where the record carries them.
  metrics?: { likes?: number; reply_count?: number };
};

function commentSignals(): FbSignals {
  const posts = new FacebookAdapter().extractPosts(document.body.childNodes);
  const c = posts.find((p) => p.kind === 'top-comment');
  expect(c, 'the comment was extracted at all').toBeTruthy();
  return (c!.platform_specific as unknown as FbSignals) ?? {};
}

beforeEach(() => {
  at('https://www.facebook.com/SomePage/posts/123');
  document.body.innerHTML = '';
});

describe('Facebook comment signals are read off the chrome, not the words (2026-09-19)', () => {
  describe('the words a person wrote are not metadata about them', () => {
    it('"as an author I disagree" does not make them the post author', () => {
      mount('as an author I disagree with all of this', '');
      expect(commentSignals().isAuthor).toBe(false);
    });

    it('"got 3 likes on my last post" is not three likes on this comment', () => {
      mount('got 3 likes on my last post and that was that', '');
      expect(commentSignals().metrics?.likes).toBeUndefined();
    });

    it('"9 replies to my email" is not nine replies to this comment', () => {
      mount('still waiting on 9 replies to my email from them', '');
      expect(commentSignals().metrics?.reply_count).toBeUndefined();
    });

    it('a comment that talks about something being edited is not an edited comment', () => {
      mount('the article was edited after they published it', '');
      expect(commentSignals().isEdited).toBe(false);
    });
  });

  describe('what the platform actually drew is read', () => {
    it('reads the edit marker out of the chrome, with no edit word in the body', () => {
      // The case edit-marker.test.ts meant to make. Its body said "edited";
      // this one does not, so only the span can satisfy it.
      mount('un comentariu obisnuit fara niciun cuvant special', '<span>Editat</span>');
      expect(commentSignals().isEdited).toBe(true);
    });

    it('reads the Author badge out of the chrome', () => {
      mount('a perfectly ordinary comment with no special words', '<span>Author</span>');
      expect(commentSignals().isAuthor).toBe(true);
    });

    it('reads a likes counter out of the chrome', () => {
      mount('a perfectly ordinary comment with no special words', '<span>12 likes</span>');
      expect(commentSignals().metrics?.likes).toBe(12);
    });

    it('reads a reply counter out of the chrome', () => {
      mount('a perfectly ordinary comment with no special words', '<span>View 4 replies</span>');
      expect(commentSignals().metrics?.reply_count).toBe(4);
    });

    it('finds the verified tick, which lives in the header and never in the body', () => {
      mount('a perfectly ordinary comment with no special words',
        '<svg aria-label="Verified account"></svg>');
      expect(commentSignals().isVerified).toBe(true);
    });
  });

  it('a comment with neither chrome nor trigger words carries no signals', () => {
    mount('just an ordinary sentence about the weather today', '');
    const s = commentSignals();
    expect(s.isAuthor).toBe(false);
    expect(s.isEdited).toBe(false);
    expect(s.isVerified).toBe(false);
    expect(s.metrics?.likes).toBeUndefined();
    expect(s.metrics?.reply_count).toBeUndefined();
  });
});
