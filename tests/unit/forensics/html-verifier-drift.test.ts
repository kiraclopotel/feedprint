// Drift-prevention test for the HTML verifier's inline canonicalPayload.
//
// The standalone HTML export at src/forensics/html-export.ts embeds a
// JavaScript verifier that recipients (lawyers, school counselors, CPS) run
// in their browser to recompute each record's integrity hash. That verifier
// has its own copy of the canonicalPayload function. Pre-fix it was missing
// 7 fields — `topic`, `sourceCategory`, `parentRecordId`, `commentDepth`,
// `roomAuthor`, `roomCaption`, `roomUrl` — added to the production hasher
// in §CT-9 / §CW / §CT-12 (2026-05-04). On records produced after that date
// the recipient verifier reported every signed record as "tampered" because
// the recomputed hash diverged from the stored integrity hash.
//
// This test pins the contract: every field the production hasher includes
// must also be in the inline verifier source, in the same order. If anyone
// adds a new field to canonical-payload.ts without updating
// VERIFIER_CANONICAL_PAYLOAD_FN_SOURCE in html-export.ts, this test fails
// before the bug reaches production.
//
// UNTIL 2026-09-18 THAT SENTENCE WAS FALSE, and this is worth reading before
// trusting any guard in this tree. The contract was enforced by hashing one
// fixture record through both hashers and comparing the digests. JSON.stringify
// omits an undefined key, so a field the fixture leaves unset is invisible to
// the comparison. The fixture set no `buildId`, no `verdictOrigin` and no
// `authorCapture`, the three most recently appended fields, so deleting any of
// them from the inline verifier left this file ten of ten green. Measured that
// day by deleting `buildId:r.buildId` and running it.
//
// The digest comparison is kept, because it catches a value-level divergence a
// key list cannot see (`?? ''` against `||''`, a number coerced, an order
// swapped inside a nested object). What is added below it is the assertion the
// header always claimed: the two key lists, extracted from the two sources AS
// TEXT and compared in order. A field appended to one and not the other fails
// whether or not any fixture happens to carry it, which is the only way a guard
// survives the next person who does not read this comment.

import { describe, it, expect } from 'vitest';
import type { ForensicRecord } from '../../../src/types/forensic';
import { computeRecordIntegrityHash } from '../../../src/forensics/canonical-payload';
import { sha256 } from '../../../src/forensics/hasher';
import { VERIFIER_CANONICAL_PAYLOAD_FN_SOURCE } from '../../../src/forensics/html-export';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function fullyPopulatedRecord(): Omit<
  ForensicRecord,
  'integrityHash' | 'signature' | 'chainAnchor'
