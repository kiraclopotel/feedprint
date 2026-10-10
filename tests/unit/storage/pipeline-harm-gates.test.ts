/** @vitest-environment jsdom */
// H6 + H7 — single-post pipeline (src/analysis/pipeline.ts) safety gates.
//
// H6: the global flush-budget circuit-breaker (recordFailure/isHolding,
//     ../ai/global-flush-budget) was used only by the BATCH path. The
//     single-post path never honored the hold, so cascading Groq failures
//     on the post path were unthrottled. Fix wires the post path to the
//     same shared hold: isHolding() short-circuits before the LLM call;
//     a failed LLM call arms recordFailure().
//
// H7: the blanket profanity-soften branch shipped a calm rewrite for ANY
//     profane post that matched, bypassing the dehumanization /
//     violence-narrating-video / harm-laundering gates that route to HIDE
//     elsewhere in this file. "these fucking rats should be exterminated"
//     got a green rewrite instead of being hidden. Fix re-runs the three
//     deterministic gates inside the branch; a trip routes to HIDE. Benign
//     register profanity trips none — it still softens (no new FP).
//
// These exercise the full process() flow, so the I/O-coupled dependencies
// (settings/license/cache/LLM/threshold) are mocked. The deterministic
// safety filters (profanity / dehumanization / violence-narration /
// harm-laundering) and the real global-flush-budget module run live so the
// gate wiring itself is what's under test.

import { afterEach, describe, it, expect, beforeEach, vi } from 'vitest';

type NeutralizeTextArgs = Parameters<
  (typeof import('../../../src/ai/neutralize-only'))['neutralizeText']
>;
type CombinedDetectArgs = Parameters<
  (typeof import('../../../src/core/neutralizer'))['combinedDetectAndNeutralize']
>;

vi.mock('../../../src/storage/settings', () => ({
  getSettings: vi.fn(),
  // Real toggle semantics for the Q4 soften gate: read the features grid the
  // fixture provides. Fixtures without a grid behave as toggle-off, which is
  // why the H7 cases below carry soften-swearing enabled explicitly.
  isFeatureEnabled: (
    settings: { features?: Record<string, { enabled?: boolean }> },
    id: string,
  ) => settings.features?.[id]?.enabled === true,
}));
vi.mock('../../../src/storage/license', () => ({
  getLicense: vi.fn(async () => ({ tier: 'family', secret: 's' })),
  dailyCapForTier: vi.fn(() => 2000),
  effectiveMonthlyTokenCap: vi.fn(() => 1_000_000),
  isUncappedTier: vi.fn(() => false),
}));
vi.mock('../../../src/storage/cache', () => ({
  processingCache: {
    getPersistent: vi.fn(async () => null),
    set: vi.fn(),
  },
}));
vi.mock('../../../src/core/calibration', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/core/calibration')>()),
  getEffectiveThreshold: vi.fn(async () => 0.45),
}));
// EVIDENCE-PATH-2: the author profile store is extension-origin IndexedDB
// that only the service worker writes. The pipeline asks the worker with
// GET_AUTHOR_PROFILE; this stub stands in for the worker's reply. The real
// author-store and author-profile-client modules run (jsdom here is a page
// origin, so the store's realm guard refuses any direct open).
const sentMessages: unknown[] = [];
let authorProfileReply: unknown = { ok: true, profile: null };
(globalThis as { chrome?: unknown }).chrome = {
  runtime: {
    id: 'fw-test',
    sendMessage: vi.fn(async (message: unknown) => {
      sentMessages.push(message);
      return authorProfileReply;
    }),
  },
};
const lastFailureKindMock = vi.fn<() => string | null>(() => null);
vi.mock('../../../src/ai/client', () => ({
  getLastCallMeta: vi.fn(() => ({ model: 'llama-3.1-8b-instant', provider: 'groq' })),
  getLastFailureKind: () => lastFailureKindMock(),
}));
// neutralizeText drives the H7 soften branch — return a "calm" rewrite
// that has scrubbed the violence (the laundering failure mode) so the
// gates, not the rewrite, decide the verdict.
const neutralizeTextMock = vi.fn(async (..._args: NeutralizeTextArgs) =>
  'I strongly disagree with these people.'
);
vi.mock('../../../src/ai/neutralize-only', () => ({
  neutralizeText: (...args: NeutralizeTextArgs) => neutralizeTextMock(...args),
}));
// combinedDetectAndNeutralize is the post-path LLM call gated by H6. Track
// whether it was invoked so the isHolding() short-circuit can be asserted.
type CombinedDetectResult = Awaited<ReturnType<(typeof import('../../../src/core/neutralizer'))['combinedDetectAndNeutralize']>>;
const combinedMock = vi.fn(async (..._args: CombinedDetectArgs): Promise<CombinedDetectResult> => ({
  analysis: {
    postId: 'x',
    isManipulative: false,
    overallScore: 0,
    overallConfidence: 0,
    processingTimeMs: 1,
    techniques: [],
    primaryTechnique: undefined,
    action: undefined,
  },
  neutralized: null,
}));
vi.mock('../../../src/core/neutralizer', () => ({
  combinedDetectAndNeutralize: (...args: CombinedDetectArgs) => combinedMock(...args),
}));

