// A chrome.storage.local a test can hold in its hand (PLAN-2026-09-16 item 7.2).
//
// Twenty-one test files installed their own. The copies drifted in ways that decide test outcomes:
// some returned every key for get(null) and some returned nothing, some had remove() and some did
// not, some installed chrome.runtime.sendMessage (so the code under test posts to the worker) and
// some deliberately did not (so the write stays local). A test that seeds state through one shape
// and asserts through another is reading its own stub.
//
// This is the shape Chrome documents, with the two seams named as options rather than left to
// whether a copy happened to include them.

export interface ChromeStorageStub {
  /** The state the stub holds; a test can read it after the code under test writes. */
  state: Record<string, unknown>;
  /** Restore whatever `chrome` was there before (usually nothing). */
  restore: () => void;
}

export interface ChromeStorageStubOptions {
  /** Keys the store starts with. */
  initial?: Record<string, unknown>;
  /**
   * Install chrome.runtime.sendMessage. Off by default: without it, code that would post the write
   * to the service worker applies it locally, which is what a test of the local path wants. Pass a
   * function to observe the messages instead.
   */
  sendMessage?: ((message: unknown) => unknown) | false;
  /** Value for chrome.runtime.getManifest(), when the code under test reads the version. */
  manifest?: Record<string, unknown>;
}

/**
 * Install a chrome.storage.local backed by a plain object, and give back the object.
 *
 * get() follows Chrome: a string, an array of strings, null or undefined for the whole store, and
 * an object of defaults. set() merges. remove() takes one key or many. clear() empties.
 */
export function installChromeStorageStub(options: ChromeStorageStubOptions = {}): ChromeStorageStub {
  const state: Record<string, unknown> = { ...(options.initial ?? {}) };
  const globalAny = globalThis as unknown as { chrome?: unknown };
  const before = globalAny.chrome;

  const get = (keys?: string | string[] | Record<string, unknown> | null): Promise<Record<string, unknown>> => {
    if (keys === null || keys === undefined) return Promise.resolve({ ...state });
    if (typeof keys === 'object' && !Array.isArray(keys)) {
      const out: Record<string, unknown> = { ...keys };
      for (const k of Object.keys(keys)) if (k in state) out[k] = state[k];
      return Promise.resolve(out);
    }
    const out: Record<string, unknown> = {};
    for (const k of Array.isArray(keys) ? keys : [keys]) if (k in state) out[k] = state[k];
    return Promise.resolve(out);
  };

  const runtime: Record<string, unknown> = { lastError: null };
  if (options.sendMessage) runtime.sendMessage = options.sendMessage;
  if (options.manifest) runtime.getManifest = () => options.manifest;

  globalAny.chrome = {
    storage: {
      local: {
        get,
        set: (obj: Record<string, unknown>) => {
          Object.assign(state, obj);
          return Promise.resolve();
        },
        remove: (keys: string | string[]) => {
          for (const k of Array.isArray(keys) ? keys : [keys]) delete state[k];
          return Promise.resolve();
        },
        clear: () => {
          for (const k of Object.keys(state)) delete state[k];
          return Promise.resolve();
        },
      },
      onChanged: { addListener: () => undefined, removeListener: () => undefined },
    },
    runtime,
  };

  return {
    state,
    restore: () => {
      if (before === undefined) delete globalAny.chrome;
      else globalAny.chrome = before;
    },
  };
}
