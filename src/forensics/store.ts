// FeelingWise - IndexedDB forensic store
// Append-only database. Records cannot be modified through the app.

import { ForensicRecord } from '../types/forensic';
import { signHash, getPublicKeyFingerprint } from './signing';
import { CHAIN_GENESIS_HASH } from './chain-integrity';
import { levelOf } from '../types/mode';
import { finalizeRecord } from './record-stamp';
import {
  compressRecord,
  isCompressedEnvelope,
  unwrapStoredEntry,
  unwrapStoredEntries,
  type CompressedRecordEnvelope,
} from './record-compression';
// sha256 used for the Reset Marker's originalHash field.
import { sha256 } from './hasher';
// Full-state reset support. resetForensicChain orchestrates wipes
// across all FW IndexedDB databases plus the chrome.storage usage
// counters + diagnostics blob, so the dashboard's "Reset" wipes
// everything FW has done instead of leaving the popup's daily counters
// orphaned.
import { clearScanLog } from './scan-log';
import { clearAuthorProfiles } from './author-store';
import { resetNeutralizerDiagnostics } from './neutralizer-diagnostics';
import { clearThemeCache } from './theme-cache';
import { clearCapturedBehavior } from './capture-behavior';
import { clearCapturedTuples } from './capture-prompt-io';
import { getSettingsForAttestation, resetUsageStats } from '../storage/settings';
import { processingCache } from '../storage/cache';
import { clearBatchCache } from '../analysis/comment-batch-scorer';
// Shared per-realm lock so anchorChainHead + Reset Marker write serialize
// against logger.ts's chain writes. Pre-2026-05-24 both bypassed the
// logger lock and could race a concurrent FORENSIC_LOG → duplicate
// chainPosition. Audit A4-HIGH-2 closure.
import { sharedChainWriteLock } from './chain-write-lock';
import type { ChainAnchor } from '../types/chain-anchor';
import { assertExtensionRealm } from '../storage/realm-guard';
import { archiveEvictedRecords, type StoredEntry } from './archive-writer';
import { notePrune } from './maintenance-health';
import { rebaseChainHeightWitness } from './chain-height-witness';
import type { ResetChainResult } from '../types/chain-reset';

// Legacy internal database name. Renaming would require a migration across
// existing installs and could risk local record loss or integrity-chain confusion.
// This name is only visible in developer tools, not user-facing UI. Do not rename
// without a dedicated migration plan.
const DB_NAME = 'feelingwise-forensics';
// v1 → v2 added `chainPosition` index + pre-chain stamping.
// v3 added an adjudications object store (since removed). Stays present on
// existing installs as a dormant no-touch store.
// v4 added a `parentFeedback` sidecar store (recordId-keyed parent confirm /
// dispute votes; chain-mirror invariant preserved — original records stay
// immutable; feedback lives alongside, not inside).
// v5 added a `chainAnchors` sidecar store for RFC 3161 third-party-signed
// timestamps. Chain-mirror invariant preserved — anchors live alongside the
// chain as additional independent-time evidence; records themselves are
// unchanged. See src/forensics/chain-anchor-store.ts for the schema.
// Single source of truth for the active forensic IndexedDB schema version.
// Exported so chain-rotation (which opens the SAME DB) cannot drift below it
// — opening at a lower version throws a VersionError and silently disables
// month-rotation (regression F-1).
export const FORENSIC_DB_VERSION = 6;
const DB_VERSION = FORENSIC_DB_VERSION;
const STORE_NAME = 'records';
const PARENT_FEEDBACK_STORE_NAME = 'parentFeedback';
const CHAIN_ANCHOR_STORE_NAME = 'chainAnchors';
export const FORENSIC_DELIVERY_OUTBOX_STORE = 'deliveryOutbox';
export const FORENSIC_DELIVERY_RECEIPTS_STORE = 'deliveryReceipts';
export const FORENSIC_DELIVERY_META_STORE = 'deliveryMeta';
const SIGNING_BACKOFF_MS = [0, 100, 500] as const;

async function signRecordHashWithRetry(integrityHash: string): Promise<string> {
  let lastError: unknown;
  for (let attempt = 0; attempt < SIGNING_BACKOFF_MS.length; attempt++) {
    const delayMs = SIGNING_BACKOFF_MS[attempt];
    if (delayMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    }
    try {
      return await signHash(integrityHash);
    } catch (error) {
      lastError = error;
      console.warn(
        `[FeelingWise] Forensic signing attempt ${attempt + 1}/${SIGNING_BACKOFF_MS.length} failed:`,
        error,
      );
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? 'signing failed'));
}

/** Prepare the exact signed/compressed value before any destructive IDB cutover. */
export async function prepareRecordForStorage(
  record: ForensicRecord,
): Promise<CompressedRecordEnvelope> {
  const signature = await signRecordHashWithRetry(record.integrityHash);
  return compressRecord({ ...record, signature });
}

// Exported so sidecar modules (chain-anchor-store.ts, etc.) can attach
// transactions to the same IDB without duplicating the migration logic.
// The migration in onupgradeneeded below is the single source of truth for
// the `feelingwise-forensics` DB schema.
export function openDB(): Promise<IDBDatabase> {
  assertExtensionRealm(DB_NAME);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = request.result;
      const oldVersion = event.oldVersion;

      // Initial creation (oldVersion = 0).
      if (oldVersion < 1) {
        const store = db.createObjectStore(STORE_NAME, { autoIncrement: true });
        store.createIndex('timestamp', 'timestamp', { unique: false });
        store.createIndex('platform', 'platform', { unique: false });
      }

      // v1 → v2 migration: add chainPosition index and stamp existing records
      // as pre-chain. Per VISION §9 the store is append-only — we don't
      // recompute the existing records' integrityHash (would change their
      // signatures and break per-record verification of legacy exports).
      if (oldVersion < 2) {
        const tx = request.transaction!;
        const store = tx.objectStore(STORE_NAME);
        if (!store.indexNames.contains('chainPosition')) {
          store.createIndex('chainPosition', 'chainPosition', { unique: false });
        }
        // Walk every existing record; mark chainPosition = -1 + chainAnchor =
        // 'pre-chain' so the chain-integrity walk skips them. Cursor inside
        // onupgradeneeded uses the existing transaction.
        const cursorReq = store.openCursor();
        cursorReq.onsuccess = (e) => {
          const c = (e.target as IDBRequest).result as IDBCursorWithValue | null;
          if (!c) return;
          const r = c.value as ForensicRecord;
          // Only stamp records that don't already have a chain position.
          // Idempotent in case the migration runs twice (shouldn't, but cheap).
          if (r.chainPosition === undefined) {
            r.chainPosition = -1;
            r.chainAnchor = 'pre-chain';
            c.update(r);
          }
          c.continue();
        };
      }

      // v2 → v3 migration removed alongside the adjudication feature. The
      // empty 'adjudications' object store may exist on installs that ran v3
      // previously; it's dormant and no code paths read or write it.

      // v3 → v4: parentFeedback sidecar. recordId-keyed because each record
      // gets at most one parent verdict (confirm / dispute / withdraw via
      // delete). Sidecar pattern keeps the forensic chain append-only +
      // immutable per VISION §1.1 — feedback is parent annotation, not
      // chain mutation.
      if (oldVersion < 4) {
        if (!db.objectStoreNames.contains(PARENT_FEEDBACK_STORE_NAME)) {
          db.createObjectStore(PARENT_FEEDBACK_STORE_NAME, { keyPath: 'recordId' });
        }
      }

      // v4 → v5: chainAnchors sidecar. id-keyed RFC 3161 timestamp anchors
      // that bind a specific chainPosition's integrityHash to a third-party
      // TSA-signed time. anchoredChainPosition index lets the dashboard /
      // export find the latest anchor in O(log N).
      if (oldVersion < 5) {
        if (!db.objectStoreNames.contains(CHAIN_ANCHOR_STORE_NAME)) {
          const anchorStore = db.createObjectStore(CHAIN_ANCHOR_STORE_NAME, { keyPath: 'id' });
          anchorStore.createIndex('anchoredChainPosition', 'anchoredChainPosition', { unique: false });
          anchorStore.createIndex('requestedAt', 'requestedAt', { unique: false });
        }
      }

      // v5 → v6: durable SW-owned delivery outbox + committed/discarded
      // receipts. Receipts make a repeated deliveryId idempotent even after
      // its outbox row has been atomically consumed with the chain write.
      if (oldVersion < 6) {
        if (!db.objectStoreNames.contains(FORENSIC_DELIVERY_OUTBOX_STORE)) {
          const outbox = db.createObjectStore(FORENSIC_DELIVERY_OUTBOX_STORE, {
            keyPath: 'queueSequence',
            autoIncrement: true,
          });
          outbox.createIndex('deliveryId', 'deliveryId', { unique: true });
        }
        if (!db.objectStoreNames.contains(FORENSIC_DELIVERY_RECEIPTS_STORE)) {
          const receipts = db.createObjectStore(FORENSIC_DELIVERY_RECEIPTS_STORE, {
            keyPath: 'deliveryId',
          });
          receipts.createIndex('finalizedAt', 'finalizedAt', { unique: false });
        }
        if (!db.objectStoreNames.contains(FORENSIC_DELIVERY_META_STORE)) {
          db.createObjectStore(FORENSIC_DELIVERY_META_STORE, { keyPath: 'key' });
        }
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * SKELETON 3a — Look up the next chain position and the previous record's
 * integrityHash. Called by the logger before each write so the new record's
 * `prevRecordHash` and `chainPosition` are part of the canonical payload
 * (and therefore covered by the signature).
 *
 * Race window: two simultaneous writes from different tabs both call this
 * and both get the same nextPosition. The chain-integrity walk catches the
 * collision (two records at the same position fail the `chainPosition !==
 * expectedPosition` check). For V1 family product the write rate is low
 * (a few records per minute under heavy scroll), so this is acceptable; a
 * stronger guarantee would need a service-worker-mediated write queue.
 */
export async function getChainState(): Promise<{
  nextPosition: number;
  prevRecordHash: string;
  /** The key that signed the newest active record; absent on an empty chain or a record that names none. */
  tipFingerprint?: string;
}> {
  // Held outside the try so the failure paths can close it. Every exit above
  // closed the connection and none of the failure exits did, so a read that
  // threw left a handle open; the next thing to ask for this database is then
  // blocked by a connection nobody is using, which is the shape chain-height.ts
  // measured with a fault-injecting storage double on 2026-09-18.
  let opened: IDBDatabase | null = null;
  try {
    const db = await openDB();
    opened = db;
    // The cursor returns either an envelope or a raw legacy record. The
    // envelope's chainPosition is lifted to the top level (matches the IDB
    // index keypath), so the discriminator check on cursor.value works
    // without decompression. We only decompress the winning candidate to
    // read its integrityHash.
    const candidate = await new Promise<unknown>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const idx = store.index('chainPosition');
      // Every way out of this walk, not only the two the cursor offers.
      //
      // This promise is awaited by the logger WHILE IT HOLDS THE SHARED CHAIN
      // WRITE LOCK, so a promise that never settles does not fail one record:
      // it stops every forensic write in this realm for the rest of the
      // worker's life, with nothing in the log and nothing on screen. The
      // recorder would go on looking like it was recording.
      //
      // The hole is the cursor, not the transaction. A pending request does get
      // an error event when a transaction aborts, but a cursor request that has
      // already fired `success` is not pending, and an exception thrown INSIDE
      // that handler aborts the transaction by itself. Reading `c.value` is
      // where that can happen: it deserializes a stored entry, and the entries
      // here are whatever survived on disk. So the handler catches its own
      // throw, and the transaction's abort and error are handled as well, which
      // is the shape archive-writer.ts:269 and the prune path at :1597 already
      // carry and this one did not (2026-09-19).
      tx.onerror = () => reject(tx.error ?? new Error('chain state read failed'));
      tx.onabort = () => reject(tx.error ?? new Error('chain state read aborted'));
      // Iterate from largest chainPosition down. First non-pre-chain record
      // (chainPosition >= 0) wins. If we walk past everything (only pre-chain
      // records exist or store is empty) we anchor at genesis.
      const cursorReq = idx.openCursor(null, 'prev');
      cursorReq.onsuccess = (e) => {
        try {
        const c = (e.target as IDBRequest).result as IDBCursorWithValue | null;
        if (!c) {
          resolve(null);
          return;
        }
        const pos = isCompressedEnvelope(c.value)
          ? c.value.chainPosition
          : (c.value as ForensicRecord).chainPosition;
        // Relegated (pre-rekey) records KEEP their original chainPosition —
        // the position is inside the canonical signed payload and stripping
        // it broke recomputed-hash verification (live failure 2026-06-11).
        // They are NOT part of the active chain: skip them so the next write
        // continues from the largest still-ACTIVE position, not a relegated
        // head. The anchor is lifted to the envelope top level by
        // compressRecord; raw legacy records carry it directly. (A legacy
        // envelope without the lifted field cannot be pre-rekey-with-position
        // — the old relegation always set chainPosition undefined, which
        // excludes it from this index entirely.)
        const anchor = isCompressedEnvelope(c.value)
          ? c.value.chainAnchor
          : (c.value as ForensicRecord).chainAnchor;
        if (anchor === 'pre-rekey') {
          c.continue();
          return;
        }
        if (pos !== undefined && pos >= 0) {
          resolve(c.value);
          return;
        }
        // Pre-chain (chainPosition = -1). Since we're walking largest-to-
        // smallest, all remaining records are pre-chain too. Start at genesis.
        resolve(null);
        } catch (err) {
          // A throw here would otherwise leave nothing pending to carry an
          // error, and the transaction it aborts is the last thing that could
          // have settled this promise. Rejecting is the honest outcome: the
          // caller's own catch turns it into a failed write, which is a record
          // lost, where the alternative is every later record lost in silence.
          reject(err);
        }
      };
      cursorReq.onerror = () => reject(cursorReq.error);
    });
    db.close();

    if (candidate === null) {
      return { nextPosition: 0, prevRecordHash: CHAIN_GENESIS_HASH };
    }
    const r = await unwrapStoredEntry(candidate);
    return {
      nextPosition: (r.chainPosition ?? -1) + 1,
      prevRecordHash: r.integrityHash,
      ...(typeof r.publicKeyFingerprint === 'string' && r.publicKeyFingerprint ? { tipFingerprint: r.publicKeyFingerprint } : {}),
    };
  } catch (err) {
    // A genuinely-empty chain returns genesis on the SUCCESS path above
    // (cursor found no active record → candidate === null). An IDB ERROR is
    // different: returning genesis here would silently fork the chain at
    // position 0 on a transient failure, so a re-encountered position-0
    // record collides with the real genesis and the integrity walk reports a
    // false break (VISION §1.1 — the chain must break visibly only on real
    // tampering). Surface the error instead; logForensicEvent's try/catch and
    // the SW handler decide whether to retry or warn the parent.
    console.warn('[FeelingWise] getChainState failed:', err);
    try { opened?.close(); } catch { /* already gone */ }
    throw err;
  }
}