import { process } from '../../../src/analysis/pipeline';
import { detect } from '../../../src/core/detector';
import { _resetAuthorProfileCacheForTests } from '../../../src/forensics/author-profile-client';
import { getSettings } from '../../../src/storage/settings';
import { _resetForTests as resetFlushBudget, recordFailure } from '../../../src/ai/global-flush-budget';
import type { PostContent } from '../../../src/types/post';

const baseSettings = {
  mode: 'teen',
  strictLanguage: true,
  locale: 'en',
  outputLanguage: 'auto',
  dailyCap: 2000,
  monthlyUsdCapOverride: null,
  totalChecksToday: 0,
  totalTokensThisMonth: 0,
};

function setMode(overrides: Record<string, unknown> = {}) {
  (getSettings as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ...baseSettings, ...overrides });
}

function makePost(text: string, kind?: PostContent['kind']): PostContent {
  return {
    id: 'p1',
    text,
    author: '@u',
    timestamp: new Date().toISOString(),
    platform: 'twitter',
    kind,
    domRef: new WeakRef(document.createElement('div')),
  } as PostContent;
}

beforeEach(() => {
  resetFlushBudget();
  sentMessages.length = 0;
  authorProfileReply = { ok: true, profile: null };
  _resetAuthorProfileCacheForTests();
  combinedMock.mockClear();
  neutralizeTextMock.mockClear();
  neutralizeTextMock.mockResolvedValue('I strongly disagree with these people.');
});

