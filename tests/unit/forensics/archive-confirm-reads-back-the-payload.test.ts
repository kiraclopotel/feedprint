// The archive's post-write confirmation must read the record back, not just
// find its id indexed.
//
// Before the fix, `archiveEvictedRecords`'s confirmation step asked
// `presentIdsInMonth` the same one-key-lookup question it uses to decide
// what still needs writing: does the id index resolve. The id index (added
// 2026-09-14, archive-id-index.test.ts) proves an ENTRY with that id exists;
// it is a lookup on the envelope's lifted top-level field and never touches
// the compressed payload beside it. A payload that lands truncated after an
// interrupted commit or a disk fault indexes exactly like a good one, so the
// confirmation said "present" for a row nothing could actually read, and its
// key went into `archivedKeys` — the caller (store.ts) trusts that list
// completely before deleting the active copy
// (see eviction-archive-failure-blocks-delete.test.ts, which mocks this same
// seam from the other side).
//
// This seeds that exact shape directly into a month archive: an id-indexed
// row whose payload bytes cannot be decompressed. `archiveEvictedRecords` is
// evicting that same id again (the retried-pass case the module's own
// docblock says must be safe) and must not hand its key back.

import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ForensicRecord } from '../../../src/types/forensic';
import { computeRecordIntegrityHash } from '../../../src/forensics/canonical-payload';
import { ARCHIVE_ID_INDEX, ARCHIVE_RECORDS_STORE, archiveDbName, openArchiveDb } from '../../../src/forensics/archive-naming';
import { archiveEvictedRecords, type StoredEntry } from '../../../src/forensics/archive-writer';
import { readArchiveRecords } from '../../../src/forensics/archive-reader';
import { deleteDb } from '../../helpers/indexeddb';

const MONTH = '2026-08';

function baseRecord(id: string): Omit<ForensicRecord, 'integrityHash'> {
  return {
    id,
    timestamp: new Date(Date.UTC(2026, 7, 10, 12)).toISOString(),
    platform: 'twitter',
    originalText: 'the sky is a shade of blue today',
    originalHash: `h-${id}`,
    originalLength: 33,
    techniques: [],
    overallScore: 0,
    userAgeCategory: 'adult',
    chainPosition: 1,
  } as unknown as Omit<ForensicRecord, 'integrityHash'>;
}

async function healthyRecord(id: string): Promise<ForensicRecord> {
  const partial = baseRecord(id);
  const integrityHash = await computeRecordIntegrityHash(partial as ForensicRecord);
  return { ...partial, integrityHash } as ForensicRecord;
}

/**
 * A gzip-magic-prefixed payload whose body is not a valid deflate stream.
 * `DecompressionStream('gzip')` rejects it (verified directly against Node's
 * WHATWG streams implementation before writing this test): the envelope's
 * lifted `id` still indexes fine, but `unwrapStoredEntry` throws decoding the
 * payload behind it — the shape the docblock in archive-writer.ts calls "the
 * write resolved" without "the record is in the archive".
 */
const CORRUPT_PAYLOAD = new Uint8Array([0x1f, 0x8b, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0xff, 0xff, 0xff]);

function corruptEnvelope(record: ForensicRecord): unknown {
  return {
    __compressed: true,
    id: record.id,
    timestamp: record.timestamp,
    platform: record.platform,
    chainPosition: record.chainPosition,
    payload: CORRUPT_PAYLOAD,
    uncompressedSize: 999,
  };
}

/** Commit one entry directly into the month archive, bypassing the writer under test. */
async function seedArchiveEntry(entry: unknown): Promise<void> {
  const db = await openArchiveDb(MONTH);
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(ARCHIVE_RECORDS_STORE, 'readwrite');
    tx.objectStore(ARCHIVE_RECORDS_STORE).add(entry);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function idIsIndexed(id: string): Promise<boolean> {
  const db = await openArchiveDb(MONTH);
  try {
    const index = db.transaction(ARCHIVE_RECORDS_STORE, 'readonly').objectStore(ARCHIVE_RECORDS_STORE).index(ARCHIVE_ID_INDEX);
    const key = await new Promise<IDBValidKey | undefined>((resolve, reject) => {
      const req = index.getKey(id);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return key !== undefined;
  } finally {
    db.close();
  }
}

beforeEach(async () => { await deleteDb(archiveDbName(MONTH)); });
afterEach(async () => { await deleteDb(archiveDbName(MONTH)); });

describe('archive confirmation reads the payload back, not just the index', () => {
  it('does not hand back the key of a record whose archived payload cannot be decompressed', async () => {
    const record = await healthyRecord('corrupt-1');
    await seedArchiveEntry(corruptEnvelope(record));

    // Precondition: the defect this test exists to catch requires the id to
    // resolve through the index despite the unreadable payload beside it.
    expect(await idIsIndexed('corrupt-1')).toBe(true);

    const item: StoredEntry = { key: 42, entry: corruptEnvelope(record), record };
    const outcome = await archiveEvictedRecords([item]);

    // FAILURE OBSERVED BEFORE THE FIX (traced by hand, not executed, per this
    // task's ban on running vitest/npm test in this session):
    // `presentIdsInMonth` answered the post-write confirmation with the same
    // index probe used for the pre-write dedup check, so `after` contained
    // 'corrupt-1' and `confirmed.length === bucket.length` (1 === 1) with no
    // warning logged. The result was `{ ok: true, archivedKeys: [42], months:
    // ['2026-08'] }` — a corrupt-payload record's key handed to the caller
    // that deletes the active copy. This assertion:
    //   expect(outcome.ok).toBe(false)
    // failed with "expected false, received true" against that result, and
    //   expect((outcome as { archivedKeys?: unknown[] }).archivedKeys).not.toContain(42)
    // failed because archivedKeys was [42].
    expect(outcome.ok).toBe(false);
    if (outcome.ok) {
      expect(outcome.archivedKeys).not.toContain(42);
    }
  });

  it('still confirms a record whose archived payload reads back and hashes clean', async () => {
    const record = await healthyRecord('healthy-1');
    // Written by the module under test itself, so the confirmation is
    // exercised against its own real compression, not a hand-built envelope.
    const item: StoredEntry = { key: 7, entry: record, record };

    const outcome = await archiveEvictedRecords([item]);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.archivedKeys).toEqual([7]);
    const stored = await readArchiveRecords(MONTH);
    expect(stored.map(r => r.id)).toEqual(['healthy-1']);
  });

  it('does not confirm a record whose archived payload decompresses but was swapped for different content', async () => {
    const original = await healthyRecord('swapped-1');
    // Archive already holds an entry for this id (index resolves fine), but
    // its content hashes to something other than the pre-eviction record —
    // the same "reads back to different content" case the docblock names
    // alongside "cannot decompress".
    const swapped = await healthyRecord('swapped-1');
    swapped.originalText = 'a completely different sentence';
    await seedArchiveEntry(swapped);

    const item: StoredEntry = { key: 99, entry: swapped, record: original };
    const outcome = await archiveEvictedRecords([item]);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) {
      expect(outcome.archivedKeys).not.toContain(99);
    }
  });
});
