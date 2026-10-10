// FeelingWise — Comment batch scorer
//
// Room-context scoring model:
//
// Don't score comments one LLM call at a time — score them in batches of N.
// Single short comment ("👎", "lol", "fr fr") is too ambiguous to judge alone;
// the SAME comment in the context of 24 other comments is part of an
// environment signal. The metaphor: the comments under a post are the people
// around your child when they walk into a room. We're not labeling each
// individual person as "rude" — we're judging the room.
//
// Output:
//   • per-comment sentiment + technique (used to attach to per-comment records)
//   • aggregate environment label (the room) + dominant tone
//
// Cost win: 25 comments in 1 LLM call ≈ 25× cheaper than 25 separate calls.
//
// Failure mode: when LLM output is unparseable, fail-closed — every comment
// gets neutral / unknown, and the environment label is 'unknown'. Records
// still get written (forensic ledger preserved), parent UI just doesn't show
// an alarming label until the next batch lands.

import { callAI, type GroqCallOutcome } from '../ai/client';
import { MANIPULATION_SEVERITY_THRESHOLD } from '../core/severity-floor';
import type { BatchCommentVerdict } from '../types/batch-verdict';
import type { AIFailure } from '../ai/ai-error';
import {
  isHolding as isGlobalFlushHolding,
  recordFailure as recordGlobalFlushFailure,
} from '../ai/global-flush-budget';
import { buildBatchPromptV3, buildRoomPrompt } from '../ai/prompts-v2';
import {
  authorKey,
  buildNameLabelMapForEncounter,
  isNameLabelStepOn,
  restoreNames,
  type NameLabelMap,
} from '../core/name-labels';
import { computeHarmFloor } from '../core/harm-floor';
import { detectCodedHarm, codedHarmVerdictFields } from '../core/coded-harm-catcher';
import { filterProfanity } from '../core/profanity-filter';
import { detectEmojiPile, detectRepetition } from './pre-llm-signals';
import { hasPresentTarget } from './present-target';
import { detectDehumanization } from '../core/dehumanization-filter';
import type {
  Encounter,
  EncounterPlatform,
  PlatformSurface,
  PostNode,
  CommentNode,
  CommentHarmFloor,
} from '../types/post';


/** Aggregate of the whole batch — the "room" label. */
interface BatchEnvironment {
  /** Parent-facing room label. */
  label:
    | 'hostile-crowd'         // > 70% negative
    | 'pile-on'               // most attacking a single target
    | 'echo-chamber'          // > 95% same opinion
    | 'polarized'             // strong split
    | 'mostly-positive'       // > 70% positive/supportive
    | 'healthy-discussion'    // mixed civil tone
    | 'sparse'                // too few comments to judge (< 5 substantive)
    | 'unknown';              // LLM failure / ambiguous
  /** % breakdown computed from per-comment verdicts. */
  negativePct: number;
  positivePct: number;
  neutralPct: number;
  /** Dominant technique observed across the batch (if any). */
  dominantTechnique: BatchCommentVerdict['technique'] | null;
  /** Free-form 1-2 sentence summary in the post's language. */
  summary: string;
  /**
   * pre-LLM aggregate signals computed from per-comment
   * harm-floor pre-filter (regex+structural; no Groq round-trip). These are
   * grounded by `src/core/harm-floor.ts` outputs across `encounter.children`
   * BEFORE the BATCH classifier runs, so they're available even when Groq
   * fails (failClosed path uses them as severity-floor fallback) and they
   * persist to the chain payload as Layer-2 room-shape signals per
   * `feedback_per_platform_metrics_aware_batch_design`.
   */
  /** Composite 0-100 toxicity score = mean per-comment harm-floor. */
  toxicityScore: number;
  /** % of comments with harm-floor score ≥ 50 (slur/profanity-loaded). */
  slurPrevalencePct: number;
  /** Max comments by a single author in this batch (≥3 = pile-on contributor). */
  authorRecidivism: number;
  /**
   * 0-100 discourse-quality proxy. High = negative comments rebut by argument
   * (low harm-floor score + non-zero severity). Low = negative comments rebut
   * by slur (high harm-floor score on negative comments). Computed as:
   *   100 - mean(harm_floor_score for comments with sentiment='negative')
   * Falls back to 100 when no negative comments.
   */
  discourseQuality: number;
  /**
   * algorithmic-amplification proxy from
   * Encounter.post.metrics views ÷ likes. Captures whether the platform
   * pushed this room to the child beyond organic engagement.
   *   'high'    — views/likes > 100 (algorithmic surface beyond organic interest)
   *   'normal'  — 30 ≤ ratio ≤ 100 (typical organic engagement range)
   *   'low'     — ratio < 30 (highly engaged; small audience)
   *   'unknown' — views or likes missing on the post metrics
   */
  algorithmicAmplification: 'high' | 'normal' | 'low' | 'unknown';
  /**
   * Room-level forensic narrative emitted when amplification=high AND
   * label=pile-on (RULE 14 code-side enrichment). Surfaces the platform's
   * role in routing the child to a hostile audience — per-comment severity
   * is never affected; this is a room-label-only signal. Undefined when the
   * conditions don't co-occur.
   */
  forensicNarrative?: string;
}

/**
 * Structured room analysis — the output of the SEPARATE `scoreRoom` call (a
 * second LLM round-trip kept entirely off the per-comment detection prompt;
 * see `buildRoomPrompt`). Turns the room reader from a vague summarizer into a
 * sensor: what the crowd does with the post's claim, manipulation among the
 * commenters, audience distress, and a summary that NAMES the signal.
 */
export interface RoomAnalysis {
  claimVsReaction: 'corroborates' | 'contradicts' | 'ignores' | 'no-claim';
  commentManipulation: 'none' | 'bandwagon' | 'pile-on' | 'astroturf';
  audienceDistress: boolean;
  summary: string;
  /**
   * 1-3 topic labels from TOPIC_LABELS describing what the POST is about
   * (product decision, 2026-07-02: each post carries one or more topic
   * labels — the third record axis: WHAT the content is, alongside what
   * machinery it carried and what register it used). AI-interpretation,
   * closed list only; unknown values are dropped at parse. Empty = model gave none/invalid.
   */
  topicLabels: TopicLabel[];
}

/**
 * Closed content-topic vocabulary. Closed because the small judge handles
 * enums where open vocab drifts, and because dashboard aggregation ("what
 * the feed was made of this month") needs stable keys. Extend deliberately —
 * every addition dilutes the model's per-label accuracy.
 */
export const TOPIC_LABELS = [
  'news', 'politics', 'sports', 'gaming', 'music', 'comedy-memes',
  'beauty-fashion', 'fitness', 'food', 'relationships', 'family-parenting',
  'education', 'science-tech', 'ai', 'finance-crypto', 'gambling',
  'shopping-deals', 'celebrity-gossip', 'religion', 'animals',
  'nature-travel', 'cars', 'health', 'war-conflict', 'crime', 'art-diy',
  'other',
] as const;
type TopicLabel = (typeof TOPIC_LABELS)[number];
const VALID_TOPIC_LABELS: ReadonlySet<string> = new Set(TOPIC_LABELS);

const VALID_CLAIM_VS_REACTION: ReadonlySet<string> = new Set([
  'corroborates', 'contradicts', 'ignores', 'no-claim',
]);
const VALID_COMMENT_MANIPULATION: ReadonlySet<string> = new Set([
  'none', 'bandwagon', 'pile-on', 'astroturf',
]);

/**
 * Why a batch fell closed. The provider's own typed failures, plus the two
 * states that used to reach the console as an unnamed guess and the chain
 * record as nothing at all (2026-09-02):
 *
 *   'provider-unparseable-json' — the call returned 2xx but neither the
 *       three-tier parser nor the truncation salvage found a comments array.
 *   'provider-empty-verdicts'   — well-formed JSON carrying zero verdicts
 *       AND no environment block: the model answered with nothing.
 *
 * Both names also exist in `ForensicRecord['failureKind']` so the chain
 * record keeps the distinction the console draws.
 */
type BatchFailureKind =
  | AIFailure['kind']
  | 'provider-unparseable-json'
  | 'provider-empty-verdicts';

export interface BatchScoreResult {
  comments: BatchCommentVerdict[];
  environment: BatchEnvironment;
  /** Total batch size as sent to the LLM (= input count). */
  batchSize: number;
  /** True when output couldn't be parsed and we returned a fail-closed result. */
  failed: boolean;
  /** ms wall-clock for the LLM call. */
  generationTimeMs: number;
  /**
   * 1-based indices for which the LLM response did NOT
   * include a verdict (parse succeeded but `parsed.comments` was incomplete,
   * typically max_tokens truncation mid-array). Empty when the LLM returned
   * a verdict for every input comment. Caller decides how to surface — e.g.
   * forensic chain emits a `cancelled-batch-truncated` event for these
   * indices instead of stamping the default 'none'/sev=0 (which would
   * silently downgrade harmful comments past the truncation point).
   */
  truncatedIndices: number[];
  /**
   * per-comment harm-floor pre-filter outputs, index-
   * aligned with `comments`. Caller (content/index.ts) reads this when
   * dispatching FORENSIC_LOG / PASS_LOG / CANCEL_LOG to stamp the chain
   * record's `harmFloor` field (per `src/types/forensic.ts`).
   *
   * Slot semantics:
   *   - `commentHarmFloors[i]` undefined  ⇒ comment had zero pre-filter
   *     signal (no chain field stamped — back-compat).
   *   - `commentHarmFloors[i]` defined    ⇒ harm-floor pre-classification
   *     for child i; persists as forensic evidence even when Groq fails.
   */
  commentHarmFloors: Array<CommentHarmFloor | undefined>;
  /**
   * structured failure kind from the LLM cascade. Set only
   * when `failed: true` (Groq returned a typed Err). Undefined when
   * `failed: false` OR when failClosed was called with no LLM context (zero
   * children path). Lets `flushBatch` distinguish rate-limit / auth-refusal /
   * content-policy / cap-exhausted / transient-http for chain forensics +
   * cooldown selection.
   */
  failureKind?: BatchFailureKind;
  /** retry hint surfaced by the LLM when available (rate-limit / 5xx). */
  retryAfterMs?: number;
  /**
   * Cap subtype when failureKind === 'cap-exhausted'. Mirrors
   * `AIFailure['cap']`. Lets the chain record stamp `cap?` so the dashboard
   * Operational Events surface can distinguish daily / monthly / tier-free.
   */
  cap?: 'daily' | 'monthly' | 'tier-free' | 'master-off';
}

