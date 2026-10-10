import type { ForensicRecord } from '../types/forensic';
import type { FeedActionKey } from '../i18n/dashboard/types';
import { carriesFlagVerdict, carriesHideVerdict, isRepeatMarkOnly } from './flag-verdict';

export type { FeedActionKey };

/**
 * What FeelingWise did with a record, read from the same fields the dashboard
 * chip and the CSV export both need: never a new signed field, only the
 * applied outcome already on the record (verdict, decision.applied,
 * neutralizedText). Kept in one place so the dashboard chip and the CSV
 * export cannot drift apart on what a hidden, marked, passed, masked or
 * skipped item is called.
 */
export function feedActionKeyFor(
  record: Pick<ForensicRecord, 'feedSource' | 'verdict' | 'neutralizedText' | 'originalText' | 'decision' | 'techniques'>,
): FeedActionKey | null {
  const reframed = !!record.neutralizedText && record.neutralizedText !== record.originalText;
  if (record.feedSource === 'manual') return 'manual';
  if (record.verdict === 'blocked') return 'blocked';
  // A swear mask is written as verdict 'masked'; records written before that
  // verdict existed carry 'pass' and are told apart by decision.applied.
  if (record.verdict === 'masked') return 'masked';
  if (record.verdict === 'pass' && record.decision?.applied === 'mask') return 'masked';
  if (record.verdict === 'pass') return 'passed';
  // Checked before 'skipped': both writers of verdict 'skipped' (logger.ts,
  // result-apply.ts) leave neutralizedText empty, but nothing enforces that.
  // A record that is both should report the rewrite it made, not "skipped".
  if (reframed && record.decision?.applied !== 'mask') return 'rewritten';
  if (record.verdict === 'skipped') return 'skipped';
  if (record.verdict === 'educational-reframe') return 'rewritten';
  if (carriesHideVerdict(record)) return 'hidden';
  // Older builds wrote no verdict, and only on a flag (forensic.ts verdict): read as flagged, as every other reader
  // does. A repeat-exposure mark alone is "seen a lot", never flagged (the Head, 10 Oct 2026).
  if (carriesFlagVerdict(record)) return isRepeatMarkOnly(record) ? 'seenALot' : 'flagged';
  if (record.verdict === 'harm-floor-trigger') return 'flagged';
  return null;
}