> {
  return {
    id: 'fr-drift-001',
    timestamp: '2026-05-08T12:00:00.000Z',
    platform: 'tiktok',
    originalText: 'BV ASA FACEM LA COLINDE DE CRACIUN COPII',
    originalHash: 'h-original-abc123',
    originalLength: 41,
    neutralizedText: 'Comentariu rescris în română.',
    author: '@example_user',
    postUrl: 'https://www.tiktok.com/@example/video/1',
    techniques: [{ name: 'toxic-positivity', severity: 6, confidence: 0.7 }],
    overallScore: 6,
    userAgeCategory: 'teen',
    aiSource: 'cloud',
    feedSource: 'for-you',
    aiModel: 'llama-3.1-8b-instant',
    aiProvider: 'groq',
    detectionMode: 'comment-batch:negative',
    configSnapshot: { mode: 'teen', threshold: 0.4, dailyCap: 5000 },
    prevRecordHash: 'h-prev-xyz',
    chainPosition: 42,
    verdict: 'flagged',
    skipReason: undefined,
    kind: 'comment',
    parentVideoId: 'tk-vid-123',
    environment: undefined,
    priorChainHash: undefined,
    resetReason: undefined,
    publicKeyFingerprint: 'fp-abc-123',
    topic: 'caroling',
    sourceCategory: 'algorithm',
    parentRecordId: 'fr-parent-001',
    commentDepth: 1,
    roomAuthor: '@example_room',
    roomCaption: 'Christmas caroling moment',
    roomUrl: 'https://www.tiktok.com/@example_room/video/1',
    harmFloor: {
      score: 72,
      topCategory: 'identity-slur',
      topEvidence: 'reported slur match in original text',
      identitySlurMatch: true,
      language: 'ro',
    },
    failureKind: undefined,
    cap: undefined,
    metrics: { likes: 42, reply_count: 7, views: 1280, is_creator_hearted: true },
    anchorUrl: 'https://www.tiktok.com/@example_room/video/1?comment=987',
    videoContext: {
      overlayText: 'LINK IN BIO before it is BANNED',
      scene: 'Text slideshow over a kitchen background.',
      contentType: 'text-slideshow',
      techniques: ['urgency', 'fake scarcity'],
      severity: 7,
      model: 'gemini-3.1-flash-lite',
      frameCount: 4,
    },
    accountType: 'group',
    sourceContainer: 'Example Hobby Group',
    observedSequence: 12,
    viewportSeenAt: '2026-06-25T10:00:00.000Z',
    surfaceSessionId: 'ss-drift-001',
    imageContext: {
      overlayText: 'DOCTORS HATE THIS ONE TRICK',
      scene: 'setting: kitchen; people: one adult; actions: holding a jar; objects: supplement jar; staging: before/after split; visual_harm: none',
      contentType: 'ad-promo',
      techniques: ['miracle/health claims', 'urgency'],
      severity: 6,
      model: 'gemini-3.1-flash-lite',
      imageCount: 2,
      description: 'You NEED to see this',
    },
    surfaceOrigin: 'https://www.tiktok.com',
    decision: {
      judge: { id: 'judge-v1', hash: '4f32b70b07b7', model: 'openai/gpt-oss-120b', provider: 'groq' },
      reading: { charged: true, family: 'hostile', severity: 6, effect: 'recruit', intent: 'react' },
      descriptor: null,
      rails: [],
      household: { mode: 'teen', reader: 'default', topicRule: null, mask: false },
      row: 'J7',
      action: 'mark',
      applied: 'mark',
      rewrite: null,
      note: null,
    },
    reader: 'default',
    textCapture: 'cut',
    mediaUrls: ['https://p16-sign.tiktokcdn.com/obj/one.jpeg', 'https://v16.tiktokcdn.com/two.mp4'],
    stamp: { recorderBuildId: 'fwbid-0e6a9d81aaaa-r2517', installType: 'normal', evidenceKind: 'screen+wire' },
    provenance: {
      platformIds: { post: '7300000000000000001', author: '6800000000000000002' },
      raw: { hash: 'ef'.repeat(32), length: 51234, endpoint: '/api/recommend/item_list/' },
    },
  };
}

function evalInlineCanonicalPayload(): (r: unknown) => string {
  // The verifier source is a `function canonicalPayload(r){...}` declaration.
  // Wrap it in an IIFE that returns the function so we can call it from the
  // test environment with the same semantics as the embedded HTML verifier.
  const factory = new Function(
    `${VERIFIER_CANONICAL_PAYLOAD_FN_SOURCE}; return canonicalPayload;`,
  );
  return factory() as (r: unknown) => string;
}

