// An IndexedDB that can lie about its own state, for the tests that need one.
//
// WHY THIS EXISTS. The suite audit of 2026-09-18 counted 668 test files and
// about 7,300 passing assertions, and found that not one of the six defects
// found in the two days before it had been caught by a failing test. Three of
// the six shared one root cause: every IndexedDB double in this tree is honest.
// `fake-indexeddb` is well behaved and never evicts, and the hand-written stubs
// implement the happy path only, so no test here could ask what the code does
// when the STORE lies. The three shapes that were live in shipped or working
// code, and that this double can now reproduce:
//
//   1. An evicted database re-opens EMPTY and every read of it SUCCEEDS, so a
//      destroyed record reads as an empty one. `wipe()` does that: the next
//      open fires `onupgradeneeded` with `oldVersion: 0` against a profile that
//      held data a moment ago.
//   2. A row whose `id` index resolves fine while the payload behind it is
//      truncated or gone, so a confirmation that only asks the index says
//      "present" and authorises deleting the only good copy.
//      `truncateOnWrite()` and `dropValueOnRead()` are the two halves of that:
//      the first stores a real row whose bytes cannot be decompressed, the
//      second leaves the key reads answering while the value reads do not.
//   3. A write that resolves while the value that lands is smaller, corrupt, or
//      a different record than the one written. `truncateOnWrite()`,
//      `corruptOnWrite()` and `swapOnWrite()` are those three, and
//      `failCommit()` is the honest neighbour of them all: the write does not
//      land and the transaction says so.
//
// HOW IT IS BUILT. It wraps the `indexedDB` already on the global (normally
// `fake-indexeddb/auto`) in proxies rather than reimplementing it, so an
// unfaulted run is the real fake, byte for byte, and nothing in the suite's
// existing behaviour moves. The proxies exist at four levels: the factory (to
// hand back a wrapped database and to serve `wipe`), the database (to hand back
// a wrapped transaction and to track open connections so `wipe` can close
// them), the transaction (to hand back a wrapped store and to arm a commit
// failure), and the request (to fault the value on the way out and to keep
// `event.target` pointing at the wrapper, which is how the cursor callbacks in
// store.ts read their results).
//
// FAULTS ARE DECLARED PER TEST AND DO NOT LEAK. `installFaultyIndexedDB()`
// starts with none, so the default is the honest double the rest of the suite
// depends on, and `restore()` puts the untouched factory back. Nothing here is
// global state beyond the one installed factory.
//
// WHAT IT DELIBERATELY DOES NOT MODEL. Key reads stay truthful under
// `dropValueOnRead`: `getKey`, `getAllKeys`, `count` and `openKeyCursor` still
// name the row. That is the point of the fault, not an omission, and it is the
// exact asymmetry the archive confirmation defect lived in (archive-writer.ts's
// docblock, 2026-09-18). A value cursor SKIPS a dropped row rather than handing
// out a cursor whose `.value` is undefined: the first draft did the latter and
// it is not a state IndexedDB can be in, so the code under test crashed inside
// its own request callback and a promise that nothing settles hung the run.
// A double whose lie is impossible tests nothing real.

import type { ForensicRecord } from '../../src/types/forensic';

/**
 * Which rows a fault applies to. A target with none of `key`, `recordId` or
 * `where` set matches every row in that store, which is what a test wanting
 * "the whole store is unreadable" asks for.
 */
export interface FaultTarget {
  /** Database name, exactly as passed to `indexedDB.open`. */
  db: string;
  /** Object store name. */
  store: string;
  /** Match on the IDB primary key. Not available on a write into an autoIncrement store. */
  key?: IDBValidKey;
  /** Match on the record id the envelope lifts to its top level. Works on reads and writes. */
  recordId?: string;
  /** Anything else. `primaryKey` is undefined when the row has not been keyed yet. */
  where?: (value: unknown, primaryKey: IDBValidKey | undefined) => boolean;
}

