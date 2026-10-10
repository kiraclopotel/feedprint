// The two nested groups that say where a record came from.
//
// `stamp` is what the extension states about itself on a record (the build that
// wrote it, the install type, the kind of evidence); `provenance` is what the page
// supplied (the platform's own ids, the hash of its raw response). They are two keys
// on the canonical list, not six flat ones, because a nested object is serialised
// whole: a sub-field added later never changes the list again, so a checker of this
// commit never reads a later record as tampered.
//
// No writer sets either group until the checker that hashes them is published. What must hold:
//   1. every record written today hashes byte-identically (the legacy pin);
//   2. a group that is set is inside the signature, every sub-field of it;
//   3. the checker the recipient runs hashes both groups exactly as the extension
//      does, so a record carrying them verifies and names no unknown field;
//   4. the one writer helper adds nothing to a record while no stamp is stated.

import { describe, it, expect, beforeAll } from 'vitest';
import { webcrypto } from 'node:crypto';
import { computeRecordIntegrityHash } from '../../../src/forensics/canonical-payload';
import { finalizeRecord } from '../../../src/forensics/record-stamp';
import { VERIFIER_CORE_FNS_SOURCE } from '../../../src/forensics/verifier-core-source';
import type { ForensicRecord } from '../../../src/types/forensic';

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}

type Unhashed = Omit<ForensicRecord, 'integrityHash' | 'signature' | 'chainAnchor'>;

/** The same legacy record and frozen hash as canonical-payload-stability.test.ts. */
const EXPECTED_LEGACY_HASH =
  '325d8ff0eca204945fa28666d13c38db22428435e8c4150b99315124a480fee2';

function legacyRecord(): Unhashed {
  return {
    id: 'fr-hash-stability-001',
    timestamp: '2026-01-02T03:04:05.000Z',
    platform: 'facebook',
    originalText: 'A post that existed before the field did.',
    originalHash: 'orig-hash',
    originalLength: 40,
    neutralizedText: '',
    author: '@stable',
    postUrl: 'https://facebook.com/post/1',
    techniques: [{ name: 'fear-appeal', severity: 5, confidence: 0.6 }],
    overallScore: 0.5,
    userAgeCategory: 'teen',
    aiSource: 'cloud',
    feedSource: 'for-you',
    aiModel: 'm',
    aiProvider: 'p',
    detectionMode: 'd',
    configSnapshot: { mode: 'teen', threshold: 0.4, dailyCap: 5000 },
    prevRecordHash: 'prev-hash',
    chainPosition: 41,
    verdict: 'flagged',
    publicKeyFingerprint: 'fp-stable-01',
  } as unknown as Unhashed;
}

const STAMP = {
  recorderBuildId: 'fwbid-0e6a9d81aaaa-r2517',
  installType: 'normal',
  evidenceKind: 'screen',
} as const;

const PROVENANCE = {
  platformIds: { post: '1234567890', author: '42' },
  raw: { hash: 'ab'.repeat(32), length: 2048, endpoint: '/api/graphql' },
} as const;

/**
 * The hash of the legacy record carrying both groups, computed once by the hasher
 * that first knew them. Do not edit: a change here means a record written with the
 * groups no longer verifies.
 */
const EXPECTED_STATED_HASH =
  'a2faa06f74222168c5ba2d04e64bddfe03f203ef781c6ae21e4102913cb3dd89';

