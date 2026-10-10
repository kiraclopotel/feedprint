// FeelingWise — one-shot forensic record maintenance.
//
// This module repairs the historical position-stripping migration only.
// Signature failures are verification results, not repair triggers: automatic
// re-anchoring would hide the failed signature and is deliberately absent.

import { getRecordsOrThrow, rewriteRecordsInPlace } from './store';
import { computeRecordIntegrityHash } from './canonical-payload';
import type { ForensicRecord } from '../types/forensic';

const HEAL_LOG_KEY = 'fw_chain_heal_log';
const HEAL_LOG_CAP = 20;

export interface HealEvent {
  at: string;
  healed: boolean;
  /**
   * Which repair produced this event. Historical stored logs may contain
   * 'reanchor'; new code emits only 'position-repair' for the relegation position
   * recovery migration (repairRelegatedPositions).
   */
  kind?: 'reanchor' | 'position-repair';
  /** Records relegated to pre-rekey by the heal. */
  reAnchoredCount?: number;
  /** position-repair: demoted entries whose original position was recovered + hash-verified. */
  repairedCount?: number;
  /** position-repair: demoted entries no candidate position matched (left as-is, reported honestly). */
  unrepairedCount?: number;
  /** Failure detail when healed === false. */
  error?: string;
}

/** Read the persisted heal log (newest first). Best-effort. */
export async function readHealLog(): Promise<HealEvent[]> {
  try {
    const stored = await chrome.storage.local.get(HEAL_LOG_KEY);
    const log = stored[HEAL_LOG_KEY];
    return Array.isArray(log) ? (log as HealEvent[]) : [];
  } catch {
    return [];
  }
}

async function appendHealLog(event: HealEvent): Promise<void> {
  try {
    const log = await readHealLog();
    await chrome.storage.local.set({ [HEAL_LOG_KEY]: [event, ...log].slice(0, HEAL_LOG_CAP) });
  } catch (err) {
    console.warn('[FeelingWise] heal-log write failed:', err);
  }
}

// ─── Relegation position repair (one-shot migration) ────────────────────────
//
// The pre-2026-06-11 re-anchor relegated records by SETTING chainPosition to
// undefined. chainPosition is inside the canonical signed payload
// (canonical-payload.ts `?? -1`), so the stripped records' recomputed hashes
// stopped matching their stored integrityHash — the complete-chain export's
// verifier reported them "✗ content does not match its cryptographic
// signature" while the dashboard (which skipped them) stayed green. A
// live store carries ~3.5k such records.
//
// This migration RECOVERS each stripped record's original position by
// solving for it: candidate positions are hashed until the canonical hash
// equals the stored integrityHash. A match identifies the position consistent
// with that stored hash; it does not authenticate an unavailable signature.
// This is restoration of hash-consistent content, not re-signing. Unrecoverable records (no candidate matches within bounds)
// stay as-is and are reported honestly in the heal log.

const REPAIR_STAMP_KEY = 'fw_relegation_repair_done_at';

/**
 * Sweep bound beyond the damaged-set size. Covers chains whose surviving
 * relegated records sit at positions slightly above the set's own count
 * (e.g. a handful of entries pruned from the front). Positions far beyond
 * count+slack (heavy FIFO pruning) stay unrecovered and are reported.
 */
const REPAIR_POSITION_SLACK = 64;

/** Wall-clock cap for the phase-3 fallback sweep (see recoverRelegatedPositions). */
const REPAIR_SWEEP_BUDGET_MS = 10_000;

export interface PositionRecovery {
  /** record.id → recovered (stored-hash-matched) chainPosition. */
  recovered: Map<string, number>;
  /** Records no candidate position matched. */
  unrecoveredIds: string[];
}

/**
 * Pure recovery core (no IDB, no storage): given the position-stripped
 * relegated records, find each one's original chainPosition. Three phases:
 *   1. timestamp-order index guess — an append-only chain is timestamp-
 *      ordered, so the i-th oldest record was almost always at position i;
 *   2. prev-hash link propagation — once any record's position is proven,
 *      the record whose prevRecordHash names its integrityHash is at
 *      position+1 (still hash-verified before acceptance). Handles multiple
 *      relegation generations whose position ranges overlap;
 *   3. bounded sweep (0..count+REPAIR_POSITION_SLACK) for the leftovers,
 *      then one more propagation pass for their link-children.
 * Every accepted position must reproduce the stored integrityHash; a
 * non-matching position is never written. This is not signature authentication.
 */
