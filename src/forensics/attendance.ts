// FeelingWise — was a person there?
//
// THE READING THIS FIXES. The 2026-09-08 export holds records in every hour of
// the clock across 34.7 hours, with no silence longer than 84 minutes. Read
// plainly it describes someone who did not sleep. They slept. An Instagram tab
// stayed open 4.5 hours, and from 01:43 to 06:13 UTC the record arrives on a
// metronome: 704 records, median gap 23.1 seconds, and not one gap under two
// seconds in the whole stretch. Measured, that run is 11.8% of the file: items
// rendered into an open tab in an empty room.
//
// The separation is not a close call. That run scores 0.12 on gap spread and
// 0.00 on burstiness; the largest human runs in the same file score 0.5 to
// 21.5 and 0.55 to 0.91. The thresholds below sit in the wide gap between,
// which is why they need no tuning per platform or per person.
//
// FeelingWise records what the browser was served. It has never been able to
// say whether anyone looked, and `viewportSeenAt` does not save it: it stamps
// when the item was extracted, a median 0.3 seconds before the record, not
// when a person's eyes reached it. So every "you were exposed to N items"
// figure the product has ever printed is inflated by whatever the open tabs
// were doing, and the file gave a recipient no way to subtract it.
//
// WHAT THIS DOES. It does not claim to know who was watching. It measures one
// thing that is decidable from timestamps alone: whether the arrival of records
// looks like a person or like a machine.
//
//   A person scrolls in bursts. Several items land within milliseconds as a
//   screenful renders, then nothing for a while, then another burst. The gaps
//   are wildly uneven.
//
//   An unattended tab pulls on a timer. Gaps cluster tightly around one value
//   and nothing interrupts them.
//
// A run of records is UNATTENDED when it is long enough to be sure, its gaps
// are regular enough to be a timer, and no burst interrupts it. Everything
// else is ATTENDED, which is the weaker claim: not "a person was there" but
// "nothing about the timing says otherwise". The asymmetry is deliberate —
// wrongly calling a run unattended erases exposure that happened, so the
// evidence has to be positive before that word is used.
//
// The result is derived, never stored: no new record field, nothing added to
// the canonical payload, nothing to sign. A recipient recomputes it from the
// timestamps in front of them, which is the only version worth having.

import type { ForensicRecord } from '../types/forensic';
import { isSystemMarkerRecord } from './system-records';

/**
 * Shortest run worth judging. Below this the gaps are too few to tell a timer
 * from a person who happened to scroll evenly, and calling such a run
 * unattended on three coincidences would be the failure mode this guards
 * against.
 */
export const MIN_RUN_RECORDS = 30;

/**
 * A gap longer than this ends a run. Two minutes of nothing is a person
 * looking away or a tab going quiet; either way the stretch after it is
 * judged on its own.
 */
export const RUN_BREAK_MS = 120_000;

/**
 * Gaps below this are one screenful rendering, not a decision to move on. They
 * are the signature of a person scrolling and are counted as bursts.
 */
const BURST_MS = 2_000;

/**
 * The most burstiness a run can carry and still be called a timer. A pull loop
 * does produce a few near-simultaneous records when a batch resolves, so this
 * is not zero; a person produces far more.
 */
const MAX_BURST_SHARE = 0.2;

/**
 * How tight the gaps must cluster. The measure is the interquartile range over
 * the median: 0 is a perfect metronome, and a person scrolling runs well above
 * 1. The unattended run in the file this was built from scores 0.12; the
 * largest human runs beside it score 0.5 to 21.5.
 */
const MAX_GAP_SPREAD = 0.35;

/** One stretch of records with no long silence inside it. */
interface AttendanceRun {
  /** Index of the first record of the run in the sorted input. */
  from: number;
  /** Index of the last record of the run in the sorted input. */
  to: number;
  records: number;
  startISO: string;
  endISO: string;
  attended: boolean;
  /** Median gap between records, in seconds. */
  medianGapS: number;
  /** Interquartile range over the median. Low means a timer. */
  spread: number;
  /** Share of gaps under BURST_MS — the fingerprint of a person scrolling. */
  burstShare: number;
}

export interface AttendanceSummary {
  /** Content records with a usable timestamp. System markers are excluded. */
  considered: number;
  attended: number;
  unattended: number;
  /**
   * Records inside runs that were long enough to judge at all.
   *
   * Without it "none look unattended" and "nothing was long enough to look at"
   * are the same output, and the page printed the first sentence for both. A
   * file of short bursts would have read "Every stretch in this file arrives
   * the way a person scrolling produces" on no evidence whatever — the exact
   * over-claim the attended/unattended asymmetry exists to prevent.
   */
  judgedRecords: number;
  /** Runs judged unattended, longest first. */
  unattendedRuns: AttendanceRun[];
  /** Every run, in time order. */
  runs: AttendanceRun[];
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))));
  return sorted[i];
}

