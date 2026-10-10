// Relegation must never mutate canonical-hashed content.
//
// Live failure 2026-06-11: the dashboard said "all records intact" while the
// complete-chain export reported "content does not match its cryptographic
// signature" from the first relegated record onward. Root cause: the old
// re-anchor relegated records by SETTING chainPosition to undefined, but
// chainPosition is INSIDE the canonical signed payload (canonical-payload.ts
// `?? -1`) — stripping it changed the hashed content, so every relegated
// record's recomputed hash stopped matching its stored integrityHash. The
// dashboard never noticed because its walker skipped position-less records;
// the export includes them, so only the court-facing artifact broke.
//
// Contracts locked here:
//   1. markRelegated sets ONLY the non-hashed chainAnchor flag — the
//      recomputed hash still equals the stored integrityHash.
//   2. recoverRelegatedPositions (the migration for stores damaged by the
//      old code) only accepts a position PROVEN by recomputed-hash equality,
//      and reports unrecoverable records honestly.
//   3. Verdict PARITY: on the same store, the dashboard walker and the
//      exported HTML verifier (the EXACT embedded source, evaluated) both
//      reach a non-failing verdict — the divergence that shipped the live
//      failure can no longer exist silently.

import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../src/forensics/signing', () => ({
  signHash: vi.fn(async () => 'mock-sig'),
  verifyHash: vi.fn(async () => true),
  getPublicKeyFingerprint: vi.fn(async () => 'current-fp'),
  getPublicKeyJWK: vi.fn(async () => ({ kty: 'EC', crv: 'P-256', x: 'A', y: 'B' })),
  getSigningKeyCreatedAt: vi.fn(async () => '2026-01-01T00:00:00.000Z'),
  exportWrappedPrivateKey: vi.fn(async () => null),
}));

import type { ForensicRecord } from '../../../src/types/forensic';
import { markRelegated } from '../../../src/forensics/store';
import { recoverRelegatedPositions } from '../../../src/forensics/auto-heal';
import { buildCompleteChainSortKey } from '../../../src/forensics/exporter';
import { verifyChainIntegrity, CHAIN_GENESIS_HASH } from '../../../src/forensics/chain-integrity';
import { computeRecordIntegrityHash } from '../../../src/forensics/canonical-payload';
import { VERIFIER_CORE_FNS_SOURCE } from '../../../src/forensics/html-export';
import { verifyHash } from '../../../src/forensics/signing';

const mockedVerifyHash = vi.mocked(verifyHash);

interface BuildOpts {
  idPrefix: string;
  /** First chainPosition (chains always start at 0; overridable for sweep-bound tests). */
  startPosition?: number;
  /** First record's prevRecordHash (genesis by default). */
  prevHash?: string;
  /** ISO second offset so generations get distinct, ordered timestamps. */
  timeOffsetSec?: number;
  /** Signing-key fingerprint stamped into the (hashed) payload. */
  fingerprint?: string;
}

async function buildChain(n: number, opts: BuildOpts): Promise<ForensicRecord[]> {
  const start = opts.startPosition ?? 0;
  const offset = opts.timeOffsetSec ?? 0;
  const records: ForensicRecord[] = [];
  let prevHash = opts.prevHash ?? CHAIN_GENESIS_HASH;
  for (let i = 0; i < n; i++) {
    const t = offset + i;
    const payload: Omit<ForensicRecord, 'integrityHash' | 'signature' | 'chainAnchor'> = {
      id: `${opts.idPrefix}-${i}`,
      timestamp: `2026-06-11T${String(Math.floor(t / 3600)).padStart(2, '0')}:${String(
        Math.floor(t / 60) % 60,
      ).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}.000Z`,
      platform: 'twitter',
      originalText: `original ${opts.idPrefix} ${i}`,
      originalHash: `hash-${opts.idPrefix}-${i}`,
      originalLength: 10,
      neutralizedText: '',
      author: `@a${i}`,
      postUrl: `https://x.com/p/${i}`,
      techniques: [],
      overallScore: 0,
      userAgeCategory: 'teen',
      aiSource: 'cloud',
      feedSource: 'unknown',
      prevRecordHash: prevHash,
      chainPosition: start + i,
      publicKeyFingerprint: opts.fingerprint ?? 'current-fp',
    };
    const integrityHash = await computeRecordIntegrityHash(payload);
    records.push({ ...payload, integrityHash, signature: 'sig' });
    prevHash = integrityHash;
  }
  return records;
}

