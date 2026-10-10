// What a reader is shown in place of a hidden item's text when the item had none.
//
// logBlockedEvent (logger.ts) stores "[blocked: <reason>]" as the text of a hidden item that came with no caption, so
// the hash covers something. Nobody saw those words on a feed, so no page prints them; it says what the item was
// instead. The words live in the export's table (export-strings.ts), so the dashboard, the HTML export and the PDF
// say the same; the HTML export restates this rule in its inline scripts, which import nothing.

import type { ForensicRecord } from '../types/forensic';
import { isPaidPlacement, ruleLabel } from './export-numbers';
import { carriesHideVerdict } from './flag-verdict';

export type StandInKey = 'feedAdHidden' | 'feedHiddenOwnRuleNoCaption' | 'feedHiddenNoCaption';

/** The rules a person writes themselves; a switch they turned on (AI content, reels, a break) is not one. */
const RULES_A_PERSON_ADDED: ReadonlyArray<string> = ['hashtag-block', 'account-block', 'word-filter'];

export function isTextPlaceholder(r: ForensicRecord): boolean {
  return typeof r.originalText === 'string' && r.originalText.startsWith('[blocked:');
}

/**
 * An ad that was taken off the page. A paid placement the person chose to keep visible is an ad but was not hidden;
 * a record written before decision blocks says so by its verdict.
 */
export function isHiddenAd(r: ForensicRecord): boolean {
  if (!isPaidPlacement(r)) return false;
  const applied = r.decision?.applied;
  return applied ? applied === 'hide' : r.verdict === 'blocked' || carriesHideVerdict(r);
}

/** The key of the words that stand in for the record's text, or null when the record has words of its own. */
export function standInKey(r: ForensicRecord): StandInKey | null {
  if (!isTextPlaceholder(r)) return null;
  if (isHiddenAd(r)) return 'feedAdHidden';
  const label = ruleLabel(r);
  return label !== null && RULES_A_PERSON_ADDED.includes(label) ? 'feedHiddenOwnRuleNoCaption' : 'feedHiddenNoCaption';
}