export interface RecordFilters {
  startDate?: string;
  endDate?: string;
  platform?: string;
  technique?: string;
}

export async function addRecord(record: ForensicRecord, deliveryId?: string): Promise<void> {
  try {
    // Sign the integrityHash at capture time. New active-chain records never
    // land unsigned: transient failures get a short bounded retry; persistent
    // failure rejects the write so the SW can return ok:false and the
    // high-stakes content path can retain the observation in its retry buffer.
    // Existing historical unsigned records remain readable and amber.
    //
    // Fingerprint is stamped at logger time
    // BEFORE the integrityHash is computed (so the canonical hash includes
    // the fingerprint and the signature transitively covers it). addRecord
    // no longer re-fetches the fingerprint here — overwriting it would
    // invalidate the integrityHash we already received. Just sign.
    // Wrap the signed record in a compressed envelope before storage. The
    // signature was computed over the integrityHash, which was computed over
    // the canonical payload — both contracts are storage-format-independent
    // per VISION §1.1. The envelope's top-level id/timestamp/platform/
    // chainPosition keypaths preserve the existing IDB indexes.
    const envelope = await prepareRecordForStorage(record);

    const db = await openDB();
    return new Promise((resolve, reject) => {
      const stores = deliveryId
        ? [STORE_NAME, FORENSIC_DELIVERY_OUTBOX_STORE, FORENSIC_DELIVERY_RECEIPTS_STORE]
        : [STORE_NAME];
      const tx = db.transaction(stores, 'readwrite');
      tx.objectStore(STORE_NAME).add(envelope);
      if (deliveryId) {
        const outbox = tx.objectStore(FORENSIC_DELIVERY_OUTBOX_STORE);
        const outboxKey = outbox.index('deliveryId').getKey(deliveryId);
        outboxKey.onsuccess = () => {
          if (outboxKey.result === undefined) {
            tx.abort();
            return;
          }
          outbox.delete(outboxKey.result);
          // `add`, not `put`: an already-finalized delivery aborts the whole
          // transaction, preventing a duplicate record after a lost ACK.
          tx.objectStore(FORENSIC_DELIVERY_RECEIPTS_STORE).add({
            deliveryId,
            status: 'committed',
            recordId: record.id,
            finalizedAt: new Date().toISOString(),
          });
        };
      }
      tx.oncomplete = () => {
        db.close();
        console.log('[FeelingWise] Forensic: record stored successfully');
        resolve();
      };
      tx.onerror = () => { db.close(); reject(tx.error); };
      tx.onabort = () => { db.close(); reject(tx.error ?? new Error('record transaction aborted')); };
    });
  } catch (err) {
    // VISION §1.1: forensic record loss is military-grade failure. Surface
    // the error to the caller so chain-write coordination + SW handlers +
    // dashboard surfaces can react (warn the parent, retry on transient
    // IDB errors, halt batch flushes). Pre-fix this catch logged-and-
    // swallowed, leaving addRecord() resolved-as-success while the chain
    // silently dropped the record.
    console.error('[FeelingWise] Failed to store forensic record:', err);
    throw err;
  }
}

let recordReadFailed = false;

/**
 * The chain read that rejects. Every path that MUTATES the store or signs
 * something about its contents (restore, backup, anchoring, relegation
 * repair) must use this one: for those callers an empty list and a failed
 * read are different facts, and treating the second as the first lets a
 * damaged envelope turn into a wiped chain, a zero-record backup reported as
 * success, or a repair stamped done forever.
 */
export async function getRecordsOrThrow(filters?: RecordFilters): Promise<ForensicRecord[]> {
  recordReadFailed = false;
  try {
    return await readRecords(filters);
  } catch (err) {
    recordReadFailed = true;
    throw err;
  }
}

/**
 * One stored row that is present in the database and could not be decoded on
 * this install. It is NOT a record that is absent and it is NOT a record that
 * is gone: the row is still there, still indexed, still exportable as bytes,
 * and a later build, a different browser or a repair pass may well read it.
 *
 * The identifying fields come off the envelope's own top level
 * (record-compression.ts lifts id, timestamp, platform and chainPosition out
 * of the gzip so IDB can index them), so a row whose PAYLOAD is damaged can
 * still say which record it is. They are optional because a row damaged in
 * some other way, or a raw pre-compression row, may carry none of them, and
 * an unnamed unreadable row must still be reported as unreadable rather than
 * dropped for want of a label.
 */
export interface RecordReadResult {
  /** Rows that were found AND decoded, in stored (chain) order. */
  records: ForensicRecord[];
  /**
   * False when at least one stored row could not be decoded, so `records` is
   * a floor and not the chain. Nothing may render `records.length` as "the
   * number of entries" while this is false; the gap belongs in the same
   * sentence as the number. It is a field rather than a comparison left to
   * each caller for the reason `ArchivedRecordCount.complete` is one: a
   * caller reads the fact instead of remembering to compute it, and a caller
   * that forgets to look is the failure being designed against.
   */
  complete: boolean;
  /** The rows that did not decode, in stored order. */
  unreadable: UnreadableStoredRecord[];
}

export interface UnreadableStoredRecord {
  /** The record id the envelope carries, when it carries one. */
  id?: string;
  /** The chain position the envelope carries, when it carries one. */
  chainPosition?: number;
  /** The timestamp the envelope carries, when it carries one. */
  timestamp?: string;
  /**
   * What went wrong, in the words the failure itself used. Never the empty
   * string: a `DecompressionStream` `TypeError` over a truncated gzip member
   * carries no `message` at all (found by the fault-injecting storage double,
   * 2026-09-18, after a restore screen rendered a blank explanation), so the
   * error's `name` is used when its `message` is empty.
   */
  reason: string;
}