export interface BatchScoreInput {
  /** Comments to score. Index in array becomes 1-based index in the batch. */
  comments: Array<{ author: string; text: string }>;
  /** Caption / title — gives the LLM context for what the comments are reacting to. */
  videoCaption: string;
  /** ISO 639-1 or human language name. Output reasoning + summary in this language. */
  language: string;
  /** Optional platform tag — drives surface defaults in the legacy-Encounter bridge. */
  platform?: string;
}

/**
 * Construct a degraded Encounter from a legacy
 * BatchScoreInput. Used by:
 *   - `buildBatchPrompt()` (the prompt-rules test bridge in this file)
 *   - `src/content/record/encounter-builder.ts` when runtime platform/surface signals
 *     are incomplete or unrecognized
 *   - a measurement script (the 2026-05 prompt comparison, run locally, never committed)
 *
 * The degraded Encounter has empty ancestors, no metrics, and synthetic ids.
 * The classifier still sees post text + per-comment author/text — the same
 * effective signal as the v2 ship — but loses the ancestry +
 * metrics context that fixes the single-slur detection gap. Runtime assembly
 * should preserve each platform's observed surface and metrics; rendered
 * ancestry is included only where the adapter can actually observe it.
 */
export function encounterFromLegacyBatchInput(
  input: BatchScoreInput,
  platform?: string,
): Encounter {
  const platformNorm: EncounterPlatform = (() => {
    const p = (platform ?? input.platform ?? '').toLowerCase().trim();
    if (p === 'x' || p === 'twitter') return 'twitter';
    if (p === 'tiktok') return 'tiktok';
    if (p === 'fb' || p === 'facebook') return 'facebook';
    if (p === 'ig' || p === 'instagram') return 'instagram';
    if (p === 'yt' || p === 'youtube') return 'youtube';
    // Default 'twitter' is intentional — universal v2 rules apply across
    // platforms; the env-line branching only affects platform-specific lines
    // that don't apply here anyway. Twitter-home-feed surface implies no
    // ancestry block (which is correct for this degraded shape).
    return 'twitter';
  })();

  const surface: PlatformSurface = (() => {
    switch (platformNorm) {
      case 'twitter': return { kind: 'twitter-home-feed' };
      case 'tiktok': return { kind: 'tiktok-feed', video_id: 'legacy', comment_panel_open: true };
      case 'instagram': return { kind: 'instagram-post', post_id: 'legacy' };
      case 'youtube': return { kind: 'youtube-watch', video_id: 'legacy' };
      case 'facebook': return { kind: 'facebook-permalink', post_id: 'legacy' };
    }
  })();

  const post: PostNode = {
    id: 'legacy-post',
    kind: 'post',
    text: input.videoCaption,
    author: { handle: '', verified: false, is_creator: false },
    metrics: {},
  };

  const children: CommentNode[] = input.comments.map((c, i) => ({
    id: `legacy-c-${i + 1}`,
    kind: 'top-comment',
    depth: 1,
    parent_id: 'legacy-post',
    text: c.text,
    author: {
      handle: c.author,
      verified: false,
      is_pinned_by_creator: false,
      is_creator_hearted: false,
    },
    metrics: {},
    render_state: 'visible-now',
    fw_marker_present: false,
  }));

  const newId = (): string => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return `legacy-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  };

  return {
    platform: platformNorm,
    surface,
    observation_iso: new Date().toISOString(),
    encounter_id: newId(),
    post,
    ancestors: [],
    focused: post,
    children,
    output_language: input.language,
  };
}

/**
 * Build the LLM prompt for batch scoring from a legacy BatchScoreInput.
 * Bridge function that constructs a degraded Encounter via
 * `encounterFromLegacyBatchInput` and delegates to `buildBatchPromptV3`.
 * Pure function so tests can snapshot it without a network call.
 *
 * Bridge after `buildBatchPromptV3` migrated to take
 * Encounter. Existing callers that don't yet have rich Encounter context
 * (the comment-batch-scorer-prompt.test.ts prompt-parity tests, and the 2026-05
 * prompt-comparison script, which ran locally and was never committed) call this bridge.
 * Production runtime (`src/content/index.ts:flushBatch`) constructs an
 * Encounter via `encounterFromLegacyBatchInput` and calls scoreBatch directly.
 *
 * Original v2 ship: live A/B measurement on
 * Council-labeled corpus showed v2 = 80% per-comment exact-match vs v1 = 0%.
 * The v1 inline body was removed then per Karpathy "no half-finished
 * implementations". extends v2 with Encounter-context.
 */
export function buildBatchPrompt(input: BatchScoreInput): { system: string; user: string } {
  return buildBatchPromptV3(encounterFromLegacyBatchInput(input));
}

/** 3-tier JSON extractor mirroring neutralizer.ts pattern. */
function parseJSON(raw: string): unknown {
  try { return JSON.parse(raw); } catch { /* fall through */ }
  try {
    const stripped = raw.replace(/^```(?:json)?\s*/m, '').replace(/```\s*$/m, '');
    return JSON.parse(stripped);
  } catch { /* fall through */ }
  // Walk char-by-char to extract the FIRST balanced top-level `{...}` object.
  // The previous greedy match (`/\{[\s\S]*\}/`) captured first-`{` to last-`}`
  // and broke when the model emitted prose containing stray braces before the
  // real JSON. String-literal awareness skips `{`/`}` inside quoted strings.
  try {
    let depth = 0;
    let start = -1;
    let inString = false;
    let escaped = false;
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i];
      if (inString) {
        if (escaped) { escaped = false; continue; }
        if (c === '\\') { escaped = true; continue; }
        if (c === '"') inString = false;
        continue;
      }
      if (c === '"') { inString = true; continue; }
      if (c === '{') {
        if (depth === 0) start = i;
        depth++;
      } else if (c === '}') {
        // Underflow guard: a stray `}` in prose BEFORE the real JSON took
        // depth negative; the subsequent `if (depth === 0) start = i;` at
        // the next `{` could never re-fire from depth=-1 → walker
        // returned null on input the legacy greedy regex would have
        // recovered. Reset to baseline on underflow.
        if (depth === 0) {
          start = -1;
          continue;
        }
        depth--;
        if (depth === 0 && start >= 0) {
          return JSON.parse(raw.slice(start, i + 1));
        }
      }
    }
  } catch { /* fall through */ }
  return null;
}

/**
 * Tier-4 salvage for max_tokens-truncated batch replies (W88, 2026-08-18).
 *
 * Owner diagnostics showed ~8 YouTube batches/day dying as
 * `provider-unparseable-json`, each defaulting 1-5 verdicts to CANCEL_LOG.
 * Mechanism: output hits max_tokens=2048 mid-array → Groq's server-side JSON
 * validation refuses (`json_validate_failed`) → client retries without JSON
 * mode → the truncated raw comes back Ok — and every parseJSON tier requires
 * BALANCED braces, so the whole reply parsed to null and the batch's COMPLETE
 * verdicts were discarded together with the cut one.
 *
 * This walker extracts each individually-complete `{...}` object inside the
 * `"comments": [` array (string-aware, same technique as parseJSON tier 3)
 * and parses them one by one. The cut-open trailing object never balances, so
 * it is naturally skipped — no fake verdicts are synthesized. Missing indices
 * flow through the existing truncatedIndices → cancelled-batch-truncated
 * machinery; a truncated-away `environment` falls to the honest 'unknown'
 * label downstream. Returns null (caller fails closed) when the reply has no
 * comments array or no complete verdict object.
 */
function salvageTruncatedComments(raw: string): unknown[] | null {
  const arrayStart = /"comments"\s*:\s*\[/.exec(raw);
  if (!arrayStart) return null;
  const out: unknown[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = arrayStart.index + arrayStart[0].length; i < raw.length; i++) {
    const c = raw[i];
    if (inString) {
      if (escaped) { escaped = false; continue; }
      if (c === '\\') { escaped = true; continue; }
      if (c === '"') inString = false;
      continue;
    }
    if (c === '"') { inString = true; continue; }
    if (c === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (c === '}') {
      if (depth === 0) continue; // stray close in the array — ignore
      depth--;
      if (depth === 0 && start >= 0) {
        try { out.push(JSON.parse(raw.slice(start, i + 1))); } catch { /* malformed member — skip */ }
        start = -1;
      }
    } else if (c === ']' && depth === 0) {
      break; // the comments array closed cleanly — don't scan beyond it
    }
  }
  return out.length > 0 ? out : null;
}

/**
 * Output budget for a batch call. 25 comments × ~25 tokens/verdict plus the
 * environment block fits with headroom; see the call site for the history.
 */
export const BATCH_MAX_TOKENS = 2048;

/**
 * Budget for the ONE retry a CONFIRMED max_tokens cut earns (2026-09-02).
 * Only spent when the first reply came back `finish_reason: 'length'` AND
 * salvage recovered nothing from it — i.e. the call was already a total
 * loss. Any other unparseable reply (refusal, wrong shape, prose) is a
 * different fault that a repeat call cannot fix, and is not retried.
 */
export const BATCH_TRUNCATION_RETRY_MAX_TOKENS = 4096;

type ParsedBatchReply = { comments?: unknown; environment?: unknown };

/**
 * Read a batch reply: strict parse first, tier-4 truncation salvage second.
 * Returns null only when neither yields a comments array — the caller then
 * decides whether the reply is worth one more round-trip.
 */
function readBatchReply(raw: string): { reply: ParsedBatchReply; salvaged: boolean } | null {
  const parsed = parseJSON(raw) as ParsedBatchReply | null;
  if (parsed && Array.isArray(parsed.comments)) return { reply: parsed, salvaged: false };
  const salvaged = salvageTruncatedComments(raw);
  if (salvaged) return { reply: { comments: salvaged }, salvaged: true };
  return null;
}

/**
 * One line naming what the provider actually returned, for the fail-closed
 * log. Without it the console said `provider-unparseable-json` for three
 * different states and carried nothing about the reply, so a repeat failure
 * in the owner's diagnostics could not be traced to a cause. Carries no
 * comment text — shape and size only.
 */
function describeBatchReply(raw: string, meta: GroqCallOutcome | null): string {
  return (
    `reply=${raw.length}ch hasCommentsKey=${/"comments"\s*:/.test(raw)} ` +
    `finish=${meta?.finishReason ?? 'unknown'} ` +
    `completionTokens=${meta?.completionTokens ?? 0}/${meta?.maxTokens ?? 0}`
  );
}

function clampSeverity(n: unknown): number {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(10, v));
}

const VALID_TECHNIQUES: ReadonlySet<BatchCommentVerdict['technique']> = new Set([
  'fear-appeal', 'shame-attack', 'anger-trigger', 'false-urgency', 'bandwagon',
  'fomo', 'scapegoating', 'toxic-positivity', 'misleading-format',
  'body-comparison-priming', 'parasocial-coercion', 'consumer-rapid-frame',
  'hyperreal-trauma-bait', 'pile-on', 'mockery', 'sarcasm', 'genuine-opinion',
  'supportive', 'neutral', 'off-topic', 'combined', 'profanity', 'none',
]);

/**
 * Canonical non-manipulation verdict set. Members are technique labels the
 * BATCH classifier emits to mark a comment as NOT a manipulation pattern —
 * benign opinion, sarcasm, supportive talk, off-topic chatter, or no flag.
 * Two consumers depend on this set agreeing:
 *   1. The rewrite gate at `src/content/index.ts:flushBatch` — non-manipulation
 *      verdicts must NOT trigger a Groq rewrite call (wastes tokens, exposes
 *      hallucination surface, contradicts the contract).
 *   2. The comment-marker render gate at `src/content/index.ts` — non-
 *      manipulation verdicts must NOT carry a severity-dot marker UI when no
 *      rewrite is in hand (would contradict the verdict the parent sees on
 *      explainability).
 *   3. The harm-floor verdict-override gate (below) — only escalates
 *      to shame-attack when the classifier landed on a non-manipulation verdict.
 * Keeping a single exported set prevents the historical drift where each
 * gate maintained its own slightly-different copy.
 */
export const NON_MANIPULATION_TECHNIQUES: ReadonlySet<BatchCommentVerdict['technique']> = new Set([
  'sarcasm', 'genuine-opinion', 'none', 'neutral', 'off-topic', 'supportive',
]);


/**
 * Canonical flag gate: does this verdict route to FORENSIC_LOG + the rewrite/
 * hide branch (true) or PASS_LOG (false). Mirrors VISION §1.2:
 *   flag := action==='hide'  OR  (severity ≥ THRESHOLD  AND  technique is a
 *           manipulation label, i.e. NOT in NON_MANIPULATION_TECHNIQUES)
 * `action:'hide'` is set by the post-Groq override gate (profanity-tier sev≥8 /
 * identity-slur) and the failClosed identity-slur path; those escalations must
 * route regardless of the LLM's `technique`, so the disjunct restores their
 * intent. The one definition consumed by production (`content/index.ts`) and
 * every corpus harness — there is no second copy to drift.
 */
export function isManipulative(
  verdict: Pick<BatchCommentVerdict, 'severity' | 'technique' | 'action'>,
): boolean {
  if (verdict.action === 'hide') return true;
  if (NON_MANIPULATION_TECHNIQUES.has(verdict.technique)) return false;
  return verdict.severity >= MANIPULATION_SEVERITY_THRESHOLD;
}

/**
 * Severity floor for comment markers. Teen post-level floors (in
 * neutralizer.ts:SEVERITY_FLOOR_BY_TECHNIQUE_AND_MODE) range 4-7; 5 catches
 * mid-severity mockery / shame-attack on Romanian content that the
 * per-technique × per-mode post-path floors miss.
 */
export const COMMENT_MARKER_SEVERITY_FLOOR = 5;

/**
 * Marker gate for a flagged comment with NO usable rewrite in hand
 * (validator-rejected or upstream skipped). The marker is the honest floor:
 * a confirmed manipulation verdict must never be invisible on screen
 * (VISION Promise 2: "every flag carries a why").
 *
 * Keys on the flag itself — technique class + severity — NOT on sentiment
 * polarity. The previous sentiment==='negative' condition made warm-toned
 * confirmed concerns (parasocial-coercion, toxic-positivity, fomo) pass
 * silently: the manipulation classes most likely to read as positive were
 * exactly the ones the gate suppressed. Benign verdicts still never mark:
 * NON_MANIPULATION_TECHNIQUES + the severity floor are the gates that
 * protect genuine opinion / political critique.
 *
 * Consumed by the marker render loop in `src/content/index.ts` (flushBatch)
 * — single definition so the shipped gate and the tested gate cannot drift.
 */
export function shouldRenderNoRewriteMarker(
  verdict: Pick<BatchCommentVerdict, 'technique' | 'severity'>,
): boolean {
  if (NON_MANIPULATION_TECHNIQUES.has(verdict.technique)) return false;
  return verdict.severity >= COMMENT_MARKER_SEVERITY_FLOOR;
}
const VALID_LABELS: ReadonlySet<BatchEnvironment['label']> = new Set([
  'hostile-crowd', 'pile-on', 'echo-chamber', 'polarized', 'mostly-positive',
  'healthy-discussion', 'sparse', 'unknown',
]);

/**
 * per-comment harm-floor compute. Runs `computeHarmFloor`
 * with techniques=[] (no L1 cascade per-comment — too expensive at batch
 * cardinality) so only categories A/B/C/D/E/I contribute (profanity / ad-hominem
 * / ideology-slur / sustained-caps / crowd-coordination / punctuation-rage,
 * English-only; max ~80 from text-only signals, plus dampener).
 *
 * Returns the enriched encounter — children gain `harm_floor` field per
 * schema. Pure function: doesn't mutate input encounter.
 */
/**
 * slur weight: identity-slur signal (nigger / faggot / retard / RO
 * handicapat / poponar) is a 50-point bump on top of the harm-floor categorical
 * score. Identity slurs are categorically more severe than profanity stack
 * because they target HUMAN-DIGNITY identity axes (race / sexuality / disability)
 * rather than ambient cussing. The 50 floor matches sev=7 in failClosed
 * fallback (HF≥70 → sev≥7) when combined with even a single profanity-density
 * signal. Anchored at this value to ensure single-slur
 * comments cross HF=70 and trigger failClosed sev=7+.
 */
const IDENTITY_SLUR_WEIGHT = 50;

// `codedHarmVerdictFields` — the single category→verdict mapping shared by the
// comment success-path gate, the comment AI-off fallback, AND the post path —
// now lives in `core/coded-harm-catcher.ts` (co-located with the category
// definitions it maps) and is imported above.

/**
 * Deterministic override gates for ONE comment verdict (extracted from
 * scoreBatch's per-comment loop — Power-of-Ten Rule 4: a function should be a
 * single verifiable unit). Pure: given the LLM verdict `v`, the comment's
 * harm-floor `hf`, and its `childText`, returns the (possibly-overridden)
 * verdict plus whether an override fired (for the diagnostic counter).
 *
 * Gate order is load-bearing and unchanged: identity-slur → profanity-tier hide
 * → coded-harm catcher → general harm-floor (HF≥70, D-3) → ad-hominem. Each
 * gate that fires returns immediately (was `continue`); falling through all of
 * them returns the verdict byte-identical (no override). Severity is always
 * composed with Math.max so a correctly-higher LLM verdict is never downgraded.
 */
/** Rage-news opening: an uppercase urgency token at the start of the text
 *  (emoji/whitespace prefix tolerated). Uppercase-only on purpose — ordinary
 *  caps excitement and lowercase "breaking" prose never match. */
const RAGE_FORMAT_OPENING =
  /^[\s\u{1F6A8}\u{1F525}\u{26A0}\u{FE0F}]*(?:BREAKING|BOOM|BOMBSHELL|JUST IN|URGENT|ALERT|WW3(?: UPDATE)?)\b/u;

function applyOverrideGates(
  v: BatchCommentVerdict,
  hf: CommentHarmFloor | undefined,
  childText: string | undefined,
  mode: 'child' | 'teen' | 'adult' = 'teen',
): { verdict: BatchCommentVerdict; fired: boolean } {
  const classifierIsNonFlagForSlurCheck = NON_MANIPULATION_TECHNIQUES.has(v.technique);
  if (hf?.identity_slur_match) {
    if (v.severity < 8 || classifierIsNonFlagForSlurCheck) {
      return {
        verdict: {
          ...v,
          technique: 'shame-attack',
          sentiment: 'negative',
          severity: Math.max(v.severity, 8),
          reason: v.reason || `harm-floor override: identity-slur match (${(hf.top_evidence ?? '').slice(0, 60)})`,
          action: 'hide',
          overrideOrigin: 'identity-slur',
        },
        fired: true,
      };
    }
    return { verdict: { ...v, action: 'hide', overrideOrigin: 'identity-slur' }, fired: false };
  }

  // Child-mode profanity floor. The teen gate below only ESCALATES already-severe
  // profanity (sev≥8); but for an 8-12yo the locked decision (2026-06-10) keeps
  // profanity SOFTENING, and no age modifier exists on any path (the post path's
  // table never ran and was deleted 2026-09-06, M115). MEASURED gap
  // (2026-06-19): 71 of the child-only recall misses are profanity the model
  // scored sev 0-2 / genuine-opinion. So in CHILD mode any profanity comment the
  // model under-flagged is floored to the flag line as technique='profanity'
  // (no action='hide' → routes to the rewrite/SOFTEN path, not a hide, per the
  // decision). Slurs are handled by the identity-slur gate above. Teen/adult are
  // untouched — the sev≥8 gate below is their only profanity path.
  if (mode === 'child' && childText) {
    const childProfanity = filterProfanity(childText, 'child', { tier: 'profanity' });
    const underFlagged =
      NON_MANIPULATION_TECHNIQUES.has(v.technique) || v.severity < MANIPULATION_SEVERITY_THRESHOLD;
    if (childProfanity.filtered && underFlagged) {
      return {
        verdict: {
          ...v,
          technique: 'profanity',
          sentiment: 'negative',
          severity: Math.max(v.severity, MANIPULATION_SEVERITY_THRESHOLD),
          reason: v.reason || 'child-mode profanity floor (softened per house rule)',
          overrideOrigin: 'profanity-tier',
        },
        fired: true,
      };
    }
  }

  if (childText && v.severity >= 8) {
    const profanityResult = filterProfanity(childText, 'teen', { tier: 'profanity' });
    if (profanityResult.filtered) {
      // Provenance consistency: when the underlying verdict is a NON-manipulation
      // label (e.g. 'genuine-opinion'), adding action='hide' here would make
      // isManipulative()=true while the technique still reads "this is fine" —
      // a contradictory chain record. Reset only that case to 'none' (the
      // truthful non-manipulation label); overrideOrigin='profanity-tier'
      // carries the real hide reason. A genuine manipulation technique the LLM
      // already diagnosed (fear-appeal, shame-attack, …) is preserved — the
      // profanity hide does not erase accurate signal.
      const techniqueIsConsistent = !NON_MANIPULATION_TECHNIQUES.has(v.technique);
      return {
        verdict: {
          ...v,
          ...(techniqueIsConsistent ? {} : { technique: 'none' as const }),
          action: 'hide',
          overrideOrigin: 'profanity-tier',
        },
        fired: false,
      };
    }
  }

  if (childText) {
    const coded = detectCodedHarm(childText);
    const notYetFlagged =
      NON_MANIPULATION_TECHNIQUES.has(v.technique) || v.severity < 5;
    if (coded && notYetFlagged) {
      const fields = codedHarmVerdictFields(coded);
      return {
        verdict: {
          ...v,
          technique: fields.technique,
          sentiment: 'negative',
          severity: Math.max(v.severity, fields.severity),
          reason: v.reason || `coded-harm catcher: ${coded.category} (${coded.evidence})`,
          overrideOrigin: 'coded-harm',
          ...(fields.hideTier ? { action: 'hide' as const } : {}),
        },
        fired: true,
      };
    }
  }

  // Rage-format news escalation — deterministic catch for the measured
  // misleading-format miss class: posts opening with an all-caps urgency
  // token ("BREAKING:", "BOOM:", "BOMBSHELL ...") that the model scores
  // genuine-opinion or misleading-format at sev 4-5, just under the flag
  // line (5 of 9 honest-en-v1 misses, 2026-06-10). The format IS the
  // technique (technique-trace in FORM), so the floor is code-side like
  // every rule the model won't follow. Start-anchored, uppercase-only — caps
  // excitement without the lexicon ("HOW THE FUCK DID THIS NOT LEAK")
  // never matches. Lexicon is corpus-informed: treat measured recall on
  // honest-en-v1 as an upper bound for real-world recall.
  if (childText && RAGE_FORMAT_OPENING.test(childText)) {
    const notYetFlagged =
      NON_MANIPULATION_TECHNIQUES.has(v.technique) || v.severity < 6;
    if (notYetFlagged) {
      return {
        verdict: {
          ...v,
          technique: 'misleading-format',
          sentiment: 'negative',
          severity: Math.max(v.severity, 6),
          reason: v.reason || 'rage-format escalation: urgency-caps news framing',
          overrideOrigin: 'rage-format',
        },
        fired: true,
      };
    }
  }

  if (!hf) return { verdict: v, fired: false };

  const hfScore = hf.score ?? 0;
  if (hfScore >= 70) {
    const floorSev = hfScore >= 90 ? 9 : hfScore >= 80 ? 8 : 7;
    const isNonFlag = NON_MANIPULATION_TECHNIQUES.has(v.technique);
    if (isNonFlag || v.severity < floorSev) {
      return {
        verdict: {
          ...v,
          technique: isNonFlag ? 'shame-attack' : v.technique,
          sentiment: 'negative',
          severity: Math.max(v.severity, floorSev),
          reason: v.reason || `harm-floor override: HF=${hfScore} ${hf.top_category ?? ''}`,
          overrideOrigin: 'harm-floor',
        },
        fired: true,
      };
    }
    return { verdict: v, fired: false };
  }

  const classifierIsLowSeverity = v.severity < 6;
  const classifierIsNonFlag = NON_MANIPULATION_TECHNIQUES.has(v.technique);
  if (
    hf.top_category === 'ad-hominem' &&
    classifierIsNonFlag &&
    classifierIsLowSeverity
  ) {
    return {
      verdict: {
        ...v,
        technique: 'shame-attack',
        sentiment: 'negative',
        severity: Math.max(v.severity, 6),
        reason: v.reason || `harm-floor override: ad-hominem (${(hf.top_evidence ?? '').slice(0, 60)})`,
        overrideOrigin: 'ad-hominem',
      },
      fired: true,
    };
  }

  return { verdict: v, fired: false };
}

function enrichWithHarmFloor(encounter: Encounter): Encounter {
  const enrichedChildren: CommentNode[] = encounter.children.map((c) => {
    if (!c.text || c.text.trim().length === 0) return c;
    // Layer-1a: harm-floor regex (profanity / ad-hominem / ideology
    // / caps / crowd-coord / punctuation-rage; English-only).
    const hf = computeHarmFloor(c.text, []);
    // Layer-1b: identity-slur filter (covers racial / homophobic /
    // ableist slurs that harm-floor regex doesn't include — those live in
    // src/core/profanity-filter.ts ENGLISH_SLURS).
    // Pass 'teen' mode so the filter flags-without-rewriting (we only care
    // about match presence here; the actual rewrite is Groq's job).
    const slurResult = filterProfanity(c.text, 'teen', { tier: 'slurs' });
    const identitySlurMatch = slurResult.filtered;
    const slurBonus = identitySlurMatch ? IDENTITY_SLUR_WEIGHT : 0;
    // Layer-1c: pre-LLM structural signals — emoji-pile density and token /
    // char / phrase repetition. Catch manipulation patterns the keyword
    // regex doesn't see (🔪🔪🔪🔪🔪 die / "DIE DIE DIE" / "noooooo"). Both
    // are general structural patterns per
    // `feedback_no_regex_patches_for_long_tail_failures.md`.
    const emojiPile = detectEmojiPile(c.text);
    const repetition = detectRepetition(c.text);
    const emojiWeight = emojiPile?.weight ?? 0;
    const repetitionWeight = repetition?.weight ?? 0;
    const totalScore = Math.min(100, hf.score + slurBonus + emojiWeight + repetitionWeight);
    if (totalScore === 0) return c;
    // Find top-contributing signal (excluding L1 categories which won't fire here).
    const harmFloorTopSignal = hf.signals
      .filter((s) =>
        s.category === 'profanity' ||
        s.category === 'ad-hominem' ||
        s.category === 'ideology-slur' ||
        s.category === 'sustained-caps' ||
        s.category === 'crowd-coordination' ||
        s.category === 'punctuation-rage',
      )
      .sort((a, b) => b.weight - a.weight)[0];
    // Identity-slur match dominates top_category when slurBonus ≥ harm-floor
    // top signal weight (50 ≥ any single category cap). This routes
    // single-slur comments to category='identity-slur' in the prompt
    // [HF:N category] flag. Emoji-pile / repetition compete on the same
    // ordering — strongest weight wins; identity-slur always wins on tie
    // because dehumanization beats structural emphasis.
    type Candidate = {
      category: NonNullable<CommentHarmFloor['top_category']>;
      weight: number;
      evidence: string;
    };
    const candidates: Candidate[] = [];
    if (identitySlurMatch) {
      candidates.push({
        category: 'identity-slur',
        weight: slurBonus,
        evidence: `identity-slur match (${slurResult.matches.slice(0, 3).join(', ')})`,
      });
    }
    if (harmFloorTopSignal) {
      candidates.push({
        category: harmFloorTopSignal.category as Candidate['category'],
        weight: harmFloorTopSignal.weight,
        evidence: harmFloorTopSignal.evidence,
      });
    }
    if (emojiPile) {
      candidates.push({
        category: 'emoji-pile',
        weight: emojiPile.weight,
        evidence: emojiPile.evidence,
      });
    }
    if (repetition) {
      candidates.push({
        category: 'repetition',
        weight: repetition.weight,
        evidence: repetition.evidence,
      });
    }
    candidates.sort((a, b) => {
      if (a.weight !== b.weight) return b.weight - a.weight;
      // Tie-break: identity-slur first, then keyword harm-floor categories,
      // then emoji-pile, then repetition. Mirrors signal severity.
      const order: Record<string, number> = {
        'identity-slur': 0,
        'profanity': 1,
        'ad-hominem': 2,
        'ideology-slur': 3,
        'sustained-caps': 4,
        'crowd-coordination': 5,
        'punctuation-rage': 6,
        'emoji-pile': 7,
        'repetition': 8,
      };
      return (order[a.category] ?? 99) - (order[b.category] ?? 99);
    });
    const winner = candidates[0];
    const top_category = winner?.category;
    const top_evidence = winner?.evidence?.slice(0, 60);
    const signal_categories = Array.from(
      new Set([
        ...hf.signals.map((s) => String(s.category)),
        ...(identitySlurMatch ? ['identity-slur'] : []),
        ...(emojiPile ? ['emoji-pile'] : []),
        ...(repetition ? ['repetition'] : []),
      ]),
    );
    const harm_floor: CommentHarmFloor = {
      score: totalScore,
      top_category,
      top_evidence,
      signal_categories,
      language: hf.language,
      identity_slur_match: identitySlurMatch,
    };
    return { ...c, harm_floor };
  });
  return { ...encounter, children: enrichedChildren };
}

/**
 * Pre-LLM Layer-2 room signals derived from per-comment
 * harm-floor + handle-counting + post engagement metrics. These are computed
 * BEFORE the BATCH classifier runs, so they can also reach Groq via prompt
 * injection (passed to `buildBatchPromptV3` as its optional `roomSignals`
 * argument, which renders them as `[POST_ENVIRONMENT]` lines — prompts-v2.ts).
 *
 * `discourseQuality` is computed AFTER the LLM returns sentiment per comment
 * (see `computeDiscourseQuality` below).
 */
function computePreLlmRoomSignals(
  children: CommentNode[],
  postMetrics: { primary_likes?: number; views?: number } = {},
): {
  toxicityScore: number;
  slurPrevalencePct: number;
  authorRecidivism: number;
  algorithmicAmplification: 'high' | 'normal' | 'low' | 'unknown';
} {
  if (children.length === 0) {
    return {
      toxicityScore: 0,
      slurPrevalencePct: 0,
      authorRecidivism: 0,
      algorithmicAmplification: deriveAlgorithmicAmplification(postMetrics),
    };
  }
  // Composite toxicity = mean per-comment harm-floor score.
  const scoreSum = children.reduce((acc, c) => acc + (c.harm_floor?.score ?? 0), 0);
  const toxicityScore = Math.round(scoreSum / children.length);
  // Slur-prevalence = % of comments with HF ≥ 50 (loaded with profanity / slur).
  const slurLoaded = children.filter((c) => (c.harm_floor?.score ?? 0) >= 50).length;
  const slurPrevalencePct = Math.round((slurLoaded / children.length) * 100);
  // Author-recidivism = max comments by single handle. Pile-on contributor when ≥3. The key is
  // the one the letters use, so "@pat" and "pat" are one person and a comment with no name is
  // a writer of its own rather than one "unknown" who wrote them all.
  const handleCounts = new Map<string, number>();
  children.forEach((c, i) => {
    const h = authorKey(c.author?.handle) ?? `\u0000nobody-${i}`;
    handleCounts.set(h, (handleCounts.get(h) ?? 0) + 1);
  });
  const authorRecidivism = handleCounts.size === 0 ? 0 : Math.max(...handleCounts.values());
  return {
    toxicityScore,
    slurPrevalencePct,
    authorRecidivism,
    algorithmicAmplification: deriveAlgorithmicAmplification(postMetrics),
  };
}

/**
 * engagement-asymmetry derivation. views/likes ratio
 * captures whether the platform algorithm pushed this content beyond organic
 * engagement. Anchors:
 *   - 1-3% engagement rate is normal (ratio 33-100)
 *   - <1% engagement = algorithmic amplification (ratio >100)
 *   - >3% engagement = high organic engagement (ratio <33)
 * Any of {views, likes} missing → 'unknown' (don't conflate "not measured"
 * with "low engagement").
 */
function deriveAlgorithmicAmplification(
  postMetrics: { primary_likes?: number; views?: number } = {},
): 'high' | 'normal' | 'low' | 'unknown' {
  const views = postMetrics.views;
  const likes = postMetrics.primary_likes;
  if (typeof views !== 'number' || typeof likes !== 'number' || likes <= 0 || views <= 0) {
    return 'unknown';
  }
  const ratio = views / likes;
  if (ratio > 100) return 'high';
  if (ratio < 30) return 'low';
  return 'normal';
}

/**
 * post-LLM discourse-quality computation. Uses sentiment from Groq
 * verdicts to weight the harm-floor scores: low = negative comments rebut by
 * slur (high HF on negative). High = rebut by argument (low HF on negative).
 */
function computeDiscourseQuality(
  children: CommentNode[],
  comments: BatchCommentVerdict[],
): number {
  const negIndices = comments
    .map((v, i) => (v.sentiment === 'negative' ? i : -1))
    .filter((i) => i >= 0 && i < children.length);
  if (negIndices.length === 0) return 100;
  const negHfMean =
    negIndices.reduce((acc, i) => acc + (children[i].harm_floor?.score ?? 0), 0) /
    negIndices.length;
  return Math.max(0, Math.min(100, Math.round(100 - negHfMean)));
}

// Batch-level result cache (Path B3 — see WORK_LOG CYCLE N+36). Keyed by
// the canonical batch signature (platform + post-text-prefix + sorted
// comment-text-prefixes). LRU + 5-min TTL. Hit case: the same comment-set
// is re-extracted within the TTL window — page refresh on a permalink,
// or kid scrolls past a section then back. Bound: 50 entries × ≤2KB per
// BatchScoreResult ≈ 100KB worst-case per content-script instance, dies
// with the page on navigation.
//
// Doesn't cache failed results — a Groq outage transient must retry
// naturally on the next batch flush, not lock in a "failed" verdict for
// 5 min.
interface BatchCacheEntry {
  result: BatchScoreResult;
  timestamp: number;
  // The key is order-invariant but the result's arrays are index-aligned, so
  // the entry keeps the child order they were computed in.
  childKeys: string[];
}
const BATCH_CACHE_MAX_ENTRIES = 50;
const BATCH_CACHE_MAX_AGE_MS = 5 * 60 * 1000;
const batchCache = new Map<string, BatchCacheEntry>();

// The writer is part of the key: the cached result holds restored reasons that name people, so
// the same texts under other names must not replay them. Pairing the name with the text keeps
// the sorted key order-invariant and the per-slot realignment below unchanged.
function batchChildKey(c: CommentNode): string {
  return `${authorKey(c.author?.handle) ?? ''}\u0001${c.text.slice(0, 100)}`;
}

function computeBatchCacheKey(encounter: Encounter, mode: string): string {
  // Truncate per-text to bound memory under adversarial input. Sorting
  // makes the key order-invariant (DOM re-extract may produce children
  // in different positional order — same comment set should hash the
  // same).
  // Include `output_language` so a parent toggle from auto→explicit
  // (or one language → another) within the 5-min cache TTL doesn't
  // return a stale prior-language rewrite. Pre-2026-05-24 the
  // validator caught the drift on second-pass but the cache held the
  // bad value until eviction. Audit A1-M-CACHE-LANG + A5-B5 closure.
  const childKeys = encounter.children.map(batchChildKey).sort();
  const outputLanguage = encounter.output_language ?? 'auto';
  const people = [encounter.post.author, ...encounter.ancestors.map((a) => a.author)]
    .map((a) => authorKey(a?.handle) ?? '')
    .join(',');
  // Mode is part of the key: child and teen framings produce different
  // verdicts; a mode switch within the cache TTL must not replay the
  // other age's result.
  return [mode, encounter.platform, outputLanguage, people, encounter.post.text.slice(0, 200), ...childKeys].join('||');
}

function cachedBatchResult(key: string, childKeys: string[]): BatchScoreResult | null {
  const entry = batchCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > BATCH_CACHE_MAX_AGE_MS) {
    batchCache.delete(key);
    return null;
  }
  // Refresh insertion order for LRU semantics.
  batchCache.delete(key);
  batchCache.set(key, entry);
  return alignCachedResult(entry, childKeys);
}

// The flush applies verdict i to comment i, so a hit on a reordered re-extract
// must move each verdict, harm floor and truncation mark to its comment's new slot.
function alignCachedResult(entry: BatchCacheEntry, childKeys: string[]): BatchScoreResult | null {
  const slotsByKey = new Map<string, number[]>();
  entry.childKeys.forEach((k, j) => {
    const slots = slotsByKey.get(k);
    if (slots) slots.push(j);
    else slotsByKey.set(k, [j]);
  });
  const from: number[] = [];
  for (const k of childKeys) {
    const j = slotsByKey.get(k)?.shift();
    if (j === undefined) return null;
    from.push(j);
  }
  const { result } = entry;
  const truncated = new Set(result.truncatedIndices);
  return {
    ...result,
    comments: from.map((j, i) => ({ ...result.comments[j], index: i + 1 })),
    truncatedIndices: from.flatMap((j, i) => (truncated.has(j + 1) ? [i + 1] : [])),
    commentHarmFloors: from.map((j) => result.commentHarmFloors[j]),
  };
}

function cacheBatchResult(key: string, result: BatchScoreResult, childKeys: string[]): void {
  if (result.failed) return;
  if (batchCache.size >= BATCH_CACHE_MAX_ENTRIES) {
    const first = batchCache.keys().next().value;
    if (first !== undefined) batchCache.delete(first);
  }
  batchCache.set(key, { result, timestamp: Date.now(), childKeys });
}

/**
 * Drop the in-memory batch cache. Called by:
 *   • Tests (via the `__resetBatchCacheForTests` alias) — prevents
 *     cross-test bleed faking hits.
 *   • `forensics/store.ts:resetForensicChain` — closes a VISION §1.1
 *     chain-mirror gap. Pre-2026-05-24 the BATCH cache survived chain
 *     reset, so a re-encounter of previously-cached content within 5min
 *     post-reset returned `pre-llm-cache-pass` without writing a
 *     forensic record. The new chain showed zero records for content
 *     the child re-saw in the post-reset window.
 */
export function clearBatchCache(): void {
  batchCache.clear();
}

/** Backwards-compat alias kept for existing test imports. */
export const __resetBatchCacheForTests = clearBatchCache;

// Pre-LLM script gate helper. Matches characters in major non-Latin
// scripts (Greek / Cyrillic / Armenian / Hebrew / Arabic / Syriac /
// Devanagari / Thai / Hiragana / Katakana / CJK ideographs / Hangul).
// Latin script — including all RO diacritics in Latin Extended-A and
// most other European-language diacritics in Latin-1 Supplement /
// Extended-B — is intentionally NOT in this set.
const NON_LATIN_SCRIPT_RE =
  /[Ͱ-׿؀-ۿ܀-ݏऀ-ॿ฀-๿぀-ヿ㐀-鿿가-힯]/gu;

// Latin alphabetic range — basic ASCII letters + Latin-1 Supplement +
// Latin Extended-A (U+00C0–U+024F covers RO ăâîșț, EN typographic
// diacritics, and most European-language Latin variants).
const LATIN_ALPHA_RE = /[A-Za-zÀ-ɏ]/g;

// Returns true when the combined post + comment text is dominantly in a
// non-Latin script that the current model cannot productively classify. Conservative
// thresholds:
//   • ≥50 non-Latin alphabetic chars (floor — short snippets always pass)
//   • non-Latin count is at least 3× Latin alphabetic count (dominance —
//     mixed-language threads where any meaningful Latin content exists
//     pass through to the LLM)
//
// The 3× dominance multiplier (2026-05-25) replaces the prior ≥-1× check
// which over-fired on TikTok batches: a Filipino-caption post + 4 short
// comments where one commenter wrote in heavy Japanese (≥50 hiragana/CJK
// chars) flipped the equal-counts test, the whole batch failed closed,
// and the kid saw the comments unmarked + the dot never rendered.
// Symptom reported 2026-05-25: "app gets stuck, comments might be
// reframed but without the dot, hard to figure out." Raising the
// multiplier preserves the original Arabic / CJK / Cyrillic full-thread
// tests (those are overwhelmingly non-Latin, well above 3× Latin) while
// keeping mixed-language batches on the LLM path.
function isNonSupportedScript(postText: string, commentTexts: string[]): boolean {
  const combined = [postText, ...commentTexts].join(' ');
  const nonLatin = combined.match(NON_LATIN_SCRIPT_RE)?.length ?? 0;
  if (nonLatin < 50) return false;
  const latin = combined.match(LATIN_ALPHA_RE)?.length ?? 0;
  return nonLatin >= latin * 3;
}

function failClosed(
  childrenCount: number,
  generationTimeMs: number,
  enrichedChildren?: CommentNode[],
  postMetrics: { primary_likes?: number; views?: number } = {},
  failureMeta?: { failureKind: BatchFailureKind; retryAfterMs?: number; cap?: 'daily' | 'monthly' | 'tier-free' | 'master-off' },
): BatchScoreResult {
  // when Groq fails, fall back to per-comment harm-floor. A comment
  // with HF≥70 was clearly slur/profanity-loaded; record sev≥6 so the marker
  // still renders. Below HF=70: revert to safe 'none/sev=0' default. Per
  // VISION §1.2 — silent downgrades on protection records are catastrophic;
  // harm-floor fallback grants regex-grounded severity without Groq.
  const children = enrichedChildren ?? [];
  const comments: BatchCommentVerdict[] = Array.from({ length: childrenCount }, (_, i) => {
    const hf = children[i]?.harm_floor;
    // Identity-slur escalation in the Groq-failure path. Mirrors the
    // post-Groq override-gate at the slur-match branch below: slur-laden
    // comments route to hide-tier (sev≥8, action='hide') regardless of
    // total HF score. A bare slur scores slurBonus=50 in `enrichWithHarmFloor`
    // (below the HF≥70 escalation gate), so without this branch a slur
    // would silently downgrade to sev=0/none whenever Groq fails — exactly
    // the VISION §1.2 "silent downgrade on protection records" failure mode
    // the harm-floor fallback was designed to prevent.
    if (hf?.identity_slur_match) {
      return {
        index: i + 1,
        technique: 'shame-attack',
        sentiment: 'negative',
        severity: 8,
        confidence: 0.9,
        reason: `harm-floor fallback (groq failed): identity-slur match (${(hf.top_evidence ?? '').slice(0, 60)})`,
        action: 'hide',
        overrideOrigin: 'identity-slur',
      };
    }
    // Deterministic coded-harm catcher on the AI-off path. The success path
    // (scoreBatch override gate) runs detectCodedHarm on every comment, but
    // failClosed never reached it — so directed self-harm ("kys"), narrated
    // violence, coded-scapegoating, and clickbait-FOMO silently passed at
    // sev=0 for every free-tier child and every AI outage. These structures
    // carry no profanity/slur/caps signal, so the HF>=70 fallback below can't
    // catch them. Same patterns + same mapping as the success-path gate, so
    // this adds zero new false-positive surface (the catcher is 0-FP-validated
    // on the benign corpora). VISION §1.2: a silent sev=0 on directed harm is
    // a catastrophic protection-record downgrade.
    const codedText = children[i]?.text;
    if (codedText) {
      const coded = detectCodedHarm(codedText);
      if (coded) {
        const fields = codedHarmVerdictFields(coded);
        return {
          index: i + 1,
          technique: fields.technique,
          sentiment: 'negative',
          severity: fields.severity,
          confidence: 0.85,
          reason: `harm-floor fallback (groq failed): coded-harm ${coded.category} (${coded.evidence})`,
          overrideOrigin: 'coded-harm',
          ...(fields.hideTier ? { action: 'hide' as const } : {}),
        };
      }
    }
    const hfScore = hf?.score ?? 0;
    if (hfScore >= 70) {
      const severity = hfScore >= 90 ? 9 : hfScore >= 80 ? 8 : 7;
      // `technique:'shame-attack'` (not `'none'`) — the downstream
      // `isManipulative` predicate at content/index.ts:758 treats
      // 'none' as NON_MANIPULATION and routes the verdict to PASS_LOG
      // even when severity reaches 7-9. The fallback's purpose is
      // exactly to ESCALATE on regex-grounded harm-floor signals when
      // Groq fails; emitting a NON_MANIPULATION label silently
      // downgrades that intent.
      return {
        index: i + 1,
        technique: 'shame-attack',
        sentiment: 'negative',
        severity,
        confidence: 0.7,
        reason: `harm-floor fallback (groq failed): HF=${hfScore} ${hf?.top_category ?? ''}`,
      };
    }
    return {
      index: i + 1,
      technique: 'none',
      sentiment: 'neutral',
      severity: 0,
      confidence: 0.5,
      reason: '',
    };
  });
  const pre = computePreLlmRoomSignals(children, postMetrics);
  const discourseQuality = computeDiscourseQuality(children, comments);
  return {
    comments,
    environment: {
      label: 'unknown',
      negativePct: 0,
      positivePct: 0,
      neutralPct: 100,
      dominantTechnique: null,
      summary: '',
      toxicityScore: pre.toxicityScore,
      slurPrevalencePct: pre.slurPrevalencePct,
      authorRecidivism: pre.authorRecidivism,
      discourseQuality,
      algorithmicAmplification: pre.algorithmicAmplification,
    },
    batchSize: childrenCount,
    failed: true,
    generationTimeMs,
    truncatedIndices: [],
    commentHarmFloors: children.map((c) => c.harm_floor),
    failureKind: failureMeta?.failureKind,
    retryAfterMs: failureMeta?.retryAfterMs,
    cap: failureMeta?.cap,
  };
}

/**
 * RULE 13 code-side enrichment (Phase 2 post-LLM override).
 *
 * The small-model classifier was empirically measured as unreliable on multi-rule
 * conditional logic in BATCH prompts (same plateau as RULE 12; see comment
 * block above the Phase 1 override gate). This deterministic enrichment
 * applies "+1 severity for slur-attack comments under author-recidivism≥3"
 * after the LLM verdicts are normalized. Mutates verdicts in place to match
 * the Phase 1 override style.
 *
 * Trigger: authorRecidivism ≥ 3 AND comment is a same-target slur-attack
 * (technique ∈ {shame-attack, scapegoating} AND sentiment=negative).
 * Effect:  severity = min(9, severity + 1).
 *
 * RULE 14 routes through `applyRule14Enrichment` separately because it
 * affects ROOM label only, never per-comment severity (per prompt-rule
 * "routing ≠ content").
 */
function applyRule13Enrichment(
  comments: BatchCommentVerdict[],
  authorRecidivism: number,
): void {
  if (authorRecidivism < 3) return;
  for (let i = 0; i < comments.length; i++) {
    const c = comments[i];
    const isSlurAttack =
      (c.technique === 'shame-attack' || c.technique === 'scapegoating') &&
      c.sentiment === 'negative';
    if (!isSlurAttack) continue;
    comments[i] = { ...c, severity: Math.min(9, c.severity + 1) };
  }
}

/**
 * RULE 14 code-side enrichment (Phase 2 post-LLM, room-level only).
 *
 * High algorithmic amplification under a pile-on label means the platform
 * pushed the child into a hostile audience beyond organic engagement. Per
 * the prompt: "routing ≠ content" — per-comment severity NEVER changes;
 * only the BatchEnvironment's `forensicNarrative` field is populated. The
 * parent UX surfaces this as a room-label annotation.
 */
function applyRule14Enrichment(
  roomLabel: BatchEnvironment['label'],
  algorithmicAmplification: 'high' | 'normal' | 'low' | 'unknown',
): { forensicNarrative?: string } {
  if (algorithmicAmplification === 'high' && roomLabel === 'pile-on') {
    return { forensicNarrative: 'platform routed child to hostile environment' };
  }
  return {};
}

/**
 * The post, the thread above it and the comments: the texts a batch or room call sends. A summary
 * or a reason can quote any of them, so their words are never read as a label to restore.
 */
function textsSentIn(encounter: Encounter): string[] {
  return [
    encounter.post.text,
    ...encounter.ancestors.map((a) => a.text),
    ...encounter.children.map((c) => c.text),
  ].filter((t) => typeof t === 'string' && t.length > 0);
}

/**
 * Score a batch of comments via the BATCH classifier in a single LLM call.
 * Batch scoring handles the sentiment + technique combination across short,
 * mixed-language inputs.
 *
 * Signature takes `Encounter`. The runtime encounter builder has dedicated X,
 * TikTok, Instagram, YouTube, and Facebook assembly paths. Legacy callers or
 * observations missing the required platform/surface signals use
 * `encounterFromLegacyBatchInput` to construct a degraded form.
 *
 * `signal` is the caller's own, so it can read back which model and provider
 * answered this batch's calls (ai/call-provenance.ts) instead of whichever
 * call in the tab finished last.
 */
export async function scoreBatch(
  encounter: Encounter,
  mode: 'child' | 'teen' | 'adult' = 'teen',
  signal?: AbortSignal,
): Promise<BatchScoreResult> {
  const childrenCount = encounter.children.length;
  if (childrenCount === 0) {
    return failClosed(0, 0);
  }

  // Batch-result cache (Path B3 — WORK_LOG CYCLE N+36). Same comment-set
  // re-extracted within 5 min returns the cached BatchScoreResult, skipping
  // both the harm-floor + script-gate work AND the Groq round-trip. Common
  // case: page refresh on a permalink, kid scrolls past a section then
  // back. Cache miss is the no-op fall-through to the existing pipeline.
  const cacheKey = computeBatchCacheKey(encounter, mode);
  const childKeys = encounter.children.map(batchChildKey);
  const cached = cachedBatchResult(cacheKey, childKeys);
  if (cached) return cached;

  // Layer-1 pre-LLM enrichment. Compute per-comment
  // harm-floor BEFORE building the prompt so `buildCommentLine` emits the
  // [HF:N category] flag (per RULE 12 in prompts-v2.ts system prompt). Pure
  // function — original encounter passed to caller is unchanged.
  const enriched = enrichWithHarmFloor(encounter);

  // Pre-LLM script gate. The model reliably misbehaves on dominantly
  // non-Latin-script content (Arabic, Chinese, Japanese, Korean, Cyrillic,
  // Hebrew, Thai, Devanagari, etc.) — typically refuses, returns empty,
  // or emits malformed JSON, all of which downstream failClosed already
  // handles. Detect the situation up-front via script-class char counting
  // and skip the LLM round-trip: saves ~2s + Groq input tokens per such
  // thread. Latin-script content (incl. all RO diacritics in Latin
  // Extended-A) does NOT trigger the gate. Harm-floor + slur escalation
  // still fires via failClosed so a slur-laden non-EN comment is NOT
  // silently downgraded.
  if (isNonSupportedScript(encounter.post.text, enriched.children.map((c) => c.text))) {
    return failClosed(childrenCount, 0, enriched.children, encounter.post.metrics, {
      failureKind: 'pre-llm-unsupported-language',
    });
  }

  if (isGlobalFlushHolding()) {
    return failClosed(childrenCount, 0, enriched.children, encounter.post.metrics, {
      failureKind: 'pre-llm-circuit-breaker',
    });
  }

  // Layer-2 pre-LLM room signals. Computed BEFORE the
  // prompt so author-recidivism + algorithmic-amplification can reach Groq
  // as `[POST_ENVIRONMENT]` lines (RULE 13 + RULE 14 territory; passed to
  // `buildBatchPromptV3` as its `roomSignals` argument below).
  const preLlm = computePreLlmRoomSignals(enriched.children, encounter.post.metrics);

  // The people in this call get letters here, after the gates that read the real texts, and the
  // same map puts the names back into the answer below. Off only for a measurement arm.
  const labels: NameLabelMap | undefined = isNameLabelStepOn() ? buildNameLabelMapForEncounter(enriched) : undefined;

  const start = Date.now();
  // pass pre-computed room signals into the prompt builder via the
  // 2nd arg (`buildBatchPromptV3(encounter, roomSignals, mode)`).
  // buildReframeFewshotSystem throws fail-loud if a base-prompt anchor
  // stops matching (prompts-v2.ts). That throw is a build-time programming
  // error, but it would otherwise escape scoreBatch and reject the whole
  // batch for every user — total comment-protection loss. Degrade safely
  // to the deterministic harm-floor floor instead (same as a Groq failure).
  let system: string;
  let user: string;
  try {
    ({ system, user } = buildBatchPromptV3(enriched, preLlm, mode, labels));
  } catch (err) {
    console.error('[FW batch] prompt build threw — failing closed to harm-floor floor', err);
    return failClosed(childrenCount, Date.now() - start, enriched.children, encounter.post.metrics, {
      failureKind: 'network',
    });
  }

  // Bump max_tokens 1024 → 2048 for batch calls. 25-comment batches with
  // longer reasons can exceed 1024 and silently truncate trailing indices,
  // which the parser then defaults to 'none'/sev=0 — silent downgrades on
  // protection records violate VISION §1.2. 2048 covers the worst-case
  // observed compact-JSON output (~1100-1300 tokens at 25 comments) with
  // headroom for full reasoning. Per-post COMBINED still uses the 1024 default.
  // Per-call provider outcome. Read after the await to tell a max_tokens cut
  // from a malformed reply; held in an object so the value survives the
  // closure without relying on module state.
  const callOutcome: { last: GroqCallOutcome | null } = { last: null };
  const onCallMeta = (m: GroqCallOutcome) => { callOutcome.last = m; };

  let llmResult;
  try {
    llmResult = await callAI(system, user, true, {
      jsonMode: true, maxTokens: BATCH_MAX_TOKENS, onCallMeta, signal, knownIdentifiers: labels?.identifiers,
    });
  } catch {
    recordGlobalFlushFailure();
    return failClosed(childrenCount, Date.now() - start, enriched.children, encounter.post.metrics, {
      failureKind: 'network',
    });
  }
  const generationTimeMs = Date.now() - start;
  if (!llmResult.ok) {
    // Only transient infra errors should arm the 15s global-flush hold.
    // cap-exhausted (user quota) and aborted (user scrolled away) are not
    // signs of vendor distress and must NOT block subsequent flushes.
    const kind = llmResult.error.kind;
    if (kind === 'rate-limit' || kind === 'transient-http' || kind === 'network') {
      recordGlobalFlushFailure();
    }
    return failClosed(childrenCount, generationTimeMs, enriched.children, encounter.post.metrics, {
      failureKind: kind,
      retryAfterMs: 'retryAfterMs' in llmResult.error ? llmResult.error.retryAfterMs : undefined,
      cap: 'cap' in llmResult.error ? llmResult.error.cap : undefined,
    });
  }
  let raw = llmResult.value;
  let elapsedMs = generationTimeMs;

  // Tier-4 truncation salvage (W88) runs inside readBatchReply: a max_tokens
  // cut leaves the JSON unbalanced, so all three parseJSON tiers return null,
  // but the reply usually carries several COMPLETE verdicts before the cut.
  let read = readBatchReply(raw);

  // One retry for a CONFIRMED cut that salvaged nothing (2026-09-02). The
  // provider said `finish_reason: 'length'` and not a single verdict object
  // closed before the cut — the whole paid call is otherwise discarded, and
  // every comment in the batch loses its judgement. Doubling the budget once
  // recovers that spend. Deliberately narrow: an unparseable reply with any
  // other finish reason is a refusal or a shape fault, which a repeat call
  // reproduces rather than fixes.
  if (!read && callOutcome.last?.truncated) {
    console.warn(
      `[FW comment-batch] LLM reply cut at max_tokens with nothing salvageable ` +
      `(${describeBatchReply(raw, callOutcome.last)}) — retrying once at ${BATCH_TRUNCATION_RETRY_MAX_TOKENS} tokens.`,
    );
    const retryStart = Date.now();
    let retry;
    try {
      retry = await callAI(system, user, true, {
        jsonMode: true, maxTokens: BATCH_TRUNCATION_RETRY_MAX_TOKENS, onCallMeta, signal, knownIdentifiers: labels?.identifiers,
      });
    } catch {
      retry = null;
    }
    elapsedMs += Date.now() - retryStart;
    if (retry?.ok) {
      raw = retry.value;
      read = readBatchReply(raw);
    }
  }

  if (!read) {
    // Make the failure OBSERVABLE (Power-of-Ten Rule 7): a malformed LLM
    // response is safe (it falls closed to the deterministic floor below),
    // but it was previously SILENT and unnamed — the console guessed
    // `provider-unparseable-json` for three different states and the chain
    // record carried no failureKind at all, so a repeat failure in the
    // owner's diagnostics could not be traced. Both now say which state it
    // was and what the reply looked like. failClosed still runs the slur /
    // coded-harm / harm-floor protection.
    console.warn(
      `[FW comment-batch] LLM response unparseable — failing closed to the deterministic floor. ` +
      describeBatchReply(raw, callOutcome.last),
    );
    return failClosed(childrenCount, elapsedMs, enriched.children, encounter.post.metrics, {
      failureKind: 'provider-unparseable-json',
    });
  }
  if (read.salvaged) {
    console.warn(
      `[FW comment-batch] LLM reply truncated mid-JSON — salvaged ${(read.reply.comments as unknown[]).length} complete ` +
      `verdict(s); missing indices route to cancelled-batch-truncated.`,
    );
  }
  const parsed = read.reply;
  if (!parsed.environment && (parsed.comments as unknown[]).length === 0) {
    // Valid JSON shape but zero verdicts AND no room block — nothing usable;
    // same fail-closed as before (deterministic floor still protects).
    console.warn(
      `[FW comment-batch] LLM response carried no verdicts and no environment — failing closed to the ` +
      `deterministic floor. ${describeBatchReply(raw, callOutcome.last)}`,
    );
    return failClosed(childrenCount, elapsedMs, enriched.children, encounter.post.metrics, {
      failureKind: 'provider-empty-verdicts',
    });
  }

  // Per-comment normalization. Index-align to the children length so even
  // partial LLM outputs produce a record per child (defaults fill the gaps).
  const byIndex = new Map<number, BatchCommentVerdict>();
  let targetAbsentDowngrades = 0;
  const sentTexts = textsSentIn(enriched);
  for (const item of parsed.comments as Array<Record<string, unknown>>) {
    const idx = Number(item.index);
    if (!Number.isInteger(idx) || idx < 1 || idx > childrenCount) continue;
    let technique = VALID_TECHNIQUES.has(item.technique as BatchCommentVerdict['technique'])
      ? (item.technique as BatchCommentVerdict['technique'])
      : 'none';
    let severity = clampSeverity(item.severity);
    // target_present gate (2026-06-10) — structural enforcement of the
    // person-present rule for shame-attack. The prose rule (system prompt
    // "PERSON PRESENT", public-figure example) is measured-ignored by the model:
    // all 21 honest-en-v1 false positives were shame-attack verdicts aimed
    // at public figures / absent third parties / commenters-in-general.
    // Same pattern as the harm-floor override gate below: the model doesn't honor
    // conditional prose, so the model fills a schema slot and CODE applies
    // the rule. A BOOLEAN deliberately: a 5-value target enum (reader /
    // participant / video-subject / public-figure / absent) was measured
    // WORSE on honest-en-v1 (F1 64.4 vs 71.9 boolean vs 69.5 no-gate,
    // 2026-06-10) — the finer classification exceeds the model's per-comment
    // reasoning budget and degraded unrelated verdicts. Missing /
    // non-boolean target_present keeps the verdict unchanged (fail-open
    // to prior behavior). Real identity slurs are re-escalated downstream
    // by applyOverrideGates, which runs after this.
    if (technique === 'shame-attack' && item.target_present === false) {
      technique = 'genuine-opinion';
      severity = Math.min(severity, 3);
      targetAbsentDowngrades++;
    } else if (technique === 'shame-attack' && item.target_present !== true) {
      // The model does not fill the slot: the gate above fired 0 times across
      // both 2026-07-24 baselines, and public-figure mockery kept flagging (8
      // sampled false alarms, docs/measurements/2026-08-02-accuracy.md §3c).
      // So presence is decided code-side by the same detector the hide
      // exemption uses: @-mention or second-person address, EN + RO,
      // deliberately overmatching so a collision KEEPS the verdict.
      //
      // This reaches the FLAG tier, which the 2026-07-24 exemption
      // deliberately did not. That boundary was drawn because both true-
      // positive costs in its eval were SCAPEGOATING verdicts; scapegoating is
      // untouched here, and dehumanizing text is exempted below, so the
      // protection the boundary was guarding is intact. Reopened 2026-08-02 on
      // the newer independent measurement.
      const text = enriched.children[idx - 1]?.text;
      if (
        typeof text === 'string'
        && text.trim().length > 0
        && !hasPresentTarget(text)
        && !detectDehumanization(text).triggered
      ) {
        technique = 'genuine-opinion';
        severity = Math.min(severity, 3);
        targetAbsentDowngrades++;
      }
    }
    const sentiment = (item.sentiment === 'negative' || item.sentiment === 'positive')
      ? item.sentiment
      : 'neutral';
    // Phase 2B (2026-05-15) — inline rewrite extraction. V3 BATCH prompt
    // produces `neutralized_text` for concerning techniques in the same
    // call. flushBatch uses it directly when present; falls back to
    // neutralizeText when undefined / null (V2 prompts or shape drift).
    // Defensive parse: only accept non-empty strings; coerce everything
    // else to undefined so the callback's typeof === 'string' check holds.
    // The names go back before anything is cut or kept: a label split by a cut could not be put
    // back, and a rewrite that still holds a label nobody got is dropped rather than shown.
    const rawNeutralized = item.neutralized_text;
    let neutralizedText =
      typeof rawNeutralized === 'string' && rawNeutralized.trim().length > 0
        ? rawNeutralized
        : undefined;
    // Each name comes back as this comment wrote it, so a display name is not shown as a handle.
    const ownText = enriched.children[idx - 1]?.text;
    if (labels && neutralizedText !== undefined) {
      neutralizedText = restoreNames(labels, neutralizedText, 'rewrite', ownText).text ?? undefined;
    }
    const rawReason = typeof item.reason === 'string' ? item.reason : '';
    const reason = labels ? (restoreNames(labels, rawReason, 'reason', ownText, sentTexts).text ?? '') : rawReason;
    const rawConf = Number(item.confidence);
    const confidence = Number.isFinite(rawConf) && rawConf >= 0 && rawConf <= 1 ? rawConf : 0.5;
    byIndex.set(idx, {
      index: idx,
      technique,
      sentiment,
      severity,
      confidence,
      reason: reason.slice(0, 280),
      neutralizedText,
    });
  }
  if (targetAbsentDowngrades > 0) {
    console.debug(
      `[FW comment-batch] target_present gate downgraded ${targetAbsentDowngrades} shame-attack verdict(s) aimed at absent targets`,
    );
  }

  // Detect truncation BEFORE building the output array. If the LLM
  // omitted indices (typically max_tokens cut-off mid-array), surface them
  // through `truncatedIndices` so the caller can emit a forensic
  // `cancelled-batch-truncated` chain event for those indices instead of
  // silently downgrading to 'none'/sev=0.
  const truncatedIndices: number[] = [];
  for (let i = 0; i < childrenCount; i++) {
    const idx = i + 1;
    if (!byIndex.has(idx)) truncatedIndices.push(idx);
  }
  if (truncatedIndices.length > 0) {
    console.warn(
      `[FW comment-batch] LLM response omitted ${truncatedIndices.length}/${childrenCount} indices ` +
      `(likely max_tokens truncation). Indices: ${truncatedIndices.join(',')}. Defaulting to 'none' for these; ` +
      `caller should emit cancelled-batch-truncated forensic events.`,
    );
  }

  const comments: BatchCommentVerdict[] = Array.from({ length: childrenCount }, (_, i) => {
    const idx = i + 1;
    return byIndex.get(idx) ?? {
      index: idx,
      technique: 'none' as const,
      sentiment: 'neutral' as const,
      severity: 0,
      confidence: 0.5,
      reason: '',
    };
  });

  // harm-floor verdict-override gate.
  //
  // When the per-comment harm-floor pre-filter (computed at line ~571 via
  // enrichWithHarmFloor) flagged ad-hominem / identity-slur signal AND the
  // classifier returned a non-flag technique (sarcasm / genuine-opinion /
  // none / neutral) at low severity, override the verdict to shame-attack.
  //
  // Why gate-side, not prompt-side: empirical verification
  // measured the .B Session 1 prompt-rule (slur-trumps-sarcasm exception
  // in `prompts-v2.ts:649-665` + `:854-870`) as NOT firing on the model. Same comment
  // "Şobolane … vine frigu', ha?" classified as `tech=sarcasm sev=3` both pre
  // and post the prompt-rule landing. Small open models
  // don't reliably honor multi-rule conditional logic in BATCH prompts.
  // The harm-floor regex IS deterministic; the override gate is too. See
  // memory `feedback_harm_floor_verdict_override_not_prompt_rule.md`.
  //
  // Conditions:
  //   • identity-slur match (profanity-filter SLURS dict) → escalate to
  //     shame-attack severity 8 ALWAYS (catastrophic for child-feed; identity-
  //     axis dehumanization is the IDENTITY_SLUR_WEIGHT canonical case)
  //   • ad-hominem top-category (harm-floor.ts cat B) AND classifier verdict
  //     is non-flag at low severity → escalate to shame-attack severity 6
  //     (catches the Şobolane sarcasm-misclass + future similar cases)
  //
  // Scope guards:
  //   • only fires when classifier ALREADY decided "not manipulation" — does
  //     NOT downgrade or change verdicts the classifier flagged correctly
  //   • leaves severity if already ≥ override floor (no double-escalate)
  //   • leaves reason field populated by classifier when present (parent UX
  //     keeps the LLM's per-comment explanation; only fills when blank)
  //
  // Strictly additive — when no harm-floor flag is set OR classifier already
  // flagged adequately, the verdict is byte-identical.
  let overrideFiredCount = 0;
  for (let i = 0; i < comments.length; i++) {
    // Per-comment deterministic override gates (identity-slur → profanity-tier
    // hide → coded-harm → harm-floor HF≥70 → ad-hominem). The gate logic lives
    // in the pure, independently-unit-tested applyOverrideGates (above); this
    // loop just applies it and tallies how many fired for the diagnostic.
    // NOTE for V1.5: the "Şobolane" (RO dehumanization slur) miss is in that
    // function's ad-hominem branch — it's a harm-floor categorization gap, NOT
    // an override bug; do not add a regex patch (audience-appropriateness
    // reframe is the architectural lever).
    const r = applyOverrideGates(
      comments[i],
      enriched.children[i]?.harm_floor,
      enriched.children[i]?.text,
      mode,
    );
    comments[i] = r.verdict;
    if (r.fired) overrideFiredCount++;
  }
  if (overrideFiredCount > 0) {
    console.debug(
      `[FW comment-batch] harm-floor override fired ${overrideFiredCount}/${comments.length} verdicts`,
    );
  }

  // Aggregate the room. Use OUR own counts from per-comment verdicts as the
  // source of truth — don't trust the LLM to do percentage math.
  const total = comments.length;
  let neg = 0, pos = 0, neu = 0;
  const techCounts = new Map<BatchCommentVerdict['technique'], number>();
  for (const c of comments) {
    if (c.sentiment === 'negative') neg++;
    else if (c.sentiment === 'positive') pos++;
    else neu++;
    techCounts.set(c.technique, (techCounts.get(c.technique) ?? 0) + 1);
  }
  const negPct = Math.round((neg / total) * 100);
  const posPct = Math.round((pos / total) * 100);
  const neuPct = 100 - negPct - posPct;

  let dominantTechnique: BatchCommentVerdict['technique'] | null = null;
  let dominantCount = 0;
  for (const [tech, count] of techCounts) {
    if (tech === 'none' || tech === 'neutral') continue;
    if (count > dominantCount) { dominantTechnique = tech; dominantCount = count; }
  }

  // `environment` may be absent when the reply was truncated before the room
  // block (W88 salvage path) — every field it feeds has an honest fallback
  // ('unknown' label / empty summary), and all numeric room fields are
  // computed code-side from the verdicts anyway.
  const env = (parsed.environment ?? {}) as Record<string, unknown>;
  const llmLabel = VALID_LABELS.has(env.label as BatchEnvironment['label'])
    ? (env.label as BatchEnvironment['label'])
    : 'unknown';
  const rawSummary = typeof env.summary === 'string' ? env.summary : '';
  const summary = (labels ? (restoreNames(labels, rawSummary, 'reason', undefined, sentTexts).text ?? '') : rawSummary).slice(0, 400);

  // / Layer-2 room-shape signals. The pre-LLM signals
  // (toxicityScore, slurPrevalencePct, authorRecidivism, algorithmic-
  // amplification) were already computed pre-prompt. The post-LLM signal
  // (discourseQuality) needs sentiment from the LLM verdicts, computed here.
  const discourseQuality = computeDiscourseQuality(enriched.children, comments);

  // Phase 2 enrichment (RULES 13 + 14). Phase 1 (identity-slur + ad-hominem
  // override) ran above on the per-comment verdicts; Phase 2 runs after the
  // room label + post-LLM signals are known. Mirrors the prompt-side rules
  // but is deterministic (small-model plateau on multi-rule conditional logic).
  applyRule13Enrichment(comments, preLlm.authorRecidivism);
  const rule14 = applyRule14Enrichment(llmLabel, preLlm.algorithmicAmplification);

  const result: BatchScoreResult = {
    comments,
    environment: {
      label: llmLabel,
      negativePct: negPct,
      positivePct: posPct,
      neutralPct: neuPct,
      dominantTechnique,
      summary,
      toxicityScore: preLlm.toxicityScore,
      slurPrevalencePct: preLlm.slurPrevalencePct,
      authorRecidivism: preLlm.authorRecidivism,
      discourseQuality,
      algorithmicAmplification: preLlm.algorithmicAmplification,
      ...(rule14.forensicNarrative ? { forensicNarrative: rule14.forensicNarrative } : {}),
    },
    batchSize: total,
    failed: false,
    // Includes the truncation retry when one was spent, so the recorded
    // wall-clock is what the batch actually cost.
    generationTimeMs: elapsedMs,
    truncatedIndices,
    commentHarmFloors: enriched.children.map((c) => c.harm_floor),
  };
  cacheBatchResult(cacheKey, result, childKeys);
  return result;
}

// ─── Room sensor — the SEPARATE second call (see buildRoomPrompt) ──────────

/**
 * Parse the room-analysis JSON. Pure + null-safe: an unparseable or
 * summary-less response yields null (the caller then keeps the per-comment
 * call's basic environment unchanged). Invalid enum values default to the safe
 * 'no-claim' / 'none'.
 */
export function parseRoomAnalysis(raw: string, labels?: NameLabelMap, sentTexts: readonly string[] = []): RoomAnalysis | null {
  const parsed = parseJSON(raw) as Record<string, unknown> | null;
  if (!parsed || typeof parsed !== 'object') return null;
  // The names go back before the cut, for the same reason as in the batch.
  const rawSummary = typeof parsed.summary === 'string' ? parsed.summary : '';
  const summary = (labels ? (restoreNames(labels, rawSummary, 'reason', undefined, sentTexts).text ?? '') : rawSummary).trim().slice(0, 400);
  if (!summary) return null;
  const cvr = parsed.claim_vs_reaction;
  const cm = parsed.comment_manipulation;
  // Topic labels: closed-list validation — unknown/duplicate values dropped,
  // capped at 3. A non-array or absent field yields [] (older cached
  // responses, model omissions).
  const rawLabels = Array.isArray(parsed.topic_labels) ? parsed.topic_labels : [];
  const topicLabels = [...new Set(
    rawLabels.filter((l): l is TopicLabel => typeof l === 'string' && VALID_TOPIC_LABELS.has(l)),
  )].slice(0, 3);
  return {
    claimVsReaction: VALID_CLAIM_VS_REACTION.has(cvr as string)
      ? (cvr as RoomAnalysis['claimVsReaction'])
      : 'no-claim',
    commentManipulation: VALID_COMMENT_MANIPULATION.has(cm as string)
      ? (cm as RoomAnalysis['commentManipulation'])
      : 'none',
    audienceDistress: parsed.audience_distress === true,
    summary,
    topicLabels,
  };
}

/**
 * Run the room-analysis call — a SEPARATE Groq round-trip from scoreBatch that
 * never touches the per-comment detection prompt, so it cannot move the
 * corpus-measured detection numbers. Returns null on cap / network / parse
 * failure; the caller then keeps scoreBatch's basic environment unchanged
 * (graceful degradation — it never blocks or alters the per-comment records).
 */
export async function scoreRoom(
  encounter: Encounter,
  mode: 'child' | 'teen' | 'adult' = 'teen',
): Promise<RoomAnalysis | null> {
  if (isGlobalFlushHolding()) return null;
  try {
    // Its own map: the room call starts after any batch result, including a cache hit that built none.
    const labels = isNameLabelStepOn() ? buildNameLabelMapForEncounter(encounter) : undefined;
    const { system, user } = buildRoomPrompt(encounter, mode, labels);
    const res = await callAI(system, user, true, { jsonMode: true, maxTokens: 400, knownIdentifiers: labels?.identifiers });
    if (!res.ok) return null;
    return parseRoomAnalysis(res.value, labels, textsSentIn(encounter));
  } catch {
    return null;
  }
}

// The shape lives in src/types/batch-verdict.ts so the types layer imports nothing (PLAN-2026-09-16 item 8.6);
// every importer of this module keeps working through this re-export.
export type { BatchCommentVerdict } from '../types/batch-verdict';

// The floor lives in src/core/severity-floor.ts so the free filter can read it without reaching
// into the recorder's analysis layer (PLAN-2026-09-16 item 9.1); every importer here is unchanged.
export { MANIPULATION_SEVERITY_THRESHOLD } from '../core/severity-floor';
