// D3 (docs/history/archive/reality-FUNCTION_MAP.md drill list) — archive-reader pure core.
//
// IDB-side reads are exercised on a real machine (vitest's Node env has no
// real IndexedDB and the project doesn't ship fake-indexeddb — same policy
// as chain-rotation.test.ts). This file covers the pure logic: turning a
// raw `indexedDB.databases()` name list into the ordered archive month-key
// list that `verifyChainIntegrityAcrossMonths` consumes.

import { describe, it, expect } from 'vitest';
import {
  archiveMonthKeysFromDbNames,
  countArchivedRecords,
  listArchiveMonths,
  listArchiveMonthsDetailed,
} from '../../../src/forensics/archive-reader';

describe('archiveMonthKeysFromDbNames', () => {
  it('extracts archive keys, drops everything else, sorts oldest first', () => {
    expect(
      archiveMonthKeysFromDbNames([
        'feelingwise-forensics',            // active DB — not an archive
        'feelingwise-forensics-2026-06',
        'some-other-db',
        'feelingwise-forensics-2026-04',
        undefined,                          // Chrome may omit names
        'feelingwise-forensics-2026-05',
      ]),
    ).toEqual(['2026-04', '2026-05', '2026-06']);
  });

  it('year boundaries sort chronologically as text', () => {
    expect(
      archiveMonthKeysFromDbNames([
        'feelingwise-forensics-2026-01',
        'feelingwise-forensics-2025-12',
      ]),
    ).toEqual(['2025-12', '2026-01']);
  });

  it('rejects malformed month suffixes', () => {
    expect(
      archiveMonthKeysFromDbNames([
        'feelingwise-forensics-2026-6',     // month not zero-padded
        'feelingwise-forensics-202606',
        'feelingwise-forensics-2026-06-01', // day suffix — not a month archive
      ]),
    ).toEqual([]);
  });

  it('empty input yields empty output', () => {
    expect(archiveMonthKeysFromDbNames([])).toEqual([]);
  });
});

// Confirmed by the adversarial read, 18 Sep 2026: this file's own environment
// (no fake-indexeddb import, per the docblock above) has no `indexedDB` at
// all, which is exactly the "realm cannot enumerate" case these three
// functions used to fold into an ordinary empty archive. Before the fix,
// `listArchiveMonths()` answered `[]` here indistinguishably from "no
// archives exist", and `countArchivedRecords()` answered `0` the same way,
// with no error anywhere a caller could see. Reading every archived month is
// exercised on real hardware only (this file's policy note); this much is
// exact in vitest because it never opens a database at all.
describe('an unreadable enumeration is not a zero', () => {
  it('listArchiveMonthsDetailed says it could not enumerate; listArchiveMonths still answers empty for its existing callers', async () => {
    expect(typeof indexedDB).toBe('undefined');
    await expect(listArchiveMonthsDetailed()).resolves.toEqual({ months: [], complete: false });
    await expect(listArchiveMonths()).resolves.toEqual([]);
  });

  it('countArchivedRecords reports the same gap instead of a bare 0', async () => {
    await expect(countArchivedRecords()).resolves.toEqual({
      count: 0,
      complete: false,
      unreadableMonths: [],
    });
  });
});