// ── H7 — blanket profanity-soften must not bypass the harm gates ──────────
describe('H7 — profanity-soften routes harmful content to HIDE, benign to neutralize', () => {
  it('profane + dehumanizing post → HIDE (not a soften rewrite)', async () => {
    // teen + strictLanguage = blanketProfanitySoften true, profanity matches,
    // and the child-mode step-0b HIDE does NOT fire (teen mode), so this
    // lands in the soften branch — exactly the bypassed path.
    setMode({ mode: 'teen', strictLanguage: true });
    const result = await process(makePost('these fucking rats should be exterminated from our country'));
    expect(result.action).toBe('hide');
    expect(result.analysis?.primaryTechnique).toBe('extreme-toxicity');
    // The calm rewrite must NOT have been shipped.
    expect(result.neutralized).toBeUndefined();
  });

  it('benign register profanity → masked in place, no model call (2026-09-07)', async () => {
    setMode({ mode: 'teen', strictLanguage: true });
    const result = await process(makePost('this movie was fucking amazing honestly'));
    expect(result.action).toBe('neutralize');
    // Stars on the vulgar word, every other word as written; the rewriter is never asked.
    expect(result.neutralized?.rewrittenText).toBe('this movie was ******* amazing honestly');
    expect(result.neutralized?.aiSource).toBe('rules');
    expect(result.detectionMode).toBe('profanity-mask:1');
    expect(neutralizeTextMock).not.toHaveBeenCalled();
  });

  it('a mask cannot launder: every non-vulgar word of a violent caption survives, and the gates still see it', async () => {
    setMode({ mode: 'teen', strictLanguage: true });
    // Until 2026-09-07 this case tripped the harm-laundering gate because the
    // mocked calm rewrite dropped the lethal content. A mask changes only the
    // vulgar word, so the sentence keeps its violence for every later gate and
    // for the reader's own judgement; nothing is laundered and nothing is hidden
    // on the strength of a rewrite that no longer exists.
    const result = await process(makePost('i fucking hope someone stabs that guy, he deserves to die'));
    expect(result.detectionMode).not.toBe('harm-laundering');
    if (result.action === 'neutralize') {
      expect(result.neutralized?.rewrittenText).toBe('i ******* hope someone stabs that guy, he deserves to die');
    }
    expect(neutralizeTextMock).not.toHaveBeenCalled();
  });

  it('profane + violence-narrating VIDEO caption → HIDE', async () => {
    setMode({ mode: 'teen', strictLanguage: true });
    // Dictionary profanity routes this into the soften branch (which, pre-fix,
    // returned a green rewrite BEFORE the step-0c.1 video gate could run). The
    // in-branch video gate must now catch the narrated violence and HIDE.
    const result = await process(
      makePost('this is fucking insane — a young man was beaten and forced to perform a dance', 'video'),
    );
    expect(result.action).toBe('hide');
    expect(result.analysis?.primaryTechnique).toBe('violence-graphic');
  });
});

// ── M12 — violence-narrating VIDEO gate is carved out for adult mode ──────
// The standalone step-0c.1 gate previously fired for child | teen | adult, so
// an adult-mode war/medical video caption was hidden. Adult = lightest /
// transparency-first (mirrors the step-0b profanity-HIDE adult carve-out).
// Caption is profanity-free so it bypasses the soften branch and reaches the
// standalone gate. Reduces over-block (no false positives added).
describe('M12 — violence-narrating video gate does not fire for adult mode', () => {
  it('adult-mode narrated-violence VIDEO caption → NOT hidden by the gate', async () => {
    setMode({ mode: 'adult', strictLanguage: false });
    const result = await process(
      makePost('a young man was beaten and forced to perform a dance', 'video'),
    );
    expect(result.detectionMode).not.toBe('violence-narrating-video');
    expect(result.action).not.toBe('hide');
  });

  it('teen-mode same caption → still HIDE (gate intact for teen)', async () => {
    setMode({ mode: 'teen', strictLanguage: false });
    const result = await process(
      makePost('a young man was beaten and forced to perform a dance', 'video'),
    );
    expect(result.action).toBe('hide');
    expect(result.detectionMode).toBe('violence-narrating-video');
    expect(result.analysis?.primaryTechnique).toBe('violence-graphic');
  });
});

