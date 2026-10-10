// ─── Forensic-record retry buffer ────────────────────────────────────────────
// Every served-sequence record route (flagged, blocked, pass, cancel, and
// environment) awaits the SW acknowledgement here. An explicit { ok: false }
// means durable SW enqueue was not confirmed, so the exact message enters a
// bounded retry buffer. Signing/storage retries then belong to the SW outbox.
// Protection never waits; content retries run in the background.
//
// One injected content-script realm owns one buffer + one in-flight flush.

import { isContextAlive, safeSendMessage } from '../../storage/context-guard';
import { bumpCounter, flushDiagnosticsNow } from '../../diagnostics/diagnostics';
import { noteGap } from './gap-ledger';
import { getBuildId } from '../../core/build-id';

const FORENSIC_RETRY_BUFFER_MAX = 20;
const FORENSIC_RETRY_FLUSH_MS = 4000;
const FORENSIC_RETRY_MAX_SENDS = 3;

interface ForensicRetryEntry {
  message: ForensicRecordMessage;
  failedSends: number;
}

const forensicRetryBuffer: ForensicRetryEntry[] = [];
let forensicRetryTimer: number | null = null;
let forensicRetryFlush: Promise<void> | null = null;

// The log callsites build payloads from spreads + adapter-derived
// fields whose static types are wider than `ForensicLogPayload` (e.g. `kind`
// is the adapter's `NodeKind`; `analysis` is assembled in pieces). The SW
// handler + `logForensicEvent` accept this at runtime — `safeSendMessage` took
// `unknown` so the old `void safeSendMessage(...)` callsites compiled. Mirror
// that loose boundary so the migration is name-only and the canonical payload
// shape is byte-for-byte unchanged (forensic hash stability). The payload is
// stored opaquely (it is re-sent verbatim, never re-read field-by-field).
type ForensicRetryPayload = object;
interface ForensicRecordMessage {
  type: 'FORENSIC_LOG' | 'BLOCKED_LOG' | 'PASS_LOG' | 'CANCEL_LOG' | 'ENVIRONMENT_LOG' | 'SKIPPED_LOG';
  payload: ForensicRetryPayload;
  deliveryId?: string;
  deliveryCapturedAt?: string;
}

export type ForensicSendDisposition = 'accepted' | 'retry-buffered' | 'context-lost';

let fallbackDeliverySequence = 0;

/**
 * Add this content script's build id to a record payload. An unbaked bundle
 * (vitest, node harness) has no id, and then nothing is added — canonical-
 * payload omits an undefined key, so those records hash exactly as before.
 * A payload that already carries one is left alone.
 */
function withBuildId(payload: ForensicRetryPayload): ForensicRetryPayload {
  const id = getBuildId();
  if (!id) return payload;
  if ((payload as { buildId?: unknown }).buildId) return payload;
  return { ...payload, buildId: id };
}