export type FaultEventKind =
  | 'corrupt-write'
  | 'truncate-write'
  | 'swap-write'
  | 'drop-read'
  | 'commit-abort'
  | 'commit-abort-too-late'
  | 'wipe';

/**
 * One thing the double actually did. A test asserts on this to prove the fault
 * bit, which matters because a fault that silently matched nothing leaves a
 * green test that proves the opposite of what it claims.
 */
export interface FaultEvent {
  kind: FaultEventKind;
  db: string;
  store?: string;
  key?: IDBValidKey;
  recordId?: string;
  detail?: string;
}

export interface FaultyIndexedDB {
  /**
   * The row lands with its indexed top-level fields intact and its compressed
   * payload replaced by bytes that carry the gzip magic and decode to nothing.
   * The shape a disk fault leaves: indexed, findable, unreadable.
   */
  corruptOnWrite(target: FaultTarget, times?: number): void;
  /**
   * The row lands with its payload cut in half and `uncompressedSize` still
   * claiming the original length. The write resolves; the value is smaller than
   * the one written.
   */
  truncateOnWrite(target: FaultTarget, times?: number): void;
  /** The row lands holding `replacement` instead of the value that was written. */
  swapOnWrite(target: FaultTarget, replacement: unknown, times?: number): void;
  /**
   * Value reads answer as though the row is not there, while `getKey`,
   * `getAllKeys` and `count` still name it. The index resolves, the payload does
   * not come back.
   */
  dropValueOnRead(target: FaultTarget): void;
  /**
   * The next `times` readwrite transactions touching this store abort at commit
   * instead of completing, so nothing they wrote lands and the caller's
   * `onabort` fires.
   */
  failCommit(target: { db: string; store: string }, times?: number): void;
  /**
   * Destroy the database the way an eviction does: every connection this double
   * handed out is closed first, then the database is deleted. The next open
   * succeeds and fires `onupgradeneeded` with `oldVersion: 0`.
   */
  wipe(dbName: string): Promise<void>;
  /** Forget every declared fault. The double is honest again. */
  clearFaults(): void;
  /** Put the untouched factory back on the global. */
  restore(): void;
  /** Everything the double did, oldest first. */
  readonly log: FaultEvent[];
}

interface WriteFault {
  kind: 'corrupt' | 'truncate' | 'swap';
  target: FaultTarget;
  replacement?: unknown;
  remaining: number;
}

interface CommitFault {
  db: string;
  store: string;
  remaining: number;
}

/**
 * Gzip magic followed by a body that is not a deflate stream, so
 * `DecompressionStream('gzip')` rejects it while
 * `record-compression.ts`'s `isCompressedEnvelope` and the batched read path's
 * magic-byte sniff both still take the decompress branch. The same bytes the
 * hand-seeded archive-confirm test verified against Node's WHATWG streams on
 * 2026-09-18, kept here so one definition serves every test.
 */
const UNDECODABLE_GZIP = new Uint8Array([
  0x1f, 0x8b, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0xff, 0xff, 0xff,
]);

function isEnvelopeLike(v: unknown): v is { payload: Uint8Array; id?: string; uncompressedSize?: number } {
  return (
    typeof v === 'object' &&
    v !== null &&
    (v as { payload?: unknown }).payload instanceof Uint8Array
  );
}

function valueRecordId(v: unknown): string | undefined {
  if (typeof v !== 'object' || v === null) return undefined;
  const id = (v as { id?: unknown }).id;
  return typeof id === 'string' ? id : undefined;
}

function matches(
  target: FaultTarget,
  dbName: string,
  storeName: string,
  value: unknown,
  primaryKey: IDBValidKey | undefined,
): boolean {
  if (target.db !== dbName || target.store !== storeName) return false;
  if (target.key !== undefined) {
    if (primaryKey === undefined || String(primaryKey) !== String(target.key)) return false;
  }
  if (target.recordId !== undefined && valueRecordId(value) !== target.recordId) return false;
  if (target.where && !target.where(value, primaryKey)) return false;
  return true;
}