// ── H6 — single-post path honors the global flush-budget circuit-breaker ──
describe('H6 — post path short-circuits while the flush-budget hold is armed', () => {
  it('isHolding() true → no LLM call, pass with pre-llm-ai-call-failed', async () => {
    setMode({ mode: 'teen', strictLanguage: false });
    // Arm the hold: 3 failures inside the 10s window.
    recordFailure();
    recordFailure();
    recordFailure();
    // A clean, non-profane, substantive post that would otherwise reach the LLM.
    const result = await process(makePost('I really think you should reconsider your plan here today'));
    expect(result.action).toBe('pass');
    expect(result.passContext?.reason).toBe('pre-llm-ai-call-failed');
    expect(combinedMock).not.toHaveBeenCalled();
    // The breaker declining to place a call is not a vendor failure. Three
    // states used to share this one reason string; the record now separates
    // them, and reading this one as 'network' would invent an outage.
    expect(result.passContext?.failureKind).toBe('pre-llm-circuit-breaker');
  });

  it('an exception inside FeelingWise reads as internal-error, not as the vendor failing', async () => {
    setMode({ mode: 'teen', strictLanguage: false });
    combinedMock.mockImplementationOnce(() => { throw new Error('boom'); });
    const result = await process(makePost('I really think you should reconsider your plan here today'));
    expect(result.action).toBe('pass');
    expect(result.passContext?.reason).toBe('pre-llm-ai-call-failed');
    expect(result.passContext?.failureKind).toBe('internal-error');
  });

  it('a genuine call failure carries the vendor failure kind', async () => {
    setMode({ mode: 'teen', strictLanguage: false });
    // The cascade collapses a failure to null before the pipeline sees it, so
    // the kind has to survive that boundary or the record cannot name it.
    combinedMock.mockResolvedValueOnce(null);
    lastFailureKindMock.mockReturnValueOnce('auth-refusal');
    const result = await process(makePost('I really think you should reconsider your plan here today'));
    expect(result.action).toBe('pass');
    expect(result.passContext?.reason).toBe('pre-llm-ai-call-failed');
    expect(result.passContext?.failureKind).toBe('auth-refusal');
  });

  it('hold NOT armed → the LLM call runs as normal', async () => {
    setMode({ mode: 'teen', strictLanguage: false });
    const result = await process(makePost('I really think you should reconsider your plan here today'));
    expect(combinedMock).toHaveBeenCalledTimes(1);
    // mocked LLM says not-manipulative → pass
    expect(result.action).toBe('pass');
  });
});

afterEach(() => {
  resetFlushBudget();
});

describe('M46, then the mask: swearing is handled without a model, so the paid gates no longer apply to it', () => {
  it('masks while the circuit hold is armed: no model call, stars on the page', async () => {
    setMode({ mode: 'teen', strictLanguage: true });
    recordFailure(); recordFailure(); recordFailure();
    const result = await process(makePost('this movie was fucking amazing honestly'));
    expect(neutralizeTextMock).not.toHaveBeenCalled();
    expect(result.action).toBe('neutralize');
    expect(result.neutralized?.rewrittenText).toBe('this movie was ******* amazing honestly');
  });

  it('masks after the monthly token cap: the free path does not depend on the spend', async () => {
    setMode({ mode: 'teen', strictLanguage: true, totalTokensThisMonth: 1_000_000 });
    const result = await process(makePost('this movie was fucking amazing honestly'));
    expect(neutralizeTextMock).not.toHaveBeenCalled();
    expect(result.action).toBe('neutralize');
    expect(result.detectionMode).toBe('profanity-mask:1');
  });

  it('still applies deterministic hide while the circuit hold is armed', async () => {
    setMode({ mode: 'teen', strictLanguage: true });
    recordFailure(); recordFailure(); recordFailure();
    const result = await process(makePost('these fucking rats should be exterminated from our country'));
    expect(neutralizeTextMock).not.toHaveBeenCalled();
    expect(result.action).toBe('hide');
    expect(result.analysis?.primaryTechnique).toBe('extreme-toxicity');
  });
});

