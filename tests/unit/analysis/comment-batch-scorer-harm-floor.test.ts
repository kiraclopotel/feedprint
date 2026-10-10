// §CT-26h (2026-05-05) — scoreBatch harm-floor enrichment + room-toxicity
// aggregation + failClosed harm-floor-grounded severity fallback.
//
// Tests the V1.5 slice that runs `computeHarmFloor` on every CommentNode
// BEFORE the BATCH classifier (Layer 1) and aggregates room-toxicity from
// the per-comment outputs (Layer 2). When Groq fails, the per-comment
// harm-floor score grounds severity instead of the silent 'none/sev=0'
// default — closing the symmetric gap that the per-post pipeline's L0
// slur-filter already covers in pipeline.ts.

import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/ai/client', () => ({
  callAI: vi.fn(),
}));

import {
  scoreBatch,
  encounterFromLegacyBatchInput,
  isManipulative,
  __resetBatchCacheForTests,
} from '../../../src/analysis/comment-batch-scorer';
import { callAI } from '../../../src/ai/client';
import { Ok } from '../../../src/ai/ai-error';
import { _resetForTests as resetFlushBudget } from '../../../src/ai/global-flush-budget';

const mockCallAI = callAI as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  resetFlushBudget();
  mockCallAI.mockReset();
  __resetBatchCacheForTests();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  resetFlushBudget();
});

const llmJson = (comments: unknown[], envOverride: Record<string, unknown> = {}) =>
  Ok(JSON.stringify({
    comments,
    environment: { label: 'healthy-discussion', summary: 'test', ...envOverride },
  }));

// ─── Concern 1: harm-floor enrichment reaches the BATCH prompt ──────────

