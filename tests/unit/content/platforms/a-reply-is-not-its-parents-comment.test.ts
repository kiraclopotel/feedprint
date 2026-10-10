// @vitest-environment jsdom
//
// A long reply became its parent comment's text, under the parent's name.
//
// Instagram renders a comment's replies as `<li>` rows INSIDE the parent
// comment's own `<li>`, and all four body pickers in instagram.ts took the
// longest text span in the subtree. So whenever a reply ran longer than the
// comment it answered, the parent's record carried the REPLY's words with the
// PARENT's author and the parent's permalink.
//
// Three things follow from that, and each is worse than the one before it:
//
//   the signed record attributes one person's sentence to another;
//   the judge scores the parent on words the parent did not write;
//   the parent's `domRef` is the parent's own body, so a verdict earned by the
//   reply is applied to the parent's comment while the reply stays on screen.
//
// The reply has its own record from the same walk, so nothing is lost by
// stopping at the row boundary. Found 2026-09-19, the read side of the defect
// whose write side was closed the same day in M292.
//
// The existing M29 case in instagram-adapter.test.ts covers this DOM and could
// not catch it: its top-level comment is the longer of the two, so the picker
// happened to choose correctly.

import { describe, it, expect, beforeEach } from 'vitest';
import { InstagramAdapter } from '../../../../src/content/platforms/instagram';
import { makeArticle, toNodeList } from './instagram-page-fixtures';
import { readSource } from '../../../helpers/read-source';

const SHORT_PARENT = 'I disagree with this, briefly';
const LONG_REPLY = 'you are completely wrong about this and you always have been, every single time, without exception';

function articleWithReply(parentText: string, replyText: string): HTMLElement {
  return makeArticle(`
    <a href="/p/CxYz123_Ab/" role="link">View</a>
    <a href="/janedoe/" role="link"><span>janedoe</span></a>
    <span dir="auto">Main caption text that is long enough to be extracted by the adapter.</span>
    <ul>
      <li><span>Caption row placeholder ignored by walker</span></li>
      <li>
        <a href="/viewer1/"><span>viewer1</span></a>
        <span>${parentText}</span>
        <ul>
          <li>
            <a href="/replier1/"><span>replier1</span></a>
            <span>${replyText}</span>
          </li>
        </ul>
      </li>
    </ul>
  `);
}

let adapter: InstagramAdapter;

beforeEach(() => {
  adapter = new InstagramAdapter();
  Object.defineProperty(window, 'location', {
    value: { hostname: 'www.instagram.com', pathname: '/' },
    writable: true,
    configurable: true,
  });
});

describe('a reply is not its parent comment (2026-09-19)', () => {
  it('the parent keeps its own words when the reply underneath is longer', () => {
    const posts = adapter.extractPosts(toNodeList([articleWithReply(SHORT_PARENT, LONG_REPLY)]));
    const top = posts.find((p) => p.kind === 'top-comment');
    expect(top, 'the parent comment was extracted').toBeDefined();
    expect(top!.text, "the parent's record carries the parent's sentence").toBe(SHORT_PARENT);
    expect(top!.text, "and not the reply's").not.toContain('always have been');
  });

  it('the words stay with the person who wrote them', () => {
    // The half that reaches a lawyer. Before the fix this record said viewer1
    // wrote replier1's sentence.
    const posts = adapter.extractPosts(toNodeList([articleWithReply(SHORT_PARENT, LONG_REPLY)]));
    const top = posts.find((p) => p.kind === 'top-comment')!;
    const reply = posts.find((p) => p.kind === 'reply')!;
    expect(top.author).toBe('@viewer1');
    expect(reply.author).toBe('@replier1');
    // The pair is the claim, and it is what bites: the authors were always
    // read off their own handle links, so only the TEXT moved, which is how
    // one person's sentence ended up signed under another person's name.
    expect(top.text, 'two records, two sentences').not.toBe(reply.text);
    expect(reply.text, 'the reply still has its own record, so nothing is lost').toContain('always have been');
    expect(reply.parent_id).toBe(top.id);
  });

  it('a parent longer than its reply is unchanged, which is how this stayed hidden', () => {
    // The shape the existing M29 case uses. It passed throughout, because the
    // picker happened to choose correctly when the parent was the longer one.
    const longParent = 'Top-level comment that the parent should see flagged in the chain record output';
    const posts = adapter.extractPosts(toNodeList([articleWithReply(longParent, 'short reply')]));
    const top = posts.find((p) => p.kind === 'top-comment')!;
    expect(top.text).toBe(longParent);
  });

  it('every body picker in the file stops at the row boundary, not just the one that was reported', () => {
    // There are four, they were written at different times, and the scout named
    // one. A guard on one of four is the same defect with a smaller surface.
    const src = readSource('src/content/platforms/instagram.ts');
    const guards = src.match(/isInNestedRow\(s, \w+\)/g) ?? [];
    expect(guards.length, 'all four pickers carry the guard').toBe(4);
  });
});
