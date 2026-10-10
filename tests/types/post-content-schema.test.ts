// §CT-25 (2026-05-04) — schema regression for the PostContent extensions.
//
// Per ARCH_TREE_EXTRACTION_2026-05-04 §4 + §8 V1 minimum, types/post.ts grew
// optional fields (`depth`, `parent_id`, `render_state`, `expand_event_observed`,
// `platform_specific`) and 3 new PostKind union members ('top-comment',
// 'reply', 'reply-to-reply'). This test pins the schema so a future edit
// can't quietly drop a field that the forensic chain integrity (VISION §1.1
// corollary B) depends on.
//
// These are TYPE-LEVEL tests — they construct typed PostContent values and
// assert the runtime values round-trip. The Vitest framework treats this as
// a passing assertion when tsc is happy with the literal types. If the
// types/post.ts schema regresses (e.g., a field renamed or removed), the
// test FAILS to compile under tsc, which surfaces in the Vitest run.

import { describe, it, expect } from 'vitest';
import type {
  PostContent,
  PostKind,
  RenderState,
  PlatformSpecificMeta,
  Encounter,
  EncounterPlatform,
  PlatformSurface,
  PostNode,
  CommentNode,
  PostNodeKind,
  CommentNodeKind,
  SortOrder,
  PostMetrics,
  CommentMetrics,
} from '../../src/types/post';

describe('§CT-25 — PostContent schema extensions', () => {
  it('PostKind union includes the new tree-position values', () => {
    const kinds: PostKind[] = [
      'post',
      'video',
      'comment',
      'top-comment',
      'reply',
      'reply-to-reply',
    ];
    // Runtime assertion: every value is a non-empty string.
    for (const k of kinds) {
      expect(typeof k).toBe('string');
      expect(k.length).toBeGreaterThan(0);
    }
  });

  it('RenderState union covers the 6 operational states from ARCH §3', () => {
    const states: RenderState[] = [
      'visible-now',
      'rendered-not-visible',
      'just-rendered-by-expand',
      'scrolled-out',
      'virtualizer-recycled',
      'dom-gone',
    ];
    expect(states).toHaveLength(6);
  });

  it('PlatformSpecificMeta is a discriminated union keyed on platform', () => {
    const samples: PlatformSpecificMeta[] = [
      { platform: 'twitter', conversationId: 'conv1', inReplyToStatusId: 'tw2' },
      { platform: 'tiktok', commentLevel: 1, dataE2eMarker: 'comment-level-1' },
      { platform: 'facebook', threadCommentId: 'fb1', expandedFromPrompt: true },
      { platform: 'instagram', commentLevel: 2, storyContext: false },
      { platform: 'youtube', channelId: 'UC1' },
    ];
    // Every sample carries its platform tag back.
    expect(samples.map(s => s.platform)).toEqual([
      'twitter', 'tiktok', 'facebook', 'instagram', 'youtube',
    ]);
  });

  it('PostContent accepts the new optional fields without breaking back-compat', () => {
    // Pre-§CT-25 minimal PostContent — must still type-check and run.
    const legacy: PostContent = {
      id: 'p1',
      text: 'hello',
      author: '@alice',
      timestamp: '2026-05-04T16:00:00.000Z',
      platform: 'twitter',
      domRef: new WeakRef({} as HTMLElement),
    };
    expect(legacy.depth).toBeUndefined();
    expect(legacy.parent_id).toBeUndefined();
    expect(legacy.render_state).toBeUndefined();

    // §CT-25 extended PostContent — all new fields populated.
    const extended: PostContent = {
      id: 'r3',
      text: 'reply text',
      author: '@bob',
      timestamp: '2026-05-04T16:00:00.000Z',
      platform: 'twitter',
      domRef: new WeakRef({} as HTMLElement),
      kind: 'reply',
      parentVideoId: undefined,
      depth: 2,
      parent_id: 'c1',
      render_state: 'just-rendered-by-expand',
      expand_event_observed: true,
      platform_specific: {
        platform: 'twitter',
        conversationId: 'conv-root-1',
        inReplyToStatusId: 'c1',
      },
    };
    expect(extended.depth).toBe(2);
    expect(extended.parent_id).toBe('c1');
    expect(extended.render_state).toBe('just-rendered-by-expand');
    expect(extended.expand_event_observed).toBe(true);
    expect(extended.platform_specific?.platform).toBe('twitter');
  });

  it('depth is constrained to the V1 tree levels (0..3)', () => {
    // Compile-time assertion via union narrowing — the type allows ONLY
    // 0|1|2|3 per ARCH §4. Anything else would fail tsc.
    const valid: Array<PostContent['depth']> = [undefined, 0, 1, 2, 3];
    for (const d of valid) {
      if (d !== undefined) {
        expect(d).toBeGreaterThanOrEqual(0);
        expect(d).toBeLessThanOrEqual(3);
      }
    }
  });
});