/**
 * A read of the active chain that keeps THREE states apart instead of two.
 *
 * `getRecordsOrThrow` answers all-or-nothing and `getRecords` answers
 * best-effort-or-empty, and between them they can only say "here is the
 * chain" or "I could not read the chain". Neither can say the thing that is
 * actually true when one row lands damaged: most of it read, this row did
 * not. The three states this result keeps apart, and what each return value
 * means:
 *
 *   • READABLE: the row is in `records`. It was found and decoded, and it is
 *     the same ForensicRecord the other two readers would have handed back.
 *   • UNREADABLE ON THIS INSTALL: the row is in `unreadable` and NOT in
 *     `records`. It exists in the database; its bytes did not decode here
 *     today. Nothing may render this as a missing record, and nothing may
 *     count it as present evidence either.
 *   • ABSENT: the row is in neither list. Nothing was stored under it. A
 *     chain of four that reads three plus one unreadable is not a chain of
 *     three, and that distinction is the whole reason this shape exists.
 *
 * Why not simply skip the bad row and return the rest (M212, refused
 * 2026-09-18): a reader that skips makes an unreadable record read as a
 * record that was never there, which is M186 exactly, and the same defect the
 * three archive readers in archive-reader.ts were corrected for the same
 * night. This is their sibling at row granularity, and `complete` here means
 * what `complete` means on `ArchivedRecordCount`.
 *
 * STILL THROWS when the store itself cannot be opened or enumerated. A
 * database that would not answer at all is not a partial read: it is the
 * all-or-nothing case, and callers get the same loudness `getRecordsOrThrow`
 * gives them. `lastRecordReadFailed()` is set on that throw for the same
 * reason. A PARTIAL read deliberately does NOT set that flag: the partial is
 * carried in the return value where the caller that asked for it will see it,
 * and raising the module-wide "could not read" flag would make every other
 * surface in the realm describe a read that mostly succeeded as a failure.
 *
 * Takes no filters, unlike its two siblings. A filter reads `technique` and
 * the dates off the decoded record, and an unreadable row is exactly the one
 * whose decoded fields nobody has: filtering it would mean guessing whether
 * it belongs in the answer, and a half-filtered list of damaged rows is worse
 * than no list. Callers filter `records` themselves and report `unreadable`
 * whole.
 */
export async function getRecordsDetailed(): Promise<RecordReadResult> {
  recordReadFailed = false;
  let entries: unknown[];
  try {
    entries = await readAllStoredEntries();
  } catch (err) {
    recordReadFailed = true;
    throw err;
  }
  const records: ForensicRecord[] = [];
  const unreadable: UnreadableStoredRecord[] = [];
  for (const entry of entries) {
    try {
      // Per entry, never the batch helper: unwrapStoredEntries decodes the
      // whole array and rejects for all of it on the first bad member, which
      // is the behaviour this function exists to stop propagating.
      records.push(await unwrapStoredEntry(entry));
    } catch (err) {
      unreadable.push(describeUnreadableEntry(entry, err));
    }
  }
  return { records, complete: unreadable.length === 0, unreadable };
}

/** The envelope's own index fields, plus a reason that is never blank. */
function describeUnreadableEntry(entry: unknown, err: unknown): UnreadableStoredRecord {
  const reason = err instanceof Error ? (err.message || err.name) : String(err);
  const out: UnreadableStoredRecord = { reason: reason || 'the stored row could not be decoded' };
  if (isCompressedEnvelope(entry)) {
    out.id = entry.id;
    out.timestamp = entry.timestamp;
    if (entry.chainPosition !== undefined) out.chainPosition = entry.chainPosition;
    return out;
  }
  const loose = entry as { id?: unknown; timestamp?: unknown; chainPosition?: unknown } | null;
  if (loose && typeof loose === 'object') {
    if (typeof loose.id === 'string') out.id = loose.id;
    if (typeof loose.timestamp === 'string') out.timestamp = loose.timestamp;
    if (typeof loose.chainPosition === 'number') out.chainPosition = loose.chainPosition;
  }
  return out;
}

export async function getRecords(filters?: RecordFilters): Promise<ForensicRecord[]> {
  try {
    return await getRecordsOrThrow(filters);
  } catch (err) {
    // A FAILED READ IS NOT AN EMPTY CHAIN.
    //
    // Returning [] here made every reader render the same thing it renders for
    // a genuinely quiet day: no incidents, nothing flagged, a calm feed. A
    // parent could not tell "your child saw nothing worrying" from "this
    // extension could not open its own database". That is the defect class
    // this codebase spent 2026-08-02 removing everywhere else — a failure that
    // leaves the surface reading green.
    //
    // The flag is a module-level fact rather than a thrown error on purpose:
    // throwing here would blank a dashboard that can still show its other
    // panels honestly, and several callers treat this as best-effort. Readers
    // ask `lastRecordReadFailed()` and say so; mutating paths use
    // getRecordsOrThrow().
    console.error('[FeelingWise] Failed to read forensic records:', err);
    return [];
  }
}

/**
 * Every stored row, still wrapped, in insertion (chain) order.
 *
 * Factored out of `readRecords` when `getRecordsDetailed` was added, so the
 * all-or-nothing reader and the partial-reporting one cannot drift apart on
 * how the store is opened: the only difference between them must be what each
 * does with a row that will not decode, never which rows they saw.
 */
async function readAllStoredEntries(): Promise<unknown[]> {
  const db = await openDB();
  // getAll returns a mix of envelopes (records written after compression
  // shipped) and raw ForensicRecords (legacy records written before).
  // unwrapStoredEntry handles both shapes transparently.
  return await new Promise<unknown[]>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).getAll();
    request.onsuccess = () => { db.close(); resolve(request.result); };
    request.onerror = () => { db.close(); reject(request.error); };
  });
}

async function readRecords(filters?: RecordFilters): Promise<ForensicRecord[]> {
  {
    const entries: unknown[] = await readAllStoredEntries();
    // unwrapStoredEntries decompresses per record, one DecompressionStream
    // each. A single stream over concatenated payloads is not implementable:
    // Chrome's DecompressionStream rejects trailing data after the first gzip
    // member (probed 2026-08-03; per-record streams cost ~211 ms per
    // 10k records in isolation, a minority of the dashboard's load time —
    // docs/measurements/2026-08-03-dashboard-progressive.md).
    const records: ForensicRecord[] = await unwrapStoredEntries(entries);

    if (!filters) return records;

    return records.filter(r => {
      if (filters.startDate && r.timestamp < filters.startDate) return false;
      if (filters.endDate && r.timestamp > filters.endDate) return false;
      if (filters.platform && r.platform !== filters.platform) return false;
      if (filters.technique && !r.techniques.some(t => t.name === filters.technique)) return false;
      return true;
    });
  }
}

/**
 * True when the most recent `getRecords()` could not read the store.
 *
 * Exists so an empty list can be interrogated instead of assumed. A reader that
 * shows counts, an "all clear" state, or an export MUST check this before
 * describing the chain as empty.
 */
export function lastRecordReadFailed(): boolean {
  return recordReadFailed;
}

/**
 * Newest `limit` records only, for the dashboard's first paint. AutoIncrement
 * keys are insertion order, which is chain order, so the tail of the key space
 * is the newest slice: one getAllKeys plus one ranged getAll instead of
 * unwrapping the whole chain. Records come back in insertion order, the same
 * order `getRecords()` yields, so downstream sort and reverse logic is
 * unchanged.
 *
 * Returns null on any failure and touches neither `recordReadFailed` nor any
 * other shared state: a page read is a paint optimization, never a source of
 * truth. Callers MUST still run the full `getRecords()` read, and no surface
 * may state a chain total from a page.
 */
/**
 * The `kind` of the record sitting at chain position 0, or null when there is
 * no active record there. One index lookup, no decompression of anything else.
 *
 * Why this exists (M186's open half). Every act that legitimately restarts the
 * chain leaves its own marker at position 0: a reset marker, a month rotation
 * marker, an import marker. A chain that is shorter than the height this
 * install is known to have reached, and whose position 0 is NOT one of those,
 * has no innocent explanation. Asking "is the chain empty" was not enough,
 * because a heartbeat or a single captured post can land on the fresh chain
 * before anything looks, and then the destroyed record reads as a chain of one
 * rather than a chain of none. See forensics/chain-height-witness.ts.
 *
 * Throws on a read failure rather than answering null, for the same reason
 * getChainState does: a store we could not read is not a store we may draw a
 * conclusion from.
 */
export async function getChainOriginKind(): Promise<string | null> {
  const db = await openDB();
  try {
    const entry = await new Promise<unknown>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).index('chainPosition').get(0);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
    if (entry === null || entry === undefined) return null;
    const record = await unwrapStoredEntry(entry);
    return record.kind ?? null;
  } finally {
    db.close();
  }
}

export async function getRecordsFirstPage(limit: number): Promise<ForensicRecord[] | null> {
  try {
    const db = await openDB();
    const entries: unknown[] = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const keysReq = store.getAllKeys();
      keysReq.onsuccess = () => {
        const keys = keysReq.result;
        if (keys.length === 0) { db.close(); resolve([]); return; }
        const from = keys[Math.max(0, keys.length - limit)];
        const pageReq = store.getAll(IDBKeyRange.lowerBound(from));
        pageReq.onsuccess = () => { db.close(); resolve(pageReq.result); };
        pageReq.onerror = () => { db.close(); reject(pageReq.error); };
      };
      keysReq.onerror = () => { db.close(); reject(keysReq.error); };
    });
    return await unwrapStoredEntries(entries);
  } catch (err) {
    console.warn('[FeelingWise] First-page record read failed; the full read decides:', err);
    return null;
  }
}

/**
 * Restore the chain and its record-keyed sidecars as one IDB state change.
 * Caller must already hold sharedChainWriteLock. All compression finishes
 * before the transaction so an async gap cannot auto-commit a partial swap.
 */
