// FeelingWise - Processing Pipeline Orchestrator
// Single-call detection + neutralization for minimal latency.
//
// CARDINAL RULE: When in doubt, PASS. Ambiguous = non-intervention.

import { PostContent } from '../types/post';
import { AnalysisResult, TechniqueName, TechniqueResult } from '../types/analysis';
import { ruleAnalysis } from '../core/analysis-result';
import { NeutralizedContent } from '../types/neutralization';
import { detect } from '../core/detector';
import { combinedDetectAndNeutralize } from '../core/neutralizer';
import {
  buildNameLabelMapForPost, isNameLabelStepOn, replaceNamesInCaptionContext, replaceNamesInText, restoreNames,
} from '../core/name-labels';
import { neutralizeText } from '../ai/neutralize-only';
import { askClaudeReader, claudeReadingOn } from '../ai/claude-reader';
import { getSettings, isFeatureEnabled, type FWSettings } from '../storage/settings';
import { makesNoOutsideCall } from '../types/mode';
import { readingActiveNow } from '../ai/gate-with-agreement';
import type { Platform } from '../types/post';
import { activeParentBlocklist, matchParentBlocklist } from '../core/parent-blocklist';
import { activeTopics, matchTopics } from '../core/policy/topic-lexicon';
import {
  getExposurePressure,
  creativeHash,
  EXPOSURE_WINDOW_DAYS,
  type AuthorProfile,
  type ExposurePressure,
} from '../forensics/author-store';
import { fetchAuthorProfile } from '../forensics/author-profile-client';
import { processingCache } from '../storage/cache';
import { verdictCacheKeyInput } from '../storage/cache-key';
import { sha256 } from '../forensics/hasher';
import { getLastFailureKind, readingAllowed } from '../ai/client';
import { callProvenanceFor, latestModelFor } from '../ai/call-provenance';
import type { ForensicRecord } from '../types/forensic';
import { getEffectiveThreshold } from '../core/calibration';
import { filterProfanity, maskProfanity } from '../core/profanity-filter';
import { detectDehumanization } from '../core/dehumanization-filter';
import { detectViolenceNarratingVideo } from '../core/violence-narrating-video';
// Deterministic coded-harm floor. `detectCodedHarm` + `codedHarmVerdictFields`
// are the SINGLE category→verdict mapping shared with the comment path
// (comment-batch-scorer's success gate + AI-off fallback). Wired here to close
// AI-1 (swarm-2026-07-13): directed self-harm / sexual solicitation / doxxing /
// narrated violence in a POST passed silently on the no-AI post paths.
import { detectCodedHarm, codedHarmVerdictFields } from '../core/coded-harm-catcher';
// Global flush-budget circuit-breaker. recordFailure()/isHolding() arm a
// 15s hold after 3 LLM failures in 10s. Shared with the BATCH path
// (comment-batch-scorer.ts) so cascading Groq failures on the single-post
// path are throttled by the same module-global hold.
import { isHolding, recordFailure } from '../ai/global-flush-budget';
import { startTrace } from '../diagnostics/perf-trace';
// Language-guard imports for the post-LLM rewrite validation step.
// `detectLanguage` is the same detector the extractor uses;
// `validateRewriteLanguage` is a 3-tier validator that catches the
// dominant LLM failure mode (drift to English on RO prompt). Lives in
// analysis/ historically but only depends on core/lang-detect —
// crossing the layer boundary here is cheaper than refactoring the
// file.
import { detectLanguage } from '../core/lang-detect';
import { rewriteKeepsTheAttack } from './rewrite-keeps-attack';
import { recordNeutralizerEvent } from '../forensics/neutralizer-diagnostics';
import { validateRewriteLanguage } from '../analysis/comment-rewriter';
// License tier resolution. Free tier short-circuits the entire
// detection pipeline (no slur filter, no profanity, no L1, no LLM call):
// Free = engagement-hide DOM-only, zero text rewriting, zero
// third-party AI. Paid tiers run the full pipeline.
import { getLicense, dailyCapForTier, effectiveMonthlyTokenCap, isUncappedTier } from '../storage/license';
// Harm-floor L1.5 layer. Runs between L1 regex (`detect()`) and cap
// check (free — no LLM tokens). When score ≥ 70 AND no L1 classifier
// returned present=true, emits a synthetic detection so the parent sees
// a marker. Independent of LLM/neutralizer outcome (the silent
// neutralizer-rejection rate is non-trivial); harm-floor fires
// regardless.
import { computeHarmFloor, HARM_FLOOR_TRIGGER_THRESHOLD } from '../core/harm-floor';

/**
 * Pass-context. Each PASS branch in `process()` returns a tagged reason:
 *   • Pre-LLM passes (`reason` starts with `pre-llm-`) — caller should
 *     scan-log only.
 *   • Post-LLM passes (`reason` starts with `post-llm-`) — caller should
 *     also emit a forensic record with `verdict='pass'` so the recall
 *     instrument can sample-re-judge. `analysis` carries the L1 reasoning
 *     + scores for that path.
 */
export type PassReason =
  | 'pre-llm-too-short'
  | 'pre-llm-non-substantive'
  | 'pre-llm-cache-pass'
  | 'pre-llm-cap-exhausted'
  | 'pre-llm-ai-call-failed'
  | 'post-llm-not-manipulative'
  | 'post-llm-below-threshold'
  | 'post-llm-no-neutralization'
  // Free-tier short-circuit. The user has no paid license, so the
  // extension does not run text detection / rewriting at all. Engagement
  // controls (engagement/*) still run independently of process();
  // Free-tier installs see only DOM-side hide actions. No forensic
  // record, no recall-instrument sampling.
  | 'pre-llm-free-tier-no-ai'
  // A level that makes no outside call (Strict, or one nobody has chosen yet) reads nothing at all. The rules
  // above ran; the reading does not, so the post is recorded as not read at this level, not as a call that failed.
  | 'pre-llm-level-reads-nothing'
  // The cover's deadline asked for the local result only (child-first-protection.ts): the rules ran, no reading did.
  | 'pre-llm-deadline-local-only';

interface PassContext {
  reason: PassReason;
  /** Present iff the LLM actually ran (post-llm-* reasons). */
  analysis?: AnalysisResult;
  /** Provider metadata for the chain record. */
  aiMeta?: { model: string; provider: string };
  /**
   * Why no verdict exists, on `pre-llm-ai-call-failed` only.
   *
   * Three different things used to share that one reason string: the circuit
   * breaker declining to call, a real vendor or network failure, and an
   * exception inside FeelingWise's own code. They are not the same event and
   * a record that cannot tell them apart is read as `network` by the
   * dashboard's back-compat default, which invents an attribution.
   */
  failureKind?: ForensicFailureKind;
}

/** The kind word the judge is told: comment kinds fold to 'comment', as the protocol's runner did. */
/**
 * The judge's own rule for a missing rewrite, for where a rewrite is dropped after the judge ran (a name label nobody
 * got, an attack the rewrite kept): a severe hostile flag is hidden, as it is when the judge rejects the rewrite itself.
 */
function hideWhenSevereAndHostile(analysis: AnalysisResult): void {
  const sev = analysis.overallScore ?? 0;
  const t = analysis.primaryTechnique;
  const hostile = t === 'shame-attack' || t === 'scapegoating' || t === 'anger-trigger' || t === 'fear-appeal';
  if (analysis.isManipulative && analysis.action !== 'collapse' && sev >= 7 && hostile) analysis.action = 'hide';
}

/**
 * Where the item sits, for the Moderate judge: the site, whether it is a post, a comment or a video, and the post a comment answers.
 * The Relaxed judge is handed these as fields of its own; the Moderate judge's prompt has no field for them, but it reads a
 * context block (surrounding discourse, "context only, judge the post above"), so they go there in the words the Relaxed judge's
 * prompt uses. Before this the Moderate judge read a reply to a thread as a post of no known site (the export study, 12 Oct
 * 2026). The parent is passed with its names already replaced by letters; the quoted post and the link card are not sent here,
 * because the card text carries the quoted account's display name, which no letter replaces.
 */
export function moderateWhereItSits(
  platform: string | undefined,
  kind: 'post' | 'comment' | 'video',
  parentText: string | undefined,
  card?: { quotedBody?: string; link?: { title?: string; domain?: string } },
): string {
  const lines = [`Platform: ${platform ?? 'unknown'}`, `Kind: ${kind}`];
  const parent = parentText?.trim();
  if (parent) lines.push(`THE POST IT REPLIES TO (context only, not the item to judge):\n${parent.slice(0, 600)}`);
  // The quoted post's body, capped, with no author; a link card's title and domain, nothing else. The caller has already put a
  // letter in place of every handle in the body (a display name never goes: the card reader does not hand it over).
  const quoted = card?.quotedBody?.trim();
  if (quoted) lines.push(`THE POST IT QUOTES (context only, not the item to judge):\n${quoted.slice(0, 400)}`);
  const link = card?.link;
  if (link && (link.title || link.domain)) {
    lines.push(`A LINK CARD UNDER THE POST (context only): ${[link.title, link.domain ? `(${link.domain})` : ''].filter(Boolean).join(' ')}`);
  }
  return lines.join('\n');
}

export function judgeKindFor(kind: PostContent['kind'] | undefined): 'post' | 'comment' | 'video' {
  if (kind === 'comment' || kind === 'top-comment' || kind === 'reply' || kind === 'reply-to-reply') return 'comment';
  if (kind === 'video') return 'video';
  return 'post';
}

