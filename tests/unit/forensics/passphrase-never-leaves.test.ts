// Promise: passphrase-never-leaves (scripts/verify/promises.registry.mjs).
//
// THE SENTENCE UNDER TEST, printed in the terms (landing/terms.html, section 14) as the reason a
// lost passphrase is final: "This passphrase is not stored, transmitted, or recoverable by
// FeelingWise."
//
// The registry asks for that "asserted over a real backup run rather than over the function that
// takes it", so nothing in this file reads a signature, a docblock or an import graph. It drives
// the two backup runs the product actually performs, over a real fake-indexeddb chain with real
// WebCrypto and the real signing key:
//
//   1. the manual "Back up now" export, exactly as src/ui/dashboard/components/ExportTab.tsx
//      performs it: buildBackupBlob(pass) then sealBackupJson(json, pass, 'passphrase') then
//      recordManualBackupSuccess(...);
//   2. the automatic Downloads backup after a recovery passphrase has been set, which is the other
//      path where a passphrase is typed: setBackupRecoveryPassphrase(pass) then
//      autoBackupToDownloads(), whose file carries the escrow copy of the device seal secret.
//
// Each run uses its own unmistakable sentinel string as the passphrase. Afterwards every sink the
// run could have written to is swept EXHAUSTIVELY: every key and every value of all three
// chrome.storage areas, every object store of every IndexedDB database the run touched, the backup
// object and the sealed file, every recorded fetch, every chrome.runtime.sendMessage payload, the
// download URL and filename, and everything printed to the console. The sweep walks and serialises
// whatever it finds rather than checking a handful of keys by name, because a check that names keys
// misses the key added next month. It also gunzips stored byte payloads, because the record store
// holds gzip envelopes and a sweep that read only the stored bytes would miss a passphrase written
// into a record.
//
// WHAT IS ASSERTED: that after a real backup run, neither passphrase string (nor its hex or base64
// forms, at all three base64 alignments) is present in any storage area, database, produced file,
// outbound call or console line reachable from this run.
//
// WHAT IS NOT REACHED, stated plainly:
//   - A fake storage realm is not Chrome. fake-indexeddb and a stubbed chrome.storage are what this
//     process can observe; they do not prove what the real browser writes to disk, to its own
//     session restore, or to a synced profile.
//   - A derived key is not the passphrase. The wrapped signing key and the escrowed seal secret are
//     PBKDF2 products of these passphrases and they ARE written to the file on purpose. This check
//     says the passphrase itself is absent; it says nothing about how hard that derivation is to
//     reverse, and a weak or guessable passphrase is outside what any string search can see.
//   - Only the sinks a Node process can hold are swept. Chrome-side surfaces that never appear
//     here (devtools, crash dumps, the extension's own error reporting) are out of reach.
//   - Only these two runs are driven. A future path that takes a passphrase and is not called from
//     here would not be covered until it is added to this file.
//
// The last test in this file is the positive control: it plants the sentinel in each shape the
// sweeper claims to see through (nested value, object key, Map, gzipped bytes, base64) and requires
// the sweeper to report every one. A sweeper that finds nothing because it looks nowhere would pass
// every other test in this file silently.

import 'fake-indexeddb/auto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { ForensicRecord } from '../../../src/types/forensic';
import { addRecord, getRecordsOrThrow } from '../../../src/forensics/store';
import { computeRecordIntegrityHash } from '../../../src/forensics/canonical-payload';
import { CHAIN_GENESIS_HASH } from '../../../src/forensics/chain-integrity';
import { getPublicKeyFingerprint } from '../../../src/forensics/signing';
import {
  buildBackupBlob,
  setBackupRecoveryPassphrase,
  autoBackupToDownloads,
  recordManualBackupSuccess,
  type ForensicBackup,
} from '../../../src/forensics/backup';
import { sealBackupJson } from '../../../src/forensics/backup-envelope';
import { storageTestRecord } from '../../helpers/faulty-indexeddb';
import { deleteDbs } from '../../helpers/indexeddb';

