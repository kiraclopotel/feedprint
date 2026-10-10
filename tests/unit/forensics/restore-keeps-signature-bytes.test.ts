// Promise: restore-keeps-signature-bytes (scripts/verify/promises.product.registry.mjs).
//
// "A restore brings every saved entry back with the signature bytes it was written with."
// (src/i18n/dashboard/en.ts backupIntro). backup.ts's own docblock makes the same claim about its
// design: "Records ... are written back VERBATIM (no re-signing) via store.
// replaceBackupStateUnderChainLock, so the original signatures keep verifying." This drives the
// real public entry point a restore button calls — buildBackupBlob and restoreFromBackup, from
// src/forensics/backup.ts — over a real fake-indexeddb chain, with tests/helpers/faulty-indexeddb.ts
// standing in for a store that does not always keep what it is given (the interesting half of this
// promise, per the task this test was written against: what happens when the restore does not fully
// land).
//
// What is mocked and why: signing.ts is replaced with a deterministic pair (signHash/verifyHash tied
// to the record's own integrityHash) rather than real WebCrypto, so a corrupted signature is
// DETECTABLY wrong instead of needing a real keypair to prove the point — the promise is about
// whether the BYTES survive a restore, not about ECDSA correctness (canonical-payload-stability.test.ts
// and settings-pin-hash.test.ts already exercise real crypto elsewhere). chain-anchor-store,
// known-keys, key-genesis, delivery-outbox and backup-folder-wire are mocked because this test's
// backup carries no anchors, no wrapped key and no queued deliveries — they are the same peripheral
// mocks backup-round-trip.test.ts uses. store.ts and chain-integrity.ts are real: the whole point is
// to watch the actual write path and the actual post-restore verification, not a stand-in for either.

import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function sigFor(hash: string): string {
  return `sig-${hash}`;
}

vi.mock('../../../src/forensics/signing', () => ({
  signHash: vi.fn(async (hash: string) => sigFor(hash)),
  verifyHash: vi.fn(async (hash: string, signature: string) => signature === sigFor(hash)),
  getPublicKeyFingerprint: vi.fn(async () => 'fp-current'),
  getPublicKeyJWK: vi.fn(async () => ({ kty: 'EC', crv: 'P-256', x: 'x', y: 'y' })),
  getSigningKeyCreatedAt: vi.fn(async () => null),
  exportWrappedPrivateKey: vi.fn(),
  prepareSigningKeyRestore: vi.fn(),
  commitSigningKeyRestore: vi.fn(),
}));
vi.mock('../../../src/forensics/chain-anchor-store', () => ({ getAnchors: vi.fn(async () => []) }));
vi.mock('../../../src/forensics/known-keys', () => ({ rememberPublicKeys: vi.fn(async () => undefined) }));
vi.mock('../../../src/forensics/key-genesis', () => ({
  getKeyGenesis: vi.fn(async () => null),
  restoreKeyGenesis: vi.fn(async () => undefined),
}));
vi.mock('../../../src/forensics/delivery-outbox', () => ({
  getForensicDeliveryStatus: vi.fn(async () => ({ pendingCount: 0 })),
}));
vi.mock('../../../src/forensics/backup-folder-wire', () => ({
  getBackupFolderWireStatus: vi.fn(async () => ({ state: 'none' })),
  writeBackupToWiredFolder: vi.fn(),
  LATEST_BACKUP_FILENAME: 'feelingwise-latest.json',
  RESTORE_KEY_FILENAME: 'feelingwise-restore.key',
  restoreKeyFileContents: vi.fn((s: string) => s),
}));
// Store.ts's own module-level imports; mocked the same way
// tests/unit/forensics/restore-round-trip-over-a-truncated-write.test.ts already does, so the
// real store + real chain-integrity underneath do not need a real chrome.storage-backed settings
// blob to run.
vi.mock('../../../src/storage/settings', () => ({
  getSettings: vi.fn(async () => ({ mode: 'adult' })),
  getSettingsForAttestation: vi.fn(async () => ({ mode: 'adult', readFailed: false })),
  resetUsageStats: vi.fn(async () => undefined),
}));