// ─── 1. markRelegated never mutates hashed content ───

describe('markRelegated', () => {
  it('keeps chainPosition and every hashed field — the stored hash still recomputes', async () => {
    const [record] = await buildChain(1, { idPrefix: 'mr' });
    const relegated = markRelegated(record);
    expect(relegated.chainAnchor).toBe('pre-rekey');
    expect(relegated.chainPosition).toBe(record.chainPosition);
    expect(await computeRecordIntegrityHash(relegated)).toBe(record.integrityHash);
  });
});

// ─── 2. recoverRelegatedPositions — stored-hash-matched repair ──────────────

describe('recoverRelegatedPositions', () => {
  function strip(records: ForensicRecord[]): ForensicRecord[] {
    // What the pre-fix relegation wrote: position gone, anchor set.
    return records.map(r => ({ ...r, chainPosition: undefined, chainAnchor: 'pre-rekey' as const }));
  }

  it('recovers every position of a single stripped generation (timestamp-index phase)', async () => {
    const original = await buildChain(4, { idPrefix: 'rec' });
    const { recovered, unrecoveredIds } = await recoverRelegatedPositions(strip(original));
    expect(unrecoveredIds).toHaveLength(0);
    for (const r of original) {
      expect(recovered.get(r.id)).toBe(r.chainPosition);
    }
  });

  it('recovers two overlapping generations (both starting at position 0)', async () => {
    const genA = await buildChain(3, { idPrefix: 'genA' });
    const genB = await buildChain(2, { idPrefix: 'genB', timeOffsetSec: 500 });
    const { recovered, unrecoveredIds } = await recoverRelegatedPositions(strip([...genA, ...genB]));
    expect(unrecoveredIds).toHaveLength(0);
    for (const r of [...genA, ...genB]) {
      expect(recovered.get(r.id)).toBe(r.chainPosition);
    }
  });

  it('recovers a linked child beyond the sweep bound via prev-hash propagation', async () => {
    // Two records at positions 66 and 67. damaged.length = 2 → sweep bound =
    // 2 + 64 = 66: the parent is findable by sweep, the child (67) is NOT —
    // only the prev-hash link (hash-verified) can place it.
    const pair = await buildChain(2, { idPrefix: 'deep', startPosition: 66 });
    const { recovered, unrecoveredIds } = await recoverRelegatedPositions(strip(pair));
    expect(unrecoveredIds).toHaveLength(0);
    expect(recovered.get('deep-0')).toBe(66);
    expect(recovered.get('deep-1')).toBe(67);
  });

  it('reports unprovable records honestly instead of guessing', async () => {
    const [good] = await buildChain(1, { idPrefix: 'ok' });
    const [bad] = await buildChain(1, { idPrefix: 'bad', timeOffsetSec: 50 });
    const corrupted = { ...bad, integrityHash: 'f'.repeat(64) }; // no position can ever match
    const { recovered, unrecoveredIds } = await recoverRelegatedPositions(
      strip([good, corrupted]),
    );
    expect(recovered.get('ok-0')).toBe(0);
    expect(unrecoveredIds).toEqual(['bad-0']);
  });
});

// ─── 3. Export ordering + dashboard/export verdict parity ───

