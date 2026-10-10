// FeelingWise — forensic-chain respawn + restore-realm guards.
//
// Locks three integrity guarantees that protect the tamper-evident chain
// (VISION §1.1: the chain must break visibly ONLY on real tampering and stay
// verifiable by a third party):
//
//   H1  getChainState must THROW on an IDB error, never silently fork the
//       chain at genesis (position 0). A transient IDB failure that returned
//       genesis would let a re-encountered position-0 record collide with the
//       real genesis and the integrity walk would report a false break.
//
//   H2  resetForensicChain + rotateChainAtMonthFlip must run the IDB clear and
//       the genesis-marker write inside ONE sharedChainWriteLock acquisition,
//       so a concurrent logger FORENSIC_LOG cannot stamp chainPosition 0
//       between the clear and the marker.
//
//   H3  verifyChainIntegrity must NOT report a chain broken (key-mismatch)
//       when the public-key fingerprint can't be resolved in the current realm
//       (dashboard realm after a restore). Content-intact records fall back to
//       a non-failing verdict, distinct from real tampering.
//
// The IDB orchestration is exercised here against a minimal in-memory
// IndexedDB shim (the project ships no fake-indexeddb); the shim covers only
// the operations these functions touch.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Minimal in-memory IndexedDB shim ──────────────────────────────────────
// Supports: open (with onupgradeneeded for fresh DBs), object stores with
// count / clear / getAll / add / get / index(...).openCursor('prev'). Enough
// for store.ts + chain-rotation.ts respawn paths. NOT a general IDB.

type Row = Record<string, unknown>;

const ACTIVE_DB = 'feelingwise-forensics';

class FakeObjectStore {
  rows: Row[] = [];
  constructor(public dbName: string, public name: string, public keyPath: string | null, public autoIncrement: boolean) {}
  private seq = 1;
  private isActiveRecords() { return this.dbName === ACTIVE_DB && this.name === 'records'; }
  add(value: Row) {
    if (this.autoIncrement) value.__key = this.seq++;
    this.rows.push(value);
    if (this.isActiveRecords()) lockEvents.push('add');
    return fakeRequest(undefined);
  }
  put(value: Row) {
    const key = this.keyPath ? value[this.keyPath] : undefined;
    if (key !== undefined) {
      const existing = this.rows.findIndex(row => row[this.keyPath!] === key);
      if (existing >= 0) this.rows[existing] = value;
      else this.rows.push(value);
    } else {
      this.rows.push(value);
    }
    return fakeRequest(undefined);
  }
  delete(key: unknown) {
    const keyField = this.keyPath ?? '__key';
    this.rows = this.rows.filter(row => row[keyField] !== key);
    return fakeRequest(undefined);
  }
  clear() {
    this.rows = [];
    fakeClearEvents.push('clear');
    if (this.isActiveRecords()) lockEvents.push('clear');
    return fakeRequest(undefined);
  }
  count() {
    return fakeRequest(this.rows.length);
  }
  getAll() {
    if (this.isActiveRecords() && activeRecordsReadShouldError) {
      return fakeErrorRequest<Row[]>(new Error('active records read failed (test)'));
    }
    return fakeRequest([...this.rows]);
  }
  index(_name: string) {
    return new FakeIndex(this);
  }
  // Bare store cursor (used by store.ts's v1→v2 onupgradeneeded migration).
  openCursor() {
    return new FakeIndex(this).openCursor(null, 'next');
  }
  createIndex() { /* noop */ }
  get indexNames() { return { contains: () => true }; }
}

class FakeIndex {
  constructor(private store: FakeObjectStore) {}
  openCursor(_range: unknown, dir: 'prev' | 'next' = 'next') {
    const sorted = [...this.store.rows].sort(
      (a, b) => ((a.chainPosition as number) ?? -1) - ((b.chainPosition as number) ?? -1),
    );
    if (dir === 'prev') sorted.reverse();
    let i = 0;
    const req = fakeRequest<unknown>(null);
    const step = () => {
      if (i >= sorted.length) {
        req.result = null;
        req.onsuccess?.({ target: req } as unknown as Event);
        return;
      }
      const value = sorted[i++];
      req.result = {
        value,
        continue: () => queueMicrotask(step),
      };
      req.onsuccess?.({ target: req } as unknown as Event);
    };
    queueMicrotask(step);
    return req;
  }
}

