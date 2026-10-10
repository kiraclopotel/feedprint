// FeelingWise — per-month summary of an archived month (item 7, 14 Sep 2026).
//
// The dashboard counted "the record" by reading every archived record into
// the page on every open (batch B, 13 Sep). At the owner's rate, about 2,900
// records a day, that is a million records a year, and the open stops being
// instant long before. This module is the pure half of the fix: a small
// summary of one month that the counters can be built from without reading
// the month's records.
//
// Rules, so the summary can never become a second truth:
//   • It is DERIVED from the archive and carries the record count it was
//     computed from. A reader that finds the archive holding a different
//     count recomputes it (archive-summary-store.ts). It is never trusted
//     over the records.
//   • It holds counts only: never text, never authors, never hashes.
//   • Every figure here equals what computeStats() in store.ts would count
//     over the same records, except the time windows (today, this week, this
//     month), which are exact for whole-hour time zones and can be up to one
//     hour off in a half-hour zone (the buckets are UTC hours; the windows
//     are local midnights). archive-summary.test.ts holds the equality.
//
// Nothing here touches IndexedDB; the store half is archive-summary-store.ts.

import type { ForensicRecord } from '../types/forensic';
import { canonicalizeTechniqueForStats } from './technique-canonical';
import { usageBand } from './usage-band';
import { isPaidPlacement } from './paid-placement';
import { isCountedFlagVerdict } from './flag-verdict';

/**
 * 1: counts by verdict, platform, technique and UTC hour (14 Sep 2026, first slice).
 * 2: adds usageByHour, the usage panel's four bands per UTC hour (second slice),
 *    so the Forensics tab's year frame covers the months the walk window did
 *    not load. A stored v1 summary is recomputed once on first read.
 */
// 3 on 2026-09-19: UsageHour gained `gaps`. A version a reader does not know is
// recomputed from the archive rather than read, so no stored summary is left
// answering a question it was never asked.
// 4 on 2026-10-10: a repeat-exposure mark alone ("seen a lot") leaves flagged, byPlatform, byTechnique and
// flaggedByHour, so every stored month is counted again once.
export const MONTH_SUMMARY_VERSION = 4;

/** The usage panel's bands for one UTC hour (ui/dashboard/components/UsageTimePanel.tsx). */
interface UsageHour {
  /** Records that were something the person saw: flagged + blocked + pass + unjudged. */
  n: number;
  flagged: number;
  blocked: number;
  pass: number;
  unjudged: number;
  /**
   * Signed gap markers in this hour: the chain's own statement that the
   * recorder stopped (version 3, 2026-09-19).
   *
   * The live window has counted these since 2026-09-18, and the field it
   * counts them into says why: "An hour holding the chain's own proof that the
   * recorder was down drew identically to an hour somebody spent asleep... A
   * record that cannot tell 'nothing happened' from 'the recorder was dead' is
   * the record a recipient must not rely on."
   *
   * That was true of the live window and remained true of everything older
   * than it. A month rolled into an archive and its outages became idle hours
   * again, silently, because there was nowhere here to put them. Not in
   * `n`: a gap is not something the person was shown.
   */
  gaps: number;
}

export interface MonthSummary {
  /** Schema of this summary; a reader recomputes on a version it does not know. */
  version: number;
  /** 'YYYY-MM', the archive database it describes. */
  monthKey: string;
  /** How many stored entries the archive held when this was computed. The reader's freshness check. */
  recordCount: number;
  /** Records with verdict flagged, flagged-hidden or undefined (legacy): what computeStats calls `total`. */
  flagged: number;
  /** Records with verdict blocked. */
  blocked: number;
  /** Signed-chain records without a signature (computeStats `unsignedRecordsCount`). */
  unsigned: number;
  /** Flagged records by platform. */
  byPlatform: Record<string, number>;
  /** Flagged records by canonical technique, once per record per technique. */
  byTechnique: Record<string, number>;
  /** Flagged records per UTC hour, key 'YYYY-MM-DDTHH'. */
  flaggedByHour: Record<string, number>;
  /** Blocked records per UTC hour, same key. */
  blockedByHour: Record<string, number>;
  /** The usage panel's bands per UTC hour, same key (version 2). */
  usageByHour: Record<string, UsageHour>;
  /** When it was computed, ISO. Informational. */
  computedAt: string;
}

export function emptyMonthSummary(monthKey: string): MonthSummary {
  return {
    version: MONTH_SUMMARY_VERSION,
    monthKey,
    recordCount: 0,
    flagged: 0,
    blocked: 0,
    unsigned: 0,
    byPlatform: {},
    byTechnique: {},
    flaggedByHour: {},
    blockedByHour: {},
    usageByHour: {},
    computedAt: new Date(0).toISOString(),
  };
}

/** Advertising is never a flag here either (standing decision 1, 2026-09-14):
 *  a sponsored-ad record written flagged-hidden at severity 6 by the child and
 *  teen pipeline counts as a paid placement the user's own rule hid, not as a
 *  finding, so it stays out of the month's flagged total, its per-platform and
 *  per-technique tallies and its flagged-by-hour series. */
function isFlagged(r: ForensicRecord): boolean {
  return isCountedFlagVerdict(r) && !isPaidPlacement(r);
}

function isUnsigned(r: ForensicRecord): boolean {
  return r.signature === undefined && typeof r.chainPosition === 'number' && r.chainPosition >= 0
    && r.chainAnchor !== 'pre-rekey';
}

