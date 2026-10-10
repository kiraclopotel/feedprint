// FeelingWise - shared IndexedDB open-with-upgrade for the single-store
// sidecar databases (perf trace, theme cache, the two dev capture stores).
//
// Each of those modules used to carry the same open body: guard for a
// missing indexedDB, open at a fixed version, create the one object store on
// upgrade if it does not exist, resolve with the connection. This is the one
// copy. Database, store and index names stay owned by the callers; the
// module-level connection cache stays with the caller too, because each
// module also resets it on clear.

import { assertExtensionRealm } from '../storage/realm-guard';

export interface SimpleStoreOptions {
  /** Key path for the store; omitted for out-of-line keys. */
  keyPath?: string;
  autoIncrement?: boolean;
  /** Indexes created together with the store, as [indexName, keyPath]. */
  indexes?: ReadonlyArray<readonly [string, string]>;
}

export function openSimpleStore(
  name: string,
  version: number,
  store: string,
  options: SimpleStoreOptions = {},
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('indexedDB unavailable'));
      return;
    }
    // Extension origin only (see realm-guard.ts).
    assertExtensionRealm(name);
    const req = indexedDB.open(name, version);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(store)) {
        const params: IDBObjectStoreParameters = {};
        if (options.keyPath !== undefined) params.keyPath = options.keyPath;
        if (options.autoIncrement !== undefined) params.autoIncrement = options.autoIncrement;
        const created = db.createObjectStore(store, params);
        for (const [indexName, indexKeyPath] of options.indexes ?? []) {
          created.createIndex(indexName, indexKeyPath);
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