class FakeTransaction {
  constructor(private db: FakeDB) {}
  oncomplete: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  error: unknown = null;
  objectStore(name: string) {
    // Forced auxiliary-wipe failure: only clearChainAnchors opens a
    // transaction on this store, so failing it exercises the M58 partial
    // path without touching the destructive cutover transaction.
    if (name === 'chainAnchors' && anchorClearShouldError) {
      this.error = new Error('anchor clear failed (test)');
      queueMicrotask(() => this.onerror?.());
      return this.db.stores.get(name)!;
    }
    const s = this.db.stores.get(name)!;
    // Fire oncomplete on the next microtask after the synchronous op queue.
    queueMicrotask(() => this.oncomplete?.());
    return s;
  }
}

class FakeDB {
  stores = new Map<string, FakeObjectStore>();
  constructor(public name: string) {}
  transaction(_name: string | string[], _mode?: string) {
    return new FakeTransaction(this);
  }
  close() { /* noop */ }
  get objectStoreNames() {
    const names = new Set(this.stores.keys());
    return { contains: (n: string) => names.has(n) };
  }
  createObjectStore(name: string, opts?: { keyPath?: string; autoIncrement?: boolean }) {
    const s = new FakeObjectStore(this.name, name, opts?.keyPath ?? null, !!opts?.autoIncrement);
    this.stores.set(name, s);
    return s;
  }
}

interface FakeRequest<T> {
  result: T;
  error: unknown;
  onsuccess: ((e: Event) => void) | null;
  onerror: ((e: Event) => void) | null;
  transaction?: unknown;
}

function fakeRequest<T>(result: T): FakeRequest<T> {
  const req: FakeRequest<T> = { result, error: null, onsuccess: null, onerror: null };
  queueMicrotask(() => req.onsuccess?.({ target: req } as unknown as Event));
  return req;
}

function fakeErrorRequest<T>(error: unknown): FakeRequest<T> {
  const req: FakeRequest<T> = {
    result: undefined as T,
    error,
    onsuccess: null,
    onerror: null,
  };
  queueMicrotask(() => req.onerror?.({ target: req } as unknown as Event));
  return req;
}

const fakeClearEvents: string[] = [];
const fakeDbs = new Map<string, FakeDB>();
let openShouldError = false;
let activeRecordsReadShouldError = false;
let anchorClearShouldError = false;

function installFakeIndexedDB() {
  fakeDbs.clear();
  fakeClearEvents.length = 0;
  openShouldError = false;
  activeRecordsReadShouldError = false;
  anchorClearShouldError = false;
  (globalThis as unknown as { indexedDB: unknown }).indexedDB = {
    open(name: string, _version?: number) {
      const req: FakeRequest<FakeDB> & { onupgradeneeded?: (e: { oldVersion: number }) => void } = {
        result: undefined as unknown as FakeDB,
        error: null,
        onsuccess: null,
        onerror: null,
      };
      queueMicrotask(() => {
        if (openShouldError) {
          req.error = new Error('IDB open failed (test)');
          req.onerror?.({ target: req } as unknown as Event);
          return;
        }
        let db = fakeDbs.get(name);
        const fresh = !db;
        if (!db) {
          db = new FakeDB(name);
          fakeDbs.set(name, db);
        }
        req.result = db;
        (req as unknown as { transaction: unknown }).transaction = db.transaction('records');
        if (fresh) {
          // Seed the stores store.ts's onupgradeneeded would create.
          db.createObjectStore('records', { autoIncrement: true });
          db.createObjectStore('parentFeedback', { keyPath: 'recordId' });
          db.createObjectStore('chainAnchors', { keyPath: 'id' });
          req.onupgradeneeded?.({ oldVersion: 0 });
        }
        req.onsuccess?.({ target: req } as unknown as Event);
      });
      return req;
    },
    deleteDatabase() { return fakeRequest(undefined); },
  };
}

// ─── Shared mocks ───────────────────────────────────────────────────────────

vi.mock('../../../src/forensics/signing', () => ({
  signHash: vi.fn(async () => 'mock-sig'),
  verifyHash: vi.fn(async () => true),
  getPublicKeyFingerprint: vi.fn(async () => 'mock-fp'),
  clearSigningKeyCache: vi.fn(),
}));

