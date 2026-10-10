// Was a person there? The measure, and the two mistakes it must not make.
//
// Built from the 2026-09-08 export: 704 records arriving every ~23 seconds
// from 01:43 to 06:13 UTC, not one gap under two seconds in the whole stretch.
// A tab left open, rendering into an empty room, counted until now as exposure.

import { describe, it, expect } from 'vitest';
import {
  judgeGaps,
  computeAttendance,
  MIN_RUN_RECORDS,
  RUN_BREAK_MS,
} from '../../../src/forensics/attendance';
import type { ForensicRecord } from '../../../src/types/forensic';

function rec(tISO: string, session = 's1'): ForensicRecord {
  return {
    id: 'r', timestamp: tISO, platform: 'instagram', originalText: 't', originalHash: 'h',
    originalLength: 1, neutralizedText: '', author: 'a', postUrl: 'u', techniques: [],
    overallScore: 0, userAgeCategory: 'teen', aiSource: 'cloud', feedSource: 'for-you',
    detectionMode: 'x', prevRecordHash: 'p', chainPosition: 1, verdict: 'pass', kind: 'post',
    surfaceSessionId: session, publicKeyFingerprint: 'f', integrityHash: 'i', signature: 's',
  } as ForensicRecord;
}

/** n records spaced `everyMs` apart with `jitterMs` of wobble — a timer. */
function metronome(n: number, everyMs: number, jitterMs = 0, session = 's1'): ForensicRecord[] {
  let t = Date.parse('2026-09-07T01:43:00.000Z');
  const out: ForensicRecord[] = [];
  for (let i = 0; i < n; i++) {
    out.push(rec(new Date(t).toISOString(), session));
    t += everyMs + ((i * 7919) % (2 * jitterMs + 1)) - jitterMs;
  }
  return out;
}

describe('judgeGaps', () => {
  it('a metronome is unattended', () => {
    const v = judgeGaps(Array.from({ length: 200 }, () => 23_000));
    expect(v.attended).toBe(false);
    expect(v.medianGapS).toBe(23);
    expect(v.spread).toBe(0);
    expect(v.burstShare).toBe(0);
  });

  // A person renders a screenful at once, then pauses. Both halves of the
  // signature are present and either alone would be enough to keep it attended.
  it('bursts then pauses is attended', () => {
    const gaps: number[] = [];
    for (let i = 0; i < 40; i++) {
      gaps.push(30, 45, 12, 8_000, 120, 60, 25_000);
    }
    expect(judgeGaps(gaps).attended).toBe(true);
  });

  // The two conditions are an AND. A slow, even reader who produces no bursts
  // must still not be called a machine if the gaps are uneven, and a batch of
  // records resolving together must not be called one for being tight.
  it('needs both regularity and the absence of bursts', () => {
    // even gaps, but plenty of bursts → attended
    expect(judgeGaps([...Array(50).fill(20_000), ...Array(50).fill(100)]).attended).toBe(true);
    // no bursts, but wildly uneven → attended
    expect(judgeGaps([5_000, 90_000, 12_000, 60_000, 8_000, 45_000, 30_000, 3_000]).attended).toBe(true);
  });
});

describe('computeAttendance', () => {
  it('finds the metronome and counts its records as unattended', () => {
    const s = computeAttendance(metronome(704, 23_000, 1_500));
    expect(s.considered).toBe(704);
    expect(s.unattended).toBe(704);
    expect(s.attended).toBe(0);
    expect(s.unattendedRuns).toHaveLength(1);
    expect(s.unattendedRuns[0].records).toBe(704);
  });

  // The failure that matters: calling a real reading session unattended erases
  // exposure that happened. Short runs are never judged at all.
  it('a run too short to judge stays attended', () => {
    const s = computeAttendance(metronome(MIN_RUN_RECORDS - 1, 23_000));
    expect(s.unattended).toBe(0);
    expect(s.attended).toBe(MIN_RUN_RECORDS - 1);
  });

  it('a long silence splits a run in two', () => {
    const a = metronome(40, 23_000);
    const lastT = Date.parse(a[a.length - 1].timestamp);
    const b = [rec(new Date(lastT + RUN_BREAK_MS + 1_000).toISOString())];
    expect(computeAttendance([...a, ...b]).runs).toHaveLength(2);
  });

  // Two tabs scrolling at once interleave into one time series whose gaps
  // describe neither. Judged together, a pair of ordinary sessions can look
  // like a machine; judged per session they read correctly.
  it('sessions are judged apart', () => {
    const s = computeAttendance([
      ...metronome(60, 23_000, 0, 'tab-a'),
      ...metronome(60, 23_000, 0, 'tab-b'),
    ]);
    expect(s.unattendedRuns).toHaveLength(2);
    expect(s.unattended).toBe(120);
  });

  it('records with an unreadable timestamp are left out, not guessed at', () => {
    const bad = rec('not a date');
    expect(computeAttendance([bad]).considered).toBe(0);
  });
});

// A heartbeat marker is written every fifteen minutes BY A TIMER — the exact
// thing this measure looks for — and no marker was ever something a person saw.
// They were in the denominator until 2026-09-08: 134 of the 5,962 in the file
// this was built from, none of which could be exposure either way.
describe('computeAttendance — system markers', () => {
  function marker(tISO: string): ForensicRecord {
    return { ...rec(tISO), kind: 'heartbeat-marker', surfaceSessionId: undefined } as ForensicRecord;
  }

  it('markers are not in the denominator', () => {
    const s = computeAttendance([
      ...metronome(40, 23_000),
      ...Array.from({ length: 5 }, (_, i) => marker(new Date(Date.parse('2026-09-07T10:00:00.000Z') + i * 900_000).toISOString())),
    ]);
    expect(s.considered).toBe(40);
  });

  // A file of nothing but heartbeats is a recorder that was alive and idle. It
  // must not read as "40 records served to nobody" — there were no records.
  it('a file of only markers has nothing to judge', () => {
    const s = computeAttendance(Array.from({ length: 40 }, (_, i) =>
      marker(new Date(Date.parse('2026-09-07T10:00:00.000Z') + i * 900_000).toISOString())));
    expect(s.considered).toBe(0);
    expect(s.unattended).toBe(0);
    expect(s.runs).toHaveLength(0);
  });
});

// "None look unattended" and "nothing was long enough to look at" are different
// findings, and the page printed the first sentence for both. A file of short
// bursts read "Every stretch in this file arrives the way a person scrolling
// produces" on no evidence at all — the over-claim the attended/unattended
// asymmetry exists to prevent.
describe('computeAttendance — how much was long enough to judge', () => {
  it('short runs are counted as judged of nothing', () => {
    const s = computeAttendance(metronome(MIN_RUN_RECORDS - 1, 23_000));
    expect(s.unattended).toBe(0);
    expect(s.judgedRecords).toBe(0);
  });

  it('a run long enough to judge says so', () => {
    const s = computeAttendance(metronome(MIN_RUN_RECORDS + 5, 23_000));
    expect(s.judgedRecords).toBe(MIN_RUN_RECORDS + 5);
  });
});
