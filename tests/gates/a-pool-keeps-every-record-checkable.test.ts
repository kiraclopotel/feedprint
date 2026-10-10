// verifier/pool.mjs puts several people's exports into one dataset for a panel. The promise it makes is that every
// record in the pool can still be checked without the files it came from, and that "the same post" is told apart in
// its three senses: one record exported twice, one recorder seeing a text again, two recorders seeing it. The files
// here are real exports made by the extension's own exporter and signed with keys drawn in the test, so the checker
// reads them exactly as it reads a person's file.

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash, webcrypto } from 'node:crypto';
import { attachSignedManifest, buildForensicHtmlExport, type EmbeddedPublicKey } from '../../src/forensics/html-export';
import { computeRecordIntegrityHash } from '../../src/forensics/canonical-payload';
import type { ForensicRecord } from '../../src/types/forensic';
// @ts-expect-error - the shipped tool is plain JavaScript with no types
import { buildPool, checkPool, POOL_FORMAT } from '../../verifier/pool.mjs';
// @ts-expect-error - the shipped tools are plain JavaScript with no types
import { rowsOf } from '../../verifier/to-csv.mjs';
import { REPO_ROOT } from '../helpers/repo-root';

const subtle = (globalThis.crypto ?? webcrypto).subtle;

interface Key { jwk: JsonWebKey; fp: string; sign: (hash: string) => Promise<string> }

async function newKey(): Promise<Key> {
  const pair = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const full = await subtle.exportKey('jwk', pair.publicKey);
  const jwk: JsonWebKey = { kty: 'EC', crv: 'P-256', x: full.x, y: full.y };
  const d = await subtle.digest('SHA-256', new TextEncoder().encode(`${jwk.x}|${jwk.y}`));
  const fp = Buffer.from(d).toString('hex').slice(0, 16);
  const sign = async (hash: string) => Buffer.from(
    await subtle.sign({ name: 'ECDSA', hash: { name: 'SHA-256' } }, pair.privateKey, new TextEncoder().encode(hash)),
  ).toString('base64url');
  return { jwk, fp, sign };
}

/** A chain of whole-caption posts, each signed by the key given for its place, linked by hash. */
async function chain(keys: Key[], texts: string[], idPrefix: string): Promise<ForensicRecord[]> {
  const out: ForensicRecord[] = [];
  let prev = '';
  for (let i = 0; i < texts.length; i++) {
    const key = keys[Math.min(i, keys.length - 1)];
    const base = {
      id: `${idPrefix}-${i}`, timestamp: `2026-10-01T12:00:0${i}.000Z`, platform: 'tiktok', originalText: texts[i],
      originalHash: 'h', originalLength: texts[i].length, neutralizedText: '', author: `@author-${i}`,
      postUrl: `https://www.tiktok.com/@author-${i}/video/${i}`, techniques: [], overallScore: 0, userAgeCategory: 'adult',
      aiSource: 'rules', feedSource: 'for-you', publicKeyFingerprint: key.fp, chainPosition: i, prevRecordHash: prev,
      kind: 'post', verdict: 'pass', textCapture: 'whole',
    } as unknown as Omit<ForensicRecord, 'integrityHash' | 'signature' | 'chainAnchor'>;
    const integrityHash = await computeRecordIntegrityHash(base);
    out.push({ ...base, integrityHash, signature: await key.sign(integrityHash) } as ForensicRecord);
    prev = integrityHash;
  }
  return out;
}

async function exportOf(records: ForensicRecord[], own: Key, carried?: Key[], name?: string): Promise<string> {
  const publicKeys: EmbeddedPublicKey[] | undefined = carried?.map((k) => ({ fingerprint: k.fp, jwk: k.jwk }));
  const html = buildForensicHtmlExport(records, {
    fwVersion: 'pool test: every record in this file is invented', publicKeyJwk: own.jwk, publicKeyFingerprint: own.fp,
    locale: 'en', ...(publicKeys ? { publicKeys } : {}),
    ...(name ? { profile: { name, platform: 'Windows', browser: 'Chrome 130', language: 'ro-RO', timeZone: 'Europe/Bucharest' } } : {}),
  });
  return attachSignedManifest(html, own.sign);
}

const SHARED = 'Guvernul ascunde adevărul. Trezește-te acum!';

let ana: Key;
let bogdan: Key;
let anaFile: string;
let bogdanFile: string;

beforeAll(async () => {
  ana = await newKey();
  bogdan = await newKey();
  anaFile = await exportOf(await chain([ana], [SHARED, 'only Ana saw this', SHARED], 'a'), ana);
  bogdanFile = await exportOf(await chain([bogdan], ['only Bogdan saw this', SHARED], 'b'), bogdan);
});