import type { ForensicRecord } from '../../../src/types/forensic';
import { getRecordsOrThrow, getRecordsDetailed, openDB } from '../../../src/forensics/store';
import { computeRecordIntegrityHash } from '../../../src/forensics/canonical-payload';
import { compressRecord } from '../../../src/forensics/record-compression';
import { verifyChainIntegrity, CHAIN_GENESIS_HASH } from '../../../src/forensics/chain-integrity';
import { archiveDbName } from '../../../src/forensics/archive-naming';
import { buildBackupBlob, restoreFromBackup, assembleBackup } from '../../../src/forensics/backup';
import { deleteDbs } from '../../helpers/indexeddb';
import { installChromeStorageStub, type ChromeStorageStub } from '../../helpers/chrome-storage';
import { installFaultyIndexedDB, storageTestRecord, type FaultyIndexedDB } from '../../helpers/faulty-indexeddb';

const DB = 'feelingwise-forensics';
const MONTH = '2026-08';

let idb: FaultyIndexedDB;
let storage: ChromeStorageStub;

/** A real, signed record: integrityHash and signature both computed for real, from distinct content. */
async function signedRecord(id: string, chainPosition: number, prevHash: string): Promise<ForensicRecord> {
  // publicKeyFingerprint is part of the canonical hash (canonical-payload.ts's own docblock), so it
  // must be on the record BEFORE computeRecordIntegrityHash runs — added after would make this
  // record fail its own structural check the moment anything recomputes the hash.
  const partial = storageTestRecord({
    id,
    chainPosition,
    timestamp: new Date(Date.UTC(2026, 7, 10, 12, chainPosition)).toISOString(),
    originalText: `post ${id}, long enough that compression has something to do`,
    prevRecordHash: prevHash,
    publicKeyFingerprint: 'fp-current',
  } as Partial<ForensicRecord> & { id: string });
  const integrityHash = await computeRecordIntegrityHash(partial);
  return {
    ...partial,
    integrityHash,
    signature: sigFor(integrityHash),
  } as ForensicRecord;
}

/** A real, correctly-linked chain: each record's prevRecordHash is the one before it's integrityHash. */
async function signedChain(ids: string[]): Promise<ForensicRecord[]> {
  const out: ForensicRecord[] = [];
  let prevHash = CHAIN_GENESIS_HASH;
  for (let i = 0; i < ids.length; i++) {
    const r = await signedRecord(ids[i], i, prevHash);
    out.push(r);
    prevHash = r.integrityHash;
  }
  return out;
}

beforeEach(async () => {
  idb = installFaultyIndexedDB();
  storage = installChromeStorageStub();
  await deleteDbs(DB, archiveDbName(MONTH));
});

afterEach(async () => {
  idb.clearFaults();
  await deleteDbs(DB, archiveDbName(MONTH));
  storage.restore();
  idb.restore();
});

describe('restore-keeps-signature-bytes: the honest round trip', () => {
  it('every restored record carries the exact signature bytes the backup file held', async () => {
    const records = await signedChain(['r0', 'r1', 'r2', 'r3']);
    // Seed the "outgoing install": write the records for real, then read them back to build the
    // backup file the way the dashboard's "Back up now" button does.
    const envelopes = await Promise.all(records.map((r) => compressRecord(r)));
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('records', 'readwrite');
      for (const e of envelopes) tx.objectStore('records').add(e);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('seed aborted'));
    });
    db.close();

    const backup = await buildBackupBlob(undefined, false);
    const file = JSON.stringify(backup);
    await deleteDbs(DB); // the reinstall: nothing left of the outgoing install's store

    const result = await restoreFromBackup(file, undefined, true);

    expect(result.ok).toBe(true);
    expect(result.recordsAdded).toBe(4);
    expect(result.chainVerified).toBe(true);

    const restored = await getRecordsOrThrow();
    expect(restored.map((r) => r.id)).toEqual(['r0', 'r1', 'r2', 'r3']);
    for (const original of records) {
      const back = restored.find((r) => r.id === original.id)!;
      expect(back.signature).toBe(original.signature);
      expect(back.integrityHash).toBe(original.integrityHash);
    }
    expect((await verifyChainIntegrity(restored)).valid).toBe(true);
  });
});