function createDeliveryId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `fd-${crypto.randomUUID()}`;
  }
  fallbackDeliverySequence++;
  return `fd-${Date.now()}-${fallbackDeliverySequence}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Send a retained-record message and recover from a persistence failure.
 * Awaits the SW response. On failed or ambiguous durable enqueue, the message
 * enters a bounded buffer.
 * and a flush timer is armed. Returns whether the service worker accepted the
 * durable enqueue, the content fallback retained it, or the extension context
 * was already gone. Most callers stay fire-and-forget; outcome-sensitive paths
 * may await the status. Replay keeps the original service-worker route.
 */
export async function sendHighStakesForensicLog(
  message: ForensicRecordMessage,
): Promise<ForensicSendDisposition> {
  // Off never reaches this path: the filter hands a blocked item to a sink the entry point
  // installs, and Off installs none (engagement/recorder-sink.ts, PLAN-2026-09-16 item 9.2). The
  // branch that used to answer 'accepted' here is gone with the question.
  // Stamp the JUDGING build on every record route, here and nowhere else: this
  // is the one door all six of them pass through. The id must come from the
  // content script, not the service worker — the worker is always the current
  // build, while this tab may be running an orphaned older one (src/core/
  // build-id.ts). A replayed message keeps the id it was stamped with.
  const stamped: ForensicRecordMessage = message.deliveryId
    ? message
    : { ...message, payload: withBuildId(message.payload) };
  const deliveryMessage: ForensicRecordMessage = stamped.deliveryId
    ? stamped
    : {
        ...stamped,
        deliveryId: createDeliveryId(),
        deliveryCapturedAt: new Date().toISOString(),
      };
  const resp = await safeSendMessage(deliveryMessage);
  // undefined is ambiguous: it can mean a dead extension context OR a live
  // context whose response channel/transport failed. Stable IDs make replay
  // safe, so retain the latter and drop only after confirmed invalidation.
  const explicitFailure = resp && typeof resp === 'object'
    && (resp as { ok?: boolean }).ok === false;
  if (explicitFailure || (resp === undefined && isContextAlive())) {
    pushForensicRetry({ message: deliveryMessage, failedSends: 1 });
    return 'retry-buffered';
  }
  return resp === undefined ? 'context-lost' : 'accepted';
}

function isHighStakes(message: ForensicRecordMessage): boolean {
  return message.type === 'FORENSIC_LOG' || message.type === 'BLOCKED_LOG';
}

function recordRetryLoss(reason: 'Overflow' | 'Exhausted'): void {
  bumpCounter(`forensicRetry${reason}`);
  // Register item 9: the counter is unsigned and day-scoped; the ledger
  // turns the same loss into a signed gap marker on the chain.
  noteGap(reason === 'Overflow' ? 'retry-overflow' : 'retry-exhausted', 1, 'records');
}

function pushForensicRetry(entry: ForensicRetryEntry, schedule = true): void {
  if (forensicRetryBuffer.length >= FORENSIC_RETRY_BUFFER_MAX) {
    const firstLowerPriority = forensicRetryBuffer.findIndex(
      (candidate) => !isHighStakes(candidate.message),
    );
    if (!isHighStakes(entry.message) && firstLowerPriority < 0) {
      recordRetryLoss('Overflow');
      return;
    }
    const dropIndex = firstLowerPriority >= 0 ? firstLowerPriority : 0;
    forensicRetryBuffer.splice(dropIndex, 1);
    recordRetryLoss('Overflow');
  }
  forensicRetryBuffer.push(entry);
  if (schedule) scheduleForensicRetryFlush();
}

function scheduleForensicRetryFlush(): void {
  if (forensicRetryTimer !== null) return;
  if (forensicRetryFlush !== null) return;
  if (typeof setTimeout === 'undefined') return;
  forensicRetryTimer = setTimeout(() => {
    forensicRetryTimer = null;
    void flushForensicRetryBuffer();
  }, FORENSIC_RETRY_FLUSH_MS) as unknown as number;
}

/**
 * Re-send every buffered message. Only one flush may run at a time; failures
 * remain buffered and arm one later flush after the current pass finishes.
 */
async function flushForensicRetryBuffer(): Promise<void> {
  if (forensicRetryFlush) return forensicRetryFlush;
  const run = (async () => {
    if (forensicRetryBuffer.length === 0) return;
    const pending = forensicRetryBuffer.splice(0, forensicRetryBuffer.length);
    for (const entry of pending) {
      const resp = await safeSendMessage(entry.message);
      const explicitFailure = resp && typeof resp === 'object'
        && (resp as { ok?: boolean }).ok === false;
      if (explicitFailure || (resp === undefined && isContextAlive())) {
        const failedSends = entry.failedSends + 1;
        if (failedSends >= FORENSIC_RETRY_MAX_SENDS) {
          recordRetryLoss('Exhausted');
        } else {
          pushForensicRetry({ ...entry, failedSends }, false);
        }
      }
    }
  })();
  forensicRetryFlush = run;
  try {
    await run;
  } finally {
    forensicRetryFlush = null;
    if (forensicRetryBuffer.length > 0) scheduleForensicRetryFlush();
  }
}

// ─── Unload flush ────────────────────────────────────────────────────────────
// What is in this buffer is exactly what the service worker's durable outbox
// does NOT have. The buffer is only ever fed from two conditions:
//
//   • an explicit `{ ok: false }` — the SW's only reachable failure path is
//     `enqueueForensicDelivery` rejecting, i.e. the IDB transaction aborted, so
//     nothing was written to the outbox; and
//   • an `undefined` response while the context is alive — the SW may have
//     enqueued before the response channel died, or may never have received
//     the message at all. Unresolvable from here.
//
// So the outbox rescues only one half of the second case. Everything else in
// this array is the only copy that exists, and it lives in page memory with a
// 4s timer. A hard navigation inside that window took the record with it.
//
// The flush re-sends without awaiting: at pagehide an awaited round trip never
// resolves. Replay is idempotent — the SW keys the outbox and its receipts by
// `deliveryId` — so a duplicate arriving after a successful first send is
// dropped, and entries are deliberately NOT spliced out here: if the page is
// only entering bfcache, the normal timer must still own them.
let unloadFlushInstalled = false;

export function installForensicRetryUnloadFlush(): void {
  if (unloadFlushInstalled) return;
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
  unloadFlushInstalled = true;
  window.addEventListener('pagehide', flushForensicRetryOnUnload);
}

function flushForensicRetryOnUnload(): void {
  if (forensicRetryBuffer.length === 0) return;
  const pending = [...forensicRetryBuffer];
  const highStakes = pending.filter((entry) => isHighStakes(entry.message)).length;

  if (!isContextAlive()) {
    // The extension was reloaded out from under this tab. Nothing can be sent
    // and nothing can be written: the counter below shares the same dead
    // storage path. Bumped anyway so the in-memory snapshot is honest for any
    // reader that survives, and named so a zero is never read as proof.
    bumpCounter('forensicRetryUnloadUnreachable', pending.length);
    return;
  }

  bumpCounter('forensicRetryUnloadFlush', pending.length);
  if (highStakes > 0) bumpCounter('forensicRetryUnloadFlushHighStakes', highStakes);
  for (const entry of pending) void safeSendMessage(entry.message);
  // The counters above are debounced 5s like every other diagnostic, which is
  // longer than this page has left. Force the write out now or the instrument
  // dies of the thing it measures.
  void flushDiagnosticsNow();
}

/** Test hook: drain + clear the forensic retry-buffer state. */
export function _resetForensicRetryBufferForTesting(): void {
  forensicRetryBuffer.length = 0;
  fallbackDeliverySequence = 0;
  if (forensicRetryTimer !== null) {
    clearTimeout(forensicRetryTimer);
    forensicRetryTimer = null;
  }
}

/** Test hook: run the pagehide path without dispatching a real event. */
export function _flushForensicRetryOnUnloadForTesting(): void {
  flushForensicRetryOnUnload();
}

/** Test hook: read the current retry-buffer contents (read-only snapshot). */
export function _peekForensicRetryBufferForTesting(): ForensicRetryPayload[] {
  return forensicRetryBuffer.map((entry) => entry.message.payload);
}

/** Test hook: force a retry-buffer flush without waiting for the timer. */
export function _flushForensicRetryBufferForTesting(): Promise<void> {
  if (forensicRetryTimer !== null) {
    clearTimeout(forensicRetryTimer);
    forensicRetryTimer = null;
  }
  return flushForensicRetryBuffer();
}
