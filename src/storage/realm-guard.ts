// FeelingWise - Realm guard for extension-private IndexedDB databases
//
// Every FeelingWise IndexedDB store (forensic chain, author profiles, scan
// log, capture stores, theme cache, backup folder handle) belongs to the
// extension origin. A content script shares the host page's `indexedDB`,
// so an opener that runs there creates an empty copy of the database in
// the page's origin: the data never meets its writer (the lookup reads an
// empty store) and the page can enumerate the database name with
// `indexedDB.databases()` and learn the extension is installed.
//
// Every opener calls `assertExtensionRealm(dbName)` before
// `indexedDB.open`. Outside the extension origin it throws, and the
// refusal is recorded so a caller that swallows the error (the read
// helpers degrade to null/empty) still leaves a trace for diagnostics.
//
// Hosts without a `location` (node unit tests, tooling) are treated as the
// extension realm: there is no page origin to leak into.

const EXTENSION_PROTOCOLS: ReadonlyArray<string> = ['chrome-extension:', 'moz-extension:'];

export interface RealmRefusal {
  dbName: string;
  origin: string;
  reason: string;
}

export class RealmGuardError extends Error {
  readonly dbName: string;
  readonly origin: string;
  constructor(dbName: string, origin: string) {
    super(`[FeelingWise] Refused to open IndexedDB "${dbName}" outside the extension origin (${origin})`);
    this.name = 'RealmGuardError';
    this.dbName = dbName;
    this.origin = origin;
  }
}

let lastRefusal: RealmRefusal | null = null;

function currentOrigin(): string | null {
  if (typeof location === 'undefined' || location === null) return null;
  return `${location.protocol}//${location.host}`;
}

/** True when this realm may own extension-private IndexedDB databases. */
export function isExtensionRealm(): boolean {
  if (typeof location === 'undefined' || location === null) return true;
  return EXTENSION_PROTOCOLS.includes(location.protocol);
}

/**
 * Throws `RealmGuardError` when the current realm is a page origin. Call
 * before every `indexedDB.open` of an extension-private database.
 */
export function assertExtensionRealm(dbName: string): void {
  if (isExtensionRealm()) return;
  const origin = currentOrigin() ?? 'unknown';
  lastRefusal = {
    dbName,
    origin,
    reason: `page origin ${origin} may not open extension-private database ${dbName}`,
  };
  throw new RealmGuardError(dbName, origin);
}

/** The most recent refusal, for diagnostics and tests. */
export function lastRealmRefusal(): RealmRefusal | null {
  return lastRefusal;
}

export function _resetRealmGuardForTests(): void {
  lastRefusal = null;
}
