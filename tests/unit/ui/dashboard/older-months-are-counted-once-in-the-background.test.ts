// The dashboard counts each archived month by its own rules from the month's
// stored rows, once, saving each month as it finishes, and never writes to the
// archive it reads. A row that would not decode stays in the month's row
// count and is named. A month no longer archived loses its count.

import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { deleteDb } from '../../../helpers/indexeddb';
import { archiveDbName, openArchiveDb } from '../../../../src/forensics/archive-naming';
import { readMonthSummaries } from '../../../../src/forensics/archive-summary-store';
import { SYSTEM_MARKER_KINDS } from '../../../../src/forensics/system-records';
import type { ForensicRecord } from '../../../../src/types/forensic';
import { countRecordSets } from '../../../../src/ui/dashboard/record-sets';
import { MONTH_SETS_VERSION, summaryFingerprint, type MonthSets, type OlderMonthsProgress } from '../../../../src/ui/dashboard/month-sets';
import { _resetMonthSetsDbForTests, countOlderMonths, readStoredMonthSets } from '../../../../src/ui/dashboard/month-sets-store';

const MONTH = '2026-09';
const SETS_DB = 'feelingwise-derived';

let n = 0;
function rec(verdict: ForensicRecord['verdict'], over: Partial<ForensicRecord> = {}): ForensicRecord {
  n += 1;
  return {
    id: `m${n}`, timestamp: `2026-09-14T10:${String(n % 60).padStart(2, '0')}:00.000Z`, platform: 'tiktok',
    originalText: 't', originalHash: 'h', originalLength: 1, neutralizedText: '',
    author: 'a', postUrl: '', techniques: [], overallScore: 0,
    userAgeCategory: 'teen', aiSource: 'cloud', feedSource: 'foryou',
    integrityHash: 'ih', verdict, ...over,
  } as ForensicRecord;
}

const ROWS: ForensicRecord[] = [
  rec('pass'), rec('flagged'), rec('flagged-hidden'), rec(undefined), rec('blocked'),
  rec('flagged-hidden', { accountType: 'advertiser' } as Partial<ForensicRecord>),
  rec('skipped'), rec('flagged', { kind: 'image' } as Partial<ForensicRecord>),
  rec('flagged', { detectionMode: 'read-this' }),
  rec('pass', { kind: 'environment' } as Partial<ForensicRecord>),
  ...[...SYSTEM_MARKER_KINDS].map((kind) => rec('pass', { kind } as Partial<ForensicRecord>)),
];
const BROKEN = { __compressed: true, payload: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), id: 'broken', uncompressedSize: 99 };

async function archiveRows(): Promise<unknown[]> {
  const db = await openArchiveDb(MONTH);
  try {
    return await new Promise<unknown[]>((resolve, reject) => {
      const req = db.transaction('records', 'readonly').objectStore('records').getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

beforeEach(async () => {
  await _resetMonthSetsDbForTests();
  await deleteDb(SETS_DB);
  await deleteDb(archiveDbName(MONTH));
  const db = await openArchiveDb(MONTH);
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('records', 'readwrite');
    for (const r of ROWS) tx.objectStore('records').add(r);
    tx.objectStore('records').add(BROKEN);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
});

afterEach(async () => {
  await _resetMonthSetsDbForTests();
  await deleteDb(SETS_DB);
  await deleteDb(archiveDbName(MONTH));
});

describe('older months are counted by the dashboard rules, once, in the background', () => {
  it('counts the month from its stored rows by the module, names the row that would not decode, and saves it', async () => {
    const { summaries, complete } = await readMonthSummaries();
    const steps: OlderMonthsProgress[] = [];
    const sets = await countOlderMonths(summaries, complete, (_s, p) => steps.push(p));
    expect(steps).toEqual([{ done: 0, total: 1 }, { done: 1, total: 1 }]);
    const month = sets.get(MONTH) as MonthSets;
    const expected = countRecordSets(ROWS);
    expect(month.counts).toEqual(expected);
    expect(month.flaggedIds.length).toBe(expected.flagged);
    expect(month.unreadable).toBe(1);
    expect(month.counts.entries + month.unreadable).toBe(summaries[0].recordCount);
    expect(month.version).toBe(MONTH_SETS_VERSION);
    expect(month.fingerprint).toBe(summaryFingerprint(summaries[0]));
    // The store's rule counts two more: the image and the button reading.
    expect(summaries[0].flagged - month.counts.flagged).toBe(2);
    expect((await readStoredMonthSets()).get(MONTH)).toEqual(month);
  });

  it('a second open finds the month counted and reads nothing', async () => {
    const { summaries, complete } = await readMonthSummaries();
    await countOlderMonths(summaries, complete, () => undefined);
    await _resetMonthSetsDbForTests();
    const steps: OlderMonthsProgress[] = [];
    await countOlderMonths(summaries, complete, (_s, p) => steps.push(p));
    expect(steps).toEqual([{ done: 0, total: 0 }]);
  });

  it('the archive it reads is left exactly as it was', async () => {
    const { summaries, complete } = await readMonthSummaries();
    const before = await archiveRows();
    await countOlderMonths(summaries, complete, () => undefined);
    expect(await archiveRows()).toEqual(before);
  });

  it('a month no longer archived loses its count when the listing is complete, and keeps it when not', async () => {
    const { summaries, complete } = await readMonthSummaries();
    await countOlderMonths(summaries, complete, () => undefined);
    expect((await countOlderMonths([], false, () => undefined)).has(MONTH)).toBe(true);
    expect((await countOlderMonths([], true, () => undefined)).has(MONTH)).toBe(false);
    expect((await readStoredMonthSets()).has(MONTH)).toBe(false);
  });

  it('opens the derived-data database exactly as the theme cache does, so neither open fails on the other', () => {
    const shape = (file: string) => {
      const text = readFileSync(join(process.cwd(), file), 'utf8');
      return ['DB_NAME', 'DB_VERSION', 'STORE'].map((c) => new RegExp('const ' + c + ' = ([^;]+);').exec(text)?.[1]);
    };
    expect(shape('src/ui/dashboard/month-sets-store.ts')).toEqual(shape('src/forensics/theme-cache.ts'));
    expect(readFileSync(join(process.cwd(), 'src/forensics/theme-cache.ts'), 'utf8')).toContain("{ keyPath: 'key' }");
  });

  it('keeps the theme entry when it drops a month', async () => {
    const { summaries, complete } = await readMonthSummaries();
    await countOlderMonths(summaries, complete, () => undefined);
    const db = await new Promise<IDBDatabase>((res, rej) => { const r = indexedDB.open(SETS_DB, 1); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    await new Promise<void>((res, rej) => { const tx = db.transaction('cache', 'readwrite'); tx.objectStore('cache').put({ key: 'themes-v1', themes: [] }); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
    await countOlderMonths([], true, () => undefined);
    expect((await readStoredMonthSets()).size).toBe(0);
    const theme = await new Promise<unknown>((res, rej) => { const g = db.transaction('cache').objectStore('cache').get('themes-v1'); g.onsuccess = () => res(g.result); g.onerror = () => rej(g.error); });
    db.close();
    expect(theme).toEqual({ key: 'themes-v1', themes: [] });
  });
});
