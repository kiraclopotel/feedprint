// FeelingWise — Rewrite-only neutralizer for batch-flagged comments.
//
// Without this path, `src/content/index.ts:flushBatch` would emit
// every FORENSIC_LOG with hardcoded `neutralizedText: ''` because the
// BATCH prompt (`buildBatchPromptV3`) only emits per-comment
// classifications, not rewrites. Per VISION §1.2 + the first-person
// voice-reframing memory, every flagged comment should land in the
// chain WITH a first-person rewrite the parent can review. After the
// BATCH classifies a comment as manipulative, this module awaits a
// focused 2nd LLM call that produces JUST the rewrite, inheriting
// voice rules verbatim from `prompts.ts:NEUTRALIZATION_SYSTEM`.
//
// Why a separate file rather than reuse `combinedDetectAndNeutralize`:
// - Calling combined would re-classify (potentially disagreeing with the BATCH).
// - Combined is detect+rewrite in one prompt; here the technique is already
//   known from the BATCH, so a rewrite-only path is the surgical fit.
// - Voice rules live in NEUTRALIZATION_SYSTEM verbatim — we INHERIT, not
//   duplicate, per `feedback_first_person_voice_reframing.md`.
//
// Failure mode: any error / empty response → return '' (graceful degradation;
// caller falls back to the pre-empty-string FORENSIC_LOG behavior).
// Per VISION §1.1 the chain still gets the FORENSIC_LOG record either way.

import { callAI, GROQ_FAST_MODEL } from './client';
import { callProvenanceFor } from './call-provenance';
import { unwrapOrEmpty } from './ai-error';
import { NEUTRALIZATION_SYSTEM, NEUTRALIZATION_USER_TEMPLATE, fillTemplate } from './prompts';
import { fencePostText } from '../core/prompt-fence';
// Full voice-rule validator stack. Same validator now runs on the BATCH
// V3 inline-rewrite path via `content/index.ts` — see
// `src/analysis/comment-rewriter.ts:validateRewrite` for the canonical
// ordering of all 8 guards (min-length / meta-talk / false-self-admission
// / advisory-injection / length-blowup / register-flatten / forbidden-
// meta / language-drift).
import { validateRewrite } from '../analysis/comment-rewriter';

export interface NeutralizeInput {
  /** The comment text the BATCH flagged as manipulative. */
  text: string;
  /** Technique label assigned by the BATCH (e.g. 'shame-attack'). */
  technique: string;
  /** Optional cancel hook so caller can abort if user scrolls past. */
  signal?: AbortSignal;
  /**
   * Told which model wrote the rewrite this call returns: the model the call's
   * reply named, or on a cache hit the model the first call's reply named. The
   * page's AI mark and the record carry that name. Not called when no reply
   * named one, or when the rewrite is ''.
   */
  onWriter?: (model: string) => void;
}

// Per-comment rewrite cache. Mirrors `batchCache` in
// `src/analysis/comment-batch-scorer.ts:591-633`: module-local Map, LRU via
// insertion-order refresh, 5-min TTL, fixed-size eviction, no negative
// caching. Closes the gap identified in
// `.audit-cache/cache-and-pipeline-optimization.md` (a): the BATCH cache
// short-circuits room classification but the per-comment rewrite fan-out
// re-pays Groq for every flagged comment on every re-encounter.
//
// Key shape: `${model}|${technique}|${text}`.
//   • model — `GROQ_FAST_MODEL` from `client.ts:57`. Acts as the
//     prompt-version proxy: the rewrite prompt
//     (`NEUTRALIZATION_SYSTEM` + `NEUTRALIZATION_USER_TEMPLATE`) ships in
//     the same extension build as the model pin, so a model bump or
//     prompt revision flows through to the same shipped artifact and the
//     key naturally invalidates on either change.
//   • technique — the rewrite is technique-conditioned (a fear-appeal
//     rewrite differs from a shame-attack rewrite — see RULE 5 in
//     NEUTRALIZATION_SYSTEM); same text + different technique must miss.
//   • text — the raw input comment text (no truncation; comment lengths
//     are bounded upstream at extraction and the 100-entry cap keeps
//     memory well-bounded even at adversarial 10 KB inputs).
//
// Only post-validation rewrites are cached. failClosed paths (validator
// reject) explicitly skip cache write so a one-time validator-trip
// rewrite doesn't poison subsequent calls for the same (technique, text)
// — the next call gets to re-roll Groq.
interface RewriteCacheEntry {
  rewrite: string;
  timestamp: number;
  /** The model the reply named when the rewrite was written. */
  writer?: string;
}
const REWRITE_CACHE_MAX_ENTRIES = 100;
const REWRITE_CACHE_MAX_AGE_MS = 5 * 60 * 1000;
const rewriteCache = new Map<string, RewriteCacheEntry>();

function computeRewriteCacheKey(technique: string, text: string): string {
  return `${GROQ_FAST_MODEL}|${technique}|${text}`;
}

function cachedRewrite(key: string): RewriteCacheEntry | null {
  const entry = rewriteCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > REWRITE_CACHE_MAX_AGE_MS) {
    rewriteCache.delete(key);
    return null;
  }
  // Refresh insertion order for LRU semantics.
  rewriteCache.delete(key);
  rewriteCache.set(key, entry);
  return entry;
}

