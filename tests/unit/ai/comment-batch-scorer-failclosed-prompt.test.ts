// Regression tests for two comment-batch protection-integrity fixes.
//
// H4 — a throw inside the BATCH prompt builder (buildReframeFewshotSystem's
//      fail-loud anchor guard) must NOT escape scoreBatch and reject the whole
//      batch for every user. It must degrade to the deterministic harm-floor
//      floor (failClosed), same as a Groq transport failure.
//
// M11 — the profanity-tier hide gate must not leave a contradictory verdict
//      (isManipulative=true while technique still reads a non-manipulation /
//      "this is fine" label like 'genuine-opinion'). The hide resets technique
//      to the truthful non-manipulation label 'none'; overrideOrigin carries
//      the real reason.
//
// Unit tests. The network boundary (callAI) is mocked. For H4 the prompt
// module is mocked to force the throw.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/ai/client', () => ({
  callAI: vi.fn(),
}));

// Mock the prompt module so we can force buildBatchPromptV3 to throw on demand.
// Every other export is preserved from the real module; buildBatchPromptV3 is a
// spy whose default behavior delegates to the real implementation, so the
// happy-path M11 tests still build a real prompt.
vi.mock('../../../src/ai/prompts-v2', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/ai/prompts-v2')>();
  return {
    ...actual,
    buildBatchPromptV3: vi.fn(actual.buildBatchPromptV3),
  };
});

import {
  scoreBatch as _scoreBatchEncounter,
  encounterFromLegacyBatchInput,
  __resetBatchCacheForTests,
  isManipulative,
  NON_MANIPULATION_TECHNIQUES,
  type BatchScoreInput,
} from '../../../src/analysis/comment-batch-scorer';
import { callAI } from '../../../src/ai/client';
import { buildBatchPromptV3 } from '../../../src/ai/prompts-v2';
import { Ok } from '../../../src/ai/ai-error';

function scoreBatch(input: BatchScoreInput, mode: 'child' | 'teen' | 'adult' = 'teen') {
  return _scoreBatchEncounter(encounterFromLegacyBatchInput(input), mode);
}

const mockCallAI = callAI as unknown as ReturnType<typeof vi.fn>;
const mockBuildPrompt = buildBatchPromptV3 as unknown as ReturnType<typeof vi.fn>;

function makeLlmResponse(comments: unknown[]) {
  return Ok(JSON.stringify({
    comments,
    environment: { label: 'healthy-discussion', summary: 'mixed civil tone' },
  }));
}

// Captured once: the real prompt builder, so H4 tests can restore delegation.
let realBuildPrompt: typeof buildBatchPromptV3;

beforeEach(async () => {
  if (!realBuildPrompt) {
    const actual = await vi.importActual<typeof import('../../../src/ai/prompts-v2')>(
      '../../../src/ai/prompts-v2',
    );
    realBuildPrompt = actual.buildBatchPromptV3;
  }
  mockCallAI.mockReset();
  // Clear call history but restore default delegation to the real builder.
  mockBuildPrompt.mockReset();
  mockBuildPrompt.mockImplementation(realBuildPrompt);
  __resetBatchCacheForTests();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'debug').mockImplementation(() => {});
});

// ─────────────────────────────────────────────────────────────────────────
// H4 — prompt-builder throw must fail closed, not reject the batch
// ─────────────────────────────────────────────────────────────────────────

describe('H4 — buildBatchPromptV3 throw → scoreBatch fails closed', () => {
  it('resolves to a failClosed result (not a rejected promise) when the prompt builder throws', async () => {
    mockBuildPrompt.mockImplementation(() => {
      throw new Error(
        'buildReframeFewshotSystem: a reframe anchor failed to match the default prompt',
      );
    });
    const input = {
      comments: [
        { author: 'a', text: 'one benign comment' },
        { author: 'b', text: 'another benign comment' },
      ],
      videoCaption: 'caption',
      language: 'English',
    };

    // Must NOT reject — the whole point of the fix.
    const result = await scoreBatch(input);

    expect(result.failed).toBe(true);
    expect(result.comments).toHaveLength(2);
    // Deterministic floor: benign comments carry the safe default.
    expect(result.comments.every((c) => c.technique === 'none' && c.severity === 0)).toBe(true);
    expect(result.environment.label).toBe('unknown');
    // The LLM is never called when the prompt cannot be built.
    expect(mockCallAI).not.toHaveBeenCalled();
  });

  it('the harm-floor protection floor still fires when the prompt builder throws', async () => {
    mockBuildPrompt.mockImplementation(() => {
      throw new Error('anchor failed');
    });
    // An identity-slur-laden comment must still route to hide via failClosed's
    // deterministic slur escalation even though the prompt could not be built.
    const input = {
      comments: [{ author: 'x', text: 'you stupid nigger' }],
      videoCaption: 'caption',
      language: 'English',
    };
    const result = await scoreBatch(input);
    expect(result.failed).toBe(true);
    expect(result.comments).toHaveLength(1);
    expect(result.comments[0].action).toBe('hide');
    expect(result.comments[0].overrideOrigin).toBe('identity-slur');
    expect(mockCallAI).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// M11 — profanity-tier hide must write a consistent (non-contradictory) record
// ─────────────────────────────────────────────────────────────────────────

describe('M11 — profanity-tier hide carries a consistent technique', () => {
  it('a sev≥8 profanity comment the LLM labeled genuine-opinion is hidden with technique reset (not genuine-opinion)', async () => {
    // LLM returns genuine-opinion at sev=8 (e.g. forced high by tone). The
    // profanity-tier gate must add action=hide AND reset technique so the
    // chain record is not "isManipulative + genuine-opinion".
    mockCallAI.mockResolvedValueOnce(makeLlmResponse([
      { index: 1, technique: 'genuine-opinion', severity: 8, sentiment: 'negative', reason: 'r' },
    ]));
    const input = {
      comments: [{ author: 'a', text: 'this is fucking ridiculous and i hate it' }],
      videoCaption: 'caption',
      language: 'English',
    };
    const result = await scoreBatch(input);
    const v = result.comments[0];

    expect(v.action).toBe('hide');
    expect(v.overrideOrigin).toBe('profanity-tier');
    // The contradiction is gone: the technique is no longer a "this is fine" label.
    expect(v.technique).not.toBe('genuine-opinion');
    // It IS a truthful non-manipulation label.
    expect(NON_MANIPULATION_TECHNIQUES.has(v.technique)).toBe(true);
    expect(v.technique).toBe('none');
    // Still flags (hidden) via the action short-circuit.
    expect(isManipulative(v)).toBe(true);
  });

  it('PROTECTION SAFETY — a benign sev≥8 comment with NO profanity is unchanged (no false hide)', async () => {
    // Same sev=8 genuine-opinion verdict, but the text has no profanity. The
    // profanity gate must NOT fire: technique stays genuine-opinion, no hide.
    mockCallAI.mockResolvedValueOnce(makeLlmResponse([
      { index: 1, technique: 'genuine-opinion', severity: 8, sentiment: 'negative', reason: 'r' },
    ]));
    const input = {
      comments: [{ author: 'a', text: 'I strongly disagree with this take and think it is wrong' }],
      videoCaption: 'caption',
      language: 'English',
    };
    const result = await scoreBatch(input);
    const v = result.comments[0];

    expect(v.technique).toBe('genuine-opinion');
    expect(v.action).not.toBe('hide');
    expect(v.overrideOrigin).not.toBe('profanity-tier');
  });
});
