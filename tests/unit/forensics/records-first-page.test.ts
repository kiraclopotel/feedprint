import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/forensics/signing', () => ({
  signHash: vi.fn(async () => 'signed'),
  verifyHash: vi.fn(async () => true),
  getPublicKeyFingerprint: vi.fn(async () => 'mock-fingerprint'),
}));

import {
  addRecord,
  getRecords,
  getRecordsFirstPage,
  lastRecordReadFailed,
} from '../../../src/forensics/store';
import { CHAIN_GENESIS_HASH } from '../../../src/forensics/chain-integrity';
import { computeRecordIntegrityHash } from '../../../src/forensics/canonical-payload';
import type { ForensicRecord } from '../../../src/types/forensic';
import { deleteDb as deleteSharedDb } from '../../helpers/indexeddb';

const DB_NAME = 'feelingwise-forensics';

/** The chain database, torn down through the shared helper. */
const deleteDb = (): Promise<void> => deleteSharedDb(DB_NAME);

async function record(i: number): Promise<ForensicRecord> {
  const id = `fr-page-${String(i).padStart(3, '0')}`;
  const partial: Omit<ForensicRecord, 'integrityHash' | 'signature'> = {
    id,
    timestamp: new Date(Date.parse('2026-07-11T10:00:00.000Z') + i * 60_000).toISOString(),
    platform: 'twitter',
    originalText: id,
    originalHash: `hash-${id}`,
    originalLength: id.length,
    neutralizedText: '',
    author: '@a',
    postUrl: `https://x.com/p/${id}`,
    techniques: [],
    overallScore: 0,
    userAgeCategory: 'teen',
    aiSource: 'cloud',
    feedSource: 'unknown',
    prevRecordHash: CHAIN_GENESIS_HASH,
    chainPosition: i,
    chainAnchor: 'genesis-v1',
    publicKeyFingerprint: 'mock-fingerprint',
  };
  return { ...partial, integrityHash: await computeRecordIntegrityHash(partial) };
}

beforeEach(async () => {
  await deleteDb();
});

afterEach(async () => {
  await deleteDb();
});

describe('getRecordsFirstPage', () => {
  it('returns exactly the newest N records, in the same insertion order getRecords yields', async () => {
    for (let i = 0; i < 25; i++) await addRecord(await record(i));

    const page = await getRecordsFirstPage(10);
    const all = await getRecords();

    expect(page).not.toBeNull();
    expect(page!.map(r => r.id)).toEqual(all.slice(-10).map(r => r.id));
    expect(page![0].chainPosition).toBe(15);
    expect(page![page!.length - 1].chainPosition).toBe(24);
  });

  it('returns the whole chain when it is shorter than the page', async () => {
    for (let i = 0; i < 3; i++) await addRecord(await record(i));
    const page = await getRecordsFirstPage(10);
    expect(page!.map(r => r.chainPosition)).toEqual([0, 1, 2]);
  });

  it('returns [] on an empty store and never flips the failed-read flag', async () => {
    const page = await getRecordsFirstPage(10);
    expect(page).toEqual([]);
    // The page read is a paint optimization: only the authoritative
    // getRecords() may report a failed read, and a page read must not
    // launder a prior failure state either way.
    expect(lastRecordReadFailed()).toBe(false);
  });
});
