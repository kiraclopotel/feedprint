// Item 7 (14 Sep 2026), the store half: a month's summary lives in its
// archive, follows the eviction writer's appends, is dropped by rotation, and
// is recomputed from the records whenever its record count stops matching
// the store. The reader never trusts a summary the records disagree with.

import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ForensicRecord } from '../../../src/types/forensic';
import { ARCHIVE_RECORDS_STORE, ARCHIVE_SUMMARY_STORE, archiveDbName, openArchiveDb } from '../../../src/forensics/archive-naming';
import { archiveEvictedRecords, type StoredEntry } from '../../../src/forensics/archive-writer';
import {
  dropSummaryForMonth,
  readMonthSummaries,
  readMonthSummary,
  readStoredSummary,
  writeStoredSummary,
} from '../../../src/forensics/archive-summary-store';
import { summarizeMonth } from '../../../src/forensics/archive-summary';
import { readArchiveRecords } from '../../../src/forensics/archive-reader';
import { deleteDb } from '../../helpers/indexeddb';

const MONTH = '2026-08';
const OTHER = '2026-07';

function rec(i: number, month = MONTH): ForensicRecord {
  const flagged = i % 3 === 0;
  return {
    id: `${month}-r${i}`,
    timestamp: `${month}-${String(1 + (i % 27)).padStart(2, '0')}T12:00:00.000Z`,
    platform: i % 2 ? 'twitter' : 'tiktok',
    originalText: `text ${i}`,
    originalHash: `h${i}`,
    originalLength: 6,
    techniques: flagged ? [{ name: 'fear-appeal', severity: 6, confidence: 0.9 }] : [],
    overallScore: flagged ? 6 : 0,
    userAgeCategory: 'adult',
    verdict: flagged ? 'flagged' : (i % 5 === 0 ? 'blocked' : 'pass'),
    chainPosition: i,
    integrityHash: `ih${i}`,
    signature: 'sig',
  } as unknown as ForensicRecord;
}

function entry(i: number, month = MONTH): StoredEntry {
  const record = rec(i, month);
  return { key: i, entry: record, record };
}

