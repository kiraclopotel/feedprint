// Invented items for the envelope tests (src/ai/envelope.ts): one per platform and kind on the item path, and one room per
// platform on the room path. Every name here is made up; NAMES lists each one, so the gate can check none reaches an envelope.

import type { CommentNode, Encounter, PostContent, PostNode } from '../../../src/types/post';

export const NAMES = [
  'maple_writer', 'Maple Writer', 'quoted_oak', 'Oak Person', 'river_fan', 'Rivers', 'cedar_one', 'birch_two', 'pine_three',
  'willow_voice', 'Willow V', 'aspen_reply', 'lark_room', 'Lark Room', 'wren_first', 'finch_second', 'robin_third',
  'heron_ancestor', 'kite_focused', 'swift_child',
];

const dom = new WeakRef({} as HTMLElement);
const at = '2026-10-14T00:00:00.000Z';

function item(fields: Omit<PostContent, 'domRef' | 'timestamp' | 'id'> & { id?: string }): PostContent {
  return { id: 'i1', timestamp: at, domRef: dom, ...fields };
}

export const ITEMS: Record<string, PostContent> = {
  'x post': item({
    platform: 'twitter', kind: 'post', author: 'maple_writer', authorName: 'Maple Writer',
    text: 'A long thread on bus fares, thanks @river_fan for the numbers.', textCapture: 'whole',
    card: { text: 'Oak Person @quoted_oak: fares rose twice', accounts: ['quoted_oak'], quotedBody: 'Fares rose twice this year.', link: { title: 'City budget, explained', domain: 'example.org' } },
    platform_specific: { platform: 'twitter', metrics: { likes: 1200, replies: 85, retweets: 12, views: 40000 } },
  }),
  'x reply': item({
    platform: 'twitter', kind: 'reply', author: 'cedar_one', text: 'Not true, check the budget.', textCapture: 'whole',
    parentText: 'Fares rose twice this year, says @maple_writer.',
    platform_specific: { platform: 'twitter', metrics: { likes: 3 } },
  }),
  'tiktok caption': item({
    platform: 'tiktok', kind: 'video', author: 'willow_voice', authorName: 'Willow V', text: 'day three of learning the violin', textCapture: 'folded',
    mediaUrls: ['https://cdn.example/v1.jpg'],
    context: '• @cedar_one: you got this\n• @birch_two: the second song was better\n• keep going\n• @aspen_reply: fourth one is never shown',
    card: { text: 'original sound - willow_voice', accounts: ['willow_voice'] },
    platform_specific: { platform: 'tiktok', metrics: { likes: 5400, reply_count: 210, shares: 31 } },
  }),
  'tiktok comment': item({
    platform: 'tiktok', kind: 'top-comment', author: 'cedar_one', text: 'you got this', textCapture: 'whole',
    platform_specific: { platform: 'tiktok', metrics: { likes: 1 }, isPinned: true },
  }),
  'instagram caption': item({
    platform: 'instagram', kind: 'post', author: 'lark_room', authorName: 'Lark Room', text: 'Sunday market, too many lemons.\nMore tomorrow.',
    textCapture: 'cut', mediaUrls: ['https://cdn.example/a.jpg', 'https://cdn.example/b.jpg'],
    platform_specific: { platform: 'instagram', metrics: { likes: 900, reply_count: 14 } },
  }),
  'instagram reply': item({
    platform: 'instagram', kind: 'reply', author: 'finch_second', text: '@lark_room which stall?', textCapture: 'whole',
    platform_specific: { platform: 'instagram', metrics: { likes: 2, reply_count: 0 } },
  }),
  'facebook post': item({
    platform: 'facebook', kind: 'post', author: 'robin_third', text: 'Buy two get one free this week only!', textCapture: 'platform', is_sponsored: true,
    platform_specific: { platform: 'facebook', postReactions: 87, postCommentsCount: 4, postShares: 1 },
  }),
  'facebook caption': item({
    platform: 'facebook', kind: 'video', author: 'wren_first', text: 'The bridge at night', textCapture: 'whole',
    platform_specific: { platform: 'facebook', postReactions: 2 },
  }),
  'facebook comment': item({
    platform: 'facebook', kind: 'comment', author: 'birch_two', text: 'Is this still on?',
    platform_specific: { platform: 'facebook', metrics: { likes: 0, reply_count: 2 } },
  }),
  'youtube title': item({
    platform: 'youtube', kind: 'video', author: 'heron_ancestor', text: 'How tides work (in 6 minutes)', textCapture: 'whole',
    platform_specific: { platform: 'youtube', metrics: { likes: 15000 } },
  }),
  'youtube comment': item({
    platform: 'youtube', kind: 'top-comment', author: 'kite_focused', text: 'Clearest one I have seen.',
    platform_specific: { platform: 'youtube', metrics: { likes: 44, reply_count: 1 }, isPinned: false },
  }),
};

