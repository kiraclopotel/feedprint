// §CT-24 (2026-05-04) — orchestration tests for `scoreBatch`.
//
// Per CODE_REVIEW_CT18_V2_BATCH §"🟡 Medium #6": before §CT-24 the only
// scoreBatch coverage was prompt-content (comment-batch-scorer-prompt.test.ts).
// The orchestration — parse + validate + aggregate + truncation detection —
// had ZERO unit tests. This file closes that gap.
//
// Test pyramid placement: unit tests. The network boundary (`callAI`) is
// mocked via vi.mock so we exercise the deterministic logic in isolation.
//
// Coverage:
//   Failure paths (forensic-chain integrity per VISION §1.1):
//     - empty input → failClosed
//     - callAI throws → failClosed
//     - callAI returns '' → failClosed
//     - parseJSON returns null (raw is unparseable) → failClosed
//     - parseJSON returns object missing comments array → failClosed
//     - parseJSON returns object missing environment → failClosed
//   Per-comment normalization (whitelists + clamps):
//     - invalid technique → 'none'
//     - valid technique → preserved
//     - severity NaN / Infinity / >10 / negative → clamped [0,10]
//     - sentiment outside enum → 'neutral'
//     - reason >280 chars → sliced
//   §CT-24 truncation detection:
//     - partial parsed.comments → truncatedIndices populated
//     - all-present → truncatedIndices = []
//   Aggregate computation (self-derived, not LLM-trusted):
//     - percentage math from per-comment verdicts
//     - dominantTechnique excludes 'none' / 'neutral'
//   Environment validation:
//     - invalid label → 'unknown'
//     - valid label → preserved
//   Index alignment:
//     - output array length === input length

import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest';

// Mock callAI BEFORE importing scoreBatch — vi.mock is hoisted.
vi.mock('../../../src/ai/client', () => ({
  callAI: vi.fn(),
}));

// §CT-26f (2026-05-04) — `scoreBatch` signature changed to take Encounter
// per `.brain/PER_PLATFORM_V1_SPEC_2026-05-04.md` §10.3. These orchestration
// tests exercise the parse + validate + aggregate logic, which is unchanged.
// Wrapping the new signature with `encounterFromLegacyBatchInput` so the
// existing test bodies (passing legacy `{comments, videoCaption, language}`
// inputs) keep exercising the same code path.
import {
  scoreBatch as _scoreBatchEncounter,
  scoreRoom,
  encounterFromLegacyBatchInput,
  __resetBatchCacheForTests,
  type BatchScoreInput,
} from '../../../src/analysis/comment-batch-scorer';
import { callAI } from '../../../src/ai/client';
import { Ok, Err } from '../../../src/ai/ai-error';
import { _resetForTests as resetFlushBudget, recordFailure } from '../../../src/ai/global-flush-budget';

function scoreBatch(input: BatchScoreInput) {
  return _scoreBatchEncounter(encounterFromLegacyBatchInput(input));
}

const mockCallAI = callAI as unknown as ReturnType<typeof vi.fn>;

const baseInput = {
  comments: [{ author: 'alice', text: 'you are a sample comment' }],
  videoCaption: 'caption',
  language: 'English',
};

function makeLlmResponse(comments: unknown[], environment: unknown = {
  label: 'healthy-discussion',
  summary: 'mixed civil tone',
}) {
  return Ok(JSON.stringify({ comments, environment }));
}

beforeEach(() => {
  resetFlushBudget();
  mockCallAI.mockReset();
  __resetBatchCacheForTests();
  // Silence the §CT-24 truncation warning during tests that exercise that path.
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  resetFlushBudget();
});

