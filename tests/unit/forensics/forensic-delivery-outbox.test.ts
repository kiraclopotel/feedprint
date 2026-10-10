import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

import {
  FORENSIC_DELIVERY_OUTBOX_STORE,
  FORENSIC_DELIVERY_RECEIPTS_STORE,
  FORENSIC_DELIVERY_META_STORE,
  addRecord,
  getAllParentFeedback,
  getRecords,
  openDB,
  replaceBackupStateUnderChainLock,
  resetForensicChain,
} from '../../../src/forensics/store';
import {
  enqueueForensicDelivery,
  getForensicDeliveryStatus,
  getForensicDeliveryReceiptState,
  getNextForensicDelivery,
  markForensicDeliveryFailure,
  pruneForensicDeliveryReceipts,
} from '../../../src/forensics/delivery-outbox';
import { CHAIN_GENESIS_HASH } from '../../../src/forensics/chain-integrity';
import { computeRecordIntegrityHash } from '../../../src/forensics/canonical-payload';
import type { ForensicRecord } from '../../../src/types/forensic';
import { deleteDb as deleteSharedDb } from '../../helpers/indexeddb';

const DB_NAME = 'feelingwise-forensics';

/** The chain database, torn down through the shared helper. */
const deleteDb = (): Promise<void> => deleteSharedDb(DB_NAME);

async function record(id: string): Promise<ForensicRecord> {
  const partial: Omit<ForensicRecord, 'integrityHash' | 'signature'> = {
    id,
    timestamp: '2026-07-11T10:00:00.000Z',
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
    chainPosition: 0,
    chainAnchor: 'genesis-v1',
    publicKeyFingerprint: 'mock-fingerprint',
  };
  return { ...partial, integrityHash: await computeRecordIntegrityHash(partial) };
}