describe('the stamp and provenance groups on the canonical list', () => {
  it('a record that carries neither hashes exactly as before', async () => {
    expect(await computeRecordIntegrityHash(legacyRecord())).toBe(EXPECTED_LEGACY_HASH);
    expect(await computeRecordIntegrityHash({ ...legacyRecord(), stamp: undefined, provenance: undefined }))
      .toBe(EXPECTED_LEGACY_HASH);
  });

  it('a stated stamp is inside the signature, every sub-field of it', async () => {
    const stated = await computeRecordIntegrityHash({ ...legacyRecord(), stamp: { ...STAMP } });
    expect(stated).not.toBe(EXPECTED_LEGACY_HASH);
    const otherBuild = await computeRecordIntegrityHash({
      ...legacyRecord(), stamp: { ...STAMP, recorderBuildId: 'fwbid-ffffffffffff-r2517' },
    });
    expect(otherBuild).not.toBe(stated);
    const otherInstall = await computeRecordIntegrityHash({
      ...legacyRecord(), stamp: { ...STAMP, installType: 'development' },
    });
    expect(otherInstall).not.toBe(stated);
  });

  it('a stated provenance is inside the signature, ids and raw hash alike', async () => {
    const stated = await computeRecordIntegrityHash({ ...legacyRecord(), provenance: structuredClone(PROVENANCE) });
    expect(stated).not.toBe(EXPECTED_LEGACY_HASH);
    const otherAuthor = await computeRecordIntegrityHash({
      ...legacyRecord(), provenance: { ...structuredClone(PROVENANCE), platformIds: { post: '1234567890', author: '43' } },
    });
    expect(otherAuthor).not.toBe(stated);
    const otherRaw = await computeRecordIntegrityHash({
      ...legacyRecord(), provenance: { ...structuredClone(PROVENANCE), raw: { hash: 'cd'.repeat(32), length: 2048 } },
    });
    expect(otherRaw).not.toBe(stated);
  });

  it('a record carrying both hashes to the frozen value', async () => {
    const actual = await computeRecordIntegrityHash({
      ...legacyRecord(), stamp: { ...STAMP }, provenance: structuredClone(PROVENANCE),
    });
    expect(actual).toBe(EXPECTED_STATED_HASH);
  });
});

describe('the recipient checker reads both groups', () => {
  type VerifyOne = (rec: unknown, keys: unknown, fp: unknown, red: unknown) =>
    Promise<{ ok: boolean; reason?: string; unknownFields?: string[] }>;
  let verifyOne: VerifyOne;

  beforeAll(() => {
    verifyOne = (new Function(`${VERIFIER_CORE_FNS_SOURCE}; return { verifyOne };`)() as { verifyOne: VerifyOne }).verifyOne;
  });

  it('a record hashed by the extension with both groups recomputes in the checker', async () => {
    const rec: Record<string, unknown> = {
      ...legacyRecord(), stamp: { ...STAMP }, provenance: structuredClone(PROVENANCE),
    };
    rec.integrityHash = await computeRecordIntegrityHash(rec as unknown as Unhashed);
    // A JSON round trip, as the export carries it.
    const carried = JSON.parse(JSON.stringify(rec));

    const result = await verifyOne(carried, {}, null, {});

    expect(result.ok).toBe(true);
    expect(result.unknownFields).toBeUndefined();
  });

  it('an edited sub-field still reads tampered, and names no unknown field', async () => {
    const rec: Record<string, unknown> = { ...legacyRecord(), stamp: { ...STAMP } };
    rec.integrityHash = await computeRecordIntegrityHash(rec as unknown as Unhashed);
    const carried = JSON.parse(JSON.stringify(rec));
    carried.stamp.installType = 'development';

    const result = await verifyOne(carried, {}, null, {});

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('tampered');
    expect(result.unknownFields).toBeUndefined();
  });
});

describe('finalizeRecord, the one place a record is hashed before it is stored', () => {
  it('adds no stamp key while nothing is stated, so every writer output is byte-equal to before', async () => {
    const partial = legacyRecord();
    const record = await finalizeRecord(partial);

    expect('stamp' in record).toBe(false);
    expect(record.integrityHash).toBe(EXPECTED_LEGACY_HASH);
    expect(record.integrityHash).toBe(await computeRecordIntegrityHash(partial));
  });

  it('keeps every field of the partial, the chain anchor included', async () => {
    const partial = { ...legacyRecord(), chainAnchor: 'gap' as const };
    const record = await finalizeRecord(partial);

    expect(record.chainAnchor).toBe('gap');
    expect(record.integrityHash).toBe(EXPECTED_LEGACY_HASH);
  });
});