// Instrument the shared chain-write lock so we can observe acquire/release
// ordering around the IDB clear + marker write. The real FIFO semantics are
// preserved; we only push events.
const lockEvents: string[] = [];
vi.mock('../../../src/forensics/chain-write-lock', () => {
  let lock: Promise<void> = Promise.resolve();
  const withLock = async <T>(work: () => Promise<T>): Promise<T> => {
    const prior = lock;
    let release!: () => void;
    lock = new Promise<void>((r) => { release = r; });
    try {
      await prior;
      lockEvents.push('lock:enter');
      return await work();
    } finally {
      lockEvents.push('lock:exit');
      release();
    }
  };
  return { sharedChainWriteLock: withLock, createChainWriteLock: () => withLock };
});

// Aux clears reset to fulfilled no-ops. resetForensicChain Promise.allSettles
// these; their content is unrelated to the lock guarantee under test.
vi.mock('../../../src/forensics/scan-log', () => ({ clearScanLog: vi.fn(async () => {}) }));
vi.mock('../../../src/forensics/author-store', () => ({ clearAuthorProfiles: vi.fn(async () => {}) }));
vi.mock('../../../src/forensics/neutralizer-diagnostics', () => ({ resetNeutralizerDiagnostics: vi.fn(async () => {}) }));
vi.mock('../../../src/storage/settings', () => ({
  getSettings: vi.fn(async () => ({ mode: 'adult' })),
  getSettingsForAttestation: vi.fn(async () => ({ mode: 'adult', readFailed: false })),
  resetUsageStats: vi.fn(async () => {}),
}));
vi.mock('../../../src/storage/cache', () => ({ processingCache: { clear: vi.fn() } }));
vi.mock('../../../src/analysis/comment-batch-scorer', () => ({ clearBatchCache: vi.fn() }));
vi.mock('../../../src/forensics/delivery-outbox', () => ({
  getForensicDeliveryStatus: vi.fn(async () => ({
    pendingCount: 0,
    failedCount: 0,
    discardedRestoreCount: 0,
    byType: {},
  })),
}));

// Instrument addRecord so the marker write is observable in the lock timeline.
vi.mock('../../../src/forensics/record-compression', async (orig) => {
  const mod = await (orig() as Promise<Record<string, unknown>>);
  return mod;
});

import { addRecord, getChainState, resetForensicChain } from '../../../src/forensics/store';
import { verifyChainIntegrity, CHAIN_GENESIS_HASH } from '../../../src/forensics/chain-integrity';
import { computeRecordIntegrityHash } from '../../../src/forensics/canonical-payload';
import { rotateChainAtMonthFlip } from '../../../src/forensics/chain-rotation';
import { unwrapStoredEntry } from '../../../src/forensics/record-compression';
import { getPublicKeyFingerprint, signHash, verifyHash } from '../../../src/forensics/signing';
import { getForensicDeliveryStatus } from '../../../src/forensics/delivery-outbox';
import type { ForensicRecord } from '../../../src/types/forensic';

const mockedFingerprint = vi.mocked(getPublicKeyFingerprint);
const mockedSignHash = vi.mocked(signHash);
const mockedVerifyHash = vi.mocked(verifyHash);

beforeEach(() => {
  installFakeIndexedDB();
  lockEvents.length = 0;
  mockedSignHash.mockReset().mockResolvedValue('mock-sig');
  vi.mocked(getForensicDeliveryStatus).mockResolvedValue({
    pendingCount: 0,
    failedCount: 0,
    quarantinedCount: 0,
    discardedRestoreCount: 0,
    byType: {},
  });
  // No chrome in this realm — resetForensicChain handles its absence.
  (globalThis as unknown as { chrome?: unknown }).chrome = undefined;
});

// ─── H4: new active-chain writes never land unsigned ────────────────────────

