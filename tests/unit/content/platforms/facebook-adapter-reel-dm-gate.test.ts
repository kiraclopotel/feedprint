// @vitest-environment jsdom
//
// META-6 (audit swarm-2026-07-13) — the FB Reel side-panel comment path
// (`facebook.ts` reel branch of `extractPosts`, `_extractComments` on the
// `[role="complementary"]` panel) discovers its root filtered only by
// `!findChatOverlayAncestor(candidate)` (the aria-label chat-*dialog*
// check), then walks `[role="article"][aria-label]` inside it with no
// `role="log"` structural gate of its own. If FB ever nests a persistent
// chat/notification surface (`role="log"`) INSIDE a `role="complementary"`
// landmark reachable on a `/reel/` page, those chat bubbles would be
// extracted as if they were genuine Reel comments. This locks that
// `_extractComments` itself refuses any candidate inside a private-chat
// subtree, regardless of what the caller passed in as the scan root.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FacebookAdapter } from '../../../../src/content/platforms/facebook';

const DM_TEXT = 'private chat-log bubble nested inside the reel side panel';
const FEED_TEXT = 'a genuine public comment on the reel side panel';

function setLocation(pathname: string): void {
  Object.defineProperty(window, 'location', {
    value: { hostname: 'www.facebook.com', pathname, search: '', href: `https://www.facebook.com${pathname}` },
    writable: true,
    configurable: true,
  });
}

describe('META-6 — FB Reel side-panel comment extraction excludes nested role="log" bubbles', () => {
  beforeEach(() => { document.body.innerHTML = ''; });
  afterEach(() => { document.body.innerHTML = ''; });

  it('skips a role="log" chat-log comment nested inside the complementary panel, still extracts the genuine sibling comment', () => {
    setLocation('/reel/777');

    document.body.innerHTML = `
      <div role="main">
        <div data-ad-rendering-role="profile_name">Legit Reel Author</div>
      </div>
      <div role="complementary" aria-label="Comments">
        <div role="log" aria-label="Messages in conversation with Chat Partner">
          <div role="article" aria-label="Comment by Chat Partner">
            <div dir="auto">${DM_TEXT}</div>
          </div>
        </div>
        <div role="article" aria-label="Comment by Feed User">
          <div dir="auto">${FEED_TEXT}</div>
        </div>
      </div>
    `;

    const posts = new FacebookAdapter().extractPosts(document.body.childNodes);
    const bodies = posts.map((p) => p.text);

    expect(bodies).toContain(FEED_TEXT);
    expect(bodies).not.toContain(DM_TEXT);
  });
});
