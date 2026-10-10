// FeelingWise — salvaged prior-generation records.
//
// Records recovered from old HTML exports after the active chain had already
// destroyed them. On a real install 27983 records of the live epoch were
// recoverable this way against 11816 still held by the app, because the HTML
// export embeds its records as plaintext JSON while the .json backups are
// sealed under a device key that a reinstall invalidates.
//
// Why a SEPARATE database rather than the month archives:
//
//   • The month archives belong to one continuous chain. Salvaged records
//     come from a chain that was cleared, so their chainPositions overlap the
//     live ones. Mixing them would put two records with the same position
//     next to each other and the recipient's contiguity walk would read that
//     as a broken chain — turning recovered evidence into an integrity
//     failure on the live record.
//   • Provenance differs and should stay visible. These were reconstructed
//     from exported copies, not carried forward by the app.
//
// They are stored with `chainAnchor: 'pre-rekey'`, which is the vocabulary the
// codebase already has for "belongs to a prior chain generation":
// `buildCompleteChainSortKey` renders such records as a trailing section
// grouped by signing key, so their positions never sit adjacent to the live
// chain's. `chainAnchor` is explicitly excluded from the canonical payload
// (canonical-payload.ts), so setting it preserves every integrityHash and
// every signature.

import type { ForensicRecord } from '../types/forensic';
import { computeRecordIntegrityHash } from './canonical-payload';
import { getPublicKeyFingerprint, getPublicKeyJWK, verifyHashUnderJwk } from './signing';
import { knownPublicKey } from './known-keys';
import { assertExtensionRealm } from '../storage/realm-guard';

const DB_NAME = 'feelingwise-forensics-salvage';
const DB_VERSION = 1;
const STORE = 'records';

function openSalvageDb(): Promise<IDBDatabase> {
  assertExtensionRealm(DB_NAME);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        // keyPath 'id' rather than autoIncrement: importing the same salvage
        // file twice must not double the record set, and record ids are
        // already unique per chain.
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('epoch', 'publicKeyFingerprint', { unique: false });
        store.createIndex('timestamp', 'timestamp', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export interface SalvageImportResult {
  imported: number;
  alreadyPresent: number;
  /** Records whose recomputed hash did not match the one they carry. */
  rejectedUnverified: number;
  /** Of the rejected, those whose signature failed under a held key (also counted in rejectedUnverified). */
  rejectedBadSignature: number;
  epochs: string[];
  /** Ids of the records added in this pass, for the import marker's digest. */
  importedIds: string[];
}

/**
 * Import salvaged records, refusing any that cannot prove they are unaltered.
 *
 * Every record is re-hashed with the SAME canonical function the extension
 * uses at write time and compared against the integrityHash it carries. A
 * record that fails is not stored at all. This matters more here than
 * anywhere else in the codebase: these records came from files sitting in a
 * Downloads folder, outside the app's control, and importing them without
 * checking would let anything that had been edited there enter the record and
 * inherit its credibility.
 *
 * Signature verification happens here too, when the key is held (register
 * item 12, 2026-09-06): the install's own key, or a key remembered from a
 * picked file (known-keys.ts; the Export tab remembers a file's keys before
 * it imports the file's records). A record whose signature fails under the
 * key its fingerprint names is a forgery and is refused. A record whose key
 * is not held imports by hash alone, as before, and the export marks it as
 * not verified by signature. A key that travelled in the same file as the
 * records is self-consistent, not attested; that limit is stated in the
 * export, not resolved here.
 */
export async function importSalvagedRecords(records: ForensicRecord[]): Promise<SalvageImportResult> {
  const result: SalvageImportResult = {
    imported: 0,
    alreadyPresent: 0,
    rejectedUnverified: 0,
    rejectedBadSignature: 0,
    epochs: [],
    importedIds: [],
  };
  if (records.length === 0) return result;

  const keys = new Map<string, JsonWebKey | null>();
  try {
    keys.set(await getPublicKeyFingerprint(), await getPublicKeyJWK());
  } catch {
    // No own key in this realm: only remembered keys can be checked.
  }
  const keyFor = async (fingerprint: string): Promise<JsonWebKey | null> => {
    if (!keys.has(fingerprint)) keys.set(fingerprint, (await knownPublicKey(fingerprint)) ?? null);
    return keys.get(fingerprint) ?? null;
  };

  const verified: ForensicRecord[] = [];
  const epochs = new Set<string>();
  for (const record of records) {
    let computed: string;
    try {
      computed = await computeRecordIntegrityHash(record);
    } catch {
      result.rejectedUnverified++;
      continue;
    }
    if (computed !== record.integrityHash) {
      result.rejectedUnverified++;
      continue;
    }
    if (record.signature && record.publicKeyFingerprint) {
      const jwk = await keyFor(record.publicKeyFingerprint);
      let okSig = jwk === null;
      if (jwk) {
        try {
          okSig = await verifyHashUnderJwk(jwk, record.integrityHash, record.signature);
        } catch {
          okSig = false;
        }
      }
      if (!okSig) {
        result.rejectedUnverified++;
        result.rejectedBadSignature++;
        continue;
      }
    }
    // Non-hashed field: setting it keeps the integrityHash and signature valid.
    verified.push({ ...record, chainAnchor: 'pre-rekey' });
  }

  if (verified.length === 0) return result;

  const db = await openSalvageDb();
  try {
    const existing = await new Promise<Set<string>>((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAllKeys();
      req.onsuccess = () => resolve(new Set(req.result.map(String)));
      req.onerror = () => reject(req.error);
    });
    const fresh = verified.filter(r => !existing.has(r.id));
    result.alreadyPresent = verified.length - fresh.length;
    // The keys the import actually BROUGHT IN, taken from `fresh` rather than
    // from everything that verified. The set was built in the verification
    // loop above, before this filter decided which records enter, so an import
    // whose records were all already present still named their signing keys —
    // and the marker prints them as `keys=` in its hashed line under a sentence
    // saying these are the keys the import added. A signed statement naming a
    // key nothing was imported under.
    for (const record of fresh) {
      if (record.publicKeyFingerprint) epochs.add(record.publicKeyFingerprint);
    }
    result.epochs = [...epochs].sort();

    if (fresh.length > 0) {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        const store = tx.objectStore(STORE);
        for (const record of fresh) store.put(record);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error ?? new Error('salvage import aborted'));
      });
      result.imported = fresh.length;
      result.importedIds = fresh.map(r => r.id);
    }
  } finally {
    db.close();
  }
  return result;
}

/** Every salvaged record, oldest chain position first within each epoch. */
export async function readSalvagedRecords(): Promise<ForensicRecord[]> {
  if (typeof indexedDB === 'undefined') return [];
  let db: IDBDatabase | undefined;
  try {
    db = await openSalvageDb();
    const records: ForensicRecord[] = await new Promise((resolve, reject) => {
      const req = db!.transaction(STORE, 'readonly').objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return records;
  } catch {
    return [];
  } finally {
    db?.close();
  }
}

/** How many salvaged records are held, without reading them. */
export async function countSalvagedRecords(): Promise<number> {
  if (typeof indexedDB === 'undefined') return 0;
  let db: IDBDatabase | undefined;
  try {
    db = await openSalvageDb();
    return await new Promise<number>((resolve, reject) => {
      const req = db!.transaction(STORE, 'readonly').objectStore(STORE).count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return 0;
  } finally {
    db?.close();
  }
}
