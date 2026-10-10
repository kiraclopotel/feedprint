// Content-realm gap ledger (evidence-gap register item 9, 2026-09-06).
//
// The loss sites in this realm (forensic-retry.ts, interceptor.ts) used to end
// in an unsigned day-scoped counter. They now also note the loss here, and the
// ledger sends one GAP_LOG per reason to the service worker, where it becomes a
// signed gap-marker on the chain (forensics/gap-marker.ts). Batched per surface
// session, not per event: a flush goes out a minute after the first note and
// on pagehide. A flush that cannot reach the worker keeps its counts; the next
// flush carries them with the window widened, so a loss is never silently
// dropped a second time. The ledger cannot use the retry buffer (its overflow
// is one of the losses it reports).
//
// The count is a bound in the unit named: retry losses are records; backlog
// drops are DOM nodes, which are not posts.

import { isContextAlive, safeSendMessage } from '../../storage/context-guard';
import type { GapMarkerInput, GapReason, GapUnit } from '../../types/gap-marker';
import type { Platform } from '../../types/post';

const GAP_LEDGER_FLUSH_MS = 60_000;

interface LedgerEntry { count: number; unit: GapUnit; fromISO: string; toISO: string; deliveryId: string }

// The worker's forensic gate refuses a delivery with no id (service-worker.ts:
// "missing forensic delivery id"), so a GAP_LOG sent without one was rejected
// on every flush and no content-realm loss ever reached the chain. The id is
// minted with the entry and kept across retries, so the outbox's receipt index
// dedupes a resend whose first response was lost; a part-retired entry takes a
// fresh id because its window and count are new. Local, not imported from
// forensic-retry: that module notes gaps here, and the ledger must not depend
// on the buffer whose overflow it reports.
let fallbackDeliverySequence = 0;
function createGapDeliveryId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return `fd-gap-${crypto.randomUUID()}`;
  fallbackDeliverySequence++;
  return `fd-gap-${Date.now()}-${fallbackDeliverySequence}-${Math.random().toString(36).slice(2, 8)}`;
}

let platform: Platform | 'unknown' = 'unknown';
/**
 * Every entry that still needs to reach the chain, keyed by its delivery id.
 *
 * Keyed by ID, not by reason, because an entry is SEALED the moment it is sent.
 * It used to be keyed by reason and mutated in place: a send that got no
 * acknowledgement kept its entry AND its id, later notes added to the same
 * entry, and the next flush re-sent that id carrying a bigger count. The outbox
 * dedupes on the delivery id and does not update an existing row or a committed
 * receipt, so it answered ok:true without taking the new number — and the
 * ledger, seeing ok:true, deleted the entry. The chain kept a marker saying one
 * record was lost while the ledger discarded five.
 *
 * Sealing fixes both ends of that without trading one error for another. A
 * resend now always carries exactly what its first send carried, which is what
 * the receipt dedup is built for, so a lost acknowledgement cannot double-count.
 * Notes arriving after a send open a fresh entry with a fresh id, so they cannot
 * be swallowed by a dedup hit on someone else's delivery.
 */
const ledger = new Map<string, LedgerEntry & { reason: GapReason }>();
/**
 * The entry each reason is currently accumulating into. A reason drops out of
 * this map when its entry is sent; the next note for it opens a new one.
 */
const openByReason = new Map<GapReason, string>();
/**
 * Where the next entry for a reason should start its window: the end of the
 * last window sent for it.
 *
 * A note carries the moment it was RAISED, not the moment each loss happened —
 * five nodes dropped across half a minute are noted once at the end of it. So
 * the window is widened back to where the previous marker stopped, and the two
 * markers together leave no interval unaccounted for. The module's rule:
 * a widened window is a truthful bound, a silently discarded count is not.
 */
const windowStartByReason = new Map<GapReason, string>();
let flushTimer: number | null = null;
let unloadInstalled = false;
// A flush awaits the worker per message; the pagehide flush and the timer
// flush could otherwise run over each other and send the same counts twice,
// which overstates the loss on the chain.
let flushing = false;

export function setGapLedgerPlatform(p: Platform): void {
  platform = p;
}

/** Record a loss. `count` is in `unit`; zero and negative counts are ignored. */
export function noteGap(reason: GapReason, count: number, unit: GapUnit): void {
  if (!(count > 0)) return;
  const now = new Date().toISOString();
  const openId = openByReason.get(reason);
  const entry = openId ? ledger.get(openId) : undefined;
  // A reason carries one unit by construction (retry losses are records,
  // backlog drops are nodes). If that ever stops holding, the count is added
  // under the unit the entry already declared rather than dropped: a widened
  // window is a truthful bound, a silently discarded count is not.
  if (entry) {
    entry.count += count;
    entry.toISO = now;
  } else {
    const deliveryId = createGapDeliveryId();
    const fromISO = windowStartByReason.get(reason) ?? now;
    ledger.set(deliveryId, { reason, count, unit, fromISO, toISO: now, deliveryId });
    openByReason.set(reason, deliveryId);
  }
  armFlush();
}

