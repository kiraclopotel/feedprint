// Shared single-store IndexedDB opener (ARCHITECTURE-6 item 2). The four
// sidecar stores (perf trace, theme cache, both dev capture stores) used to
// carry the same open-with-upgrade body; this locks the one copy.

import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, it, expect, beforeEach } from 'vitest';

import { openSimpleStore } from '../../../src/forensics/idb-open';

beforeEach(() => {
  // Fresh factory per test so database names never collide across cases.
  (globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
});

describe('openSimpleStore', () => {
  it('creates the store with the given keyPath on first open', async () => {
    const db = await openSimpleStore('fw-test-keyed', 1, 'cache', { keyPath: 'key' });
    expect(Array.from(db.objectStoreNames)).toEqual(['cache']);
    const store = db.transaction('cache', 'readonly').objectStore('cache');
    expect(store.keyPath).toBe('key');
    expect(store.autoIncrement).toBe(false);
    db.close();
  });

  it('supports out-of-line autoIncrement keys and creates the requested indexes', async () => {
    const db = await openSimpleStore('fw-test-records', 1, 'records', {
      autoIncrement: true,
      indexes: [['by_timestamp', 'timestamp'], ['by_stage', 'stage']],
    });
    const store = db.transaction('records', 'readonly').objectStore('records');
    expect(store.keyPath).toBeNull();
    expect(store.autoIncrement).toBe(true);
    expect(Array.from(store.indexNames).sort()).toEqual(['by_stage', 'by_timestamp']);
    expect(store.index('by_timestamp').keyPath).toBe('timestamp');
    db.close();
  });

  it('reopening at the same version keeps the existing store and its rows', async () => {
    const first = await openSimpleStore('fw-test-reopen', 2, 'events', {
      keyPath: 'id',
      autoIncrement: true,
    });
    await new Promise<void>((resolve, reject) => {
      const tx = first.transaction('events', 'readwrite');
      tx.objectStore('events').add({ kind: 'a' });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    first.close();

    const again = await openSimpleStore('fw-test-reopen', 2, 'events', {
      keyPath: 'id',
      autoIncrement: true,
    });
    expect(again.version).toBe(2);
    expect(Array.from(again.objectStoreNames)).toEqual(['events']);
    const count = await new Promise<number>((resolve, reject) => {
      const req = again.transaction('events', 'readonly').objectStore('events').count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    expect(count).toBe(1);
    again.close();
  });

  it('rejects instead of throwing when indexedDB is unavailable', async () => {
    (globalThis as { indexedDB?: IDBFactory }).indexedDB = undefined;
    await expect(openSimpleStore('fw-test-none', 1, 's')).rejects.toThrow('indexedDB unavailable');
  });
});