describe('html-verifier — canonical-payload drift prevention', () => {
  it('inline verifier hash matches production hasher on a fully-populated record', async () => {
    const record = fullyPopulatedRecord();
    const productionHash = await computeRecordIntegrityHash(record);
    const inlineCanonicalPayload = evalInlineCanonicalPayload();
    const inlineJson = inlineCanonicalPayload(record);
    const inlineHash = await sha256(inlineJson);
    expect(inlineHash).toBe(productionHash);
  });

  it('inline verifier hash matches production hasher on a legacy pre-§CT-12 record (no tree fields)', async () => {
    const record = fullyPopulatedRecord();
    record.topic = undefined;
    record.sourceCategory = undefined;
    record.parentRecordId = undefined;
    record.commentDepth = undefined;
    record.roomAuthor = undefined;
    record.roomCaption = undefined;
    record.roomUrl = undefined;
    const productionHash = await computeRecordIntegrityHash(record);
    const inlineCanonicalPayload = evalInlineCanonicalPayload();
    const inlineJson = inlineCanonicalPayload(record);
    const inlineHash = await sha256(inlineJson);
    expect(inlineHash).toBe(productionHash);
  });

  it('inline verifier hash matches production hasher on a reset-marker record', async () => {
    const record = fullyPopulatedRecord();
    record.kind = 'reset-marker';
    record.priorChainHash = 'h-prior-chain-xyz';
    record.resetReason = 'user-initiated';
    record.parentRecordId = undefined;
    record.commentDepth = undefined;
    record.roomAuthor = undefined;
    record.roomCaption = undefined;
    record.roomUrl = undefined;
    const productionHash = await computeRecordIntegrityHash(record);
    const inlineCanonicalPayload = evalInlineCanonicalPayload();
    const inlineJson = inlineCanonicalPayload(record);
    const inlineHash = await sha256(inlineJson);
    expect(inlineHash).toBe(productionHash);
  });

  it('inline verifier hash matches production hasher on a legacy pre-2026-05-24 record (no harmFloor/failureKind/cap)', async () => {
    // Back-compat for the audit-driven 2026-05-24 canonical-payload
    // extension. Pre-fix the three fields were stamped on records but
    // outside the signature; closing the gap appended them at the
    // bottom of the payload object with omit-when-undefined semantics.
    // Legacy records that never carried these fields must continue to
    // verify byte-identically.
    const record = fullyPopulatedRecord();
    record.harmFloor = undefined;
    record.failureKind = undefined;
    record.cap = undefined;
    const productionHash = await computeRecordIntegrityHash(record);
    const inlineCanonicalPayload = evalInlineCanonicalPayload();
    const inlineJson = inlineCanonicalPayload(record);
    const inlineHash = await sha256(inlineJson);
    expect(inlineHash).toBe(productionHash);
  });

  it('inline verifier hash matches production hasher on a cancelled-record (failureKind + cap defined, harmFloor undefined)', async () => {
    const record = fullyPopulatedRecord();
    record.harmFloor = undefined;
    record.failureKind = 'auth-refusal';
    record.cap = 'daily';
    const productionHash = await computeRecordIntegrityHash(record);
    const inlineCanonicalPayload = evalInlineCanonicalPayload();
    const inlineJson = inlineCanonicalPayload(record);
    const inlineHash = await sha256(inlineJson);
    expect(inlineHash).toBe(productionHash);
  });

  it('inline verifier hash matches production hasher on a legacy record with no metrics (omit parity)', async () => {
    // Metrics were added to the canonical payload in the forensic-export
    // redesign step 2. Legacy + metric-less records (metrics === undefined)
    // must hash byte-identically — both the production hasher and the inline
    // verifier omit the undefined key from JSON.stringify.
    const record = fullyPopulatedRecord();
    record.metrics = undefined;
    const productionHash = await computeRecordIntegrityHash(record);
    const inlineCanonicalPayload = evalInlineCanonicalPayload();
    const inlineJson = inlineCanonicalPayload(record);
    const inlineHash = await sha256(inlineJson);
    expect(inlineHash).toBe(productionHash);
  });

  it('inline verifier hash matches production hasher on a legacy record with no source labels (accountType/sourceContainer undefined)', async () => {
    // Source labels (accountType + sourceContainer) appended at the bottom of
    // the canonical payload 2026-06-23 with omit-when-undefined semantics.
    // Legacy + person records (no provable type) carry both undefined and must
    // hash byte-identically against pre-feature records.
    const record = fullyPopulatedRecord();
    record.accountType = undefined;
    record.sourceContainer = undefined;
    const productionHash = await computeRecordIntegrityHash(record);
    const inlineCanonicalPayload = evalInlineCanonicalPayload();
    const inlineJson = inlineCanonicalPayload(record);
    const inlineHash = await sha256(inlineJson);
    expect(inlineHash).toBe(productionHash);
  });

  it('inline verifier hash matches production hasher on a legacy record with no impression order (observedSequence/viewportSeenAt/surfaceSessionId undefined)', async () => {
    // Impression-order fields appended at the bottom of the canonical payload
    // 2026-06-25 with omit-when-undefined semantics (IMPRESSION_LAYER_V1.md).
    // Legacy records + records where capture didn't fire carry all three
    // undefined and must hash byte-identically against pre-feature records.
    const record = fullyPopulatedRecord();
    record.observedSequence = undefined;
    record.viewportSeenAt = undefined;
    record.surfaceSessionId = undefined;
    const productionHash = await computeRecordIntegrityHash(record);
    const inlineCanonicalPayload = evalInlineCanonicalPayload();
    const inlineJson = inlineCanonicalPayload(record);
    const inlineHash = await sha256(inlineJson);
    expect(inlineHash).toBe(productionHash);
  });

  it('inline verifier hash matches production hasher on a legacy record with no imageContext (omit parity)', async () => {
    // imageContext appended at the bottom of the canonical payload with
    // omit-when-undefined semantics (I1 image understanding). Legacy +
    // image-less records (imageContext === undefined) must hash
    // byte-identically — both the production hasher and the inline verifier
    // omit the undefined key from JSON.stringify.
    const record = fullyPopulatedRecord();
    record.imageContext = undefined;
    const productionHash = await computeRecordIntegrityHash(record);
    const inlineCanonicalPayload = evalInlineCanonicalPayload();
    const inlineJson = inlineCanonicalPayload(record);
    const inlineHash = await sha256(inlineJson);
    expect(inlineHash).toBe(productionHash);
  });

  it('changing any non-hash field (integrityHash / signature / chainAnchor) does not affect the inline payload', async () => {
    const record = fullyPopulatedRecord();
    const inlineCanonicalPayload = evalInlineCanonicalPayload();
    const baseline = inlineCanonicalPayload(record);
    const withExtras = inlineCanonicalPayload({
      ...record,
      integrityHash: 'arbitrary',
      signature: 'arbitrary',
      chainAnchor: 'pre-chain',
    });
    expect(withExtras).toBe(baseline);
  });
});