describe('buildCompleteChainSortKey', () => {
  function sortWith(records: ForensicRecord[]): ForensicRecord[] {
    const key = buildCompleteChainSortKey(records);
    return [...records].sort((a, b) => key(a) - key(b));
  }

  it('orders: active chain, then relegated section (own position order), then position-less', async () => {
    const active = await buildChain(2, { idPrefix: 'srt-a' });
    const relegated = (await buildChain(2, { idPrefix: 'srt-r', timeOffsetSec: 60, fingerprint: 'old-fp' })).map(markRelegated);
    const stripped: ForensicRecord = { ...relegated[0], id: 'srt-x', chainPosition: undefined };
    const sorted = sortWith([relegated[1], stripped, active[1], relegated[0], active[0]]);
    expect(sorted.map(r => r.id)).toEqual(['srt-a-0', 'srt-a-1', 'srt-r-0', 'srt-r-1', 'srt-x']);
  });

  it('groups overlapping relegated generations by signing key — never interleaved by raw position', async () => {
    // Two rekey eras, BOTH starting at position 0. A plain position sort
    // would interleave them (A@0, B@0, A@1, …) and the export verifier's
    // contiguity walk would compare unrelated records across generations
    // and report a false chain-link-mismatch.
    const genA = (await buildChain(2, { idPrefix: 'gsk-a', fingerprint: 'fp-A' })).map(markRelegated);
    const genB = (await buildChain(2, { idPrefix: 'gsk-b', timeOffsetSec: 300, fingerprint: 'fp-B' })).map(markRelegated);
    const sorted = sortWith([genB[1], genA[1], genB[0], genA[0]]);
    expect(sorted.map(r => r.id)).toEqual(['gsk-a-0', 'gsk-a-1', 'gsk-b-0', 'gsk-b-1']);
  });
});