// Long, fixed and unmistakable: nothing else in this product or this suite can produce these
// strings by accident, so a single occurrence anywhere is a leak and never a coincidence.
const MANUAL_PASSPHRASE = 'FW-SENTINEL-MANUAL-PASSPHRASE-c4f1a9d2e7b53086-never-store-me';
const RECOVERY_PASSPHRASE = 'FW-SENTINEL-RECOVERY-PASSPHRASE-9b73e1c0a52d4f68-never-store-me';

const FORENSIC_DB = 'feelingwise-forensics';

// ─── the sweeper ──────────────────────────────────────────────────────────────

/** latin1, built by hand: Node's TextDecoder label support varies with the ICU build. */
function bytesToLatin1(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 4096) {
    out += String.fromCharCode(...bytes.subarray(i, i + 4096));
  }
  return out;
}

function toBase64(bytes: Uint8Array): string {
  return btoa(bytesToLatin1(bytes));
}

async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Undefined when the bytes are not gzip, which is the common case and not an error. */
async function gunzip(bytes: Uint8Array): Promise<string | undefined> {
  if (bytes.length < 2 || bytes[0] !== 0x1f || bytes[1] !== 0x8b) return undefined;
  try {
    const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
    return await new Response(stream).text();
  } catch {
    return undefined;
  }
}

/**
 * Every form the sentinel could be wearing when it lands somewhere.
 *
 * The base64 core is taken at all three byte alignments and trimmed by four characters at each end,
 * so a passphrase base64-encoded as part of a larger blob is still matched whatever offset it
 * happened to start at.
 */
function needlesFor(secret: string): string[] {
  const bytes = new TextEncoder().encode(secret);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  const base64Cores = [0, 1, 2].map((pad) => {
    const padded = new Uint8Array(pad + bytes.length);
    padded.set(bytes, pad);
    const encoded = toBase64(padded);
    return encoded.slice(4, encoded.length - 4);
  });
  return [secret, hex, hex.toUpperCase(), ...base64Cores];
}

/**
 * Flatten anything into the strings a search can run over: keys as well as values, Map and Set
 * contents, and byte payloads both raw and gunzipped.
 */
async function harvest(value: unknown, out: string[], seen: Set<unknown>, depth = 0): Promise<void> {
  if (value === null || value === undefined || depth > 16) return;
  if (typeof value === 'string') { out.push(value); return; }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    out.push(String(value));
    return;
  }
  if (typeof value === 'function' || typeof value === 'symbol') return;

  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    const bytes = value instanceof ArrayBuffer
      ? new Uint8Array(value)
      : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    out.push(bytesToLatin1(bytes));
    out.push(toBase64(bytes));
    const inflated = await gunzip(bytes);
    if (inflated !== undefined) out.push(inflated);
    return;
  }

  if (typeof value !== 'object') return;
  if (seen.has(value)) return;
  seen.add(value);

  if (value instanceof Blob) { out.push(await value.text()); return; }
  if (value instanceof Error) { out.push(value.message); out.push(String(value.stack ?? '')); return; }
  if (value instanceof Map) {
    for (const [k, v] of value) { await harvest(k, out, seen, depth + 1); await harvest(v, out, seen, depth + 1); }
    return;
  }
  if (value instanceof Set) {
    for (const v of value) await harvest(v, out, seen, depth + 1);
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) await harvest(v, out, seen, depth + 1);
    return;
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out.push(k);
    await harvest(v, out, seen, depth + 1);
  }
}

interface Leak {
  /** Which sink caught it, so a red run says where the passphrase went. */
  sink: string;
  /** Which secret, and in which form. */
  form: string;
  /** A short window around the hit, so it can be recognised without printing the whole sink. */
  context: string;
}

const SECRETS: Array<{ label: string; value: string }> = [
  { label: 'manual export passphrase', value: MANUAL_PASSPHRASE },
  { label: 'recovery passphrase', value: RECOVERY_PASSPHRASE },
];