describe('a pool of two people', () => {
  it('keeps every record, names two recorders, and counts the shared post as seen by both', async () => {
    const pool = await buildPool([{ label: 'ana.html', text: anaFile }, { label: 'bogdan.html', text: bogdanFile }]);
    expect(pool.format).toBe(POOL_FORMAT);
    expect(pool.refused).toEqual([]);
    expect(pool.recorders).toHaveLength(2);
    expect(pool.records).toHaveLength(5);
    const shared = pool.records.filter((r: { record: ForensicRecord }) => r.record.originalText === SHARED);
    expect(shared).toHaveLength(3);
    for (const row of shared) expect(row.recordersWithItem).toBe(2);
    const anaShared = shared.filter((r: { recorder: string }) => r.recorder === ana.fp);
    expect(anaShared.map((r: { sightingsByThisRecorder: number }) => r.sightingsByThisRecorder)).toEqual([2, 2]);
    const bogdanShared = shared.filter((r: { recorder: string }) => r.recorder === bogdan.fp);
    expect(bogdanShared[0].sightingsByThisRecorder).toBe(1);
  });

  it('counts one person exporting twice as copies, not as a second recorder or more records', async () => {
    const pool = await buildPool([
      { label: 'ana.html', text: anaFile },
      { label: 'ana-again.html', text: anaFile },
      { label: 'bogdan.html', text: bogdanFile },
    ]);
    expect(pool.recorders).toHaveLength(2);
    expect(pool.records).toHaveLength(5);
    expect(pool.sources[1]).toMatchObject({ file: 'ana-again.html', pooled: 0, copies: 3 });
    expect(pool.records.filter((r: { alsoIn: number[] }) => r.alsoIn.includes(1))).toHaveLength(3);
  });

  it('counts a file holding an earlier key of the same install as the same recorder', async () => {
    const earlier = await newKey();
    const later = await newKey();
    const before = await exportOf(await chain([earlier], ['before the key changed'], 'c'), earlier);
    const after = await exportOf(await chain([earlier, later], ['before the key changed', 'after it changed'], 'c'), later, [later, earlier]);
    const pool = await buildPool([{ label: 'before.html', text: before }, { label: 'after.html', text: after }]);
    expect(pool.refused).toEqual([]);
    expect(pool.recorders).toHaveLength(1);
    expect(pool.records).toHaveLength(2);
  });
});

describe('every record stays checkable from the pool alone', () => {
  it('verifies every record again with nothing but the pool', async () => {
    const pool = await buildPool([{ label: 'ana.html', text: anaFile }, { label: 'bogdan.html', text: bogdanFile }]);
    const again = JSON.parse(JSON.stringify(pool));
    expect(await checkPool(again)).toMatchObject({ records: 5, verified: 5, hashOnly: 0, failed: [] });
  });

  it('fails a record whose text was edited inside the pool', async () => {
    const pool = JSON.parse(JSON.stringify(await buildPool([{ label: 'ana.html', text: anaFile }])));
    pool.records[1].record.originalText = 'edited inside the pool';
    const r = await checkPool(pool);
    expect(r.verified).toBe(2);
    expect(r.failed).toHaveLength(1);
    expect(r.failed[0].row).toBe(1);
  });

  it('does not use a key swapped inside the pool, so no record verifies under it', async () => {
    const pool = JSON.parse(JSON.stringify(await buildPool([{ label: 'ana.html', text: anaFile }])));
    pool.keys = [{ fingerprint: ana.fp, jwk: bogdan.jwk }];
    const r = await checkPool(pool);
    expect(r.badKeys).toEqual([ana.fp]);
    expect(r.verified).toBe(0);
    expect(r.hashOnly).toBe(3);
  });
});

describe('a file the checker refuses does not enter the pool', () => {
  it('refuses a file whose record was edited after signing, and says why', async () => {
    const edited = readFileSync(resolve(REPO_ROOT, 'verifier/vectors/04-manifest-edited.html'), 'utf8');
    const pool = await buildPool([{ label: 'ana.html', text: anaFile }, { label: 'edited.html', text: edited }]);
    expect(pool.records).toHaveLength(3);
    expect(pool.refused).toHaveLength(1);
    expect(pool.refused[0].file).toBe('edited.html');
    expect(pool.refused[0].reason).toMatch(/^failed the check: /);
  });

  it('pools the published vectors a second implementer starts from, and every record checks again', async () => {
    const inputs = ['01-verified.html', '11-text-escaping.html'].map((name) => ({
      label: name,
      text: readFileSync(resolve(REPO_ROOT, 'verifier/vectors', name), 'utf8'),
    }));
    const pool = await buildPool(inputs);
    expect(pool.refused).toEqual([]);
    expect(pool.records.length).toBeGreaterThan(0);
    const r = await checkPool(JSON.parse(JSON.stringify(pool)));
    expect(r.failed).toEqual([]);
    expect(r.verified + r.hashOnly).toBe(pool.records.length);
  });
});

describe('the code a volunteer typed on the file', () => {
  it('names each recorder by the code on its file, in the pool and on every row of the table', async () => {
    const p1 = await exportOf(await chain([ana], [SHARED], 'n1'), ana, undefined, 'P1');
    const p2 = await exportOf(await chain([bogdan], [SHARED], 'n2'), bogdan, undefined, 'P2');
    const pool = await buildPool([{ label: 'receipts-a.html', text: p1 }, { label: 'receipts-b.html', text: p2 }]);
    expect(pool.refused).toEqual([]);
    expect(pool.sources.map((s: { nameOnFile: string | null }) => s.nameOnFile)).toEqual(['P1', 'P2']);
    const rows = await rowsOf(pool);
    expect(rows.map((r: { recorder: string; nameOnFile: string }) => [r.recorder, r.nameOnFile])).toEqual([[ana.fp, 'P1'], [bogdan.fp, 'P2']]);
  });

  it('leaves the column empty for a file that names nobody, rather than guessing', async () => {
    const pool = await buildPool([{ label: 'ana.html', text: anaFile }]);
    expect(pool.sources[0].nameOnFile).toBeNull();
    for (const row of await rowsOf(pool)) expect(row.nameOnFile).toBe('');
  });
});

describe('the SHA-256 a pool gives each file', () => {
  it('is of the bytes as read from disk, so it matches the one the volunteer sent even with a byte order mark', async () => {
    const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(anaFile, 'utf8')]);
    const decodedByAPage = new TextDecoder().decode(bytes);
    const pool = await buildPool([{ label: 'ana.html', text: decodedByAPage, bytes }]);
    expect(pool.sources[0].sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(pool.sources[0].sha256).not.toBe(createHash('sha256').update(decodedByAPage, 'utf8').digest('hex'));
  });
});