describe('restore-keeps-signature-bytes: a record whose signature does not check', () => {
  it('comes back readable, with its actual (bad) signature bytes, marked unverified — not dropped, not silently re-signed', async () => {
    const records = await signedChain(['r0', 'r1', 'r2', 'r3']);
    const backup = assembleBackup({
      exportedAt: new Date().toISOString(),
      publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'x', y: 'y' },
      fingerprint: 'fp-current',
      records,
      anchors: [],
      parentFeedback: [],
      historyCoverage: 'active-chain-only',
    });
    const file = JSON.stringify(backup);

    // Arm the fault BEFORE the restore writes: r2's row lands holding a signature that is not the
    // one it was written with, structurally intact and fully readable otherwise. The double logs
    // the swap so the test can prove the fault actually fired rather than matching nothing.
    const tamperedEnvelope = await compressRecord({ ...records[2], signature: 'not-the-real-signature' } as ForensicRecord);
    idb.swapOnWrite({ db: DB, store: 'records', recordId: 'r2' }, tamperedEnvelope);

    const result = await restoreFromBackup(file, undefined, true);

    expect(idb.log.some((e) => e.kind === 'swap-write' && e.recordId === 'r2')).toBe(true);

    // Not dropped: every record the file carried is still in the count and still readable.
    expect(result.recordsAdded).toBe(4);
    const restored = await getRecordsOrThrow();
    expect(restored.map((r) => r.id)).toEqual(['r0', 'r1', 'r2', 'r3']);

    // Not silently re-signed: the bytes on disk are exactly the corrupted ones, not the original
    // and not a freshly computed valid one.
    const r2 = restored.find((r) => r.id === 'r2')!;
    expect(r2.signature).toBe('not-the-real-signature');
    expect(r2.signature).not.toBe(records[2].signature);

    // Marked unverified, at the point the restore itself checks: the one note the restore screen
    // renders says the record did not come back whole, and names which record.
    expect(result.chainVerified).toBe(false);
    expect(result.chainError).toMatch(/position 2/);

    // The per-record verdict a dashboard render would show for r2 specifically: broken, not
    // 'verified' and not silently absent from the map.
    const integrity = await verifyChainIntegrity(restored);
    expect(integrity.valid).toBe(false);
    expect(integrity.brokenAtPosition).toBe(2);
    expect(integrity.perRecord?.get('r2')).toBe('broken');
    // The two records before it verify cleanly: the fault is attributed to the one record, not the
    // whole chain. The walk stops at the first break (chain-integrity.ts's own contract — it reports
    // where the chain first breaks, not a per-record scorecard past that point), so r3 is never
    // reached and is correctly absent from the map rather than wrongly marked either way; it is
    // still present and readable in the store itself, per the recordsAdded/restored assertions above.
    expect(integrity.perRecord?.get('r0')).toBe('verified');
    expect(integrity.perRecord?.get('r1')).toBe('verified');
    expect(integrity.perRecord?.has('r3')).toBe(false);
  });
});