/** Search one already-flattened sink for every form of every sentinel. */
function leaksIn(sink: string, pieces: string[]): Leak[] {
  const found: Leak[] = [];
  for (const secret of SECRETS) {
    const [plain, hexLower, hexUpper, ...base64Cores] = needlesFor(secret.value);
    const labelled: Array<[string, string]> = [
      ['plain text', plain],
      ['hex', hexLower],
      ['hex (upper)', hexUpper],
      ...base64Cores.map((core, i): [string, string] => [`base64 (alignment ${i})`, core]),
    ];
    for (const [form, needle] of labelled) {
      for (const piece of pieces) {
        const at = piece.indexOf(needle);
        if (at === -1) continue;
        found.push({
          sink,
          form: `${secret.label} as ${form}`,
          context: piece.slice(Math.max(0, at - 40), at + needle.length + 40),
        });
        break;
      }
    }
  }
  return found;
}

/** Flatten a sink and search it in one step. */
async function sweep(sink: string, value: unknown): Promise<Leak[]> {
  const pieces: string[] = [];
  await harvest(value, pieces, new Set());
  return leaksIn(sink, pieces);
}

function describeLeaks(leaks: Leak[]): string {
  return leaks.map((l) => `${l.sink}: ${l.form} -- ...${l.context}...`).join('\n');
}

// ─── the chrome realm the run happens in ──────────────────────────────────────
//
// Written here rather than taken from tests/helpers/chrome-storage.ts because that helper installs
// chrome.storage.local alone, and this promise is about session and sync too: a passphrase cached
// into chrome.storage.session (which src/storage/cache.ts and the service worker both use) would be
// exactly the leak this file exists to catch, and a helper that does not install the area cannot
// observe a write to it.

interface Realm {
  local: Record<string, unknown>;
  session: Record<string, unknown>;
  sync: Record<string, unknown>;
  sentMessages: unknown[];
  fetches: Array<{ url: unknown; init: unknown }>;
  downloads: unknown[];
  consoleLines: unknown[];
  restore: () => void;
}

function installRealm(): Realm {
  const local: Record<string, unknown> = {};
  const session: Record<string, unknown> = {};
  const sync: Record<string, unknown> = {};
  const sentMessages: unknown[] = [];
  const fetches: Array<{ url: unknown; init: unknown }> = [];
  const downloads: unknown[] = [];
  const consoleLines: unknown[] = [];

  const area = (state: Record<string, unknown>) => ({
    get: (keys?: string | string[] | Record<string, unknown> | null) => {
      if (keys === null || keys === undefined) return Promise.resolve({ ...state });
      if (typeof keys === 'object' && !Array.isArray(keys)) {
        const out: Record<string, unknown> = { ...keys };
        for (const k of Object.keys(keys)) if (k in state) out[k] = state[k];
        return Promise.resolve(out);
      }
      const out: Record<string, unknown> = {};
      for (const k of Array.isArray(keys) ? keys : [keys]) if (k in state) out[k] = state[k];
      return Promise.resolve(out);
    },
    set: (obj: Record<string, unknown>) => { Object.assign(state, obj); return Promise.resolve(); },
    remove: (keys: string | string[]) => {
      for (const k of Array.isArray(keys) ? keys : [keys]) delete state[k];
      return Promise.resolve();
    },
    clear: () => { for (const k of Object.keys(state)) delete state[k]; return Promise.resolve(); },
  });

  const globalAny = globalThis as unknown as {
    chrome?: unknown;
    fetch?: unknown;
  };
  const beforeChrome = globalAny.chrome;
  const beforeFetch = globalAny.fetch;

  globalAny.chrome = {
    storage: {
      local: area(local),
      session: area(session),
      sync: area(sync),
      onChanged: { addListener: () => undefined, removeListener: () => undefined },
    },
    runtime: {
      lastError: null,
      id: 'test-extension-id',
      // Recorded, not answered: the backup paths do not need a reply, and a recorded call is the
      // only way this file can assert that nothing was sent to the worker carrying the passphrase.
      sendMessage: (message: unknown) => { sentMessages.push(message); return Promise.resolve(undefined); },
      getManifest: () => ({ version: '0.0.0-test' }),
    },
    downloads: {
      download: (options: unknown) => { downloads.push(options); return Promise.resolve(downloads.length); },
      search: ({ id }: { id: number }) => Promise.resolve([{ id, state: 'complete' }]),
      setUiOptions: () => Promise.resolve(),
    },
  };

  // Any outbound call at all is recorded. The backup path is not supposed to make one; a run that
  // starts making them is a fact this check should be able to see.
  globalAny.fetch = (url: unknown, init: unknown) => {
    fetches.push({ url, init });
    return Promise.reject(new Error('no network in this check'));
  };

  const consoleMethods = ['log', 'info', 'warn', 'error', 'debug'] as const;
  const originals = consoleMethods.map((m) => [m, console[m]] as const);
  for (const m of consoleMethods) {
    console[m] = (...args: unknown[]) => { consoleLines.push(args); };
  }

  return {
    local, session, sync, sentMessages, fetches, downloads, consoleLines,
    restore: () => {
      for (const [m, fn] of originals) console[m] = fn;
      if (beforeChrome === undefined) delete globalAny.chrome; else globalAny.chrome = beforeChrome;
      if (beforeFetch === undefined) delete globalAny.fetch; else globalAny.fetch = beforeFetch;
    },
  };
}