function armFlush(): void {
  if (flushTimer !== null) return;
  if (typeof setTimeout !== 'function') return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushGapLedger();
  }, GAP_LEDGER_FLUSH_MS) as unknown as number;
}

/** The messages a flush would send; exported for tests, does not clear. */
export function pendingGapMessages(): Array<{ type: 'GAP_LOG'; deliveryId: string; payload: GapMarkerInput }> {
  return [...ledger.values()].map(e => ({
    type: 'GAP_LOG' as const,
    deliveryId: e.deliveryId,
    payload: { reason: e.reason, platform, count: e.count, unit: e.unit, fromISO: e.fromISO, toISO: e.toISO },
  }));
}

/**
 * Send every pending reason as its own GAP_LOG. An entry clears only on an
 * explicit `ok: true` from the worker; anything else keeps it for the next
 * flush. Off keeps no record and has no worker: its ledger is dropped.
 */
export async function flushGapLedger(): Promise<void> {
  if (ledger.size === 0) return;
  if (!isContextAlive()) return;
  if (flushing) return;
  flushing = true;
  try {
    await flushOnce();
  } finally {
    flushing = false;
  }
  if (ledger.size > 0) armFlush();
}

async function flushOnce(): Promise<void> {
  for (const msg of pendingGapMessages()) {
    // Seal BEFORE the await. From here this entry's count and window never
    // change, so a resend of this id is byte-identical to the send the outbox
    // may already hold a receipt for. A note arriving during the await opens a
    // fresh entry under a fresh id rather than growing this one behind a
    // delivery id the outbox has already made up its mind about.
    if (openByReason.get(msg.payload.reason) === msg.deliveryId) {
      openByReason.delete(msg.payload.reason);
      windowStartByReason.set(msg.payload.reason, msg.payload.toISO);
    }
    let resp: unknown;
    try {
      resp = await safeSendMessage({ ...msg, deliveryCapturedAt: msg.payload.toISO });
    } catch {
      resp = undefined;
    }
    const accepted = !!resp && typeof resp === 'object' && (resp as { ok?: boolean }).ok === true;
    // Anything but an explicit yes keeps the entry, unchanged, for the next
    // flush to resend under the same id.
    if (accepted) ledger.delete(msg.deliveryId);
  }
}

/**
 * The pagehide path. It does NOT await, and it does NOT respect the `flushing`
 * guard, because both of those lose losses on a closing tab.
 *
 * flushOnce awaits a service-worker round trip between messages. At pagehide
 * that round trip never resolves — the page is being torn down — so the
 * continuation never runs and every reason after the FIRST is never handed to
 * chrome.runtime.sendMessage at all. Which loss survived was decided by which
 * reason happened to be noted first: a backlog of hidden nodes could outrank a
 * lost forensic record, which is the higher-stakes unit. And if a 60-second
 * timer flush was mid-await when the tab closed, `flushing` was still true and
 * the unload path returned having sent nothing whatever.
 *
 * So this fires every pending message at once, the way
 * flushForensicRetryOnUnload does, and lets the outbox's deliveryId receipt
 * index dedupe anything the timer flush had already delivered. Nothing is
 * retired from the ledger here: retiring needs an acknowledgement, no
 * acknowledgement can arrive, and a tab that is closing has no next flush to
 * be confused by what it kept.
 */
function flushGapLedgerOnUnload(): void {
  if (ledger.size === 0) return;
  if (!isContextAlive()) return;
  for (const msg of pendingGapMessages()) {
    void safeSendMessage({ ...msg, deliveryCapturedAt: msg.payload.toISO });
  }
}

export function installGapLedgerUnloadFlush(): void {
  if (unloadInstalled) return;
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
  unloadInstalled = true;
  window.addEventListener('pagehide', flushGapLedgerOnUnload);
}

/** Test hook: run the pagehide path without dispatching a real event. */
export function _flushGapLedgerOnUnloadForTesting(): void {
  flushGapLedgerOnUnload();
}

export function _resetGapLedgerForTesting(): void {
  ledger.clear();
  openByReason.clear();
  windowStartByReason.clear();
  platform = 'unknown';
  flushing = false;
  if (flushTimer !== null && typeof clearTimeout === 'function') clearTimeout(flushTimer);
  flushTimer = null;
}