export async function replaceBackupStateUnderChainLock(
  records: ForensicRecord[],
  anchors: ChainAnchor[],
  feedback: ParentFeedback[],
  publishRestoreCutoff = false,
): Promise<{ recordsAdded: number; anchorsAdded: number; feedbackRestored: number }> {
  // Retire the OUTGOING chain to its month archives first. A restore replaces
  // the chain wholesale, so anything the backup does not contain (everything
  // recorded since it was taken, and everything the backup itself was already
  // missing) is otherwise destroyed by an action the user reads as
  // "recovering my data". The Downloads safety copy that guards this path is
  // sealed under the install's device key, which makes it useless after the
  // reinstall that usually prompts a restore in the first place.
  //
  // Throwing here is correct where the prune only declines: the caller is
  // mid-restore and about to overwrite the chain, so a silent "carried on
  // anyway" is the one outcome that must not happen.
  const retired = await archiveEntireActiveChain();
  if (!retired.ok) {
    throw new Error(
      `restore aborted: the current chain could not be archived first (${retired.reason}). Nothing was changed.`,
    );
  }
  if (retired.archived > 0) {
    console.log(
      `[FeelingWise] restore: retired ${retired.archived} records into ${retired.months.join(', ')} before replacing the chain`
      + ` (${retired.undecoded} of them as stored bytes that did not decode).`,
    );
  }

  const envelopes = await Promise.all(records.map((record) => compressRecord(record)));
  // The height the chain will stand at once this transaction commits. Relegated
  // (pre-rekey) entries keep their old positions and are not the active chain,
  // so they are excluded here exactly as getChainState excludes them.
  const restoredNextPosition = records.reduce((highest, record) => {
    if (record.chainAnchor === 'pre-rekey') return highest;
    const position = record.chainPosition ?? -1;
    return position >= 0 && position + 1 > highest ? position + 1 : highest;
  }, 0);
  // Compression can take long enough for a content capture to occur while the
  // SW lock is held. Publish the boundary only after preparation finishes so
  // every capture from before the actual atomic swap is excluded on arrival.
  const restoreCutoffAt = publishRestoreCutoff ? new Date().toISOString() : undefined;
  const db = await openDB();
  const result = await new Promise<{ recordsAdded: number; anchorsAdded: number; feedbackRestored: number }>((resolve, reject) => {
    const tx = db.transaction(
      [
        STORE_NAME,
        CHAIN_ANCHOR_STORE_NAME,
        PARENT_FEEDBACK_STORE_NAME,
        FORENSIC_DELIVERY_RECEIPTS_STORE,
        FORENSIC_DELIVERY_META_STORE,
      ],
      'readwrite',
    );
    const recordStore = tx.objectStore(STORE_NAME);
    const anchorStore = tx.objectStore(CHAIN_ANCHOR_STORE_NAME);
    const feedbackStore = tx.objectStore(PARENT_FEEDBACK_STORE_NAME);
    const deliveryReceipts = tx.objectStore(FORENSIC_DELIVERY_RECEIPTS_STORE);
    const deliveryMeta = tx.objectStore(FORENSIC_DELIVERY_META_STORE);
    recordStore.clear();
    anchorStore.clear();
    feedbackStore.clear();
    // Final receipts refer to the outgoing record set. Keeping them would let
    // a stale retry claim "committed" after its record was replaced.
    deliveryReceipts.clear();
    for (const envelope of envelopes) recordStore.add(envelope);
    for (const anchor of anchors) anchorStore.add(anchor);
    for (const entry of feedback) feedbackStore.put(entry);
    if (restoreCutoffAt) {
      deliveryMeta.put({
        key: 'destructiveCutoff',
        kind: 'restore',
        capturedAt: restoreCutoffAt,
      });
      deliveryMeta.delete('rotationCutoff');
    }
    tx.oncomplete = () => {
      db.close();
      resolve({
        recordsAdded: envelopes.length,
        anchorsAdded: anchors.length,
        feedbackRestored: feedback.length,
      });
    };
    tx.onerror = () => { db.close(); reject(tx.error); };
    tx.onabort = () => { db.close(); reject(tx.error ?? new Error('backup restore transaction aborted')); };
  });

  // What IndexedDB KEPT, not what it was handed. `envelopes.length` is the
  // count passed to `add`, and a transaction can complete having stored fewer
  // than that; the person is then told every entry came back while the store
  // holds less. `archiveEvictedRecords` three functions away refuses to delete
  // a single record without reading it back, and this path is the one where the
  // reader's whole history is at stake. Found by a fault-injecting storage
  // double on 2026-09-18. A count that cannot be taken is reported as the
  // handed-over number with the reason logged, never as a silent zero.
  try {
    const verifyDb = await openDB();
    try {
      result.recordsAdded = await new Promise<number>((resolve, reject) => {
        const tx = verifyDb.transaction(STORE_NAME, 'readonly');
        const req = tx.objectStore(STORE_NAME).count();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    } finally {
      verifyDb.close();
    }
    if (result.recordsAdded !== envelopes.length) {
      console.warn(
        `[FeelingWise] restore: ${envelopes.length} entries were written and the store holds ${result.recordsAdded}. `
        + 'The number reported is the one the store holds.',
      );
    }
  } catch (err) {
    console.warn('[FeelingWise] restore: the restored record count could not be read back:', err);
  }

  // A restore legitimately leaves the chain at the height the backup file
  // holds, which is usually lower than the chain it replaced. Tell the chain
  // height note, so the drop is read as the restore it was and not as a loss
  // (M186's open half, forensics/chain-height-witness.ts).
  //
  // Awaited, not fired and forgotten. A check running on the next tick would
  // otherwise read the old note against the new chain; unlike a reset or a
  // rotation, a restore leaves no marker at position 0 for the second layer to
  // recognise, so this call is the only thing standing between an ordinary
  // recovery and a marker telling the person their record was lost.
  await rebaseChainHeightWitness('restore', restoredNextPosition);
  return result;
}

/**
 * Rewrite specific records IN PLACE (matched by record id), preserving the
 * IDB primary keys of the entries they replace. Used by the relegation
 * position-repair migration (auto-heal.ts): a recovered `chainPosition` is
 * written back onto an already-stored record without touching anything else
 * in the store. Serialized against concurrent chain writes via the shared
 * per-realm lock. Returns the number of entries actually updated.
 */
export async function rewriteRecordsInPlace(records: ForensicRecord[]): Promise<number> {
  if (records.length === 0) return 0;
  return sharedChainWriteLock(async () => {
    // Pre-compute envelopes BEFORE the readwrite cursor — awaiting inside an
    // IDB cursor handler risks auto-committing the transaction (same pattern
    // as anchorChainHead's relegation write).
    const envelopesById = new Map<string, CompressedRecordEnvelope>();
    for (const r of records) envelopesById.set(r.id, await compressRecord(r));
    const db = await openDB();
    let updated = 0;
    // Closed on failure too: a connection left open blocks the next opener of this database.
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const cursorReq = tx.objectStore(STORE_NAME).openCursor();
        cursorReq.onsuccess = (e) => {
          const c = (e.target as IDBRequest).result as IDBCursorWithValue | null;
          if (!c) return; // tx.oncomplete resolves
          const entryId = isCompressedEnvelope(c.value)
            ? c.value.id
            : (c.value as ForensicRecord).id;
          const envelope = envelopesById.get(entryId);
          if (envelope) {
            c.update(envelope);
            updated++;
          }
          c.continue();
        };
        cursorReq.onerror = () => reject(cursorReq.error);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error ?? new Error('rewriteRecordsInPlace transaction aborted'));
      });
    } finally {
      db.close();
    }
    return updated;
  });
}

/**
 * Relegate one record out of the active chain. Sets ONLY the non-hashed
 * `chainAnchor` envelope field; every canonical-hashed field (including
 * `chainPosition`) is preserved byte-identically, so the record's stored
 * integrityHash keeps recomputing and its signature keeps verifying under
 * its original key. Exported for the regression test that locks
 * "relegation never mutates hashed content".
 */
export function markRelegated(record: ForensicRecord): ForensicRecord {
  return { ...record, chainAnchor: 'pre-rekey' };
}

/**
 * Dev-mode forensic reset. Atomically replaces the active chain with a signed
 * Reset Marker that links to the prior terminal hash. The install signing
 * identity is retained so the marker and subsequent records remain verifiable
 * under one stable public key. End users cannot trigger this without the
 * dashboard's existing confirmation gate.
 *
 * **What it clears:**
 *   • IDB: `feelingwise-forensics.records` (old rows replaced by one marker).
 *   • IDB: `feelingwise-forensics.parentFeedback` sidecar.
 *   • IDB: `feelingwise-forensics.chainAnchors` sidecar.
 *   • IDB: `feelingwise-scans.events` (scan-log denominator for popup tiles).
 *   • IDB: `feelingwise-authors.profiles` (entity-resolution cache).
 *   • IDB: `feelingwise-feedback.verdicts` (user confirm/dispute records).
 *   • chrome.storage.local: neutralizer-diagnostics counters.
 *   • chrome.storage.local: usage stats (totalChecksToday/AllTime,
 *     totalNeutralizedToday/AllTime, totalTokens*, estimatedCost*).
 *   • IDB: `feelingwise-derived.themes` (theme labels, built out of the words
 *     of the posts, so derived text and not a counter).
 *   • IDB: `feelingwise-behavior-capture` and `feelingwise-prompt-io-capture`
 *     (dev-flag capture stores holding verbatim post text, and in the second
 *     case the prompts and the model's raw answers).
 *
 * **What it deliberately leaves, and why:**
 *   • The month archives it writes the outgoing chain INTO. A reset asks for a
 *     fresh chain, never for the old one to stop existing; the dialog says so.
 *   • IDB: `feelingwise-forensics-salvage`, records the reader imported by hand
 *     from old exports. They belong to a prior chain generation and were never
 *     part of the one being reset.
 *   • IDB: `feelingwise-pipeline-v2-metrics`, stage timings with no text in
 *     them, behind a flag that is off.
 *   • IDB: `feelingwise-backup-folder`, one directory handle for the folder the
 *     reader chose to write backups into. That is a setting they made, and the
 *     reset keeps what the user SET; clearing it would silently stop the daily
 *     backup after a reset, which is the opposite of what a reset asks for.
 *
 * The wipe is full-state to match the user's mental model of
 * "reset = nothing FW has DONE persists" (vs. configuration, which is
 * what the user SET — see below).
 *
 * **What it does NOT touch:**
 *   • The install ECDSA signing identity (`fw_signing_*`).
 *   • User settings: mode, locale, dailyCap, parentPin.
 *   • Feature toggles + presets.
 *   Reset is "wipe what FW HAS DONE", not "factory reset what the parent SET".
 *   If the user wants to nuke their config they uninstall + reinstall.
 *
 * Caller is responsible for any UI feedback / toast / refresh.
 *
 * NEVER ship this to production users without a PIN gate or stronger
 * confirmation. The function deliberately lives in src/forensics/store.ts
 * so the diff for "remove" is a single function deletion at release time
 * if we decide to ship the rest of the dashboard reset surface.
 */
/**
 * Copy the ENTIRE active chain into its month archives before a destructive
 * act clears it.
 *
 * Three code paths remove records from the active store: the cap prune, the
 * chain reset, and a backup restore replacing the chain wholesale. Only the
 * prune was ever examined, and only because it ran on a timer. Reset and
 * restore destroyed just as completely and were never questioned, because
 * both are user-initiated and "the user asked for it" was treated as
 * sufficient. It is not. The user asks for a clean dashboard and a fresh
 * chain; nothing about that intent requires the record to stop existing, and
 * an app whose whole claim is "a record you can check" may not quietly make
 * the check impossible on any path.
 *
 * Archiving does not defeat the intent: the active chain still restarts empty,
 * the dashboard still reads clean. The history simply moves somewhere the
 * export can still reach.
 *
 * Returns a truthful outcome instead of throwing, so callers can refuse the
 * destructive act rather than guess.
 */
async function archiveEntireActiveChain(): Promise<
  { ok: true; archived: number; months: string[]; undecoded: number } | { ok: false; reason: string }
