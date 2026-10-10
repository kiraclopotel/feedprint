// Durable service-worker-owned ingress for retained forensic observations.
// The outbox lives beside the chain so signing/storage outages survive tab
// close and MV3 worker eviction. A delivery receipt keeps replay idempotent
// after the outbox row is consumed.

import {
  FORENSIC_DELIVERY_OUTBOX_STORE,
  FORENSIC_DELIVERY_RECEIPTS_STORE,
  FORENSIC_DELIVERY_META_STORE,
  openDB,
} from './store';

export type ForensicDeliveryType =
  | 'FORENSIC_LOG'
  | 'PASS_LOG'
  | 'ENVIRONMENT_LOG'
  | 'CANCEL_LOG'
  | 'BLOCKED_LOG'
  | 'SKIPPED_LOG'
  | 'GAP_LOG';

export type ForensicDeliveryDisposition = 'late-after-rotation';

export interface ForensicDeliveryEntry {
  /** IDB-assigned insertion order; the primary key and FIFO authority. */
  queueSequence?: number;
  deliveryId: string;
  type: ForensicDeliveryType;
  payload: object;
  enqueuedAt: string;
  disposition?: ForensicDeliveryDisposition;
  attempts: number;
  firstFailureAt?: string;
  lastFailureAt?: string;
  lastError?: string;
  nextAttemptAt?: string;
  /**
   * Q77 (W68): set when attempts reach FORENSIC_DELIVERY_ATTEMPT_CEILING.
   * A quarantined row is KEPT in the outbox as evidence (never deleted,
   * VISION 1.1 - quarantine is loud, not silent) but the pump skips it so
   * one deterministically failing payload cannot freeze every later
   * record, and rotation counts only non-quarantined rows.
   */
  quarantinedAt?: string;
}

interface ForensicDeliveryReceipt {
  deliveryId: string;
  status: 'committed' | 'discarded-reset' | 'discarded-restore';
  finalizedAt: string;
  recordId?: string;
}

export interface ForensicDeliveryStatus {
  /** Non-quarantined rows still awaiting commit. */
  pendingCount: number;
  failedCount: number;
  /** Q77: rows held after the attempt ceiling; surfaced on the Issues tab. */
  quarantinedCount: number;
  discardedRestoreCount: number;
  firstEnqueuedAt?: string;
  firstFailureAt?: string;
  lastFailureAt?: string;
  lastError?: string;
  byType: Partial<Record<ForensicDeliveryType, number>>;
}

const FAILURE_BACKOFF_MS = [4_000, 30_000, 5 * 60_000] as const;
/** Q77 (W68): after this many failed attempts a row is quarantined. Eight
 *  attempts spans transient outages (4s/30s/5min backoff) while bounding
 *  how long a deterministic failure can hold the queue head. */
export const FORENSIC_DELIVERY_ATTEMPT_CEILING = 8;
const FORENSIC_DELIVERY_RECEIPT_CAP = 10_000;
const FORENSIC_DELIVERY_RECEIPT_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;

function capturedAtOrBefore(capturedAt: string, cutoffAt?: string): boolean {
  if (!cutoffAt) return false;
  const cutoffMs = Date.parse(cutoffAt);
  return Number.isFinite(cutoffMs) && Date.parse(capturedAt) <= cutoffMs;
}

export async function enqueueForensicDelivery(
  delivery: Omit<ForensicDeliveryEntry, 'attempts' | 'queueSequence'>,
): Promise<{ state: 'pending' | 'committed' | 'discarded' }> {
  if (!Number.isFinite(Date.parse(delivery.enqueuedAt))) {
    throw new Error('invalid forensic capture timestamp');
  }
  const db = await openDB();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(
        [
          FORENSIC_DELIVERY_OUTBOX_STORE,
          FORENSIC_DELIVERY_RECEIPTS_STORE,
          FORENSIC_DELIVERY_META_STORE,
        ],
        'readwrite',
      );
      const outbox = tx.objectStore(FORENSIC_DELIVERY_OUTBOX_STORE);
      const receipts = tx.objectStore(FORENSIC_DELIVERY_RECEIPTS_STORE);
      const meta = tx.objectStore(FORENSIC_DELIVERY_META_STORE);
      let state: 'pending' | 'committed' | 'discarded' = 'pending';

      const receiptReq = receipts.get(delivery.deliveryId);
      receiptReq.onsuccess = () => {
        const receipt = receiptReq.result as ForensicDeliveryReceipt | undefined;
        if (receipt) {
          state = receipt.status === 'committed' ? 'committed' : 'discarded';
          return;
        }
        const destructiveReq = meta.get('destructiveCutoff');
        destructiveReq.onsuccess = () => {
          const cutoff = destructiveReq.result as {
            capturedAt?: string;
            kind?: 'reset' | 'restore';
          } | undefined;
          if (capturedAtOrBefore(delivery.enqueuedAt, cutoff?.capturedAt)) {
            state = 'discarded';
            receipts.add({
              deliveryId: delivery.deliveryId,
              status: cutoff?.kind === 'restore' ? 'discarded-restore' : 'discarded-reset',
              finalizedAt: new Date().toISOString(),
            } satisfies ForensicDeliveryReceipt);
            return;
          }
          const rotationReq = meta.get('rotationCutoff');
          rotationReq.onsuccess = () => {
            const rotation = rotationReq.result as { capturedAt?: string } | undefined;
            const queuedDelivery = capturedAtOrBefore(delivery.enqueuedAt, rotation?.capturedAt)
              ? { ...delivery, disposition: 'late-after-rotation' as const }
              : delivery;
            const existingReq = outbox.index('deliveryId').get(delivery.deliveryId);
            existingReq.onsuccess = () => {
              if (!existingReq.result) outbox.add({ ...queuedDelivery, attempts: 0 });
            };
          };
        };
      };

      tx.oncomplete = () => resolve({ state });
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('forensic delivery enqueue aborted'));
    });
  } finally {
    db.close();
  }
}

