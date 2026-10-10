// §CT-27 (2026-05-05) — pre-LLM room signals + chain payload extension.
//
// Tests:
//   1. PROMPT — `[POST_ENVIRONMENT]` block carries `Algorithmic amplification:
//      ...` line + `Author recidivism: ...` line when triggers met.
//   2. SYSTEM PROMPT — RULE 13 (author-recidivism) + RULE 14 (algorithmic
//      amplification) added with calibration text.
//   3. SCORER — `BatchScoreResult.environment.algorithmicAmplification` set
//      from views/likes ratio derivation; `commentHarmFloors` parallel array
//      populated index-aligned with comments.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildBatchPromptV3, type PreLlmRoomSignals } from '../../../src/ai/prompts-v2';
import type {
  Encounter,
  PostNode,
  CommentNode,
} from '../../../src/types/post';

vi.mock('../../../src/ai/client', () => ({
  callAI: vi.fn(),
}));

import {
  scoreBatch,
  encounterFromLegacyBatchInput,
  __resetBatchCacheForTests,
} from '../../../src/analysis/comment-batch-scorer';
import { callAI } from '../../../src/ai/client';
import { Ok } from '../../../src/ai/ai-error';

const mockCallAI = callAI as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockCallAI.mockReset();
  __resetBatchCacheForTests();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

const llmJson = (comments: unknown[], envOverride: Record<string, unknown> = {}) =>
  Ok(JSON.stringify({
    comments,
    environment: { label: 'healthy-discussion', summary: 'test', ...envOverride },
  }));

// ─── Fixture helpers ─────────────────────────────────────────────────────

function postNode(overrides: Partial<PostNode> = {}): PostNode {
  return {
    id: 'p1',
    kind: 'post',
    text: 'sample',
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
    text: 'sample',
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
    encounter_id: 'enc-test',
    post,
    ancestors: [],
    focused: post,
    children: [commentNode()],
    ...overrides,
  };
}

// ─── Concern 1: PROMPT carries new room-signal lines ─────────────────────

describe('§CT-27 prompt: [POST_ENVIRONMENT] room-signal lines', () => {
  it('emits "Algorithmic amplification: HIGH" when ratio > 100', () => {
    const enc = encounter();
    const signals: PreLlmRoomSignals = {
      toxicityScore: 0,
      slurPrevalencePct: 0,
      authorRecidivism: 1,
      algorithmicAmplification: 'high',
    };
    const { user } = buildBatchPromptV3(enc, signals);
    expect(user).toMatch(/Algorithmic amplification: HIGH/);
  });

  it('emits "Algorithmic amplification: LOW" for low ratio', () => {
    const enc = encounter();
    const signals: PreLlmRoomSignals = {
      toxicityScore: 0,
      slurPrevalencePct: 0,
      authorRecidivism: 1,
      algorithmicAmplification: 'low',
    };
    const { user } = buildBatchPromptV3(enc, signals);
    expect(user).toMatch(/Algorithmic amplification: LOW/);
  });

  it('omits algorithmic-amplification line when "unknown"', () => {
    const enc = encounter();
    const signals: PreLlmRoomSignals = {
      toxicityScore: 0,
      slurPrevalencePct: 0,
      authorRecidivism: 1,
      algorithmicAmplification: 'unknown',
    };
    const { user } = buildBatchPromptV3(enc, signals);
    expect(user).not.toMatch(/Algorithmic amplification:/);
  });

  it('emits "Author recidivism: N comments" when authorRecidivism >= 3', () => {
    const enc = encounter();
    const signals: PreLlmRoomSignals = {
      toxicityScore: 0,
      slurPrevalencePct: 0,
      authorRecidivism: 4,
      algorithmicAmplification: 'normal',
    };
    const { user } = buildBatchPromptV3(enc, signals);
    expect(user).toMatch(/Author recidivism: 4 comments by single author/);
  });

  it('omits author-recidivism line when authorRecidivism < 3', () => {
    const enc = encounter();
    const signals: PreLlmRoomSignals = {
      toxicityScore: 0,
      slurPrevalencePct: 0,
      authorRecidivism: 2,
      algorithmicAmplification: 'normal',
    };
    const { user } = buildBatchPromptV3(enc, signals);
    expect(user).not.toMatch(/Author recidivism:/);
  });

  it('omits both lines when no roomSignals passed (back-compat)', () => {
    const enc = encounter();
    const { user } = buildBatchPromptV3(enc);
    expect(user).not.toMatch(/Algorithmic amplification:/);
    expect(user).not.toMatch(/Author recidivism:/);
  });
});

// ─── Concern 2: System prompt carries author-recidivism + amplification signals ──

describe('§CT-27 system prompt: author-recidivism + algorithmic-amplification signals', () => {
  it('author-recidivism N≥3 pile-on signal present in ROOM SIGNALS', () => {
    const enc = encounter();
    const { system } = buildBatchPromptV3(enc);
    // V2 RULE 13 prose was folded into V3 ROOM SIGNALS section bullet:
    // "Author recidivism (N comments by single author, N≥3) = pile-on-
    // contributor signal." Invariant preserved: recidivism is named, N≥3
    // threshold matches the user-prompt emit condition.
    expect(system).toMatch(/Author recidivism/);
    expect(system).toMatch(/N≥3/);
    expect(system).toMatch(/pile-on-contributor signal/);
  });

  it('algorithmic-amplification room-label-only invariant present', () => {
    const enc = encounter();
    const { system } = buildBatchPromptV3(enc);
    // V2 RULE 14 prose was folded into V3 ROOM SIGNALS section bullet:
    // "Algorithmic amplification (high / low) = affects ROOM label only,
    // never per-comment severity." The preserved invariant — routing ≠
    // per-comment severity elevation — is named verbatim.
    expect(system).toMatch(/Algorithmic amplification/);
    expect(system).toMatch(/affects ROOM label only, never per-comment severity/);
  });
});

