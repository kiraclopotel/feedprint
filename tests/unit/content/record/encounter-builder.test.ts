// @vitest-environment jsdom
//
// §CT-26g.1 (2026-05-04) — runtime Encounter constructor regression.
//
// Locks the `flushBatch` Encounter routing per `.brain/HANDOFF.md` §CT-26g
// first move + closes the live single-slur verification gate at the unit-
// test layer (live-verify on a real Chrome install remains a separate step).
//
// Three concerns:
//   - X-permalink path: walks DOM, builds rich Encounter with ancestors +
//     focused + per-comment metrics from PostContent.platform_specific
//   - Non-permalink fallback: degraded Encounter via encounterFromLegacyBatchInput
//   - Edge cases: empty posts / no tabindex=-1 / mixed platform_specific shapes

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildEncounterForFlushBatch, isCommentChildKind } from '../../../../src/content/record/encounter-builder';
import type { PostContent } from '../../../../src/types/post';

function mount(html: string): void {
  document.body.innerHTML = html;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(() => {
  document.body.innerHTML = '';
});

function makePost(overrides: Partial<PostContent>): PostContent {
  return {
    id: 'p1',
    text: 'sample',
    author: 'alice',
    timestamp: '2026-05-04T00:00:00.000Z',
    platform: 'twitter',
    domRef: new WeakRef({} as HTMLElement),
    ...overrides,
  };
}

describe('§CT-26g.1 — buildEncounterForFlushBatch X-permalink path', () => {
  beforeEach(() => {
    // Synthetic nested-harm page structure: post / grandparent / focused /
    // child. It preserves the hierarchy that originally exposed the bug.
    mount(`
      <div>
        <article role="article" data-testid="tweet">
          <a href="/synthetic_root" role="link"><span>synthetic_root</span></a>
          <a href="/synthetic_root/status/8100000000000000001" role="link"><time datetime="2026-05-04T04:33:00Z">14h</time></a>
          <div data-testid="tweetText" lang="en" dir="ltr">Synthetic root post with video</div>
          <video></video>
          <div data-testid="reply">
            <div data-testid="app-text-transition-container">39</div>
          </div>
          <div data-testid="like">
            <div data-testid="app-text-transition-container">4.4K</div>
          </div>
        </article>
        <article role="article" data-testid="tweet">
          <a href="/synthetic_ancestor" role="link"><span>synthetic_ancestor</span></a>
          <a href="/synthetic_ancestor/status/8100000000000000002" role="link"><time datetime="2026-05-04T11:33:00Z">5h</time></a>
          <div data-testid="tweetText" lang="en" dir="ltr">Synthetic ancestor context</div>
          <div data-testid="reply">
            <div data-testid="app-text-transition-container">4</div>
          </div>
          <div data-testid="like">
            <div data-testid="app-text-transition-container">43</div>
          </div>
        </article>
        <article role="article" data-testid="tweet" tabindex="-1">
          <a href="/synthetic_focus" role="link"><span>synthetic_focus</span></a>
          <a href="/synthetic_focus/status/8100000000000000003" role="link"><time datetime="2026-05-04T13:33:00Z">3h</time></a>
          <div data-testid="tweetText" lang="en" dir="ltr">Synthetic focused insult</div>
          <div data-testid="reply">
            <div data-testid="app-text-transition-container">6</div>
          </div>
          <div data-testid="like">
            <div data-testid="app-text-transition-container">10</div>
          </div>
        </article>
        <article role="article" data-testid="tweet">
          <a href="/synthetic_child_b" role="link"><span>synthetic_child_b</span></a>
          <a href="/synthetic_child_b/status/3002" role="link"><time datetime="2026-05-04T15:33:00Z">1h</time></a>
          <div data-testid="tweetText" lang="en" dir="ltr">Synthetic harmful nested reply</div>
          <div data-testid="like">
            <div data-testid="app-text-transition-container">1</div>
          </div>
        </article>
      </div>
    `);
  });

  it('builds a rich Encounter with post + ancestors + focused + children', () => {
    // bucket.posts: one synthetic child at depth 3.
    const child = makePost({
      id: '3002',
      text: 'Synthetic harmful nested reply',
      author: 'synthetic_child_b',
      kind: 'reply-to-reply',
      depth: 3,
      parent_id: '8100000000000000003',
      platform_specific: {
        platform: 'twitter',
        surfaceKind: 'twitter-permalink',
        verified: false,
        metrics: { likes: 1, replies: 0 },
      },
    });

    const enc = buildEncounterForFlushBatch([child], 'caption', 'English');

    // Surface
    expect(enc.platform).toBe('twitter');
    if (enc.surface.kind === 'twitter-permalink') {
      expect(enc.surface.conversation_id).toBe('8100000000000000001');
    } else {
      throw new Error(`expected twitter-permalink surface, got ${enc.surface.kind}`);
    }

    // Post (depth=0; the original tweet)
    expect(enc.post.id).toBe('8100000000000000001');
    expect(enc.post.author.handle).toBe('synthetic_root');
    expect(enc.post.text).toContain('Synthetic root');
    expect(enc.post.metrics.primary_likes).toBe(4400);
    expect(enc.post.metrics.comments_count).toBe(39);
    expect(enc.post.has_video).toBe(true);

    // Ancestors (synthetic intermediate comment at depth=1)
    expect(enc.ancestors).toHaveLength(1);
    expect(enc.ancestors[0].author.handle).toBe('synthetic_ancestor');
    expect(enc.ancestors[0].depth).toBe(1);
    expect(enc.ancestors[0].kind).toBe('top-comment');
    expect(enc.ancestors[0].metrics.likes).toBe(43);
    expect(enc.ancestors[0].metrics.reply_count).toBe(4);
    expect(enc.ancestors[0].text).toContain('Synthetic ancestor');

    // Focused (the tabindex=-1 synthetic article at depth=2)
    expect('depth' in enc.focused).toBe(true);
    if ('depth' in enc.focused) {
      expect(enc.focused.depth).toBe(2);
      expect(enc.focused.author.handle).toBe('synthetic_focus');
      expect(enc.focused.text).toContain('Synthetic focused');
      expect(enc.focused.parent_id).toBe('8100000000000000002');
    }

    // Children (the bucket.posts mapped to CommentNode)
    expect(enc.children).toHaveLength(1);
    expect(enc.children[0].author.handle).toBe('synthetic_child_b');
    expect(enc.children[0].text).toContain('Synthetic harmful');
    expect(enc.children[0].depth).toBe(3);
    expect(enc.children[0].kind).toBe('reply-to-reply');
    expect(enc.children[0].parent_id).toBe('8100000000000000003');
    expect(enc.children[0].metrics.likes).toBe(1);

    // Output language threaded through
    expect(enc.output_language).toBe('English');
  });

  it('children inherit parent_id from focused when PostContent.parent_id is missing', () => {
    const child = makePost({
      id: 'c1',
      text: 'reply',
      author: 'a',
      // parent_id intentionally missing — DOM walk should fill via focused.id
      platform_specific: {
        platform: 'twitter',
        surfaceKind: 'twitter-permalink',
      },
    });
    const enc = buildEncounterForFlushBatch([child], 'caption', 'English');
    // focused = synthetic_focus per the mounted DOM
    expect(enc.children[0].parent_id).toBe('8100000000000000003');
  });
});

describe('§CT-26g.1 — buildEncounterForFlushBatch fallback paths', () => {
  it('non-permalink surface (home-feed) falls back to legacy degraded Encounter', () => {
    // No tabindex="-1" → walkPermalinkTree returns null context → fallback.
    mount(`
      <article role="article" data-testid="tweet">
        <a href="/A" role="link"><span>A</span></a>
        <div data-testid="tweetText" lang="en" dir="ltr">just a tweet</div>
      </article>
    `);
    const child = makePost({
      id: 'c1',
      text: 'comment',
      author: 'commenter',
      platform_specific: {
        platform: 'twitter',
        surfaceKind: 'twitter-home-feed',
      },
    });
    const enc = buildEncounterForFlushBatch([child], 'caption', 'English');
    // Legacy degraded shape: empty ancestors, post.text=caption, post handle empty.
    expect(enc.ancestors).toEqual([]);
    expect(enc.post.text).toBe('caption');
    expect(enc.post.author.handle).toBe('');
    // Surface defaulted to twitter-home-feed by encounterFromLegacyBatchInput
    expect(enc.surface.kind).toBe('twitter-home-feed');
  });

  it('non-twitter platform (tiktok) falls back to legacy degraded with platform hint', () => {
    const child = makePost({
      id: 'c1',
      text: 'TT comment',
      author: 'tiktoker',
      platform: 'tiktok',
      platform_specific: undefined,
    });
    const enc = buildEncounterForFlushBatch([child], 'tt caption', 'Romanian');
    expect(enc.platform).toBe('tiktok');
    if (enc.surface.kind === 'tiktok-feed') {
      expect(enc.surface.video_id).toBe('legacy');
    } else {
      throw new Error(`expected tiktok-feed surface, got ${enc.surface.kind}`);
    }
    expect(enc.ancestors).toEqual([]);
    expect(enc.output_language).toBe('Romanian');
  });

  it('X-permalink with NO tabindex=-1 in DOM falls through to degraded', () => {
    // Mount articles WITHOUT a tabindex=-1 — buildPermalinkEncounterContext
    // returns null and the builder falls through to legacy.
    mount(`
      <article role="article" data-testid="tweet">
        <a href="/A" role="link"><span>A</span></a>
        <div data-testid="tweetText" lang="en" dir="ltr">no anchor</div>
      </article>
    `);
    const child = makePost({
      id: 'c1',
      text: 'orphan',
      author: 'orphan',
      platform_specific: {
        platform: 'twitter',
        surfaceKind: 'twitter-permalink',
      },
    });
    const enc = buildEncounterForFlushBatch([child], 'caption', 'English');
    // Falls back to legacy — empty ancestors, post text from caption.
    expect(enc.ancestors).toEqual([]);
    expect(enc.post.text).toBe('caption');
  });

  it('empty bucket → legacy empty Encounter (no DOM walk)', () => {
    const enc = buildEncounterForFlushBatch([], 'caption', 'English');
    expect(enc.children).toEqual([]);
    expect(enc.ancestors).toEqual([]);
    expect(enc.post.text).toBe('caption');
  });
});

describe('§CT-26g.2.1 — buildEncounterForFlushBatch URL cohesion guard', () => {
  // Per CODE_REVIEW_CT26F_CT26G1 §"🟠 High #1": if the user navigates
  // between bucket fill and flushBatch debounce, the DOM walk at flush time
  // would tie children-from-permalink-A to post+ancestors-from-permalink-B.
  // Guard: if expectedUrl mismatches window.location.href, fall back to
  // legacy degraded Encounter to preserve VISION §1.1 chain-mirror.
  beforeEach(() => {
    // Mount the single-slur L2 fixture that would otherwise produce a rich
    // X-permalink Encounter. The cohesion guard should reject it because
    // we'll pass an expectedUrl that doesn't match jsdom's actual location.
    document.body.innerHTML = `
      <div>
        <article role="article" data-testid="tweet">
          <a href="/poster" role="link"><span>poster</span></a>
          <a href="/poster/status/100" role="link"><time datetime="2026-05-04T00:00:00Z">14h</time></a>
          <div data-testid="tweetText" lang="en" dir="ltr">post body</div>
        </article>
        <article role="article" data-testid="tweet" tabindex="-1">
          <a href="/focused" role="link"><span>focused</span></a>
          <a href="/focused/status/200" role="link"><time datetime="2026-05-04T01:00:00Z">13h</time></a>
          <div data-testid="tweetText" lang="en" dir="ltr">focused body</div>
        </article>
      </div>
    `;
  });

  it('URL match → rich X-permalink Encounter (guard passes)', () => {
    const child = makePost({
      id: 'c1',
      text: 'reply',
      author: 'commenter',
      platform_specific: {
        platform: 'twitter',
        surfaceKind: 'twitter-permalink',
      },
    });
    // jsdom default location is 'http://localhost/' — match it explicitly.
    const enc = buildEncounterForFlushBatch(
      [child],
      'caption',
      'English',
      window.location.href,
    );
    // Rich path: post.text comes from DOM walk (the mounted "post body"),
    // not from the legacy fallback (which would set post.text='caption').
    expect(enc.post.text).toBe('post body');
    if (enc.surface.kind === 'twitter-permalink') {
      expect(enc.surface.conversation_id).toBe('100');
    } else {
      throw new Error(`expected twitter-permalink surface, got ${enc.surface.kind}`);
    }
  });

  it('URL mismatch → legacy degraded fallback (guard rejects rich path)', () => {
    const child = makePost({
      id: 'c1',
      text: 'reply',
      author: 'commenter',
      platform_specific: {
        platform: 'twitter',
        surfaceKind: 'twitter-permalink',
      },
    });
    // expectedUrl = a permalink that's NOT where jsdom is. Simulates the
    // navigation race: bucket was filled at /a/status/123, flush fires at
    // /b/status/456 (or jsdom default 'http://localhost/').
    const enc = buildEncounterForFlushBatch(
      [child],
      'caption',
      'English',
      'https://x.com/some-other-user/status/9999999999',
    );
    // Legacy degraded shape: post.text=caption, ancestors=[], handle=''.
    expect(enc.post.text).toBe('caption');
    expect(enc.ancestors).toEqual([]);
    expect(enc.post.author.handle).toBe('');
  });

  it('no expectedUrl provided → rich path runs (back-compat path)', () => {
    const child = makePost({
      id: 'c1',
      text: 'reply',
      author: 'commenter',
      platform_specific: {
        platform: 'twitter',
        surfaceKind: 'twitter-permalink',
      },
    });
    // 4th arg omitted — undefined expectedUrl means "no cohesion check".
    // Preserves §CT-26f Phase 1.3 / §CT-26g.1 behavior for callers that
    // haven't been updated to pass the URL.
    const enc = buildEncounterForFlushBatch([child], 'caption', 'English');
    expect(enc.post.text).toBe('post body'); // rich path ran
  });
});

describe('§CT-30 — post.author.handle propagated to rich Encounters (RULE 1 trigger fix)', () => {
  // Live MCP capture on a Facebook politician page URL post-§CT-30 RULE 1 anchor add:
  // comment "Rusinea ar trebui sa fie la tine!!!" still classified as
  // sev=7 / shame-attack. Root cause: assembleFacebookEncounter (and
  // peer assemblers for TT/IG/YT) hardcoded post.author.handle=''.
  // Groq saw post body but no author signal → couldn't infer "post is
  // by a politician" → RULE 1 ("politicians + strong language →
  // genuine-opinion") didn't fire. Per VISION §2.5 "the classifier
  // doesn't get smarter; the CONTEXT does" — propagating the handle
  // gives Groq the signal it needs.
  it('Facebook: post.author.handle = captionPost.author', () => {
    const captionPost = makePost({
      id: 'fb-post-x',
      kind: 'post',
      text: 'Cabinet meeting today...',
      author: 'Example Person',
      platform: 'facebook',
      parentVideoId: 'fb-post-x',
      platform_specific: { platform: 'facebook', surfaceKind: 'facebook-permalink' },
    });
    const comment = makePost({
      id: 'fb-cmt-1',
      kind: 'top-comment',
      text: 'Rusinea ar trebui sa fie la tine',
      author: 'Anonymous Citizen',
      platform: 'facebook',
      parentVideoId: 'fb-post-x',
      platform_specific: { platform: 'facebook', surfaceKind: 'facebook-permalink' },
    });
    const enc = buildEncounterForFlushBatch([captionPost, comment], 'Cabinet meeting today...', 'Romanian');
    expect(enc.post.author.handle).toBe('Example Person');
  });

  it('TikTok: post.author.handle = captionPost.author (kind=video)', () => {
    const captionPost = makePost({
      id: 'tk-vid-x',
      kind: 'video',
      text: 'TikTok caption',
      author: '@creatorhandle',
      platform: 'tiktok',
      parentVideoId: 'tk-vid-x',
      platform_specific: { platform: 'tiktok', surfaceKind: 'tiktok-feed' },
    });
    const comment = makePost({
      id: 'tk-cmt-1',
      kind: 'top-comment',
      text: 'comment text',
      author: '@viewer',
      platform: 'tiktok',
      parentVideoId: 'tk-vid-x',
      platform_specific: { platform: 'tiktok', surfaceKind: 'tiktok-feed' },
    });
    const enc = buildEncounterForFlushBatch([captionPost, comment], 'TikTok caption', 'English');
    expect(enc.post.author.handle).toBe('@creatorhandle');
  });

  it('Instagram: post.author.handle = captionPost.author', () => {
    const captionPost = makePost({
      id: 'ig-post-x',
      kind: 'post',
      text: 'IG caption',
      author: '@iguser',
      platform: 'instagram',
      parentVideoId: 'ig-post-x',
      platform_specific: { platform: 'instagram', surfaceKind: 'instagram-post' },
    });
    const comment = makePost({
      id: 'ig-cmt-1',
      kind: 'top-comment',
      text: 'comment',
      author: '@viewer',
      platform: 'instagram',
      parentVideoId: 'ig-post-x',
      platform_specific: { platform: 'instagram', surfaceKind: 'instagram-post' },
    });
    const enc = buildEncounterForFlushBatch([captionPost, comment], 'IG caption', 'English');
    expect(enc.post.author.handle).toBe('@iguser');
  });

  it('YouTube: post.author.handle = captionPost.author (kind=video)', () => {
    const captionPost = makePost({
      id: 'yt-vid-x',
      kind: 'video',
      text: 'YT description',
      author: '@channel',
      platform: 'youtube',
      parentVideoId: 'yt-vid-x',
      platform_specific: { platform: 'youtube', surfaceKind: 'youtube-watch' },
    });
    const comment = makePost({
      id: 'yt-cmt-1',
      kind: 'top-comment',
      text: 'comment',
      author: '@viewer',
      platform: 'youtube',
      parentVideoId: 'yt-vid-x',
      platform_specific: { platform: 'youtube', surfaceKind: 'youtube-watch' },
    });
    const enc = buildEncounterForFlushBatch([captionPost, comment], 'YT description', 'English');
    expect(enc.post.author.handle).toBe('@channel');
  });
});

// types/post.ts documents 'comment' as a valid backward-compat alias for
// 'top-comment', and every assembler's child filter dropped it. Its own
// docblock claims that silent-drop class was closed by giving NodeKind a shared
// base; it was not — the alias stayed legal and stayed unmatched.
//
// It cost YouTube /watch its whole comment section. yt-watch-comments.ts
// stamped kind:'comment' exactly as documented, every comment fell out of the
// assembler, and scoreBatch was called with zero children: never judged, the
// deterministic harm-floor fallback never run either (it walks the same empty
// list), and each distinct comment text written to the chain as a cancelled
// record naming a Groq model for a call nobody made.
describe("the 'comment' alias is a child, not a dropped post", () => {
  it('isCommentChildKind accepts the alias and the three explicit levels', () => {
    for (const k of ['comment', 'top-comment', 'reply', 'reply-to-reply']) {
      expect(isCommentChildKind(k)).toBe(true);
    }
  });

  it('still says no to a root item or an unknown kind', () => {
    for (const k of ['post', 'video', 'environment', undefined, '']) {
      expect(isCommentChildKind(k)).toBe(false);
    }
  });

  it('a batch of alias-kind comments reaches the encounter as children', () => {
    const kids = ['first comment body', 'second comment body'].map((text, i) =>
      makePost({
        id: `yt-c${i}`,
        text,
        author: `viewer${i}`,
        platform: 'youtube',
        kind: 'comment',
        platform_specific: { platform: 'youtube', surfaceKind: 'youtube-watch' },
      }),
    );
    const enc = buildEncounterForFlushBatch(kids, 'a video title', 'English');
    // Before the fix this was 0, and scoreBatch was handed an empty room.
    expect(enc.children.length).toBe(2);
    expect(enc.children.map(c => c.kind)).toEqual(['top-comment', 'top-comment']);
  });
});
