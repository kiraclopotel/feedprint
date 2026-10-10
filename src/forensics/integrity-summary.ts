// FeelingWise — forensic chain-integrity summarizer (pure).
//
// Turns the IntegrityResult from verifyChainIntegrity (src/forensics/
// chain-integrity.ts) into a debug-tab breakdown: how many records verified,
// how many are signed-by-an-earlier-key / unsigned / pre-chain, whether
// anything is BROKEN, and — crucially — the RIGHT next step for the state
// (verification is read-only; a failed signature is never auto-re-anchored).
//
// The chain (Promise 1) is FW's strongest leg; this makes its health legible
// to a non-coder without re-running the crypto walk.
//
// PURE: takes the already-computed IntegrityResult (the walk is the heavy part;
// the dashboard/panel runs it once) and reduces it. No IDB, no crypto.

import type { IntegrityResult, RecordVerifyStatus, IntegrityFailureKind } from './chain-integrity';
import { recordLinesSplit } from './record-lines';

export interface ForensicIntegritySummary {
  valid: boolean;
  verificationState: IntegrityVerificationState;
  /** Total records that are part of the active chain (chainPosition >= 0). */
  chainLength: number;
  counts: Record<RecordVerifyStatus, number>;
  /**
   * Chain records past the first break that the walker did NOT check (it bails
   * on first failure). 0 for a valid chain. Surfaced so the panel never implies
   * the whole chain was inspected when it wasn't.
   */
  uncheckedAfterBreak: number;
  brokenKind?: IntegrityFailureKind;
  reason?: string;
  /** One-line plain-English next step for this state. */
  remediation: string;
}

const ZERO_COUNTS = (): Record<RecordVerifyStatus, number> => ({
  verified: 0, unsigned: 0, 'prior-key': 0, broken: 0, 'pre-rekey': 0, 'pre-chain': 0,
});

export type IntegrityVerificationState = 'verified' | 'partial' | 'failed';

export function integrityVerificationState(result: IntegrityResult): IntegrityVerificationState {
  if (!result.valid) return 'failed';
  // A row that did not decode was never checked, so the record cannot read as verified.
  if ((result.damagedCount ?? 0) > 0) return 'partial';
  // Every part can be sound while the whole record holds a line it did not keep, and an exported
  // file's checker reads that as partly verified; the screen says what the file will say.
  if (recordLinesSplit(result.recordLines)) return 'partial';
  if (!result.perRecord) return result.chainLength === 0 ? 'verified' : 'partial';
  for (const status of result.perRecord.values()) {
    if (status !== 'verified') return 'partial';
  }
  return 'verified';
}

export function unverifiedRecordCount(result: IntegrityResult): number {
  if (!result.perRecord) return result.chainLength > 0 && result.valid ? result.chainLength : 0;
  let count = result.damagedCount ?? 0;
  for (const status of result.perRecord.values()) {
    if (status !== 'verified' && status !== 'broken') count++;
  }
  return count;
}

function remediationFor(
  state: IntegrityVerificationState,
  unverified: number,
  kind?: IntegrityFailureKind,
  lines?: IntegrityResult['recordLines'],
): string {
  if (state === 'verified') return 'Chain verified — every inspected record’s signature checks out.';
  if (state === 'partial' && unverified === 0 && recordLinesSplit(lines)) {
    return 'Every inspected signature verified, but the whole record holds entries on a line it did not keep, as a restore from a backup leaves. An export of the whole record reads partly verified for the same reason.';
  }
  if (state === 'partial') {
    return `Stored hashes and chain links are internally consistent, but ${unverified} record signature${unverified === 1 ? ' was' : 's were'} not verified. Treat those records as unverified until their signing keys are available.`;
  }
  switch (kind) {
    case 'tampered':
      return 'A record no longer matches its stored cryptographic hash. It may have changed after hashing, or the stored file may be damaged. Re-anchoring cannot repair this mismatch; restore from a clean backup if you have one.';
    case 'key-mismatch':
      return 'A record signature did not verify under the current key. Its stored hash recomputes, but that alone does not authenticate it. Treat the record as unverified and restore from a trusted backup if available; re-anchoring cannot verify this signature.';
    case 'position-mismatch':
    case 'chain-link-mismatch':
      return 'A record appears deleted or reordered upstream of this point. Restore from a backup if you have one; otherwise the chain is broken from here onward.';
    default:
      return 'Chain reports a problem but no category — re-run verification; if it persists, restore from a backup.';
  }
}

/**
 * Reduce an IntegrityResult to a per-status breakdown + remediation. Pure.
 */
export function summarizeForensicIntegrity(result: IntegrityResult): ForensicIntegritySummary {
  const counts = ZERO_COUNTS();
  if (result.perRecord) {
    for (const status of result.perRecord.values()) counts[status]++;
  }

  // Chain records the walker actually inspected = verified + unsigned +
  // prior-key + broken. (pre-rekey / pre-chain are non-chain.) Anything in
  // chainLength beyond that is the un-walked tail after a break.
  const inspectedChain = counts.verified + counts.unsigned + counts['prior-key'] + counts.broken;
  const uncheckedAfterBreak = result.valid ? 0 : Math.max(0, result.chainLength - inspectedChain);
  const verificationState = integrityVerificationState(result);
  const unverified = unverifiedRecordCount(result);

  return {
    valid: result.valid,
    verificationState,
    chainLength: result.chainLength,
    counts,
    uncheckedAfterBreak,
    brokenKind: result.brokenKind,
    reason: result.reason,
    remediation: remediationFor(verificationState, unverified, result.brokenKind, result.recordLines),
  };
}