// §CT-26f (2026-05-04) — Encounter schema regression. Pins the BATCH-classifier
// prompt-unit shape per `.brain/PER_PLATFORM_V1_SPEC_2026-05-04.md` §3 and
// `.brain/GROQ_PROMPT_ARCHITECTURE_2026-05-04.md` §1. The forensic chain
// (VISION §1.1 corollary B) and the BATCH classifier both rely on this shape.
describe('§CT-26f — Encounter schema', () => {
  it('EncounterPlatform covers the 5 V1 platforms', () => {
    const platforms: EncounterPlatform[] = [
      'twitter', 'tiktok', 'instagram', 'youtube', 'facebook',
    ];
    expect(platforms).toHaveLength(5);
  });

  it('SortOrder covers FB / X / YT label normalizations', () => {
    const sorts: SortOrder[] = [
      'relevant', 'most_relevant', 'newest', 'top', 'all', 'liked',
    ];
    expect(sorts).toHaveLength(6);
  });

  it('PostNodeKind covers the emitted V1 post variants', () => {
    const kinds: PostNodeKind[] = ['post', 'video', 'reel', 'short'];
    expect(kinds).toHaveLength(4);
  });

  it('CommentNodeKind narrows depth to 1..3', () => {
    const kinds: CommentNodeKind[] = ['top-comment', 'reply', 'reply-to-reply'];
    expect(kinds).toHaveLength(3);
  });

  it('PlatformSurface is a discriminated union — every variant carries kind', () => {
    const surfaces: PlatformSurface[] = [
      { kind: 'twitter-permalink', conversation_id: 'conv-1' },
      { kind: 'twitter-home-feed' },
      { kind: 'twitter-photo-modal', tweet_id: 't1', photo_index: 0 },
      { kind: 'tiktok-feed', video_id: 'v1', comment_panel_open: true },
      { kind: 'tiktok-permalink', video_id: 'v2' },
      { kind: 'instagram-post', post_id: 'p1' },
      { kind: 'instagram-post', post_id: 'p2', carousel_index: 1 },
      { kind: 'instagram-reel', reel_id: 'r1' },
      { kind: 'instagram-story', story_id: 's1' },
      { kind: 'youtube-watch', video_id: 'yt1' },
      { kind: 'youtube-shorts', video_id: 'sh1' },
      { kind: 'facebook-permalink', post_id: 'fb1' },
      { kind: 'facebook-home-feed', post_id: 'fb2' },
      { kind: 'facebook-reel', reel_id: 'fbr1' },
      { kind: 'facebook-photo-modal', post_id: 'fb3', photo_id: 'ph1' },
    ];
    for (const s of surfaces) {
      expect(typeof s.kind).toBe('string');
      expect(s.kind.length).toBeGreaterThan(0);
    }
  });

  it('PostMetrics + CommentMetrics keep all fields optional (V1 partial captures round-trip)', () => {
    const empty: PostMetrics = {};
    expect(empty).toEqual({});
    const full: PostMetrics = {
      primary_likes: 100,
      likes_obscured: false,
      retweets: 5,
      quote_tweets: 1,
      bookmarks: 12,
      views: 5000,
      shares: 3,
      comments_count: 42,
      reactions_profile: { angry: 30, like: 10 },
    };
    expect(full.primary_likes).toBe(100);
    expect(full.reactions_profile?.angry).toBe(30);

    const cmEmpty: CommentMetrics = {};
    expect(cmEmpty).toEqual({});
    const cmFull: CommentMetrics = { likes: 5, reply_count: 2, views: 100 };
    expect(cmFull.reply_count).toBe(2);
  });

  it('PostNode requires id/kind/text/author/metrics; rest optional', () => {
    const minimal: PostNode = {
      id: 'p1',
      kind: 'post',
      text: 'hello',
      author: { handle: 'alice', verified: false, is_creator: false },
      metrics: {},
    };
    expect(minimal.id).toBe('p1');
    expect(minimal.author.handle).toBe('alice');
    expect(minimal.author.is_creator).toBe(false);

    const full: PostNode = {
      id: 'p2',
      kind: 'video',
      text: 'caption',
      author: { handle: 'creator', display_name: 'Creator Name', verified: true, is_creator: true },
      age_iso: '2026-05-04T12:00:00.000Z',
      age_relative: '5h',
      metrics: { primary_likes: 1000, comments_count: 50 },
      community_notes_present: false,
      is_quote_tweet: false,
      has_video: true,
      hashtags: ['#fyp'],
      sound: 'original sound - creator',
    };
    expect(full.has_video).toBe(true);
    expect(full.hashtags?.[0]).toBe('#fyp');
  });

  it('CommentNode pins depth to 1..3 with kind alignment + chain-mirror fields', () => {
    const top: CommentNode = {
      id: 'c1',
      kind: 'top-comment',
      depth: 1,
      parent_id: 'p1',
      text: 'top reply',
      author: {
        handle: 'bob',
        verified: false,
        is_pinned_by_creator: false,
        is_creator_hearted: true,
      },
      metrics: { likes: 5 },
      render_state: 'visible-now',
      fw_marker_present: false,
    };
    const reply: CommentNode = {
      id: 'c2',
      kind: 'reply',
      depth: 2,
      parent_id: 'c1',
      text: 'reply',
      author: { handle: 'carol', verified: false, is_pinned_by_creator: false, is_creator_hearted: false },
      metrics: {},
      render_state: 'just-rendered-by-expand',
      fw_marker_present: false,
      expand_event_observed: true,
    };
    const r2r: CommentNode = {
      id: 'c3',
      kind: 'reply-to-reply',
      depth: 3,
      parent_id: 'c2',
      text: 'r2r',
      author: { handle: 'dave', verified: true, is_pinned_by_creator: false, is_creator_hearted: false },
      metrics: {},
      render_state: 'visible-now',
      fw_marker_present: true,
      mentions: ['@bob'],
      has_media: false,
    };
    expect(top.depth).toBe(1);
    expect(reply.depth).toBe(2);
    expect(r2r.depth).toBe(3);
    expect(reply.expand_event_observed).toBe(true);
    expect(r2r.mentions?.[0]).toBe('@bob');
  });

  it('Encounter wires post + ancestors + focused + children (X-permalink case populates ancestors)', () => {
    const post: PostNode = {
      id: 'tw-root',
      kind: 'video',
      text: 'Synthetic root post with video',
      author: { handle: 'synthetic_root', verified: false, is_creator: false },
      metrics: { primary_likes: 4400, retweets: 71, comments_count: 39, views: 629900, bookmarks: 423 },
      has_video: true,
    };
    const grandparent: CommentNode = {
      id: 'c-l0',
      kind: 'top-comment',
      depth: 1,
      parent_id: 'tw-root',
      text: 'Synthetic ancestor context',
      author: { handle: 'synthetic_ancestor', verified: false, is_pinned_by_creator: false, is_creator_hearted: false },
      metrics: { likes: 43, reply_count: 4 },
      render_state: 'rendered-not-visible',
      fw_marker_present: true,
    };
    const focused: CommentNode = {
      id: 'c-l1',
      kind: 'reply',
      depth: 2,
      parent_id: 'c-l0',
      text: 'Synthetic focused insult',
      author: { handle: 'synthetic_focus', verified: false, is_pinned_by_creator: false, is_creator_hearted: false },
      metrics: { likes: 10, reply_count: 6 },
      render_state: 'visible-now',
      fw_marker_present: true,
    };
    const child: CommentNode = {
      id: 'c-l2-broke',
      kind: 'reply-to-reply',
      depth: 3,
      parent_id: 'c-l1',
      text: 'Synthetic harmful nested reply',
      author: { handle: 'synthetic_child_b', verified: false, is_pinned_by_creator: false, is_creator_hearted: false },
      metrics: { likes: 1, reply_count: 0 },
      render_state: 'visible-now',
      fw_marker_present: false,
    };
    const enc: Encounter = {
      platform: 'twitter',
      surface: { kind: 'twitter-permalink', conversation_id: 'tw-root' },
      observation_iso: '2026-05-04T16:30:00.000Z',
      encounter_id: 'enc-001',
      post,
      ancestors: [grandparent],
      focused,
      children: [child],
      sort_order: 'relevant',
      output_language: 'English',
    };
    expect(enc.platform).toBe('twitter');
    if (enc.surface.kind === 'twitter-permalink') {
      expect(enc.surface.conversation_id).toBe('tw-root');
    }
    expect(enc.ancestors).toHaveLength(1);
    expect(enc.ancestors[0].depth).toBe(1);
    if ('depth' in enc.focused) {
      expect(enc.focused.depth).toBe(2);
    }
    expect(enc.children[0].text).toContain('Synthetic harmful');
    expect(enc.output_language).toBe('English');
  });

  it('Encounter for non-X surfaces leaves ancestors empty and focused === post', () => {
    const post: PostNode = {
      id: 'tt-vid-1',
      kind: 'video',
      text: 'caption',
      author: { handle: 'creator', verified: true, is_creator: true },
      metrics: { primary_likes: 50600, comments_count: 1010, shares: 2849 },
      hashtags: ['#fyp'],
      sound: 'original',
    };
    const top: CommentNode = {
      id: 'tt-c1',
      kind: 'top-comment',
      depth: 1,
      parent_id: 'tt-vid-1',
      text: 'first',
      author: { handle: 'viewer', verified: false, is_pinned_by_creator: false, is_creator_hearted: false },
      metrics: { likes: 200 },
      render_state: 'visible-now',
      fw_marker_present: false,
    };
    const enc: Encounter = {
      platform: 'tiktok',
      surface: { kind: 'tiktok-feed', video_id: 'tt-vid-1', comment_panel_open: true },
      observation_iso: '2026-05-04T16:31:00.000Z',
      encounter_id: 'enc-002',
      post,
      ancestors: [],
      focused: post,
      children: [top],
    };
    expect(enc.ancestors).toEqual([]);
    expect(enc.focused).toBe(enc.post);
    expect(enc.output_language).toBeUndefined();
  });
});