function cacheRewrite(key: string, rewrite: string, writer: string | undefined): void {
  if (rewriteCache.size >= REWRITE_CACHE_MAX_ENTRIES) {
    const first = rewriteCache.keys().next().value;
    if (first !== undefined) rewriteCache.delete(first);
  }
  rewriteCache.set(key, { rewrite, timestamp: Date.now(), ...(writer ? { writer } : {}) });
}

/** Test-only — drop the in-memory rewrite cache between specs so cross-test bleed doesn't fake hits. */
export function __resetRewriteCacheForTests(): void {
  rewriteCache.clear();
}

/**
 * Produce a neutralized rewrite of an already-flagged comment, inheriting
 * the voice-preservation rules from `NEUTRALIZATION_SYSTEM`.
 *
 * Returns the rewrite string. Returns '' on any failure path (empty input,
 * network error, JSON refusal, empty model output) — caller treats '' as
 * "no rewrite available, use the pre-fix empty FORENSIC_LOG behavior".
 */
export async function neutralizeText(input: NeutralizeInput): Promise<string> {
  if (!input.text || input.text.trim().length === 0) return '';

  // Rewrite cache short-circuit. Same (model, technique, text) → return the
  // post-validation rewrite without paying the Groq round-trip. Hit case:
  // page refresh / scroll-back inside the BATCH 5-min TTL window. Miss
  // case (validator reject) is NOT cached so a one-time bad rewrite doesn't
  // poison the next call.
  const cacheKey = computeRewriteCacheKey(input.technique, input.text);
  const cached = cachedRewrite(cacheKey);
  if (cached !== null) {
    console.debug('[FW neutralize-only] cache hit');
    if (cached.writer) input.onWriter?.(cached.writer);
    return cached.rewrite;
  }

  // RULE 9 of NEUTRALIZATION_SYSTEM directs the model to output in the same
  // language as the ORIGINAL — no template substitution needed; the prompt
  // text itself carries the contract. The validator at the end of this
  // function double-checks via `detectLanguage(input.text)`.
  const system = NEUTRALIZATION_SYSTEM;
  // Fence the comment text BEFORE the fill: strip control/bidi/zero-width
  // chars + literal fence tokens, wrap in <user-content> (prompt-fence.ts).
  // Pairs with the SECURITY clause in NEUTRALIZATION_SYSTEM — without the
  // fence a hostile comment could dictate its own "neutralized" replacement,
  // which the caller swaps into the DOM with trusted-rewrite treatment.
  // Single-pass fill: the fenced text is still raw user content and may
  // contain `$` sequences or literal `{...}` tokens that chained
  // String.replace would corrupt. See fillTemplate docblock.
  const user = fillTemplate(NEUTRALIZATION_USER_TEMPLATE, {
    text: fencePostText(input.text),
    techniques: input.technique,
  });

  // A caller with no signal of its own gets one here, because the reply's model
  // is read back by signal and the page's AI mark names it.
  const signal = input.signal ?? new AbortController().signal;
  let raw: string;
  try {
    // fastMode=true uses the configured model — same as the BATCH and the per-post
    // pipeline detect call. NEUTRALIZATION is a pure rewrite, no JSON gating
    // (per the prompt's "OUTPUT: Return ONLY the rewritten text. No
    // explanations. No labels. No markdown."). jsonMode left default off.
    raw = unwrapOrEmpty(await callAI(system, user, true, {
      signal,
    }));
  } catch (err) {
    // Make the failure OBSERVABLE (Power-of-Ten Rule 7): the empty string is a
    // deliberate signal — the caller (batch-rewrite) turns it into hide/
    // mark-only — but without this log a network/abort failure was
    // indistinguishable from "the model legitimately produced nothing".
    console.debug('[FW neutralize-only] rewrite call failed — returning empty so caller falls back to hide/mark', err);
    return '';
  }
  if (!raw) return '';

  // Strip any wrapping the model might have added despite the "no markdown"
  // instruction (occasional model drift). Keep the actual rewrite content.
  const stripped = raw
    .trim()
    .replace(/^```[a-z]*\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
  if (!stripped) return '';

  // Full voice-rule validator stack. Same stack now runs on the BATCH V3
  // inline-rewrite path via `content/index.ts:flushBatch` — see
  // `src/analysis/comment-rewriter.ts:validateRewrite` for the canonical
  // ordering (cheap structural checks first, language detection last).
  // Reject by returning '' so the caller's empty-string fallback fires
  // (FORENSIC_LOG still writes; just without the bad rewrite).
  const validation = validateRewrite(stripped, input.text);
  if (!validation.valid) {
    // The reason only: the detail can be words from the post or the rewrite.
    console.debug(`[FW neutralize-only] rejected: ${validation.reason}`);
    return '';
  }
  // Cache the post-validation rewrite. Reached only when every validator
  // above passed (first-person + defused + no-slur + no-technique +
  // language). failClosed paths above all return '' before this point
  // and are intentionally not cached.
  const writer = callProvenanceFor(signal)?.model;
  cacheRewrite(cacheKey, stripped, writer);
  if (writer) input.onWriter?.(writer);
  return stripped;
}
