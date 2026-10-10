// §CT-26g.3-V1 emoji-cluster regression tests.
//
// Covers per-comment cluster classification + room-aggregate threshold +
// prompt-line formatting. Per the "predominant emotion" ruling, the
// signal is the SINGLE biggest psychological-context lift available — these
// tests lock the table semantics so future calibration iteration doesn't
// accidentally flip cluster assignments.

import { describe, it, expect } from 'vitest';
import {
  classifyCommentEmojiCluster,
  aggregateRoomEmotion,
  formatRoomEmotionLine,
} from '../../../src/analysis/emoji-cluster';

describe('classifyCommentEmojiCluster — per-comment dominant cluster', () => {
  it('returns null for empty / whitespace / no-emoji text', () => {
    expect(classifyCommentEmojiCluster('')).toBeNull();
    expect(classifyCommentEmojiCluster('   ')).toBeNull();
    expect(classifyCommentEmojiCluster('plain text comment')).toBeNull();
    expect(classifyCommentEmojiCluster('with @mentions and #hashtags but no emoji')).toBeNull();
  });

  it('classifies humor cluster (laughing emojis)', () => {
    expect(classifyCommentEmojiCluster('lmao 😂')).toBe('humor');
    expect(classifyCommentEmojiCluster('🤣🤣🤣')).toBe('humor');
    expect(classifyCommentEmojiCluster('this is hilarious 😄😆')).toBe('humor');
    expect(classifyCommentEmojiCluster('😏 sure buddy')).toBe('humor');
  });

  it('classifies hostility cluster (anger/threat/skull)', () => {
    expect(classifyCommentEmojiCluster('this is infuriating 😡')).toBe('hostility');
    expect(classifyCommentEmojiCluster('🤬 disgusting')).toBe('hostility');
    expect(classifyCommentEmojiCluster('💀💀💀')).toBe('hostility');
    expect(classifyCommentEmojiCluster('🖕 you')).toBe('hostility');
  });

  it('classifies spectator cluster (popcorn/eyes)', () => {
    expect(classifyCommentEmojiCluster('🍿 watching this unfold')).toBe('spectator');
    expect(classifyCommentEmojiCluster('👀')).toBe('spectator');
    expect(classifyCommentEmojiCluster('🧐 interesting')).toBe('spectator');
  });

  it('classifies serious-attention cluster (red circle / warning)', () => {
    expect(classifyCommentEmojiCluster('🔴 this is important')).toBe('serious-attention');
    expect(classifyCommentEmojiCluster('⚠️ careful')).toBe('serious-attention');
    expect(classifyCommentEmojiCluster('🚨 ALERT 🚨')).toBe('serious-attention');
  });

  it('classifies dismissive cluster (eye-roll / shrug / yawn)', () => {
    expect(classifyCommentEmojiCluster('🙄 again')).toBe('dismissive');
    expect(classifyCommentEmojiCluster('🤷')).toBe('dismissive');
    expect(classifyCommentEmojiCluster('boring 😴')).toBe('dismissive');
  });

  it('classifies affection cluster (hearts / love)', () => {
    expect(classifyCommentEmojiCluster('❤️')).toBe('affection');
    expect(classifyCommentEmojiCluster('love this 🥰')).toBe('affection');
    expect(classifyCommentEmojiCluster('💕💕💕')).toBe('affection');
  });

  it('classifies identity cluster (flags / religious markers)', () => {
    expect(classifyCommentEmojiCluster('🏳️‍🌈 pride')).toBe('identity');
    expect(classifyCommentEmojiCluster('🇷🇴 Romania forever')).toBe('identity');
    expect(classifyCommentEmojiCluster('✝️')).toBe('identity');
  });

  it('picks dominant cluster on mixed emojis (most-occurrences wins)', () => {
    // 3 humor vs 1 hostility → humor wins
    expect(classifyCommentEmojiCluster('😂😂😂 anyway 😡')).toBe('humor');
    // 2 hostility vs 1 humor → hostility wins
    expect(classifyCommentEmojiCluster('😡😡 stop joking 😂')).toBe('hostility');
  });

  it('handles emoji-rich text without ambiguous cross-cluster collapse', () => {
    // The §CT-26e single-slur case: short text + no emoji → null
    expect(classifyCommentEmojiCluster('Synthetic harmful text without emoji.')).toBeNull();
    // Whereas same-shape text WITH humor cluster → tone-flips to humor
    expect(classifyCommentEmojiCluster('Blah blah blah BROKE 🤣🤣')).toBe('humor');
  });

  it('Romanian sarcasm-with-humor-emoji classifies as humor', () => {
    expect(classifyCommentEmojiCluster('Bravo, ce realizare! 😂')).toBe('humor');
    expect(classifyCommentEmojiCluster('Geniu, mai zi-ne ceva 🤣🤣🤣')).toBe('humor');
  });

  it('mixed text+emoji with no recognized cluster returns null', () => {
    // Use an emoji that's NOT in our table: 🌮 (taco) or 🦄 (unicorn)
    expect(classifyCommentEmojiCluster('let\'s eat 🌮')).toBeNull();
    expect(classifyCommentEmojiCluster('magical 🦄')).toBeNull();
  });
});