/**
 * Install the double over whatever `indexedDB` is on the global, and give back
 * the handle that declares faults on it.
 *
 * Call it in `beforeEach` and `restore()` in `afterEach`, the way
 * `installChromeStorageStub` is used across the suite. It needs a real
 * `indexedDB` underneath, so the file must still import `fake-indexeddb/auto`.
 */
export function installFaultyIndexedDB(): FaultyIndexedDB {
  const globalAny = globalThis as unknown as { indexedDB?: IDBFactory };
  const real = globalAny.indexedDB;
  if (!real) {
    throw new Error(
      'installFaultyIndexedDB needs an indexedDB on the global; import "fake-indexeddb/auto" first',
    );
  }

  const writeFaults: WriteFault[] = [];
  const dropFaults: FaultTarget[] = [];
  const commitFaults: CommitFault[] = [];
  const log: FaultEvent[] = [];
  /** Every connection handed out and not yet closed, so `wipe` can close them. */
  const openConnections = new Set<IDBDatabase>();

  function note(event: FaultEvent): void {
    log.push(event);
  }

  function applyWriteFaults(value: unknown, dbName: string, storeName: string): unknown {
    for (const fault of writeFaults) {
      if (fault.remaining <= 0) continue;
      if (!matches(fault.target, dbName, storeName, value, undefined)) continue;
      fault.remaining--;
      const recordId = valueRecordId(value);
      if (fault.kind === 'swap') {
        note({ kind: 'swap-write', db: dbName, store: storeName, recordId, detail: 'stored a different value' });
        return fault.replacement;
      }
      if (!isEnvelopeLike(value)) {
        // Refused rather than silently ignored: a corruption fault that found
        // nothing to corrupt leaves a green test proving the opposite of what
        // it claims. `swapOnWrite` is the fault for a non-envelope value.
        throw new Error(
          `faulty-indexeddb: ${fault.kind}OnWrite targeted ${dbName}/${storeName} but the value has no `
          + 'Uint8Array payload to damage; use swapOnWrite for a value that is not a compressed envelope',
        );
      }
      if (fault.kind === 'corrupt') {
        note({ kind: 'corrupt-write', db: dbName, store: storeName, recordId, detail: 'payload replaced with undecodable bytes' });
        return { ...(value as object), payload: UNDECODABLE_GZIP.slice() };
      }
      const cut = Math.max(2, Math.floor(value.payload.byteLength / 2));
      note({
        kind: 'truncate-write',
        db: dbName,
        store: storeName,
        recordId,
        detail: `payload cut from ${value.payload.byteLength} to ${cut} bytes, uncompressedSize left claiming the original`,
      });
      return { ...(value as object), payload: value.payload.slice(0, cut) };
    }
    return value;
  }

  function isDropped(value: unknown, dbName: string, storeName: string, primaryKey: IDBValidKey | undefined): boolean {
    if (value === undefined || value === null) return false;
    for (const target of dropFaults) {
      if (!matches(target, dbName, storeName, value, primaryKey)) continue;
      note({
        kind: 'drop-read',
        db: dbName,
        store: storeName,
        key: primaryKey,
        recordId: valueRecordId(value),
        detail: 'value read answered as absent; key reads untouched',
      });
      return true;
    }
    return false;
  }

  // ─── Request wrapping ────────────────────────────────────────────────────
  //
  // `event.target` has to be the wrapper, not the underlying request: the
  // cursor callbacks in store.ts (getChainState, pruneRecordsToCap) read their
  // result off `(e.target as IDBRequest).result`, so a raw event would hand them
  // the unfaulted value and the fault would quietly not apply.

  type ResultKind = 'value' | 'values' | 'cursor' | 'raw';

  function wrapEvent(event: Event, requestProxy: unknown): Event {
    return new Proxy(event, {
      get(t, p) {
        if (p === 'target' || p === 'currentTarget') return requestProxy;
        const v = Reflect.get(t, p, t);
        return typeof v === 'function' ? v.bind(t) : v;
      },
    });
  }

  function wrapCursor(cursor: any, dbName: string, storeName: string): any {
    return new Proxy(cursor, {
      get(t, p) {
        const v = Reflect.get(t, p, t);
        return typeof v === 'function' ? v.bind(t) : v;
      },
    });
  }

  function wrapRequest(
    request: IDBRequest,
    dbName: string,
    storeName: string,
    kind: ResultKind,
    requestedKey?: IDBValidKey | IDBKeyRange,
  ): IDBRequest {
    const plainKey = requestedKey !== undefined && typeof requestedKey !== 'object'
      ? (requestedKey as IDBValidKey)
      : undefined;
    const proxy: IDBRequest = new Proxy(request, {
      get(t, p) {
        if (p === 'result') {
          const result = (t as any).result;
          if (kind === 'value') {
            return isDropped(result, dbName, storeName, plainKey) ? undefined : result;
          }
          if (kind === 'values' && Array.isArray(result)) {
            return result.filter(v => !isDropped(v, dbName, storeName, undefined));
          }
          if (kind === 'cursor' && result) {
            return wrapCursor(result, dbName, storeName);
          }
          return result;
        }
        const v = Reflect.get(t, p, t);
        return typeof v === 'function' ? v.bind(t) : v;
      },
      set(t, p, v) {
        if (p === 'onsuccess' && kind === 'cursor' && typeof v === 'function') {
          // A dropped row is skipped rather than handed over with an undefined
          // `.value`: the caller's handler is not called at all and the cursor
          // is advanced here. See the note at the top of this file.
          (t as any).onsuccess = (event: Event) => {
            const cursor = (t as any).result;
            if (cursor && isDropped(cursor.value, dbName, storeName, cursor.primaryKey)) {
              cursor.continue();
              return;
            }
            (v as (e: Event) => void).call(proxy, wrapEvent(event, proxy));
          };
          return true;
        }
        if ((p === 'onsuccess' || p === 'onerror') && typeof v === 'function') {
          (t as any)[p] = (event: Event) => (v as (e: Event) => void).call(proxy, wrapEvent(event, proxy));
          return true;
        }
        return Reflect.set(t, p, v, t);
      },
    });
    return proxy;
  }

  function wrapIndex(index: IDBIndex, dbName: string, storeName: string): IDBIndex {
    return new Proxy(index, {
      get(t, p) {
        // getKey, getAllKeys, count and openKeyCursor pass through untouched:
        // an index that still answers while the value behind it does not is the
        // whole fault being modelled.
        if (p === 'get') return (q: any) => wrapRequest(t.get(q), dbName, storeName, 'value', q);
        if (p === 'getAll') return (...a: any[]) => wrapRequest((t.getAll as any)(...a), dbName, storeName, 'values');
        if (p === 'openCursor') return (...a: any[]) => wrapRequest((t.openCursor as any)(...a), dbName, storeName, 'cursor');
        const v = Reflect.get(t, p, t);
        return typeof v === 'function' ? v.bind(t) : v;
      },
    });
  }

  function wrapStore(store: IDBObjectStore, dbName: string): IDBObjectStore {
    const storeName = store.name;
    return new Proxy(store, {
      get(t, p) {
        if (p === 'add' || p === 'put') {
          return (value: unknown, key?: IDBValidKey) => {
            const faulted = applyWriteFaults(value, dbName, storeName);
            const req = key === undefined ? (t as any)[p](faulted) : (t as any)[p](faulted, key);
            return wrapRequest(req, dbName, storeName, 'raw');
          };
        }
        if (p === 'get') return (q: any) => wrapRequest(t.get(q), dbName, storeName, 'value', q);
        if (p === 'getAll') return (...a: any[]) => wrapRequest((t.getAll as any)(...a), dbName, storeName, 'values');
        if (p === 'openCursor') return (...a: any[]) => wrapRequest((t.openCursor as any)(...a), dbName, storeName, 'cursor');
        if (p === 'index') return (name: string) => wrapIndex(t.index(name), dbName, storeName);
        const v = Reflect.get(t, p, t);
        return typeof v === 'function' ? v.bind(t) : v;
      },
    });
  }

  function wrapTransaction(tx: IDBTransaction, dbName: string): IDBTransaction {
    let abortArmed = false;
    if (tx.mode === 'readwrite') {
      for (const fault of commitFaults) {
        if (fault.db !== dbName || fault.remaining <= 0) continue;
        if (!Array.from(tx.objectStoreNames).includes(fault.store)) continue;
        fault.remaining--;
        abortArmed = true;
        break;
      }
    }
    let abortScheduled = false;
    const scheduleAbort = (storeName: string) => {
      if (!abortArmed || abortScheduled) return;
      abortScheduled = true;
      // A microtask, so the caller's whole synchronous block of add/put/delete
      // calls is queued first and the abort rolls all of it back. Any later and
      // the transaction has committed, which is a different fault entirely, so
      // that case is logged under its own kind rather than passing as this one.
      queueMicrotask(() => {
        try {
          tx.abort();
          note({ kind: 'commit-abort', db: dbName, store: storeName, detail: 'readwrite transaction aborted before commit' });
        } catch (err) {
          note({
            kind: 'commit-abort-too-late',
            db: dbName,
            store: storeName,
            detail: err instanceof Error ? err.message : String(err),
          });
        }
      });
    };

    return new Proxy(tx, {
      get(t, p) {
        if (p === 'objectStore') {
          return (name: string) => {
            const s = t.objectStore(name);
            scheduleAbort(name);
            return wrapStore(s, dbName);
          };
        }
        const v = Reflect.get(t, p, t);
        return typeof v === 'function' ? v.bind(t) : v;
      },
    });
  }

  function wrapDatabase(db: IDBDatabase): IDBDatabase {
    const dbName = db.name;
    openConnections.add(db);
    return new Proxy(db, {
      get(t, p) {
        if (p === 'transaction') {
          return (names: any, mode?: IDBTransactionMode, options?: any) =>
            wrapTransaction(
              options === undefined ? t.transaction(names, mode) : t.transaction(names, mode, options),
              dbName,
            );
        }
        if (p === 'close') {
          return () => {
            openConnections.delete(t);
            t.close();
          };
        }
        const v = Reflect.get(t, p, t);
        return typeof v === 'function' ? v.bind(t) : v;
      },
    });
  }

  // ─── The open request ────────────────────────────────────────────────────
  //
  // A plain object rather than a proxy, because `result` has to be the REAL
  // database during `onupgradeneeded` (the upgrade handlers in store.ts and
  // archive-naming.ts call createObjectStore on it and read
  // `request.transaction`) and the WRAPPED one on success.

  interface OpenRequestShape {
    result: IDBDatabase | undefined;
    transaction: IDBTransaction | null;
    error: DOMException | null;
    readyState: string;
    onsuccess: ((e: Event) => void) | null;
    onerror: ((e: Event) => void) | null;
    onupgradeneeded: ((e: IDBVersionChangeEvent) => void) | null;
    onblocked: ((e: Event) => void) | null;
    addEventListener: (type: string, fn: (e: Event) => void) => void;
    removeEventListener: (type: string, fn: (e: Event) => void) => void;
  }

  function wrapOpen(request: IDBOpenDBRequest): IDBOpenDBRequest {
    const listeners = new Map<string, Array<(e: Event) => void>>();
    const fake: OpenRequestShape = {
      result: undefined,
      transaction: null,
      error: null,
      readyState: 'pending',
      onsuccess: null,
      onerror: null,
      onupgradeneeded: null,
      onblocked: null,
      addEventListener(type, fn) {
        const list = listeners.get(type) ?? [];
        list.push(fn);
        listeners.set(type, list);
      },
      removeEventListener(type, fn) {
        const list = listeners.get(type);
        if (list) listeners.set(type, list.filter(f => f !== fn));
      },
    };
    const fire = (type: string, handler: ((e: any) => void) | null, event: Event) => {
      const proxied = wrapEvent(event, fake);
      handler?.call(fake, proxied);
      for (const fn of listeners.get(type) ?? []) fn.call(fake, proxied);
    };

    request.onupgradeneeded = (event) => {
      fake.result = request.result;
      fake.transaction = request.transaction;
      fire('upgradeneeded', fake.onupgradeneeded, event);
    };
    request.onsuccess = (event) => {
      fake.readyState = 'done';
      fake.transaction = null;
      fake.result = wrapDatabase(request.result);
      fire('success', fake.onsuccess, event);
    };
    request.onerror = (event) => {
      fake.readyState = 'done';
      fake.error = request.error;
      fire('error', fake.onerror, event);
    };
    request.onblocked = (event) => {
      fire('blocked', fake.onblocked, event);
    };
    return fake as unknown as IDBOpenDBRequest;
  }

  const factory = {
    open(name: string, version?: number): IDBOpenDBRequest {
      const req = version === undefined ? real.open(name) : real.open(name, version);
      return wrapOpen(req);
    },
    deleteDatabase(name: string): IDBOpenDBRequest {
      return real.deleteDatabase(name);
    },
    databases(): Promise<IDBDatabaseInfo[]> {
      return real.databases();
    },
    cmp(a: unknown, b: unknown): number {
      return real.cmp(a, b);
    },
  };

  globalAny.indexedDB = factory as unknown as IDBFactory;

  return {
    corruptOnWrite(target, times = Number.POSITIVE_INFINITY) {
      writeFaults.push({ kind: 'corrupt', target, remaining: times });
    },
    truncateOnWrite(target, times = Number.POSITIVE_INFINITY) {
      writeFaults.push({ kind: 'truncate', target, remaining: times });
    },
    swapOnWrite(target, replacement, times = Number.POSITIVE_INFINITY) {
      writeFaults.push({ kind: 'swap', target, replacement, remaining: times });
    },
    dropValueOnRead(target) {
      dropFaults.push(target);
    },
    failCommit(target, times = 1) {
      commitFaults.push({ db: target.db, store: target.store, remaining: times });
    },
    async wipe(dbName: string) {
      // Close first. A real eviction does not wait for the page's connections,
      // and a delete that is BLOCKED resolves nowhere, which would leave the
      // test hanging instead of reproducing the defect.
      for (const db of Array.from(openConnections)) {
        if (db.name !== dbName) continue;
        openConnections.delete(db);
        try {
          db.close();
        } catch {
          // Already closed by the code under test. Nothing to do.
        }
      }
      await new Promise<void>((resolve, reject) => {
        const req = real.deleteDatabase(dbName);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
        req.onblocked = () => reject(new Error(`faulty-indexeddb: wipe blocked on ${dbName}`));
      });
      note({ kind: 'wipe', db: dbName, detail: 'database destroyed; the next open upgrades from oldVersion 0' });
    },
    clearFaults() {
      writeFaults.length = 0;
      dropFaults.length = 0;
      commitFaults.length = 0;
    },
    restore() {
      globalAny.indexedDB = real;
    },
    log,
  };
}

/**
 * A minimal ForensicRecord for a storage test, with only the fields the store,
 * the archive writer and the canonical payload actually read. Exported here
 * rather than copied into each test file, because the drift between per-file
 * copies is what made the chrome.storage helper necessary
 * (tests/helpers/chrome-storage.ts).
 */
export function storageTestRecord(over: Partial<ForensicRecord> & { id: string }): ForensicRecord {
  return {
    timestamp: new Date(Date.UTC(2026, 7, 10, 12)).toISOString(),
    platform: 'twitter',
    originalText: `text for ${over.id}`,
    originalHash: `h-${over.id}`,
    originalLength: 12,
    techniques: [],
    overallScore: 0,
    userAgeCategory: 'adult',
    integrityHash: `ih-${over.id}`,
    chainPosition: 0,
    ...over,
  } as unknown as ForensicRecord;
}
