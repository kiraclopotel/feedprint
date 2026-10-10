// @vitest-environment jsdom
//
// E3 — the FB Reel branch of `extractPosts` gated the synthesized
// `fb-vid-<id>` caption record behind `_reelCommentDiagFired`, an
// instance-level one-shot boolean that was never reset on SPA navigation.
// Only the FIRST reel of a session got a video record; every later reel
// emitted comments whose parentVideoId pointed at a video node that was
// never pushed — orphaned chain nodes contradicting the chain-mirror
// invariant (VISION §1.1) the reel branch exists to uphold. This locks:
// each distinct reel id emits its video record exactly once, and re-scans
// of the same reel (MutationObserver re-entry) do not duplicate it.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FacebookAdapter } from '../../../../src/content/platforms/facebook';

function setLocation(pathname: string): void {
  Object.defineProperty(window, 'location', {
    value: { hostname: 'www.facebook.com', pathname, search: '', href: `https://www.facebook.com${pathname}` },
    writable: true,
    configurable: true,
  });
}

function mountReelPanel(commentAuthor: string, commentText: string): void {
  document.body.innerHTML = `
    <div role="main">
      <div data-ad-rendering-role="profile_name">Reel Author</div>
    </div>
    <div role="complementary" aria-label="Comments">
      <div role="article" aria-label="Comment by ${commentAuthor}">
        <div dir="auto">${commentText}</div>
      </div>
    </div>
  `;
}

describe('E3 — FB Reel video record emitted once per distinct reel across SPA navigation', () => {
  beforeEach(() => { document.body.innerHTML = ''; });
  afterEach(() => { document.body.innerHTML = ''; });

  it('emits a video record for the second reel of a session, not just the first', () => {
    const adapter = new FacebookAdapter();

    // Reel 1: session starts on /reel/111.
    setLocation('/reel/111');
    mountReelPanel('First Commenter', 'comment on the first reel');
    const first = adapter.extractPosts(document.body.childNodes);

    expect(first.filter((p) => p.id === 'fb-vid-111' && p.kind === 'video')).toHaveLength(1);

    // SPA navigation to /reel/222 — Facebook re-renders the side panel.
    setLocation('/reel/222');
    mountReelPanel('Second Commenter', 'comment on the second reel');
    const second = adapter.extractPosts(document.body.childNodes);

    // The second reel's comments reference parentVideoId '222'…
    const secondComments = second.filter((p) => p.id.startsWith('fb-cmt-222-'));
    expect(secondComments.length).toBeGreaterThan(0);
    expect(secondComments.every((p) => p.parentVideoId === '222')).toBe(true);
    // …so its video record must exist in the same extraction (chain-mirror).
    expect(second.filter((p) => p.id === 'fb-vid-222' && p.kind === 'video')).toHaveLength(1);
  });

  it('does not duplicate the video record on a re-scan of the same reel', () => {
    const adapter = new FacebookAdapter();

    setLocation('/reel/333');
    mountReelPanel('Only Commenter', 'comment on the only reel');
    const firstScan = adapter.extractPosts(document.body.childNodes);
    // MutationObserver re-entry on the same mounted panel.
    const secondScan = adapter.extractPosts(document.body.childNodes);

    const videoRecords = [...firstScan, ...secondScan].filter((p) => p.id === 'fb-vid-333');
    expect(videoRecords).toHaveLength(1);
  });
});