// ─── the real backup run ──────────────────────────────────────────────────────

interface Run {
  realm: Realm;
  backup: ForensicBackup;
  sealedFile: string;
  storedRecordCount: number;
}

let run: Run;

/** Three real records, signed by the real key, linked into a real chain. */
async function seedChain(): Promise<void> {
  const fingerprint = await getPublicKeyFingerprint();
  let prevHash = CHAIN_GENESIS_HASH;
  for (let i = 0; i < 3; i++) {
    const partial = storageTestRecord({
      id: `r${i}`,
      chainPosition: i,
      timestamp: new Date(Date.UTC(2026, 8, 18, 12, i)).toISOString(),
      originalText: `post r${i}, long enough that the gzip envelope has something to compress`,
      prevRecordHash: prevHash,
      publicKeyFingerprint: fingerprint,
    } as Partial<ForensicRecord> & { id: string });
    const integrityHash = await computeRecordIntegrityHash(partial);
    const record = { ...partial, integrityHash } as ForensicRecord;
    await addRecord(record);
    prevHash = integrityHash;
  }
}

beforeAll(async () => {
  const realm = installRealm();
  await deleteDbs(FORENSIC_DB);
  await seedChain();

  // Run 1: the manual export, step for step as ExportTab.tsx does it.
  const backup = await buildBackupBlob(MANUAL_PASSPHRASE);
  const sealedFile = JSON.stringify(
    await sealBackupJson(JSON.stringify(backup), MANUAL_PASSPHRASE, 'passphrase'),
    null,
    2,
  );
  await recordManualBackupSuccess(backup.records.length, true);

  // Run 2: a recovery passphrase is set, then the automatic backup writes the file that carries the
  // escrow copy of the device seal secret into Downloads.
  await setBackupRecoveryPassphrase(RECOVERY_PASSPHRASE);
  await autoBackupToDownloads();

  const storedRecordCount = (await getRecordsOrThrow()).length;
  run = { realm, backup, sealedFile, storedRecordCount };
}, 120_000);

afterAll(async () => {
  run?.realm.restore();
  await deleteDbs(FORENSIC_DB);
});

describe('passphrase-never-leaves: the run actually happened', () => {
  // Without this, every sweep below could be passing over an empty run.
  it('backed up a real chain, wrapped the key under the passphrase, and wrote a sealed file', () => {
    expect(run.storedRecordCount).toBe(3);
    expect(run.backup.records).toHaveLength(3);
    expect(run.backup.wrappedPrivateKey).toBeDefined();
    expect(run.sealedFile.length).toBeGreaterThan(200);
    expect(run.realm.downloads.length).toBeGreaterThan(0);
  });
});