function comment(id: string, handle: string, text: string, parent: string, depth: 1 | 2 | 3, extra: Partial<CommentNode> = {}): CommentNode {
  return {
    id, kind: depth === 1 ? 'top-comment' : depth === 2 ? 'reply' : 'reply-to-reply', depth, parent_id: parent, text,
    author: { handle, verified: false, is_pinned_by_creator: false, is_creator_hearted: false },
    metrics: {}, render_state: 'visible-now', fw_marker_present: false, ...extra,
  };
}

function post(id: string, handle: string, text: string, extra: Partial<PostNode> = {}): PostNode {
  return { id, kind: 'post', text, author: { handle, verified: false, is_creator: false }, metrics: {}, ...extra };
}

function room(platform: Encounter['platform'], surface: Encounter['surface'], p: PostNode, children: CommentNode[], extra: Partial<Encounter> = {}): Encounter {
  return { platform, surface, observation_iso: at, encounter_id: `room-${platform}`, post: p, ancestors: [], focused: p, children, ...extra };
}

const harm = { score: 70, top_category: 'ad-hominem' as const, top_evidence: 'liar', signal_categories: ['ad-hominem'], language: 'en' as const, identity_slur_match: false };

export const ROOMS: Record<string, Encounter> = {
  youtube: room('youtube', { kind: 'youtube-watch', video_id: 'yt1' },
    post('yt1', 'heron_ancestor', 'How tides work (in 6 minutes)', { kind: 'video', metrics: { primary_likes: 15000 } }),
    [
      comment('c1', 'wren_first', 'Pinned: thanks all for watching', 'yt1', 1, { author: { handle: 'wren_first', verified: true, is_pinned_by_creator: true, is_creator_hearted: false }, metrics: { likes: 300, reply_count: 1 } }),
      comment('c2', 'finch_second', 'The moon part lost me, @heron_ancestor', 'yt1', 1, { metrics: { likes: 12 }, harm_floor: harm }),
      comment('c3', 'robin_third', 'It is the pull on both sides.', 'c2', 2, { render_state: 'just-rendered-by-expand', expand_event_observed: true }),
    ],
    { comments_total: 2436 }),
  twitter: room('twitter', { kind: 'twitter-permalink', conversation_id: 'x1' },
    post('x1', 'maple_writer', 'Fares rose twice this year.', { metrics: { primary_likes: 50, comments_count: 9, retweets: 4 }, is_quote_tweet: true }),
    [comment('x4', 'swift_child', 'Source?', 'x3', 3, { has_media: false })],
    {}),
  instagram: room('instagram', { kind: 'instagram-post', post_id: 'ig1' },
    post('ig1', 'lark_room', 'Sunday market, too many lemons.', { metrics: { primary_likes: 900, likes_obscured: true, comments_count: 14 }, has_carousel: true }),
    [comment('ig2', 'finch_second', '', 'ig1', 1, { has_media: true })]),
  tiktok: room('tiktok', { kind: 'tiktok-feed', video_id: 'tt1', comment_panel_open: true },
    post('tt1', 'willow_voice', 'day three of learning the violin', { kind: 'video', sound: 'original sound - willow_voice', metrics: { primary_likes: 5400, comments_count: 210, shares: 31 } }),
    [comment('tt2', 'cedar_one', 'you got this', 'tt1', 1, { metrics: { likes: 1 } }), comment('tt3', 'birch_two', 'the second song was better', 'tt1', 1)]),
  facebook: room('facebook', { kind: 'facebook-home-feed', post_id: 'fb1' },
    post('fb1', 'robin_third', 'Buy two get one free this week only!', { is_sponsored: true, metrics: { primary_likes: 87, comments_count: 4, shares: 1 } }),
    [comment('fb2', 'birch_two', 'Is this still on?', 'fb1', 1, { metrics: { reply_count: 2 } })]),
};

// The X permalink's thread above the focused reply.
const xRoom = ROOMS.twitter;
xRoom.ancestors = [comment('x2', 'heron_ancestor', 'Says who, @maple_writer?', 'x1', 1, { metrics: { likes: 7 } })];
xRoom.focused = comment('x3', 'kite_focused', 'The council minutes say so.', 'x2', 2);
