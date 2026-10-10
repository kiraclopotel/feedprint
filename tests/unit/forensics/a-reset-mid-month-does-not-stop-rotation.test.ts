// A mid-month reset files the chain it ends into the same month archive the
// next rotation files the new chain into, so one month archive holds two chains
// that each start at position 0. Rotation and Verify must take each chain on its
// own, or the record reads as broken and the active chain is never retired.

import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteDb } from '../../helpers/indexeddb';

vi.mock('../../../src/forensics/signing', () => ({
  signHash: vi.fn(async () => 'signed'),
  verifyHash: vi.fn(async () => true),
  getPublicKeyFingerprint: vi.fn(async () => 'mock-fingerprint'),
}));
vi.mock('../../../src/storage/settings', () => ({
  getSettings: vi.fn(async () => ({ mode: 'adult' })),
  getSettingsForAttestation: vi.fn(async () => ({ mode: 'adult', readFailed: false })),
  resetUsageStats: vi.fn(async () => undefined),
}));
vi.mock('../../../src/forensics/scan-log', () => ({ clearScanLog: vi.fn(async () => undefined) }));
vi.mock('../../../src/forensics/author-store', () => ({ clearAuthorProfiles: vi.fn(async () => undefined) }));
vi.mock('../../../src/forensics/neutralizer-diagnostics', () => ({ resetNeutralizerDiagnostics: vi.fn(async () => undefined) }));
vi.mock('../../../src/storage/cache', () => ({ processingCache: { clear: vi.fn() } }));
vi.mock('../../../src/analysis/comment-batch-scorer', () => ({ clearBatchCache: vi.fn() }));
vi.mock('../../../src/forensics/delivery-outbox', () => ({
  getForensicDeliveryStatus: vi.fn(async () => ({ pendingCount: 0 })),
}));

import { addRecord, getChainState, getRecords, openDB, resetForensicChain } from '../../../src/forensics/store';
import { rotateChainAtMonthFlip } from '../../../src/forensics/chain-rotation';
import { loadArchivesOldestFirst } from '../../../src/forensics/archive-reader';
import { archiveDbName, openArchiveDb } from '../../../src/forensics/archive-naming';
import {
  CHAIN_GENESIS_HASH,
  verifyChainIntegrity,
  verifyChainIntegrityAcrossMonths,
} from '../../../src/forensics/chain-integrity';
import { computeRecordIntegrityHash } from '../../../src/forensics/canonical-payload';
import type { ForensicRecord } from '../../../src/types/forensic';

const ACTIVE_DB = 'feelingwise-forensics';
const MONTHS = ['2026-03', '2026-04', '2026-05', '2026-06'];

async function buildRecord(
  id: string,
  position: number,
  prevHash: string,
  timestamp: string,
  extra: Partial<ForensicRecord> = {},
): Promise<ForensicRecord> {
  const partial: Omit<ForensicRecord, 'integrityHash' | 'signature'> = {
    id,
    timestamp,
    platform: 'twitter',
    originalText: `record ${id}`,
    originalHash: 'a'.repeat(64),
    originalLength: 12,
    neutralizedText: '',
    author: 'tester',
    postUrl: 'https://x.com/t/1',
    techniques: [],
    overallScore: 0,
    userAgeCategory: 'teen',
    aiSource: 'cloud',
    feedSource: 'unknown',
    prevRecordHash: prevHash,
    chainPosition: position,
    chainAnchor: position === 0 ? 'genesis-v1' : undefined,
    verdict: 'pass',
    kind: 'post',
    publicKeyFingerprint: 'mock-fingerprint',
    ...extra,
  };
  const integrityHash = await computeRecordIntegrityHash(partial);
  return { ...partial, integrityHash, signature: 'signed' };
}