// ── Sponsored gate is age-gated (2026-08-02) ──────────────────────────────
//
// The gate had no mode check, so it blocked in every mode and stamped
// 'consumer-rapid-frame' from nothing but the platform ad marker. Adult never
// blocks elsewhere in the app, and an ad is a category rather than a technique.
describe('sponsored/ad gate — child and teen block, adult does not', () => {
  function sponsored(): PostContent {
    return { ...makePost('50% off today only, use code SAVE50'), is_sponsored: true } as PostContent;
  }

  it('child mode still collapses a sponsored post', async () => {
    setMode({ mode: 'child' });
    const result = await process(sponsored());
    expect(result.action).toBe('collapse');
    expect(result.detectionMode).toBe('sponsored-ad');
  });

  it('teen mode still collapses a sponsored post', async () => {
    setMode({ mode: 'teen' });
    const result = await process(sponsored());
    expect(result.action).toBe('collapse');
    expect(result.detectionMode).toBe('sponsored-ad');
  });

  it('adult mode does not treat the ad marker as a detected technique', async () => {
    setMode({ mode: 'adult' });
    const result = await process(sponsored());
    expect(result.detectionMode).not.toBe('sponsored-ad');
  });
});

// ── E1 — adult sponsored verdict: visual gate lives on, record shape differs ──
//
// Owner live report 2026-08-04: "Block ads" ON did nothing on x.com/home in
// adult mode — the 2026-08-02 carve-out removed the adult VERDICT entirely, so
// the content-side Block Ads visual gate (which only fires on sponsored-ad
// detection modes) never ran. The fix splits the two concerns the carve-out
// conflated: the pipeline now emits an adult sponsored verdict again (so the
// toggle can act), but with a technique-free analysis and its own detection
// mode ('sponsored-ad:adult') so the ad can never enter the record as a
// detected manipulation (the valid half of 2026-08-02 §3d: 11/85 sampled
// false alarms were ads recorded as 'consumer-rapid-frame').
describe('E1 — adult sponsored verdict carries no manipulation technique', () => {
  function sponsored(): PostContent {
    return { ...makePost('50% off today only, use code SAVE50'), is_sponsored: true } as PostContent;
  }

  it('adult mode emits a collapse verdict so the Block Ads visual gate can act', async () => {
    setMode({ mode: 'adult' });
    const result = await process(sponsored());
    expect(result.action).toBe('collapse');
    expect(result.detectionMode).toBe('sponsored-ad:adult');
    // Deterministic gate — the LLM must not have been consulted for an ad.
    expect(combinedMock).not.toHaveBeenCalled();
  });

  it('the adult verdict analysis is category-only: no technique, not manipulative', async () => {
    setMode({ mode: 'adult' });
    const result = await process(sponsored());
    expect(result.analysis?.isManipulative).toBe(false);
    expect(result.analysis?.techniques).toEqual([]);
    expect(result.analysis?.primaryTechnique).toBeUndefined();
  });

  it('child/teen keep the deterministic consumer-rapid-frame record shape', async () => {
    setMode({ mode: 'child' });
    const result = await process(sponsored());
    expect(result.detectionMode).toBe('sponsored-ad');
    expect(result.analysis?.primaryTechnique).toBe('consumer-rapid-frame');
    expect(result.analysis?.isManipulative).toBe(true);
  });
});