describe('§CT-26h enrichment: per-comment harm-floor compute → prompt', () => {
  it('enriches a slur-loaded comment so the BATCH prompt carries [HF:...]', async () => {
    let capturedUserPrompt = '';
    mockCallAI.mockImplementation(
      async (_system: string, user: string) => {
        capturedUserPrompt = user;
        return llmJson([
          { index: 1, technique: 'shame-attack', sentiment: 'negative', severity: 8, reason: 'slur' },
        ]);
      },
    );
    const input = {
      comments: [{ author: 'synthetic_child_a', text: 'Fuck you, nigga.' }],
      videoCaption: 'Synthetic neutral video caption',
      language: 'English',
    };
    await scoreBatch(encounterFromLegacyBatchInput(input));
    // The slur "nigga" + profanity "fuck" should drive harm-floor ≥ 30.
    expect(capturedUserPrompt).toMatch(/\[HF:\d+ /);
  });

  it('skips HF flag for benign comments (text with no profanity / slur / caps)', async () => {
    let capturedUserPrompt = '';
    mockCallAI.mockImplementation(
      async (_system: string, user: string) => {
        capturedUserPrompt = user;
        return llmJson([
          { index: 1, technique: 'genuine-opinion', sentiment: 'neutral', severity: 1, reason: '' },
        ]);
      },
    );
    const input = {
      comments: [{ author: 'synthetic_child_d', text: 'When people shoplift it raises prices for everyone' }],
      videoCaption: 'caption',
      language: 'English',
    };
    await scoreBatch(encounterFromLegacyBatchInput(input));
    expect(capturedUserPrompt).not.toMatch(/\[HF:/);
  });

  it('does NOT mutate the caller-provided Encounter (pure enrichment)', async () => {
    mockCallAI.mockResolvedValue(llmJson([
      { index: 1, technique: 'shame-attack', sentiment: 'negative', severity: 8, reason: 'x' },
    ]));
    const enc = encounterFromLegacyBatchInput({
      comments: [{ author: 'a', text: 'fucking idiots' }],
      videoCaption: 'c',
      language: 'English',
    });
    const childrenBefore = enc.children.map((c) => ({ ...c }));
    await scoreBatch(enc);
    // Original encounter children should be unchanged (no harm_floor mutation).
    expect(enc.children[0].harm_floor).toBeUndefined();
    expect(enc.children).toEqual(childrenBefore);
  });
});

// ─── Concern 2: room-toxicity aggregation in BatchEnvironment ───────────

describe('§CT-26h aggregate: BatchEnvironment carries Layer-2 signals', () => {
  it('toxicityScore is mean of per-comment harm-floor across the batch', async () => {
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
    expect(result.environment.toxicityScore).toBeGreaterThan(0);
    expect(result.environment.toxicityScore).toBeLessThanOrEqual(100);
  });

  it('slurPrevalencePct counts comments with HF score >= 50', async () => {
    mockCallAI.mockResolvedValue(
      llmJson([
        { index: 1, technique: 'shame-attack', sentiment: 'negative', severity: 8, reason: 'x' },
        { index: 2, technique: 'shame-attack', sentiment: 'negative', severity: 9, reason: 'x' },
        { index: 3, technique: 'genuine-opinion', sentiment: 'neutral', severity: 1, reason: '' },
        { index: 4, technique: 'genuine-opinion', sentiment: 'neutral', severity: 1, reason: '' },
      ]),
    );
    const enc = encounterFromLegacyBatchInput({
      comments: [
        { author: 'a', text: 'fucking nigger retard psycho idiot moron' }, // very high HF
        { author: 'b', text: 'fucking nigger retard psycho idiot moron' }, // very high HF
        { author: 'c', text: 'normal' },                                    // 0
        { author: 'd', text: 'normal' },                                    // 0
      ],
      videoCaption: 'c',
      language: 'English',
    });
    const result = await scoreBatch(enc);
    expect(result.environment.slurPrevalencePct).toBe(50);
  });

  it('authorRecidivism = max comments by single handle', async () => {
    mockCallAI.mockResolvedValue(
      llmJson([1, 2, 3, 4].map((i) => ({
        index: i,
        technique: 'genuine-opinion',
        sentiment: 'neutral',
        severity: 1,
        reason: '',
      }))),
    );
    const enc = encounterFromLegacyBatchInput({
      comments: [
        { author: 'pile-on-author', text: 'a' },
        { author: 'pile-on-author', text: 'b' },
        { author: 'pile-on-author', text: 'c' },
        { author: 'someone-else', text: 'd' },
      ],
      videoCaption: 'c',
      language: 'English',
    });
    const result = await scoreBatch(enc);
    expect(result.environment.authorRecidivism).toBe(3);
  });

  it('discourseQuality = 100 when no negative comments', async () => {
    mockCallAI.mockResolvedValue(
      llmJson([
        { index: 1, technique: 'supportive', sentiment: 'positive', severity: 1, reason: '' },
        { index: 2, technique: 'supportive', sentiment: 'positive', severity: 1, reason: '' },
      ]),
    );
    const enc = encounterFromLegacyBatchInput({
      comments: [
        { author: 'a', text: 'love this' },
        { author: 'b', text: 'so good' },
      ],
      videoCaption: 'c',
      language: 'English',
    });
    const result = await scoreBatch(enc);
    expect(result.environment.discourseQuality).toBe(100);
  });

  it('discourseQuality drops when negative comments carry high harm-floor (rebut-by-slur)', async () => {
    mockCallAI.mockResolvedValue(
      llmJson([
        { index: 1, technique: 'shame-attack', sentiment: 'negative', severity: 8, reason: 'x' },
        { index: 2, technique: 'genuine-opinion', sentiment: 'negative', severity: 3, reason: 'x' },
      ]),
    );
    const enc = encounterFromLegacyBatchInput({
      comments: [
        { author: 'a', text: 'fucking nigger retard psycho idiot moron' }, // negative + high HF
        { author: 'b', text: 'I disagree with this argument because' },     // negative + low HF
      ],
      videoCaption: 'c',
      language: 'English',
    });
    const result = await scoreBatch(enc);
    expect(result.environment.discourseQuality).toBeLessThan(100);
  });
});

// ─── Concern 3: failClosed harm-floor fallback ──────────────────────────

describe('§CT-26h failClosed: harm-floor grounds severity when Groq fails', () => {
  it('callAI throws → high-HF comment gets severity ≥ 7 (not silent sev=0)', async () => {
    mockCallAI.mockRejectedValue(new Error('groq down'));
    const enc = encounterFromLegacyBatchInput({
      comments: [
        // Very high HF — multiple slurs + ad-hominem stack
        { author: 'a', text: 'fucking nigger retard psycho idiot moron asshole bitch' },
      ],
      videoCaption: 'c',
      language: 'English',
    });
    const result = await scoreBatch(enc);
    expect(result.failed).toBe(true);
    expect(result.comments[0].severity).toBeGreaterThanOrEqual(7);
    expect(result.comments[0].sentiment).toBe('negative');
    expect(result.comments[0].reason).toMatch(/harm-floor fallback/);
  });

  it('callAI returns Err → low-HF comment defaults to safe sev=0 (no false-positive)', async () => {
    mockCallAI.mockResolvedValue({ ok: false, error: { kind: 'rate-limit', retryAfterMs: 5_000 } });
    const enc = encounterFromLegacyBatchInput({
      comments: [{ author: 'a', text: 'a normal benign comment' }],
      videoCaption: 'c',
      language: 'English',
    });
    const result = await scoreBatch(enc);
    expect(result.failed).toBe(true);
    expect(result.comments[0].severity).toBe(0);
    expect(result.comments[0].technique).toBe('none');
  });

  it('failClosed result still carries room-toxicity aggregates', async () => {
    mockCallAI.mockRejectedValue(new Error('x'));
    const enc = encounterFromLegacyBatchInput({
      comments: [
        { author: 'a', text: 'fucking nigger retard psycho idiot moron' },
        { author: 'b', text: 'normal' },
      ],
      videoCaption: 'c',
      language: 'English',
    });
    const result = await scoreBatch(enc);
    expect(result.failed).toBe(true);
    expect(result.environment.toxicityScore).toBeGreaterThan(0);
    expect(result.environment.slurPrevalencePct).toBeGreaterThan(0);
  });
});

// ─── Concern 3b: failClosed must run the SAME deterministic catchers the ──
// success path runs. When the AI is unavailable (free tier, rate-limit,
// network outage, unsupported-script gate), execution takes the failClosed
// path. Pre-fix, failClosed escalated ONLY on identity-slur match and
// harm-floor score >= 70 — it skipped detectCodedHarm. That means directed
// self-harm ("kys"), narrated violence, and coded-scapegoating silently
// passed at sev=0 for every free-tier child and every AI outage, even though
// the AI-on path catches them via the coded-harm override gate. The catcher's
// own header claims it closes the "free-tier / rate-limited / fail-closed"
// gap; this concern is the test that the wiring actually delivers that.

describe('failClosed runs deterministic coded-harm catchers (AI-off parity)', () => {
  it('directed self-harm "kill yourself" + AI down → hide-tier sev>=9 (not silent sev=0)', async () => {
    mockCallAI.mockRejectedValue(new Error('groq down'));
    const enc = encounterFromLegacyBatchInput({
      // No profanity / slur / ad-hominem token → harm-floor score ~0, so the
      // existing HF>=70 fallback cannot catch this. Only detectCodedHarm can.
      comments: [{ author: 'a', text: 'nobody likes you, just kill yourself already' }],
      videoCaption: 'c',
      language: 'English',
    });
    const result = await scoreBatch(enc);
    expect(result.failed).toBe(true);
    expect(result.comments[0].severity).toBeGreaterThanOrEqual(9);
    expect(result.comments[0].action).toBe('hide');
    expect(result.comments[0].overrideOrigin).toBe('coded-harm');
    expect(result.comments[0].reason).toMatch(/self-harm-encouragement/);
  });

  it('narrated violence + AI down → hide-tier sev>=8', async () => {
    mockCallAI.mockRejectedValue(new Error('groq down'));
    const enc = encounterFromLegacyBatchInput({
      comments: [{ author: 'a', text: 'they threw a petrol bomb right into the crowd' }],
      videoCaption: 'c',
      language: 'English',
    });
    const result = await scoreBatch(enc);
    expect(result.failed).toBe(true);
    expect(result.comments[0].severity).toBeGreaterThanOrEqual(8);
    expect(result.comments[0].action).toBe('hide');
    expect(result.comments[0].overrideOrigin).toBe('coded-harm');
  });

  it('directed sexual solicitation + AI down → hide-tier sev>=9 (predator-behavior floor)', async () => {
    mockCallAI.mockRejectedValue(new Error('groq down'));
    const enc = encounterFromLegacyBatchInput({
      comments: [{ author: 'a', text: 'you look so cute, send me your nudes' }],
      videoCaption: 'c',
      language: 'English',
    });
    const result = await scoreBatch(enc);
    expect(result.failed).toBe(true);
    expect(result.comments[0].severity).toBeGreaterThanOrEqual(9);
    expect(result.comments[0].action).toBe('hide');
    expect(result.comments[0].overrideOrigin).toBe('coded-harm');
  });

  it('coded-scapegoating + AI down → flagged scapegoating sev>=6', async () => {
    mockCallAI.mockRejectedValue(new Error('groq down'));
    const enc = encounterFromLegacyBatchInput({
      comments: [{ author: 'a', text: 'their crime rate is disproportionate, every single one of them' }],
      videoCaption: 'c',
      language: 'English',
    });
    const result = await scoreBatch(enc);
    expect(result.failed).toBe(true);
    expect(result.comments[0].technique).toBe('scapegoating');
    expect(result.comments[0].severity).toBeGreaterThanOrEqual(6);
    expect(result.comments[0].overrideOrigin).toBe('coded-harm');
  });

  it('benign comment + AI down → stays sev=0 (0-FP guard, catcher must not over-fire)', async () => {
    mockCallAI.mockRejectedValue(new Error('groq down'));
    const enc = encounterFromLegacyBatchInput({
      comments: [{ author: 'a', text: 'I think the weather is nice today, going for a walk' }],
      videoCaption: 'c',
      language: 'English',
    });
    const result = await scoreBatch(enc);
    expect(result.failed).toBe(true);
    expect(result.comments[0].technique).toBe('none');
    expect(result.comments[0].severity).toBe(0);
    expect(result.comments[0].action).toBeUndefined();
  });
});

// ─── Concern 4: §CT-41 (2026-05-06) harm-floor verdict-override gate ──────
//
// The §CT-39.B Session 1 prompt-rule (slur-trumps-sarcasm exception) didn't
// take at 8b — measured 2026-05-06 §CT-40 verification round on a Facebook politician page
// permalink: "Şobolane … vine frigu' , ha?" classified as sarcasm sev=3
// both pre and post the prompt-rule landing. §CT-41 addresses this gate-side
// instead of prompt-side: when harm-floor fired AND classifier verdict is
// non-flag at low severity, override to shame-attack with severity 6 (cat
// ad-hominem) or 8 (identity-slur).

describe('§CT-41 harm-floor verdict-override gate', () => {
  it('identity-slur match + low classifier severity → escalates to shame-attack sev=8', async () => {
    mockCallAI.mockResolvedValue(
      llmJson([
        { index: 1, technique: 'sarcasm', sentiment: 'negative', severity: 3, reason: 'mocking tone' },
      ]),
    );
    const enc = encounterFromLegacyBatchInput({
      // Slur dictionary match → identity_slur_match=true → escalate.
      comments: [{ author: 'a', text: 'fucking nigger' }],
      videoCaption: 'c',
      language: 'English',
    });
    const result = await scoreBatch(enc);
    expect(result.comments[0].technique).toBe('shame-attack');
    expect(result.comments[0].severity).toBeGreaterThanOrEqual(8);
    expect(result.comments[0].sentiment).toBe('negative');
    // Honest provenance: a regex slur match set the label, not the AI.
    expect(result.comments[0].overrideOrigin).toBe('identity-slur');
  });

  it('ad-hominem top_category + classifier non-flag + low sev → escalates to shame-attack sev=6', async () => {
    // Classifier returns sarcasm sev=3; harm-floor regex caught the
    // ad-hominem stem ('idiot' in AD_HOMINEM_PATTERNS_EN); override fires.
    mockCallAI.mockResolvedValue(
      llmJson([
        { index: 1, technique: 'sarcasm', sentiment: 'negative', severity: 3, reason: 'cold weather joke' },
      ]),
    );
    const enc = encounterFromLegacyBatchInput({
      comments: [{ author: 'a', text: 'idiot here we go again' }],
      videoCaption: 'c',
      language: 'English',
    });
    const result = await scoreBatch(enc);
    expect(result.comments[0].technique).toBe('shame-attack');
    expect(result.comments[0].severity).toBeGreaterThanOrEqual(6);
    expect(result.comments[0].sentiment).toBe('negative');
    // Design: when classifier's reason is non-empty, preserve it (parent UX
    // keeps the LLM's per-comment explanation). Override only fills reason
    // when classifier left it blank — see next test.
    expect(result.comments[0].reason).toBe('cold weather joke');
  });

  it('fills reason field with harm-floor evidence when classifier reason is empty', async () => {
    mockCallAI.mockResolvedValue(
      llmJson([
        { index: 1, technique: 'genuine-opinion', sentiment: 'neutral', severity: 2, reason: '' },
      ]),
    );
    const enc = encounterFromLegacyBatchInput({
      comments: [{ author: 'a', text: 'idiot moron stupid' }],
      videoCaption: 'c',
      language: 'English',
    });
    const result = await scoreBatch(enc);
    expect(result.comments[0].technique).toBe('shame-attack');
    expect(result.comments[0].reason).toMatch(/harm-floor override/);
  });

  it('ad-hominem flag + classifier already flagged shame-attack sev=6 → no double-escalate', async () => {
    mockCallAI.mockResolvedValue(
      llmJson([
        { index: 1, technique: 'shame-attack', sentiment: 'negative', severity: 6, reason: 'mockery insult' },
      ]),
    );
    const enc = encounterFromLegacyBatchInput({
      // 'idiot' triggers AD_HOMINEM_PATTERNS_EN.
      comments: [{ author: 'a', text: 'big idiot here' }],
      videoCaption: 'c',
      language: 'English',
    });
    const result = await scoreBatch(enc);
    // Classifier already adequate — override should NOT change technique.
    expect(result.comments[0].technique).toBe('shame-attack');
    expect(result.comments[0].severity).toBe(6);
    // Original LLM reason preserved (not overwritten).
    expect(result.comments[0].reason).toBe('mockery insult');
  });

  it('no harm-floor flag → byte-identical to pre-§CT-41 (back-compat)', async () => {
    mockCallAI.mockResolvedValue(
      llmJson([
        { index: 1, technique: 'sarcasm', sentiment: 'negative', severity: 3, reason: 'gentle ribbing' },
      ]),
    );
    const enc = encounterFromLegacyBatchInput({
      // Benign comment — no profanity, slur, ad-hominem.
      comments: [{ author: 'a', text: 'haha that is so true' }],
      videoCaption: 'c',
      language: 'English',
    });
    const result = await scoreBatch(enc);
    // Override does NOT fire when harm-floor flag absent.
    expect(result.comments[0].technique).toBe('sarcasm');
    expect(result.comments[0].severity).toBe(3);
    expect(result.comments[0].reason).toBe('gentle ribbing');
    // AI-origin verdict → no override provenance stamped.
    expect(result.comments[0].overrideOrigin).toBeUndefined();
  });

  it('directed self-harm encouragement → hide-tier override with coded-harm provenance', async () => {
    // LLM under-reads it as a casual sarcastic jab; the deterministic
    // self-harm catcher must escalate it to hide-tier and stamp honest
    // provenance so the chain does not imply the AI diagnosed it.
    mockCallAI.mockResolvedValue(
      llmJson([
        { index: 1, technique: 'sarcasm', sentiment: 'negative', severity: 3, reason: '' },
      ]),
    );
    const enc = encounterFromLegacyBatchInput({
      comments: [{ author: 'a', text: 'nobody likes you, just kill yourself already' }],
      videoCaption: 'c',
      language: 'English',
    });
    const result = await scoreBatch(enc);
    expect(result.comments[0].severity).toBeGreaterThanOrEqual(9);
    expect(result.comments[0].action).toBe('hide');
    expect(result.comments[0].overrideOrigin).toBe('coded-harm');
    expect(result.comments[0].reason).toMatch(/self-harm-encouragement/);
  });

  it('profanity top_category (NOT ad-hominem) does not trigger override', async () => {
    mockCallAI.mockResolvedValue(
      llmJson([
        { index: 1, technique: 'genuine-opinion', sentiment: 'negative', severity: 4, reason: 'frustrated' },
      ]),
    );
    const enc = encounterFromLegacyBatchInput({
      // Pure profanity stack → harm-floor top_category='profanity' (not ad-hominem).
      // identity_slur_match=false (no dict-listed slurs).
      comments: [{ author: 'a', text: 'this is fucking shit man bullshit' }],
      videoCaption: 'c',
      language: 'English',
    });
    const result = await scoreBatch(enc);
    // Override scoped to ad-hominem and identity-slur only — profanity stays as-is.
    expect(result.comments[0].technique).toBe('genuine-opinion');
    expect(result.comments[0].severity).toBe(4);
  });

  it('ad-hominem flag + classifier already flagged manipulation (e.g. fear-appeal) → preserves classifier verdict', async () => {
    mockCallAI.mockResolvedValue(
      llmJson([
        { index: 1, technique: 'fear-appeal', sentiment: 'negative', severity: 7, reason: 'threat language' },
      ]),
    );
    const enc = encounterFromLegacyBatchInput({
      comments: [{ author: 'a', text: 'idiots you will be punished' }],
      videoCaption: 'c',
      language: 'English',
    });
    const result = await scoreBatch(enc);
    // Classifier already flagged → not in NON_FLAG_TECHNIQUES → no override.
    expect(result.comments[0].technique).toBe('fear-appeal');
    expect(result.comments[0].severity).toBe(7);
  });
});

// ─── Concern 4b: D-3 — success-path general harm-floor floor (AI parity) ──
//
// failClosed escalates ANY comment with harm-floor score >= 70 to sev 7-9
// (comment-batch-scorer.ts ~913-930). The AI-SUCCESS override gate only had
// the identity-slur and ad-hominem-top-category branches — so a comment that
// stacks profanity + ideology + caps + crowd to HF>=70 (top_category NOT
// ad-hominem, no dict slur) that the 8b under-rates was routed to PASS. That
// makes detection STRICTLY WORSE when the AI succeeds than when it fails. The
// success path now carries the SAME HF>=70 floor. The HF>=70 condition is
// 0-FP-validated by scripts/corpus/deterministic-floor-fp-probe.ts, so this
// adds no new false-positive surface.

const HF70_NONSLUR_NONADHOM =
  'FUCKING BULLSHIT ASSHOLE SHIT you absolute idiot moron COMMUNIST NAZI FASCIST LIBTARD WOKE GLOBALIST we are watching you everyone tag him!!!';
// Measured: computeHarmFloor score 75, top_category 'profanity', identity_slur_match false.

describe('D-3 success-path harm-floor floor (AI-on/off parity)', () => {
  it('HF>=70 (non-slur, non-ad-hominem-top) + 8b under-rates → escalates to sev>=7', async () => {
    mockCallAI.mockResolvedValue(
      llmJson([
        { index: 1, technique: 'genuine-opinion', sentiment: 'neutral', severity: 2, reason: 'just venting' },
      ]),
    );
    const result = await scoreBatch(encounterFromLegacyBatchInput({
      comments: [{ author: 'a', text: HF70_NONSLUR_NONADHOM }],
      videoCaption: 'c',
      language: 'English',
    }));
    expect(result.comments[0].severity).toBeGreaterThanOrEqual(7);
    expect(result.comments[0].sentiment).toBe('negative');
    // Must not stay a NON_MANIPULATION technique (else isManipulative routes to PASS).
    expect(result.comments[0].technique).not.toBe('genuine-opinion');
    expect(result.comments[0].technique).not.toBe('none');
    expect(result.comments[0].overrideOrigin).toBe('harm-floor');
  });

  it('matches the failClosed floor for the SAME comment (no AI-on < AI-off gap)', async () => {
    // AI-on: success path with an under-rating LLM.
    mockCallAI.mockResolvedValueOnce(
      llmJson([{ index: 1, technique: 'genuine-opinion', sentiment: 'neutral', severity: 2, reason: '' }]),
    );
    const onResult = await scoreBatch(encounterFromLegacyBatchInput({
      comments: [{ author: 'a', text: HF70_NONSLUR_NONADHOM }],
      videoCaption: 'c', language: 'English',
    }));
    __resetBatchCacheForTests();
    // AI-off: failClosed path.
    mockCallAI.mockRejectedValueOnce(new Error('groq down'));
    const offResult = await scoreBatch(encounterFromLegacyBatchInput({
      comments: [{ author: 'a', text: HF70_NONSLUR_NONADHOM }],
      videoCaption: 'c', language: 'English',
    }));
    expect(onResult.comments[0].severity).toBeGreaterThanOrEqual(offResult.comments[0].severity);
  });

  it('does NOT escalate a sub-70 comment (no new false positives)', async () => {
    mockCallAI.mockResolvedValue(
      llmJson([{ index: 1, technique: 'genuine-opinion', sentiment: 'negative', severity: 3, reason: 'frustrated' }]),
    );
    const result = await scoreBatch(encounterFromLegacyBatchInput({
      // profanity-only stack — harm-floor ~20, well under 70.
      comments: [{ author: 'a', text: 'this is fucking shit man bullshit' }],
      videoCaption: 'c', language: 'English',
    }));
    expect(result.comments[0].technique).toBe('genuine-opinion');
    expect(result.comments[0].severity).toBe(3);
    expect(result.comments[0].overrideOrigin).toBeUndefined();
  });

  it('D-4: explicit porn-jargon the 8b under-rates is hidden on the success path', async () => {
    // The profanity-tier hide gate only fires at LLM sev>=8; explicit content
    // the 8b scores low slipped through. The sexual-explicit coded-harm catcher
    // now hides it regardless of the AI's severity (via the override gate's
    // notYetFlagged path).
    mockCallAI.mockResolvedValue(
      llmJson([{ index: 1, technique: 'genuine-opinion', sentiment: 'neutral', severity: 2, reason: 'looks fine' }]),
    );
    const result = await scoreBatch(encounterFromLegacyBatchInput({
      comments: [{ author: 'a', text: 'watch her deepthroating in this clip' }],
      videoCaption: 'c', language: 'English',
    }));
    expect(result.comments[0].action).toBe('hide');
    expect(result.comments[0].severity).toBeGreaterThanOrEqual(8);
    expect(result.comments[0].overrideOrigin).toBe('coded-harm');
  });

  it('does NOT downgrade a verdict the 8b already rated higher (Math.max floor)', async () => {
    mockCallAI.mockResolvedValue(
      llmJson([{ index: 1, technique: 'fear-appeal', sentiment: 'negative', severity: 9, reason: 'explicit threat' }]),
    );
    const result = await scoreBatch(encounterFromLegacyBatchInput({
      comments: [{ author: 'a', text: HF70_NONSLUR_NONADHOM }],
      videoCaption: 'c', language: 'English',
    }));
    // LLM already adequate — keep its technique + severity, do not pull down.
    expect(result.comments[0].technique).toBe('fear-appeal');
    expect(result.comments[0].severity).toBe(9);
  });
});

// ─── Concern 5: harm-floor override fires on truncation-defaulted indices ──
//
// When the LLM truncates its response mid-array (max_tokens cutoff), the
// scoreBatch index-fill loop populates the omitted slots with default
// 'none' / sev=0 verdicts AND records the indices in `truncatedIndices`.
// The §CT-41 override gate then iterates over all `comments`, including
// those defaults. For a truncated slot whose underlying text carries a
// harm-floor signal (identity-slur match, ad-hominem regex hit), the gate
// MUST still fire — otherwise a slur-laden comment that happened to fall
// past the LLM's token budget would chain-record as sev=0 (or as `cancelled-
// batch-truncated` by the caller). VISION §1.2 protection-record honesty:
// the deterministic gate's verdict is the protection floor.
//
// Caller (content/index.ts:flushBatch) relies on this: when a truncated
// index has been escalated by the override gate, the caller routes it to
// FORENSIC_LOG (using the deterministic verdict) instead of CANCEL_LOG. If
// the override didn't fire (no harm-floor signal on the truncated slot),
// the caller still emits CANCEL_LOG since there's no deterministic verdict
// to honor.

describe('harm-floor override on truncation-defaulted indices', () => {
  it('identity-slur match on a truncation-omitted index → override escalates to sev=8 hide', async () => {
    // LLM returns a verdict ONLY for index 1; index 2 omitted (simulates
    // max_tokens truncation mid-array).
    mockCallAI.mockResolvedValue(
      llmJson([
        { index: 1, technique: 'genuine-opinion', sentiment: 'neutral', severity: 1, reason: '' },
      ]),
    );
    const enc = encounterFromLegacyBatchInput({
      comments: [
        { author: 'a', text: 'pretty normal comment, no signal' },
        // Index 2 — slur-laden, omitted by mock LLM.
        { author: 'b', text: 'fucking nigger retard' },
      ],
      videoCaption: 'c',
      language: 'English',
    });
    const result = await scoreBatch(enc);
    // Index 2 is recorded as truncated.
    expect(result.truncatedIndices).toEqual([2]);
    // Override gate fired on the truncated default → escalated to shame-
    // attack sev=8 with hide action. NOT the silent 'none'/sev=0 default.
    expect(result.comments[1].technique).toBe('shame-attack');
    expect(result.comments[1].severity).toBeGreaterThanOrEqual(8);
    expect(result.comments[1].action).toBe('hide');
  });

  it('ad-hominem signal on a truncated index → override escalates to sev=6 shame-attack', async () => {
    // LLM verdict only for index 1; index 2 omitted.
    mockCallAI.mockResolvedValue(
      llmJson([
        { index: 1, technique: 'genuine-opinion', sentiment: 'neutral', severity: 1, reason: '' },
      ]),
    );
    const enc = encounterFromLegacyBatchInput({
      comments: [
        { author: 'a', text: 'totally benign here' },
        // Index 2 — ad-hominem stem, omitted.
        { author: 'b', text: 'idiot moron stupid here we go' },
      ],
      videoCaption: 'c',
      language: 'English',
    });
    const result = await scoreBatch(enc);
    expect(result.truncatedIndices).toEqual([2]);
    // Override fires on truncated default (severity 0 = classifier non-flag
    // low-sev). Escalated to shame-attack sev=6.
    expect(result.comments[1].technique).toBe('shame-attack');
    expect(result.comments[1].severity).toBeGreaterThanOrEqual(6);
    expect(result.comments[1].sentiment).toBe('negative');
  });

  it('truncated index with NO harm-floor signal stays sev=0 (no override fires)', async () => {
    // LLM verdict only for index 1; index 2 omitted.
    mockCallAI.mockResolvedValue(
      llmJson([
        { index: 1, technique: 'genuine-opinion', sentiment: 'neutral', severity: 1, reason: '' },
      ]),
    );
    const enc = encounterFromLegacyBatchInput({
      comments: [
        { author: 'a', text: 'first comment' },
        // Index 2 — benign text, no slur, no ad-hominem; omitted.
        { author: 'b', text: 'I think the weather is nice today' },
      ],
      videoCaption: 'c',
      language: 'English',
    });
    const result = await scoreBatch(enc);
    expect(result.truncatedIndices).toEqual([2]);
    // No harm-floor signal → override does not fire → default verdict.
    // Caller (content/index.ts) routes this to CANCEL_LOG, not FORENSIC_LOG.
    expect(result.comments[1].technique).toBe('none');
    expect(result.comments[1].severity).toBe(0);
    expect(result.comments[1].action).toBeUndefined();
  });
});

// ─── Child-mode profanity floor (2026-06-19) ──────────────────────────────────
// MEASURED child-recall gap: profanity comments the model scores benign/low pass
// in child mode (the comment path lacks the post path's profanity age-modifier).
// The child floor flags them as technique='profanity' at the flag line, routing
// to the rewrite (soften) path per the locked 2026-06-10 decision. Teen/adult
// untouched.
describe('child-mode profanity floor', () => {
  const benignProfanityVerdict = () =>
    llmJson([
      { index: 1, technique: 'genuine-opinion', sentiment: 'neutral', severity: 2, reason: 'ordinary take' },
    ]);
  const input = {
    comments: [{ author: 'gamer22', text: 'this update is fucking awful honestly' }],
    videoCaption: 'patch notes',
    language: 'English',
  };

  it('CHILD: floors a model-benign profanity comment to flagged profanity (soften, not hide)', async () => {
    mockCallAI.mockImplementation(async () => benignProfanityVerdict());
    const result = await scoreBatch(encounterFromLegacyBatchInput(input), 'child');
    const v = result.comments[0];
    expect(v.technique).toBe('profanity');
    expect(v.severity).toBeGreaterThanOrEqual(6);
    expect(isManipulative(v)).toBe(true);
    expect(v.action).not.toBe('hide'); // soften (rewrite), not hide, per the house-rule decision
  });

  it('TEEN: the same low-severity profanity comment is NOT flagged (teen drops profanity softening)', async () => {
    mockCallAI.mockImplementation(async () => benignProfanityVerdict());
    const result = await scoreBatch(encounterFromLegacyBatchInput(input), 'teen');
    const v = result.comments[0];
    expect(v.technique).toBe('genuine-opinion');
    expect(isManipulative(v)).toBe(false);
  });

  it('CHILD: a clean (non-profane) benign comment stays benign — floor does not over-fire', async () => {
    mockCallAI.mockImplementation(async () =>
      llmJson([{ index: 1, technique: 'genuine-opinion', sentiment: 'neutral', severity: 1, reason: 'fine' }]),
    );
    const clean = { comments: [{ author: 'u', text: 'this update is a bit disappointing honestly' }], videoCaption: 'patch notes', language: 'English' };
    const result = await scoreBatch(encounterFromLegacyBatchInput(clean), 'child');
    expect(isManipulative(result.comments[0])).toBe(false);
  });
});
