/**
 * Deterministic present-target detection for the comment intervention gate.
 *
 * Measured FP class (honest-en-v1 paired baselines 2026-07-24, gpt-oss-20b):
 * 21 of the 25-26 false positives were shame-attack / scapegoating verdicts
 * aimed at ABSENT targets — public figures, groups, third parties — where
 * rewriting or hiding the comment suppresses critical speech that never
 * addressed the child. The model-emitted `target_present` schema field is
 * dead on the production model (the parse gate at comment-batch-scorer.ts
 * fired 0 times across both baseline runs), so presence is detected
 * code-side: second-person address or an @-mention in the comment text.
 *
 * Deliberately overmatching: any second-person token or @-sequence counts
 * as "present". A false "present" keeps the intervention; a false "absent"
 * would drop it. Diacritic-insensitive so "ție"/"tie", "ești"/"esti" match
 * equally (matching runs on NFD-stripped lowercase text).
 */

import { detectDehumanization } from '../core/dehumanization-filter';
import type { BatchCommentVerdict } from '../types/batch-verdict';

/** Any @ immediately followed by a handle character reads as a mention. */
const AT_MENTION_RE = /@[A-Za-z0-9_]/;

/**
 * Second-person whole-word tokens, EN + RO. RO entries are ASCII-folded;
 * `hasPresentTarget` folds the input the same way before matching.
 * Overmatch is accepted by design (EN "u", RO "va"/"te" collide with other
 * words — a collision keeps the intervention, never drops it).
 */
const SECOND_PERSON_TOKENS = [
  // EN
  'you', "you're", 'youre', 'your', 'yours', 'yourself', 'u', 'ur',
  // RO (diacritic-folded)
  'tu', 'tine', 'tie', 'iti', 'te', 'te-ai', 'esti', 'sunteti', 'voi', 'va', 'voua',
];

const SECOND_PERSON_RE = new RegExp(
  `(?:^|[^\\p{L}\\p{N}])(?:${SECOND_PERSON_TOKENS.join('|')})(?![\\p{L}\\p{N}])`,
  'u',
);

/**
 * True iff the comment text addresses someone present in the thread:
 * an @-mention or a whole-word second-person token (EN/RO), case- and
 * diacritic-insensitive. Pure; no side effects.
 */
export function hasPresentTarget(text: string): boolean {
  if (typeof text !== 'string' || text.length === 0) return false;
  if (AT_MENTION_RE.test(text)) return true;
  const folded = text
    .replace(/[\u2019\u02BC]/g, "'")
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  return SECOND_PERSON_RE.test(folded);
}

/**
 * Absent-target hide exemption ("require target-present for the HIDE, not
 * the flag") — SHAME-ATTACK ONLY. For an LLM-origin shame-attack verdict
 * whose text addresses nobody present, the comment still FLAGS — forensic
 * record and marker unchanged — but the flush-path empty-rewrite hide
 * promotion is skipped: the child reads the original text behind the
 * marker.
 *
 * Scapegoating NEVER qualifies. Its harm model is not interlocutor-
 * directed — it recruits the reader against an absent group — so group
 * victims are never "present" and any presence test structurally exempts
 * genuine group smears (both TP costs in the 2026-07-24 offline eval were
 * scapegoating verdicts; docs/history/archive/MECH8-REPORT-2026-07-24.md diagnosis).
 *
 * Never exempts:
 *   - deterministic-override verdicts (any `overrideOrigin`) or hide-tier
 *     actions — slur / profanity / coded-harm escalations always intervene;
 *   - dehumanizing text (`detectDehumanization`) — group-directed
 *     dehumanization is the one absent-target class where hiding is the
 *     point, and the flush-path hide gate must stay reachable for it;
 *   - empty / whitespace text (fail-open: uncertainty keeps intervention).
 *
 * Behavioral-only: callers must not serialize this decision into signed
 * records (no record schema field exists for it by design).
 */
export function isAbsentTargetInterventionExempt(
  verdict: Pick<BatchCommentVerdict, 'technique' | 'action' | 'overrideOrigin'>,
  text: string | undefined,
): boolean {
  if (verdict.technique !== 'shame-attack') return false;
  if (verdict.action === 'hide') return false;
  if (verdict.overrideOrigin !== undefined) return false;
  if (typeof text !== 'string' || text.trim().length === 0) return false;
  if (hasPresentTarget(text)) return false;
  if (detectDehumanization(text).triggered) return false;
  return true;
}