async function putDeliveryMeta(value: Record<string, unknown>): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(FORENSIC_DELIVERY_META_STORE, 'readwrite');
    tx.objectStore(FORENSIC_DELIVERY_META_STORE).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function getDeliveryMeta(key: string): Promise<Record<string, unknown> | undefined> {
  const db = await openDB();
  const value = await new Promise<Record<string, unknown> | undefined>((resolve, reject) => {
    const tx = db.transaction(FORENSIC_DELIVERY_META_STORE, 'readonly');
    const req = tx.objectStore(FORENSIC_DELIVERY_META_STORE).get(key);
    req.onsuccess = () => resolve(req.result as Record<string, unknown> | undefined);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return value;
}

beforeEach(async () => {
  await deleteDb();
});

afterEach(async () => {
  await deleteDb();
});

describe('durable forensic delivery outbox', () => {
  it('rejects an invalid capture timestamp without opening a queue row', async () => {
    await expect(enqueueForensicDelivery({
      deliveryId: 'delivery-invalid-time',
      type: 'PASS_LOG',
      payload: {},
      enqueuedAt: 'not-a-date',
    })).rejects.toThrow('invalid forensic capture timestamp');
    expect((await getForensicDeliveryStatus()).pendingCount).toBe(0);
  });

  it('excludes an in-flight capture from before a restore boundary and reports it', async () => {
    await putDeliveryMeta({
      key: 'destructiveCutoff',
      kind: 'restore',
      capturedAt: '2026-07-11T10:00:00.000Z',
    });

    expect(await enqueueForensicDelivery({
      deliveryId: 'delivery-before-restore',
      type: 'PASS_LOG',
      payload: { originalText: 'belongs to outgoing identity' },
      enqueuedAt: '2026-07-11T09:59:59.999Z',
    })).toEqual({ state: 'discarded' });

    expect(await getForensicDeliveryReceiptState('delivery-before-restore')).toBe('discarded');
    expect(await getForensicDeliveryStatus()).toMatchObject({
      pendingCount: 0,
      discardedRestoreCount: 1,
    });
  });

  it('retains an in-flight capture from before rotation with explicit late provenance', async () => {
    await putDeliveryMeta({
      key: 'rotationCutoff',
      capturedAt: '2026-07-11T10:00:00.000Z',
    });

    expect(await enqueueForensicDelivery({
      deliveryId: 'delivery-before-rotation',
      type: 'FORENSIC_LOG',
      payload: { originalText: 'late but retained' },
      // Offset form exercises time comparison rather than string ordering.
      enqueuedAt: '2026-07-11T11:59:59.999+02:00',
    })).toEqual({ state: 'pending' });

    expect(await getNextForensicDelivery()).toMatchObject({
      deliveryId: 'delivery-before-rotation',
      disposition: 'late-after-rotation',
    });
  });

  it('enqueues a delivery idempotently while it is pending', async () => {
    const delivery = {
      deliveryId: 'delivery-pending',
      type: 'FORENSIC_LOG' as const,
      payload: { originalText: 'first payload wins' },
      enqueuedAt: '2026-07-11T10:00:00.000Z',
    };

    expect(await enqueueForensicDelivery(delivery)).toEqual({ state: 'pending' });
    expect(await enqueueForensicDelivery({
      ...delivery,
      payload: { originalText: 'duplicate payload must not overwrite' },
    })).toEqual({ state: 'pending' });

    const status = await getForensicDeliveryStatus();
    expect(status.pendingCount).toBe(1);
    expect((await getNextForensicDelivery())?.payload).toEqual({ originalText: 'first payload wins' });
  });

  it('preserves insertion order when captures share the same millisecond', async () => {
    const enqueuedAt = '2026-07-11T10:00:00.000Z';
    for (const deliveryId of ['delivery-z', 'delivery-a', 'delivery-m']) {
      await enqueueForensicDelivery({
        deliveryId,
        type: 'PASS_LOG',
        payload: { deliveryId },
        enqueuedAt,
      });
    }

    expect((await getNextForensicDelivery())?.deliveryId).toBe('delivery-z');
    await addRecord(await record('fr-z'), 'delivery-z');
    expect((await getNextForensicDelivery())?.deliveryId).toBe('delivery-a');
    await addRecord(await record('fr-a'), 'delivery-a');
    expect((await getNextForensicDelivery())?.deliveryId).toBe('delivery-m');
  });

  it('atomically stores the record, removes the outbox row, and keeps a durable receipt', async () => {
    const deliveryId = 'delivery-commit';
    await enqueueForensicDelivery({
      deliveryId,
      type: 'PASS_LOG',
      payload: { originalText: 'served pass' },
      enqueuedAt: '2026-07-11T10:00:00.000Z',
    });

    await addRecord(await record('fr-delivery-commit'), deliveryId);

    expect(await getRecords()).toHaveLength(1);
    expect((await getForensicDeliveryStatus()).pendingCount).toBe(0);
    expect(await enqueueForensicDelivery({
      deliveryId,
      type: 'PASS_LOG',
      payload: { originalText: 'lost-ack duplicate' },
      enqueuedAt: '2026-07-11T10:00:01.000Z',
    })).toEqual({ state: 'committed' });
    expect(await getRecords()).toHaveLength(1);
  });

  it('rolls record add and outbox delete back together if receipt finalization fails', async () => {
    const deliveryId = 'delivery-rollback';
    await enqueueForensicDelivery({
      deliveryId,
      type: 'BLOCKED_LOG',
      payload: { originalText: 'blocked item' },
      enqueuedAt: '2026-07-11T10:00:00.000Z',
    });
    await addRecord(await record('fr-first-commit'), deliveryId);

    // Simulate a stale duplicate outbox row despite the durable receipt.
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(FORENSIC_DELIVERY_OUTBOX_STORE, 'readwrite');
      tx.objectStore(FORENSIC_DELIVERY_OUTBOX_STORE).put({
        deliveryId,
        type: 'BLOCKED_LOG',
        payload: { originalText: 'stale duplicate' },
        enqueuedAt: '2026-07-11T10:00:02.000Z',
        attempts: 0,
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();

    await expect(addRecord(await record('fr-must-roll-back'), deliveryId)).rejects.toThrow();

    expect(await getRecords()).toHaveLength(1);
    expect((await getForensicDeliveryStatus()).pendingCount).toBe(1);
  });

  it('persists failure type, count, first/last time, error, and next attempt', async () => {
    await enqueueForensicDelivery({
      deliveryId: 'delivery-failed',
      type: 'ENVIRONMENT_LOG',
      payload: { originalText: 'room' },
      enqueuedAt: '2026-07-11T10:00:00.000Z',
    });

    await markForensicDeliveryFailure(
      'delivery-failed',
      'signing key read failed',
      '2026-07-11T10:00:01.000Z',
    );
    await markForensicDeliveryFailure(
      'delivery-failed',
      'signing key still unavailable',
      '2026-07-11T10:00:05.000Z',
    );

    const status = await getForensicDeliveryStatus();
    expect(status).toMatchObject({
      pendingCount: 1,
      failedCount: 1,
      firstFailureAt: '2026-07-11T10:00:01.000Z',
      lastFailureAt: '2026-07-11T10:00:05.000Z',
      lastError: 'signing key still unavailable',
      byType: { ENVIRONMENT_LOG: 1 },
    });
    const next = await getNextForensicDelivery();
    expect(next).toMatchObject({ attempts: 2, nextAttemptAt: expect.any(String) });
  });

  it('prunes expired receipts and enforces a hard receipt cap', async () => {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(FORENSIC_DELIVERY_RECEIPTS_STORE, 'readwrite');
      const receipts = tx.objectStore(FORENSIC_DELIVERY_RECEIPTS_STORE);
      for (const [deliveryId, finalizedAt] of [
        ['receipt-expired', '2026-07-01T00:00:00.000Z'],
        ['receipt-overflow', '2026-07-09T00:00:00.000Z'],
        ['receipt-keep-1', '2026-07-10T00:00:00.000Z'],
        ['receipt-keep-2', '2026-07-11T00:00:00.000Z'],
      ]) receipts.put({ deliveryId, status: 'committed', finalizedAt });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();

    expect(await pruneForensicDeliveryReceipts(
      Date.parse('2026-07-11T12:00:00.000Z'),
      2,
      7 * 24 * 60 * 60 * 1_000,
    )).toBe(2);
    expect(await getForensicDeliveryReceiptState('receipt-expired')).toBeNull();
    expect(await getForensicDeliveryReceiptState('receipt-overflow')).toBeNull();
    expect(await getForensicDeliveryReceiptState('receipt-keep-1')).toBe('committed');
    expect(await getForensicDeliveryReceiptState('receipt-keep-2')).toBe('committed');
  });

  it('creates both v6 stores in the active database', async () => {
    const db = await openDB();
    expect(db.objectStoreNames.contains(FORENSIC_DELIVERY_OUTBOX_STORE)).toBe(true);
    expect(db.objectStoreNames.contains(FORENSIC_DELIVERY_RECEIPTS_STORE)).toBe(true);
    expect(db.objectStoreNames.contains(FORENSIC_DELIVERY_META_STORE)).toBe(true);
    db.close();
  });

  it('upgrades a v5 database without replacing its existing chain rows', async () => {
    const existing = await record('fr-existing-v5');
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 5);
      req.onupgradeneeded = () => {
        const db = req.result;
        const records = db.createObjectStore('records', { autoIncrement: true });
        records.createIndex('timestamp', 'timestamp', { unique: false });
        records.createIndex('platform', 'platform', { unique: false });
        records.createIndex('chainPosition', 'chainPosition', { unique: false });
        db.createObjectStore('parentFeedback', { keyPath: 'recordId' });
        const anchors = db.createObjectStore('chainAnchors', { keyPath: 'id' });
        anchors.createIndex('anchoredChainPosition', 'anchoredChainPosition', { unique: false });
        anchors.createIndex('requestedAt', 'requestedAt', { unique: false });
      };
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('records', 'readwrite');
        tx.objectStore('records').add(existing);
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });

    const db = await openDB();
    expect(db.version).toBe(6);
    expect(db.objectStoreNames.contains(FORENSIC_DELIVERY_OUTBOX_STORE)).toBe(true);
    expect(db.objectStoreNames.contains(FORENSIC_DELIVERY_RECEIPTS_STORE)).toBe(true);
    expect(db.objectStoreNames.contains(FORENSIC_DELIVERY_META_STORE)).toBe(true);
    db.close();
    expect((await getRecords()).map(row => row.id)).toEqual(['fr-existing-v5']);
  });

  it('reset atomically discards pending pre-reset deliveries and receipts block stale replay', async () => {
    await enqueueForensicDelivery({
      deliveryId: 'delivery-committed-before-reset',
      type: 'PASS_LOG',
      payload: { originalText: 'already committed' },
      enqueuedAt: '2026-07-11T09:59:00.000Z',
    });
    await addRecord(await record('fr-before-reset'), 'delivery-committed-before-reset');
    const delivery = {
      deliveryId: 'delivery-before-reset',
      type: 'CANCEL_LOG' as const,
      payload: { originalText: 'pre-reset observation' },
      enqueuedAt: '2026-07-11T10:00:00.000Z',
    };
    await enqueueForensicDelivery(delivery);

    await resetForensicChain('parent reset');

    expect((await getForensicDeliveryStatus()).pendingCount).toBe(0);
    expect(await getForensicDeliveryReceiptState('delivery-committed-before-reset')).toBeNull();
    expect(await enqueueForensicDelivery(delivery)).toEqual({ state: 'discarded' });
    expect(await enqueueForensicDelivery({
      ...delivery,
      deliveryId: 'delivery-in-flight-before-reset',
    })).toEqual({ state: 'discarded' });
    expect(await enqueueForensicDelivery({
      ...delivery,
      deliveryId: 'delivery-after-reset',
      enqueuedAt: new Date(Date.now() + 1_000).toISOString(),
    })).toEqual({ state: 'pending' });
    const records = await getRecords();
    expect(records).toHaveLength(1);
    expect(records[0].kind).toBe('reset-marker');
  });

  it('restores records, anchors, and feedback atomically and clears orphan sidecars', async () => {
    await enqueueForensicDelivery({
      deliveryId: 'delivery-outgoing',
      type: 'PASS_LOG',
      payload: { originalText: 'outgoing record' },
      enqueuedAt: '2026-07-11T09:59:00.000Z',
    });
    await addRecord(await record('fr-outgoing'), 'delivery-outgoing');
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['chainAnchors', 'parentFeedback'], 'readwrite');
      tx.objectStore('chainAnchors').add({ id: 'anchor-outgoing', anchoredChainPosition: 0 });
      tx.objectStore('parentFeedback').put({
        recordId: 'fr-outgoing', feedback: 'confirmed', timestamp: '2026-07-10T00:00:00.000Z',
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();

    const incomingAnchor = {
      id: 'anchor-incoming',
      anchoredChainPosition: 0,
      anchoredIntegrityHash: 'incoming-hash',
      tsaProvider: 'freetsa',
      responseB64: 'response',
      tstB64: 'token',
      generalizedTime: null,
      requestedAt: '2026-07-11T00:00:00.000Z',
    };
    await replaceBackupStateUnderChainLock(
      [await record('fr-incoming')],
      [incomingAnchor],
      [{ recordId: 'fr-incoming', feedback: 'disputed', timestamp: '2026-07-11T00:00:00.000Z' }],
      true,
    );

    expect((await getRecords()).map(row => row.id)).toEqual(['fr-incoming']);
    expect(Array.from((await getAllParentFeedback()).keys())).toEqual(['fr-incoming']);
    const inspect = await openDB();
    const anchorIds = await new Promise<string[]>((resolve, reject) => {
      const tx = inspect.transaction('chainAnchors', 'readonly');
      const req = tx.objectStore('chainAnchors').getAll();
      req.onsuccess = () => resolve((req.result as Array<{ id: string }>).map(row => row.id));
      req.onerror = () => reject(req.error);
    });
    inspect.close();
    expect(anchorIds).toEqual(['anchor-incoming']);
    expect(await getDeliveryMeta('destructiveCutoff')).toMatchObject({
      key: 'destructiveCutoff',
      kind: 'restore',
      capturedAt: expect.any(String),
    });
    expect(await getForensicDeliveryReceiptState('delivery-outgoing')).toBeNull();
    expect(await enqueueForensicDelivery({
      deliveryId: 'delivery-outgoing',
      type: 'PASS_LOG',
      payload: { originalText: 'stale outgoing retry' },
      enqueuedAt: '2000-01-01T00:00:00.000Z',
    })).toEqual({ state: 'discarded' });

    await expect(replaceBackupStateUnderChainLock(
      [await record('fr-must-roll-back')],
      [incomingAnchor, incomingAnchor],
      [],
    )).rejects.toThrow();
    expect((await getRecords()).map(row => row.id)).toEqual(['fr-incoming']);
    expect(Array.from((await getAllParentFeedback()).keys())).toEqual(['fr-incoming']);
  });
});