> {
  let db: IDBDatabase | undefined;
  try {
    db = await openDB();
    const items: StoredEntry[] = [];
    await new Promise<void>((resolve, reject) => {
      const tx = db!.transaction(STORE_NAME, 'readonly');
      const cursorReq = tx.objectStore(STORE_NAME).openCursor();
      cursorReq.onsuccess = (e) => {
        const c = (e.target as IDBRequest).result as IDBCursorWithValue | null;
        if (!c) return; // tx.oncomplete resolves
        items.push({ key: c.primaryKey, entry: c.value });
        c.continue();
      };
      cursorReq.onerror = () => reject(cursorReq.error);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('pre-destructive archive read aborted'));
    });
    db.close();
    db = undefined;

    if (items.length === 0) return { ok: true, archived: 0, months: [], undecoded: 0 };

    const undecoded = await unwrapStoredItems(items);
    const outcome = await archiveEvictedRecords(items);
    if (!outcome.ok) return { ok: false, reason: outcome.reason };
    if (outcome.archivedKeys.length !== items.length) {
      return {
        ok: false,
        reason: `archived ${outcome.archivedKeys.length} of ${items.length} records`,
      };
    }
    return { ok: true, archived: outcome.archivedKeys.length, months: outcome.months, undecoded };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? (err.message || err.name) : String(err) };
  } finally {
    db?.close();
  }
}

/**
 * Decode each item's record where it will decode, and count the rows that will
 * not. Those keep no record and are moved as their stored bytes, because one
 * damaged row must not stop the prune, reset or restore that moves the rest.
 */
async function unwrapStoredItems(items: StoredEntry[]): Promise<number> {
  let undecoded = 0;
  for (const item of items) {
    try {
      item.record = await unwrapStoredEntry(item.entry);
    } catch (err) {
      undecoded++;
      console.warn('[FeelingWise] a stored row did not decode; it is moved as the bytes it was stored as:', describeUnreadableEntry(item.entry, err));
    }
  }
  return undecoded;
}


/**
 * Clears the RFC 3161 chain-anchor sidecar store during reset. The sidecar
 * lives in this same database, so the wipe is owned here; the richer anchor
 * API stays in chain-anchor-store.ts, which imports this module. Errors
 * propagate so resetForensicChain's chainAnchorsCleared flag honestly
 * reports a failed clear (the field exists to surface exactly that).
 */
async function clearChainAnchors(): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(CHAIN_ANCHOR_STORE_NAME, 'readwrite');
    tx.objectStore(CHAIN_ANCHOR_STORE_NAME).clear();
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
    tx.onabort = () => { db.close(); reject(tx.error ?? new Error('anchor clear transaction aborted')); };
  });
}