/** 'YYYY-MM-DDTHH' of an ISO timestamp, or null when it is not one. */
export function hourKeyOf(timestamp: string | undefined): string | null {
  if (typeof timestamp !== 'string' || timestamp.length < 13) return null;
  const t = Date.parse(timestamp);
  if (!Number.isFinite(t)) return null;
  return new Date(t).toISOString().slice(0, 13);
}

/**
 * Add records to a summary in place and return it. `recordCount` grows by
 * the number of records given, so the caller must pass exactly the entries
 * it stored (the writer does) or recompute from the whole archive (the
 * reader does).
 */
export function addRecordsToSummary(summary: MonthSummary, records: readonly ForensicRecord[]): MonthSummary {
  for (const r of records) {
    summary.recordCount++;
    if (isUnsigned(r)) summary.unsigned++;
    const hour = hourKeyOf(r.timestamp);
    const band = usageBand(r);
    // A gap marker bands to null like every system marker, and unlike the
    // others it is evidence about the window it sits in. Counted before the
    // band guard, the same way the live panel does it.
    const isGap = r.kind === 'gap-marker';
    if (hour && (band || isGap)) {
      const u = summary.usageByHour[hour]
        ?? (summary.usageByHour[hour] = { n: 0, flagged: 0, blocked: 0, pass: 0, unjudged: 0, gaps: 0 });
      if (isGap) u.gaps++;
      else if (band) { u.n++; u[band]++; }
    }
    if (r.verdict === 'blocked' || (isPaidPlacement(r) && r.verdict !== 'pass')) {
      summary.blocked++;
      if (hour) summary.blockedByHour[hour] = (summary.blockedByHour[hour] ?? 0) + 1;
      continue;
    }
    if (!isFlagged(r)) continue;
    summary.flagged++;
    summary.byPlatform[r.platform] = (summary.byPlatform[r.platform] ?? 0) + 1;
    const seen = new Set<string>();
    for (const t of r.techniques ?? []) {
      const name = canonicalizeTechniqueForStats(t.name);
      if (seen.has(name)) continue;
      seen.add(name);
      summary.byTechnique[name] = (summary.byTechnique[name] ?? 0) + 1;
    }
    if (hour) summary.flaggedByHour[hour] = (summary.flaggedByHour[hour] ?? 0) + 1;
  }
  summary.computedAt = new Date().toISOString();
  return summary;
}

/** The summary of one month, from all of its records. */
export function summarizeMonth(monthKey: string, records: readonly ForensicRecord[]): MonthSummary {
  return addRecordsToSummary(emptyMonthSummary(monthKey), records);
}

/** The ForensicStats shape store.ts computes; repeated here to keep this module free of store.ts. */
export interface SummaryStats {
  total: number;
  byTechnique: Record<string, number>;
  byPlatform: Record<string, number>;
  today: number;
  thisWeek: number;
  thisMonth: number;
  blockedThisWeek: number;
  blockedTotal: number;
  unsignedRecordsCount: number;
}

/** Sum of the hour buckets whose hour starts at or after `sinceIso`'s hour. */
function sumSince(buckets: Record<string, number>, sinceIso: string): number {
  const sinceHour = sinceIso.slice(0, 13);
  let n = 0;
  for (const key in buckets) if (key >= sinceHour) n += buckets[key];
  return n;
}

/**
 * The counters over the archived months, from their summaries alone, folded
 * with the counters of the active chain (which the caller computed with
 * computeStats over the records it already holds). The window boundaries are
 * the same local-midnight boundaries computeStats uses.
 */
export function foldSummariesIntoStats(
  active: SummaryStats,
  summaries: readonly MonthSummary[],
  now: Date = new Date(),
): SummaryStats {
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const startOfWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay()).toISOString();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const out: SummaryStats = {
    total: active.total,
    byTechnique: { ...active.byTechnique },
    byPlatform: { ...active.byPlatform },
    today: active.today,
    thisWeek: active.thisWeek,
    thisMonth: active.thisMonth,
    blockedThisWeek: active.blockedThisWeek,
    blockedTotal: active.blockedTotal,
    unsignedRecordsCount: active.unsignedRecordsCount,
  };
  for (const s of summaries) {
    out.total += s.flagged;
    out.blockedTotal += s.blocked;
    out.unsignedRecordsCount += s.unsigned;
    for (const p in s.byPlatform) out.byPlatform[p] = (out.byPlatform[p] ?? 0) + s.byPlatform[p];
    for (const t in s.byTechnique) out.byTechnique[t] = (out.byTechnique[t] ?? 0) + s.byTechnique[t];
    out.today += sumSince(s.flaggedByHour, startOfDay);
    out.thisWeek += sumSince(s.flaggedByHour, startOfWeek);
    out.thisMonth += sumSince(s.flaggedByHour, startOfMonth);
    out.blockedThisWeek += sumSince(s.blockedByHour, startOfWeek);
  }
  return out;
}

/** Flagged records across the summaries (the header pill's archived share). */
export function flaggedInSummaries(summaries: readonly MonthSummary[]): number {
  let n = 0;
  for (const s of summaries) n += s.flagged;
  return n;
}

/** Records across the summaries. */
export function recordsInSummaries(summaries: readonly MonthSummary[]): number {
  let n = 0;
  for (const s of summaries) n += s.recordCount;
  return n;
}
