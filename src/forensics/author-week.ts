// FeelingWise - what the record holds about one account this week.
//
// The on-demand reading ("Read this for me") ends with one line from the
// record: how many times this account came up in the last seven days and how
// many of those the judge called charged. Anyone can explain a post; only the
// recorder can say what else that account sent this reader. Read-only over
// the chain records; it feeds no verdict.

import type { ForensicRecord } from '../types/forensic';
import { isPaidPlacement } from './paid-placement';
import { isButtonReading } from './export-numbers';
import { carriesFlagVerdict, isCountedFlagVerdict } from './flag-verdict';

export const AUTHOR_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export interface AuthorWeek {
  /** Content records by this account on this platform in the window. */
  seen: number;
  /** Of those, records the product flagged (a legacy record with no verdict is a flag, as every reader treats it). */
  charged: number;
}

/** A record the reader asked for (content/read-this.ts): never a sighting, never a flag. */
export function isReadingRecord(r: Pick<ForensicRecord, 'detectionMode'>): boolean {
  return isButtonReading(r);
}

/** Records that describe an item the feed served, not markers, summaries, cancellations or readings. */
function isContentRecord(r: ForensicRecord): boolean {
  if (r.kind === 'environment' || isReadingRecord(r)) return false;
  const v = r.verdict;
  return carriesFlagVerdict(r) || v === 'pass' || v === 'masked' || v === 'skipped' || v === 'blocked';
}

/**
 * Handles compare without their leading '@' and without case: the picker
 * reads the link's last path segment, the TikTok adapter stamps `@handle`,
 * and YouTube stamps the visible channel text.
 */
export function sameHandle(a: string | undefined, b: string | undefined): boolean {
  const norm = (h: string | undefined): string => (h ?? '').trim().replace(/^@+/, '').toLowerCase();
  const x = norm(a);
  return x.length > 0 && x === norm(b);
}

export function countAuthorWeek(
  records: readonly ForensicRecord[],
  handle: string,
  platform: string,
  now: number = Date.now(),
): AuthorWeek {
  const since = new Date(now - AUTHOR_WEEK_MS).toISOString();
  let seen = 0;
  let charged = 0;
  for (const r of records) {
    if (r.platform !== platform || !sameHandle(r.author, handle)) continue;
    if (r.timestamp < since || !isContentRecord(r)) continue;
    seen++;
    // An advertiser's ad is seen but never charged (standing decision 1,
    // 2026-09-14): the ad marker is a category, not a reading of the item.
    if (isPaidPlacement(r)) continue;
    // "Seen a lot" is seen and never charged: nothing read it (the Head, 10 Oct 2026).
    if (isCountedFlagVerdict(r)) charged++;
  }
  return { seen, charged };
}
