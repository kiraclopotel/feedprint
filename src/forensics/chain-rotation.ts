// FeelingWise — per-month forensic chain rotation.
//
// At UTC month-flip, the active chain in `feelingwise-forensics` is archived
// into a per-month database `feelingwise-forensics-YYYY-MM` and a fresh
// chain starts in the active DB. The first record of the fresh chain is a
// Rotation Marker (kind='month-rotation-marker', chainAnchor='month-rotation')
// whose `priorChainHash` field links to the archived chain's terminal hash.
//
// Cross-month verification follows the chain-of-chains: walks the current
// chain → finds the Rotation Marker at chainPosition 0 → opens the named
// archive DB → verifies that month's chain ends at the claimed hash →
// recurses if the archive itself begins with another Rotation Marker.
//
// VISION §1.1 contract:
//   • Chain integrity preserved across rotation (cryptographic link via
//     priorChainHash). Forensic recipient can verify the entire history.
//   • Rotation never fires on a broken chain — would freeze the broken
//     state into an archive forever. Parent must resolve breaks first.
//   • The Rotation Marker's `kind` is in the canonical payload hash, so
//     tampering "rotation -> reset" or vice versa breaks the signature.
//   • Archive copies preserve per-record envelopes (Phase 1a compression).
//     No additional DB-level compression is applied to archives.

import type { ForensicRecord } from '../types/forensic';
import { CHAIN_GENESIS_HASH, verifyChainIntegrity, type DamagedRow } from './chain-integrity';
import { sameStoredBytes, storedEntryIndexFields, unwrapStoredEntry } from './record-compression';
import { computeRecordIntegrityHash } from './canonical-payload';
import { finalizeRecord } from './record-stamp';
import { getPublicKeyFingerprint } from './signing';
import { sha256 } from './hasher';
// Shared per-realm lock so the rotation marker write serializes against
// any concurrent logger chain writes. Audit A4-HIGH-2 closure.
import { sharedChainWriteLock } from './chain-write-lock';
// Single source of truth for the active-DB schema version (regression F-1):
// rotation opens the SAME 'feelingwise-forensics' DB store.ts created, so it
// must request the identical version or indexedDB.open throws VersionError
// and month-rotation silently never runs.
import {
  FORENSIC_DB_VERSION,
  FORENSIC_DELIVERY_META_STORE,
  openDB,
  prepareRecordForStorage,
} from './store';
import { getSettingsForAttestation } from '../storage/settings';
import { getForensicDeliveryStatus } from './delivery-outbox';
import { ARCHIVE_ANCHORS_STORE, openArchiveDb, utcMonthKey } from './archive-naming';
import { rebaseChainHeightWitness } from './chain-height-witness';
import { dropSummaryForMonth } from './archive-summary-store';
import { levelOf } from '../types/mode';

const RECORDS_STORE = 'records';
// The RFC 3161 anchor sidecar store, owned by store.ts's schema (v5). Named
// locally rather than imported from chain-anchor-store.ts so rotation does not
// pull that module (and its TSA/network graph) into the SW bundle — the same
// import-hygiene reason store.ts clears anchors via its own local helper
// (known-issues M40). Must equal store.ts's CHAIN_ANCHOR_STORE_NAME.
const CHAIN_ANCHOR_STORE_NAME = 'chainAnchors';
export const ACTIVE_DB_VERSION = FORENSIC_DB_VERSION;

// Archive naming + opening now live in archive-naming.ts so the eviction
// writer can share them without importing this module (which imports
// store.ts). Re-exported here: every existing importer of these four keeps
// working unchanged.
export {
  utcMonthKey,
  previousUtcMonthKey,
  archiveDbName,
  parseArchiveDbName,
} from './archive-naming';

function openActiveDb(): Promise<IDBDatabase> {
  // store.ts owns every active-DB migration. Delegating avoids a version bump
  // that opens successfully but skips creation of a newly-added object store.
  return openDB();
}

/**
 * Is every record rotation is retiring now safely in the archive?
 *
 * Replaces an exact whole-chain equality check. That check assumed rotation
 * was the only writer of a month archive; since archive-on-evict
 * (archive-writer.ts) the archive normally already holds this month's earlier
 * overflow, so equality is the wrong question and would block every rotation.
 *
 * Containment is the right one, and it is not weaker where it matters. The
 * failure worth catching is "the archive does not actually hold the chain
 * being cleared from the active DB", and all three clauses below still catch
 * it: every source record present BY IDENTITY (id plus the fields the
 * canonical payload excludes), every archived copy of a source record still
 * hashing to its own integrityHash, and those copies still walking clean.
 *
 * Only the retiring chain's own rows are hashed and walked, because a month
 * archive can also hold the chain a reset retired earlier that month, and the
 * two walked as one chain always fail at the second position 0.
 */