describe('M45 global hold gates every batch AI call', () => {
  it('keeps deterministic batch fallback and skips AI', async () => {
    recordFailure(); recordFailure(); recordFailure();
    const result = await _scoreBatchEncounter(encounterFromLegacyBatchInput(baseInput));
    expect(result.failed).toBe(true);
    expect(result.failureKind).toBe('pre-llm-circuit-breaker');
    expect(result.comments).toHaveLength(1);
    expect(mockCallAI).not.toHaveBeenCalled();
  });

  it('skips the separate room call', async () => {
    recordFailure(); recordFailure(); recordFailure();
    const result = await scoreRoom(encounterFromLegacyBatchInput(baseInput));
    expect(result).toBeNull();
    expect(mockCallAI).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// FAIL-CLOSED PATHS (forensic-chain integrity per VISION §1.1)
// ─────────────────────────────────────────────────────────────────────────

describe('scoreBatch — failClosed paths', () => {
  it('empty input → failClosed (no LLM call)', async () => {
    const result = await scoreBatch({ ...baseInput, comments: [] });
    expect(result.failed).toBe(true);
    expect(result.comments).toHaveLength(0);
    expect(result.environment.label).toBe('unknown');
    expect(result.batchSize).toBe(0);
    expect(result.truncatedIndices).toEqual([]);
    expect(mockCallAI).not.toHaveBeenCalled();
  });

  it('callAI throws → failClosed with one record per input comment', async () => {
    mockCallAI.mockRejectedValueOnce(new Error('network down'));
    const input = {
      ...baseInput,
      comments: [
        { author: 'a', text: 'one' },
        { author: 'b', text: 'two' },
      ],
    };
    const result = await scoreBatch(input);
    expect(result.failed).toBe(true);
    expect(result.comments).toHaveLength(2);
    expect(result.comments.every(c => c.technique === 'none' && c.severity === 0)).toBe(true);
    expect(result.environment.label).toBe('unknown');
  });

  it("callAI returns Err (e.g. rate-limit) → failClosed", async () => {
    mockCallAI.mockResolvedValueOnce(Err({ kind: 'rate-limit', retryAfterMs: 5_000 }));
    const result = await scoreBatch(baseInput);
    expect(result.failed).toBe(true);
    expect(result.comments).toHaveLength(1);
  });

  it('callAI returns unparseable garbage → failClosed', async () => {
    mockCallAI.mockResolvedValueOnce(Ok('not json at all, not even close'));
    const result = await scoreBatch(baseInput);
    expect(result.failed).toBe(true);
  });

  it('parsed object missing comments array → failClosed', async () => {
    mockCallAI.mockResolvedValueOnce(Ok(JSON.stringify({ environment: { label: 'unknown' } })));
    const result = await scoreBatch(baseInput);
    expect(result.failed).toBe(true);
  });

  it('parsed object missing environment AND zero verdicts → failClosed', async () => {
    mockCallAI.mockResolvedValueOnce(Ok(JSON.stringify({ comments: [] })));
    const result = await scoreBatch(baseInput);
    expect(result.failed).toBe(true);
  });

  // ── W88 truncation-salvage tier ─────────────────────────────────────────
  // Owner diagnostics 2026-08-18: ~8 YouTube batches/day logged
  // `class=provider-unparseable-json`, each defaulting 1-5 verdicts to
  // CANCEL_LOG. Mechanism: max_tokens=2048 truncation → Groq json_validate
  // refusal → no-JSON-mode retry returns the truncated raw → all three
  // parseJSON tiers need BALANCED braces → null → the batch's COMPLETE
  // verdicts were discarded along with the cut ones. The salvage tier keeps
  // the model's real verdicts and routes only the genuinely-missing indices
  // through truncatedIndices → cancelled-batch-truncated. No fake verdicts:
  // unsalvaged indices still default to 'none'/sev=0 + truncation event.

  it('truncated mid-array reply → salvages complete verdicts, missing indices in truncatedIndices', async () => {
    // Representative gpt-oss-20b compact reply cut by max_tokens mid-object
    // (finish_reason=length shape: no closing brackets, string cut open).
    const truncatedRaw =
      '{"comments":[' +
      '{"index":1,"technique":"shame-attack","sentiment":"negative","severity":7,"confidence":0.9,"reason":"direct insult at commenter","neutralized_text":"I disagree with you"},' +
      '{"index":2,"technique":"none","sentiment":"neutral","severity":0,"confidence":0.8,"reason":""},' +
      '{"index":3,"technique":"fear-appeal","sentiment":"negative","severity":6,"confidence":0.7,"reason":"doom framing","neutralized_text":"this worries me"},' +
      '{"index":4,"technique":"sha';
    mockCallAI.mockResolvedValueOnce(Ok(truncatedRaw));
    const input = {
      ...baseInput,
      comments: [
        { author: 'a', text: 'you are an idiot @bob' },
        { author: 'b', text: 'nice video' },
        { author: 'c', text: 'we are all doomed, wake up' },
        { author: 'd', text: 'fourth comment' },
        { author: 'e', text: 'fifth comment' },
      ],
    };
    const result = await scoreBatch(input);
    expect(result.failed).toBe(false);
    // Salvaged verdicts are the model's own, intact.
    expect(result.comments[0].technique).toBe('shame-attack');
    expect(result.comments[0].severity).toBe(7);
    expect(result.comments[0].neutralizedText).toBe('I disagree with you');
    expect(result.comments[2].technique).toBe('fear-appeal');
    // Cut + never-emitted indices route to the truncation machinery,
    // NOT to silent fake verdicts.
    expect(result.truncatedIndices).toEqual([4, 5]);
    expect(result.comments[3].technique).toBe('none');
    expect(result.comments[3].severity).toBe(0);
    // Room label falls to the honest 'unknown' (environment never arrived).
    expect(result.environment.label).toBe('unknown');
  });

  it('reply truncated inside the environment object → all verdicts salvaged, label unknown', async () => {
    const truncatedRaw =
      '{"comments":[' +
      '{"index":1,"technique":"mockery","sentiment":"negative","severity":6,"confidence":0.8,"reason":"ridicule"},' +
      '{"index":2,"technique":"supportive","sentiment":"positive","severity":0,"confidence":0.9,"reason":""}' +
      '],"environment":{"label":"hos';
    mockCallAI.mockResolvedValueOnce(Ok(truncatedRaw));
    const input = {
      ...baseInput,
      comments: [
        { author: 'a', text: 'lol look at this clown take' },
        { author: 'b', text: 'great point, well said' },
      ],
    };
    const result = await scoreBatch(input);
    expect(result.failed).toBe(false);
    expect(result.comments[0].technique).toBe('mockery');
    expect(result.comments[1].technique).toBe('supportive');
    expect(result.truncatedIndices).toEqual([]);
    expect(result.environment.label).toBe('unknown');
    // Percentages still computed code-side from the salvaged verdicts.
    expect(result.environment.negativePct).toBe(50);
    expect(result.environment.positivePct).toBe(50);
  });

  it('well-formed JSON with verdicts but no environment key → proceeds with label unknown', async () => {
    mockCallAI.mockResolvedValueOnce(Ok(JSON.stringify({
      comments: [
        { index: 1, technique: 'shame-attack', sentiment: 'negative', severity: 7, confidence: 0.9, reason: 'r' },
      ],
    })));
    const result = await scoreBatch(baseInput);
    expect(result.failed).toBe(false);
    expect(result.comments[0].technique).toBe('shame-attack');
    expect(result.environment.label).toBe('unknown');
  });

  it('prose mentioning "comments" without a JSON array → still failClosed', async () => {
    mockCallAI.mockResolvedValueOnce(Ok('I analyzed the comments: they seem fine overall.'));
    const result = await scoreBatch(baseInput);
    expect(result.failed).toBe(true);
  });

  it('parses LLM output wrapped in markdown code fences', async () => {
    // 3-tier parser: tier 2 strips markdown fences.
    const wrapped = '```json\n' + JSON.stringify({
      comments: [
        { index: 1, technique: 'shame-attack', sentiment: 'negative', severity: 7, reason: 'r' },
      ],
      environment: { label: 'healthy-discussion', summary: 'mixed civil tone' },
    }) + '\n```';
    mockCallAI.mockResolvedValueOnce(Ok(wrapped));
    const result = await scoreBatch(baseInput);
    expect(result.failed).toBe(false);
    expect(result.comments[0].technique).toBe('shame-attack');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// BATCH-LEVEL RESULT CACHE (Path B3 — same comment-set re-extracted within
// the TTL window returns the cached BatchScoreResult without re-calling
// Groq. Page-refresh / scroll-back hit case.)
// ─────────────────────────────────────────────────────────────────────────

describe('scoreBatch — batch-level result cache', () => {
  it('same input twice → cached on second call, LLM only invoked once', async () => {
    mockCallAI.mockResolvedValueOnce(makeLlmResponse([
      { index: 1, technique: 'shame-attack', sentiment: 'negative', severity: 7, reason: 'cached me' },
    ]));
    const input = {
      comments: [{ author: 'alice', text: 'you are a unique batch-cache test text' }],
      videoCaption: 'batch-cache-test-caption',
      language: 'English',
    };
    const result1 = await scoreBatch(input);
    const result2 = await scoreBatch(input);
    expect(result1.comments[0].technique).toBe('shame-attack');
    expect(result2.comments[0].technique).toBe('shame-attack');
    expect(mockCallAI).toHaveBeenCalledTimes(1);
  });

  it('different inputs → cache miss for the second call, LLM invoked twice', async () => {
    mockCallAI
      .mockResolvedValueOnce(makeLlmResponse([
        { index: 1, technique: 'shame-attack', sentiment: 'negative', severity: 7, reason: 'a' },
      ]))
      .mockResolvedValueOnce(makeLlmResponse([
        { index: 1, technique: 'fear-appeal', sentiment: 'negative', severity: 6, reason: 'b' },
      ]));
    const input1 = { comments: [{ author: 'a', text: 'distinct text one' }], videoCaption: 'cap1', language: 'English' };
    const input2 = { comments: [{ author: 'a', text: 'distinct text two' }], videoCaption: 'cap2', language: 'English' };
    await scoreBatch(input1);
    await scoreBatch(input2);
    expect(mockCallAI).toHaveBeenCalledTimes(2);
  });

  it('failed batch → NOT cached, retry calls LLM fresh', async () => {
    // First call: LLM throws → failClosed result with failed=true.
    mockCallAI.mockRejectedValueOnce(new Error('network down'));
    const input = { comments: [{ author: 'a', text: 'failed-batch-text' }], videoCaption: 'cap', language: 'English' };
    const result1 = await scoreBatch(input);
    expect(result1.failed).toBe(true);
    // Second call with same input: must NOT return cached failure.
    mockCallAI.mockResolvedValueOnce(makeLlmResponse([
      { index: 1, technique: 'none', sentiment: 'neutral', severity: 0, reason: '' },
    ]));
    const result2 = await scoreBatch(input);
    expect(result2.failed).toBe(false);
    expect(mockCallAI).toHaveBeenCalledTimes(2);
  });

  it('children order doesn\'t affect cache key (sorted text-prefix signature)', async () => {
    mockCallAI.mockResolvedValueOnce(makeLlmResponse([
      { index: 1, technique: 'none', sentiment: 'neutral', severity: 0, reason: '' },
      { index: 2, technique: 'none', sentiment: 'neutral', severity: 0, reason: '' },
    ]));
    const input1 = {
      comments: [
        { author: 'a', text: 'you are comment alpha order one' },
        { author: 'b', text: 'you are comment beta order two' },
      ],
      videoCaption: 'cap',
      language: 'English',
    };
    const input2 = {
      comments: [
        { author: 'b', text: 'you are comment beta order two' },
        { author: 'a', text: 'you are comment alpha order one' },
      ],
      videoCaption: 'cap',
      language: 'English',
    };
    await scoreBatch(input1);
    await scoreBatch(input2);
    expect(mockCallAI).toHaveBeenCalledTimes(1);
  });

  it('a reordered re-extract gets each verdict on its own comment, not on the one in its old slot', async () => {
    // The flush applies result.comments[i] to bucket.posts[i], so a cache hit
    // must be aligned to the order of the call that hit it.
    const harmless = 'you are comment kind words about the recipe';
    const harmful = 'you are a pathetic idiot and everyone here knows it';
    const omitted = 'you are comment asking where the pan is from';
    mockCallAI.mockResolvedValueOnce(makeLlmResponse([
      { index: 1, technique: 'none', sentiment: 'positive', severity: 0, reason: 'kind' },
      { index: 2, technique: 'shame-attack', sentiment: 'negative', severity: 8, target_present: true, reason: 'insult' },
    ]));
    const first = await scoreBatch({
      comments: [
        { author: 'a', text: harmless },
        { author: 'b', text: harmful },
        { author: 'c', text: omitted },
      ],
      videoCaption: 'reorder-cap',
      language: 'English',
    });
    expect(first.comments[1].technique).toBe('shame-attack');
    expect(first.truncatedIndices).toEqual([3]);

    const second = await scoreBatch({
      comments: [
        { author: 'c', text: omitted },
        { author: 'b', text: harmful },
        { author: 'a', text: harmless },
      ],
      videoCaption: 'reorder-cap',
      language: 'English',
    });
    expect(mockCallAI).toHaveBeenCalledTimes(1);
    expect(second.comments.map((c) => c.technique)).toEqual(['none', 'shame-attack', 'none']);
    expect(second.comments.map((c) => c.sentiment)).toEqual(['neutral', 'negative', 'positive']);
    expect(second.comments.map((c) => c.index)).toEqual([1, 2, 3]);
    expect(second.truncatedIndices).toEqual([1]);
    expect(second.commentHarmFloors).toEqual([
      first.commentHarmFloors[2],
      first.commentHarmFloors[1],
      first.commentHarmFloors[0],
    ]);
  });

  it('swapping a harmful and a harmless comment moves the hide verdict with the harmful text', async () => {
    const harmless = 'you are comment thanks for sharing this';
    const harmful = 'you are worthless and should disappear';
    mockCallAI.mockResolvedValueOnce(makeLlmResponse([
      { index: 1, technique: 'none', sentiment: 'neutral', severity: 0, reason: '' },
      { index: 2, technique: 'shame-attack', sentiment: 'negative', severity: 9, target_present: true, reason: 'attack' },
    ]));
    await scoreBatch({
      comments: [{ author: 'a', text: harmless }, { author: 'b', text: harmful }],
      videoCaption: 'swap-cap',
      language: 'English',
    });
    const swapped = await scoreBatch({
      comments: [{ author: 'b', text: harmful }, { author: 'a', text: harmless }],
      videoCaption: 'swap-cap',
      language: 'English',
    });
    expect(mockCallAI).toHaveBeenCalledTimes(1);
    expect(swapped.comments[0].technique).toBe('shame-attack');
    expect(swapped.comments[0].severity).toBeGreaterThanOrEqual(8);
    expect(swapped.comments[1].technique).toBe('none');
    expect(swapped.comments[1].severity).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// PRE-LLM SCRIPT GATE (Arabic / CJK / Cyrillic / Hebrew / etc. skip the LLM
// round-trip — saves ~2s + Groq tokens; harm-floor + slur escalation still
// fires via failClosed.)
// ─────────────────────────────────────────────────────────────────────────

describe('scoreBatch — pre-LLM script gate', () => {
  it('Arabic-dominant thread → failClosed with pre-llm-unsupported-language (LLM never called)', async () => {
    const arabicText = 'مرحبا بكم في هذا المنشور أعتقد أن هذا المحتوى مهم جدا لجميع الناس'.repeat(2);
    const result = await scoreBatch({
      ...baseInput,
      videoCaption: arabicText,
      comments: [
        { author: 'a', text: arabicText },
        { author: 'b', text: arabicText },
      ],
    });
    expect(result.failed).toBe(true);
    expect(result.failureKind).toBe('pre-llm-unsupported-language');
    expect(mockCallAI).not.toHaveBeenCalled();
  });

  it('CJK-dominant thread → gate fires (Chinese / Japanese / Korean ideographs)', async () => {
    const cjkText = '这是一个测试评论我希望这个内容是有意义的并且能够被正确处理'.repeat(2);
    const result = await scoreBatch({
      ...baseInput,
      videoCaption: cjkText,
      comments: [{ author: 'a', text: cjkText }],
    });
    expect(result.failed).toBe(true);
    expect(result.failureKind).toBe('pre-llm-unsupported-language');
    expect(mockCallAI).not.toHaveBeenCalled();
  });

  it('Cyrillic-dominant thread → gate fires', async () => {
    const cyrillicText = 'Это тестовое сообщение чтобы проверить как работает этот фильтр'.repeat(2);
    const result = await scoreBatch({
      ...baseInput,
      videoCaption: cyrillicText,
      comments: [{ author: 'a', text: cyrillicText }],
    });
    expect(result.failed).toBe(true);
    expect(result.failureKind).toBe('pre-llm-unsupported-language');
    expect(mockCallAI).not.toHaveBeenCalled();
  });

  it('Latin-script content (EN) → gate does NOT fire; LLM is called', async () => {
    mockCallAI.mockResolvedValueOnce(makeLlmResponse([
      { index: 1, technique: 'none', sentiment: 'neutral', severity: 0, reason: '' },
    ]));
    const result = await scoreBatch({
      ...baseInput,
      videoCaption: 'This is an English caption discussing a recent news event',
      comments: [{ author: 'a', text: 'I think this is a thoughtful observation about the topic' }],
    });
    expect(result.failed).toBe(false);
    expect(mockCallAI).toHaveBeenCalled();
  });

  it('Romanian content (Latin Extended-A diacritics) → gate does NOT fire', async () => {
    mockCallAI.mockResolvedValueOnce(makeLlmResponse([
      { index: 1, technique: 'none', sentiment: 'neutral', severity: 0, reason: '' },
    ]));
    const result = await scoreBatch({
      ...baseInput,
      videoCaption: 'Acesta este un comentariu în limba română despre situația actuală',
      comments: [{ author: 'a', text: 'Sunt de acord cu ce ați scris și împărtășesc opinia' }],
    });
    expect(result.failed).toBe(false);
    expect(mockCallAI).toHaveBeenCalled();
  });

  it('mixed Latin + non-Latin where Latin dominates → gate does NOT fire (LLM still called)', async () => {
    mockCallAI.mockResolvedValueOnce(makeLlmResponse([
      { index: 1, technique: 'none', sentiment: 'neutral', severity: 0, reason: '' },
    ]));
    // Mostly English with a sprinkling of Arabic — Latin chars dominate.
    const mixedText = 'This is mostly English text about a topic and only a small مرحبا appears here in non-Latin script';
    const result = await scoreBatch({
      ...baseInput,
      videoCaption: mixedText,
      comments: [{ author: 'a', text: mixedText }],
    });
    expect(result.failed).toBe(false);
    expect(mockCallAI).toHaveBeenCalled();
  });

  it('TT-style batch: Latin caption + one heavy-non-Latin comment → gate does NOT fire (3× dominance rule)', async () => {
    // Reproduces the symptom reported 2026-05-25 on a live TikTok test: a Latin
    // caption (~70 Latin chars), a few short English comments, and ONE
    // comment with heavy Japanese (~80 hiragana/CJK chars). Pre-fix the
    // ≥-equal dominance test flipped (nonLatin 80 >= latin 70+) and the
    // whole batch failed closed — no markers rendered on the kid's screen.
    // Post-fix the 3× multiplier keeps mixed batches on the LLM path
    // (nonLatin 80 < latin 70+ × 3 = 210).
    mockCallAI.mockResolvedValueOnce(makeLlmResponse([
      { index: 1, technique: 'none', sentiment: 'neutral', severity: 0, reason: '' },
      { index: 2, technique: 'none', sentiment: 'neutral', severity: 0, reason: '' },
      { index: 3, technique: 'none', sentiment: 'neutral', severity: 0, reason: '' },
      { index: 4, technique: 'none', sentiment: 'neutral', severity: 0, reason: '' },
    ]));
    const result = await scoreBatch({
      ...baseInput,
      videoCaption: 'A long English caption discussing a recent TikTok trend that everybody is talking about',
      comments: [
        { author: 'a', text: 'I think this is interesting content' },
        { author: 'b', text: 'My friend showed me this earlier today' },
        { author: 'c', text: 'すごい面白いですねこれは本当に良いコンテンツですありがとうございました大好きです素晴らしい' },
        { author: 'd', text: 'Great video keep it up' },
      ],
    });
    expect(result.failed).toBe(false);
    expect(mockCallAI).toHaveBeenCalled();
  });

  it('short non-Latin sample (< 50 chars) → gate does NOT fire (sample too small for confident skip)', async () => {
    mockCallAI.mockResolvedValueOnce(makeLlmResponse([
      { index: 1, technique: 'none', sentiment: 'neutral', severity: 0, reason: '' },
    ]));
    const result = await scoreBatch({
      ...baseInput,
      videoCaption: 'مرحبا', // 5 Arabic chars only
      comments: [{ author: 'a', text: 'short' }],
    });
    expect(result.failed).toBe(false);
    expect(mockCallAI).toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// PER-COMMENT NORMALIZATION (whitelists + clamps)
// ─────────────────────────────────────────────────────────────────────────

describe('scoreBatch — per-comment normalization', () => {
  it('preserves a valid technique', async () => {
    mockCallAI.mockResolvedValueOnce(makeLlmResponse([
      { index: 1, technique: 'shame-attack', sentiment: 'negative', severity: 7, reason: 'matches private target' },
    ]));
    const result = await scoreBatch(baseInput);
    expect(result.comments[0].technique).toBe('shame-attack');
    expect(result.comments[0].sentiment).toBe('negative');
    expect(result.comments[0].severity).toBe(7);
  });

  it('target_present=false downgrades shame-attack to genuine-opinion (absent target is rude opinion, not a technique)', async () => {
    mockCallAI.mockResolvedValueOnce(makeLlmResponse([
      { index: 1, technique: 'shame-attack', sentiment: 'negative', severity: 8, reason: 'insults a public figure', target_present: false },
    ]));
    const result = await scoreBatch(baseInput);
    expect(result.comments[0].technique).toBe('genuine-opinion');
    expect(result.comments[0].severity).toBeLessThanOrEqual(3);
  });

  it('target_present=true keeps the shame-attack verdict untouched', async () => {
    mockCallAI.mockResolvedValueOnce(makeLlmResponse([
      { index: 1, technique: 'shame-attack', sentiment: 'negative', severity: 8, reason: 'attacks the reader', target_present: true },
    ]));
    const result = await scoreBatch(baseInput);
    expect(result.comments[0].technique).toBe('shame-attack');
    expect(result.comments[0].severity).toBe(8);
  });

  // Code-side presence enforcement (2026-08-02). The model does not fill
  // target_present, so an omitted field falls through to hasPresentTarget.
  const absentTargetInput = {
    comments: [{ author: 'alice', text: 'Rex Holloway is a pathetic clown' }],
    videoCaption: 'caption',
    language: 'English',
  };

  it('downgrades shame-attack code-side when the text addresses nobody present', async () => {
    mockCallAI.mockResolvedValueOnce(makeLlmResponse([
      { index: 1, technique: 'shame-attack', sentiment: 'negative', severity: 8, reason: 'mocks a public figure' },
    ]));
    const result = await scoreBatch(absentTargetInput);
    expect(result.comments[0].technique).toBe('genuine-opinion');
    expect(result.comments[0].severity).toBeLessThanOrEqual(3);
  });

  it('never downgrades dehumanizing text, present target or not', async () => {
    mockCallAI.mockResolvedValueOnce(makeLlmResponse([
      { index: 1, technique: 'shame-attack', sentiment: 'negative', severity: 8, reason: 'group smear' },
    ]));
    const result = await scoreBatch({
      ...absentTargetInput,
      comments: [{ author: 'alice', text: 'immigrants are cockroaches' }],
    });
    expect(result.comments[0].technique).not.toBe('genuine-opinion');
  });

  it('non-boolean target_present is ignored (fail-open to prior behavior)', async () => {
    mockCallAI.mockResolvedValueOnce(makeLlmResponse([
      { index: 1, technique: 'shame-attack', sentiment: 'negative', severity: 7, reason: '', target_present: 'absent' },
    ]));
    const result = await scoreBatch(baseInput);
    expect(result.comments[0].technique).toBe('shame-attack');
    expect(result.comments[0].severity).toBe(7);
  });

  it('target_present=false on an identity-slur comment is re-escalated by the harm-floor override gate', async () => {
    // The model can be tricked into target_present=false, but the
    // deterministic slur override runs after the gate and must win.
    mockCallAI.mockResolvedValueOnce(makeLlmResponse([
      { index: 1, technique: 'shame-attack', sentiment: 'negative', severity: 8, reason: '', target_present: false },
    ]));
    const result = await scoreBatch({
      ...baseInput,
      comments: [{ author: 'a', text: 'shut up you dirty kike nobody wants you here' }],
    });
    expect(result.comments[0].technique).toBe('shame-attack');
    expect(result.comments[0].severity).toBeGreaterThanOrEqual(8);
  });

  it('rage-format opening escalates an under-flagged verdict to misleading-format sev>=6', async () => {
    mockCallAI.mockResolvedValueOnce(makeLlmResponse([
      { index: 1, technique: 'genuine-opinion', sentiment: 'neutral', severity: 2, reason: '' },
    ]));
    const result = await scoreBatch({
      ...baseInput,
      comments: [{ author: 'a', text: 'BREAKING: they are hiding the truth from every single one of you' }],
    });
    expect(result.comments[0].technique).toBe('misleading-format');
    expect(result.comments[0].severity).toBeGreaterThanOrEqual(6);
  });

  it('rage-format requires the uppercase lexicon — plain caps excitement never escalates', async () => {
    mockCallAI.mockResolvedValueOnce(makeLlmResponse([
      { index: 1, technique: 'none', sentiment: 'neutral', severity: 0, reason: '' },
    ]));
    const result = await scoreBatch({
      ...baseInput,
      comments: [{ author: 'a', text: 'HOW THE FUCK DID THIS SHIT NOT LEAK' }],
    });
    expect(result.comments[0].technique).toBe('none');
  });

  it('rage-format leaves an already-flagged verdict untouched', async () => {
    mockCallAI.mockResolvedValueOnce(makeLlmResponse([
      { index: 1, technique: 'fear-appeal', sentiment: 'negative', severity: 8, reason: 'panic framing' },
    ]));
    const result = await scoreBatch({
      ...baseInput,
      comments: [{ author: 'a', text: 'BREAKING: everyone will suffer unless you act right now' }],
    });
    expect(result.comments[0].technique).toBe('fear-appeal');
    expect(result.comments[0].severity).toBe(8);
  });

  it('lowercase "breaking" prose never escalates', async () => {
    mockCallAI.mockResolvedValueOnce(makeLlmResponse([
      { index: 1, technique: 'none', sentiment: 'neutral', severity: 0, reason: '' },
    ]));
    const result = await scoreBatch({
      ...baseInput,
      comments: [{ author: 'a', text: 'breaking news fatigue is real, I just mute it all now' }],
    });
    expect(result.comments[0].technique).toBe('none');
  });

  it('coerces an unknown technique to "none"', async () => {
    mockCallAI.mockResolvedValueOnce(makeLlmResponse([
      { index: 1, technique: 'made-up-technique', sentiment: 'negative', severity: 5, reason: '' },
    ]));
    const result = await scoreBatch(baseInput);
    expect(result.comments[0].technique).toBe('none');
  });

  it('coerces a missing technique to "none"', async () => {
    mockCallAI.mockResolvedValueOnce(makeLlmResponse([
      { index: 1, sentiment: 'negative', severity: 5, reason: '' },
    ]));
    const result = await scoreBatch(baseInput);
    expect(result.comments[0].technique).toBe('none');
  });

  it('coerces unknown sentiment to "neutral"', async () => {
    mockCallAI.mockResolvedValueOnce(makeLlmResponse([
      { index: 1, technique: 'none', sentiment: 'sideways', severity: 0, reason: '' },
    ]));
    const result = await scoreBatch(baseInput);
    expect(result.comments[0].sentiment).toBe('neutral');
  });

  it('clamps severity overflow >10 → 10', async () => {
    mockCallAI.mockResolvedValueOnce(makeLlmResponse([
      { index: 1, technique: 'shame-attack', sentiment: 'negative', severity: 99, reason: '' },
    ]));
    const result = await scoreBatch(baseInput);
    expect(result.comments[0].severity).toBe(10);
  });

  it('clamps negative severity → 0', async () => {
    mockCallAI.mockResolvedValueOnce(makeLlmResponse([
      { index: 1, technique: 'shame-attack', sentiment: 'negative', severity: -3, reason: '' },
    ]));
    const result = await scoreBatch(baseInput);
    expect(result.comments[0].severity).toBe(0);
  });

  it('clamps NaN severity → 0', async () => {
    mockCallAI.mockResolvedValueOnce(makeLlmResponse([
      { index: 1, technique: 'shame-attack', sentiment: 'negative', severity: 'not-a-number', reason: '' },
    ]));
    const result = await scoreBatch(baseInput);
    expect(result.comments[0].severity).toBe(0);
  });

  it('clamps non-finite severity (Infinity) → 0 (Number.isFinite check)', async () => {
    // Per clampSeverity at scorer:141-145: !Number.isFinite(v) returns 0.
    // Infinity is a valid Number but not finite — the implementation chooses
    // safe-default (0) over clamp-to-max (10). Documents the contract.
    mockCallAI.mockResolvedValueOnce(makeLlmResponse([
      { index: 1, technique: 'shame-attack', sentiment: 'negative', severity: Infinity, reason: '' },
    ]));
    const result = await scoreBatch(baseInput);
    expect(result.comments[0].severity).toBe(0);
  });

  it('slices reason at 280 chars', async () => {
    const longReason = 'a'.repeat(500);
    mockCallAI.mockResolvedValueOnce(makeLlmResponse([
      { index: 1, technique: 'shame-attack', sentiment: 'negative', severity: 5, reason: longReason },
    ]));
    const result = await scoreBatch(baseInput);
    expect(result.comments[0].reason).toHaveLength(280);
  });

  it('non-string reason coerces to empty string', async () => {
    mockCallAI.mockResolvedValueOnce(makeLlmResponse([
      { index: 1, technique: 'shame-attack', sentiment: 'negative', severity: 5, reason: 12345 },
    ]));
    const result = await scoreBatch(baseInput);
    expect(result.comments[0].reason).toBe('');
  });

  it('skips out-of-range index from LLM (uses default for that slot)', async () => {
    const input = {
      ...baseInput,
      comments: [
        { author: 'a', text: 'one' },
        { author: 'b', text: 'two' },
      ],
    };
    mockCallAI.mockResolvedValueOnce(makeLlmResponse([
      { index: 99, technique: 'shame-attack', sentiment: 'negative', severity: 7, reason: '' },
      { index: 1, technique: 'genuine-opinion', sentiment: 'neutral', severity: 3, reason: '' },
    ]));
    const result = await scoreBatch(input);
    // index 99 ignored; #1 hit, #2 defaults to 'none'/sev=0
    expect(result.comments[0].technique).toBe('genuine-opinion');
    expect(result.comments[1].technique).toBe('none');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// §CT-24 TRUNCATION DETECTION
// ─────────────────────────────────────────────────────────────────────────

describe('scoreBatch — §CT-24 truncation detection', () => {
  it('partial LLM output → truncatedIndices populated for missing slots', async () => {
    const input = {
      ...baseInput,
      comments: [
        { author: 'a', text: 'one' },
        { author: 'b', text: 'two' },
        { author: 'c', text: 'three' },
        { author: 'd', text: 'four' },
        { author: 'e', text: 'five' },
      ],
    };
    // LLM returns only first 3 (max_tokens cut off after #3).
    mockCallAI.mockResolvedValueOnce(makeLlmResponse([
      { index: 1, technique: 'genuine-opinion', sentiment: 'neutral', severity: 3, reason: '' },
      { index: 2, technique: 'none', sentiment: 'neutral', severity: 0, reason: '' },
      { index: 3, technique: 'shame-attack', sentiment: 'negative', severity: 7, reason: '' },
    ]));
    const result = await scoreBatch(input);
    expect(result.failed).toBe(false);
    expect(result.comments).toHaveLength(5);
    expect(result.truncatedIndices).toEqual([4, 5]);
    // Truncated slots fall back to defaults.
    expect(result.comments[3].technique).toBe('none');
    expect(result.comments[4].technique).toBe('none');
  });

  it('all-present LLM output → truncatedIndices is empty', async () => {
    const input = {
      ...baseInput,
      comments: [
        { author: 'a', text: 'one' },
        { author: 'b', text: 'two' },
      ],
    };
    mockCallAI.mockResolvedValueOnce(makeLlmResponse([
      { index: 1, technique: 'none', sentiment: 'neutral', severity: 0, reason: '' },
      { index: 2, technique: 'none', sentiment: 'neutral', severity: 0, reason: '' },
    ]));
    const result = await scoreBatch(input);
    expect(result.truncatedIndices).toEqual([]);
  });

  it('zero LLM verdicts but valid envelope → all indices truncated', async () => {
    const input = {
      ...baseInput,
      comments: [
        { author: 'a', text: 'one' },
        { author: 'b', text: 'two' },
      ],
    };
    mockCallAI.mockResolvedValueOnce(makeLlmResponse([]));
    const result = await scoreBatch(input);
    expect(result.failed).toBe(false);
    expect(result.truncatedIndices).toEqual([1, 2]);
  });

  it('truncation logs a console warning naming the missing indices', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // The spy accumulates calls across tests in this file (vi.spyOn returns
    // the existing spy); clear so calls[0] is THIS test's warning, not the
    // W88 salvage warning emitted by earlier truncation-salvage tests.
    warnSpy.mockClear();
    const input = {
      ...baseInput,
      comments: [
        { author: 'a', text: 'one' },
        { author: 'b', text: 'two' },
      ],
    };
    mockCallAI.mockResolvedValueOnce(makeLlmResponse([
      { index: 1, technique: 'none', sentiment: 'neutral', severity: 0, reason: '' },
    ]));
    await scoreBatch(input);
    expect(warnSpy).toHaveBeenCalled();
    const message = warnSpy.mock.calls[0][0] as string;
    expect(message).toContain('comment-batch');
    expect(message).toContain('1/2');
    expect(message).toContain('2');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// AGGREGATE COMPUTATION (self-derived per scorer:242-243)
// ─────────────────────────────────────────────────────────────────────────

describe('scoreBatch — aggregate computation', () => {
  it('percentage math derived from per-comment verdicts (not from LLM)', async () => {
    const input = {
      ...baseInput,
      comments: Array.from({ length: 10 }, (_, i) => ({ author: `u${i}`, text: 'you t' })),
    };
    // 7 negative + 2 positive + 1 neutral.
    const verdicts = [
      ...Array.from({ length: 7 }, (_, i) => ({
        index: i + 1, technique: 'shame-attack', sentiment: 'negative', severity: 6, reason: 'x',
      })),
      ...Array.from({ length: 2 }, (_, i) => ({
        index: i + 8, technique: 'supportive', sentiment: 'positive', severity: 2, reason: 'y',
      })),
      { index: 10, technique: 'neutral', sentiment: 'neutral', severity: 0, reason: '' },
    ];
    // Note: LLM "lies" with deliberately wrong percentages — scoreBatch must ignore.
    mockCallAI.mockResolvedValueOnce(Ok(JSON.stringify({
      comments: verdicts,
      environment: {
        label: 'hostile-crowd',
        summary: 'lots negative',
        // LLM-supplied percentages — must be IGNORED.
        negativePct: 99,
        positivePct: 99,
        neutralPct: 99,
      },
    })));
    const result = await scoreBatch(input);
    expect(result.environment.negativePct).toBe(70);
    expect(result.environment.positivePct).toBe(20);
    expect(result.environment.neutralPct).toBe(10);
  });

  it('dominantTechnique excludes "none" and "neutral"', async () => {
    const input = {
      ...baseInput,
      comments: Array.from({ length: 5 }, (_, i) => ({ author: `u${i}`, text: 'you t' })),
    };
    // 3× 'none' (most frequent) + 1× 'neutral' + 1× 'shame-attack'.
    // dominantTechnique should be 'shame-attack' (the only non-none/non-neutral).
    mockCallAI.mockResolvedValueOnce(makeLlmResponse([
      { index: 1, technique: 'none', sentiment: 'neutral', severity: 0, reason: '' },
      { index: 2, technique: 'none', sentiment: 'neutral', severity: 0, reason: '' },
      { index: 3, technique: 'none', sentiment: 'neutral', severity: 0, reason: '' },
      { index: 4, technique: 'neutral', sentiment: 'neutral', severity: 0, reason: '' },
      { index: 5, technique: 'shame-attack', sentiment: 'negative', severity: 7, reason: '' },
    ]));
    const result = await scoreBatch(input);
    expect(result.environment.dominantTechnique).toBe('shame-attack');
  });

  it('dominantTechnique is null when only "none"/"neutral" present', async () => {
    const input = {
      ...baseInput,
      comments: [
        { author: 'a', text: 'you t' },
        { author: 'b', text: 'you t' },
      ],
    };
    mockCallAI.mockResolvedValueOnce(makeLlmResponse([
      { index: 1, technique: 'none', sentiment: 'neutral', severity: 0, reason: '' },
      { index: 2, technique: 'neutral', sentiment: 'neutral', severity: 0, reason: '' },
    ]));
    const result = await scoreBatch(input);
    expect(result.environment.dominantTechnique).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// ENVIRONMENT LABEL VALIDATION
// ─────────────────────────────────────────────────────────────────────────

describe('scoreBatch — environment label validation', () => {
  it('preserves a valid environment label from the LLM', async () => {
    mockCallAI.mockResolvedValueOnce(makeLlmResponse(
      [{ index: 1, technique: 'none', sentiment: 'neutral', severity: 0, reason: '' }],
      { label: 'hostile-crowd', summary: 'angry room' },
    ));
    const result = await scoreBatch(baseInput);
    expect(result.environment.label).toBe('hostile-crowd');
  });

  it('coerces an invalid environment label to "unknown"', async () => {
    mockCallAI.mockResolvedValueOnce(makeLlmResponse(
      [{ index: 1, technique: 'none', sentiment: 'neutral', severity: 0, reason: '' }],
      { label: 'invented-label', summary: '' },
    ));
    const result = await scoreBatch(baseInput);
    expect(result.environment.label).toBe('unknown');
  });

  it('slices environment.summary at 400 chars', async () => {
    const longSummary = 'b'.repeat(800);
    mockCallAI.mockResolvedValueOnce(makeLlmResponse(
      [{ index: 1, technique: 'none', sentiment: 'neutral', severity: 0, reason: '' }],
      { label: 'healthy-discussion', summary: longSummary },
    ));
    const result = await scoreBatch(baseInput);
    expect(result.environment.summary).toHaveLength(400);
  });

  it('non-string environment.summary coerces to empty string', async () => {
    mockCallAI.mockResolvedValueOnce(makeLlmResponse(
      [{ index: 1, technique: 'none', sentiment: 'neutral', severity: 0, reason: '' }],
      { label: 'healthy-discussion', summary: { not: 'a string' } },
    ));
    const result = await scoreBatch(baseInput);
    expect(result.environment.summary).toBe('');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// INDEX ALIGNMENT + RESULT SHAPE
// ─────────────────────────────────────────────────────────────────────────

describe('scoreBatch — output shape', () => {
  it('output array length === input length on success', async () => {
    const input = {
      ...baseInput,
      comments: Array.from({ length: 7 }, (_, i) => ({ author: `u${i}`, text: 'you t' })),
    };
    mockCallAI.mockResolvedValueOnce(makeLlmResponse(
      Array.from({ length: 7 }, (_, i) => ({
        index: i + 1, technique: 'none', sentiment: 'neutral', severity: 0, reason: '',
      })),
    ));
    const result = await scoreBatch(input);
    expect(result.comments).toHaveLength(7);
    // Indices are 1-based, contiguous.
    expect(result.comments.map(c => c.index)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('batchSize matches input length on success', async () => {
    const input = {
      ...baseInput,
      comments: [
        { author: 'a', text: 'you t' },
        { author: 'b', text: 'you t' },
        { author: 'c', text: 'you t' },
      ],
    };
    mockCallAI.mockResolvedValueOnce(makeLlmResponse([
      { index: 1, technique: 'none', sentiment: 'neutral', severity: 0, reason: '' },
      { index: 2, technique: 'none', sentiment: 'neutral', severity: 0, reason: '' },
      { index: 3, technique: 'none', sentiment: 'neutral', severity: 0, reason: '' },
    ]));
    const result = await scoreBatch(input);
    expect(result.batchSize).toBe(3);
  });

  it('generationTimeMs is a non-negative number', async () => {
    mockCallAI.mockResolvedValueOnce(makeLlmResponse([
      { index: 1, technique: 'none', sentiment: 'neutral', severity: 0, reason: '' },
    ]));
    const result = await scoreBatch(baseInput);
    expect(result.generationTimeMs).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(result.generationTimeMs)).toBe(true);
  });
});