export async function getNextForensicDelivery(): Promise<ForensicDeliveryEntry | null> {
  const db = await openDB();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(FORENSIC_DELIVERY_OUTBOX_STORE, 'readonly');
      // queueSequence is the auto-increment primary key. Unlike an ISO
      // timestamp index it preserves arrival order when several observations
      // share the same millisecond.
      const req = tx.objectStore(FORENSIC_DELIVERY_OUTBOX_STORE).openCursor(null, 'next');
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) { resolve(null); return; }
        const entry = cursor.value as ForensicDeliveryEntry;
        // Q77 (W68): quarantined rows are evidence, not work. Walk past
        // them so one poisoned head cannot freeze the chain.
        if (entry.quarantinedAt) { cursor.continue(); return; }
        resolve(entry);
      };
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export async function getForensicDeliveryReceiptState(
  deliveryId: string,
): Promise<'committed' | 'discarded' | null> {
  const db = await openDB();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(FORENSIC_DELIVERY_RECEIPTS_STORE, 'readonly');
      const req = tx.objectStore(FORENSIC_DELIVERY_RECEIPTS_STORE).get(deliveryId);
      req.onsuccess = () => {
        const receipt = req.result as ForensicDeliveryReceipt | undefined;
        resolve(receipt
          ? receipt.status === 'committed' ? 'committed' : 'discarded'
          : null);
      };
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export async function markForensicDeliveryFailure(
  deliveryId: string,
  error: string,
  failedAt: string = new Date().toISOString(),
): Promise<'retrying' | 'quarantined' | 'missing'> {
  const db = await openDB();
  try {
    return await new Promise<'retrying' | 'quarantined' | 'missing'>((resolve, reject) => {
      const tx = db.transaction(FORENSIC_DELIVERY_OUTBOX_STORE, 'readwrite');
      const store = tx.objectStore(FORENSIC_DELIVERY_OUTBOX_STORE);
      let outcome: 'retrying' | 'quarantined' | 'missing' = 'missing';
      const req = store.index('deliveryId').get(deliveryId);
      req.onsuccess = () => {
        const current = req.result as ForensicDeliveryEntry | undefined;
        if (!current) return;
        const attempts = current.attempts + 1;
        // Q77 (W68): the ceiling. The row is KEPT (evidence, never
        // deleted); quarantinedAt makes the pump and rotation skip it.
        if (attempts >= FORENSIC_DELIVERY_ATTEMPT_CEILING) {
          outcome = 'quarantined';
          store.put({
            ...current,
            attempts,
            firstFailureAt: current.firstFailureAt ?? failedAt,
            lastFailureAt: failedAt,
            lastError: error,
            nextAttemptAt: undefined,
            quarantinedAt: failedAt,
          });
          return;
        }
        outcome = 'retrying';
        const backoffMs = FAILURE_BACKOFF_MS[Math.min(attempts - 1, FAILURE_BACKOFF_MS.length - 1)];
        store.put({
          ...current,
          attempts,
          firstFailureAt: current.firstFailureAt ?? failedAt,
          lastFailureAt: failedAt,
          lastError: error,
          nextAttemptAt: new Date(Date.parse(failedAt) + backoffMs).toISOString(),
        });
      };
      tx.oncomplete = () => resolve(outcome);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('forensic delivery failure update aborted'));
    });
  } finally {
    db.close();
  }
}