async function buildResetMarker(
  priorChainHash: string | undefined,
  reason: string | undefined,
): Promise<ForensicRecord> {
  const markerTimestamp = new Date().toISOString();
  // Attestation seam (Q24): when settings were unreadable the hashed marker
  // text says so, instead of the marker silently attesting the synthetic
  // fail-closed child mode as a real setting.
  const attestation = await getSettingsForAttestation();
  const markerOriginalText = `[reset-marker @ ${markerTimestamp}]${attestation.readFailed ? ' settings-read-failed' : ''}`;
  const markerOriginalHash = await sha256(markerOriginalText);
  const publicKeyFingerprint = await getPublicKeyFingerprint();
  const activeMode = attestation.mode;
  const partial: Omit<ForensicRecord, 'integrityHash' | 'signature'> = {
    id: `fr-reset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: markerTimestamp,
    platform: 'twitter',
    originalText: markerOriginalText,
    originalHash: markerOriginalHash,
    originalLength: markerOriginalText.length,
    neutralizedText: '',
    author: '',
    postUrl: '',
    techniques: [],
    overallScore: 0,
    userAgeCategory: levelOf(activeMode),
    aiSource: 'none',
    feedSource: 'unknown',
    detectionMode: 'reset-marker',
    prevRecordHash: CHAIN_GENESIS_HASH,
    chainPosition: 0,
    chainAnchor: 'genesis-v1',
    verdict: 'pass',
    kind: 'reset-marker',
    priorChainHash,
    resetReason: reason,
    publicKeyFingerprint,
  };
  return finalizeRecord(partial);
}

/**
 * Optional second arg lets the dashboard's
 * reset-confirmation modal pass a user-supplied reason text that becomes
 * part of the Reset Marker (and the canonical hash that covers it).
 * The UI for capturing this lands separately;
 * makes the parameter available so callers can adopt it incrementally.
 */
export async function resetForensicChain(
  reason?: string,
): Promise<ResetChainResult> {
  return sharedChainWriteLock(() => resetForensicChainLocked(reason));
}

async function resetForensicChainLocked(reason?: string): Promise<ResetChainResult> {
  // Retire the outgoing chain to its month archives BEFORE anything is
  // cleared. A reset that cannot archive does not proceed: the user asked
  // for a fresh chain, never for the old one to stop existing, and this app
  // exists to keep a record that can still be checked afterwards.
  const retired = await archiveEntireActiveChain();
  if (!retired.ok) {
    console.error(
      `[FeelingWise] resetForensicChain refused: could not archive the current chain (${retired.reason}). Nothing was cleared.`,
    );
    return {
      recordsCleared: 0,
      recordsArchived: 0,
      archiveFailedReason: retired.reason,
      signingIdentityRetained: true,
      scanLogCleared: false,
      authorProfilesCleared: false,
      verdictsCleared: false,
      diagnosticsCleared: false,
      usageStatsCleared: false,
      resetMarkerWritten: false,
      parentFeedbackCleared: false,
      chainAnchorsCleared: false,
    };
  }
  if (retired.archived > 0) {
    console.log(
      `[FeelingWise] resetForensicChain: retired ${retired.archived} records into ${retired.months.join(', ')} before clearing`
      + ` (${retired.undecoded} of them as stored bytes that did not decode).`,
    );
  }

  // Capture the LAST record's integrityHash BEFORE the
  // clear, so the Reset Marker can name what it's replacing. If the chain
  // is empty (genesis-only reset), priorChainHash stays undefined.
  //
  // Uses openDB() rather than raw indexedDB.open so onupgradeneeded fires
  // on fresh installs — direct indexedDB.open at DB_VERSION on a never-
  // opened-before profile creates the database with NO objectStores, and
  // the subsequent tx.objectStore() throws NotFoundError inside an event
  // handler the outer try/catch can't see, hanging the Promise forever.
  let priorChainHash: string | undefined;
  const lookupDb = await openDB();
  try {
    // Walk the (envelope | raw) mix and find the candidate with the largest
    // chainPosition without decompressing every entry. envelope.chainPosition
    // is at top level (lifted index keypath) so the comparison works on the
    // raw stored value. Candidates are decompressed newest first, and only
    // until one reads.
    const candidates = await new Promise<unknown[]>((resolve, reject) => {
      const tx = lookupDb.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).getAll();
      req.onsuccess = () => {
        const all = req.result as unknown[];
        const ranked: Array<{ pos: number; entry: unknown }> = [];
        for (const entry of all) {
          const pos = isCompressedEnvelope(entry)
            ? entry.chainPosition
            : (entry as ForensicRecord).chainPosition;
          if (pos === undefined || pos < 0) continue;
          // Relegated (pre-rekey) records keep their original positions but
          // are not the active chain head — the Reset Marker must name the
          // ACTIVE chain's terminal hash, not a relegated record's.
          const anchor = isCompressedEnvelope(entry)
            ? entry.chainAnchor
            : (entry as ForensicRecord).chainAnchor;
          if (anchor === 'pre-rekey') continue;
          ranked.push({ pos, entry });
        }
        resolve(ranked.sort((a, b) => b.pos - a.pos).map((r) => r.entry));
      };
      req.onerror = () => reject(req.error);
    });
    for (const candidate of candidates) {
      try {
        priorChainHash = (await unwrapStoredEntry(candidate)).integrityHash;
        break;
      } catch {
        // A newest row that will not decode is already in the archive as it was
        // stored, so the marker names the newest row that reads, as rotation does.
      }
    }
  } finally {
    // Reset must never erase a source whose terminal link could not be read;
    // any read error propagates after closing the connection.
    lookupDb.close();
  }

  const db = await openDB();

  // Count first, then clear, so the result is informative.
  const countStore = (storeName: string) =>
    new Promise<number>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

  // Serialize the ENTIRE respawn (source read → marker preparation → atomic
  // replace) under ONE chain-write lock acquisition. Pre-fix only the marker
  // write was locked, so the IDB clear ran OUTSIDE the lock: a concurrent
  // FORENSIC_LOG arriving between the clear and the marker could stamp
  // chainPosition 0 ahead of the reset marker, breaking the marker-is-genesis
  // invariant (Audit A4-HIGH-2). Holding the lock continuously across the
  // whole respawn closes the interleave window — no logger write can land
  // between the clear and the marker.
  let recordsCleared = 0;
  const signingIdentityRetained = true;
  let scanLogCleared = false;
  let authorProfilesCleared = false;
  let verdictsCleared = false;
  let diagnosticsCleared = false;
  let usageStatsCleared = false;
  let parentFeedbackCleared = false;
  let chainAnchorsCleared = false;
  let resetMarkerWritten = false;

  try {
    recordsCleared = await countStore(STORE_NAME);
    // Capability audit 2026-09-06, P1 item 5: a reset marker never leaves
    // without a reason. The dashboard modal sends none today, so the marker
    // says what it can prove: a reset the parent gate let through.
    const markerReason = reason && reason.trim().length > 0 ? reason : 'user-reset';
    const markerRecord = await buildResetMarker(priorChainHash, markerReason);
    const markerEnvelope = await prepareRecordForStorage(markerRecord);

    // The old rows and the already-signed marker change in one transaction.
    // Signing/compression happens above, so a failure cannot clear evidence.
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(
        [
          STORE_NAME,
          FORENSIC_DELIVERY_OUTBOX_STORE,
          FORENSIC_DELIVERY_RECEIPTS_STORE,
          FORENSIC_DELIVERY_META_STORE,
        ],
        'readwrite',
      );
      const records = tx.objectStore(STORE_NAME);
      const outbox = tx.objectStore(FORENSIC_DELIVERY_OUTBOX_STORE);
      const receipts = tx.objectStore(FORENSIC_DELIVERY_RECEIPTS_STORE);
      const meta = tx.objectStore(FORENSIC_DELIVERY_META_STORE);
      const pendingReq = outbox.getAll();
      pendingReq.onsuccess = () => {
        const finalizedAt = new Date().toISOString();
        // The reset cutoff below makes all older delivery IDs stale, so prior
        // dedupe receipts are no longer needed after this boundary.
        receipts.clear();
        for (const pending of pendingReq.result as Array<{ deliveryId: string }>) {
          receipts.put({
            deliveryId: pending.deliveryId,
            status: 'discarded-reset',
            finalizedAt,
          });
        }
        meta.put({
          key: 'destructiveCutoff',
          kind: 'reset',
          capturedAt: markerRecord.timestamp,
        });
        meta.delete('rotationCutoff');
        outbox.clear();
        records.clear();
        records.add(markerEnvelope);
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('reset transaction aborted'));
    });
    resetMarkerWritten = true;
  } finally {
    db.close();
  }

  // The signing identity is install-level continuity, not retained feed data.
  // Keeping it across a chain reset lets the marker and future records remain
  // positively verifiable without a non-atomic chrome.storage/IDB key swap.
  // Drop in-memory + chrome.storage.session cache layers BEFORE the
  // async wipe. Pre-2026-05-24 the processingCache + BATCH cache
  // survived reset, so a re-encounter of previously-cached content
  // within the per-cache TTL post-reset returned `pre-llm-cache-pass`
  // (per-post) or a cached BatchScoreResult (BATCH) without writing
  // a forensic record. The new chain showed ZERO records for content
  // the child re-saw in the post-reset window. VISION §1.1
  // chain-mirror invariant violated on the recall side. Closes
  // A5-B3 + the cross-area A4↔A5 finding from
  // docs/audits/2026-05-24/A5-audit.md §2.5. Both calls are
  // synchronous and don't throw — placed outside Promise.allSettled
  // to avoid wrapping noise.
  try {
    processingCache.clear();
  } catch (err) {
    console.warn('[FeelingWise] resetForensicChain: failed to clear processingCache', err);
  }
  try {
    clearBatchCache();
  } catch (err) {
    console.warn('[FeelingWise] resetForensicChain: failed to clear BATCH cache', err);
  }

  // Extend the wipe to the other FW IDBs +
  // diagnostics + usage stats. The first six reject when their store was not
  // emptied, and each flag below is read off that outcome; we
  // Promise.allSettled so a failure in one store doesn't strand the others
  // mid-reset.
  const auxResults = await Promise.allSettled([
    clearScanLog(),
    clearAuthorProfiles(),
    resetNeutralizerDiagnostics(),
    resetUsageStats(),
    // Pre-2026-05-24 the parent-feedback sidecar (Confirm / Dispute /
    // Unsure annotations keyed by recordId) survived chain reset.
    // After reset, sidecar entries pointed at deleted recordIds —
    // orphan rows the dashboard's join couldn't render but kept
    // accumulating until manual cleanup. Audit A4-MEDIUM-1 closure.
    clearAllParentFeedback(),
    // RFC 3161 chain anchors. Same orphan-prevention rationale as
    // parentFeedback — anchors reference chainPosition + integrityHash
    // from the now-cleared chain. Surviving anchors would point at
    // nothing. Cleared locally (the sidecar lives in this database)
    // rather than through chain-anchor-store, whose module imports this
    // one; a dynamic import here previously pulled Vite's DOM preload
    // helper into the document-free service worker (known-issues M40).
    clearChainAnchors(),
    // Derived text, and two dev-flag capture stores. Found 2026-09-18 by
    // counting the databases this product opens (ten) against the databases
    // this function clears (six). The theme cache holds labels built out of
    // the words of the posts; capture-behavior and capture-prompt-io hold
    // verbatim post text, and capture-prompt-io also holds the prompts and
    // the model's raw answers. All three are off or disposable in normal use,
    // which is exactly why nobody looked: a store that is usually empty still
    // has to be emptied by the act that says it empties things. Each swallows
    // its own errors; none of them is allowed to strand the reset.
    clearThemeCache(),
    clearCapturedBehavior().catch(() => undefined),
    clearCapturedTuples().catch(() => undefined),
  ]);
  const [scanRes, authRes, diagRes, statsRes, feedbackRes, anchorRes] = auxResults;
  scanLogCleared = scanRes.status === 'fulfilled';
  authorProfilesCleared = authRes.status === 'fulfilled';
  // The verdicts a parent gives (Confirm / Dispute) live in the parent-feedback
  // sidecar, so "the verdicts you gave", which the reset dialog promises to
  // clear, are cleared exactly when that sidecar is.
  verdictsCleared = feedbackRes.status === 'fulfilled';
  // pipelineV3Cleared slot removed.
  diagnosticsCleared = diagRes.status === 'fulfilled';
  usageStatsCleared = statsRes.status === 'fulfilled';
  parentFeedbackCleared = feedbackRes.status === 'fulfilled';
  chainAnchorsCleared = anchorRes.status === 'fulfilled';

  console.log(
    '[FeelingWise] Forensic chain reset complete:',
    `${recordsCleared} records`,
    '(signing identity retained)',
    `aux: scan=${scanLogCleared} auth=${authorProfilesCleared} verdict=${verdictsCleared} diag=${diagnosticsCleared} stats=${usageStatsCleared} feedback=${parentFeedbackCleared} anchors=${chainAnchorsCleared}`,
    resetMarkerWritten ? '(reset-marker written)' : '(reset-marker FAILED — investigate)',
  );

  // Tell the chain height note that this drop was asked for, so the next check
  // reads the fresh chain as a fresh chain and not as a destroyed record
  // (M186's open half, forensics/chain-height-witness.ts). The reset marker is
  // position 0, so the new height is 1.
  //
  // Only when the marker was actually written. The clear and the marker are one
  // transaction, so a marker that did not land means the transaction aborted
  // and the chain still holds everything: re-basing the note to zero there
  // would blind the install to a real loss later, which is the opposite of what
  // this note is for.
  if (resetMarkerWritten) await rebaseChainHeightWitness('reset', 1);

  return {
    recordsCleared,
    // Cleared from the ACTIVE chain, and retired to the month archives rather
    // than destroyed. The two numbers should match; a caller that shows only
    // `recordsCleared` is telling the user half the truth.
    recordsArchived: retired.archived,
    recordsCarriedUndecoded: retired.undecoded,
    signingIdentityRetained,
    scanLogCleared,
    authorProfilesCleared,
    verdictsCleared,
    // pipelineV3Cleared removed
    diagnosticsCleared,
    usageStatsCleared,
    resetMarkerWritten,
    parentFeedbackCleared,
    chainAnchorsCleared,
  };
}

/**
 * Bounded eviction.
 *
 * **Why this exists.** Pre-1.6 the forensic store recorded only flagged
 * records (~50/day for a typical user). Pass records are also written
 * (~500/day), so total volume grows ~10x. IndexedDB has no per-store cap
 * but the dashboard's load + scan time grows linearly with record count.
 * At ~10000 records a fresh dashboard load is still snappy; past ~50000
 * the integrity walk + adjudication-join becomes perceptible.
 *
 * **Eviction policy.** Oldest-first. Records are stored with
 * autoIncrement primary keys, so cursor order matches insertion order.
 * When count exceeds `maxRecords`, delete from the front (oldest) until
 * back at the cap. Records relegated to chainAnchor='pre-rekey' or
 * 'pre-chain' are eligible for eviction the same as live chain records —
 * the parent's audit window is bounded, not the chain itself. Anyone
 * who needs longer retention should export to PDF/JSON before the cap
 * is reached (export-then-evict is a parent-controlled flow we can
 * surface in V2).
 *
 * **What this does NOT do.**
 *   • Does not preserve any "important" record class (flagged + signed)
 *     ahead of pass records. FIFO oldest-first across the board. A
 *     priority-aware policy is V2 work — V1 keeps the policy simple
 *     and predictable.
 *   • Does not trigger automatically on every write (would tank hot-path
 *     latency). Call site is the daily 'forensic-prune' alarm in
 *     service-worker.ts.
 *
 * Returns the number of records deleted. Best-effort: throws are
 * caught and 0 returned.
 */
/** Exported so the dashboard can STATE the ceiling it is bounded by rather than
 *  leaving "showing N of N" to read as the whole history (2026-09-05). */
export const FORENSIC_RECORD_CAP = 10000;

/**
 * EVICTION INVARIANT (found 2026-09-01): eviction may never delete a record
 * it has not first archived.
 *
 * What this gate stopped. The cap was enforced by deletion, and the
 * month-rotation archive — the only thing that preserves history — fires
 * once per UTC month. At the observed write volume (~3000 records/day) the
 * 10000 cap is reached in three days, so rotation never had a month left to
 * archive: it has never run on a real install. Four daily prunes on the
 * owner's own chain destroyed 13508 records, and the chain's own surviving
 * markers put the total unrecoverable loss at 27017 of 38834 positions —
 * 70% of the record, gone, while the export it fed still described itself
 * as complete.
 *
 * How the invariant is now satisfied. `archive-writer.ts` moves the overflow
 * into the same per-month archive databases `archive-reader.ts` already reads
 * back (and `exportEverythingHtml` already includes), then reads them back to
 * confirm before a single active-chain record is deleted. A month that cannot
 * be archived keeps its records in the active chain, over cap, until it can.
 *
 * The gate below stays as a switch rather than being deleted: it is the one
 * place to turn eviction off again if the archive path is ever in doubt, and
 * tests/unit/forensics/eviction-never-deletes-unarchived.test.ts holds the line either
 * way by asserting on records, not on the flag.
 */
const EVICTION_MAY_DELETE: boolean = true;

export async function pruneRecordsToCap(
  maxRecords: number = FORENSIC_RECORD_CAP,
): Promise<number> {
  if (!EVICTION_MAY_DELETE) {
    console.warn(
      '[FeelingWise] Forensic prune skipped: eviction is switched off, so it must not delete.',
    );
    return 0;
  }
  return sharedChainWriteLock(() => pruneRecordsToCapUnderChainLock(maxRecords));
}

async function pruneRecordsToCapUnderChainLock(maxRecords: number): Promise<number> {
  let openedDb: IDBDatabase | undefined;
  try {
    const db = await openDB();
    openedDb = db;
    const total = await new Promise<number>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    if (total <= maxRecords) {
      db.close();
      void notePrune({ ok: true });
      return 0;
    }

    const deleteTarget = total - maxRecords;
    let deleted = 0;
    // Prune-marker provenance (wiring Q23): track what the prune removed so
    // the chain itself can attest the deletion. Without a marker, a pruned
    // chain was indistinguishable from one where someone hostile removed a
    // date range: the verifier anchors at the lowest surviving position and
    // trusts its prevRecordHash claim. Positions come from the envelope's
    // lifted top-level field; the last deleted entry is kept raw and
    // unwrapped after the transaction to read its integrityHash.
    let firstDeletedPos: number | undefined;
    let lastDeletedPos: number | undefined;
    let lastDeletedRaw: unknown;

    // PASS 1 (read-only): collect the oldest overflow entries WITH their
    // primary keys. Cursor order is insertion order (autoIncrement keys), so
    // this is the same oldest-first selection the destructive single-pass
    // version made — it just no longer deletes as it walks.
    //
    // Q82 NOTE (2026-08-11): do NOT naively exempt the month-rotation marker
    // here. Keeping it at chainPosition 0 while evicting positions 1..N
    // creates an INTERIOR gap, and both verifiers (chain-integrity's walker
    // and the embedded HTML verifier) require contiguity from the lowest
    // survivor — the exemption would make every rotated month read as a
    // broken chain. The correct fix is verifier-aware (a marker-attested gap
    // directly after a rotation marker); the ratified design lives in
    // docs/spec/subsystems/forensic-chain.md "Q82 design".
    const overflow: StoredEntry[] = [];
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const cursorReq = tx.objectStore(STORE_NAME).openCursor();
      cursorReq.onsuccess = (e) => {
        const c = (e.target as IDBRequest).result as IDBCursorWithValue | null;
        if (!c || overflow.length >= deleteTarget) return; // tx.oncomplete resolves
        overflow.push({ key: c.primaryKey, entry: c.value });
        c.continue();
      };
      cursorReq.onerror = () => reject(cursorReq.error);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('prune read transaction aborted'));
    });

    // Unwrap outside the transaction: unwrapStoredEntry is async and an IDB
    // transaction closes the moment its microtask queue drains.
    const undecoded = await unwrapStoredItems(overflow);

    // PASS 2: move them into their month archives. Nothing is deleted unless
    // this confirms, by reading back, that the archive holds it — the
    // eviction invariant in one line.
    const archiveOutcome = await archiveEvictedRecords(overflow);
    if (!archiveOutcome.ok) {
      console.warn(
        `[FeelingWise] Forensic prune: archiving ${overflow.length} overflow records failed (${archiveOutcome.reason}). ` +
        'Nothing deleted; the active chain stays over cap until the next run.',
      );
      db.close();
      // Over cap and nothing moved: said where the parent can see it when it repeats (wiring audit C28).
      void notePrune({ ok: false, reason: `archive-${archiveOutcome.reason}` });
      return 0;
    }

    const archivedKeys = new Set(archiveOutcome.archivedKeys.map(k => String(k)));
    // The contiguous archived PREFIX, not the archived subset.
    //
    // archiveEvictedRecords supports partial success: it can return ok with a
    // short key list. Deleting whatever it managed to archive then removed a
    // non-contiguous set — say positions 1, 2, 4, 5 while 3 stayed — which
    // punches a hole in the MIDDLE of the chain rather than truncating its
    // front. Two things break at once. The chain is the thing this product
    // sells, and an interior hole is the shape a reader cannot tell from
    // deletion; and the prune marker below records firstDeletedPos and
    // lastDeletedPos as a RANGE, so it would have claimed 1 through 5 gone
    // while 3 was still sitting there — a signed statement that is false.
    //
    // `overflow` is read in insertion order, which is chain order, so stopping
    // at the first entry the archive did not take leaves a front truncation:
    // the one shape the marker's range describes correctly and the verifier's
    // coverage arithmetic reads as missingBefore. Whatever was archived past
    // the stop point stays in the active chain too, which is a duplicate the
    // reader drops, never a loss.
    const evictable: StoredEntry[] = [];
    for (const item of overflow) {
      if (!archivedKeys.has(String(item.key))) break;
      evictable.push(item);
    }
    if (evictable.length < overflow.length) {
      console.warn(
        `[FeelingWise] Forensic prune: archive took ${archivedKeys.size} of ${overflow.length} overflow records, `
        + `and ${evictable.length} of them form the contiguous oldest run. Deleting only that run so the chain `
        + `truncates at the front instead of losing a record from the middle; the rest waits for the next prune.`,
      );
    }
    for (const item of evictable) {
      const pos = isCompressedEnvelope(item.entry)
        ? item.entry.chainPosition
        : (item.entry as ForensicRecord).chainPosition;
      if (typeof pos === 'number' && pos >= 0) {
        if (firstDeletedPos === undefined || pos < firstDeletedPos) firstDeletedPos = pos;
        if (lastDeletedPos === undefined || pos > lastDeletedPos) lastDeletedPos = pos;
      }
      lastDeletedRaw = item.entry;
    }

    // PASS 3: the signed prune marker, BEFORE anything is deleted (evidence-gap
    // register item 9, 2026-09-06). Written after the deletion and best-effort,
    // a failed marker left a hole the chain never explained, and the verifier
    // anchors at the lowest survivor and trusts its prevRecordHash claim, so
    // front truncation was invisible. The rotation path already takes this
    // order (chain-rotation.ts prepareRotationMarker before any cutover). If
    // the marker cannot be signed, nothing is deleted: the records stay in the
    // active chain and in the archive, a duplicate the reader drops.
    if (evictable.length === 0) {
      db.close();
      // Nothing to evict is a prune that RAN, and it has to say so. This exit
      // and the catch below returned without recording anything at all, which
      // let a prune that takes either of them every night leave the last
      // ok:true entry standing for ever while the active chain grew past its
      // cap (found by the adversarial read of the health module, 2026-09-18).
      // The health record is what the maintenance panel reads, so an entry
      // that never moves reads as a job that is fine.
      //
      // The two ways to arrive here are not the same job. With no overflow the
      // chain is within its cap and there was genuinely nothing to do. With
      // overflow and an empty evictable run, the archive took none of the
      // oldest records, so the chain is OVER its cap and this pass achieved
      // nothing: recording that as ok would refresh the entry nightly and hide
      // the one state the attention item exists for, which is a cap that never
      // comes down.
      void (overflow.length === 0
        ? notePrune({ ok: true, reason: 'within-cap' })
        : notePrune({ ok: false, reason: `archive-took-none-of-${overflow.length}-overflow` }));
      return 0;
    }
    try {
      await appendPruneMarker(evictable.length, maxRecords, firstDeletedPos, lastDeletedPos, lastDeletedRaw, archiveOutcome.months);
    } catch (err) {
      console.warn('[FeelingWise] prune marker could not be signed; nothing deleted, the prune waits for the next run:', err);
      db.close();
      void notePrune({ ok: false, reason: 'marker-signing-failed' });
      return 0;
    }

    // PASS 4: delete exactly the archived keys. A failure here is survivable
    // in the direction that matters — the records are already in the archive
    // and the marker is already on the chain, so the worst case is a
    // duplicate the reader drops and the next pass clears, never a loss.
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      for (const item of evictable) {
        store.delete(item.key);
        deleted++;
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      // An abort at commit fires neither oncomplete nor onerror. Without this
      // the promise never settles, the shared chain lock is never released
      // and every later record write waits for the rest of the worker's life.
      tx.onabort = () => reject(tx.error ?? new Error('prune transaction aborted'));
    });

    console.log(
      `[FeelingWise] Forensic store: archived ${deleted} oldest records into ${archiveOutcome.months.join(', ')} ` +
      `and removed them from the active chain (cap=${maxRecords}; ${undecoded} of the overflow did not decode and moved as stored bytes)`,
    );
    db.close();
    void notePrune({ ok: true });
    return deleted;
  } catch (err) {
    console.warn('[FeelingWise] Forensic prune failed:', err);
    openedDb?.close();
    // A prune that throws is the case the attention item exists for, and it
    // was the one exit that recorded nothing, so two failures in a row could
    // never be counted. See the note on the nothing-evictable exit above.
    void notePrune({ ok: false, reason: err instanceof Error ? (err.message || err.name) : String(err) });
    return 0;
  }
}

/**
 * Signed Prune Marker (wiring Q23). Joins the LIVE chain via getChainState
 * (unlike the reset marker, which restarts at genesis). The prune details
 * ride inside originalText, which the canonical payload hashes, so the
 * signature covers them without touching the canonical field list;
 * priorChainHash names the newest deleted record's integrityHash.
 * userAgeCategory honesty: when settings were unreadable (fail-closed
 * synthetic child snapshot), the hashed marker text says so instead of
 * silently attesting a child install.
 */
async function appendPruneMarker(
  deleted: number,
  cap: number,
  firstDeletedPos: number | undefined,
  lastDeletedPos: number | undefined,
  lastDeletedRaw: unknown,
  archivedMonths: string[] = [],
): Promise<void> {
  let priorChainHash: string | undefined;
  if (lastDeletedRaw !== undefined) {
    try {
      priorChainHash = (await unwrapStoredEntry(lastDeletedRaw)).integrityHash;
    } catch {
      // Legacy/corrupt entry — the marker still records the counts.
    }
  }
  const { nextPosition, prevRecordHash } = await getChainState();
  const attestation = await getSettingsForAttestation();
  const markerTimestamp = new Date().toISOString();
  const range = firstDeletedPos !== undefined && lastDeletedPos !== undefined
    ? ` positions=${firstDeletedPos}..${lastDeletedPos}`
    : '';
  const readFailedNote = attestation.readFailed ? ' settings-read-failed' : '';
  // `deleted` has always meant "removed from the ACTIVE chain". Since
  // archive-on-evict that is no longer the same as "destroyed", and a marker
  // that says only `deleted=` invites the reader to assume the worse of the
  // two. Naming the archive months makes the marker a pointer to where the
  // records went, verifiable by opening that month in the export.
  const archivedNote = archivedMonths.length > 0
    ? ` archived=${archivedMonths.join(',')}`
    : ' archived=none';
  const markerOriginalText =
    `[prune-marker @ ${markerTimestamp}] deleted=${deleted} cap=${cap}${range}${archivedNote}${readFailedNote}`;
  const partial: Omit<ForensicRecord, 'integrityHash' | 'signature'> = {
    id: `fr-prune-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: markerTimestamp,
    platform: 'twitter',
    originalText: markerOriginalText,
    originalHash: await sha256(markerOriginalText),
    originalLength: markerOriginalText.length,
    neutralizedText: '',
    author: '',
    postUrl: '',
    techniques: [],
    overallScore: 0,
    userAgeCategory: levelOf(attestation.mode),
    aiSource: 'none',
    feedSource: 'unknown',
    detectionMode: 'prune-marker',
    prevRecordHash,
    chainPosition: nextPosition,
    chainAnchor: 'cap-prune',
    verdict: 'pass',
    kind: 'prune-marker',
    priorChainHash,
    // Says where the records went, as the hashed text does. It named an internal key and
    // said deleted over records an archive had taken (read on an export, 2026-09-20).
    resetReason: archivedMonths.length > 0
      ? `the record reached its size limit: the ${deleted} oldest record${deleted === 1 ? ' was' : 's were'} moved out of the live record into the archive for ${archivedMonths.join(', ')}`
      : `the record reached its size limit: the ${deleted} oldest record${deleted === 1 ? ' was' : 's were'} removed, and no archive took ${deleted === 1 ? 'it' : 'them'}`,
    publicKeyFingerprint: await getPublicKeyFingerprint(),
  };
  await addRecord(await finalizeRecord(partial));
}

