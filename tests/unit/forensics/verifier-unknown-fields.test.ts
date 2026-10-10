// A checker older than the file it is reading.
//
// The canonical payload is a fixed list of keys. A checker built against an
// older list cannot hash a field added later, so when the format grows, every
// record written after the growth fails its recomputation in that checker, and
// the only thing the reader is told is "the record was modified after the hash
// was stored". For a product whose whole claim is that a recipient can check a
// file without trusting anyone, that is the loudest possible wrong answer: the
// researcher concludes the file was edited, and it was not.
//
// Six fields have been appended since the format was written, the newest on
// 2026-09-17, and the public checker repository is refreshed a week behind the
// extension by design. So this is not hypothetical.
//
// The verdict does not soften: an attacker must not be able to downgrade
// "tampered" by adding a key. What the checker gained is the other explanation,
// as data: the names of the fields it does not know.

import { describe, expect, it, beforeAll } from 'vitest';
import { webcrypto } from 'node:crypto';

import { VERIFIER_CORE_FNS_SOURCE } from '../../../src/forensics/verifier-core-source';

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}

interface VerifyResult {
  ok: boolean;
  reason?: string;
  unknownFields?: string[];
}
type VerifyOne = (rec: unknown, keys: unknown, fp: unknown, red: unknown) => Promise<VerifyResult>;

let verifyOne: VerifyOne;
let canonicalPayload: (r: unknown) => string;
let sha256: (s: string) => Promise<string>;

beforeAll(() => {
  // The exact functions the recipient's browser runs, not a reimplementation.
  const core = new Function(
    `${VERIFIER_CORE_FNS_SOURCE}; return { verifyOne, canonicalPayload, sha256 };`,
  )() as { verifyOne: VerifyOne; canonicalPayload: (r: unknown) => string; sha256: (s: string) => Promise<string> };
  verifyOne = core.verifyOne;
  canonicalPayload = core.canonicalPayload;
  sha256 = core.sha256;
});

/** A record whose stored hash is correct for its content. */
async function sound(extra: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const rec: Record<string, unknown> = {
    id: 'fr-1',
    timestamp: '2026-09-17T10:00:00.000Z',
    platform: 'twitter',
    originalText: 'a recorded post',
    originalHash: 'h',
    originalLength: 15,
    neutralizedText: '',
    author: '@someone',
    postUrl: '',
    techniques: [],
    overallScore: 0,
    userAgeCategory: 'adult',
    aiSource: 'cloud',
    feedSource: 'for-you',
    kind: 'post',
    verdict: 'pass',
    chainPosition: 0,
    ...extra,
  };
  rec.integrityHash = await sha256(canonicalPayload(rec));
  return rec;
}

/**
 * A record as a LATER FeelingWise would write it: the extra fields are appended
 * to the canonical payload, exactly as the format requires of a new field, and
 * the stored hash covers them. Today's checker cannot hash a key it has never
 * heard of, so its recomputation misses. That is the whole mechanism, and it is
 * why an unknown field on its own changes nothing: this checker ignores it, and
 * the hash still matches.
 */
async function fromTheFuture(extra: Record<string, unknown>): Promise<Record<string, unknown>> {
  const rec = await sound();
  Object.assign(rec, extra);
  const todayPayload = canonicalPayload(rec);
  const appended = Object.entries(extra).map(([k, v]) => `,${JSON.stringify(k)}:${JSON.stringify(v)}`).join('');
  rec.integrityHash = await sha256(`${todayPayload.slice(0, -1)}${appended}}`);
  return rec;
}

describe('a record with fields this checker does not know', () => {
  it('an unknown field alone changes nothing: this checker never hashed it', async () => {
    // Stated first because it is the thing that makes the rest safe. A key
    // added to a sound record does not break its hash here, so the excuse
    // below cannot be summoned by adding one.
    const rec = await sound();
    (rec as Record<string, unknown>).somethingAddedLater = 'a value';

    const result = await verifyOne(rec, {}, null, {});

    expect(result.ok).toBe(true);
  });

  it('a record from a later version fails, and the fields are named', async () => {
    const rec = await fromTheFuture({ somethingAddedLater: 'a value' });

    const result = await verifyOne(rec, {}, null, {});

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('tampered');
    expect(result.unknownFields).toEqual(['somethingAddedLater']);
  });

  it('names several, sorted, so two checkers report the same thing', async () => {
    const rec = await fromTheFuture({ zebraField: 1, alphaField: 2 });

    const result = await verifyOne(rec, {}, null, {});

    expect(result.unknownFields).toEqual(['alphaField', 'zebraField']);
  });

  it('says nothing of the kind when the content was simply changed', async () => {
    // The ordinary tampering case: no unknown field, so no second explanation,
    // and the reader is not offered an excuse that does not apply.
    const rec = await sound();
    rec.originalText = 'edited after the hash was stored';

    const result = await verifyOne(rec, {}, null, {});

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('tampered');
    expect(result.unknownFields).toBeUndefined();
  });

  it('never softens the verdict, which is what stops a key being used to hide an edit', async () => {
    // An attacker who edits a record and adds a junk key gets the same failure.
    // The extra name is information for a human, never a lighter result.
    const rec = await sound();
    rec.originalText = 'edited after the hash was stored';
    (rec as Record<string, unknown>).lookHarmless = true;

    const result = await verifyOne(rec, {}, null, {});

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('tampered');
    expect(result.unknownFields).toEqual(['lookHarmless']);
  });

  it('counts a record’s own furniture as known, not as unknown fields', async () => {
    // integrityHash, signature, chainAnchor and redacted live on a record and
    // are deliberately outside the hash; a checker that called them unknown
    // would print the excuse on every genuine failure.
    const rec = await sound();
    rec.originalText = 'edited';
    Object.assign(rec, { signature: 'sig', chainAnchor: 'genesis-v1' });

    const result = await verifyOne(rec, {}, null, {});

    expect(result.unknownFields).toBeUndefined();
  });

  it('passes a sound record through untouched', async () => {
    const rec = await sound();
    const result = await verifyOne(rec, {}, null, {});
    expect(result.ok).toBe(true);
  });
});