async function rawAppend(month: string, records: ForensicRecord[]): Promise<void> {
  const db = await openArchiveDb(month);
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(ARCHIVE_RECORDS_STORE, 'readwrite');
    for (const r of records) tx.objectStore(ARCHIVE_RECORDS_STORE).add(r);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

const strip = (s: { computedAt: string }) => ({ ...s, computedAt: '' });

describe('month summary store', () => {
  beforeEach(async () => { await deleteDb(archiveDbName(MONTH)); await deleteDb(archiveDbName(OTHER)); });
  afterEach(async () => { await deleteDb(archiveDbName(MONTH)); await deleteDb(archiveDbName(OTHER)); });

  it('the eviction writer creates the summary for a new month and grows it on the next pass', async () => {
    await archiveEvictedRecords([entry(0), entry(1), entry(2)]);
    const db = await openArchiveDb(MONTH);
    const first = await readStoredSummary(db, MONTH);
    db.close();
    expect(first).not.toBeNull();
    expect(first!.recordCount).toBe(3);
    expect(strip(first!)).toEqual(strip(summarizeMonth(MONTH, [rec(0), rec(1), rec(2)])));

    await archiveEvictedRecords([entry(2), entry(3), entry(4)]); // one repeat, two new
    const db2 = await openArchiveDb(MONTH);
    const second = await readStoredSummary(db2, MONTH);
    db2.close();
    expect(second!.recordCount).toBe(5);
    expect(strip(second!)).toEqual(strip(summarizeMonth(MONTH, [0, 1, 2, 3, 4].map(i => rec(i)))));
  });

  it('a summary whose count disagrees with the store is recomputed from the records and stored', async () => {
    await archiveEvictedRecords([entry(0), entry(1)]);
    // Something else appends behind the summary's back (a rotation that did
    // not drop it, an older build): the count no longer matches.
    await rawAppend(MONTH, [rec(2), rec(3), rec(4)]);
    const db = await openArchiveDb(MONTH);
    const stale = await readStoredSummary(db, MONTH);
    db.close();
    expect(stale!.recordCount).toBe(2);

    const fresh = await readMonthSummary(MONTH);
    expect(fresh.recordCount).toBe(5);
    expect(strip(fresh)).toEqual(strip(summarizeMonth(MONTH, await readArchiveRecords(MONTH))));
    const db2 = await openArchiveDb(MONTH);
    const stored = await readStoredSummary(db2, MONTH);
    db2.close();
    expect(stored!.recordCount).toBe(5);
  });

  it('a month with no summary (archived by an older build) gets one on first read', async () => {
    await rawAppend(MONTH, [rec(0), rec(1), rec(2), rec(3)]);
    const db = await openArchiveDb(MONTH);
    expect(await readStoredSummary(db, MONTH)).toBeNull();
    db.close();
    const s = await readMonthSummary(MONTH);
    expect(s.recordCount).toBe(4);
    expect(s.flagged).toBe(2); // r0, r3
    expect(s.blocked).toBe(0); // r0 is flagged first; 5 is not present
  });

  it('rotation drops the summary; the reader rebuilds it', async () => {
    await archiveEvictedRecords([entry(0), entry(1), entry(2)]);
    const db = await openArchiveDb(MONTH);
    await dropSummaryForMonth(db, MONTH);
    expect(await readStoredSummary(db, MONTH)).toBeNull();
    db.close();
    const s = await readMonthSummary(MONTH);
    expect(s.recordCount).toBe(3);
  });

  it('readMonthSummaries lists every month oldest first and never trusts a wrong version', async () => {
    await archiveEvictedRecords([entry(0, OTHER), entry(1, OTHER)]);
    await archiveEvictedRecords([entry(0), entry(1), entry(2)]);
    // Poison the newer month's summary with a version the reader does not know.
    const db = await openArchiveDb(MONTH);
    const s = await readStoredSummary(db, MONTH);
    await writeStoredSummary(db, { ...s!, version: 999, flagged: 12345 });
    db.close();
    const result = await readMonthSummaries();
    expect(result.complete).toBe(true);
    expect(result.unreadableMonths).toEqual([]);
    const all = result.summaries;
    expect(all.map(x => x.monthKey)).toEqual([OTHER, MONTH]);
    expect(all[0].recordCount).toBe(2);
    expect(all[1].recordCount).toBe(3);
    expect(all[1].flagged).toBe(1); // r0 only among r0..r2
  });

  it('an enumeration failure is named, not folded into "no archived months" (adversarial read, 18 Sep 2026)', async () => {
    await archiveEvictedRecords([entry(0, OTHER), entry(1, OTHER)]);
    const realDatabases = indexedDB.databases?.bind(indexedDB);
    // Simulates a realm where `indexedDB.databases` does not exist, the exact
    // condition that used to make every caller of listArchiveMonths() read
    // zero archived months with no error at all, even with a real one sitting
    // right there.
    // defineProperty, not `delete`: fake-indexeddb carries `databases` on the
    // prototype, so deleting the own property removes nothing and the case
    // this test exists for never happens.
    Object.defineProperty(indexedDB, 'databases', { value: undefined, configurable: true, writable: true });
    try {
      const result = await readMonthSummaries();
      expect(result).toEqual({ summaries: [], complete: false, unreadableMonths: [] });
    } finally {
      Object.defineProperty(indexedDB, 'databases', { value: realDatabases, configurable: true, writable: true });
    }
  });

  it('the summary store exists in a v3 archive', async () => {
    const db = await openArchiveDb(MONTH);
    expect(db.objectStoreNames.contains(ARCHIVE_SUMMARY_STORE)).toBe(true);
    db.close();
  });
});
