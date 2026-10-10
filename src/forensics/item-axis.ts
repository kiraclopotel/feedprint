// FeelingWise — taxonomy axis A: what the item is.
//
// PLAN-2026-09-14 standing decision 4 and item 8; design in
// docs/research/taxonomy-2026-09-15/DESIGN.md. Deterministic, from the
// record's own fields, no model. Precedence is the order of the checks: an ad
// stays an ad whatever it says (decision 1), a platform label comes before the
// user's rule that acted on it, and only then does the node kind decide.

import type { ForensicRecord } from '../types/forensic';
import { isImpression, isPaidPlacement, ruleLabel } from './export-numbers';

export type ItemAxis = 'ad' | 'badge' | 'rule-hit' | 'reply' | 'comment' | 'post';

/** The platform's own content labels. Today only the AI-generated label is recorded. */
const BADGE_RULES: ReadonlySet<string> = new Set(['ai-content-block']);

/** The user's own rules, as export-numbers ruleLabel names them. A product gate is not a user rule. */
const USER_RULES: ReadonlySet<string> = new Set([
  'word-filter', 'account-block', 'hashtag-block', 'reel-surface', 'media-timeout',
]);

/** What the item is, or null for a structural record (marker, environment, image analysis). */
export function itemAxis(r: ForensicRecord): ItemAxis | null {
  if (!isImpression(r)) return null;
  if (isPaidPlacement(r)) return 'ad';
  const rule = ruleLabel(r);
  if (rule !== null && BADGE_RULES.has(rule)) return 'badge';
  if (rule !== null && USER_RULES.has(rule)) return 'rule-hit';
  const k = r.kind;
  if (k === 'reply' || k === 'reply-to-reply') return 'reply';
  if (k === 'comment' || k === 'top-comment') return 'comment';
  return 'post';
}