export interface PipelineResult {
  // Every confirmed detection is neutralized silently; per-post analysis
  // lives in the dashboard, not in the feed.
  //
  // The detector assigns an action label per post (see
  // AnalysisResult.action). Generic-group claims and synthetic AI drama
  // route to 'collapse' (post body folded under a placeholder; original
  // preserved in chain). Direct threats and doxxing route to 'hide'
  // (visual placeholder; chain still records). 'neutralize' is the
  // default for all rewrite-eligible techniques.
  //
  // 'cancelled' is for the case where the queue signalled via
  // AbortController that the user scrolled past before the post finished
  // classifying. Two sub-kinds via `cancelKind`:
  //   • 'stale'      — abort fired before / during the API round-trip;
  //                    no analysis available
  //   • 'mid-flight' — abort fired AFTER combinedDetectAndNeutralize
  //                    returned a valid AnalysisResult; the verdict
  //                    payload is preserved in `analysis` and persisted
  //                    to the chain per VISION §1.1 forensic-
  //                    completeness invariant ("every observed post
  //                    produces a chain record").
  // The content-script onProcessingResult router maps 'cancelled' to a
  // CANCEL_LOG message that stamps verdict='cancelled-stale' or
  // 'cancelled-mid-flight' on the chain. UI rendering is suppressed
  // unconditionally for cancelled results — the user already moved on.
  action: 'pass' | 'neutralize' | 'collapse' | 'hide' | 'mark' | 'cancelled';
  neutralized?: NeutralizedContent;
  /**
   * Analysis payload carried alongside collapse/hide actions where
   * there is no NeutralizedContent. For 'neutralize' the analysis is in
   * `neutralized.analysis`; for 'collapse' and 'hide' it's here.
   * Callers that need analysis should read
   * `neutralized?.analysis ?? analysis` to handle both.
   *
   * Also carried on action='cancelled' with cancelKind='mid-flight'
   * (the AI returned a verdict before abort fired; the verdict is
   * preserved for chain persistence even though no UI mutation will
   * land).
   */
  analysis?: AnalysisResult;
  aiMeta?: { model: string; provider: string };
  detectionMode?: string;
  /** For a mark: the one fixed word for why the rewrite did not come back (rewrite.why on the decision record). */
  rewriteWhy?: string;
  passContext?: PassContext;
  /**
   * The mode the pipeline read when it judged (or declined to judge) this
   * item. Stamped by `process` from its single settings read, so an emit site
   * that reads settings again after the fact (they all run async, after the
   * verdict) does not sign a record with a mode the user switched to in
   * between. Absent only on results built outside `process`.
   */
  judgedMode?: FWSettings['mode'];
  /**
   * Cancel discriminator. Only meaningful when action === 'cancelled'.
   * Maps to the chain verdict per VISION §1.1:
   *   'stale'      → verdict='cancelled-stale'
   *   'mid-flight' → verdict='cancelled-mid-flight' (analysis populated)
   */
  cancelKind?: 'stale' | 'mid-flight';
}

/** Failure discriminators the chain record can carry. Mirrors ForensicRecord. */
type ForensicFailureKind = NonNullable<ForensicRecord['failureKind']>;

function passWith(reason: PassReason, extras?: Partial<PassContext>): PipelineResult {
  return {
    action: 'pass',
    passContext: { reason, ...extras },
  };
}

/**
 * Cancel-result builders.
 *
 * `cancelStale`: signal aborted before / during the API round-trip — no
 * AnalysisResult available. Content-script onProcessingResult routes
 * this to a CANCEL_LOG with verdict='cancelled-stale'.
 *
 * `cancelMidFlight`: signal aborted AFTER combinedDetectAndNeutralize
 * returned a valid AnalysisResult. The verdict payload is preserved for
 * chain persistence per VISION §1.1 ("every observed post produces a
 * chain record"). Content-script routes to CANCEL_LOG with
 * verdict='cancelled-mid-flight' carrying the analysis.
 */
function cancelStale(): PipelineResult {
  return { action: 'cancelled', cancelKind: 'stale' };
}

function cancelMidFlight(
  analysis: AnalysisResult,
  aiMeta?: { model: string; provider: string },
): PipelineResult {
  return { action: 'cancelled', cancelKind: 'mid-flight', analysis, aiMeta };
}

// Each PASS branch returns its own object via `passWith(reason)` so the
// reason attributes the fall-through to a specific gate. A shared
// `const PASS = { action: 'pass' }` singleton would lose that
// attribution, the cost of one allocation per call is justified by the
// debuggability gain.

// Minimum text length to warrant AI analysis. The 12-char threshold lets
// short manipulation patterns through ("don't trust him", "she's lying
// again") while excluding fragments where the model has no context to
// classify. The "when in doubt, PASS" rule in the prompt handles the noise
// side.
const MIN_TEXT_LENGTH = 12;

// High-risk pass-through.
//
// The combined-detect-neutralize rewrite has been observed to fail
// catastrophically on parasocial-coercion: voice-inversion (3rd-person
// fan → 1st-person target) + content fabrication ("I'm glad you're a
// fan of my work" — never said by anyone).
//
// The COMBINED prompt carries the voice-preservation rule but the model honors
// prompt rules at ~80% reliability — the 20% tail produces trust-
// eroding rewrites VISION §1.2 cannot accept ("one false positive
// destroys forensic admissibility").
//
// When the primary technique falls in this set, skip applying the LLM
// rewrite — keep the original text on the page — but still record the
// flag in the forensic chain so the parent sees the marker + technique
// label in the dashboard. The detection signal is preserved; only the
// trust-fragile rewrite is suppressed.
//
// Conservative set — only the technique with documented failures.
// Expand on observed evidence; do not pre-empt.
const HIGH_RISK_PASS_THROUGH_TECHNIQUES: ReadonlySet<TechniqueName> = new Set<TechniqueName>([
  'parasocial-coercion',
]);

export function isHighRiskPassThrough(primaryTechnique: TechniqueName | undefined): boolean {
  return !!primaryTechnique && HIGH_RISK_PASS_THROUGH_TECHNIQUES.has(primaryTechnique);
}

/**
 * Blanket profanity-softening gate, shared by the posts pipeline (below)
 * and the comments path (`src/content/index.ts` flushBatch house-rule
 * handling). Converted from a mode wire to a real switch (wiring Q4,
 * docs/spec/mode-rails.md C1): the `soften-swearing` feature toggle owns
 * the PAID rewrite spend (seeded ON by the child preset, OFF for teen and
 * adult), and `strictLanguage` implies it in any mode ("no swearing in
 * this house" as an explicit family choice). The former always-on teen
 * rule was evidence-retired (.brain/DECISIONS.md 2026-06-10). Slur tier,
 * detected attacks, the child profanity HIDE, and hideOnRewriteUnavailable
 * are visibility rails and are NOT governed by this gate.
 */
export function blanketProfanitySoften(
  settings: FWSettings,
  platform?: Platform,
): boolean {
  // Child is a rail: the owner decided a child install always gets strict
  // protection, since a parent would rather see swearing hidden whenever it is
  // correctly caught. Before that this had no mode branch at all and
  // a child install reached it only because childPreset seeds the switch ON, so
  // a per-platform override, or a grid stored before that seeding, left
  // swearing unmasked while both popups showed the row locked on and said Child
  // mode always softens (M326). The evidence that retired the always-on TEEN
  // rule in June is untouched and stays retired: 31 of 36 teen softenings acted
  // on register profanity that was fine for a teen. This is the child cell
  // only.
  if (settings.mode === 'child') return true;
  return isFeatureEnabled(settings, 'soften-swearing', platform) || settings.strictLanguage;
}

/**
 * Whether a confirmed flag whose rewrite is unavailable is folded instead of
 * marked. Since 2026-09-07 this is Child only: a rewrite failure never becomes
 * a hide in Teen or Adult (docs/design/POLICY-TABLE-2026-09-07.md, invariant
 * 2). The former toggle and the strictLanguage implication existed for
 * swearing (when no rephrase was possible, the swearing was what remained to
 * act on); swearing is now masked in place without any rewrite, so that
 * reason is gone. Child keeps the fail-closed fold until the table's Child
 * cells choose the action. Read-only compute; writes nothing.
 */
export function hideOnRewriteUnavailable(mode: string): boolean {
  return mode === 'child';
}

// Silent-pass visibility instrumentation.
//
// The `pre-llm-too-short` and `pre-llm-non-substantive` rejection paths
// otherwise log nothing. On feeds dominated by image-meme + short-
// caption content (modern Facebook), zero logs would look
// indistinguishable from "FW isn't running" to a developer or parent
// debugging the extension. The log here doesn't change precision — it
// makes the design-correct skip visible.
//
// Logarithmic milestones per (platform, reason) per session: log on the
// 1st, 5th, 25th, 100th rejection. Keeps the console quiet on noisy
// feeds while confirming "yes, FW is scanning" on the first scroll.
const _silentPassCounts = new Map<string, number>();
const _silentPassMilestones = new Set<number>([1, 5, 25, 100]);
function noteSilentPass(platform: string, reason: string): void {
  const key = `${platform}:${reason}`;
  const n = (_silentPassCounts.get(key) ?? 0) + 1;
  _silentPassCounts.set(key, n);
  if (_silentPassMilestones.has(n)) {
    console.log(
      `[FW pipeline] ${platform}: ${n} posts skipped (${reason}) this session — ` +
        'design-correct filter for noise / hashtag-only / sub-12-char content. Per VISION §1.2 protection-precision.',
    );
  }
}

