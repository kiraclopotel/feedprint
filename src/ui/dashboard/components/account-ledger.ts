// FeelingWise: the account ledger (pure, deterministic, unit-tested).
//
// One row per platform-scoped account over ALL its content records, not only
// the flagged ones. The Frequent flaggers panel counted flags alone, so a
// campaign that the judge passed half the time looked half its size, and how
// the account reached the reader (served on For You, or sought on its own
// profile) was not on the row at all. Both were reconstructed by hand from a
// 2026-09-03 export (docs/audits/2026-09-06-capability-audit/AUDIT.md,
// section 0); this module derives them from the signed records.
//
// Semantics contracts:
// - Identity is authorProfileKey(handle, platform), the M18 composite key, so
//   the same handle on two platforms is two rows.
// - "flagged" is overview-data's isFlaggedVerdict; the panel, the Overview and
//   Statistics must never disagree on what a flag is.
// - Content records only: environment readings and system markers are out.
// - A burst is 3 or more of the account's For You items inside 90 seconds.
//   Profile and permalink items are excluded from bursts on purpose: opening
//   an account's page loads its posts in a burst by construction, and that is
//   the reader's act, not the platform's.
// - Every count describes delivery and reading, never attention.

import type { ForensicRecord } from '../../../types/forensic';
import type { FeedSource } from '../../../types/post';
import { authorProfileKey } from '../../../forensics/author-store';
import { isFlaggedItem, isItem } from '../record-sets';
import { isPaidPlacement } from '../../../forensics/paid-placement';
import { localDayKey } from '../../shared/format-time';
import { canonicalizeTechniqueForStats } from '../../../forensics/technique-canonical';

export const BURST_WINDOW_MS = 90_000;
export const BURST_MIN_ITEMS = 3;

/** Surfaces where the reader went to the account, rather than the feed bringing it. */
const SOUGHT_SURFACES: ReadonlySet<FeedSource> = new Set<FeedSource>(['profile', 'permalink', 'search']);

export interface AccountRow {
  key: string;
  author: string;
  platform: ForensicRecord['platform'];
  /** Content records by this account in the window. */
  seen: number;
  flagged: number;
  passed: number;
  /** Everything else: blocked, skipped, cancelled. */
  other: number;
  /** Delivered by the recommender (feedSource 'for-you'). */
  forYou: number;
  /** The reader's chosen feed (feedSource 'following'). */
  following: number;
  /** The reader went to it: profile, permalink, search. */
  sought: number;
  /** Distinct UTC days with at least one record. */
  distinctDays: number;
  /** Runs of BURST_MIN_ITEMS or more For You items inside BURST_WINDOW_MS. */
  bursts: number;
  /** Technique counts over the flagged records, most frequent first. */
  techniques: { name: string; count: number }[];
  /** Provenance: every record behind the row, timestamp order. */
  recordIds: string[];
}

interface Acc {
  author: string;
  platform: ForensicRecord['platform'];
  records: ForensicRecord[];
}

function isUnknownAuthor(author: string | undefined): boolean {
  const a = (author ?? '').trim();
  return a === '' || a.toLowerCase() === 'unknown';
}

/**
 * Flagged items whose page named no account. They are not one author, so they are never a row; the panel counts them
 * apart, or a list that skips them would read as covering every flag.
 */
export function countFlaggedWithoutAuthor(records: ForensicRecord[]): number {
  let n = 0;
  for (const r of records) if (isItem(r) && isUnknownAuthor(r.author) && isFlaggedItem(r)) n++;
  return n;
}

/**
 * The reader's own calendar day. The row prints "seen on N days", and N has to
 * be N of the days the person remembers; it cut UTC until 2026-09-18, which
 * disagreed with the Overview beside it for every reader away from Greenwich.
 */
const dayKeyOf = localDayKey;

/**
 * Count runs of `minItems` or more timestamps inside `windowMs`. Greedy, left
 * to right: a run closes at the first timestamp more than `windowMs` after the
 * run's first item, so one dense minute is one burst, never several.
 */
export function countBursts(timesMs: number[], windowMs = BURST_WINDOW_MS, minItems = BURST_MIN_ITEMS): number {
  const t = timesMs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  let bursts = 0;
  let i = 0;
  while (i < t.length) {
    let j = i;
    while (j + 1 < t.length && t[j + 1] - t[i] <= windowMs) j++;
    if (j - i + 1 >= minItems) bursts++;
    i = j + 1;
  }
  return bursts;
}

/**
 * Build the ledger. Rows are sorted by flagged desc, then seen desc, then key,
 * so the order is stable for the same records in any input order.
 */
export function computeAccountLedger(
  records: ForensicRecord[],
  opts?: { minFlagged?: number; limit?: number },
): AccountRow[] {
  const minFlagged = opts?.minFlagged ?? 0;
  const limit = opts?.limit ?? Number.POSITIVE_INFINITY;

  const byKey = new Map<string, Acc>();
  for (const r of records) {
    if (!isItem(r)) continue;
    // An ad's account is whoever paid to be shown, not a voice the feed chose, so it never ranks.
    if (isPaidPlacement(r)) continue;
    if (isUnknownAuthor(r.author)) continue;
    const key = authorProfileKey(r.author, r.platform);
    const acc = byKey.get(key);
    if (acc) acc.records.push(r);
    else byKey.set(key, { author: r.author, platform: r.platform, records: [r] });
  }

  const rows: AccountRow[] = [];
  for (const [key, acc] of byKey) {
    const sorted = acc.records
      .slice()
      .sort((a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : a.id < b.id ? -1 : 1));
    let flagged = 0;
    let passed = 0;
    let forYou = 0;
    let following = 0;
    let sought = 0;
    const days = new Set<string>();
    const forYouTimes: number[] = [];
    const tech = new Map<string, number>();
    for (const r of sorted) {
      if (isFlaggedItem(r)) {
        flagged++;
        for (const t of r.techniques ?? []) {
          // Canonicalised on 2026-09-19, for the reason group-behavior.ts
          // states: the judge drifts between spellings of one technique, and
          // counting the raw name splits its votes and renders the raw id.
          if (t?.name) {
            const name = canonicalizeTechniqueForStats(t.name);
            tech.set(name, (tech.get(name) ?? 0) + 1);
          }
        }
      } else if (r.verdict === 'pass') {
        passed++;
      }
      const src = r.feedSource;
      if (src === 'for-you') {
        forYou++;
        forYouTimes.push(new Date(r.timestamp).getTime());
      } else if (src === 'following') {
        following++;
      } else if (src && SOUGHT_SURFACES.has(src)) {
        sought++;
      }
      days.add(dayKeyOf(r.timestamp));
    }
    if (flagged < minFlagged) continue;
    rows.push({
      key,
      author: acc.author,
      platform: acc.platform,
      seen: sorted.length,
      flagged,
      passed,
      other: sorted.length - flagged - passed,
      forYou,
      following,
      sought,
      distinctDays: days.size,
      bursts: countBursts(forYouTimes),
      techniques: [...tech.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count || (a.name < b.name ? -1 : 1)),
      recordIds: sorted.map((r) => r.id),
    });
  }

  rows.sort((a, b) => b.flagged - a.flagged || b.seen - a.seen || (a.key < b.key ? -1 : 1));
  return Number.isFinite(limit) ? rows.slice(0, limit) : rows;
}