describe('passphrase-never-leaves: never stored', () => {
  it('is in none of the three chrome.storage areas, under any key', async () => {
    const leaks = [
      ...await sweep('chrome.storage.local', run.realm.local),
      ...await sweep('chrome.storage.session', run.realm.session),
      ...await sweep('chrome.storage.sync', run.realm.sync),
    ];
    expect(describeLeaks(leaks)).toBe('');
    // The sweep is only worth something over a store that was actually written to.
    expect(Object.keys(run.realm.local).length).toBeGreaterThan(0);
  });

  it('is in no object store of any IndexedDB database the run touched', async () => {
    const leaks: Leak[] = [];
    const names = (await indexedDB.databases())
      .map((d) => d.name)
      .filter((n): n is string => typeof n === 'string');
    expect(names).toContain(FORENSIC_DB);

    for (const name of names) {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open(name);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      try {
        for (const store of Array.from(db.objectStoreNames)) {
          const rows = await new Promise<unknown[]>((resolve, reject) => {
            const req = db.transaction(store, 'readonly').objectStore(store).getAll();
            req.onsuccess = () => resolve(req.result as unknown[]);
            req.onerror = () => reject(req.error);
          });
          const keys = await new Promise<unknown[]>((resolve, reject) => {
            const req = db.transaction(store, 'readonly').objectStore(store).getAllKeys();
            req.onsuccess = () => resolve(req.result as unknown[]);
            req.onerror = () => reject(req.error);
          });
          leaks.push(...await sweep(`IndexedDB ${name}.${store}`, { keys, rows }));
        }
      } finally {
        db.close();
      }
    }
    expect(describeLeaks(leaks)).toBe('');
  }, 60_000);
});

describe('passphrase-never-leaves: not in what the parent is handed', () => {
  it('is not in the backup object, before it is sealed', async () => {
    expect(describeLeaks(await sweep('backup object (pre-seal)', run.backup))).toBe('');
  });

  it('is not in the sealed file that lands in Downloads', async () => {
    expect(describeLeaks(await sweep('sealed manual backup file', run.sealedFile))).toBe('');
  });

  it('is not in the automatic backup download, whose escrow is derived from the recovery passphrase', async () => {
    // The download url is a percent-encoded data: URL. Both the raw and decoded forms are swept:
    // the sentinel is alphanumeric with dashes, so encoding does not hide it, but decoding also
    // opens anything the encoding wrapped.
    const decoded = run.realm.downloads.map((d) => {
      const url = (d as { url?: unknown }).url;
      if (typeof url !== 'string') return d;
      const comma = url.indexOf(',');
      try { return { ...(d as object), decoded: decodeURIComponent(url.slice(comma + 1)) }; }
      catch { return d; }
    });
    expect(describeLeaks(await sweep('automatic backup download', decoded))).toBe('');
  });
});

describe('passphrase-never-leaves: never sent, never printed', () => {
  it('is in no outbound call', async () => {
    const leaks = [
      ...await sweep('fetch', run.realm.fetches),
      ...await sweep('chrome.runtime.sendMessage', run.realm.sentMessages),
    ];
    expect(describeLeaks(leaks)).toBe('');
  });

  it('is in nothing the run printed', async () => {
    expect(describeLeaks(await sweep('console', run.realm.consoleLines))).toBe('');
  });
});

describe('passphrase-never-leaves: the sweeper can see', () => {
  // The positive control. Every test above asserts an ABSENCE, and an absence is free to a sweeper
  // that looks nowhere. This one plants the sentinel in each shape the sweeper claims to see
  // through and requires it back.
  it('finds a planted sentinel in every shape it claims to sweep', async () => {
    const encoded = new TextEncoder().encode(`wrapper ${MANUAL_PASSPHRASE} wrapper`);
    const shapes: Array<[string, unknown]> = [
      ['nested value', { a: { b: [{ c: MANUAL_PASSPHRASE }] } }],
      ['object key', { [MANUAL_PASSPHRASE]: 1 }],
      ['map value', new Map([['k', MANUAL_PASSPHRASE]])],
      ['set member', new Set([MANUAL_PASSPHRASE])],
      ['raw bytes', encoded],
      ['gzipped bytes', await gzip(encoded)],
      ['base64 string', toBase64(encoded)],
      ['hex string', Array.from(encoded, (b) => b.toString(16).padStart(2, '0')).join('')],
    ];
    for (const [label, planted] of shapes) {
      expect(await sweep(label, planted), `the sweeper missed a sentinel planted as: ${label}`)
        .not.toEqual([]);
    }
  });

  it('reports nothing for a sink that does not hold the sentinel', async () => {
    expect(await sweep('clean', { a: 'nothing here', b: new Uint8Array([1, 2, 3]) })).toEqual([]);
  });
});