// ─── Stats ──────────────────────────────────────────────────────────────────
//
// The technique canonicaliser lives in technique-canonical.ts (14 Sep 2026);
// re-exported here for its existing importers and the unit tests.
export { canonicalizeTechniqueForStats } from './technique-canonical';
import { canonicalizeTechniqueForStats } from './technique-canonical';
import { isPaidPlacement } from './paid-placement';
import { isCountedFlagVerdict } from './flag-verdict';

export interface ForensicStats {
  total: number;
  byTechnique: Record<string, number>;
  byPlatform: Record<string, number>;
  today: number;
  thisWeek: number;
  thisMonth: number;
  /** `verdict: 'blocked'` records (rule-based AI-content
   *  blocker). Lifetime + this-week counts so the dashboard can surface the
   *  AI-blocker's activity without the parent guessing whether the feature
   *  is doing anything. Separate from `total` (which counts manipulation
   *  detections) so the two metrics don't bleed together. */
  blockedThisWeek: number;
  blockedTotal: number;
  /**
   * Historical chain records that have no signature. New addRecord writes
   * reject after bounded signing retries instead of landing unsigned, but
   * older records and restored records from the former best-effort policy
   * remain immutable and visible. Counted across the active chain
   * (chainPosition >= 0), excluding legacy pre-chain records.
   */
  unsignedRecordsCount: number;
}