export async function getForensicDeliveryStatus(): Promise<ForensicDeliveryStatus> {
  const db = await openDB();
  try {
    const [entries, receipts] = await new Promise<[
      ForensicDeliveryEntry[],
      ForensicDeliveryReceipt[],
    ]>((resolve, reject) => {
      const tx = db.transaction(
        [FORENSIC_DELIVERY_OUTBOX_STORE, FORENSIC_DELIVERY_RECEIPTS_STORE],
        'readonly',
      );
      const outboxReq = tx.objectStore(FORENSIC_DELIVERY_OUTBOX_STORE).getAll();
      const receiptsReq = tx.objectStore(FORENSIC_DELIVERY_RECEIPTS_STORE).getAll();
      let outboxRows: ForensicDeliveryEntry[] = [];
      let receiptRows: ForensicDeliveryReceipt[] = [];
      outboxReq.onsuccess = () => { outboxRows = outboxReq.result as ForensicDeliveryEntry[]; };
      receiptsReq.onsuccess = () => { receiptRows = receiptsReq.result as ForensicDeliveryReceipt[]; };
      tx.oncomplete = () => resolve([outboxRows, receiptRows]);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('delivery status read aborted'));
    });
    const sorted = [...entries].sort((a, b) =>
      (a.queueSequence ?? Number.MAX_SAFE_INTEGER) - (b.queueSequence ?? Number.MAX_SAFE_INTEGER)
      || a.enqueuedAt.localeCompare(b.enqueuedAt));
    // Q77 (W68): quarantined rows are held evidence, not pending work -
    // pendingCount excludes them so the rotation gate unblocks; they get
    // their own count for the Issues-tab card.
    const active = sorted.filter(entry => !entry.quarantinedAt);
    const quarantined = sorted.filter(entry => Boolean(entry.quarantinedAt));
    const failed = sorted.filter(entry => entry.attempts > 0);
    const byType: ForensicDeliveryStatus['byType'] = {};
    for (const entry of sorted) byType[entry.type] = (byType[entry.type] ?? 0) + 1;
    return {
      pendingCount: active.length,
      failedCount: failed.length,
      quarantinedCount: quarantined.length,
      discardedRestoreCount: receipts.filter(receipt => receipt.status === 'discarded-restore').length,
      firstEnqueuedAt: sorted[0]?.enqueuedAt,
      firstFailureAt: failed
        .map(entry => entry.firstFailureAt)
        .filter((value): value is string => Boolean(value))
        .sort()[0],
      lastFailureAt: failed
        .map(entry => entry.lastFailureAt)
        .filter((value): value is string => Boolean(value))
        .sort()
        .at(-1),
      lastError: [...failed]
        .sort((a, b) => (b.lastFailureAt ?? '').localeCompare(a.lastFailureAt ?? ''))[0]
        ?.lastError,
      byType,
    };
  } finally {
    db.close();
  }
}

/**
 * Bound the lost-ACK ledger. Content fallback retries finish within seconds;
 * seven days is deliberately generous, while the hard cap prevents high-
 * volume installs from defeating the records-store storage ceiling.
 */
export async function pruneForensicDeliveryReceipts(
  nowMs: number = Date.now(),
  cap: number = FORENSIC_DELIVERY_RECEIPT_CAP,
  retentionMs: number = FORENSIC_DELIVERY_RECEIPT_RETENTION_MS,
): Promise<number> {
  const db = await openDB();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(FORENSIC_DELIVERY_RECEIPTS_STORE, 'readwrite');
      const store = tx.objectStore(FORENSIC_DELIVERY_RECEIPTS_STORE);
      const req = store.getAll();
      let deleted = 0;
      req.onsuccess = () => {
        const cutoffMs = nowMs - retentionMs;
        const entries = (req.result as ForensicDeliveryReceipt[])
          .map(receipt => ({ receipt, finalizedMs: Date.parse(receipt.finalizedAt) }))
          .sort((a, b) => a.finalizedMs - b.finalizedMs);
        const expired = entries.filter(entry =>
          !Number.isFinite(entry.finalizedMs) || entry.finalizedMs < cutoffMs);
        const retained = entries.filter(entry =>
          Number.isFinite(entry.finalizedMs) && entry.finalizedMs >= cutoffMs);
        const overflow = retained.slice(0, Math.max(0, retained.length - Math.max(0, cap)));
        const ids = new Set([...expired, ...overflow].map(entry => entry.receipt.deliveryId));
        for (const deliveryId of ids) store.delete(deliveryId);
        deleted = ids.size;
      };
      tx.oncomplete = () => resolve(deleted);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('delivery receipt prune aborted'));
    });
  } finally {
    db.close();
  }
}
