// Provenance for the Issues tab's Copy Diagnostics payload.
//
// Why (support need identified 2026-08-02 06:21): the diagnostics from the
// Issues tab were not clear enough to debug an update from; the payload
// needed something like a version stamp or a chronology.
//
// Two distinct defects, both real, both fixed here:
//
// 1. NO PROVENANCE. A payload said nothing about which build produced it or
//    when it was captured. A diagnostic pasted at 06:00 from a 03:15 capture,
//    taken on a bundle built at 03:20, is indistinguishable from a fresh one.
//    Working that out required reading file timestamps on disk.
//
// 2. NO WINDOW LABELS. Every block covers a DIFFERENT period and only one said
//    so. Read literally, `groqSummary.calls: 100` looks like "100 calls today";
//    it is a saturated 100-entry ring that in one real capture spanned four
//    minutes. `diagnosticCounterTotals` looks all-time; it resets daily. On a
//    product whose promise is evidence honesty, a number without its window is
//    not evidence.
//
// Every window below is derived from the code that produces the block, not from
// a guess. Where a block carries its own `since`, that value is used verbatim.

import type { BuildRunRow } from './build-history-read';
import { currentBuildSinceRow, spansMultipleBuildsRow } from './build-history-read';

/** Ring-buffer capacities, mirrored from their producers so a saturated buffer
 *  can be named as such rather than read as a total. */
export const GROQ_RING_CAP = 100;

export interface DiagnosticsProvenance {
  capturedAt: string;
  build: {
    id: string;
    version: string;
    /** When this build first ran on this install. */
    runningSince: string | null;
    /** Every build this install has run, newest first. */
    history: BuildRunRow[];
  };
  /**
   * TRUE when the numbers below were produced by more than one build — i.e. the
   * reader is NOT looking at a clean measurement of the code they hold. This is
   * the single most important field in the payload when debugging after a
   * rebuild.
   */
  spansMultipleBuilds: boolean;
  /** What period each block actually covers. Keys match the payload's keys. */
  windows: Record<string, string>;
  /** Blocks whose ring buffer is full, so their totals are truncated. */
  saturated: string[];
}

interface SummaryInputs {
  diagnosticsDate?: string | null;
  roomSince?: string | null;
  recordIdentityWindowMs?: number | null;
  chainLength?: number | null;
  /** Tries the text-AI buffer holds; its cap is on tries, not calls. */
  groqCalls?: number | null;
  groqFirstTs?: string | null;
  groqLastTs?: string | null;
  perfRecords?: number | null;
}

function iso(v: string | null | undefined): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

export function buildDiagnosticsProvenance(args: {
  capturedAt: string;
  buildId: string;
  version: string;
  history: BuildRunRow[];
  summaries: SummaryInputs;
}): DiagnosticsProvenance {
  const { capturedAt, buildId, version, history, summaries: s } = args;
  const runningSince = currentBuildSinceRow(history, buildId);

  // The earliest instant any block's data begins. If a build started AFTER
  // that, the payload straddles a rebuild.
  const starts = [iso(s.roomSince), iso(s.groqFirstTs)].filter((x): x is string => x !== null);
  const dataStart = starts.length ? starts.slice().sort()[0] : null;

  const windows: Record<string, string> = {
    diagnostics: s.diagnosticsDate
      ? `today only (${s.diagnosticsDate}) — memory samples for the host named in the block; resets at day flip`
      : 'today only — resets at day flip',
    diagnosticCounterTotals:
      'TODAY ONLY, summed across this day\'s sessions and hosts. A counter absent here was never bumped TODAY, which is not the same as never bumped.',
    diagnosticCounterFirstSeen:
      'When each counter was FIRST bumped today. Read it before comparing two counters: a counter first seen at 21:15 covers 40 minutes while a counter first seen at 01:55 covers the whole day, and the two are not a ratio.',
    protectionHealth: 'live snapshot of the active tab at capture time; null when no content script reported',
    canary: 'today only — per-platform first success of the day',
    selectorHealth: 'today only — resets at day flip',
    perfSummary:
      s.perfRecords === 0
        ? 'EMPTY BY DESIGN unless the ff_captureV2Metrics feature flag is on (default off). Not a fault.'
        : 'rolling perf trace buffer',
    scanActivity: 'up to 30 days — scan events are purged at 30 days',
    groqSummary: groqWindow(s),
    roomMutationSummary: iso(s.roomSince)
      ? `cumulative since ${s.roomSince}`
      : 'cumulative since first observation',
    recordIdentity: s.recordIdentityWindowMs
      ? `last ${Math.round(s.recordIdentityWindowMs / 3_600_000)} hours`
      : 'recent window',
    forensicIntegrity: s.chainLength
      ? `the whole chain (${s.chainLength} records)`
      : 'the whole chain',
    forensicDeliveryStatus: 'current queue state at capture time',
    // The labels match the blocks the copied payload carries, one for one
    // (wiring audit 13 Sep, D2-33): the video, audio and media blocks were
    // described after media left the product on 2026-09-04, while these three
    // blocks went out with no label.
    neutralizerCounters: 'TODAY ONLY (UTC day), reset at day flip; judge-path counters',
    licenseTier: 'the licence tier at capture time',
    forensicDeliveryReadFailed: 'true when the delivery queue could not be read at capture time',
  };

  const saturated: string[] = [];
  if ((s.groqCalls ?? 0) >= GROQ_RING_CAP) saturated.push('groqSummary');

  return {
    capturedAt,
    build: { id: buildId, version, runningSince, history },
    spansMultipleBuilds: spansMultipleBuildsRow(history, dataStart),
    windows,
    saturated,
  };
}


function groqWindow(s: SummaryInputs): string {
  const base = `most recent ${GROQ_RING_CAP} text-AI tries (ring buffer), NOT a daily total; a retried call leaves one entry per try, "calls" counts each call once by how it finally ended, and statusBreakdown counts every try`;
  const first = iso(s.groqFirstTs), last = iso(s.groqLastTs);
  const span = first && last ? ` — this buffer spans ${first} to ${last}` : '';
  const full = (s.groqCalls ?? 0) >= GROQ_RING_CAP ? '. BUFFER IS FULL, so older tries have been dropped' : '';
  return base + span + full;
}