/** Chain A: four records (May unless told otherwise), positions 0..3, written straight to the active DB. */
async function seedChainA(monthIndex = 4): Promise<void> {
  const rows: ForensicRecord[] = [];
  let prev = CHAIN_GENESIS_HASH;
  for (let p = 0; p < 4; p++) {
    const r = await buildRecord(`fr-a-${p}`, p, prev, new Date(Date.UTC(2026, monthIndex, 2 + p, 12)).toISOString());
    rows.push(r);
    prev = r.integrityHash;
  }
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('records', 'readwrite');
    for (const r of rows) tx.objectStore('records').add(r);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

/** Append one record to the active chain the way the logger does. */
async function appendToActiveChain(id: string, timestamp: string): Promise<void> {
  const state = await getChainState();
  await addRecord(await buildRecord(id, state.nextPosition, state.prevRecordHash, timestamp));
}

/**
 * The state a mid-May reset leaves: chain A in the May archive, and chain B
 * (the reset marker at position 0, then two May records) in the active DB.
 * Chain A is longer than chain B on purpose, so a link check that took the
 * month's highest position as its last record would name A's end, not B's.
 */
async function resetMidMayThenRecord(): Promise<void> {
  await seedChainA();
  vi.setSystemTime(new Date('2026-05-20T12:00:00.000Z'));
  const reset = await resetForensicChain('test');
  expect(reset.recordsArchived).toBe(4);
  expect(reset.resetMarkerWritten).toBe(true);
  await appendToActiveChain('fr-b-1', '2026-05-21T12:00:00.000Z');
  await appendToActiveChain('fr-b-2', '2026-05-22T12:00:00.000Z');
}

/** What the failed rotation pass left behind: chain B's rows copied into the May archive. */
async function copyActiveRowsIntoMayArchive(): Promise<void> {
  const active = await openDB();
  const entries: unknown[] = await new Promise((resolve, reject) => {
    const req = active.transaction('records', 'readonly').objectStore('records').getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  active.close();
  const archive = await openArchiveDb('2026-05');
  await new Promise<void>((resolve, reject) => {
    const tx = archive.transaction('records', 'readwrite');
    for (const entry of entries) tx.objectStore('records').add(entry);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  archive.close();
}

async function verifyWholeRecord() {
  const archives = await loadArchivesOldestFirst();
  return verifyChainIntegrityAcrossMonths(
    await getRecords(),
    archives.map(a => ({ monthKey: a.monthKey, records: a.records })),
  );
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  await deleteDb(ACTIVE_DB);
  for (const m of MONTHS) await deleteDb(archiveDbName(m));
});

afterEach(async () => {
  vi.useRealTimers();
  await deleteDb(ACTIVE_DB);
  for (const m of MONTHS) await deleteDb(archiveDbName(m));
});

describe('a month archive that holds a reset and the chain after it', () => {
  it('the month flip after a mid-month reset retires the new chain', async () => {
    await resetMidMayThenRecord();

    const result = await rotateChainAtMonthFlip(new Date('2026-06-01T00:30:00.000Z'), 'auto');

    expect(result.reason).toBeUndefined();
    expect(result).toMatchObject({ rotated: true, archivedMonth: '2026-05', archivedCount: 3 });
    const active = await getRecords();
    expect(active).toHaveLength(1);
    expect(active[0].kind).toBe('month-rotation-marker');
  });

  it('Verify walks each chain in the month on its own and the link into June holds', async () => {
    await resetMidMayThenRecord();
    const rotated = await rotateChainAtMonthFlip(new Date('2026-06-01T00:30:00.000Z'), 'auto');
    expect(rotated.rotated).toBe(true);

    const cross = await verifyWholeRecord();

    expect(cross.reason).toBeUndefined();
    expect(cross.valid).toBe(true);
    const may = cross.perMonth.find(m => m.monthKey === '2026-05')!;
    expect(may.result.valid).toBe(true);
    // Every record of both chains is in the month and was walked; none dropped.
    expect(may.result.chainLength).toBe(7);
    for (const id of ['fr-a-0', 'fr-a-3', 'fr-b-1', 'fr-b-2']) {
      expect(cross.perRecord?.get(id)).toBe('verified');
    }
    const current = cross.perMonth.find(m => m.monthKey === 'current')!;
    expect(current.linkToPreviousOk).toBe(true);
  });

  it('an install already stuck after a failed rotation recovers on its next rotation', async () => {
    await resetMidMayThenRecord();
    // The failed pass copied chain B into the May archive and left it active;
    // the install then kept recording into June.
    await copyActiveRowsIntoMayArchive();
    await appendToActiveChain('fr-b-3', '2026-06-01T08:00:00.000Z');

    // Verify on the stuck install, before any rotation: the May archive holds
    // chain A and a copy of chain B, and both walk clean.
    const stuck = await verifyWholeRecord();
    expect(stuck.reason).toBeUndefined();
    expect(stuck.valid).toBe(true);

    const result = await rotateChainAtMonthFlip(new Date('2026-06-02T00:30:00.000Z'), 'auto');

    expect(result.reason).toBeUndefined();
    expect(result).toMatchObject({ rotated: true, archivedMonth: '2026-05', archivedCount: 4 });

    const cross = await verifyWholeRecord();
    expect(cross.reason).toBeUndefined();
    expect(cross.valid).toBe(true);
    expect(cross.perMonth.find(m => m.monthKey === '2026-05')!.result.chainLength).toBe(8);
    expect(cross.perMonth.find(m => m.monthKey === 'current')!.linkToPreviousOk).toBe(true);
  });

  it('a record missing from the middle of the earlier chain is still reported', async () => {
    await resetMidMayThenRecord();
    await rotateChainAtMonthFlip(new Date('2026-06-01T00:30:00.000Z'), 'auto');
    const archives = await loadArchivesOldestFirst();
    const may = archives.find(a => a.monthKey === '2026-05')!;

    const cross = await verifyChainIntegrityAcrossMonths(await getRecords(), [
      { monthKey: '2026-05', records: may.records.filter(r => r.id !== 'fr-a-2') },
    ]);

    expect(cross.valid).toBe(false);
    expect(cross.brokenKind).toBe('position-mismatch');
    expect(cross.reason).toContain('2026-05');
  });

  it('a second plain record at position 0 is still a collision, not a new chain', async () => {
    await resetMidMayThenRecord();
    await rotateChainAtMonthFlip(new Date('2026-06-01T00:30:00.000Z'), 'auto');
    const archives = await loadArchivesOldestFirst();
    const may = archives.find(a => a.monthKey === '2026-05')!;
    // Only a marker opens a new chain. A captured record claiming position 0
    // again is the collision the walk exists to report.
    const intruder = await buildRecord('fr-intruder', 0, CHAIN_GENESIS_HASH, '2026-05-10T12:00:00.000Z');

    const cross = await verifyChainIntegrityAcrossMonths(await getRecords(), [
      { monthKey: '2026-05', records: [...may.records.slice(0, 2), intruder, ...may.records.slice(2)] },
    ]);

    expect(cross.valid).toBe(false);
    expect(cross.reason).toContain('2026-05');
  });
});

// Each chain's own walk cannot see entries cut from its end, so the reset
// marker's priorChainHash, which names that end, is the only witness. The
// offline checker follows it; Verify must too, or the two disagree.
describe('the link from a reset back to the chain it ended', () => {
  async function mayArchive(): Promise<ForensicRecord[]> {
    const archives = await loadArchivesOldestFirst();
    return archives.find(a => a.monthKey === '2026-05')!.records;
  }

  it('entries cut from the end of the chain before a reset are reported', async () => {
    await resetMidMayThenRecord();
    await rotateChainAtMonthFlip(new Date('2026-06-01T00:30:00.000Z'), 'auto');
    const may = await mayArchive();
    const marker = may.find(r => r.kind === 'reset-marker')!;

    const cross = await verifyChainIntegrityAcrossMonths(await getRecords(), [
      { monthKey: '2026-05', records: may.filter(r => r.id !== 'fr-a-2' && r.id !== 'fr-a-3') },
    ]);

    expect(cross.valid).toBe(false);
    expect(cross.brokenKind).toBe('chain-link-mismatch');
    expect(cross.brokenAtPosition).toBe(0);
    expect(cross.reason).toContain('2026-05');
    expect(cross.perRecord?.get(marker.id)).toBe('broken');
    // The chains on either side of the cut still walk clean on their own.
    expect(cross.perRecord?.get('fr-a-1')).toBe('verified');
    expect(cross.perRecord?.get('fr-b-2')).toBe('verified');
  });

  it('the same cut is reported on an install still stuck after a failed rotation', async () => {
    await resetMidMayThenRecord();
    await copyActiveRowsIntoMayArchive();
    await appendToActiveChain('fr-b-3', '2026-06-01T08:00:00.000Z');
    const may = await mayArchive();

    const cross = await verifyChainIntegrityAcrossMonths(await getRecords(), [
      { monthKey: '2026-05', records: may.filter(r => r.id !== 'fr-a-3') },
    ]);

    expect(cross.valid).toBe(false);
    expect(cross.brokenKind).toBe('chain-link-mismatch');
  });

  it('entries cut from the end of the chain before a reset are reported while the reset still opens the live chain', async () => {
    await resetMidMayThenRecord();
    const may = await mayArchive();
    const marker = (await getRecords()).find(r => r.kind === 'reset-marker')!;

    const whole = await verifyChainIntegrityAcrossMonths(await getRecords(), [{ monthKey: '2026-05', records: may }]);
    expect(whole.reason).toBeUndefined();
    expect(whole.valid).toBe(true);

    const cut = await verifyChainIntegrityAcrossMonths(await getRecords(), [
      { monthKey: '2026-05', records: may.filter(r => r.id !== 'fr-a-3') },
    ]);

    expect(cut.valid).toBe(false);
    expect(cut.brokenKind).toBe('chain-link-mismatch');
    expect(cut.brokenAtPosition).toBe(0);
    expect(cut.reason).toContain('current');
    expect(cut.perRecord?.get(marker.id)).toBe('broken');
    expect(cut.perRecord?.get('fr-a-2')).toBe('verified');
    expect(cut.perRecord?.get('fr-b-2')).toBe('verified');
  });

  it('the cut is reported when the months and the live chain are not walked again, as on the dashboard refresh', async () => {
    await resetMidMayThenRecord();
    const current = await getRecords();
    const archives = [{ monthKey: '2026-05', records: (await mayArchive()).filter(r => r.id !== 'fr-a-3') }];
    const walked = await verifyChainIntegrity(current);
    const months = await verifyChainIntegrityAcrossMonths(current, archives, { currentResult: walked });
    expect(walked.valid).toBe(true);

    const refreshed = await verifyChainIntegrityAcrossMonths(current, archives, {
      archiveResults: new Map(months.perMonth.filter(m => m.monthKey !== 'current').map(m => [m.monthKey, m.result])),
      currentResult: walked,
    });

    expect(refreshed.valid).toBe(false);
    expect(refreshed.brokenKind).toBe('chain-link-mismatch');
  });

  it('a reset whose chain before it is in no archive still verifies', async () => {
    await resetMidMayThenRecord();
    const may = await mayArchive();

    // The reset's own month holds nothing of the chain it ended, so there is no
    // end to compare the marker with.
    const cross = await verifyChainIntegrityAcrossMonths(await getRecords(), [
      { monthKey: '2026-05', records: may.filter(r => !r.id.startsWith('fr-a-')) },
    ]);

    expect(cross.reason).toBeUndefined();
    expect(cross.valid).toBe(true);
  });

  /**
   * Chain A recorded in April and still active when May begins; the dashboard's
   * reset, which sends no reason, retires it before anything is recorded in May,
   * so the whole of it is filed into April and May's archive never holds it.
   */
  async function resetJustAfterTheMonthFlip(): Promise<ForensicRecord> {
    await seedChainA(3);
    vi.setSystemTime(new Date('2026-05-01T00:10:00.000Z'));
    const reset = await resetForensicChain();
    expect(reset.recordsArchived).toBe(4);
    expect((await loadArchivesOldestFirst()).map(a => a.monthKey)).toEqual(['2026-04']);
    await appendToActiveChain('fr-b-1', '2026-05-01T09:00:00.000Z');
    await appendToActiveChain('fr-b-2', '2026-05-02T09:00:00.000Z');
    return (await getRecords()).find(r => r.kind === 'reset-marker')!;
  }

  const withoutAprilEnd = (a: { monthKey: string; records: ForensicRecord[] }) => ({
    monthKey: a.monthKey,
    records: a.monthKey === '2026-04' ? a.records.filter(r => r.id !== 'fr-a-2' && r.id !== 'fr-a-3') : a.records,
  });

  it('entries cut from the end of a chain a reset filed into the month before are reported, before and after the next rotation', async () => {
    // The reset files each record into its own month, so the only chain it can
    // have ended is the last one filed into April; its end is what the marker names.
    const marker = await resetJustAfterTheMonthFlip();

    const live = await verifyChainIntegrityAcrossMonths(await getRecords(), (await loadArchivesOldestFirst()).map(withoutAprilEnd));
    expect(live.valid).toBe(false);
    expect(live.brokenKind).toBe('chain-link-mismatch');
    expect(live.brokenAtPosition).toBe(0);
    expect(live.reason).toContain('current');
    expect(live.perRecord?.get(marker.id)).toBe('broken');
    expect(live.perRecord?.get('fr-a-1')).toBe('verified');
    expect(live.perRecord?.get('fr-b-2')).toBe('verified');

    const rotation = await rotateChainAtMonthFlip(new Date('2026-06-01T00:30:00.000Z'), 'auto');
    expect(rotation.rotated).toBe(true);
    const rotated = await verifyChainIntegrityAcrossMonths(await getRecords(), (await loadArchivesOldestFirst()).map(withoutAprilEnd));
    expect(rotated.perMonth.map(m => m.monthKey)).toEqual(['2026-04', '2026-05', 'current']);
    expect(rotated.valid).toBe(false);
    expect(rotated.brokenKind).toBe('chain-link-mismatch');
    expect(rotated.reason).toContain('2026-05');
    expect(rotated.perRecord?.get(marker.id)).toBe('broken');
  });

  it('a reset that filed the whole chain it ended into the month before verifies, before and after the next rotation', async () => {
    await resetJustAfterTheMonthFlip();

    const live = await verifyWholeRecord();
    expect(live.reason).toBeUndefined();
    expect(live.valid).toBe(true);

    await rotateChainAtMonthFlip(new Date('2026-06-01T00:30:00.000Z'), 'auto');
    const rotated = await verifyWholeRecord();
    expect(rotated.reason).toBeUndefined();
    expect(rotated.valid).toBe(true);
    expect(rotated.perMonth.map(m => m.monthKey)).toEqual(['2026-04', '2026-05', 'current']);
    expect(rotated.perRecord?.get('fr-a-3')).toBe('verified');
  });

  it('a reset marker with no reason, as a reset that deleted the chain it ended wrote, is not compared with the month before', async () => {
    // April was rotated into its archive, and the May chain the rotation opened
    // was then deleted whole: the marker names that chain's end, which no archive
    // holds, and April's chain is complete. That record is not a cut.
    await seedChainA(3);
    await rotateChainAtMonthFlip(new Date('2026-05-01T00:30:00.000Z'), 'auto');
    await appendToActiveChain('fr-m-1', '2026-05-03T12:00:00.000Z');
    const deletedEnd = (await getRecords()).find(r => r.id === 'fr-m-1')!.integrityHash;
    const marker = await buildRecord('fr-reset-old', 0, CHAIN_GENESIS_HASH, '2026-05-20T12:00:00.000Z', {
      kind: 'reset-marker',
      detectionMode: 'reset-marker',
      priorChainHash: deletedEnd,
    });
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('records', 'readwrite');
      tx.objectStore('records').clear();
      tx.objectStore('records').add(marker);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    await appendToActiveChain('fr-b-1', '2026-05-21T12:00:00.000Z');

    const live = await verifyWholeRecord();
    expect(live.reason).toBeUndefined();
    expect(live.valid).toBe(true);

    await rotateChainAtMonthFlip(new Date('2026-06-01T00:30:00.000Z'), 'auto');
    const rotated = await verifyWholeRecord();
    expect(rotated.reason).toBeUndefined();
    expect(rotated.valid).toBe(true);
    expect(rotated.perMonth.map(m => m.monthKey)).toEqual(['2026-04', '2026-05', 'current']);
  });

  it('a reset whose named entry was filed into an earlier month than the rest of its chain still verifies', async () => {
    // The chain's last entry carries an April time, as a late capture does,
    // so the reset files it into April and the rest of the chain into May.
    const rows: ForensicRecord[] = [];
    let prev = CHAIN_GENESIS_HASH;
    for (let p = 0; p < 4; p++) {
      const at = p === 3 ? '2026-04-30T23:00:00.000Z' : new Date(Date.UTC(2026, 4, 2 + p, 12)).toISOString();
      const r = await buildRecord(`fr-a-${p}`, p, prev, at);
      rows.push(r);
      prev = r.integrityHash;
    }
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('records', 'readwrite');
      for (const r of rows) tx.objectStore('records').add(r);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    vi.setSystemTime(new Date('2026-05-20T12:00:00.000Z'));
    expect((await resetForensicChain('test')).recordsArchived).toBe(4);
    await appendToActiveChain('fr-b-1', '2026-05-21T12:00:00.000Z');
    await rotateChainAtMonthFlip(new Date('2026-06-01T00:30:00.000Z'), 'auto');

    const cross = await verifyWholeRecord();

    expect(cross.reason).toBeUndefined();
    expect(cross.valid).toBe(true);
    expect(cross.perMonth.find(m => m.monthKey === '2026-04')!.result.chainLength).toBe(1);
  });

  it('a chain recorded after the reset and filed before it is not taken for the one the reset ended', async () => {
    await resetMidMayThenRecord();
    await rotateChainAtMonthFlip(new Date('2026-06-01T00:30:00.000Z'), 'auto');
    const may = await mayArchive();
    // A restore retires the chain it replaces before the restored chain, which
    // can open with an older reset, is later rotated into the same month.
    const later0 = await buildRecord('fr-later-0', 0, CHAIN_GENESIS_HASH, '2026-05-25T12:00:00.000Z');
    const later1 = await buildRecord('fr-later-1', 1, later0.integrityHash, '2026-05-26T12:00:00.000Z');

    const cross = await verifyChainIntegrityAcrossMonths(await getRecords(), [
      { monthKey: '2026-05', records: [later0, later1, ...may.filter(r => !r.id.startsWith('fr-a-'))] },
    ]);

    expect(cross.reason).toBeUndefined();
    expect(cross.valid).toBe(true);
  });

  it('a row at the end of the chain before the reset that did not decode is damaged, not cut', async () => {
    await resetMidMayThenRecord();
    await rotateChainAtMonthFlip(new Date('2026-06-01T00:30:00.000Z'), 'auto');
    const may = await mayArchive();

    const cross = await verifyChainIntegrityAcrossMonths(await getRecords(), [
      {
        monthKey: '2026-05',
        records: may.filter(r => r.id !== 'fr-a-3'),
        unreadable: [{ chainPosition: 3, recordsBefore: 3 }],
      },
    ]);

    expect(cross.reason).toBeUndefined();
    expect(cross.valid).toBe(true);
    expect(cross.damagedCount).toBe(1);
  });

  it('a row that did not decode does not excuse an entry missing between it and the last readable one', async () => {
    await resetMidMayThenRecord();
    await rotateChainAtMonthFlip(new Date('2026-06-01T00:30:00.000Z'), 'auto');
    const may = await mayArchive();

    // The row at position 3 may be the entry the reset names, but nothing
    // stands at position 2: that record is known to be gone.
    const cross = await verifyChainIntegrityAcrossMonths(await getRecords(), [
      {
        monthKey: '2026-05',
        records: may.filter(r => r.id !== 'fr-a-2' && r.id !== 'fr-a-3'),
        unreadable: [{ chainPosition: 3, recordsBefore: 2 }],
      },
    ]);

    expect(cross.valid).toBe(false);
    expect(cross.brokenKind).toBe('chain-link-mismatch');
  });

  it('rows that did not decode excuse only the positions they fill one after another', async () => {
    await resetMidMayThenRecord();
    await rotateChainAtMonthFlip(new Date('2026-06-01T00:30:00.000Z'), 'auto');
    const may = await mayArchive();

    // Positions 1 and 3 did not decode and nothing stands at position 2.
    const cross = await verifyChainIntegrityAcrossMonths(await getRecords(), [
      {
        monthKey: '2026-05',
        records: may.filter(r => !['fr-a-1', 'fr-a-2', 'fr-a-3'].includes(r.id)),
        unreadable: [{ chainPosition: 1, recordsBefore: 1 }, { chainPosition: 3, recordsBefore: 1 }],
      },
    ]);

    expect(cross.valid).toBe(false);
    expect(cross.brokenKind).toBe('chain-link-mismatch');
  });

  /** One month's rows, all but those `keep` names, read as stored rows that did not decode. */
  function undecodedExcept(monthKey: string, keep: (r: ForensicRecord) => boolean) {
    return (a: { monthKey: string; records: ForensicRecord[] }) =>
      a.monthKey !== monthKey
        ? a
        : {
            monthKey: a.monthKey,
            records: a.records.filter(keep),
            unreadable: a.records.filter(r => !keep(r)).map(r => ({ chainPosition: r.chainPosition, recordsBefore: 0 })),
          };
  }

  it('a chain a reset filed into the month before that did not decode is damaged, and an older chain is not taken for it', async () => {
    // March is rotated into its archive, then the April chain, rotation marker
    // included, is filed into April by a reset just after the next month flip.
    await seedChainA(2);
    await rotateChainAtMonthFlip(new Date('2026-04-01T00:30:00.000Z'), 'auto');
    await appendToActiveChain('fr-m-1', '2026-04-03T12:00:00.000Z');
    await appendToActiveChain('fr-m-2', '2026-04-04T12:00:00.000Z');
    await appendToActiveChain('fr-m-3', '2026-04-05T12:00:00.000Z');
    vi.setSystemTime(new Date('2026-05-01T00:10:00.000Z'));
    expect((await resetForensicChain()).recordsArchived).toBe(4);
    await appendToActiveChain('fr-b-1', '2026-05-01T09:00:00.000Z');
    const aprilUndecoded = undecodedExcept('2026-04', () => false);

    const live = await verifyChainIntegrityAcrossMonths(await getRecords(), (await loadArchivesOldestFirst()).map(aprilUndecoded));
    expect(live.reason).toBeUndefined();
    expect(live.valid).toBe(true);
    expect(live.damagedCount).toBe(4);

    await rotateChainAtMonthFlip(new Date('2026-06-01T00:30:00.000Z'), 'auto');
    const rotated = await verifyChainIntegrityAcrossMonths(await getRecords(), (await loadArchivesOldestFirst()).map(aprilUndecoded));
    expect(rotated.perMonth.map(m => m.monthKey)).toEqual(['2026-03', '2026-04', '2026-05', 'current']);
    expect(rotated.reason).toBeUndefined();
    expect(rotated.valid).toBe(true);
    expect(rotated.damagedCount).toBe(4);
  });

  it('a chain a reset ended in its own month that did not decode reads the same before and after the next rotation', async () => {
    await seedChainA(3);
    await rotateChainAtMonthFlip(new Date('2026-05-01T00:30:00.000Z'), 'auto');
    await appendToActiveChain('fr-m-1', '2026-05-03T12:00:00.000Z');
    await appendToActiveChain('fr-m-2', '2026-05-04T12:00:00.000Z');
    vi.setSystemTime(new Date('2026-05-20T12:00:00.000Z'));
    expect((await resetForensicChain('test')).recordsArchived).toBe(3);
    await appendToActiveChain('fr-b-1', '2026-05-21T12:00:00.000Z');
    const marker = (await getRecords()).find(r => r.kind === 'reset-marker')!;
    // May's chain before the reset, rotation marker included, did not decode;
    // the reset and the record after it, stored behind those rows, did.
    const mayEndedUndecoded = undecodedExcept('2026-05', r => r.id === marker.id || r.id.startsWith('fr-b-'));

    const live = await verifyChainIntegrityAcrossMonths(await getRecords(), (await loadArchivesOldestFirst()).map(mayEndedUndecoded));
    expect(live.reason).toBeUndefined();
    expect(live.valid).toBe(true);
    expect(live.damagedCount).toBe(3);

    await rotateChainAtMonthFlip(new Date('2026-06-01T00:30:00.000Z'), 'auto');
    const rotated = await verifyChainIntegrityAcrossMonths(await getRecords(), (await loadArchivesOldestFirst()).map(mayEndedUndecoded));
    expect(rotated.perMonth.map(m => m.monthKey)).toEqual(['2026-04', '2026-05', 'current']);
    expect(rotated.perMonth.find(m => m.monthKey === '2026-05')!.result.chainLength).toBe(2);
    expect(rotated.reason).toBeUndefined();
    expect(rotated.valid).toBe(true);
    expect(rotated.damagedCount).toBe(3);
  });
});