describe('H4 — addRecord requires a signature before writing', () => {
  function record(id: string): ForensicRecord {
    return {
      id,
      timestamp: '2026-07-11T00:00:00.000Z',
      platform: 'twitter',
      originalText: 'observed text',
      originalHash: 'original-hash',
      originalLength: 13,
      neutralizedText: '',
      author: '@author',
      postUrl: 'https://x.com/author/status/1',
      techniques: [],
      overallScore: 0,
      userAgeCategory: 'teen',
      aiSource: 'cloud',
      feedSource: 'unknown',
      prevRecordHash: CHAIN_GENESIS_HASH,
      chainPosition: 0,
      integrityHash: 'integrity-hash',
    };
  }

  it('retries transient signing failures and stores exactly one signed record', async () => {
    vi.useFakeTimers();
    mockedSignHash
      .mockRejectedValueOnce(new Error('transient signing failure 1'))
      .mockRejectedValueOnce(new Error('transient signing failure 2'))
      .mockResolvedValueOnce('recovered-signature');

    const write = addRecord(record('fr-sign-recover'));
    await vi.advanceTimersByTimeAsync(600);
    await expect(write).resolves.toBeUndefined();

    expect(mockedSignHash).toHaveBeenCalledTimes(3);
    const rows = fakeDbs.get(ACTIVE_DB)!.stores.get('records')!.rows;
    expect(rows).toHaveLength(1);
    const stored = await unwrapStoredEntry(rows[0]);
    expect(stored.signature).toBe('recovered-signature');
    vi.useRealTimers();
  });

  it('rejects after the bounded attempts and leaves the chain unchanged', async () => {
    vi.useFakeTimers();
    mockedSignHash.mockRejectedValue(new Error('persistent signing failure'));

    const write = addRecord(record('fr-sign-fail'));
    const rejection = expect(write).rejects.toThrow('persistent signing failure');
    await vi.advanceTimersByTimeAsync(600);
    await rejection;

    expect(mockedSignHash).toHaveBeenCalledTimes(3);
    expect(fakeDbs.get(ACTIVE_DB)).toBeUndefined();
    vi.useRealTimers();
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

// ─── H1: getChainState throws on IDB error (never forks at genesis) ─────────

describe('H1 — getChainState surfaces IDB errors instead of forking at genesis', () => {
  it('throws when indexedDB.open fails (does NOT return position 0)', async () => {
    installFakeIndexedDB();
    openShouldError = true;
    await expect(getChainState()).rejects.toThrow();
  });

  it('still returns genesis on a genuinely EMPTY chain (success path unchanged)', async () => {
    installFakeIndexedDB();
    const state = await getChainState();
    expect(state).toEqual({ nextPosition: 0, prevRecordHash: CHAIN_GENESIS_HASH });
  });
});

// ─── H2: clear + marker run inside ONE chain-write lock ─────────────────────

describe('H2 — respawn clears + writes the marker inside ONE chain-write lock', () => {
  async function seedActiveRecord(id: string, timestamp: string): Promise<Row> {
    const activeDb = new FakeDB(ACTIVE_DB);
    fakeDbs.set(ACTIVE_DB, activeDb);
    activeDb.createObjectStore('records', { autoIncrement: true });
    activeDb.createObjectStore('parentFeedback', { keyPath: 'recordId' });
    activeDb.createObjectStore('chainAnchors', { keyPath: 'id' });
    activeDb.createObjectStore('deliveryOutbox', { keyPath: 'queueSequence', autoIncrement: true });
    activeDb.createObjectStore('deliveryReceipts', { keyPath: 'deliveryId' });
    activeDb.createObjectStore('deliveryMeta', { keyPath: 'key' });
    const payload: Omit<ForensicRecord, 'integrityHash' | 'signature' | 'chainAnchor'> = {
      id,
      timestamp,
      platform: 'twitter',
      originalText: 'existing observation',
      originalHash: 'existing-hash',
      originalLength: 20,
      neutralizedText: '',
      author: '@a',
      postUrl: 'https://x.com/p/0',
      techniques: [],
      overallScore: 0,
      userAgeCategory: 'teen',
      aiSource: 'cloud',
      feedSource: 'unknown',
      prevRecordHash: CHAIN_GENESIS_HASH,
      chainPosition: 0,
      publicKeyFingerprint: 'mock-fp',
    };
    const integrityHash = await computeRecordIntegrityHash(payload);
    const stored: Row = {
      ...payload,
      integrityHash,
      signature: 'existing-signature',
      chainAnchor: 'genesis-v1',
    };
    activeDb.stores.get('records')!.rows.push(stored);
    return stored;
  }

  async function appendActiveRecord(id: string, timestamp: string): Promise<Row> {
    const rows = fakeDbs.get(ACTIVE_DB)!.stores.get('records')!.rows;
    const prior = await unwrapStoredEntry(rows[rows.length - 1]);
    const payload: Omit<ForensicRecord, 'integrityHash' | 'signature'> = {
      id,
      timestamp,
      platform: 'twitter',
      originalText: `observation ${id}`,
      originalHash: `hash-${id}`,
      originalLength: id.length + 12,
      neutralizedText: '',
      author: '@a',
      postUrl: `https://x.com/p/${id}`,
      techniques: [],
      overallScore: 0,
      userAgeCategory: 'teen',
      aiSource: 'cloud',
      feedSource: 'unknown',
      prevRecordHash: prior.integrityHash,
      chainPosition: (prior.chainPosition ?? 0) + 1,
      publicKeyFingerprint: 'mock-fp',
      chainAnchor: 'genesis-v1',
    };
    const integrityHash = await computeRecordIntegrityHash(payload);
    const stored: Row = { ...payload, integrityHash, signature: 'existing-signature' };
    rows.push(stored);
    return stored;
  }

  it('resetForensicChain: IDB clear + marker write are inside a single lock window', async () => {
    installFakeIndexedDB();
    lockEvents.length = 0;
    const result = await resetForensicChain('test reason');

    // Exactly one lock acquisition wraps the whole respawn.
    expect(lockEvents.filter((e) => e === 'lock:enter')).toHaveLength(1);
    expect(lockEvents.filter((e) => e === 'lock:exit')).toHaveLength(1);

    // The distinguishing assertion vs the pre-fix code: the records-store
    // clear and the marker add BOTH fall strictly between the single
    // lock:enter and lock:exit. Pre-fix the clear ran BEFORE the (marker-only)
    // lock window — i.e. the clear would precede lock:enter.
    const enter = lockEvents.indexOf('lock:enter');
    const exit = lockEvents.indexOf('lock:exit');
    const clearIdx = lockEvents.indexOf('clear');
    const addIdx = lockEvents.indexOf('add');
    expect(enter).toBeGreaterThanOrEqual(0);
    expect(clearIdx).toBeGreaterThan(enter);
    expect(addIdx).toBeGreaterThan(clearIdx);
    expect(exit).toBeGreaterThan(addIdx);

    // The marker landed at chainPosition 0 of the fresh chain.
    const recordsDb = fakeDbs.get('feelingwise-forensics')!;
    const records = recordsDb.stores.get('records')!.rows;
    expect(records.length).toBe(1);
    const stored = await unwrapStoredEntry(records[0]);
    expect(stored.chainPosition).toBe(0);
    expect(stored.userAgeCategory).toBe('relaxed');
    expect(result).toMatchObject({
      scanLogCleared: true,
      authorProfilesCleared: true,
      verdictsCleared: true,
      diagnosticsCleared: true,
      usageStatsCleared: true,
      chainAnchorsCleared: true,
    });
  });

  it('resetForensicChain: seeded chain anchors are wiped and the marker carries the signer fingerprint (M40 aux-cleanup lock)', async () => {
    installFakeIndexedDB();
    await seedActiveRecord('fr-pre-reset', '2026-07-01T00:00:00.000Z');
    fakeDbs.get(ACTIVE_DB)!.stores.get('chainAnchors')!.rows.push(
      { id: 'anchor-1', anchoredChainPosition: 0, anchoredIntegrityHash: 'h0' },
      { id: 'anchor-2', anchoredChainPosition: 50, anchoredIntegrityHash: 'h50' },
    );

    const result = await resetForensicChain('anchor cleanup lock');

    // Aux cleanup after successful cutover: the RFC 3161 sidecar is empty,
    // and the result flag reports the observed clear, not an assumed one.
    // (Re-read the rows: FakeStore.clear() swaps the array reference.)
    expect(fakeDbs.get(ACTIVE_DB)!.stores.get('chainAnchors')!.rows).toHaveLength(0);
    expect(result.chainAnchorsCleared).toBe(true);
    expect(result.resetMarkerWritten).toBe(true);

    // The reset marker was built through the STATIC signing import: it
    // carries the fingerprint in a realm with no document (M40 regression).
    const rows = fakeDbs.get(ACTIVE_DB)!.stores.get('records')!.rows;
    expect(rows).toHaveLength(1);
    const marker = await unwrapStoredEntry(rows[0]);
    expect(marker.publicKeyFingerprint).toBe('mock-fp');
  });

  it('resetForensicChain: forced anchor-clear failure still cuts over but reports chainAnchorsCleared:false (M58 partial-truth lock)', async () => {
    installFakeIndexedDB();
    await seedActiveRecord('fr-pre-partial', '2026-07-01T00:00:00.000Z');
    anchorClearShouldError = true;

    // The reset RESOLVES (aux wipes are allSettled, never fatal) but must
    // report the failed sidecar honestly instead of a clean success.
    const result = await resetForensicChain('forced partial');

    expect(result.resetMarkerWritten).toBe(true);
    expect(result.chainAnchorsCleared).toBe(false);
    expect(result.parentFeedbackCleared).toBe(true);
    // Cutover happened: only the fresh marker remains in the chain.
    expect(fakeDbs.get(ACTIVE_DB)!.stores.get('records')!.rows).toHaveLength(1);
  });

  it('rotateChainAtMonthFlip: clear + marker write are inside a single lock window', async () => {
    installFakeIndexedDB();
    // Seed an active chain with one record in a PRIOR month so 'auto' rotates.
    const activeDb = new FakeDB('feelingwise-forensics');
    fakeDbs.set('feelingwise-forensics', activeDb);
    activeDb.createObjectStore('records', { autoIncrement: true });
    activeDb.createObjectStore('parentFeedback', { keyPath: 'recordId' });
    activeDb.createObjectStore('chainAnchors', { keyPath: 'id' });
    activeDb.createObjectStore('deliveryOutbox', { keyPath: 'queueSequence', autoIncrement: true });
    activeDb.createObjectStore('deliveryReceipts', { keyPath: 'deliveryId' });
    activeDb.createObjectStore('deliveryMeta', { keyPath: 'key' });

    const payload: Omit<ForensicRecord, 'integrityHash' | 'signature' | 'chainAnchor'> = {
      id: 'fr-old-0',
      timestamp: '2026-01-15T00:00:00.000Z',
      platform: 'twitter',
      originalText: 'old',
      originalHash: 'h-old',
      originalLength: 3,
      neutralizedText: '',
      author: '@a',
      postUrl: 'https://x.com/p/0',
      techniques: [],
      overallScore: 0,
      userAgeCategory: 'teen',
      aiSource: 'cloud',
      feedSource: 'unknown',
      prevRecordHash: CHAIN_GENESIS_HASH,
      chainPosition: 0,
      publicKeyFingerprint: 'mock-fp',
    };
    const integrityHash = await computeRecordIntegrityHash(payload);
    activeDb.stores.get('records')!.rows.push({ ...payload, integrityHash, signature: 'sig', chainAnchor: 'genesis-v1' });

    lockEvents.length = 0;
    fakeClearEvents.length = 0;
    const result = await rotateChainAtMonthFlip(new Date('2026-03-01T00:00:00.000Z'), 'force');

    expect(result.rotated).toBe(true);
    // Exactly one lock acquisition wraps the clear + rotation-marker write.
    expect(lockEvents.filter((e) => e === 'lock:enter')).toHaveLength(1);
    expect(lockEvents.filter((e) => e === 'lock:exit')).toHaveLength(1);

    // clear → marker add both strictly inside the single lock window.
    const enter = lockEvents.indexOf('lock:enter');
    const exit = lockEvents.indexOf('lock:exit');
    const clearIdx = lockEvents.indexOf('clear');
    const addIdx = lockEvents.indexOf('add');
    expect(clearIdx).toBeGreaterThan(enter);
    expect(addIdx).toBeGreaterThan(clearIdx);
    expect(exit).toBeGreaterThan(addIdx);

    const recordsDb = fakeDbs.get('feelingwise-forensics')!;
    const records = recordsDb.stores.get('records')!.rows;
    const stored = await unwrapStoredEntry(records[0]);
    expect(stored.userAgeCategory).toBe('relaxed');
    expect(recordsDb.stores.get('deliveryMeta')!.rows).toContainEqual({
      key: 'rotationCutoff',
      capturedAt: '2026-03-01T00:00:00.000Z',
    });
  });

  it('keeps the signed rotation marker as the epoch month when older evidence arrives late', async () => {
    await seedActiveRecord('fr-before-rotation', '2026-01-15T00:00:00.000Z');
    expect(await rotateChainAtMonthFlip(
      new Date('2026-03-01T00:00:00.000Z'),
      'force',
    )).toMatchObject({ rotated: true, archivedMonth: '2026-01' });

    await appendActiveRecord('fr-late-after-rotation', '2026-01-31T23:59:59.999Z');

    expect(await rotateChainAtMonthFlip(
      new Date('2026-03-15T00:00:00.000Z'),
      'auto',
    )).toEqual({ rotated: false, reason: 'no-rotation-needed' });
  });

  it('rotateChainAtMonthFlip defers while captured observations are still queued', async () => {
    vi.mocked(getForensicDeliveryStatus).mockResolvedValueOnce({
      pendingCount: 1,
      failedCount: 1,
      quarantinedCount: 0,
      discardedRestoreCount: 0,
      byType: { FORENSIC_LOG: 1 },
    });

    const result = await rotateChainAtMonthFlip(new Date('2026-03-01T00:00:00.000Z'), 'force');

    expect(result).toEqual({ rotated: false, reason: 'pending-deliveries' });
    expect(fakeDbs.size).toBe(0);
  });

  it('resetForensicChain leaves the existing chain intact when marker signing fails', async () => {
    const existing = await seedActiveRecord('fr-reset-preserve', '2026-01-15T00:00:00.000Z');
    mockedSignHash.mockRejectedValue(new Error('reset marker signing failed'));

    const reset = resetForensicChain('must not cut over');
    const rejection = expect(reset).rejects.toThrow('reset marker signing failed');
    await rejection;

    const rows = fakeDbs.get(ACTIVE_DB)!.stores.get('records')!.rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(existing.id);
  });

  it('resetForensicChain rejects and preserves evidence when the source cannot be read', async () => {
    const existing = await seedActiveRecord('fr-reset-read-failure', '2026-01-15T00:00:00.000Z');
    activeRecordsReadShouldError = true;

    await expect(resetForensicChain('must not clear an unreadable source')).rejects.toThrow(
      'active records read failed',
    );

    activeRecordsReadShouldError = false;
    const rows = fakeDbs.get(ACTIVE_DB)!.stores.get('records')!.rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(existing.id);
  });

  it('rotateChainAtMonthFlip leaves the existing chain intact when marker signing fails', async () => {
    const existing = await seedActiveRecord('fr-rotation-preserve', '2026-01-15T00:00:00.000Z');
    mockedSignHash.mockRejectedValue(new Error('rotation marker signing failed'));

    const result = await rotateChainAtMonthFlip(new Date('2026-03-01T00:00:00.000Z'), 'force');

    expect(result).toMatchObject({ rotated: false, reason: 'marker-signing-failed' });
    const rows = fakeDbs.get(ACTIVE_DB)!.stores.get('records')!.rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(existing.id);
  });

  it('rotateChainAtMonthFlip resumes after an exact archive copy committed before cutover', async () => {
    const existing = await seedActiveRecord('fr-rotation-resume', '2026-01-15T00:00:00.000Z');
    const archiveDb = new FakeDB('feelingwise-forensics-2026-01');
    fakeDbs.set(archiveDb.name, archiveDb);
    archiveDb.createObjectStore('records', { autoIncrement: true });
    archiveDb.stores.get('records')!.rows.push(existing);

    const result = await rotateChainAtMonthFlip(
      new Date('2026-03-01T00:00:00.000Z'),
      'force',
    );

    expect(result).toMatchObject({
      rotated: true,
      archivedMonth: '2026-01',
      archivedCount: 1,
      rotationMarkerWritten: true,
    });
    expect(archiveDb.stores.get('records')!.rows).toHaveLength(1);
    const activeRows = fakeDbs.get(ACTIVE_DB)!.stores.get('records')!.rows;
    expect(activeRows).toHaveLength(1);
    expect((await unwrapStoredEntry(activeRows[0])).kind).toBe('month-rotation-marker');
  });

  it('rotateChainAtMonthFlip refuses a same-count archive with a corrupted middle row', async () => {
    await seedActiveRecord('fr-source-0', '2026-01-15T00:00:00.000Z');
    await appendActiveRecord('fr-source-1', '2026-01-15T00:00:01.000Z');
    await appendActiveRecord('fr-source-2', '2026-01-15T00:00:02.000Z');
    const sourceRows = fakeDbs.get(ACTIVE_DB)!.stores.get('records')!.rows;

    const archiveDb = new FakeDB('feelingwise-forensics-2026-01');
    fakeDbs.set(archiveDb.name, archiveDb);
    archiveDb.createObjectStore('records', { autoIncrement: true });
    archiveDb.stores.get('records')!.rows.push(
      { ...sourceRows[0] },
      { ...sourceRows[1], originalText: 'corrupted but stale integrityHash retained' },
      { ...sourceRows[2] },
    );

    const result = await rotateChainAtMonthFlip(
      new Date('2026-03-01T00:00:00.000Z'),
      'force',
    );

    expect(result).toMatchObject({
      rotated: false,
      reason: 'archive-already-exists',
      archivedMonth: '2026-01',
    });
    expect(fakeDbs.get(ACTIVE_DB)!.stores.get('records')!.rows).toHaveLength(3);
  });
});

// ─── H3: unresolved fingerprint must not falsely break the chain ────────────

describe('H3 — unverifiable signature in a realm without the key is NOT a break', () => {
  async function buildChain(n: number, fingerprint?: string): Promise<ForensicRecord[]> {
    const records: ForensicRecord[] = [];
    let prevHash = CHAIN_GENESIS_HASH;
    for (let i = 0; i < n; i++) {
      const payload: Omit<ForensicRecord, 'integrityHash' | 'signature' | 'chainAnchor'> = {
        id: `fr-h3-${i}`,
        timestamp: `2026-06-11T00:00:${String(i % 60).padStart(2, '0')}.000Z`,
        platform: 'twitter',
        originalText: `original ${i}`,
        originalHash: `hash-${i}`,
        originalLength: 10,
        neutralizedText: '',
        author: `@a${i}`,
        postUrl: `https://x.com/p/${i}`,
        techniques: [],
        overallScore: 0,
        userAgeCategory: 'teen',
        aiSource: 'cloud',
        feedSource: 'unknown',
        prevRecordHash: prevHash,
        chainPosition: i,
        publicKeyFingerprint: fingerprint,
      };
      const integrityHash = await computeRecordIntegrityHash(payload);
      records.push({ ...payload, integrityHash, signature: 'sig' });
      prevHash = integrityHash;
    }
    return records;
  }

  it('content-intact records with a failing signature do NOT break when the fingerprint cannot resolve', async () => {
    // Dashboard-realm-after-restore: the verifying key is unavailable.
    mockedVerifyHash.mockResolvedValue(false);
    mockedFingerprint.mockRejectedValue(new Error('no key in this realm'));

    const records = await buildChain(3, 'some-fp');
    const result = await verifyChainIntegrity(records);

    expect(result.valid).toBe(true);
    expect(result.brokenKind).toBeUndefined();
    for (const r of records) expect(result.perRecord?.get(r.id)).toBe('unsigned');
  });

  it('PROTECTION SAFETY: a fully-valid chain (key resolves, signatures verify) is unchanged — no false positives', async () => {
    mockedVerifyHash.mockResolvedValue(true);
    mockedFingerprint.mockResolvedValue('mock-fp');

    const records = await buildChain(5, 'mock-fp');
    const result = await verifyChainIntegrity(records);

    expect(result.valid).toBe(true);
    expect(result.chainLength).toBe(5);
    for (const r of records) expect(result.perRecord?.get(r.id)).toBe('verified');
  });

  it('a REAL key-mismatch (fingerprint resolves, signature fails, same/absent key) still breaks', async () => {
    // Key resolves to the current install fingerprint; the record names that
    // SAME key but its signature fails → genuine, unattributable-to-an-earlier-
    // key failure → the chain must still surface a key-mismatch break.
    mockedVerifyHash.mockResolvedValue(false);
    mockedFingerprint.mockResolvedValue('mock-fp');

    const records = await buildChain(2, 'mock-fp');
    const result = await verifyChainIntegrity(records);

    expect(result.valid).toBe(false);
    expect(result.brokenKind).toBe('key-mismatch');
  });
});
