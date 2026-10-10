// One service-worker-realm pump drains the durable forensic delivery outbox.
// It processes FIFO and stops at the first persistence failure so a broken
// head remains visible instead of letting later observations overtake it.

import {
  getNextForensicDelivery,
  markForensicDeliveryFailure,
  FORENSIC_DELIVERY_ATTEMPT_CEILING,
  type ForensicDeliveryEntry,
} from './delivery-outbox';
import {
  logBlockedEvent,
  logSkippedEvent,
  logCancelEvent,
  logEnvironmentEvent,
  logForensicEvent,
  logPassEvent,
  type BlockedEventInput,
  type CancelEventInput,
  type EnvironmentLogInput,
  type ForensicEventInput,
  type PassEventInput,
  type SkippedEventInput,
} from './logger';
import { appendGapMarker, isGapMarkerInput } from './gap-marker';
import type { GapMarkerInput } from '../types/gap-marker';

let drainPromise: Promise<void> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

async function dispatch(entry: ForensicDeliveryEntry): Promise<void> {
  switch (entry.type) {
    case 'FORENSIC_LOG':
      return logForensicEvent(entry.payload as ForensicEventInput, entry.deliveryId, entry.enqueuedAt, entry.disposition);
    case 'PASS_LOG':
      return logPassEvent(entry.payload as PassEventInput, entry.deliveryId, entry.enqueuedAt, entry.disposition);
    case 'ENVIRONMENT_LOG':
      return logEnvironmentEvent(entry.payload as EnvironmentLogInput, entry.deliveryId, entry.enqueuedAt, entry.disposition);
    case 'CANCEL_LOG':
      return logCancelEvent(entry.payload as CancelEventInput, entry.deliveryId, entry.enqueuedAt, entry.disposition);
    case 'SKIPPED_LOG':
      return logSkippedEvent(entry.payload as SkippedEventInput, entry.deliveryId, entry.enqueuedAt, entry.disposition);
    case 'BLOCKED_LOG':
      return logBlockedEvent(entry.payload as BlockedEventInput, entry.deliveryId, entry.enqueuedAt, entry.disposition);
    case 'GAP_LOG':
      if (!isGapMarkerInput(entry.payload)) throw new Error('GAP_LOG payload is not a gap marker');
      return appendGapMarker(entry.payload, entry.deliveryId);
  }
}

function scheduleRetry(delayMs: number): void {
  if (retryTimer !== null) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void kickForensicDeliveryPump();
  }, Math.max(0, delayMs));
}

async function drain(): Promise<void> {
  while (true) {
    const entry = await getNextForensicDelivery();
    if (!entry) return;

    if (entry.nextAttemptAt) {
      const delayMs = Date.parse(entry.nextAttemptAt) - Date.now();
      if (delayMs > 0) {
        scheduleRetry(delayMs);
        return;
      }
    }

    try {
      await dispatch(entry);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failedAt = new Date().toISOString();
      let outcome: 'retrying' | 'quarantined' | 'missing' = 'retrying';
      try {
        outcome = await markForensicDeliveryFailure(entry.deliveryId, message, failedAt);
      } catch (ledgerError) {
        console.error('[FeelingWise] Could not update forensic outbox failure metadata:', ledgerError);
      }
      // Q77 (W68): a quarantined head is loud but no longer a roadblock -
      // keep draining so every record behind it still commits. Retrying
      // rows keep the old stop-at-head discipline.
      if (outcome === 'quarantined') {
        console.error(
          `[FeelingWise] forensic delivery ${entry.deliveryId} (${entry.type}) quarantined after `
          + `${FORENSIC_DELIVERY_ATTEMPT_CEILING} attempts - the row is held in the outbox as evidence `
          + `and shown on the dashboard Issues tab. Last error: ${message}`,
        );
        // Register item 9: the chain itself says a record was lost here. The
        // outbox row is evidence the export never reads; the marker is on the
        // chain. A quarantined gap marker writes no marker about itself.
        if (entry.type !== 'GAP_LOG') {
          try {
            await appendGapMarker({
              reason: 'delivery-quarantined',
              platform: deliveryPlatform(entry),
              count: 1,
              unit: 'records',
              fromISO: entry.enqueuedAt,
              toISO: failedAt,
            });
          } catch (markerError) {
            console.error('[FeelingWise] gap marker for the quarantined delivery could not be written:', markerError);
          }
        }
        continue;
      }
      scheduleRetry(4_000);
      return;
    }
  }
}

const PLATFORMS: ReadonlySet<string> = new Set(['twitter', 'instagram', 'tiktok', 'facebook', 'youtube']);

function deliveryPlatform(entry: ForensicDeliveryEntry): GapMarkerInput['platform'] {
  const p = (entry.payload as { platform?: unknown } | null)?.platform;
  return typeof p === 'string' && PLATFORMS.has(p) ? (p as GapMarkerInput['platform']) : 'unknown';
}

export function kickForensicDeliveryPump(): Promise<void> {
  if (drainPromise) return drainPromise;
  const run = drain().catch(error => {
    console.error('[FeelingWise] Could not read/drain forensic delivery outbox:', error);
    scheduleRetry(4_000);
  });
  drainPromise = run.finally(() => {
    drainPromise = null;
  });
  return drainPromise;
}

export function _resetForensicDeliveryPumpForTesting(): void {
  if (retryTimer !== null) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  drainPromise = null;
}