describe('export/dashboard verdict parity on a store with relegated records', () => {
  // Evaluate the EXACT verifier functions the recipient's browser runs.
  const verifier = new Function(
    `"use strict";${VERIFIER_CORE_FNS_SOURCE}
     return { verifyOne: verifyOne, verifyChain: verifyChain, verificationState: verificationState, importPubKey: importPubKey, fingerprintJwk: fingerprintJwk, importVerifiedPubKey: importVerifiedPubKey };`,
  )() as {
    verifyOne(
      rec: unknown,
      pubKey: CryptoKey,
      currentFingerprint?: string,
    ): Promise<{ ok: boolean; unverified?: boolean; priorKey?: boolean; reason?: string }>;
    verifyChain(records: unknown[]): Promise<{ ok: boolean; reason?: string }>;
    verificationState(
      perRecord: Array<{ ok: boolean; unverified?: boolean }>,
      chain: { ok: boolean },
    ): 'verified' | 'partial' | 'failed';
    importPubKey(jwk: JsonWebKey): Promise<CryptoKey>;
    fingerprintJwk(jwk: JsonWebKey): Promise<string>;
    importVerifiedPubKey(jwk: JsonWebKey, declaredFingerprint: string): Promise<{
      pubKey: CryptoKey;
      fingerprint: string;
    }>;
  };

  async function generateKeypair(): Promise<CryptoKeyPair> {
    return crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
      'sign',
      'verify',
    ]);
  }

  async function sign(records: ForensicRecord[], privateKey: CryptoKey): Promise<ForensicRecord[]> {
    const out: ForensicRecord[] = [];
    for (const r of records) {
      const sig = await crypto.subtle.sign(
        { name: 'ECDSA', hash: { name: 'SHA-256' } },
        privateKey,
        new TextEncoder().encode(r.integrityHash),
      );
      const b64u = Buffer.from(sig).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      out.push({ ...r, signature: b64u });
    }
    return out;
  }

  it('both verdicts are non-failing on the same store (the 2026-06-11 divergence is dead)', async () => {
    // TWO relegated generations (the install rekeyed twice), each its own
    // old key + fingerprint, position ranges overlapping (both start at 0)
    // — the interleave case that produced a false chain-link-mismatch
    // before generation grouping.
    const oldKeyA = await generateKeypair();
    const oldKeyB = await generateKeypair();
    const currentKey = await generateKeypair();
    const genA = (
      await sign(await buildChain(2, { idPrefix: 'par-rA', fingerprint: 'fp-old-A' }), oldKeyA.privateKey)
    ).map(markRelegated);
    const genB = (
      await sign(
        await buildChain(3, { idPrefix: 'par-rB', timeOffsetSec: 60, fingerprint: 'fp-old-B' }),
        oldKeyB.privateKey,
      )
    ).map(markRelegated);
    const active = await sign(
      await buildChain(3, { idPrefix: 'par-a', timeOffsetSec: 120 }),
      currentKey.privateKey,
    );
    const store = [...genA, ...genB, ...active];

    // Dashboard walker: relegated records are skipped by the active-chain walk
    // (positions intact); active records verify, while presentation remains
    // partial because the pre-rekey signatures are unavailable here.
    mockedVerifyHash.mockResolvedValue(true);
    const dashboard = await verifyChainIntegrity(store);
    expect(dashboard.valid).toBe(true);
    expect(dashboard.chainLength).toBe(3);
    expect(dashboard.preRekeyCount).toBe(5);

    // Export verifier (real Web Crypto, embedded source): every record —
    // including both relegated generations — gets a non-failing verdict.
    const pubKey = await verifier.importPubKey(
      await crypto.subtle.exportKey('jwk', currentKey.publicKey),
    );
    const sortKey = buildCompleteChainSortKey(store);
    const sorted = [...store].sort((a, b) => sortKey(a) - sortKey(b));
    const exportVerdicts = [];
    for (const r of sorted) {
      const v = await verifier.verifyOne(r, pubKey, 'current-fp');
      exportVerdicts.push(v);
      expect(v.ok).toBe(true);
      if (r.chainAnchor === 'pre-rekey') {
        expect(v.priorKey).toBe(true);
        expect(v.unverified).toBe(true);
      } else {
        expect(v.unverified).not.toBe(true);
      }
    }
    const chain = await verifier.verifyChain(sorted);
    expect(chain.ok).toBe(true);
    expect(verifier.verificationState(exportVerdicts, chain)).toBe('partial');
  });

  it('a position-STRIPPED relegated record still fails the export verifier — the defect this fix removes', async () => {
    // Documents WHY relegation must never strip chainPosition: under the old
    // behavior the recipient's verifier recomputes the hash with -1 in the
    // canonical payload and reports tampering on an authentic record.
    const currentKey = await generateKeypair();
    const [record] = await sign(await buildChain(1, { idPrefix: 'strip' }), currentKey.privateKey);
    const strippedOldStyle = { ...record, chainPosition: undefined, chainAnchor: 'pre-rekey' as const };
    const pubKey = await verifier.importPubKey(
      await crypto.subtle.exportKey('jwk', currentKey.publicKey),
    );
    expect((await verifier.verifyOne(record, pubKey, 'current-fp')).ok).toBe(true);
    const broken = await verifier.verifyOne(strippedOldStyle, pubKey, 'current-fp');
    expect(broken.ok).toBe(false);
    expect(broken.reason).toBe('tampered');
  });

  it('rejects a rehashed-and-relinked forgery whose signatures no longer verify', async () => {
    const currentKey = await generateKeypair();
    const originals = await sign(
      await buildChain(2, { idPrefix: 'forged', fingerprint: 'current-fp' }),
      currentKey.privateKey,
    );
    let prevRecordHash = CHAIN_GENESIS_HASH;
    const forged: ForensicRecord[] = [];
    for (const [i, original] of originals.entries()) {
      const changed = {
        ...original,
        originalText: `attacker replacement ${i}`,
        prevRecordHash,
      };
      const integrityHash = await computeRecordIntegrityHash(changed);
      forged.push({ ...changed, integrityHash });
      prevRecordHash = integrityHash;
    }

    const pubKey = await verifier.importPubKey(
      await crypto.subtle.exportKey('jwk', currentKey.publicKey),
    );
    const chain = await verifier.verifyChain(forged);
    expect(chain.ok).toBe(true); // the attacker recomputed the unkeyed links
    const verdicts = [];
    for (const record of forged) {
      const verdict = await verifier.verifyOne(record, pubKey, 'current-fp');
      verdicts.push(verdict);
      expect(verdict.ok).toBe(false);
      expect(verdict.reason).toBe('key-mismatch');
    }
    expect(verifier.verificationState(verdicts, chain)).toBe('failed');
  });

  it('derives the key fingerprint from the JWK and rejects a changed label', async () => {
    const key = await generateKeypair();
    const jwk = await crypto.subtle.exportKey('jwk', key.publicKey);
    const fingerprint = await verifier.fingerprintJwk(jwk);

    await expect(verifier.importVerifiedPubKey(jwk, fingerprint)).resolves.toMatchObject({ fingerprint });
    await expect(verifier.importVerifiedPubKey(jwk, 'attacker-label')).rejects.toThrow(/fingerprint/i);
  });

  it('turns malformed matching-key signature bytes into a failed verdict, not an exception', async () => {
    const key = await generateKeypair();
    const jwk = await crypto.subtle.exportKey('jwk', key.publicKey);
    const fingerprint = await verifier.fingerprintJwk(jwk);
    const { pubKey } = await verifier.importVerifiedPubKey(jwk, fingerprint);
    const [record] = await buildChain(1, { idPrefix: 'bad-sig', fingerprint });
    record.signature = '%%%not-base64url%%%';

    await expect(verifier.verifyOne(record, pubKey, fingerprint)).resolves.toMatchObject({
      ok: false,
      reason: 'key-mismatch',
    });
  });

  it('positively verifies a legacy unstamped signature under the embedded key', async () => {
    const key = await generateKeypair();
    const jwk = await crypto.subtle.exportKey('jwk', key.publicKey);
    const fingerprint = await verifier.fingerprintJwk(jwk);
    const { pubKey } = await verifier.importVerifiedPubKey(jwk, fingerprint);
    const [stamped] = await buildChain(1, { idPrefix: 'legacy-unstamped' });
    const legacyBase: ForensicRecord = { ...stamped, publicKeyFingerprint: undefined };
    const legacy = {
      ...legacyBase,
      integrityHash: await computeRecordIntegrityHash(legacyBase),
    };
    const [record] = await sign([legacy], key.privateKey);

    await expect(verifier.verifyOne(record, pubKey, fingerprint)).resolves.toEqual({ ok: true });
  });
});