async function archiveContainsSource(
  sourceRecords: ForensicRecord[],
  archiveRecords: ForensicRecord[],
  damaged: readonly DamagedRow[] = [],
): Promise<boolean> {
  if (archiveRecords.length < sourceRecords.length) return false;

  const sourceIds = new Set(sourceRecords.map(record => record.id));
  const retiringCopies = archiveRecords.filter(record => sourceIds.has(record.id));
  for (const record of retiringCopies) {
    if (await computeRecordIntegrityHash(record) !== record.integrityHash) return false;
  }
  if (!(await verifyChainIntegrity(retiringCopies, damaged)).valid) return false;

  // The canonical hash covers the payload; this descriptor also covers the
  // three fields deliberately excluded from that payload, so a record that
  // matches by id but differs in position, signature or anchor is not a match.
  const describe = (record: ForensicRecord) => JSON.stringify([
    record.id,
    record.chainPosition ?? null,
    record.integrityHash,
    record.signature ?? null,
    record.chainAnchor ?? null,
  ]);
  const archived = new Set(archiveRecords.map(describe));
  return sourceRecords.every(record => archived.has(describe(record)));
}

/** Decode each stored row that will decode, and keep the ones that will not as they were stored. */
async function unwrapTolerant(entries: unknown[]): Promise<{ records: ForensicRecord[]; undecoded: unknown[] }> {
  const records: ForensicRecord[] = [];
  const undecoded: unknown[] = [];
  for (const entry of entries) {
    try {
      records.push(await unwrapStoredEntry(entry));
    } catch {
      undecoded.push(entry);
    }
  }
  return { records, undecoded };
}

export interface RotateResult {
  rotated: boolean;
  reason?:
    | 'no-rotation-needed'
    | 'pending-deliveries'
    | 'chain-broken'
    | 'archive-already-exists'
    | 'archive-mismatch'
    | 'marker-signing-failed'
    | 'storage-unavailable'
    | 'storage-error';
  archivedMonth?: string;
  archivedCount?: number;
  /** Of `archivedCount`, the rows that did not decode and were carried as their stored bytes. */
  undecodedCarried?: number;
  terminalHash?: string;
  rotationMarkerWritten?: boolean;
  rotationMarkerId?: string;
}

/**
 * Detect month-flip + archive the prior month. Idempotent: safe to call
 * many times per day; only acts when the active chain contains records
 * from a different UTC month than the current one.
 *
 * Mode: 'auto' = only rotate when the latest active-chain record is from
 * a different UTC month than `now`. 'force' = rotate regardless (used by
 * tests + manual dev triggers).
 */
export async function rotateChainAtMonthFlip(
  now: Date = new Date(),
  mode: 'auto' | 'force' = 'auto',
): Promise<RotateResult> {
  if (typeof indexedDB === 'undefined') {
    return { rotated: false, reason: 'storage-unavailable' };
  }

  return sharedChainWriteLock(() => rotateChainLocked(now, mode));
}