// Check if text has actual prose content (not just links, handles,
// emojis).
//
// 6-8 word fragments like "Here's the slap for those curious" or "You
// can see the full clip here" otherwise got flagged severity-8. The LLM
// lacks enough context on short slang-heavy UGC to judge framing — the
// prompt's UNIVERSAL NEG rule ("<~15-word casual") is advisory and the
// model still over-fires. Raising the substantive-text floor cuts the
// short-fragment FP class empirically without losing positive examples
// (all POSITIVE fixtures in prompts.ts have ≥15 words).
function isSubstantiveText(text: string): boolean {
  // Strip URLs, @mentions, hashtags
  const stripped = text
    .replace(/https?:\/\/\S+/g, '')
    .replace(/@[\p{L}\p{N}_]+/gu, '')
    .replace(/#[\p{L}\p{N}_]+/gu, '')
    .trim();
  // The 3-word floor catches "stop trusting him" / "she's lying" —
  // exactly the patterns to flag. An older 8-word threshold was tuned
  // for a "single bundle per video" architecture that mixed caption +
  // comments; with per-comment records, the lower floor is correct.
  return wordUnits(stripped) >= 3 && stripped.length >= MIN_TEXT_LENGTH;
}

/** Letters of the scripts written without spaces between words, where a run of text is one "token" however long. */
const UNSPACED = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/gu;

/**
 * Words in any script. A word is a run of two or more letters or digits in any alphabet: ASCII \w counted Cyrillic,
 * Greek, Arabic and Hebrew as nothing and cut "și" or "îți" to one letter, so those posts never reached the reading.
 * In the scripts written without spaces (Chinese, Japanese, Thai and their kin) every two characters count as one
 * word, about the length of a word there.
 */
function wordUnits(text: string): number {
  let units = 0;
  for (const token of text.split(/\s+/)) {
    const unspaced = token.match(UNSPACED)?.length ?? 0;
    const spaced = token.replace(UNSPACED, '').replace(/[^\p{L}\p{N}]/gu, '').length;
    units += Math.floor(unspaced / 2) + (spaced > 1 ? 1 : 0);
  }
  return units;
}

/**
 * Exposure gate — the intervention that counts instead of scoring.
 *
 * Every other gate in this pipeline asks how bad one post is. This one asks
 * how many times the reader has already been here. The two questions come
 * apart hardest on advertising: 95.8% of the advertising in the judged sample
 * sits below severity 4, so no severity floor can see a campaign, while the
 * measured record holds one source that reached the reader on 33 separate
 * days through the recommended feed. One advert is mild. The thirty-third
 * airing is the thing worth naming.
 *
 * Rationale and thresholds: docs/audits/2026-08-25-true-judgement/NARRATOR.md.
 */
const NO_EXPOSURE: ExposurePressure = {
  fired: false, reason: null, distinctDays: 0, creativeCount: 0,
};

/**
 * One notice per source per day. Without this the gate fires on every
 * subsequent post from a frequent source (measured: 10.2% of posts); with it,
 * 3.7%.
 *
 * This map is the guard inside one page: the posts of one source arrive in a
 * burst, before the profile write that records the notice (`lastNoticedDay`,
 * which is what keeps a second tab or a reload quiet) can land. The measured
 * export of 12 Oct 2026 had 785 of 1,413 notices as a second or later notice
 * for the same source on the same day, when this map was the only guard.
 */
const exposureNotifiedOn = new Map<string, string>();

export function shouldEmitExposureNotice(
  post: PostContent,
  exposure: ExposurePressure,
  today: string,
): boolean {
  if (!exposure.fired || !post.author) return false;
  const key = `${post.author}@${post.platform}`;
  if (exposureNotifiedOn.get(key) === today) return false;
  exposureNotifiedOn.set(key, today);
  return true;
}

/**
 * A count with nothing to rewrite: the words are fine, the repetition is the
 * point. It is a mark (never a rewrite, never a hide) and renders as a quiet
 * count pill, not the severity dot. It claims no severity and no manipulation
 * (13 Oct 2026): it is a number of days or sightings, not a verdict, and the
 * evidence names the surface the count came from.
 */
export function exposureMarkResult(
  post: PostContent,
  exposure: ExposurePressure,
  startTime: number,
  aiMeta?: { model: string; provider: string },
  detectionMode?: string,
): PipelineResult {
  const reason = exposure.reason === 'creative' ? 'creative' : 'days';
  const count = reason === 'days' ? exposure.distinctDays : exposure.creativeCount;
  const surface = exposure.surface ?? 'for-you';
  const evidence = reason === 'days'
    ? [`source reached you on ${count} of the last ${EXPOSURE_WINDOW_DAYS} days, on the ${surface} feed`]
    : [`this exact post reached you ${count} times in the last ${EXPOSURE_WINDOW_DAYS} days, on the ${surface} feed`];
  const analysis: AnalysisResult = {
    postId: post.id,
    techniques: [{
      technique: 'repeat-exposure',
      present: true,
      confidence: 1,
      severity: 0,
      evidence,
    }],
    overallScore: 0,
    overallConfidence: 1,
    isManipulative: false,
    processingTimeMs: performance.now() - startTime,
    primaryTechnique: 'repeat-exposure',
    explanation: evidence[0],
    exposure: { reason, count, surface },
  };
  console.log(`[FeelingWise] Pipeline: MARK (repeat exposure, ${reason})`);
  return { action: 'mark', analysis, aiMeta, detectionMode };
}

export interface ProcessOptions {
  /**
   * Stop where the reading would start. The own list, the slur rule, the harm floor and the swear mask run as they do
   * for any post, and so does a cached verdict; a post none of them acts on comes back as a pass, with no model asked.
   * The Silent veil's deadline uses it so that a post still waiting for its reading is lifted as what the rules make
   * of it, never as the raw post.
   */
  localOnly?: boolean;
}

export async function process(
  post: PostContent,
  signal?: AbortSignal,
  options?: ProcessOptions,
): Promise<PipelineResult> {
  let judgedMode: FWSettings['mode'] | undefined;
  const result = await processUnstamped(post, signal, mode => { judgedMode = mode; }, options);
  return judgedMode !== undefined && result.judgedMode === undefined
    ? { ...result, judgedMode }
    : result;
}

async function processUnstamped(
  post: PostContent,
  /**
   * Optional per-post AbortSignal from the queue's per-item controller.
   * When the queue cancels (post scrolled past + adaptive stale
   * threshold elapsed), this signal aborts. The pipeline checks the
   * signal at two gates:
   *   1. Pre-callAI: `signal.aborted` → return cancelStale() (no LLM
   *      round-trip).
   *   2. Post-callAI: signal aborted while AI was running → return
   *      cancelMidFlight(analysis) so the verdict still gets a chain
   *      record.
   * Threaded into combinedDetectAndNeutralize via options.signal so a
   * pending fetch wakes via AbortError on cancel. Legacy callers / tests
   * omit the parameter (no signal → no cancel gates fire).
   */
  signal?: AbortSignal,
  onSettings?: (mode: FWSettings['mode']) => void,
  options?: ProcessOptions,
): Promise<PipelineResult> {
  try {
    const startTime = performance.now();
    // Pre-flight cancel gate. If the queue already aborted this item
    // before we got CPU, short-circuit BEFORE any expensive work
    // (cache/storage reads, slur filter, regex sweep). The chain still
    // records the cancel-stale event via the content-script CANCEL_LOG
    // path.
    if (signal?.aborted) {
      return cancelStale();
    }

    // NOTE: the "too short / non-substantive" LLM-noise reject is deliberately
    // deferred to AFTER the cost-zero deterministic HIDE gates below (slur,
    // coded-harm, sponsored-ad, child-mode profanity). Those must protect every
    // post regardless of length — a post that is only a slur or "kill yourself"
    // is max-severity, and placing the reject here (pre-fix, 2026-08-01) let
    // such posts pass with zero protection. The reject block now lives just
    // before the LLM / soften path, which is the only work it needs to guard.

    // Cache settings once — used for cache key, budget check, and mode
    // threshold below. Hoisted above the cache lookup so the cache key
    // can include the mode discriminator.
    const settings = await getSettings();
    onSettings?.(settings.mode);

    // License + tier-cap are resolved up front because the budget check
    // below uses tierCap. The free-tier short-circuit gate is positioned
    // AFTER the cost-zero protection layers (slur filter, profanity filter,
    // harm-floor synthesis) — VISION §1.2 commits to "all harm categories
    // the child encounters" and regex/dict-based detections incur zero LLM
    // cost, so they must fire for every install regardless of tier. The
    // paywall gates LLM-cost operations only.
    const license = await getLicense();
    const tierCap = dailyCapForTier(license.tier);

    // Step 0: the parent's own blocklist. First on the ladder, and ABOVE the
    // dedup cache on purpose. Two reasons:
    //   1. Attribution. When a parent's explicit rule and a probabilistic gate
    //      would both hide the same post, the record must say the parent's
    //      rule fired. That is the product.
    //   2. Cache correctness. The cache is keyed on platform/mode/locale/
    //      outputLanguage/text and knows nothing about the blocklist, so a
    //      post cached BEFORE the parent added a word would keep returning
    //      its old verdict for the rest of the session. Running above the
    //      lookup is what makes a newly-added rule take effect at once.
    // Applies in EVERY mode including adult, unlike the AI-derived hides: the
    // adult carve-out exists because a flag is a guess, and a rule the adult
    // typed into their own list is not a guess.
    // Costs one normalization pass over text the pipeline already holds, and
    // a match pre-empts the LLM call entirely.
    {
      const hit = matchParentBlocklist(
        activeParentBlocklist(settings.features),
        post.text,
        post.author,
        post.card,
      );
      if (hit) {
        console.log(`[FeelingWise] Pipeline: parent blocklist ${hit.kind} for ${post.id} → HIDE`);
        // Rule-only analysis, modelled on the adult sponsored-ad branch
        // below: isManipulative=false + empty techniques. FeelingWise is NOT
        // claiming this post is manipulative — it never looked. It is obeying
        // an instruction. Asserting a technique here would be the product
        // inventing a finding out of the parent's own preference, which is
        // exactly the Class-2 framing the copy rules forbid. The detection
        // mode carries the whole meaning, including WHICH rule fired: a
        // record that says "a word rule hid this" without naming the word is
        // not evidence. Consumers of detectionMode must prefix-match
        // 'blocklist:', same convention as 'block:ads:*'.
        const blocklistAnalysis = ruleAnalysis({
          postId: post.id, startTime, confidence: 1, action: 'hide',
        });
        return {
          action: 'hide',
          analysis: blocklistAnalysis,
          detectionMode: `blocklist:${hit.kind}:${hit.rule}`,
        };
      }
    }

    // A topic the person chose not to see (Topics U1, 13 Oct 2026): the same kind of gate, one more written list. It sits
    // right after the household's own words, above the cache for the same reason, and pre-empts the reading entirely.
    // Its switch is off in every preset, so a person who never chose a topic pays nothing here: no topic is active
    // and the matcher is never built. It hides at every level (policy row R5) and, like the household's word, claims
    // nothing about the post: no technique, no severity. The record's detectionMode names the topic and nothing else: the post text it
    // signs is the evidence of which word it found.
    {
      const topics = activeTopics(settings.features);
      const hit = topics.length > 0 ? matchTopics(topics, post.text, post.card) : null;
      if (hit) {
        console.log(`[FeelingWise] Pipeline: topic ${hit.topic} for ${post.id} → HIDE`);
        return {
          action: 'hide',
          analysis: ruleAnalysis({ postId: post.id, startTime, confidence: 1, action: 'hide' }),
          detectionMode: `topic:${hit.topic}`,
        };
      }
    }

    // Check dedup cache — identical content (retweets, reposts) gets a
    // cached result. Key dimensions:
    //   • platform — per-platform DOM / context differs.
    //   • mode — per-mode severity floor differs.
    //   • locale — the UI display locale (en/ro). Affects which strings
    //     the rewriter mirrors when stripping commentary.
    //   • outputLanguage — parent-pickable post-content rewrite language
    //     (separate from UI locale). Without this dimension, a parent
    //     toggle from auto→explicit (or one language → another) within
    //     the 60-min cache TTL returns the cached rewrite in the prior
    //     language. Validator catches the drift on second-pass but the
    //     cache held the bad value until eviction. Audit A5-B5 closure.
    //   • text — the original post body.
    //   • parentText — what the item answers, when the page showed it: the judge reads it, so the same words under
    //     two posts are two verdicts.
    // If you add another dimension upstream, mirror this list AND the
    // `// LRU cache keyed by ...` comment at the top of storage/cache.ts.
    const outputLanguage = settings.outputLanguage ?? 'auto';
    const textHash = await sha256(
      verdictCacheKeyInput(post.platform, settings.mode, settings.locale, outputLanguage, post.text, post.parentText),
    );
    // getPersistent checks both the in-memory L1 and
    // chrome.storage.session L2 so a post seen in feed → profile →
    // detail page is rewritten once and cached for the rest of the
    // browser session.
    const cached = await processingCache.getPersistent(textHash);
    // The key has no rewrite dimension, so a rewrite cached while rewrites were
    // on is not served once they are off. The post is judged again, because
    // whether a flag with no rewrite is hidden depends on what the judge says
    // on that call, which the cache does not keep.
    const cachedRewriteSwitchedOff = !!cached?.analysis.isManipulative && !!cached.neutralizedText
      && !isFeatureEnabled(settings, 'reframe-rewrites', post.platform);
    // Every entry is the reading's work: its passes and its rewrites. The cache key holds no licence and the entries
    // outlive the key, so once the reading may not run (key removed or lapsed, switch off, Strict) the post takes the
    // path an install without the reading takes, and no earlier rewrite or its marker comes back.
    // A pass or rewrite cached while the swear mask was off is not served once it is on (9 Oct 2026): the key has no
    // mask dimension, the entries outlive the switch, and the popup says swear words become stars. The check is local
    // and the mask below returns before any outside call, as it does for a post judged fresh with the mask on. It asks
    // what the mask block asks, the stars included: a text the mask leaves unchanged falls through there, so its
    // cache hit is served here rather than paid for again.
    const cachedMissesMask = !!cached
      && blanketProfanitySoften(settings, post.platform)
      && filterProfanity(post.text, settings.mode, { tier: 'profanity' }).filtered
      && maskProfanity(post.text).masked !== post.text;
    if (cached && !cachedRewriteSwitchedOff && !cachedMissesMask && await readingAllowed(settings, license)) {
      console.debug(`[FeelingWise] Pipeline: CACHE HIT for ${post.id}`);
      if (!cached.analysis.isManipulative || !cached.neutralizedText) {
        // Cache hit on a previously-passed post — the original L1 already
        // ran and was forensic-logged on its first encounter. This is a
        // pre-llm-class pass for THIS scan (no LLM round-trip), so caller
        // scan-logs only. The earlier record carries the recall-instrument
        // forensic trace.
        return passWith('pre-llm-cache-pass');
      }
      const cachedNeutralized: NeutralizedContent = {
        postId: post.id,
        originalHash: textHash,
        rewrittenText: cached.neutralizedText,
        analysis: { ...cached.analysis, postId: post.id },
        aiSource: 'cloud',
        processingTimeMs: 0,
        ...(cached.writerModel ? { writerModel: cached.writerModel } : {}),
      };
      return {
        action: 'neutralize',
        neutralized: cachedNeutralized,
        // Name the judge the first serving named. Without this a record
        // written from a cache hit says a cloud model decided and cannot say
        // which — 38 such rows in the 2026-09-08 export. Undefined for an
        // entry cached before the cache carried it, which stays honest:
        // absent means "not recorded", never "no model ran".
        aiMeta: cached.aiMeta,
      };
    }

    // Step 0a: Slur filter — ALWAYS-rewrite for child + teen, regardless
    // of other settings. Slurs are identity-targeted (ableist / racial /
    // homophobic / transphobic) and a family product cannot pass them
    // through on either mode.
    //
    // Family-safety rail. The slur/profanity filter is intentionally
    // mode-coupled (not a user-facing FeatureId). VISION §6 / §6b leave
    // family-safety primitives outside the user-facing toggle catalog.
    // Mode here is the safety tag, not enforcement-by-mode.
    // Slurs route to DOM-HIDE, not asterisk-replace. Asterisks are
    // visible-but-censored — the kid sees the gap and infers what was
    // there. HIDE removes the post entirely. This aligns post-level
    // intervention with comment-batch hide-tier behavior. cleanText is
    // no longer used (asterisk-replace path retired); slurResult.matches
    // still feeds the chain payload's technique evidence array so the
    // dashboard can count slurs blocked.
    if (settings.mode === 'child' || settings.mode === 'teen' || settings.mode === 'adult') {
      const slurResult = filterProfanity(post.text, settings.mode, { tier: 'slurs' });
      if (slurResult.filtered) {
        console.log(`[FeelingWise] Pipeline: slur detected for ${post.id} → HIDE (${slurResult.matches.length} matched)`);
        const slurAnalysis = ruleAnalysis({
          postId: post.id, startTime, technique: 'profanity', severity: 9, confidence: 0.98,
          evidence: slurResult.matches, action: 'hide',
        });
        return { action: 'hide', analysis: slurAnalysis, detectionMode: `slur:${slurResult.matches.length}` };
      }
    }

    // Step 0a.1: Coded-harm deterministic floor (post path). Mirrors the
    // comment path's hard-harm floor EXACTLY: `detectCodedHarm` +
    // `codedHarmVerdictFields` are the one category→verdict mapping shared by
    // the comment success gate (`applyOverrideGates`), the comment AI-off
    // fallback (`failClosed`), and — here — the post path. Before this the
    // catcher was wired only into comments (AI-1, swarm-2026-07-13): the L1
    // self-harm classifier set present=true, but no deterministic gate consumed
    // it and the harm-floor synth is gated on `detected.length===0`, so a
    // directed self-harm ("kys" / "kill yourself"), sexual-solicitation,
    // doxxing, or narrated-violence POST passed SILENTLY on the free-tier
    // short-circuit (below, tierCap===0) AND the paid AI-outage branch. Runs
    // pre-LLM (cost-zero regex, 0-FP-validated on the benign corpora — no new
    // false-positive surface) so hide-tier categories are caught on EVERY
    // tier/path, not only when the LLM runs.
    //
    // All modes incl. adult: mirrors the comment path (its coded-harm gate is
    // mode-blind — `applyOverrideGates` does not gate coded-harm on mode, and
    // `failClosed` takes no mode) AND the post path's own hardest floors (slur
    // above, dehumanization below) which HIDE in every mode. Adult's lighter
    // treatment applies to register profanity / narrated-video, not to directed
    // self-harm / predation / doxxing.
    //
    // Only `hideTier` categories route to HIDE; softer coded categories
    // (coded-scapegoating / clickbait-fomo) stay on the normal LLM path
    // unchanged. Evidence + `detectionMode='coded-harm:<category>'` name the
    // deterministic source honestly — the record never implies an AI judgment.
    {
      const codedHit = detectCodedHarm(post.text);
      if (codedHit) {
        const fields = codedHarmVerdictFields(codedHit);
        if (fields.hideTier) {
          console.log(`[FeelingWise] Pipeline: coded-harm ${codedHit.category} for ${post.id} → HIDE`);
          // Severity + technique come straight from the shared mapping: one
          // source of truth, no post/comment drift. Every hide-tier technique
          // literal is a valid post `TechniqueName`, so no cast is needed.
          const codedAnalysis = ruleAnalysis({
            postId: post.id, startTime, technique: fields.technique, severity: fields.severity, confidence: 0.95,
            evidence: [`coded-harm:${codedHit.category}:${codedHit.evidence}`], action: 'hide',
          });
          return { action: 'hide', analysis: codedAnalysis, detectionMode: `coded-harm:${codedHit.category}` };
        }
      }
    }

    // Step 0a: Sponsored / Ad gate. The platform marks promoted posts (X's
    // placementTracking marker, etc.) and the adapter stamps post.is_sponsored.
    // Ads — including gambling / loot-box promos (Hellcase, G4Skins) — are
    // hidden + labeled DETERMINISTICALLY from the platform's own marker: no
    // text-pattern guessing, ~0 false positives. Per LABEL-SCHEMA: is-ad /
    // sponsored → BLOCK. Catches every feed ad the text classifier misses.
    //
    // The gate splits by mode on RECORD SHAPE, not on whether it fires
    // (owner report 2026-08-04: "Block ads" ON did nothing on the adult X
    // feed). The 2026-08-02 carve-out excluded adult from this gate entirely,
    // which killed the user-facing Block Ads toggle for adult feed ads — the
    // content-side visual gate only acts on sponsored-ad detection modes,
    // and adult never emitted one. The valid half of that decision stands:
    // asserting a manipulation technique from nothing but the platform's ad
    // marker put a phone-case discount, a Twix launch and a bread slicer in
    // an adult's record as detected manipulation — 11 of the 85 sampled
    // false alarms (docs/measurements/2026-08-02-accuracy.md §3d). Being an
    // ad is a category, not a technique. So:
    //   • VISUAL: every mode emits a verdict; the Block Ads toggle decides
    //     the on-page visual content-side (applyCollapseHideVisual — ON →
    //     fully removed, OFF → shown), same as it always has for child/teen.
    //   • RECORD: child/teen keep the deterministic consumer-rapid-frame
    //     record exactly as before. Adult emits 'sponsored-ad:adult' with a
    //     technique-free, non-manipulative analysis; the content side records
    //     it as a blocked-category event (BLOCKED_LOG, reason 'ads') when the
    //     hide lands, and as a pass under the sponsored row with a note when
    //     Block Ads is OFF (since 2026-09-13): an ad never enters an adult's
    //     record as a finding, but every ad served enters it.
    if (post.is_sponsored && settings.mode !== 'adult') {
      console.log(`[FeelingWise] Pipeline: sponsored/ad → HIDE for ${post.id}`);
      const adAnalysis = ruleAnalysis({
        postId: post.id, startTime, technique: 'consumer-rapid-frame', severity: 6, confidence: 0.99,
        evidence: ['platform sponsored/ad marker'], action: 'collapse',
      });
      return { action: 'collapse', analysis: adAnalysis, detectionMode: 'sponsored-ad' };
    }
    if (post.is_sponsored && settings.mode === 'adult') {
      console.log(`[FeelingWise] Pipeline: sponsored/ad → collapse (adult, category-only) for ${post.id}`);
      // Category-only analysis: the ad marker justifies a category, never a
      // technique. isManipulative=false + empty techniques keep this verdict
      // out of every technique/severity surface; the detection mode routes
      // the content side to the blocked-category record path.
      const adultAdAnalysis = ruleAnalysis({
        postId: post.id, startTime, confidence: 0.99, action: 'collapse',
      });
      return { action: 'collapse', analysis: adultAdAnalysis, detectionMode: 'sponsored-ad:adult' };
    }

    // Step 0b: Profanity filter — catch vulgar content before AI calls.
    // Child mode + sexual / violence / drug profanity → HIDE (sev=8 +
    // profanity match; mode-aware because per-mode hide-vs-mark split
    // is the canonical intervention table). Teen mode: flag-only,
    // proceed to LLM pipeline.
    const profanityResult = filterProfanity(post.text, settings.mode, { tier: 'profanity' });
    if (profanityResult.filtered && settings.mode === 'child') {
      console.log(`[FeelingWise] Pipeline: profanity detected for ${post.id} → HIDE (child mode, ${profanityResult.matches.length} matched)`);
      const profanityAnalysis = ruleAnalysis({
        postId: post.id, startTime, technique: 'profanity', severity: 8, confidence: 0.95,
        evidence: profanityResult.matches, action: 'hide',
      });
      return { action: 'hide', analysis: profanityAnalysis, detectionMode: `profanity:${profanityResult.matches.length}` };
    }

    // The swear mask (2026-09-07, Stage 2 of the 2026-09-07 plan). The gate is
    // `blanketProfanitySoften` and it has no mode branch: the soften-swearing
    // switch, or `strictLanguage` in any mode. A child install reaches it
    // because `childPreset` seeds that switch ON, not because Child mode forces
    // it. This comment said "Child mode always" until 2026-09-19, and the popup
    // said the same to the parent while leaving the switch clickable underneath
    // ("no swearing in this house" as an explicit
    // family choice; the former teen LOCKED rule was evidence-retired
    // 2026-06-10: 31 of 36 teen softenings acted on register profanity fine for
    // a teen). Until 2026-09-07 this branch asked the rewriter for a calmer
    // sentence; live screenshots showed ordinary swearing turned into
    // stilted first person with no marker, and the design says swearing is
    // masked, never rewritten. So: the vulgar words are starred in place by the
    // same filter that found them, every other word stands, no model call, no
    // cap, no tier. The two deterministic harm gates still run first, because
    // profanity co-occurs with dehumanisation and narrated violence and a mask
    // must not let those through as "register". The laundering check is gone
    // with the rewriter: stars cannot drop the lethal content a rewrite could.
    if (
      profanityResult.filtered
      && blanketProfanitySoften(settings, post.platform)
    ) {
      const dehumGate = detectDehumanization(post.text);
      if (dehumGate.triggered) {
        console.log(`[FeelingWise] Pipeline: profane + dehumanizing → HIDE for ${post.id} (${dehumGate.matches.length} matched)`);
        const dehumAnalysis = ruleAnalysis({
          postId: post.id, startTime, technique: 'extreme-toxicity', severity: 9, confidence: 0.98,
          evidence: dehumGate.matches.map((m) => m.evidence), action: 'hide',
        });
        return {
          action: 'hide',
          analysis: dehumAnalysis,
          detectionMode: `dehumanization:${dehumGate.matches.length}`,
        };
      }
      const vnGate =
        post.kind === 'video' ? detectViolenceNarratingVideo(post.text) : { triggered: false, evidence: '' };
      if (vnGate.triggered) {
        console.log(`[FeelingWise] Pipeline: profane + violence-narrating video → HIDE for ${post.id}`);
        const vnAnalysis = ruleAnalysis({
          postId: post.id, startTime, technique: 'violence-graphic', severity: 8, confidence: 0.9,
          evidence: [vnGate.evidence], action: 'hide',
        });
        return { action: 'hide', analysis: vnAnalysis, detectionMode: 'violence-narrating-video' };
      }
      const { masked } = maskProfanity(post.text);
      if (masked !== post.text) {
        const profanityAnalysis = ruleAnalysis({
          postId: post.id, startTime, technique: 'profanity', severity: 4, confidence: 0.95,
          evidence: profanityResult.matches, action: 'rewrite',
        });
        const neutralized: NeutralizedContent = {
          postId: post.id,
          originalHash: textHash,
          rewrittenText: masked,
          analysis: profanityAnalysis,
          aiSource: 'rules',
          processingTimeMs: performance.now() - startTime,
        };
        console.log(`[FeelingWise] Pipeline: profanity → MASK (${settings.mode} mode) for ${post.id} (${profanityResult.matches.length} matched)`);
        return { action: 'neutralize', neutralized, detectionMode: `profanity-mask:${profanityResult.matches.length}` };
      }
    }

    // LLM-noise reject (relocated 2026-08-01): too short, or no real prose
    // (< 3 words). Runs HERE — after every cost-zero deterministic HIDE gate
    // above — so a post whose entire text is a slur / directed self-harm /
    // (child) profanity is caught, while the substantive-text floor still
    // spares the LLM + soften path below from the short-fragment false
    // positives it exists to prevent. The swear mask above runs before it too (9 Oct 2026): it is the same
    // deterministic filter, the popup's Strict language line says swear words become stars, and a short post
    // ("oh shit") passed here unstarred.
    if (post.text.length < MIN_TEXT_LENGTH) {
      noteSilentPass(post.platform, 'pre-llm-too-short');
      return passWith('pre-llm-too-short');
    }
    if (!isSubstantiveText(post.text)) {
      noteSilentPass(post.platform, 'pre-llm-non-substantive');
      return passWith('pre-llm-non-substantive');
    }

    // Step 0c: Dehumanization compound-pattern filter. Catches the
    // structural failure mode where text combines a dehumanizing target
    // noun (rats / vermin / cockroaches / parasites / scum / savages /
    // animals-in-human-context) with a violent action verb (exterminate /
    // eradicate / kill / eliminate / gas / hang / lynch / slaughter), OR
    // pairs an identity group with "are/is" + a target noun ("communists
    // are parasites"). Single-token dictionaries (slurs / profanity) miss
    // this because the words are individually ambiguous — pest control
    // vs. genocide rhetoric is determined by the COMBINATION. The
    // rewriter cannot be trusted on this content (a real forensic chain,
    // 2026-05-15, showed the model preserving "rats / exterminated /
    // covered with dirt" in the rewrite). Route directly to HIDE for
    // all modes — this is more severe than profanity.
    const dehumResult = detectDehumanization(post.text);
    if (dehumResult.triggered) {
      console.log(`[FeelingWise] Pipeline: dehumanization detected for ${post.id} → HIDE (${dehumResult.matches.length} matched)`);
      const dehumAnalysis = ruleAnalysis({
        postId: post.id, startTime, technique: 'extreme-toxicity', severity: 9, confidence: 0.98,
        evidence: dehumResult.matches.map((m) => m.evidence), action: 'hide',
      });
      return {
        action: 'hide',
        analysis: dehumAnalysis,
        detectionMode: `dehumanization:${dehumResult.matches.length}`,
      };
    }

    // Step 0c.1: Violence-narrating VIDEO gate (pre-LLM, cost-zero). A video
    // post whose caption narrates physical harm to a person ("beaten and forced
    // to perform", "his legs are definitely gone") was getting its caption
    // REFRAMED while the violent video kept playing (found 2026-06-04) — the
    // violence-graphic classifier only matches threats/gore BY the poster, so
    // narration fell through as benign and the LLM neutralized it. Route to HIDE
    // (technique 'violence-graphic' → label + hidePostMedia already wired).
    // Gated on kind==='video' + child/teen, with a domain-suppression list, so
    // sports / gaming / medical / fitness / culinary / news captions pass.
    // Adult is carved out (mirrors the profanity-HIDE adult carve-out at step
    // 0b): adult = lightest/transparency-first, so a narrated war/medical video
    // caption is NOT hidden for an adult reader.
    if (post.kind === 'video' && (settings.mode === 'child' || settings.mode === 'teen')) {
      const vn = detectViolenceNarratingVideo(post.text);
      if (vn.triggered) {
        console.log(`[FeelingWise] Pipeline: violence-narrating video → HIDE for ${post.id}`);
        const vnAnalysis = ruleAnalysis({
          postId: post.id, startTime, technique: 'violence-graphic', severity: 8, confidence: 0.9,
          evidence: [vn.evidence], action: 'hide',
        });
        return { action: 'hide', analysis: vnAnalysis, detectionMode: 'violence-narrating-video' };
      }
    }

    // Step 1: Layer 1 — regex-based detection (fast, <5ms)
    const techniques: TechniqueResult[] = detect(post.text, post.author, post.platform);
    const detected = techniques.filter(t => t.present);

    // The author's profile, for the exposure notice below and nothing else.
    // Until 2.5.1 a "repeat offender" profile raised every present L1
    // confidence by 0.15 before the judge saw the post: the record then
    // correlated verdicts by account, which the DPIA denies, and the boost
    // never ran on the measured adult path. Judge the item, not the author.
    // The profile store is extension-origin IndexedDB written by the service
    // worker, so this content realm asks the worker (GET_AUTHOR_PROFILE)
    // rather than opening the database in the host page's origin.
    let authorProfile: AuthorProfile | null = null;
    if (post.author) {
      try {
        authorProfile = await fetchAuthorProfile(post.author, post.platform);
      } catch {
        // Non-critical: the exposure counters read as zero.
      }
    }

    // Exposure gate input. Read from the profile as it stood BEFORE this
    // sighting (result-apply records the sighting afterwards), so a source
    // is named on the post that crosses the line, never retroactively.
    // Wrapped for the same reason the profile read above is: this is
    // supplementary intelligence, and a throw here reaches the pipeline's
    // outer error handler, which returns PASS. A defect in the exposure
    // counters must never be able to downgrade a confirmed flag.
    let exposure: ExposurePressure = NO_EXPOSURE;
    if (post.author) {
      try {
        exposure = getExposurePressure(
          authorProfile,
          creativeHash(post.text),
          new Date().toISOString().slice(0, 10),
          post.feedSource,
        );
      } catch {
        exposure = NO_EXPOSURE;
      }
    }

    console.debug(`[FeelingWise] Pipeline L1:`, {
      postId: post.id,
      detected: detected.length,
      exposureDays: exposure.distinctDays,
    });

    // Step 1.5: Harm-floor L1.5 layer.
    // Free pass — pure regex + structural scoring on already-built
    // linguistic context, no LLM tokens. Runs before cap check so a
    // synthetic detection can fire even when the daily/monthly cap is
    // exhausted (parent-visible marker is more important than LLM-token
    // cost in this case).
    //
    // Trigger condition: score ≥ HARM_FLOOR_TRIGGER_THRESHOLD AND no L1
    // classifier returned present=true. Posts where L1 already fires
    // route through the normal LLM path — harm-floor's score is then
    // enrichment metadata.
    //
    // When triggered, pipeline returns action='collapse' with a
    // synthesized AnalysisResult bearing technique='extreme-toxicity' +
    // harm-floor signals as evidence. The existing 'collapse' branch in
    // the dashboard / forensic logger handles the parent-visible marker.
    // The verdict on the forensic record stays 'flagged'; the
    // verdict='harm-floor-trigger' label is forward-compat in the union
    // but not emitted yet.
    const harmFloor = computeHarmFloor(post.text, techniques);
    if (harmFloor.triggers && detected.length === 0) {
      const totalMs = performance.now() - startTime;
      console.log(
        `[FeelingWise] Pipeline: HARM-FLOOR TRIGGER ${harmFloor.score}% (${totalMs.toFixed(0)}ms, ${harmFloor.signals.length} signals, dampener=${harmFloor.dampener.toFixed(2)}, lang=${harmFloor.language})`,
      );
      const synthesisedSeverity =
        harmFloor.score >= 90 ? 9 : harmFloor.score >= 80 ? 8 : harmFloor.score >= 70 ? 7 : 6;
      const synthesisedConfidence = Math.min(
        0.92,
        0.5 + (harmFloor.score - HARM_FLOOR_TRIGGER_THRESHOLD) * 0.012,
      );
      const synthesisedAnalysis = ruleAnalysis({
        postId: post.id, startTime, processingTimeMs: totalMs,
        technique: 'extreme-toxicity', severity: synthesisedSeverity, confidence: synthesisedConfidence,
        evidence: harmFloor.signals.slice(0, 4).map(s => `${s.id}:${s.evidence}`), action: 'collapse',
      });
      return {
        action: 'collapse',
        analysis: synthesisedAnalysis,
        detectionMode: `harm-floor:${harmFloor.score}`,
      };
    }

    // Free-tier short-circuit. Bails BEFORE the LLM-cost operations
    // (budget check + Groq call) but AFTER the cost-zero regex/dict
    // protections (slur filter, profanity filter, harm-floor). Slur /
    // profanity matches above already returned with local rewrites for
    // child mode; harm-floor matches above already returned with
    // synthesized collapse verdicts. Reaching this point on free tier
    // means no structural-harm signal fired — pass without LLM round-
    // trip.
    // The same for a level that sends nothing out. Strict used to reach the call, which refused it before any network
    // code, and the refusal was written as a vendor failure (625 of the 1,233 failed posts in his export were Strict's,
    // read 12 Oct 2026, crew/reading/EXPORT-STUDY-2026-10-12.md) and armed the shared hold for every other level.
    // Strict with a key, the master switch on and the adult's agreement is not such a level once Strict reads
    // (types/reading-gate.ts); until then this is the line it always was.
    if (makesNoOutsideCall(settings) && !(await readingActiveNow(settings, license))) {
      console.debug('[FeelingWise] Pipeline: PASS (the level makes no outside call) — rules cleared');
      return passWith('pre-llm-level-reads-nothing');
    }
    // The deadline's ask: the rules above have spoken, and nothing below is a rule.
    if (options?.localOnly) {
      console.debug('[FeelingWise] Pipeline: PASS (local result only) — rules cleared');
      return passWith('pre-llm-deadline-local-only');
    }

    if (tierCap === 0) {
      console.debug(`[FeelingWise] Pipeline: PASS (free tier — ${license.tier}) — regex/harm-floor cleared`);
      return passWith('pre-llm-free-tier-no-ai');
    }

    // Step 2: Check budget before calling AI. Skipped wholesale for the
    // uncapped `dev` (founder) tier so internal stress-testing isn't bounded
    // by the customer solvency caps.
    if (!isUncappedTier(license.tier)) {
      // Effective cap = min(user-configured settings.dailyCap, tierCap from license).
      // The user can dial DOWN from the tier cap via settings UI; they can't
      // exceed it. settings.dailyCap === 0 is the legacy "no user cap" sentinel
      // — fall back to the tier cap when the user hasn't picked a custom value.
      const effectiveCap =
        settings.dailyCap > 0 ? Math.min(settings.dailyCap, tierCap) : tierCap;
      if (settings.totalChecksToday >= effectiveCap) {
        console.debug(`[FeelingWise] Pipeline: PASS (daily cap reached, ${effectiveCap})`);
        return passWith('pre-llm-cap-exhausted');
      }

      // Tier-monthly token-budget check, layered above the daily call cap.
      // Bounds the parent's Groq spend at the per-tier USD cap by tracking
      // actual token usage. Hitting the cap silently passes the post — same
      // UX as daily-cap-exhausted, no user-visible distinction. Worst-case
      // overshoot is one in-flight call's tokens (~$0.40 max); a pre-flight
      // token-estimate enforcement layer can tighten this further (V1.5).
      const tierMonthlyTokenCap = effectiveMonthlyTokenCap(license.tier, settings.monthlyUsdCapOverride);
      if (settings.totalTokensThisMonth >= tierMonthlyTokenCap) {
        console.debug(`[FeelingWise] Pipeline: PASS (monthly token cap reached, ${tierMonthlyTokenCap})`);
        return passWith('pre-llm-cap-exhausted');
      }
    }

    // Global flush-budget circuit-breaker. If the shared hold is armed
    // (3 LLM failures in 10s, on this path or the BATCH path), skip the
    // LLM round-trip — same throttle the comment-batch path already
    // honors. Pass without an LLM call rather than piling onto a vendor
    // that's failing.
    if (isHolding()) {
      console.debug('[FeelingWise] Pipeline: PASS (global flush-budget hold active)');
      // Not a failure of this post's call — the breaker declined to place one.
      return passWith('pre-llm-ai-call-failed', { failureKind: 'pre-llm-circuit-breaker' });
    }

    // Step 4: SINGLE AI CALL — detect + neutralize combined.
    // This eliminates the second API round-trip, cutting latency ~50%.
    //
    // No cover goes on the post while this call is out. A cover on "the free rules suspect it" was built (71726956) and taken out
    // again (Board row 363, 12 Oct 2026): on the Tester's feed the pattern scan and the harm floor fired on the calm tulip post and
    // on one of the five posts the judge went on to rewrite, and stayed silent on the other four (rage, fear, two shaming posts).
    // Covering on that signal covers the wrong posts. A better signal has to separate flagged from calm before a cover returns.
    //
    // Wrap the network-bound combined call with the perf-tracer. Tracer
    // is a no-op unless `ff_captureV2Metrics` flag is on (default OFF)
    // — zero cost for regular users. When on, writes one record per
    // call to `feelingwise-pipeline-v2-metrics` IDB store. This is the
    // dominant latency surface; other stages are instrumented lazily
    // once data justifies the effort.
    const tracer = await startTrace({
      platform: post.platform,
      mode: settings.mode,
      // One provider at a time for V1. This is a performance trace and not the
      // forensics record, but a trace that names the wrong company is still a
      // trace nobody can reason from, so it moved with the upstream on
      // 2026-09-21. The union widens again when more providers come back.
      provider: 'deepinfra',
    });
    // Pass mode through so per-mode severity floor applies (see
    // severityFloorFor in neutralizer.ts). Pass post.context through
    // when present so the LLM sees surrounding discourse (sibling
    // comments / parent post) alongside the analyzed text. The TikTok
    // bundle adapter populates this for caption records; legacy
    // adapters leave it undefined → no behavior change in those paths.
    // Production caller opts in to the two-stage cascade (precision
    // measured to lift materially with 100% recall preserved + a high
    // short-circuit rate). Stage preferences are retained on the call
    // shape for source-compat but are no-ops since the FW proxy holds
    // one server-side master key.
    // Q2/W44 purpose check: the reframe-rewrites toggle owns the rewrite
    // spend tier. Detection always runs (VISION 1.1); with the toggle off
    // the judge call goes detect-only and confirmed flags fold to the
    // rewrite-unavailable floor below. Feature toggle + per-platform
    // override only — mode reaches this solely through presets (mode-rails).
    const rewritesEnabled = isFeatureEnabled(settings, 'reframe-rewrites', post.platform);
    const combinedDetectionMode = rewritesEnabled
      ? 'combined-detect-neutralize'
      : 'combined-detect-only';
    // The judge's calls run under a signal of this post's own, so the record names the model and
    // provider that answered them; the rewrite call runs under a signal of its own (below) and
    // cannot take their place.
    const judgeCalls = new AbortController();
    if (signal?.aborted) judgeCalls.abort();
    else signal?.addEventListener('abort', () => judgeCalls.abort(), { once: true });
    // The page's AI mark and the record name the model that wrote the rewrite. On the adult path
    // that is the rewrite call, run under a signal of its own so its reply is not mixed with any
    // other. When no rewrite call is made (Teen and Child), the rewrite came in the reply to the
    // judge's classify call, the last call under the judge's signal; the triage call before it
    // only answered yes or no, so its model is not named as the writer.
    const rewriteCalls = new AbortController();
    if (signal?.aborted) rewriteCalls.abort();
    else signal?.addEventListener('abort', () => rewriteCalls.abort(), { once: true });
    let rewriteCalled = false;
    let rewriteWriter: string | undefined;
    // In every mode the judge reads the author's label and copies of the text, the post it answers and the
    // caption context with the known handles replaced; the post itself is never changed, because the text is
    // reused below and the queue keys hold it. The Adult judge was left reading names as written until the owner
    // said, on 12 Oct 2026, to label them there too: the consent screen promises a letter in place of each account
    // name, and those names belong to other people. Its prompt, schema and cut are untouched; only the names in
    // its input are letters now, which the measurement owner notes on the Board row.
    const labels = isNameLabelStepOn()
      ? buildNameLabelMapForPost(post.author, post.context, [post.text, post.parentText, post.card?.quotedBody])
      : null;
    const judgeText = labels ? replaceNamesInText(labels, post.text) : post.text;
    const judgeParentText = labels && post.parentText ? replaceNamesInText(labels, post.parentText) : post.parentText;
    const judgeAuthor = labels ? labels.authorValue : (post.author ?? 'unknown');
    const labelledContext = labels && post.context ? replaceNamesInCaptionContext(labels, post.context) : post.context;
    const judgeCard = post.card && (post.card.quotedBody || post.card.link)
      ? {
          quotedBody: post.card.quotedBody && labels ? replaceNamesInText(labels, post.card.quotedBody) : post.card.quotedBody,
          link: post.card.link,
        }
      : undefined;
    // Moderate only: the Relaxed judge takes the site, the kind and the parent as fields of its own, and Strict reads nothing.
    const judgeContext = settings.mode === 'teen'
      ? [labelledContext, moderateWhereItSits(post.platform, judgeKindFor(post.kind), judgeParentText, judgeCard)].filter(Boolean).join('\n\n')
      : labelledContext;
    // The paid reading's Claude reader runs beside the adult judge's second opinion, for a paid key
    // whose person agreed to the second company on the consent screen (the consent is the switch);
    // it checks its own key and consent again before it sends anything.
    const claudeReader = settings.mode === 'adult' && await claudeReadingOn() ? askClaudeReader : undefined;
    const result = await tracer.wrap('combined_call', () =>
      combinedDetectAndNeutralize(judgeText, techniques, settings.mode, settings.locale, judgeAuthor, judgeContext, {
        twoStageCascade: true,
        platform: post.platform,
        // The judge is told the item's kind and shown the post it replies to,
        // the configuration the 2026-09-03 protocol measured; before 2026-09-07
        // every item on this path was called a post and shown no parent
        // (docs/audits/2026-09-07-xray, C3).
        kind: judgeKindFor(post.kind),
        parentText: judgeParentText,
        rewrite: input => {
          rewriteCalled = true;
          return neutralizeText({
            ...input,
            signal: rewriteCalls.signal,
            onWriter: (model) => { rewriteWriter = model; },
          });
        },
        rewriteEnabled: rewritesEnabled,
        ...(claudeReader ? { claudeReader } : {}),
        // Thread per-post signal into the cascade. fetch wakes via
        // AbortError on cancel and callAI surfaces it as Err(aborted).
        // combinedDetectAndNeutralize then resolves to null and we hit
        // the cancel-stale branch below.
        signal: judgeCalls.signal,
      }),
      // The judge resolves to null when it got no reading, so a resolved promise is not an ok step.
      (r) => (r ? { success: true } : {
        success: false,
        error: judgeCalls.signal.aborted ? 'cancelled' : (getLastFailureKind() ?? 'no-reading'),
      }),
    );
    const aiMeta = callProvenanceFor(judgeCalls.signal) ?? undefined;

    // The names go back here, before the cancel gates write the analysis to the record and before
    // the cache writes and the screen. A rewrite still holding a label nobody got is dropped, so
    // the item takes the no-rewrite path and no label reaches the page.
    if (labels && result) {
      const { analysis } = result;
      // Each name comes back as the post itself wrote it, so a bare name is not shown as a handle.
      // The caption context went to the judge too, so words a context comment wrote ("USER A") stay as written.
      const sentTexts = [post.context, post.parentText, post.card?.quotedBody].filter((x): x is string => typeof x === 'string' && x.length > 0);
      if (typeof analysis.explanation === 'string') {
        analysis.explanation = restoreNames(labels, analysis.explanation, 'reason', post.text, sentTexts).text ?? undefined;
      }
      for (const t of analysis.techniques ?? []) {
        if (!Array.isArray(t.evidence)) continue;
        t.evidence = t.evidence.map((e) => (typeof e === 'string' ? restoreNames(labels, e, 'reason', post.text, sentTexts).text ?? '' : e));
      }
      if (result.neutralized && typeof result.neutralized.rewrittenText === 'string') {
        const back = restoreNames(labels, result.neutralized.rewrittenText, 'rewrite', post.text, sentTexts).text;
        if (back === null) {
          result.neutralized = null;
          result.rewriteWhy = 'label-lost';
          // The judge's own rule for a missing rewrite ran before this drop, so it runs again here:
          // a severe hostile flag is hidden, as it is when the judge rejects the rewrite itself.
          hideWhenSevereAndHostile(analysis);
        } else {
          result.neutralized.rewrittenText = back;
        }
      }
    }

    // A rewrite that still carries the attack is not shown (the Tester's full test, 11 Oct 2026): the insult behind an
    // "I think", the call to share, the call to disappear. It takes the same road as a rewrite the judge rejects: the
    // post stays with its mark, or is hidden when it is severe and hostile. Run on the real texts, names back in.
    if (result?.neutralized && typeof result.neutralized.rewrittenText === 'string') {
      const kept = rewriteKeepsTheAttack(post.text, result.neutralized.rewrittenText);
      if (kept !== null) {
        console.debug(`[FeelingWise] Pipeline: REWRITE DROPPED (${kept}) for ${post.id}`);
        void recordNeutralizerEvent(`rewrite-keeps-attack:${kept}`);
        result.neutralized = null;
        result.rewriteWhy = `attack-kept:${kept}`;
        hideWhenSevereAndHostile(result.analysis);
      }
    }

    // Post-cascade cancel gates. Two distinct branches:
    //   (a) Aborted + null result: pre-API cancel (signal won the race
    //       vs acquire) → cancelled-stale chain record.
    //   (b) Aborted + valid result: AI returned a verdict before abort
    //       fired but after the user moved past → cancelled-mid-flight
    //       chain record carrying the analysis (VISION §1.1: every
    //       observed post produces a chain record, even cancelled).
    if (signal?.aborted) {
      if (!result) {
        return cancelStale();
      }
      const { analysis: midAnalysis } = result;
      midAnalysis.postId = post.id;
      console.debug(`[FeelingWise] Pipeline: CANCELLED-MID-FLIGHT (verdict preserved for chain)`);
      return cancelMidFlight(midAnalysis, aiMeta);
    }

    if (!result) {
      console.debug(`[FeelingWise] Pipeline: PASS (AI call failed)`);
      // Arm the shared flush-budget hold (mirrors the BATCH path's
      // recordGlobalFlushFailure on a failed/transient call). The
      // signal-aborted case was already handled above and returns before
      // reaching here, so this is a genuine vendor/network failure, not a
      // user-scroll cancel — exactly the BATCH path's exclusion of the
      // aborted kind. A refusal is no sign of a failing vendor either (the
      // master switch, a cap, a refused key), and the BATCH path arms the
      // hold only for the three transient kinds; so does this one. A kind
      // nobody stamped still arms it, as before.
      const failedKind = getLastFailureKind() ?? undefined;
      if (failedKind === undefined || failedKind === 'rate-limit' || failedKind === 'transient-http' || failedKind === 'network') {
        recordFailure();
      }
      // The LLM was attempted and produced nothing usable. There is no
      // analysis to feed the recall instrument — but the caller DOES write a
      // chain record here, because "we could not judge this" and "we judged
      // this and it was fine" are different facts and the chain used to state
      // the second when the first was true. Carry the real failure kind
      // across the cascade's null so the record can name it.
      return passWith('pre-llm-ai-call-failed', {
        failureKind: failedKind,
        // A judge that answered with nothing usable is still who answered, and the record names it.
        aiMeta,
      });
    }

    const { analysis, neutralized, rewriteWhy } = result;
    analysis.postId = post.id;
    if (neutralized) {
      const writer = rewriteCalled ? rewriteWriter : latestModelFor(judgeCalls.signal) ?? undefined;
      if (writer) neutralized.writerModel = writer;
    }

    console.debug(`[FeelingWise] Pipeline AI result:`, {
      postId: post.id,
      overallConfidence: analysis.overallConfidence,
      isManipulative: analysis.isManipulative,
      confirmedTechniques: analysis.techniques.filter(t => t.present).map(t => t.technique),
      hasNeutralization: !!neutralized,
    });

    // If AI says not manipulative → PASS
    if (!analysis.isManipulative) {
      console.debug(`[FeelingWise] Pipeline: PASS (AI: no pattern)`);
      // Cache the pass — re-views (scroll-back, re-serves, cross-day via
      // L3) short-circuit as 'pre-llm-cache-pass' instead of re-paying the
      // LLM. The cache-hit pass branch above has always expected these
      // entries; the write was missing, so every benign re-view re-paid a
      // full Groq call.
      processingCache.set(textHash, analysis, null);
      // Post-LLM pass. Caller emits a forensic record with verdict='pass'
      // so the recall instrument can sample-re-judge — this is the false-
      // negative detection surface. Analysis carries the L1 reasoning +
      // scores so a future re-judge has context.
      if (shouldEmitExposureNotice(post, exposure, new Date().toISOString().slice(0, 10))) {
        return exposureMarkResult(post, exposure, startTime, aiMeta, combinedDetectionMode);
      }
      return { ...passWith('post-llm-not-manipulative', { analysis, aiMeta }), detectionMode: combinedDetectionMode };
    }

    // Step 5: Apply mode-aware confidence thresholds. Source of truth is
    // calibration.ts DEFAULT_THRESHOLDS: child 0.45, teen 0.55, adult 0.60
    // (child intervenes on the lowest confidence; adult needs the highest
    // bar because adult mode is a lens, not a shield).
    const threshold = await getEffectiveThreshold(settings.mode);

    if (analysis.overallConfidence < threshold) {
      console.debug(`[FeelingWise] Pipeline: PASS (confidence ${analysis.overallConfidence.toFixed(2)} < threshold ${threshold})`);
      // Below-threshold verdicts are stable for identical text under an
      // identical judge — cache the pass (same rationale as above; the
      // mode-aware threshold is part of the cache key via settings.mode).
      processingCache.set(textHash, analysis, null);
      // Post-LLM pass — borderline case where the LLM saw patterns but our
      // threshold rejected. Highest-priority recall-instrument sample target:
      // these are the most likely false negatives because the detector
      // itself was uncertain.
      if (shouldEmitExposureNotice(post, exposure, new Date().toISOString().slice(0, 10))) {
        return exposureMarkResult(post, exposure, startTime, aiMeta, combinedDetectionMode);
      }
      return { ...passWith('post-llm-below-threshold', { analysis, aiMeta }), detectionMode: combinedDetectionMode };
    }

    // Reduce severity for borderline detections
    if (analysis.overallConfidence < threshold + 0.10) {
      for (const t of analysis.techniques) {
        if (t.present) {
          t.severity = Math.max(1, t.severity - 1);
        }
      }
    }

    // High-risk pass-through guard. See
    // HIGH_RISK_PASS_THROUGH_TECHNIQUES at top of file for the
    // rationale (parasocial-coercion voice-inversion + content
    // fabrication). Detection signal preserved (chain still records flag
    // → parent sees marker); rewrite suppressed (original text shown on
    // the page).
    if (neutralized && isHighRiskPassThrough(analysis.primaryTechnique)) {
      console.debug(
        `[FeelingWise] Pipeline: HIGH-RISK PASS-THROUGH (${analysis.primaryTechnique}) — keeping original text; chain still records flag`,
      );
      neutralized.rewrittenText = post.text;
    }

    // When neutralized is null, branch on the detector's action label
    // before falling through to PASS:
    //   • action='collapse'  → return collapse result. Generic-group
    //     claim or hyperreal-trauma-bait; the structural fix is folding
    //     the post, not softening it (propaganda-laundering risk).
    //   • action='hide'      → return hide result. Direct threats /
    //     doxxing.
    //   • action=undefined or 'rewrite' with null rewrite → genuine
    //     pass-with-analysis (LLM said yes but couldn't produce a
    //     usable rewrite).
    if (!neutralized) {
      if (analysis.action === 'collapse') {
        const totalMs = performance.now() - startTime;
        console.log(`[FeelingWise] Pipeline: COLLAPSE (${totalMs.toFixed(0)}ms)`);
        return { action: 'collapse', analysis, aiMeta, detectionMode: combinedDetectionMode };
      }
      if (analysis.action === 'hide') {
        const totalMs = performance.now() - startTime;
        console.debug(`[FeelingWise] Pipeline: HIDE (${totalMs.toFixed(0)}ms)`);
        return { action: 'hide', analysis, aiMeta, detectionMode: combinedDetectionMode };
      }
      // Confirmed manipulative (above threshold) but the rewrite failed
      // validation / came back empty, and the AI named no hide/collapse.
      // Child folds the un-rephrased original behind the calm placeholder
      // (collapse: revisitable, marker carries the why; never the silent
      // hard-hide, which is reserved for threats). Teen and Adult mark: a
      // rewrite failure never becomes a hide (2026-09-07, invariant 2); the
      // severity dot on the original text keeps the flag visible with its
      // why (VISION Promise 2). High-severity hostile cases were already
      // promoted to hide upstream (neutralizer D-5).
      const totalMs = performance.now() - startTime;
      if (hideOnRewriteUnavailable(settings.mode)) {
        console.log(`[FeelingWise] Pipeline: COLLAPSE (confirmed flag, rewrite unavailable, Child) (${totalMs.toFixed(0)}ms)`);
        return { action: 'collapse', analysis, aiMeta, detectionMode: combinedDetectionMode };
      }
      console.log(`[FeelingWise] Pipeline: MARK (confirmed flag, rewrite unavailable) (${totalMs.toFixed(0)}ms)`);
      return { action: 'mark', analysis, aiMeta, detectionMode: combinedDetectionMode, ...(rewriteWhy ? { rewriteWhy } : {}) };
    }

    // Code-side language guard. The combined prompt instructs "same
    // language as input" but the LLM honors that ~80% of the time.
    // Without this guard, Romanian posts could land as English
    // rewrites. The validator at
    // `analysis/comment-rewriter.ts:validateRewriteLanguage` handles
    // the RO / EN case and a heuristic for other languages. On
    // mismatch we discard the drifted rewrite (no DOM mutation, no
    // broken-language rewrite shipped) but the detection is still
    // confirmed — fall back to MARK, the same floor as the
    // rewrite-unavailable branch above, so the flag stays visible on
    // screen. A language drift is a rewrite-quality failure, not a
    // detection failure; silently PASSing here made the confirmed flag
    // invisible.
    const expectedLang = detectLanguage(post.text).language;
    if (
      (expectedLang === 'ro' || expectedLang === 'en') &&
      !validateRewriteLanguage(neutralized.rewrittenText, expectedLang)
    ) {
      if (hideOnRewriteUnavailable(settings.mode)) {
        console.log(
          `[FeelingWise] Pipeline: COLLAPSE (rewrite language mismatch — expected ${expectedLang}; rewrite discarded, Child)`,
        );
        return { action: 'collapse', analysis, aiMeta, detectionMode: combinedDetectionMode };
      }
      console.log(
        `[FeelingWise] Pipeline: MARK (rewrite language mismatch — expected ${expectedLang}, rewrite drifted; rewrite discarded, flag kept visible)`,
      );
      return { action: 'mark', analysis, aiMeta, detectionMode: combinedDetectionMode, rewriteWhy: 'language-drift' };
    }

    // Set the postId on the neutralized content
    neutralized.postId = post.id;
    neutralized.analysis = analysis;

    // Cache the result for dedup
    processingCache.set(textHash, analysis, neutralized.rewrittenText, aiMeta, neutralized.writerModel);

    const totalMs = performance.now() - startTime;

    // Action is always 'neutralize' on a confirmed detection.
    console.log(`[FeelingWise] Pipeline: NEUTRALIZE (${totalMs.toFixed(0)}ms)`);
    return { action: 'neutralize', neutralized, aiMeta, detectionMode: combinedDetectionMode };
  } catch (err) {
    // CARDINAL RULE: any exception → PASS. Tagged as pre-llm-ai-call-failed
    // for caller's scan-log routing — exception path could be anywhere
    // (pre- or post-LLM) but the safe categorization is "we couldn't
    // complete a verdict", which is structurally identical to ai-call-failed
    // from the caller's perspective.
    console.error('[FeelingWise] Pipeline error:', err);
    // A fault in FeelingWise's own code, not the vendor's. The record says so
    // rather than blaming a network that may have been fine.
    return passWith('pre-llm-ai-call-failed', { failureKind: 'internal-error' });
  }
}
