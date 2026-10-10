// §CT-26h (2026-05-05) — per-comment harm-floor pre-classification.
//
// Tests the V1.5 slice that adds Layer-1 (per-comment harm-floor compute) +
// Layer-2 (aggregate room-toxicity score, slur-prevalence, author-recidivism,
// discourse-quality) to the comment-batch path BEFORE the BATCH classifier
// runs. Per `feedback_per_platform_metrics_aware_batch_design`: the
// classifier doesn't get smarter, the input does.
//
// Three concerns covered:
//   1. PROMPT — `buildBatchPromptV3` emits `[HF:N category]` flag in
//      `buildCommentLine` when `c.harm_floor.score >= 30`; RULE 12 present
//      in system prompt.
//   2. AGGREGATE — `BatchEnvironment` carries toxicityScore /
//      slurPrevalencePct / authorRecidivism / discourseQuality.
//   3. FAILCLOSED — when Groq fails, harm-floor score grounds severity
//      instead of silent 'none/sev=0' default.

import { describe, it, expect } from 'vitest';
import { buildBatchPromptV3 } from '../../../src/ai/prompts-v2';
import type {
  Encounter,
  PostNode,
  CommentNode,
  CommentHarmFloor,
} from '../../../src/types/post';

// ─── Fixture helpers ─────────────────────────────────────────────────────

function postNode(overrides: Partial<PostNode> = {}): PostNode {
  return {
    id: 'p1',
    kind: 'post',
    text: 'sample post',
    author: { handle: 'creator', verified: false, is_creator: false },
    metrics: {},
    ...overrides,
  };
}

function commentNode(overrides: Partial<CommentNode> = {}): CommentNode {
  return {
    id: 'c1',
    kind: 'top-comment',
    depth: 1,
    parent_id: 'p1',
    text: 'sample comment',
    author: {
      handle: 'commenter',
      verified: false,
      is_pinned_by_creator: false,
      is_creator_hearted: false,
    },
    metrics: {},
    render_state: 'visible-now',
    fw_marker_present: false,
    ...overrides,
  };
}

function encounter(overrides: Partial<Encounter> = {}): Encounter {
  const post = overrides.post ?? postNode();
  return {
    platform: 'twitter',
    surface: { kind: 'twitter-home-feed' },
    observation_iso: '2026-05-05T00:00:00.000Z',
    encounter_id: 'enc-hf-test',
    post,
    ancestors: [],
    focused: post,
    children: [commentNode()],
    ...overrides,
  };
}

const HF_HIGH_PROFANITY: CommentHarmFloor = {
  score: 65,
  top_category: 'profanity',
  top_evidence: '2 profanity tokens (fuck)',
  signal_categories: ['profanity', 'ad-hominem'],
  language: 'en',
  identity_slur_match: false,
};

const HF_LOW: CommentHarmFloor = {
  score: 12,
  top_category: 'profanity',
  top_evidence: '1 profanity token',
  signal_categories: ['profanity'],
  language: 'en',
  identity_slur_match: false,
};

// ─── Concern 1: PROMPT carries [HF:N category] flag ──────────────────────

describe('§CT-26h prompt: [HF:N category] per-comment flag', () => {
  it('emits [HF:65 profanity] when harm_floor.score >= 30', () => {
    const c = commentNode({ harm_floor: HF_HIGH_PROFANITY, text: 'fuck this stuff' });
    const enc = encounter({ children: [c] });
    const { user } = buildBatchPromptV3(enc);
    expect(user).toMatch(/\[HF:65 profanity\]/);
  });

  it('omits HF flag when harm_floor.score < 30', () => {
    const c = commentNode({ harm_floor: HF_LOW, text: 'ah dang' });
    const enc = encounter({ children: [c] });
    const { user } = buildBatchPromptV3(enc);
    expect(user).not.toMatch(/\[HF:/);
  });

  it('omits HF flag when harm_floor is absent (back-compat with pre-§CT-26h Encounters)', () => {
    const c = commentNode({ harm_floor: undefined, text: 'normal comment' });
    const enc = encounter({ children: [c] });
    const { user } = buildBatchPromptV3(enc);
    expect(user).not.toMatch(/\[HF:/);
  });

  it('top_category falls back to "mixed" when undefined', () => {
    const c = commentNode({
      harm_floor: {
        score: 45,
        signal_categories: [],
        language: 'en',
        identity_slur_match: false,
      },
      text: 'something',
    });
    const enc = encounter({ children: [c] });
    const { user } = buildBatchPromptV3(enc);
    expect(user).toMatch(/\[HF:45 mixed\]/);
  });

  it('HF flag composes alongside other flags ([VERIFIED] [PINNED] [HF:...])', () => {
    const c = commentNode({
      author: {
        handle: 'admin',
        verified: true,
        is_pinned_by_creator: true,
        is_creator_hearted: false,
      },
      harm_floor: HF_HIGH_PROFANITY,
      text: 'fuck',
    });
    const enc = encounter({ children: [c] });
    const { user } = buildBatchPromptV3(enc);
    // Order is: VERIFIED PINNED CREATOR-HEARTED EDITED EMOJI HF
    expect(user).toMatch(/\[VERIFIED\][^"]*\[PINNED\][^"]*\[HF:65 profanity\]/);
  });
});

// ─── Concern 2: harm-floor signal present in system prompt ──────────────

describe('§CT-26h system prompt: harm-floor signal cross-reference', () => {
  it('system prompt names [HF:N category] as code-side enrichment evidence', () => {
    const enc = encounter({ children: [commentNode()] });
    const { system } = buildBatchPromptV3(enc);
    // V2 RULE 12 prose was folded into the V3 ROOM SIGNALS section. The HF
    // flag is named with the same structural invariant: LLM reads it as
    // evidence; code-side enrichment adjudicates the slur-floor escalation.
    expect(system).toMatch(/\[HF:N category\]/);
    expect(system).toMatch(/identity-slur match enforced code-side/);
    expect(system).toMatch(/code will escalate severity/);
  });

  it('HF cross-reference frames metadata as evidence, not directive', () => {
    const enc = encounter({ children: [commentNode()] });
    const { system } = buildBatchPromptV3(enc);
    // V3 ROOM SIGNALS bullet: "[HF:N category] flag on a comment = identity-
    // slur match enforced code-side post-LLM. Classify the comment per the
    // rules above; code will escalate severity if your verdict misses a
    // confirmed slur." Same invariant as V2 RULE 12 — LLM classifies per
    // the standard rules; HF is metadata, not a directive.
    expect(system).toMatch(/Classify the comment per the rules above/);
    expect(system).toMatch(/post-LLM/);
  });
});