async function rotateChainLocked(
  now: Date,
  mode: 'auto' | 'force',
): Promise<RotateResult> {
  let activeDb: IDBDatabase | null = null;
  try {
    // Captures must land in their original chain epoch. Enqueue uses this same
    // SW lock, so a zero count cannot race a new durable delivery before the
    // cutover. The pump drains after this lock releases; the next alarm retries.
    if ((await getForensicDeliveryStatus()).pendingCount > 0) {
      return { rotated: false, reason: 'pending-deliveries' };
    }
    activeDb = await openActiveDb();

    const entries: unknown[] = await new Promise((resolve, reject) => {
      const tx = activeDb!.transaction(RECORDS_STORE, 'readonly');
      const req = tx.objectStore(RECORDS_STORE).getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    if (entries.length === 0) {
      activeDb.close();
      return { rotated: false, reason: 'no-rotation-needed' };
    }

    // A row that will not decode is carried into the archive as its stored
    // bytes and walked as damaged, so one bad row cannot stop the rotation.
    const { records, undecoded } = await unwrapTolerant(entries);
    const damaged = undecoded.map(storedEntryIndexFields);

    // Detect rotation need. Ordinarily the latest active record determines
    // the month. After a rotation, however, a capture from the prior month may
    // arrive late and be appended with explicit provenance. The signed marker
    // remains the epoch authority so that late evidence cannot immediately
    // re-rotate the fresh chain back into its capture month.
    let terminalRecord: ForensicRecord | undefined;
    let oldestRecord: ForensicRecord | undefined;
    let activeRotationMarker: ForensicRecord | undefined;
    for (const r of records) {
      if (r.chainPosition === undefined || r.chainPosition < 0) continue;
      // Relegated (pre-rekey) records keep their original chainPosition but
      // belong to a prior chain — never the active terminal.
      if (r.chainAnchor === 'pre-rekey') continue;
      if (!terminalRecord || (r.chainPosition ?? -1) > (terminalRecord.chainPosition ?? -1)) {
        terminalRecord = r;
      }
      if (!oldestRecord || (r.chainPosition ?? -1) < (oldestRecord.chainPosition ?? -1)) {
        oldestRecord = r;
      }
      if (r.chainPosition === 0 && r.kind === 'month-rotation-marker') {
        activeRotationMarker = r;
      }
    }
    if (!terminalRecord) {
      activeDb.close();
      return { rotated: false, reason: 'no-rotation-needed' };
    }

    const currentMonthKey = utcMonthKey(now);
    const terminalMonthKey = utcMonthKey(new Date(terminalRecord.timestamp));
    // The epoch's month: the signed marker when there is one, and otherwise the
    // OLDEST active record rather than the newest.
    //
    // The fallback was the newest record's month, which latches rotation off
    // for good the moment the position-0 marker leaves. The cap prune deletes
    // oldest-first, so on any install that reaches the cap the marker is the
    // first thing to go — and then the test becomes "is the newest record from
    // this month?", which on a live install is always yes. Rotation would never
    // fire again, and nothing would say so.
    //
    // The oldest active record answers the question rotation actually asks:
    // does the active chain still hold records from a month that is over? It
    // agrees with the marker while the marker exists (the marker IS the oldest
    // record, at position 0) and survives it being pruned.
    const oldestMonthKey = oldestRecord ? utcMonthKey(new Date(oldestRecord.timestamp)) : terminalMonthKey;
    const activeEpochMonthKey = activeRotationMarker
      ? utcMonthKey(new Date(activeRotationMarker.timestamp))
      : oldestMonthKey;
    if (mode === 'auto' && activeEpochMonthKey === currentMonthKey) {
      activeDb.close();
      return { rotated: false, reason: 'no-rotation-needed' };
    }

    // Refuse to archive a broken chain — would freeze the broken state into
    // an archive forever (VISION §1.1). Parent must resolve via re-anchor
    // before any rotation fires for them.
    const integrity = await verifyChainIntegrity(records, damaged);
    if (!integrity.valid) {
      activeDb.close();
      console.warn(
        `[FeelingWise] rotateChainAtMonthFlip: chain broken (${integrity.brokenKind} at ${integrity.brokenAt}). Skipping rotation.`,
      );
      return { rotated: false, reason: 'chain-broken' };
    }

    const archiveMonth = activeEpochMonthKey;
    let markerResult: Awaited<ReturnType<typeof prepareRotationMarker>>;
    try {
      // Prepare the signed marker before either archive or active storage
      // changes. Persistent signing failure therefore preserves the source.
      markerResult = await prepareRotationMarker({
        now,
        priorChainHash: terminalRecord.integrityHash,
        archivedMonth: archiveMonth,
      });
    } catch (err) {
      activeDb.close();
      activeDb = null;
      console.error('[FeelingWise] Rotation marker preparation failed:', err);
      return { rotated: false, reason: 'marker-signing-failed', archivedMonth: archiveMonth };
    }
    activeDb.close();
    activeDb = null;

    // A previous attempt may have committed the archive but failed the active
    // cutover. Reuse only an exact count + terminal-hash match.
    const archiveDb = await openArchiveDb(archiveMonth);
    try {
      const existingEntries: unknown[] = await new Promise((resolve, reject) => {
        const tx = archiveDb.transaction(RECORDS_STORE, 'readonly');
        const req = tx.objectStore(RECORDS_STORE).getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      // By the id on each row's envelope, so a row that will not decode is matched too.
      const existingIds = new Set(existingEntries.map(entry => storedEntryIndexFields(entry).id));

      // A month archive is no longer written by rotation alone. Eviction
      // (archive-writer.ts) appends this month's overflow to the SAME
      // database whenever the active chain passes its cap, so by the time
      // rotation runs the archive normally already holds a prefix of what
      // rotation is about to copy. The old check demanded an exact whole-chain
      // match and returned 'archive-already-exists' on anything else, which
      // after archive-on-evict would refuse every real rotation.
      //
      // The check that replaces it is by record id: append what is missing,
      // then require that the archive contains EVERY source record. That
      // still catches the failure the exact-match check existed to catch (an
      // archive that does not hold the chain being retired) while tolerating
      // the one it now must (an archive that already holds part of it).
      const missingEntries = entries.filter(entry => !existingIds.has(storedEntryIndexFields(entry).id));
      const wroteThisPass = missingEntries.length > 0;

      if (wroteThisPass) {
        // Copy entries (still in stored envelope form) into the archive DB.
        // Reads from active DB AS-STORED so envelopes go in compressed.
        await new Promise<void>((resolve, reject) => {
          const tx = archiveDb.transaction(RECORDS_STORE, 'readwrite');
          const store = tx.objectStore(RECORDS_STORE);
          for (const entry of missingEntries) {
            store.add(entry);
          }
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error ?? new Error('archive copy tx aborted'));
        });
        // The month's stored summary no longer describes it (item 7); the
        // next reader recomputes it from the records.
        await dropSummaryForMonth(archiveDb, archiveMonth);
      }

      // Read back and verify ALWAYS, including when every id was already
      // present and nothing was written. Matching ids are not evidence of
      // matching content: an archive can hold all the right ids with a
      // corrupted row among them, and treating "nothing to write" as
      // "verified" would clear the good active chain in favour of that
      // archive. Verification is the precondition for the cutover, so it
      // runs on the path that skips the write too.
      const archiveCheckEntries: unknown[] = await new Promise((resolve, reject) => {
        const tx = archiveDb.transaction(RECORDS_STORE, 'readonly');
        const req = tx.objectStore(RECORDS_STORE).getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      // Carry the outgoing month's independent timestamps across with its
      // records. The cutover below clears the active sidecar, and until
      // 2026-09-04 nothing copied it anywhere, so every archived month lost
      // the one piece of evidence in it that FeelingWise and the person
      // holding the computer did not produce. Keyed by anchor id, so a
      // rotation that already wrote the archive and then failed the cutover
      // overwrites rather than duplicates on the retry.
      //
      // Copied BEFORE the cutover transaction and outside it, because the
      // cutover is one transaction on the ACTIVE database and this writes to
      // the archive database. A copy that lands without a cutover is harmless:
      // the anchors are still true about records that are still where they
      // were, and the retry overwrites them.
      const activeAnchorsDb = await openActiveDb();
      let anchorsToArchive: unknown[] = [];
      try {
        anchorsToArchive = await new Promise<unknown[]>((resolve, reject) => {
          const tx = activeAnchorsDb.transaction(CHAIN_ANCHOR_STORE_NAME, 'readonly');
          const req = tx.objectStore(CHAIN_ANCHOR_STORE_NAME).getAll();
          req.onsuccess = () => resolve(req.result as unknown[]);
          req.onerror = () => reject(req.error);
        });
      } finally {
        activeAnchorsDb.close();
      }
      if (anchorsToArchive.length > 0) {
        await new Promise<void>((resolve, reject) => {
          const tx = archiveDb.transaction(ARCHIVE_ANCHORS_STORE, 'readwrite');
          const store = tx.objectStore(ARCHIVE_ANCHORS_STORE);
          for (const anchor of anchorsToArchive) store.put(anchor);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error ?? new Error('archive anchor copy tx aborted'));
        });
      }

      const archiveCheck = (await unwrapTolerant(archiveCheckEntries)).records;
      // A row that did not decode has no record to compare, so its copy must be the same bytes.
      const undecodedCarried = undecoded.every(row => archiveCheckEntries.some(copy => sameStoredBytes(copy, row)));
      if (!undecodedCarried || !(await archiveContainsSource(records, archiveCheck, damaged))) {
        // Distinguish the two failures, because they need different actions.
        // 'archive-mismatch': this pass wrote and the result did not verify —
        // a storage fault. 'archive-already-exists': a pre-existing archive
        // this pass did not touch cannot be trusted — it needs a human, and
        // rotation must not overwrite it.
        const reason = wroteThisPass ? 'archive-mismatch' as const : 'archive-already-exists' as const;
        console.error(
          `[FeelingWise] rotateChainAtMonthFlip: archive ${archiveMonth} failed verification (${reason}). Active chain left intact.`,
        );
        return { rotated: false, reason, archivedMonth: archiveMonth };
      }
    } finally {
      archiveDb.close();
    }

    // Replace the active rows, clear the outgoing epoch's anchor sidecar, and
    // publish the capture-time epoch fence in ONE IDB transaction. Abort rolls
    // back clear + add + anchor-clear + fence together.
    activeDb = await openActiveDb();
    await new Promise<void>((resolve, reject) => {
      const tx = activeDb!.transaction(
        [RECORDS_STORE, CHAIN_ANCHOR_STORE_NAME, FORENSIC_DELIVERY_META_STORE],
        'readwrite',
      );
      const store = tx.objectStore(RECORDS_STORE);
      const anchors = tx.objectStore(CHAIN_ANCHOR_STORE_NAME);
      const meta = tx.objectStore(FORENSIC_DELIVERY_META_STORE);
      store.clear();
      store.add(markerResult.envelope);
      // Sidecar cutover (FOR-1): the RFC 3161 anchors bound prior-month
      // chainPositions/hashes that this rotation just moved to the archive DB.
      // Their truth belonged to the outgoing epoch, so clear them here —
      // mirroring reset's clearChainAnchors (store.ts:856-864,1104) and
      // restore's anchorStore.clear() (store.ts:467), and folded into this SAME
      // atomic cutover tx so the disposition commits or rolls back with the
      // record swap (capture-time-fence discipline). Leaving them stranded
      // (1) starved the fresh chain: getLatestAnchor returns the stale
      // max-position anchor, and the fresh chain's positions start again below
      // it, so anchorChainHead finds nothing past it and the independent
      // TSA-time layer never re-anchors after the first rotation; and
      // (2) let post-rotation exports embed anchors (getAnchors()) covering
      // records absent from the active set. Since 2026-09-04 the anchors are
      // copied into the archive month's own `anchors` store above before this
      // clear, so retiring a month no longer destroys its independent time
      // evidence. Signed records + their hashes are untouched; this is sidecar
      // bookkeeping only.
      anchors.clear();
      meta.put({ key: 'rotationCutoff', capturedAt: markerResult.capturedAt });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('active rotation tx aborted'));
    });
    activeDb.close();
    activeDb = null;

    // The fresh chain starts with the rotation marker at position 0, so its
    // height is 1. Tell the chain height note, or the next check reads a
    // routine month flip as a destroyed record (M186's open half,
    // forensics/chain-height-witness.ts).
    await rebaseChainHeightWitness('month-rotation', 1);

    return {
      rotated: true,
      archivedMonth: archiveMonth,
      archivedCount: entries.length,
      ...(undecoded.length > 0 ? { undecodedCarried: undecoded.length } : {}),
      terminalHash: terminalRecord.integrityHash,
      rotationMarkerWritten: true,
      rotationMarkerId: markerResult.id,
    };
  } catch (err) {
    const dbToClose = activeDb as IDBDatabase | null;
    if (dbToClose) {
      try { dbToClose.close(); } catch { /* noop */ }
    }
    console.error('[FeelingWise] rotateChainAtMonthFlip failed:', err);
    return { rotated: false, reason: 'storage-error' };
  }
}

/**
 * Build, sign, and compress a Rotation Marker without touching IndexedDB.
 */
async function prepareRotationMarker(args: {
  now: Date;
  priorChainHash: string;
  archivedMonth: string;
}) {
  const nowIso = args.now.toISOString();
  // Attestation seam (Q24): a rotation marker written while settings were
  // unreadable names that state in its hashed text instead of attesting the
  // synthetic fail-closed child mode as a real setting.
  const attestation = await getSettingsForAttestation();
  const markerText = `[month-rotation @ ${nowIso} from=${args.archivedMonth}]${attestation.readFailed ? ' settings-read-failed' : ''}`;
  const markerHash = await sha256(markerText);

  const publicKeyFingerprint = await getPublicKeyFingerprint();
  const activeMode = attestation.mode;

  const partial: Omit<ForensicRecord, 'integrityHash' | 'signature'> = {
    id: `fr-rotation-${args.archivedMonth}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: nowIso,
    // Platform field is required by the type but doesn't carry semantics
    // for rotation markers. 'twitter' matches the reset-marker convention.
    // Dashboard renders these by `kind`.
    platform: 'twitter',
    originalText: markerText,
    originalHash: markerHash,
    originalLength: markerText.length,
    neutralizedText: '',
    author: '',
    postUrl: '',
    techniques: [],
    overallScore: 0,
    userAgeCategory: levelOf(activeMode),
    aiSource: 'none',
    feedSource: 'unknown',
    detectionMode: 'month-rotation-marker',
    prevRecordHash: CHAIN_GENESIS_HASH,
    chainPosition: 0,
    chainAnchor: 'month-rotation',
    verdict: 'pass',
    kind: 'month-rotation-marker',
    priorChainHash: args.priorChainHash,
    publicKeyFingerprint,
  };

  const record: ForensicRecord = await finalizeRecord(partial);
  const envelope = await prepareRecordForStorage(record);
  return { id: partial.id, capturedAt: nowIso, envelope };
}
