// FeelingWise - the one terminal through which a Child provisional cover is
// released.
//
// Every path that gives up a cover names the record that accounts for the
// post and the disposition it wants. The terminal writes the record it owns
// first, then decides per mode whether the cover is released or kept, and only
// then calls the release primitive. Nothing else in src/content calls
// releaseProtection directly (lock: tests/unit/content/protection/settle-protection-single-call-site.test.ts).

/**
 * Who accounts for this post on the chain when its cover settles.
 *
 * - 'verdict': this encounter's verdict record (SCAN_LOG, FORENSIC_LOG or
 *   PASS_LOG) is written by the caller, before or right after the settle.
 * - 'cancel': the caller has already emitted, or dedup-skipped, a CANCEL_LOG
 *   for this encounter.
 * - 'replay': the content was recorded on an earlier encounter; this settle
 *   re-applies or abandons a cached verdict and writes nothing new.
 * - 'batch': the comment flush wrote this comment's record before reaching
 *   its finally. The cap-exhausted and truncated-slot paths inside that flush
 *   still reach here with no record of their own; that is the
 *   PROTECTION-PATH-6 decision the owner has not taken yet.
 * - 'write-cancel': the terminal writes a cancelled-stale CANCEL_LOG itself,
 *   dedup-gated, before releasing.
 * - 'unrecorded-fail-open': today's deliberate fail-open releases that leave
 *   no record (an enqueue the queue refused, a processing rejection). Named
 *   so they can be found; retiring them is PROTECTION-PATH-6.
 */
type ProtectionRecord =
  | 'verdict'
  | 'cancel'
  | 'replay'
  | 'batch'
  | 'write-cancel'
  | 'unrecorded-fail-open';

export interface SettleOutcome {
  record: ProtectionRecord;
  /** Names the site, for the debug trail. */
  reason: string;
  /**
   * 'release' (default): the cover comes off in every mode.
   * 'retain-in-child': a Child cover stays because no safe terminal landed
   * (a hide or rewrite that could not be applied); other modes have no cover
   * and release as usual.
   */
  disposition?: 'release' | 'retain-in-child';
}

export interface SettleProtectionDeps<T> {
  isChildProtectionEnabled: () => boolean;
  releaseProtection: (post: T) => void;
  writeCancelledStaleRecord: (post: T) => void;
  /**
   * A Child cover that stays because the terminal did not land. Called once,
   * on the retain decision, so the cover says the post is hidden instead of
   * saying it is still being checked, and so the 60 second deadline reaper
   * (child-first-protection.ts) does not undo this decision.
   */
  holdProtection: (post: T) => void;
}

const KNOWN_RECORDS: ReadonlySet<string> = new Set<ProtectionRecord>([
  'verdict',
  'cancel',
  'replay',
  'batch',
  'write-cancel',
  'unrecorded-fail-open',
]);

export type SettleResult = 'released' | 'retained' | 'refused';

export function createProtectionSettler<T>(
  deps: SettleProtectionDeps<T>,
): (post: T, outcome: SettleOutcome) => SettleResult {
  return function settleProtection(post: T, outcome: SettleOutcome): SettleResult {
    const child = deps.isChildProtectionEnabled();
    let result: SettleResult = 'released';
    if (!outcome || !KNOWN_RECORDS.has(outcome.record)) {
      // A release that names no record cannot happen in Child: the cover
      // stays up rather than uncovering the post with nothing on the chain.
      // Other modes have no cover, so the release is the harmless no-op.
      if (child) {
        console.error('[FeelingWise] settleProtection refused: no record named', outcome?.reason);
        result = 'refused';
      }
    } else {
      // 1. The record the terminal owns goes first.
      if (outcome.record === 'write-cancel') deps.writeCancelledStaleRecord(post);
      // 2. Per mode: a Child cover with no safe terminal stays up, and is
      //    held: relabelled, and out of the deadline reaper's reach.
      if (child && outcome.disposition === 'retain-in-child') {
        result = 'retained';
        deps.holdProtection(post);
      }
    }
    // 3. The single release.
    if (result === 'released') deps.releaseProtection(post);
    return result;
  };
}