/**
 * Judge one run's gaps. Exported so the thresholds can be tested against real
 * gap sequences rather than only through whole exports.
 */
export function judgeGaps(gapsMs: number[]): { attended: boolean; medianGapS: number; spread: number; burstShare: number } {
  if (gapsMs.length === 0) return { attended: true, medianGapS: 0, spread: 0, burstShare: 0 };
  const burstShare = gapsMs.filter(g => g < BURST_MS).length / gapsMs.length;
  const sorted = [...gapsMs].sort((a, b) => a - b);
  const median = quantile(sorted, 0.5);
  const spread = median > 0 ? (quantile(sorted, 0.75) - quantile(sorted, 0.25)) / median : 0;
  // Unattended needs BOTH: gaps that cluster like a timer AND the absence of
  // the bursts a person makes. Either one alone is ordinary — a slow reader
  // has few bursts, a batch resolving has tight gaps.
  const attended = !(spread <= MAX_GAP_SPREAD && burstShare <= MAX_BURST_SHARE);
  return { attended, medianGapS: Math.round(median / 100) / 10, spread: Math.round(spread * 100) / 100, burstShare: Math.round(burstShare * 100) / 100 };
}

/**
 * Split a file into runs and say which of them look unattended.
 *
 * Records are considered per surface session where one is recorded, because two
 * tabs scrolling at once interleave into a single time series whose gaps
 * describe neither of them. Records with no session id (written before
 * 2026-09-06) are judged per platform, the nearest thing to a session the
 * record still carries; one stream across platforms interleaved a TikTok tab
 * with an X tab (wiring audit 2026-09-13, C19).
 */
export function computeAttendance(records: readonly ForensicRecord[]): AttendanceSummary {
  const usable = records
    // System markers are out. A heartbeat is written every fifteen minutes BY A
    // TIMER, which is the exact thing this measure looks for, and no marker was
    // ever something a person saw. Leaving them in put 134 records in the
    // denominator that could not be exposure either way, and dropped every one
    // of them into the no-session bucket to interleave with real content.
    // Same exclusion computeFlagSplit makes, so the two page-one percentages
    // are drawn over comparable sets.
    .filter(r => !isSystemMarkerRecord(r))
    .filter(r => typeof r.timestamp === 'string' && !Number.isNaN(Date.parse(r.timestamp)))
    .map((r, i) => ({ r, i, t: Date.parse(r.timestamp) }));

  const bySession = new Map<string, typeof usable>();
  for (const u of usable) {
    const key = u.r.surfaceSessionId ?? 'no-session:' + u.r.platform;
    const bucket = bySession.get(key);
    if (bucket) bucket.push(u); else bySession.set(key, [u]);
  }

  const runs: AttendanceRun[] = [];
  for (const bucket of bySession.values()) {
    bucket.sort((a, b) => a.t - b.t);
    let start = 0;
    for (let i = 1; i <= bucket.length; i++) {
      const broke = i === bucket.length || bucket[i].t - bucket[i - 1].t > RUN_BREAK_MS;
      if (!broke) continue;
      const slice = bucket.slice(start, i);
      start = i;
      if (slice.length < MIN_RUN_RECORDS) {
        // Too short to judge. Counted as attended, the weaker claim.
        runs.push({
          from: slice[0].i, to: slice[slice.length - 1].i, records: slice.length,
          startISO: new Date(slice[0].t).toISOString(),
          endISO: new Date(slice[slice.length - 1].t).toISOString(),
          attended: true, medianGapS: 0, spread: 0, burstShare: 0,
        });
        continue;
      }
      const gaps: number[] = [];
      for (let k = 1; k < slice.length; k++) gaps.push(slice[k].t - slice[k - 1].t);
      const verdict = judgeGaps(gaps);
      runs.push({
        from: slice[0].i, to: slice[slice.length - 1].i, records: slice.length,
        startISO: new Date(slice[0].t).toISOString(),
        endISO: new Date(slice[slice.length - 1].t).toISOString(),
        ...verdict,
      });
    }
  }

  runs.sort((a, b) => (a.startISO < b.startISO ? -1 : a.startISO > b.startISO ? 1 : 0));
  let attended = 0;
  let unattended = 0;
  let judgedRecords = 0;
  for (const run of runs) {
    if (run.records >= MIN_RUN_RECORDS) judgedRecords += run.records;
    if (run.attended) attended += run.records; else unattended += run.records;
  }
  return {
    considered: usable.length,
    attended,
    unattended,
    judgedRecords,
    unattendedRuns: runs.filter(r => !r.attended).sort((a, b) => b.records - a.records),
    runs,
  };
}