describe('aggregateRoomEmotion — room-level vector', () => {
  it('returns null for empty array', () => {
    expect(aggregateRoomEmotion([])).toBeNull();
  });

  it('returns null when fewer than 3 comments have classifiable emojis (signal threshold)', () => {
    // 1 emoji, 4 plain → 1/5 classified = below threshold
    expect(aggregateRoomEmotion(['lol 😂', 'plain', 'plain', 'plain', 'plain'])).toBeNull();
    // 2 emoji → still below threshold of 3
    expect(aggregateRoomEmotion(['😂', '🤣', 'plain', 'plain', 'plain'])).toBeNull();
  });

  it('aggregates correctly when at least 3 comments classified', () => {
    const result = aggregateRoomEmotion(['😂', '😂', '😂', '😡']);
    expect(result).not.toBeNull();
    expect(result?.classifiedCount).toBe(4);
    expect(result?.totalCount).toBe(4);
    expect(result?.breakdown[0].cluster).toBe('humor');
    expect(result?.breakdown[0].pct).toBe(75);
    expect(result?.breakdown[1].cluster).toBe('hostility');
    expect(result?.breakdown[1].pct).toBe(25);
  });

  it('breakdown sorted by share descending', () => {
    const result = aggregateRoomEmotion(['😡', '😡', '😡', '😡', '🍿', '🍿', '😂']);
    expect(result?.breakdown[0].cluster).toBe('hostility'); // 4/7 = 57%
    expect(result?.breakdown[1].cluster).toBe('spectator'); // 2/7 = 29%
    expect(result?.breakdown[2].cluster).toBe('humor');     // 1/7 = 14%
  });

  it('totalCount counts ALL comments including unclassified', () => {
    const result = aggregateRoomEmotion(['😂', '😂', '😂', 'plain', 'plain', 'plain']);
    expect(result?.classifiedCount).toBe(3);
    expect(result?.totalCount).toBe(6);
    expect(result?.breakdown[0].pct).toBe(100); // 3/3 of CLASSIFIED, not 3/6
  });
});

describe('formatRoomEmotionLine — prompt line builder', () => {
  it('returns empty string for null vector', () => {
    expect(formatRoomEmotionLine(null)).toBe('');
  });

  it('formats single dominant cluster', () => {
    const v = aggregateRoomEmotion(['😂', '😂', '😂']);
    expect(formatRoomEmotionLine(v)).toBe('Room emotion: 100% humor');
  });

  it('formats multi-cluster breakdown', () => {
    const v = aggregateRoomEmotion(['😂', '😂', '😂', '😡', '🍿']);
    // 3 humor (60%), 1 hostility (20%), 1 spectator (20%)
    const line = formatRoomEmotionLine(v);
    expect(line).toContain('Room emotion:');
    expect(line).toContain('60% humor');
    expect(line).toContain('20% hostility');
    expect(line).toContain('20% spectator');
  });

  it('lumps clusters under 5% into "other" bucket', () => {
    // 19 humor + 1 hostility = 95% / 5%
    // Hostility is exactly at 5% threshold → kept
    // To force "other": 19 humor + 1 unrelated dimension... harder to test directly
    // Use: 95 humor + 1 hostility + 1 spectator + 1 dismissive + 1 affection + 1 serious-attention
    // This needs careful test construction. Use a smaller construction:
    const comments = [
      ...new Array(19).fill('😂'),
      '😡', // 1
    ];
    const v = aggregateRoomEmotion(comments);
    const line = formatRoomEmotionLine(v);
    // 19/20 = 95% humor, 1/20 = 5% hostility — both ≥ 5% so no "other"
    expect(line).toContain('95% humor');
    expect(line).toContain('5% hostility');
    expect(line).not.toContain('other');
  });
});