/**
 * Pure stats over already-loaded records, so a caller that already holds the
 * decompressed chain (the dashboard boot) does not decompress it a second time.
 */
export function computeStats(records: ForensicRecord[]): ForensicStats {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const startOfWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay()).toISOString();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  // Stats describe MANIPULATION presence, not pipeline
  // throughput. Educational rewrites, pass records, and skipped records do
  // not represent manipulation the algorithm pushed to the user, so they
  // must not inflate `total`, `byTechnique`, `byPlatform`, or the time-based
  // counts. Verdict-undefined records are pre-Phase-1.6.2 (always flagged).
  // 'flagged-hidden' covers slur-tier comments FW removed from the kid's
  // view — same evidentiary status as 'flagged' (forensic-completeness
  // mandate, 2026-05-08: hidden slurs are recorded as exposure events).
  // Advertising is never manipulation presence (rebuild plan 2026-09-14,
  // standing decision 1). The child and teen pipeline writes a sponsored post
  // as flagged-hidden with technique consumer-rapid-frame at severity 6 from
  // the platform's own marker, so these counts, the technique league table and
  // the badge were half advertising on the owner's own install; the frozen
  // adult reader fired on none of the 75 ads in the 300-item blind read
  // (docs/research/BLIND-READ-2026-09-14.md). Ads count as paid placement in
  // the export's own column and are hidden by the user's Block Ads rule. The
  // records themselves are untouched.
  // A repeat-exposure mark alone is "seen a lot", not a flag (the Head, 10 Oct 2026): it leaves the total, the
  // per-platform bars and the technique league, as it left the Flagged tile.
  const flagged = records.filter(r => isCountedFlagVerdict(r) && !isPaidPlacement(r));
  // Separate counter for `verdict: 'blocked'` records
  // (rule-based AI-content blocker). Kept apart from `flagged` because they
  // represent FW's hard-rule action, not the detector's manipulation verdict;
  // mixing them would inflate the manipulation-presence metric the parent
  // reads at a glance.
  const blocked = records.filter(r => r.verdict === 'blocked');

  // Unsigned-record count across the entire chain (chainPosition >= 0,
  // signature === undefined). Surface for the dashboard banner per
  // audit A4-HIGH-3.
  const unsignedRecordsCount = records.filter(
    r => r.signature === undefined && typeof r.chainPosition === 'number' && r.chainPosition >= 0
      && r.chainAnchor !== 'pre-rekey',
  ).length;

  const stats: ForensicStats = {
    total: flagged.length,
    byTechnique: {},
    byPlatform: {},
    today: 0,
    thisWeek: 0,
    thisMonth: 0,
    blockedThisWeek: 0,
    blockedTotal: blocked.length,
    unsignedRecordsCount,
  };

  for (const r of flagged) {
    // Count by platform
    stats.byPlatform[r.platform] = (stats.byPlatform[r.platform] || 0) + 1;

    // Count by technique. Aggregate by CANONICAL technique
    // label so existing chain records with LLM-variant labels (e.g. "genuine-
    // opinie" and "opinie sinceră" — both produced by the comment-rewriter
    // path before the normalizer covered them) consolidate into a
    // single dashboard bucket. Without canonicalization the chart
    // splits "Opinie Sinceră" (19) from "Genuine Opinie" (12) despite
    // being the same technique. The rewriter's normalizer only
    // catches NEW records; this display-time canonicalization fixes
    // EXISTING records too.
    // Once per RECORD, not once per entry: a record whose two variant labels
    // fold into one canonical bucket counted that bucket twice (wiring audit
    // 13 Sep, C31), so the Statistics bar could exceed the number of records
    // it described.
    const seenHere = new Set<string>();
    for (const t of r.techniques) {
      const canonicalName = canonicalizeTechniqueForStats(t.name);
      if (seenHere.has(canonicalName)) continue;
      seenHere.add(canonicalName);
      stats.byTechnique[canonicalName] = (stats.byTechnique[canonicalName] || 0) + 1;
    }

    // Time-based counts
    if (r.timestamp >= startOfDay) stats.today++;
    if (r.timestamp >= startOfWeek) stats.thisWeek++;
    if (r.timestamp >= startOfMonth) stats.thisMonth++;
  }

  for (const r of blocked) {
    if (r.timestamp >= startOfWeek) stats.blockedThisWeek++;
  }

  return stats;
}

// ─── Parent-feedback sidecar (v4) ──────────────────────────────────────────
//
// Each entry annotates one ForensicRecord with the parent's verdict on FW's
// flag: 'confirmed' (parent endorses the flag), 'disputed' (parent disagrees).
// One entry per recordId — re-voting overwrites. recordId-keyed for O(1)
// lookup from the dashboard card render path.
//
// Chain-mirror invariant per VISION §1.1: original records are immutable +
// append-only. Feedback lives ALONGSIDE the chain as a separate parent-
// authored layer of evidence, not a mutation of FW's audit trail.
//
// Signing: best-effort over a deterministic canonical string. Failure-tolerant
// (chrome missing in tests, signing key not yet provisioned) — sidecar entry
// still writes without signature; export integration in V1.5 will fall back
// to "unsigned-feedback" rendering when signature absent.

export interface ParentFeedback {
  recordId: string;
  feedback: 'confirmed' | 'disputed';
  timestamp: string;
  signature?: string;
  publicKeyFingerprint?: string;
}

function parentFeedbackCanonical(entry: Omit<ParentFeedback, 'signature' | 'publicKeyFingerprint'>): string {
  return `${entry.recordId}|${entry.feedback}|${entry.timestamp}`;
}

export async function addParentFeedback(
  recordId: string,
  feedback: 'confirmed' | 'disputed',
): Promise<ParentFeedback> {
  const entry: ParentFeedback = {
    recordId,
    feedback,
    timestamp: new Date().toISOString(),
  };
  try {
    const canonical = parentFeedbackCanonical(entry);
    const hashHex = await sha256(canonical);
    const signature = await signHash(hashHex).catch(() => undefined);
    if (signature) entry.signature = signature;
    const fingerprint = await getPublicKeyFingerprint().catch(() => undefined);
    if (fingerprint) entry.publicKeyFingerprint = fingerprint;
  } catch (err) {
    console.warn('[FeelingWise] parentFeedback signing best-effort failed:', err);
  }

  const db = await openDB();
  return new Promise<ParentFeedback>((resolve, reject) => {
    const tx = db.transaction(PARENT_FEEDBACK_STORE_NAME, 'readwrite');
    tx.objectStore(PARENT_FEEDBACK_STORE_NAME).put(entry);
    tx.oncomplete = () => { db.close(); resolve(entry); };
    tx.onerror = () => { db.close(); reject(tx.error); };
    tx.onabort = () => { db.close(); reject(tx.error ?? new Error('parent feedback transaction aborted')); };
  });
}

/**
 * Take back a Confirm or Dispute (wiring audit 13 Sep, D1-29: a press could not
 * be undone). The annotation is the parent's own, beside the record, never in
 * it: removing one changes no record and no hash.
 */
export async function removeParentFeedback(recordId: string): Promise<void> {
  const db = await openDB();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(PARENT_FEEDBACK_STORE_NAME, 'readwrite');
    tx.objectStore(PARENT_FEEDBACK_STORE_NAME).delete(recordId);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
    // The one readwrite transaction in this file that was still missing it: an
    // abort at commit fires neither oncomplete nor onerror, so the promise never
    // settles and the connection is never closed (2026-09-19). Every sibling
    // here has carried this line since the prune path needed it.
    tx.onabort = () => { db.close(); reject(tx.error ?? new Error('parent feedback remove aborted')); };
  });
}

export async function getAllParentFeedback(): Promise<Map<string, ParentFeedback>> {
  try {
    const db = await openDB();
    const list = await new Promise<ParentFeedback[]>((resolve, reject) => {
      const tx = db.transaction(PARENT_FEEDBACK_STORE_NAME, 'readonly');
      const req = tx.objectStore(PARENT_FEEDBACK_STORE_NAME).getAll();
      req.onsuccess = () => { db.close(); resolve(req.result as ParentFeedback[]); };
      req.onerror = () => { db.close(); reject(req.error); };
    });
    const m = new Map<string, ParentFeedback>();
    for (const e of list) m.set(e.recordId, e);
    return m;
  } catch (err) {
    console.warn('[FeelingWise] getAllParentFeedback failed:', err);
    return new Map();
  }
}

export async function clearAllParentFeedback(): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(PARENT_FEEDBACK_STORE_NAME, 'readwrite');
      tx.objectStore(PARENT_FEEDBACK_STORE_NAME).clear();
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
      tx.onabort = () => { db.close(); reject(tx.error ?? new Error('parent feedback clear aborted')); };
    });
  } catch (err) {
    console.warn('[FeelingWise] clearAllParentFeedback failed:', err);
    // The reset is the only caller, and it can name this part as not cleared only if it sees the failure.
    throw err;
  }
}

// The shape lives in src/types/chain-reset.ts so the types layer imports nothing (PLAN-2026-09-16 item 8.6);
// every importer of this module keeps working through this re-export.
export type { ResetChainResult } from '../types/chain-reset';