// ── The author profile is read for the exposure notice and moves no verdict ──
//
// Before 2.5.1 a "repeat offender" profile (5+ sightings, more than half of
// them flagged) raised every present L1 confidence by 0.15 before the judge
// saw the post, so the record correlated verdicts by account, which the DPIA
// denies. The profile is still asked for (GET_AUTHOR_PROFILE, the service
// worker's realm; EVIDENCE-PATH-2) because the exposure notice counts on it,
// and it changes nothing the judge is shown.
describe('the author profile feeds the exposure notice only', () => {
  const urgent = 'ACT NOW before it is too late!!! Only 2 left, everyone is buying, do not miss out';

  function presentConfidences(techniques: Array<{ present: boolean; technique: string; confidence: number }>) {
    return Object.fromEntries(techniques.filter(t => t.present).map(t => [t.technique, t.confidence]));
  }

  it('asks the worker for the post author on its platform', async () => {
    setMode({ mode: 'teen', strictLanguage: false });
    await process(makePost(urgent));
    expect(sentMessages).toContainEqual({
      type: 'GET_AUTHOR_PROFILE',
      payload: { handle: '@u', platform: 'twitter' },
    });
  });

  it('a repeat offender in the worker reply changes no L1 confidence the judge is shown', async () => {
    setMode({ mode: 'teen', strictLanguage: false });
    authorProfileReply = {
      ok: true,
      profile: {
        profileKey: '@u@twitter',
        handle: '@u',
        platform: 'twitter',
        totalSeen: 10,
        totalFlagged: 8,
        techniques: {},
        firstSeen: '2026-08-01T00:00:00.000Z',
        lastSeen: '2026-08-20T00:00:00.000Z',
      },
    };
    const plain = presentConfidences(detect(urgent, '@u', 'twitter'));
    expect(Object.keys(plain).length).toBeGreaterThan(0);

    await process(makePost(urgent));

    expect(combinedMock).toHaveBeenCalledTimes(1);
    expect(presentConfidences(combinedMock.mock.calls[0][1])).toEqual(plain);
  });

  it('an unknown author (worker replies null) leaves L1 confidences untouched', async () => {
    setMode({ mode: 'teen', strictLanguage: false });
    const plain = presentConfidences(detect(urgent, '@u', 'twitter'));
    await process(makePost(urgent));
    expect(presentConfidences(combinedMock.mock.calls[0][1])).toEqual(plain);
  });
});

describe('the judge is told the kind and shown the parent (2026-09-07, X-ray C3)', () => {
  it('a top-comment with a parent reaches the judge as kind comment with its parent text', async () => {
    setMode({ mode: 'adult', strictLanguage: false });
    const post = { ...makePost('a reply that needs its parent to be read', 'top-comment'), parentText: 'the post it replies to' } as PostContent;
    await process(post);
    expect(combinedMock).toHaveBeenCalled();
    const opts = combinedMock.mock.calls[0][6] as { kind?: string; parentText?: string };
    expect(opts.kind).toBe('comment');
    expect(opts.parentText).toBe('the post it replies to');
  });

  it('a root post reaches the judge as kind post with no parent', async () => {
    setMode({ mode: 'adult', strictLanguage: false });
    await process(makePost('a plain root post with enough words to reach the judge'));
    const opts = combinedMock.mock.calls[0][6] as { kind?: string; parentText?: string };
    expect(opts.kind).toBe('post');
    expect(opts.parentText).toBeUndefined();
  });
});

// ── Child-mode step 0b against run-together words (PLAN-2026-09-14 item 5) ──
// The owner saw "dickheadmotherfucker" in his own feed on 14 Sep. Step 0b is
// the gate that hides it before any model is asked, so the fix is proved here
// as well as in the filter's own suite: a compound reaches the hide, and an
// ordinary word that merely contains a stem does not.
describe('step 0b hides run-together profanity in Child mode', () => {
  it('hides a post whose insult is run together, before any model call', async () => {
    setMode({ mode: 'child', strictLanguage: true });
    const result = await process(makePost('you absolute dickheadmotherfucker nobody asked you'));
    expect(result.action).toBe('hide');
    expect(result.analysis?.primaryTechnique).toBe('profanity');
    expect(combinedMock).not.toHaveBeenCalled();
    expect(neutralizeTextMock).not.toHaveBeenCalled();
  });

  it('hides a compound the stem gate alone could not reach', async () => {
    // 'ass' is three characters and therefore exact-only; before the
    // segmentation pass this post went to the model as if it were clean.
    setMode({ mode: 'child', strictLanguage: true });
    const result = await process(makePost('what an assfuck of a decision that was honestly'));
    expect(result.action).toBe('hide');
    expect(result.analysis?.primaryTechnique).toBe('profanity');
  });

  it('does NOT hide an ordinary post that merely contains a stem', async () => {
    setMode({ mode: 'child', strictLanguage: true });
    const result = await process(makePost('my assistant booked the classic cocktail bar for Friday'));
    expect(result.action).not.toBe('hide');
  });
});