describe('restore-keeps-signature-bytes: a write that lands truncated, not merely mis-signed', () => {
  // The other half of "does the restore does not fully land" from the promise's own whyNotChecked,
  // and the harder case: not a record that came back with a bad signature (the describe block above
  // — decided, and holds), but one whose write landed too small to decompress at all. tests/unit/
  // forensics/restore-round-trip-over-a-truncated-write.test.ts pins the same fault one layer down,
  // at store.ts's replaceBackupStateUnderChainLock, and its closing note explains why: the batched
  // read decodes a single concatenated gzip stream across records sharing a read, so one truncated
  // payload can take the read of OTHER, undamaged records down with it, not only its own.
  //
  // FINDING (this file, established by this test): driven through the real public restoreFromBackup
  // — not the lower-level reproduction the sibling file uses — the same fault does not merely leave
  // one record "marked unverified" the way a bad signature does two describe blocks up. It leaves
  // getRecordsOrThrow() throwing for the WHOLE restored chain (confirmed separately below), so r0,
  // r1 and r3 — three records whose writes were never faulted at all — do not "come back" either, in
  // the sense of being readable, even though result.recordsAdded still reports 4. That is a bigger
  // loss than the promise's own language ("a record whose signature does not check comes back marked
  // unverified rather than dropped") anticipates: this is not one record coming back marked, it is
  // four records where one write fault took the rest down with it.
  //
  // A second, smaller defect rides along: src/forensics/backup.ts's re-verify block sets
  // `chainError = err instanceof Error ? err.message : String(err)` when the read throws. The
  // decompression failure surfaces as a TypeError with an EMPTY .message (Node's WHATWG
  // DecompressionStream on a too-short gzip member throws one with no text), so chainError comes
  // back as '' — falsy — alongside the correctly-false chainVerified. The one field the restore
  // screen renders as its explanation (RestoreResult.chainError's own docblock) can be blank on
  // exactly the run where the parent most needs to know something went wrong.
  // Split in two on 2026-09-18, and the halves are treated differently on purpose.
  //
  // The blank explanation is a defect and is fixed: the restore screen renders
  // chainError, a DecompressionStream TypeError carries an empty message, and
  // the parent was shown nothing at the one moment they most need to be told
  // something. That half passes now.
  //
  // The other half was registered as M212 and left failing on purpose,
  // because the obvious fix is wrong. Making the reader skip a row it cannot
  // read and return the rest would make an unreadable record read as a record
  // that was never there, which is the exact shape of M186 and of the three
  // archive readers corrected the same night.
  //
  // Closed 2026-09-18 by the honest fix, and the shape matters more than the
  // outcome: store.ts's getRecordsDetailed returns what it read AND names what
  // it could not, the way countArchivedRecords does, and getRecordsOrThrow's
  // signature did not move, because its all-or-nothing loudness is right for
  // the mutating callers its own docblock names. The restore's re-verify reads
  // through the new one and reports three numbers that were previously one:
  // written (recordsAdded), read back (recordsReadable), and present but not
  // decodable here (recordsUnreadable). The last case in this block holds all
  // three states apart; a reader that dropped the bad row would satisfy the
  // first of its assertions and none of the rest.
  it('names the failure when a restored record cannot be read back', async () => {
    const records = await signedChain(['r0', 'r1', 'r2', 'r3']);
    const backup = assembleBackup({
      exportedAt: new Date().toISOString(),
      publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'x', y: 'y' },
      fingerprint: 'fp-current',
      records,
      anchors: [],
      parentFeedback: [],
      historyCoverage: 'active-chain-only',
    });
    const file = JSON.stringify(backup);
    idb.truncateOnWrite({ db: DB, store: 'records', recordId: 'r2' });

    const result = await restoreFromBackup(file, undefined, true);

    expect(idb.log.some((e) => e.kind === 'truncate-write' && e.recordId === 'r2')).toBe(true);
    // The write step "succeeded" (tx.oncomplete fired) for all four — a separate, already-pinned
    // finding (restore-round-trip-over-a-truncated-write.test.ts). recordsAdded reflects that step,
    // not readability, and is not what this test is deciding.
    expect(result.recordsAdded).toBe(4);

    // The restore's own report must not read as a clean success over this.
    // chainVerified was already correctly false; the explanation beside it was
    // the empty string, which renders as nothing at all.
    expect(result.chainVerified).toBe(false);
    expect(result.chainError).toBeTruthy();
    expect(result.chainError).toContain('could not be read back');
  });

  // M212, closed 2026-09-18. This case ran as `it.fails` while the only readers
  // were all-or-nothing, and its assertion then was the one the fix had to make
  // reachable: `getRecordsOrThrow().catch(() => null)` answered null, so the
  // expectation compared `undefined` against ['r0','r1','r3'].
  //
  // What decides it now is `getRecordsDetailed`, not a change to
  // `getRecordsOrThrow`, and that is the point rather than an implementation
  // detail: the loud reader stays loud for the callers that must refuse to act
  // over a damaged read, and the three states are kept apart in the new one.
  // The forbidden fix, skipping the bad row and returning the rest, would pass the
  // `records` assertion below and fail every other line in this case, which is
  // why they are here: a reader that quietly dropped r2 would make an entry
  // this install cannot read indistinguishable from one that was never
  // written, which is M186.
  it('every entry the file carried comes back, with the unreadable one named rather than dropped and rather than taking the others down with it', async () => {
    const records = await signedChain(['r0', 'r1', 'r2', 'r3']);
    const backup = assembleBackup({
      exportedAt: new Date().toISOString(),
      publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'x', y: 'y' },
      fingerprint: 'fp-current',
      records,
      anchors: [],
      parentFeedback: [],
      historyCoverage: 'active-chain-only',
    });
    idb.truncateOnWrite({ db: DB, store: 'records', recordId: 'r2' });

    const result = await restoreFromBackup(JSON.stringify(backup), undefined, true);

    expect(idb.log.some((e) => e.kind === 'truncate-write' && e.recordId === 'r2')).toBe(true);

    // The all-or-nothing reader is unchanged and still rejects over a damaged
    // row. Asserted, not merely left alone: its loudness is correct for the
    // mutating callers named in its docblock, and a later "simplification" that
    // made it tolerant would close M212 by reopening M186 everywhere else.
    let loudReaderThrew = false;
    await getRecordsOrThrow().catch(() => { loudReaderThrew = true; });
    expect(loudReaderThrew).toBe(true);

    // READABLE: r0, r1 and r3 were never faulted, and one truncated row no
    // longer takes them down with it.
    const read = await getRecordsDetailed();
    expect(read.records.map((r) => r.id)).toEqual(['r0', 'r1', 'r3']);
    for (const back of read.records) {
      const original = records.find((r) => r.id === back.id)!;
      expect(back.signature).toBe(original.signature);
      expect(back.integrityHash).toBe(original.integrityHash);
    }

    // UNREADABLE ON THIS INSTALL: r2 is named, with the identifiers the
    // envelope's own index fields keep through a damaged payload, and with a
    // reason that is not the empty string.
    expect(read.complete).toBe(false);
    expect(read.unreadable.map((u) => u.id)).toEqual(['r2']);
    expect(read.unreadable[0].chainPosition).toBe(2);
    expect(read.unreadable[0].reason).toBeTruthy();

    // ABSENT: nothing invented. The file carried four entries and the store
    // accounts for exactly four, three readable plus one unreadable, which is
    // the arithmetic that says r2 was not treated as a record that was never
    // there.
    expect(read.records.length + read.unreadable.length).toBe(4);

    // The restore's own report. recordsAdded is still the write step's number
    // and still 4; the honest pair sits beside it, and the note names the row
    // rather than only counting it.
    expect(result.recordsAdded).toBe(4);
    expect(result.recordsReadable).toBe(3);
    expect(result.recordsUnreadable).toBe(1);
    expect(result.chainVerified).toBe(false);
    expect(result.chainError).toContain('could not be read back');
    expect(result.chainError).toContain('entry r2');
    expect(result.chainError).toContain('chain position 2');
  });
});