export async function recoverRelegatedPositions(damaged: ForensicRecord[]): Promise<PositionRecovery> {
  const sorted = [...damaged].sort((a, b) =>
    a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0);
  const recovered = new Map<string, number>();
  const matches = async (r: ForensicRecord, pos: number): Promise<boolean> =>
    (await computeRecordIntegrityHash({ ...r, chainPosition: pos })) === r.integrityHash;

  // Phase 1 — index guess.
  for (let i = 0; i < sorted.length; i++) {
    if (await matches(sorted[i], i)) recovered.set(sorted[i].id, i);
  }

  // Phase 2 — link propagation to fixpoint.
  const byHash = new Map(sorted.map(r => [r.integrityHash, r] as const));
  const propagate = async (): Promise<void> => {
    let progressed = true;
    while (progressed) {
      progressed = false;
      for (const r of sorted) {
        if (recovered.has(r.id) || !r.prevRecordHash) continue;
        const parent = byHash.get(r.prevRecordHash);
        if (!parent || !recovered.has(parent.id)) continue;
        const pos = recovered.get(parent.id)! + 1;
        if (await matches(r, pos)) {
          recovered.set(r.id, pos);
          progressed = true;
        }
      }
    }
  };
  await propagate();

  // Phase 3 — bounded sweep for leftovers, then propagate their children.
  // Wall-clock budget: on a pathological store (heavy pruning → true
  // positions beyond the candidate bound) EVERY leftover would pay a full
  // failed sweep — thousands of records × thousands of hashes blocks the
  // dashboard load for minutes. Phases 1+2 resolve healthy stores in O(1)
  // hashes per record; the sweep is a fallback, so when the budget runs out
  // the remaining leftovers stay unrecovered and are reported honestly
  // (same contract as positions beyond the bound).
  const sweepStart = performance.now();
  const maxCandidate = sorted.length + REPAIR_POSITION_SLACK;
  for (const r of sorted) {
    if (recovered.has(r.id)) continue;
    if (performance.now() - sweepStart > REPAIR_SWEEP_BUDGET_MS) break;
    for (let pos = 0; pos <= maxCandidate; pos++) {
      if (await matches(r, pos)) {
        recovered.set(r.id, pos);
        break;
      }
    }
  }
  await propagate();

  const unrecoveredIds = sorted.filter(r => !recovered.has(r.id)).map(r => r.id);
  return { recovered, unrecoveredIds };
}

export interface RepairOutcome {
  /** False when the one-shot stamp (or unavailable storage) skipped the run. */
  attempted: boolean;
  repairedCount?: number;
  unrepairedCount?: number;
  error?: string;
}

/**
 * One-shot dashboard-load migration (persisted stamp): recover the
 * chainPosition consistent with each stored hash for records the old
 * relegation stripped, write the stored-hash-matched values back (chainAnchor stays
 * 'pre-rekey'), and log the outcome to the heal log. The stamp is written
 * only after a COMPLETED attempt — a thrown failure retries on the next
 * load. Recurrence is impossible going forward: relegation no longer
 * mutates hashed content.
 */
export async function repairRelegatedPositions(): Promise<RepairOutcome> {
  try {
    const stored = await chrome.storage.local.get(REPAIR_STAMP_KEY);
    if (typeof stored[REPAIR_STAMP_KEY] === 'string') return { attempted: false };
  } catch {
    return { attempted: false };
  }

  const now = new Date().toISOString();
  try {
    // Throwing read: a failed read must not stamp the repair as done forever.
    const all = await getRecordsOrThrow();
    const damaged = all.filter(r => r.chainAnchor === 'pre-rekey' && r.chainPosition === undefined);
    if (damaged.length === 0) {
      await chrome.storage.local.set({ [REPAIR_STAMP_KEY]: now });
      return { attempted: true, repairedCount: 0, unrepairedCount: 0 };
    }

    const { recovered, unrecoveredIds } = await recoverRelegatedPositions(damaged);
    // What was WRITTEN, not what was worked out (2026-09-19).
    //
    // rewriteRecordsInPlace returns the number of records its cursor actually
    // updated, and that return was being discarded. The log then reported
    // recovered.size, the count computed as recoverable, and set healed from
    // unrecoveredIds alone. A record pruned or evicted between the read and the
    // write simply does not match the cursor, which is not an error, so the
    // catch below never fired.
    //
    // The stamp was written straight after, and it is what makes this a
    // one-shot: once set, this migration never runs again. So a record whose
    // repair never landed kept its damaged position permanently, under a log
    // line saying it had been healed.
    let written = 0;
    let intended = 0;
    if (recovered.size > 0) {
      const updated = damaged
        .filter(r => recovered.has(r.id))
        .map(r => ({ ...r, chainPosition: recovered.get(r.id) }));
      intended = updated.length;
      written = await rewriteRecordsInPlace(updated);
    }
    const shortfall = intended - written;
    // A one-shot that did not finish is not stamped. Leaving the key unset
    // costs one more pass on the next wake; stamping it costs the records that
    // were missed, for good.
    if (shortfall === 0) await chrome.storage.local.set({ [REPAIR_STAMP_KEY]: now });
    await appendHealLog({
      at: now,
      healed: unrecoveredIds.length === 0 && shortfall === 0,
      kind: 'position-repair',
      repairedCount: written,
      unrepairedCount: unrecoveredIds.length + shortfall,
    });
    return { attempted: true, repairedCount: written, unrepairedCount: unrecoveredIds.length + shortfall };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await appendHealLog({ at: now, healed: false, kind: 'position-repair', error });
    return { attempted: true, error };
  }
}
