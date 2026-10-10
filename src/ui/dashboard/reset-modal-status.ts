// Status line + outcome classification for the reset-chain PIN modal.
//
// Wrong PIN and a failed reset are different failures: the first means
// "re-enter", the second means "the PIN was right but the wipe itself
// errored". Conflating them told a parent with the correct PIN that the PIN
// was wrong (known-issues M40). Three further truth rules (known-issues M58):
// a lost response channel means the outcome is UNKNOWN, not failed; a reset
// whose marker cutover succeeded but whose auxiliary wipes did not is
// PARTIAL, not a clean success; and the modal must say which parts lagged.
// Pure module so the mapping is unit-testable under the node test env
// (no @testing-library, project convention).

// 'wrong-word' is the no-PIN install's equivalent of 'wrong-pin': where no PIN
// exists the reset is confirmed by typing the product's own word (14 Sep 2026).
export type ResetModalError = null | 'wrong-pin' | 'wrong-word' | 'reset-failed' | 'reset-unknown' | 'reset-refused';

export function resetModalStatusLine(
  error: ResetModalError,
  busy: boolean,
  t: { wrongPin: string; resetWordWrong: string; resetFailed: string; resetUnknown: string; resetting: string; resetRefused: string },
): string {
  if (error === 'wrong-pin') return t.wrongPin;
  if (error === 'wrong-word') return t.resetWordWrong;
  // Refused is not failed: the distinction the reader needs is that their
  // record is still there (2026-09-19).
  if (error === 'reset-refused') return t.resetRefused;
  if (error === 'reset-failed') return t.resetFailed;
  if (error === 'reset-unknown') return t.resetUnknown;
  return busy ? t.resetting : '';
}

/**
 * The auxiliary flags of ResetChainResult (structural subset so this module
 * stays free of the store's import graph). resetMarkerWritten is not here:
 * marker/cutover failure rejects the reset and never reaches this path.
 */
export interface ResetCleanupFlags {
  scanLogCleared: boolean;
  authorProfilesCleared: boolean;
  verdictsCleared: boolean;
  diagnosticsCleared: boolean;
  usageStatsCleared: boolean;
  parentFeedbackCleared: boolean;
  chainAnchorsCleared: boolean;
}

export type ResetPartKey = keyof ResetCleanupFlags;

const RESET_PART_KEYS: readonly ResetPartKey[] = [
  'scanLogCleared',
  'authorProfilesCleared',
  'verdictsCleared',
  'diagnosticsCleared',
  'usageStatsCleared',
  'parentFeedbackCleared',
  'chainAnchorsCleared',
] as const;

/**
 * Names every auxiliary wipe that did NOT complete, as stable flag keys —
 * NOT display text. This module stays locale-agnostic (same convention as
 * `resetModalStatusLine`, which takes a `t` parameter rather than owning
 * English prose); the render site maps each key to a localized
 * `t.resetPart*` string via `resetPartLabel()` below.
 *
 * DASH-4 (2026-07-13 dashboard-ui audit): this used to return a fixed
 * `Record<keyof ResetCleanupFlags, string>` of hardcoded English names
 * (`CLEANUP_PART_NAMES`), which rode unlocalized into the otherwise-
 * translated partial-reset sentence — an RO-locale parent saw a Romanian
 * sentence followed by English words in parentheses.
 *
 * Empty array = the reset is a clean full success; non-empty = the chain
 * itself was reset (marker written) but the named sidecars still hold
 * pre-reset rows.
 */
export function incompleteResetParts(flags: ResetCleanupFlags): ResetPartKey[] {
  return RESET_PART_KEYS.filter((k) => flags[k] !== true);
}

/** Minimal locale shape for cleanup-part display names, kept separate from
 *  the full `DashboardStrings` import so this module stays pure/testable
 *  with a plain fake object (mirrors `resetModalStatusLine`'s `t` param). */
export interface ResetPartLabels {
  resetPartScanLog: string;
  resetPartAuthorProfiles: string;
  resetPartVerdicts: string;
  resetPartDiagnostics: string;
  resetPartUsageCounters: string;
  resetPartParentFeedback: string;
  resetPartChainAnchors: string;
}

const RESET_PART_LABEL_KEY: Record<ResetPartKey, keyof ResetPartLabels> = {
  scanLogCleared: 'resetPartScanLog',
  authorProfilesCleared: 'resetPartAuthorProfiles',
  verdictsCleared: 'resetPartVerdicts',
  diagnosticsCleared: 'resetPartDiagnostics',
  usageStatsCleared: 'resetPartUsageCounters',
  parentFeedbackCleared: 'resetPartParentFeedback',
  chainAnchorsCleared: 'resetPartChainAnchors',
};

/** Localize one incomplete-cleanup-part key through the dashboard's `t` table. */
export function resetPartLabel(key: ResetPartKey, t: ResetPartLabels): string {
  return t[RESET_PART_LABEL_KEY[key]];
}
