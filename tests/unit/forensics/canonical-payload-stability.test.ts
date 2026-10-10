// The hash-stability pin.
//
// Records are immutable, and the standing rule is that no schema change ships
// without a proof that existing records still hash to the same value. The
// canonical payload's key order is load-bearing: a new field appended at the
// bottom and left undefined is dropped by JSON.stringify, so the bytes a
// legacy record hashes are unchanged and every signature over it still
// verifies. That is the claim, and a comment asserting it is not a proof.
//
// EXPECTED_LEGACY_HASH below was computed against the canonical payload as it
// stood BEFORE `surfaceOrigin` was added on 2026-09-04, from the exact record
// this file builds. If a future field breaks the contract, this test fails
// with the old and new hashes side by side, before any user's chain does.
//
// Adding a field correctly does NOT change this hash. If you have to edit the
// constant, the change is not additive and every stored record is about to
// stop verifying.

import { describe, it, expect } from 'vitest';
import { webcrypto } from 'node:crypto';
import { computeRecordIntegrityHash } from '../../../src/forensics/canonical-payload';
import type { ForensicRecord } from '../../../src/types/forensic';

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}

/** Computed 2026-09-04, before `surfaceOrigin` existed. Do not edit. */
const EXPECTED_LEGACY_HASH =
  '325d8ff0eca204945fa28666d13c38db22428435e8c4150b99315124a480fee2';

function legacyRecord(): Omit<ForensicRecord, 'integrityHash' | 'signature' | 'chainAnchor'> {
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
  } as unknown as Omit<ForensicRecord, 'integrityHash' | 'signature' | 'chainAnchor'>;
}

describe('canonical payload - hash stability across schema growth', () => {
  it('a record written before the newest field still hashes to the same value', async () => {
    const actual = await computeRecordIntegrityHash(legacyRecord());
    expect(
      actual,
      'The canonical payload changed in a way that rehashes existing records. '
      + 'Every stored signature is about to stop verifying. Append the new field '
      + 'at the bottom and leave it undefined on legacy records.',
    ).toBe(EXPECTED_LEGACY_HASH);
  });

  it('setting the new field changes the hash, so it is really inside the signature', async () => {
    const withOrigin = { ...legacyRecord(), surfaceOrigin: 'https://www.facebook.com' };
    const actual = await computeRecordIntegrityHash(withOrigin);
    expect(actual).not.toBe(EXPECTED_LEGACY_HASH);
  });

  it('repainting which site a record came from breaks its hash', async () => {
    const real = await computeRecordIntegrityHash({
      ...legacyRecord(), surfaceOrigin: 'https://www.facebook.com',
    });
    const spoofed = await computeRecordIntegrityHash({
      ...legacyRecord(), surfaceOrigin: 'http://www.facebook.com',
    });
    expect(spoofed).not.toBe(real);
  });

  it('the decision block and the reader are appended, so a legacy record is unchanged and a stated one is covered', async () => {
    const decision = {
      judge: null,
      reading: null,
      descriptor: null,
      rails: [{ name: 'identity-slur' as const, match: 'x' }],
      household: { mode: 'teen' as const, reader: 'default', topicRule: null, mask: false },
      row: 'R2',
      action: 'hide' as const,
      applied: 'hide' as const,
      rewrite: null,
      note: null,
    };
    const stated = await computeRecordIntegrityHash({ ...legacyRecord(), decision, reader: 'default' });
    expect(stated).not.toBe(EXPECTED_LEGACY_HASH);
    const repaintedRow = await computeRecordIntegrityHash({
      ...legacyRecord(), decision: { ...decision, row: 'D1', action: 'allow', applied: 'allow' }, reader: 'default',
    });
    expect(repaintedRow).not.toBe(stated);
    const reassignedReader = await computeRecordIntegrityHash({ ...legacyRecord(), decision, reader: 'child 1' });
    expect(reassignedReader).not.toBe(stated);
    const explicit = await computeRecordIntegrityHash({ ...legacyRecord(), decision: undefined, reader: undefined });
    expect(explicit).toBe(EXPECTED_LEGACY_HASH);
  });

  it('verdictOrigin is appended, so a legacy record is unchanged and a room verdict is covered', async () => {
    // PLAN-2026-09-14 item 4. A record that carries no verdictOrigin - which
    // is every record written before 2026-09-14 and every record judged on
    // the item's own words - must hash to exactly the byte string it hashed
    // before the field existed.
    const legacy = await computeRecordIntegrityHash(legacyRecord());
    expect(legacy).toBe(EXPECTED_LEGACY_HASH);
    const explicitUndefined = await computeRecordIntegrityHash({
      ...legacyRecord(), verdictOrigin: undefined,
    });
    expect(explicitUndefined).toBe(EXPECTED_LEGACY_HASH);

    // And a record that says its verdict came from the room hashes
    // differently, so the claim is inside the signature and cannot be added
    // to, or removed from, a stored record without breaking it.
    const roomJudged = await computeRecordIntegrityHash({
      ...legacyRecord(), verdictOrigin: 'room' as const,
    });
    expect(roomJudged).not.toBe(EXPECTED_LEGACY_HASH);
  });

  it('authorCapture is appended, so a legacy record is unchanged and a withheld author is covered', async () => {
    // 2026-09-17. Every record written before the field, and every record
    // whose author is the one the page showed, carries no authorCapture and
    // must hash to exactly the byte string it hashed before the field
    // existed.
    const legacy = await computeRecordIntegrityHash(legacyRecord());
    expect(legacy).toBe(EXPECTED_LEGACY_HASH);
    const explicitUndefined = await computeRecordIntegrityHash({
      ...legacyRecord(), authorCapture: undefined,
    });
    expect(explicitUndefined).toBe(EXPECTED_LEGACY_HASH);

    // A record that says the recorder refused the author it saw hashes
    // differently, so the admission is inside the signature: it cannot be
    // stripped from a stored record to make the row look like an ordinary
    // attributed post, and it cannot be added to one either.
    const withheld = await computeRecordIntegrityHash({
      ...legacyRecord(), authorCapture: 'withheld' as const,
    });
    expect(withheld).not.toBe(EXPECTED_LEGACY_HASH);
  });

  it('an explicit undefined is the same as an absent field', async () => {
    const absent = await computeRecordIntegrityHash(legacyRecord());
    const explicit = await computeRecordIntegrityHash({
      ...legacyRecord(), surfaceOrigin: undefined,
    });
    expect(explicit).toBe(absent);
  });

  it('subject, the last key, is appended the same way: undefined on a legacy record leaves its hash alone', async () => {
    const withSubjectUndefined = { ...legacyRecord(), subject: undefined };
    expect(await computeRecordIntegrityHash(withSubjectUndefined)).toBe(EXPECTED_LEGACY_HASH);
  });
});