// ─── The export verifier on a chain with more than one run ──────────────────
//
// 2026-09-03, the owner's consolidated file: after the record loss and
// recovery the install signed new records at positions it had already used,
// so a linear walk found a "chain-link-mismatch" at the first seam while every
// record's hash and signature passed. Links are hashes; the verifier resolves
// them against the whole file and reports the seams as branches.

describe('export verifier: restarted chains are branches, not tampering', () => {
  const verifier = new Function(
    `"use strict";${VERIFIER_CORE_FNS_SOURCE}
     return { verifyChain: verifyChain, verificationState: verificationState };`,
  )() as {
    verifyChain(
      records: unknown[],
      perRecord: Array<{ ok: boolean; unverified?: boolean }>,
    ): Promise<{ ok: boolean; reason?: string; brokenAt?: number; branches: number; restarts: number; unattributed: number; outside: number }>;
    verificationState(
      perRecord: Array<{ ok: boolean; unverified?: boolean }>,
      chain: { ok: boolean; branches?: number; restarts?: number },
    ): 'verified' | 'partial' | 'failed';
  };
  const signed = (n: number) => Array.from({ length: n }, () => ({ ok: true }));

  it('two runs of the same key: every link resolves, the shared positions are branches, verdict partial', async () => {
    const a = await buildChain(3, { idPrefix: 'run-a' });
    const b = await buildChain(2, { idPrefix: 'run-b', startPosition: 1, prevHash: a[0].integrityHash, timeOffsetSec: 100 });
    const file = [a[0], a[1], b[0], a[2], b[1]]; // by position, then time: 0, 1, 1, 2, 2
    const chain = await verifier.verifyChain(file, signed(5));
    expect(chain.ok).toBe(true);
    expect(chain.branches).toBe(2);
    expect(chain.restarts).toBe(0);
    expect(verifier.verificationState(signed(5), chain)).toBe('partial');
  });

  it('a seam whose predecessor is not in the file, both records signed: a restart, verdict partial', async () => {
    const [a0] = await buildChain(1, { idPrefix: 'seam-a' });
    const [x1] = await buildChain(1, { idPrefix: 'seam-x', startPosition: 1, prevHash: 'f'.repeat(64) });
    const chain = await verifier.verifyChain([a0, x1], signed(2));
    expect(chain.ok).toBe(true);
    expect(chain.restarts).toBe(1);
    expect(verifier.verificationState(signed(2), chain)).toBe('partial');
  });

  it('the same seam under a key the file does not carry is an unattributed restart, verdict partial, never failed', async () => {
    // The owner's file after importing 58 older generations (2026-09-03
    // 08:25): one key embedded, seams inside prior-key generations, every
    // hash recomputing. FAILED at #900 was the wrong word for that.
    const [a0] = await buildChain(1, { idPrefix: 'seam-a' });
    const [x1] = await buildChain(1, { idPrefix: 'seam-x', startPosition: 1, prevHash: 'f'.repeat(64) });
    const verdicts = [{ ok: true }, { ok: true, unverified: true, priorKey: true }];
    const chain = await verifier.verifyChain([a0, x1], verdicts);
    expect(chain.ok).toBe(true);
    expect(chain.restarts).toBe(1);
    expect(chain.unattributed).toBe(1);
    expect(verifier.verificationState(verdicts, chain)).toBe('partial');
  });

  it('a record whose predecessor is missing keeps the verdict off green', async () => {
    // This test used to assert 'verified' here, and that assertion was the
    // defect. `outside` counts a record whose stated predecessor is not in the
    // file; verificationState never consulted it, so removing records from an
    // export left the green VERIFIED banner in place. The 2026-09-04 evidence
    // audit's cross-examination is a live demonstration of exactly that:
    // delete four records from an exhibit, reopen it, and the file still tells
    // the judge it is verified.
    //
    // A filtered extract produces the same count legitimately, which is why
    // the verdict is 'partial' and not 'failed'. The reason is not left to the
    // reader to guess: the completeness block names filtering as the expected
    // cause when the export carries a selection, and says plainly that a
    // prune, a rotation, a filter and a removal look the same from inside.
    const a = await buildChain(3, { idPrefix: 'filt' });
    const chain = await verifier.verifyChain([a[0], a[2]], signed(2));
    expect(chain.ok).toBe(true);
    expect(chain.outside).toBe(1);
    expect(chain.branches).toBe(0);
    expect(verifier.verificationState(signed(2), chain)).toBe('partial');
  });

  it('an unbroken run under one key with nothing missing is still verified', async () => {
    // The counterweight to the test above: tightening the verdict must not
    // make every export amber, or the word stops carrying information.
    const a = await buildChain(3, { idPrefix: 'whole' });
    const chain = await verifier.verifyChain(a, signed(3));
    expect(chain.outside).toBe(0);
    expect(verifier.verificationState(signed(3), chain)).toBe('verified');
  });
});
