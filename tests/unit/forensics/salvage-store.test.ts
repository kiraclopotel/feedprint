// Recovered records must earn their place in the record.
//
// The salvage came out of HTML export files sitting in a Downloads folder,
// outside the app's control, where anything could have edited them. Importing
// them without checking would let altered text enter the chain and inherit the
// credibility of everything around it. That would be a worse outcome than the
// data loss the salvage exists to undo, so the import verifies every record
// against its own canonical hash and stores nothing that fails.

import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ForensicRecord } from '../../../src/types/forensic';
import { computeRecordIntegrityHash } from '../../../src/forensics/canonical-payload';
import { deleteDb } from '../../helpers/indexeddb';
import {
  importSalvagedRecords,
  readSalvagedRecords,
  countSalvagedRecords,
} from '../../../src/forensics/salvage-store';

const DB = 'feelingwise-forensics-salvage';

/** A record carrying a genuine hash, the way a real exported record does. */
async function authentic(position: number, over: Partial<ForensicRecord> = {}): Promise<ForensicRecord> {
  const base = {
    id: `sv-${position}`,
    timestamp: new Date(Date.UTC(2026, 7, 1, 0, 0, position % 60)).toISOString(),
    platform: 'twitter',
    originalText: `salvaged text ${position}`,
    originalHash: `oh${position}`,
    originalLength: 10,
    techniques: [],
    overallScore: 0,
    userAgeCategory: 'adult',
    chainPosition: position,
    publicKeyFingerprint: 'fd3577e462c42ebc',
    ...over,
  } as ForensicRecord;
  return { ...base, integrityHash: await computeRecordIntegrityHash(base) };
}

beforeEach(async () => {
  await deleteDb(DB);
});

afterEach(async () => {
  await deleteDb(DB);
});

describe('salvage import', () => {
  it('stores records whose hash still matches their content', async () => {
    const records = [await authentic(0), await authentic(1), await authentic(2)];

    const result = await importSalvagedRecords(records);

    expect(result.imported).toBe(3);
    expect(result.rejectedUnverified).toBe(0);
    expect(result.epochs).toEqual(['fd3577e462c42ebc']);
    expect(await countSalvagedRecords()).toBe(3);
  });

  it('refuses a record whose text was altered after export', async () => {
    const good = await authentic(0);
    const tampered = { ...(await authentic(1)), originalText: 'edited in the Downloads folder' };

    const result = await importSalvagedRecords([good, tampered]);

    expect(result.imported).toBe(1);
    expect(result.rejectedUnverified).toBe(1);
    const stored = await readSalvagedRecords();
    expect(stored.map(r => r.id)).toEqual(['sv-0']);
  });

  it('marks imports as a prior generation without breaking their hash', async () => {
    await importSalvagedRecords([await authentic(0)]);

    const [stored] = await readSalvagedRecords();

    expect(stored.chainAnchor).toBe('pre-rekey');
    // chainAnchor is outside the canonical payload, so the record still
    // hashes to what it carries and its signature still verifies.
    expect(await computeRecordIntegrityHash(stored)).toBe(stored.integrityHash);
  });

  it('is idempotent, so re-importing the same salvage file does not duplicate', async () => {
    const records = [await authentic(0), await authentic(1)];

    await importSalvagedRecords(records);
    const second = await importSalvagedRecords(records);

    expect(second.imported).toBe(0);
    expect(second.alreadyPresent).toBe(2);
    expect(await countSalvagedRecords()).toBe(2);
  });

  // THE MARKER NAMED KEYS THE IMPORT DID NOT BRING IN. The key set was built in
  // the verification loop, before the freshness filter decided which records
  // actually enter, so a re-import that added nothing still listed the signing
  // keys of everything it had verified. Those go into the import marker's
  // hashed line as `keys=`, under a sentence saying these are the keys the
  // import added — a signed statement naming a key nothing was imported under.
  it('names no key when the import added nothing', async () => {
    const records = [await authentic(0), await authentic(1)];

    const first = await importSalvagedRecords(records);
    expect(first.imported).toBe(2);
    expect(first.epochs.length).toBe(1);

    const second = await importSalvagedRecords(records);
    expect(second.imported).toBe(0);
    expect(second.epochs).toEqual([]);
  });
});

// Register item 12 (2026-09-06): a record is checked by signature under the
// key its fingerprint names whenever that key is held. A forgery that re-hashed
// its edited text is refused at the door instead of entering the record and
// inheriting a generation.
import { fingerprintPublicJwk } from '../../../src/forensics/signing';
import { rememberPublicKeys } from '../../../src/forensics/known-keys';

const g = globalThis as unknown as { chrome?: unknown };

async function keypair(): Promise<{ priv: CryptoKey; jwk: JsonWebKey; fp: string }> {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const full = await crypto.subtle.exportKey('jwk', kp.publicKey);
  const jwk: JsonWebKey = { kty: 'EC', crv: 'P-256', x: full.x, y: full.y };
  return { priv: kp.privateKey, jwk, fp: await fingerprintPublicJwk(jwk) };
}

async function sign(record: ForensicRecord, priv: CryptoKey): Promise<ForensicRecord> {
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: { name: 'SHA-256' } }, priv, new TextEncoder().encode(record.integrityHash));
  const signature = Buffer.from(sig).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return { ...record, signature };
}

describe('salvage import checks the signature under a held key', () => {
  let savedChrome: unknown;
  let store: Record<string, unknown>;
  beforeEach(() => {
    store = {};
    savedChrome = g.chrome;
    g.chrome = {
      storage: {
        local: {
          get: async (key: string | string[]) => {
            const keys = Array.isArray(key) ? key : [key];
            return Object.fromEntries(keys.map(k => [k, store[k]]));
          },
          set: async (v: Record<string, unknown>) => { Object.assign(store, v); },
        },
      },
    };
  });
  afterEach(() => { g.chrome = savedChrome; });

  it('imports a record signed by a remembered key, refuses one signed by a different key under that fingerprint, and imports by hash alone when the key is not held', async () => {
    const holder = await keypair();
    const stranger = await keypair();
    await rememberPublicKeys([holder.jwk]);

    const genuine = await sign(await authentic(0, { publicKeyFingerprint: holder.fp }), holder.priv);
    const forged = await sign(await authentic(1, { publicKeyFingerprint: holder.fp }), stranger.priv);
    const unheld = await sign(await authentic(2, { publicKeyFingerprint: stranger.fp }), stranger.priv);

    const result = await importSalvagedRecords([genuine, forged, unheld]);
    expect(result.imported).toBe(2);
    expect(result.rejectedUnverified).toBe(1);
    expect(result.rejectedBadSignature).toBe(1);
    const ids = (await readSalvagedRecords()).map(r => r.id).sort();
    expect(ids).toEqual(['sv-0', 'sv-2']);
  });
});
