// @vitest-environment jsdom
//
// META-1 (audit swarm 2026-07-13) — the teen-rewrite comment pipeline's
// generic-role DOM queries must carry the same DM defenses the FB/IG adapters'
// `_collectArticles` already has. A private Messenger/DM subtree
// (`role="log"` message live-region, or a chat-overlay `role="dialog"`) that
// nests `role="article"` / `<article>` bubbles must be skipped, while a
// genuine feed article coexisting in the same document is still extracted.
//
// Covers all four ungated selector sites named in the report:
//   - extractFacebookComments()      (comment-extractors.ts)
//   - extractInstagramComments()     (comment-extractors.ts)
//   - getCommentsContainer('facebook')  (video-pipeline.ts)
//   - getCommentsContainer('instagram') (video-pipeline.ts)

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { extractComments } from '../../../../src/content/platforms/comment-extractors';
import { getCommentsContainer } from '../../../../src/content/post-path/video-pipeline';

const FEED_FB_TEXT = 'a genuine public feed comment on facebook';
const DM_FB_TEXT = 'private facebook messenger bubble text that must never leak';
const FEED_IG_TEXT = 'a genuine public instagram comment body';
const DM_IG_TEXT = 'private instagram dm text that must never leak';

function mount(html: string): void {
  document.body.innerHTML = html;
}

describe('META-1 — DM/chat-log gate on the teen-rewrite comment pipeline', () => {
  beforeEach(() => { document.body.innerHTML = ''; });
  afterEach(() => { document.body.innerHTML = ''; });

  it('FB: skips Messenger role="log" bubbles, still extracts the feed comment', () => {
    // Worst case: the chat subtree carries the SAME ul>li + a[role=link] +
    // div[dir=auto] shape extractFacebookComments looks for. The role="log"
    // gate must exclude it regardless.
    mount(`
      <div role="log" aria-label="Messages in conversation with Example Contact">
        <div role="article" aria-label="Message from Example Contact">
          <ul><li>
            <a role="link">Example Contact</a>
            <div dir="auto">${DM_FB_TEXT}</div>
          </li></ul>
        </div>
      </div>
      <div role="article" aria-label="Comment by Feed User">
        <ul><li>
          <a role="link">Feed User</a>
          <div dir="auto">${FEED_FB_TEXT}</div>
        </li></ul>
      </div>
    `);
    const comments = extractComments('facebook');
    const bodies = comments.map((c) => c.text);
    expect(bodies).toContain(FEED_FB_TEXT);
    expect(bodies).not.toContain(DM_FB_TEXT);
  });

  it('FB: skips chat-overlay role="dialog" bubbles (findChatOverlayAncestor path)', () => {
    mount(`
      <div role="dialog" aria-label="Chat with Example Contact">
        <div role="article" aria-label="Message from Example Contact">
          <ul><li>
            <a role="link">Example Contact</a>
            <div dir="auto">${DM_FB_TEXT}</div>
          </li></ul>
        </div>
      </div>
      <div role="article" aria-label="Comment by Feed User">
        <ul><li>
          <a role="link">Feed User</a>
          <div dir="auto">${FEED_FB_TEXT}</div>
        </li></ul>
      </div>
    `);
    const bodies = extractComments('facebook').map((c) => c.text);
    expect(bodies).toContain(FEED_FB_TEXT);
    expect(bodies).not.toContain(DM_FB_TEXT);
  });

  it('FB: getCommentsContainer skips the chat ul, returns the feed ul', () => {
    mount(`
      <div role="log" aria-label="Messages in conversation with Example Contact">
        <div role="article" aria-label="Message from Example Contact">
          <ul id="dm-ul">
            <li><a role="link">Example Contact</a><div dir="auto">${DM_FB_TEXT}</div></li>
            <li><a role="link">Example Contact</a><div dir="auto">${DM_FB_TEXT} 2</div></li>
          </ul>
        </div>
      </div>
      <div role="article" aria-label="Comments">
        <ul id="feed-ul">
          <li><a role="link">User One</a><div dir="auto">${FEED_FB_TEXT}</div></li>
          <li><a role="link">User Two</a><div dir="auto">${FEED_FB_TEXT} two</div></li>
        </ul>
      </div>
    `);
    const container = getCommentsContainer('facebook');
    expect(container).not.toBeNull();
    expect(container?.id).toBe('feed-ul');
  });

  it('IG: skips a chat role="log" <article>, still extracts the feed comment', () => {
    // Chat article is FIRST in document order — pre-fix
    // document.querySelector('article') would grab it.
    mount(`
      <div role="log" aria-label="Messages">
        <article>
          <ul><li>
            <a href="/example_contact">example_contact</a>
            <span>${DM_IG_TEXT}</span>
          </li></ul>
        </article>
      </div>
      <article>
        <ul><li>
          <a href="/feed_user">feed_user</a>
          <span>${FEED_IG_TEXT}</span>
        </li></ul>
      </article>
    `);
    const bodies = extractComments('instagram').map((c) => c.text);
    expect(bodies).toContain(FEED_IG_TEXT);
    expect(bodies).not.toContain(DM_IG_TEXT);
  });

  it('IG: getCommentsContainer skips the chat ul[class], returns the feed ul[class]', () => {
    mount(`
      <div role="log" aria-label="Messages">
        <article>
          <ul class="dm-list" id="dm-ul">
            <li><a href="/example_contact">example_contact</a><span>${DM_IG_TEXT}</span></li>
          </ul>
        </article>
      </div>
      <article>
        <ul class="feed-list" id="feed-ul">
          <li><a href="/feed_user">feed_user</a><span>${FEED_IG_TEXT}</span></li>
        </ul>
      </article>
    `);
    const container = getCommentsContainer('instagram');
    expect(container).not.toBeNull();
    expect(container?.id).toBe('feed-ul');
  });
});
