// FeelingWise — pre-rewrite harm-floor gate (F-5)
//
// Splits the legacy comment-pipeline's pre-rewrite RawComment[] into two
// disjoint subsets:
//   • hidesToApply — identity-slur match OR profanity-tier (sexual / violence /
//     drug) match → DOM-hide via comment-overlay's hideCommentAsFallback.
//   • commentsToRewrite — everything else → existing rewriteTeenComments path.
//
// Mirrors the BATCH-path hide-tier dispatch at
// `src/analysis/comment-batch-scorer.ts:716-748` for the legacy
// `runCommentPipeline` path that TikTok comments flow through today.
//
// Pure function: no DOM access, no chrome.storage, no network. Caller is
// responsible for resolving RawComment.text → DOM root and calling
// hideCommentAsFallback.

import type { RawComment, ScoredComment } from '../../analysis/comment-scorer';
import type { Mode } from '../../types/mode';
import { filterProfanity } from '../../core/profanity-filter';
import { computeHarmFloor, type HarmFloorResult } from '../../core/harm-floor';

/**
 * Reason a comment was routed to the hide path. Surfaces in forensic chain
 * `detectionMode` so recipients (parent / judge) read which signal class
 * triggered the hide.
 */
type HideReason = 'identity-slur' | 'profanity-tier';

export interface HideEntry {
  /** The original RawComment (carries .text used to find the DOM row). */
  raw: RawComment;
  /** Which signal class triggered the hide. */
  reason: HideReason;
  /** Slur or profanity tokens that matched (≤3 entries; for forensic stamp). */
  matches: string[];
  /** Per-comment harm-floor compute result for the chain payload. */
  harmFloor: HarmFloorResult;
}

export interface PreRewriteGateResult {
  /** Comments matching identity-slur OR profanity-tier; route to hide. */
  hidesToApply: HideEntry[];
  /** Comments that should reach rewriteTeenComments. */
  commentsToRewrite: ScoredComment[];
}

/**
 * Decide hide-vs-rewrite for each scored comment based on identity-slur
 * match (any tier='slurs' hit) and profanity-tier match (sexual / violence /
 * drug stems via tier='profanity'). Mirrors the BATCH-path donor logic at
 * `comment-batch-scorer.ts:716-748` for legacy RawComment shape.
 *
 * @param scored Scored comments from `scoreAndRankComments`.
 * @param mode   Family-safety mode tag (passed through to filterProfanity;
 *               'teen' for flag-only semantics on the slur tier per
 *               BATCH-path donor convention).
 */
export function preRewriteHarmFloorGate(
  scored: ScoredComment[],
  mode: Mode,
): PreRewriteGateResult {
  const hidesToApply: HideEntry[] = [];
  const commentsToRewrite: ScoredComment[] = [];

  for (const sc of scored) {
    const text = sc?.raw?.text;
    if (!text || text.trim().length === 0) {
      // Malformed / empty — pass through to rewrite path; it has its own
      // guards. Defensive: gate must not crash on bad input.
      commentsToRewrite.push(sc);
      continue;
    }

    // Layer-1: harm-floor compute (text-only signals; bilingual EN+RO).
    // Always compute so the forensic record carries the harm-floor stamp.
    const harmFloor = computeHarmFloor(text, []);

    // Layer-2: identity-slur (racial / homophobic / ableist) match. Mirrors
    // the BATCH-path enrichment at comment-batch-scorer.ts:353. Mode 'teen'
    // is the BATCH-path convention — flag-without-rewriting; we only care
    // about match presence, the actual hide is the gate's job.
    const slurResult = filterProfanity(text, mode, { tier: 'slurs' });
    if (slurResult.filtered) {
      hidesToApply.push({
        raw: sc.raw,
        reason: 'identity-slur',
        matches: slurResult.matches.slice(0, 3),
        harmFloor,
      });
      continue;
    }

    // Layer-3: profanity-tier (sexual / violence / drug stems  §4
    // extension). Mirrors comment-batch-scorer.ts:720.
    //
    // Adult skips, which is what the rest of the app already says. The judge
    // prompt is explicit that "profanity / swearing is not a technique … never
    // flag a comment just because it swears" (prompts-v2.ts:458) and
    // filterProfanity's own docblock promises "child rewrites, teen flags-no-
    // rewrite, adult skips" (profanity-filter.ts:388). filterProfanity returns
    // `filtered` mode-independently — mode only drives `shouldReplace` — so
    // before this guard an adult swearing in a comment was hidden outright.
    // The mode check lives here rather than in the filter because `filtered`
    // is a detection signal other callers rely on; only the ACTION is
    // age-dependent. Child and teen are unchanged: this tier is defence in
    // depth for them.
    const profanityResult = filterProfanity(text, mode, { tier: 'profanity' });
    if (mode !== 'adult' && profanityResult.filtered) {
      hidesToApply.push({
        raw: sc.raw,
        reason: 'profanity-tier',
        matches: profanityResult.matches.slice(0, 3),
        harmFloor,
      });
      continue;
    }

    commentsToRewrite.push(sc);
  }

  return { hidesToApply, commentsToRewrite };
}