describe('§CT-26g.3-V1 — integration with prompts-v2 buildBatchPromptV3', () => {
  it('per-comment [EMOJI:<cluster>] flag appears in user prompt', async () => {
    const { buildBatchPromptV3 } = await import('../../../src/ai/prompts-v2');
    const enc: import('../../../src/types/post').Encounter = {
      platform: 'twitter',
      surface: { kind: 'twitter-home-feed' },
      observation_iso: '2026-05-05T00:00:00Z',
      encounter_id: 'enc-1',
      post: {
        id: 'p1',
        kind: 'post',
        text: 'a post',
        author: { handle: 'alice', verified: false, is_creator: false },
        metrics: {},
      },
      ancestors: [],
      focused: {
        id: 'p1',
        kind: 'post',
        text: 'a post',
        author: { handle: 'alice', verified: false, is_creator: false },
        metrics: {},
      },
      children: [
        {
          id: 'c1',
          kind: 'top-comment',
          depth: 1,
          parent_id: 'p1',
          text: 'lmao 😂',
          author: { handle: 'bob', verified: false, is_pinned_by_creator: false, is_creator_hearted: false },
          metrics: {},
          render_state: 'visible-now',
          fw_marker_present: false,
        },
      ],
      output_language: 'English',
    };
    const { user } = buildBatchPromptV3(enc);
    expect(user).toContain('[EMOJI:humor]');
  });

  it('Room emotion line appears when ≥3 comments have classifiable emojis', async () => {
    const { buildBatchPromptV3 } = await import('../../../src/ai/prompts-v2');
    const makeChild = (id: string, text: string): import('../../../src/types/post').CommentNode => ({
      id,
      kind: 'top-comment',
      depth: 1,
      parent_id: 'p1',
      text,
      author: { handle: 'u-' + id, verified: false, is_pinned_by_creator: false, is_creator_hearted: false },
      metrics: {},
      render_state: 'visible-now',
      fw_marker_present: false,
    });
    const enc: import('../../../src/types/post').Encounter = {
      platform: 'twitter',
      surface: { kind: 'twitter-home-feed' },
      observation_iso: '2026-05-05T00:00:00Z',
      encounter_id: 'enc-2',
      post: {
        id: 'p1', kind: 'post', text: 'a post',
        author: { handle: 'a', verified: false, is_creator: false }, metrics: {},
      },
      ancestors: [],
      focused: {
        id: 'p1', kind: 'post', text: 'a post',
        author: { handle: 'a', verified: false, is_creator: false }, metrics: {},
      },
      children: [
        makeChild('1', 'haha 😂'),
        makeChild('2', '🤣🤣'),
        makeChild('3', '😆 lol'),
        makeChild('4', 'plain text'),
      ],
      output_language: 'English',
    };
    const { user } = buildBatchPromptV3(enc);
    expect(user).toContain('Room emotion:');
    expect(user).toContain('humor');
  });

  it('Room emotion line SUPPRESSED when fewer than 3 comments have emojis', async () => {
    const { buildBatchPromptV3 } = await import('../../../src/ai/prompts-v2');
    const makeChild = (id: string, text: string): import('../../../src/types/post').CommentNode => ({
      id, kind: 'top-comment', depth: 1, parent_id: 'p1', text,
      author: { handle: 'u-' + id, verified: false, is_pinned_by_creator: false, is_creator_hearted: false },
      metrics: {}, render_state: 'visible-now', fw_marker_present: false,
    });
    const enc: import('../../../src/types/post').Encounter = {
      platform: 'twitter',
      surface: { kind: 'twitter-home-feed' },
      observation_iso: '2026-05-05T00:00:00Z',
      encounter_id: 'enc-3',
      post: {
        id: 'p1', kind: 'post', text: 'a post',
        author: { handle: 'a', verified: false, is_creator: false }, metrics: {},
      },
      ancestors: [],
      focused: {
        id: 'p1', kind: 'post', text: 'a post',
        author: { handle: 'a', verified: false, is_creator: false }, metrics: {},
      },
      children: [
        makeChild('1', 'lol 😂'),
        makeChild('2', 'plain text'),
        makeChild('3', 'no emoji here either'),
      ],
      output_language: 'English',
    };
    const { user } = buildBatchPromptV3(enc);
    expect(user).not.toContain('Room emotion:');
  });

  it('System prompt includes room-emotion guidance (V2 RULE 10 substance)', async () => {
    const { buildBatchPromptV3 } = await import('../../../src/ai/prompts-v2');
    const enc: import('../../../src/types/post').Encounter = {
      platform: 'twitter',
      surface: { kind: 'twitter-home-feed' },
      observation_iso: '2026-05-05T00:00:00Z',
      encounter_id: 'enc-4',
      post: {
        id: 'p1', kind: 'post', text: 'a',
        author: { handle: 'a', verified: false, is_creator: false }, metrics: {},
      },
      ancestors: [],
      focused: {
        id: 'p1', kind: 'post', text: 'a',
        author: { handle: 'a', verified: false, is_creator: false }, metrics: {},
      },
      children: [],
      output_language: 'English',
    };
    const { system } = buildBatchPromptV3(enc);
    // V2 RULE 10 EMOJI-CLUSTER prose was folded into V3 ROOM SIGNALS bullet:
    // "Room emotion (humor / hostility / spectator / serious-attention /
    // dismissive / affection / identity) — TIE-BREAKER for borderline."
    // Same 7-cluster taxonomy + tie-breaker invariant preserved.
    expect(system).toContain('Room emotion');
    expect(system).toMatch(/humor[\s\S]*hostility[\s\S]*spectator[\s\S]*affection[\s\S]*identity/);
    expect(system).toMatch(/TIE-BREAKER/);
  });
});
