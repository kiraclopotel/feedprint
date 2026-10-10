// Activity-feed TYPE filters + #serial search (port of the "calm feed" mockup's
// filter row: all · posts · video · flagged · rewritten · hidden · AI flagged ·
// passed). Pure helpers so the predicates are unit-testable without rendering.
//
// 'all', 'flagged', 'blocked', 'rewritten', 'disputed' can also arrive in the
// address (the popup links to dashboard.html#blocked), and their predicates depend
// on parentFeedback / neutralizedText, so they live in ActivityTab. The
// kind/verdict/source filters below are pure per-record.

import type { ForensicRecord } from '../../../types/forensic';
import { isFlaggedVerdict, isHiddenAsHarmful, isRuleBlocked } from '../record-sets';

export type FeedFilter =
  | 'all'
  | 'posts'
  | 'video'
  | 'flagged'
  | 'rewritten'
  | 'hidden'
  | 'ai'
  | 'passed'
  | 'ads'
  | 'comments'
  | 'replies'
  | 'repeat-offenders'
  | 'blocked'
  | 'disputed';

/**
 * True for an ad record: a child/teen sponsored-ad verdict (detectionMode
 * 'sponsored-ad*', set by the pipeline) OR an adult Block Ads category event
 * (detectionMode 'block:ads:<token>', written via BLOCKED_LOG). Ads are
 * recorded to the chain + shown in the dashboard (the "Ads" filter isolates
 * them); only the live PAGE hides them.
 */
export function isAdRecord(r: ForensicRecord): boolean {
  return !!r.detectionMode
    && (r.detectionMode.startsWith('sponsored-ad') || r.detectionMode.startsWith('block:ads:'));
}

/**
 * Pure per-record predicate for the kind / verdict / source TYPE filters.
 * Returns true for the verdict-set filters (flagged/blocked/rewritten/disputed),
 * 'repeat-offenders' (needs the author set), and 'all' — those are resolved
 * against precomputed sets in the component.
 */
export function matchesTypeFilter(r: ForensicRecord, filter: FeedFilter): boolean {
  switch (filter) {
    case 'posts':  return r.kind === 'post';
    case 'video':  return r.kind === 'video';
    case 'hidden': return isRuleBlocked(r) || isHiddenAsHarmful(r);
    case 'ai':
      // The cloud AI classifier flagged it (vs the deterministic harm-floor /
      // rules path), i.e. a model judgement the parent may want to review.
      return r.aiSource === 'cloud'
        && isFlaggedVerdict(r);
    case 'passed':   return r.verdict === 'pass';
    case 'ads':      return isAdRecord(r);
    case 'comments': return r.kind === 'comment';
    case 'replies':  return r.kind === 'reply' || r.kind === 'reply-to-reply';
    default:         return true;
  }
}

// ── Account-type axis (slice 2) — WHO posted it, independent of the TYPE row.
// Composes with platform + type filters: a record must pass all active axes.
export type AccountFilter = 'all' | 'person' | 'group' | 'page' | 'advertiser';

// Chips shown in the "Who posted it" row, left→right.
export const ACCOUNT_FILTER_CHIPS: readonly AccountFilter[] = [
  'all', 'person', 'group', 'page', 'advertiser',
] as const;

/**
 * Pure per-record predicate for the account-type filter. A record with no
 * `accountType` reads as 'person' (the default-person semantics from
 * deriveAccountType — a record we couldn't prove anything about is treated as a
 * person, never silently dropped from the People view).
 */
export function matchesAccountFilter(r: ForensicRecord, filter: AccountFilter): boolean {
  if (filter === 'all') return true;
  const acct = r.accountType ?? 'person';
  return acct === filter;
}

/**
 * Parse a search query for the `#serial` syntax (`#978` → chain position 978).
 * Returns the numeric chain position, or null if the query isn't a bare serial.
 */
export function parseSerialQuery(raw: string): number | null {
  const m = raw.trim().match(/^#(\d+)$/);
  return m ? parseInt(m[1], 10) : null;
}