// ─── Concern 3: scoreBatch emits algorithmicAmplification + commentHarmFloors ──

describe('§CT-27 scoreBatch: room-amplification + commentHarmFloors parallel array', () => {
  it('algorithmicAmplification = "high" when views/likes > 100', async () => {
    mockCallAI.mockResolvedValue(
      llmJson([
        { index: 1, technique: 'genuine-opinion', sentiment: 'neutral', severity: 1, reason: '' },
      ]),
    );
    const enc: Encounter = {
      platform: 'twitter',
      surface: { kind: 'twitter-home-feed' },
      observation_iso: '2026-05-05T00:00:00.000Z',
      encounter_id: 'enc-amp',
      post: postNode({ metrics: { primary_likes: 10, views: 5000 } }), // 500:1 ratio
      ancestors: [],
      focused: postNode(),
      children: [commentNode()],
    };
    const result = await scoreBatch(enc);
    expect(result.environment.algorithmicAmplification).toBe('high');
  });

  it('algorithmicAmplification = "low" when views/likes < 30', async () => {
    mockCallAI.mockResolvedValue(
      llmJson([
        { index: 1, technique: 'supportive', sentiment: 'positive', severity: 1, reason: '' },
      ]),
    );
    const enc: Encounter = {
      platform: 'twitter',
      surface: { kind: 'twitter-home-feed' },
      observation_iso: '2026-05-05T00:00:00.000Z',
      encounter_id: 'enc-low',
      post: postNode({ metrics: { primary_likes: 100, views: 500 } }), // 5:1 ratio
      ancestors: [],
      focused: postNode(),
      children: [commentNode()],
    };
    const result = await scoreBatch(enc);
    expect(result.environment.algorithmicAmplification).toBe('low');
  });

  it('algorithmicAmplification = "normal" for typical engagement', async () => {
    mockCallAI.mockResolvedValue(
      llmJson([
        { index: 1, technique: 'genuine-opinion', sentiment: 'neutral', severity: 1, reason: '' },
      ]),
    );
    const enc: Encounter = {
      platform: 'twitter',
      surface: { kind: 'twitter-home-feed' },
      observation_iso: '2026-05-05T00:00:00.000Z',
      encounter_id: 'enc-norm',
      post: postNode({ metrics: { primary_likes: 100, views: 5000 } }), // 50:1 ratio
      ancestors: [],
      focused: postNode(),
      children: [commentNode()],
    };
    const result = await scoreBatch(enc);
    expect(result.environment.algorithmicAmplification).toBe('normal');
  });

  it('algorithmicAmplification = "unknown" when views or likes missing', async () => {
    mockCallAI.mockResolvedValue(
      llmJson([
        { index: 1, technique: 'genuine-opinion', sentiment: 'neutral', severity: 1, reason: '' },
      ]),
    );
    const enc = encounterFromLegacyBatchInput({
      comments: [{ author: 'a', text: 'sample' }],
      videoCaption: 'c',
      language: 'English',
    });
    const result = await scoreBatch(enc);
    expect(result.environment.algorithmicAmplification).toBe('unknown');
  });

  it('commentHarmFloors index-aligned with comments[]', async () => {
    mockCallAI.mockResolvedValue(
      llmJson([
        { index: 1, technique: 'shame-attack', sentiment: 'negative', severity: 8, reason: 'x' },
        { index: 2, technique: 'genuine-opinion', sentiment: 'neutral', severity: 1, reason: '' },
      ]),
    );
    const enc = encounterFromLegacyBatchInput({
      comments: [
        { author: 'a', text: 'fucking nigger retard' },     // high HF
        { author: 'b', text: 'a normal benign comment' },   // 0 HF
      ],
      videoCaption: 'c',
      language: 'English',
    });
    const result = await scoreBatch(enc);
    expect(result.commentHarmFloors).toHaveLength(2);
    // Slot 0 — high-HF text → harm_floor populated
    expect(result.commentHarmFloors[0]).toBeDefined();
    expect(result.commentHarmFloors[0]?.score).toBeGreaterThan(0);
    expect(result.commentHarmFloors[0]?.identity_slur_match).toBe(true);
    // Slot 1 — benign text → harm_floor undefined (zero signal)
    expect(result.commentHarmFloors[1]).toBeUndefined();
  });

  it('failClosed result preserves commentHarmFloors + algorithmicAmplification', async () => {
    mockCallAI.mockRejectedValue(new Error('groq down'));
    const enc: Encounter = {
      platform: 'twitter',
      surface: { kind: 'twitter-home-feed' },
      observation_iso: '2026-05-05T00:00:00.000Z',
      encounter_id: 'enc-failed',
      post: postNode({ metrics: { primary_likes: 5, views: 1000 } }), // ratio 200 = 'high'
      ancestors: [],
      focused: postNode(),
      children: [
        commentNode({ text: 'fucking nigger retard psycho idiot' }),
      ],
    };
    const result = await scoreBatch(enc);
    expect(result.failed).toBe(true);
    expect(result.environment.algorithmicAmplification).toBe('high');
    expect(result.commentHarmFloors[0]).toBeDefined();
    expect(result.commentHarmFloors[0]?.identity_slur_match).toBe(true);
    expect(result.comments[0].severity).toBeGreaterThanOrEqual(7);
  });
});