// The key lists, read out of the two sources as text.
//
// verifier-format-doc.test.ts already does this against FORMAT.md, so the
// technique is a house one; it was simply never pointed at the join that
// matters most. Both sides are ordinary object literals, `key: expr` in
// production and `key:expr` in the template, so the keys can be lifted without
// parsing the expressions.
function payloadKeysOf(source: string, open: string): string[] {
  const start = source.indexOf(open);
  expect(start, `found the payload literal after ${open}`).toBeGreaterThan(-1);
  const body = source.slice(start + open.length);
  // Stop at the close of the object literal: the first line whose first
  // non-space character is `}`. Nested objects inside the literal are indented.
  const lines = body.split('\n');
  const keys: string[] = [];
  let depth = 0;
  for (const raw of lines) {
    // Comments carry English prose with colons in it ("Appended under the same
    // contract: ..."), which reads as a key. Neither literal contains a string
    // with a slash in it, so dropping from the first // is safe here.
    const line = raw.replace(/\/\/.*$/, '');
    const trimmed = line.trim();
    if (depth === 0 && trimmed.startsWith('}')) break;
    // Every `name:` at this nesting level, in order, ignoring anything that
    // follows inside a nested literal on the same line.
    for (const m of line.matchAll(/(?:^|[{,\s])([A-Za-z_$][A-Za-z0-9_$]*)\s*:/g)) {
      if (depth === 0) keys.push(m[1]);
    }
    depth += (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length;
  }
  return keys;
}

describe('the two canonical payloads carry the same fields, in the same order', () => {
  it('is checked against the sources and not against a fixture', () => {
    const production = readFileSync(
      join(REPO_ROOT, 'src', 'forensics', 'canonical-payload.ts'), 'utf8');
    const inline = VERIFIER_CANONICAL_PAYLOAD_FN_SOURCE;

    const prodKeys = payloadKeysOf(production, 'const payload = JSON.stringify({');
    const inlineKeys = payloadKeysOf(inline, 'return JSON.stringify({');

    // A guard that found nothing because it looked at nothing is worthless, so
    // the extractors have to have found something first.
    expect(prodKeys.length, 'the production key list was extracted').toBeGreaterThan(20);
    expect(inlineKeys.length, 'the inline key list was extracted').toBeGreaterThan(20);

    expect(inlineKeys, 'the inline verifier hashes the same fields in the same order').toEqual(prodKeys);
  });

  // The three fields whose absence from the old fixture is the reason this file
  // exists in its present form. Named so that a future reader who deletes one
  // from either side sees why it was singled out.
  it('carries the three fields the fixture-only guard could not see', () => {
    const production = readFileSync(
      join(REPO_ROOT, 'src', 'forensics', 'canonical-payload.ts'), 'utf8');
    const prodKeys = payloadKeysOf(production, 'const payload = JSON.stringify({');
    const inlineKeys = payloadKeysOf(VERIFIER_CANONICAL_PAYLOAD_FN_SOURCE, 'return JSON.stringify({');
    for (const field of ['buildId', 'verdictOrigin', 'authorCapture']) {
      expect(prodKeys, `production hashes ${field}`).toContain(field);
      expect(inlineKeys, `the recipient's checker hashes ${field}`).toContain(field);
    }
  });
});
