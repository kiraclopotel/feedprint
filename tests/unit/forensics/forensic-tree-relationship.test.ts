// §CT-12 (2026-05-04 Phase A) — forensic chain tree-relationship + room-context schema.
//
// Validates that:
//   1. Adding the new optional fields preserves byte-identical canonical-
//      payload hashes for pre-§CT-12 records (chain integrity preserved).
//   2. New records that DO populate the fields produce a different, stable
//      hash (tamper-evidence on the new fields).
//   3. truncateRoomCaption helper bounds room caption to 200 chars with
//      U+2026 ellipsis suffix.
//
// Phase A scope: schema only. Phase B (next turn) adds per-platform reply
// detection + dashboard tree-view rendering and will exercise full
// integration paths.

import { describe, it, expect } from 'vitest';
import { computeRecordIntegrityHash } from '../../../src/forensics/canonical-payload';
import { truncateRoomCaption } from '../../../src/content/record/post-url';
import type { ForensicRecord } from '../../../src/types/forensic';

function baseRecord(): Omit<ForensicRecord, 'integrityHash' | 'signature' | 'chainAnchor'> {
  return {
    id: 'fr-test-1',
    timestamp: '2026-05-04T20:00:00.000Z',
    platform: 'tiktok',
    originalText: 'comment text',
    originalHash: 'abc123',
    originalLength: 12,
    neutralizedText: '',
    author: 'commenter',
    postUrl: 'https://www.tiktok.com/@creator/video/12345',
    techniques: [],
    overallScore: 0.5,
    userAgeCategory: 'teen',
    aiSource: 'cloud',
    feedSource: 'video',
    detectionMode: 'comment-batch:negative',
    prevRecordHash: 'prev-hash-789',
    chainPosition: 5,
    verdict: 'flagged',
    kind: 'comment',
    parentVideoId: 'tk-vid-12345',
  };
}

describe('§CT-12 Phase A — canonical-payload back-compat with new fields', () => {
  it('produces byte-identical hash when new fields are undefined (legacy record back-compat)', async () => {
    const legacy = baseRecord();
    const hashLegacy = await computeRecordIntegrityHash(legacy);

    // Same record, but with the §CT-12 fields explicitly set to undefined.
    // Should hash IDENTICALLY (canonical-payload omits undefined keys).
    const explicitUndefined = {
      ...legacy,
      parentRecordId: undefined,
      commentDepth: undefined,
      roomAuthor: undefined,
      roomCaption: undefined,
      roomUrl: undefined,
    };
    const hashExplicit = await computeRecordIntegrityHash(explicitUndefined);

    expect(hashExplicit).toBe(hashLegacy);
  });

  it('produces a DIFFERENT hash when room context fields are populated (tamper-evidence on new fields)', async () => {
    const legacy = baseRecord();
    const hashLegacy = await computeRecordIntegrityHash(legacy);

    const enriched = {
      ...legacy,
      roomAuthor: 'creator',
      roomCaption: 'Original video caption text',
      roomUrl: 'https://www.tiktok.com/@creator/video/12345',
    };
    const hashEnriched = await computeRecordIntegrityHash(enriched);

    // The hashes MUST differ — that's how chain-integrity walks detect
    // someone after-the-fact stamping a roomAuthor on a legacy record.
    expect(hashEnriched).not.toBe(hashLegacy);
  });

  it('hashes are stable across runs (deterministic for same input)', async () => {
    const enriched = {
      ...baseRecord(),
      roomAuthor: 'creator',
      roomCaption: 'caption',
      commentDepth: 0,
    };
    const h1 = await computeRecordIntegrityHash(enriched);
    const h2 = await computeRecordIntegrityHash(enriched);
    expect(h1).toBe(h2);
  });

  it('different commentDepth values produce different hashes (depth is part of canonical payload)', async () => {
    const top = { ...baseRecord(), commentDepth: 0 };
    const reply = { ...baseRecord(), commentDepth: 1 };
    const replyToReply = { ...baseRecord(), commentDepth: 2 };

    const h0 = await computeRecordIntegrityHash(top);
    const h1 = await computeRecordIntegrityHash(reply);
    const h2 = await computeRecordIntegrityHash(replyToReply);

    expect(h0).not.toBe(h1);
    expect(h1).not.toBe(h2);
    expect(h0).not.toBe(h2);
  });

  it('different roomAuthor values produce different hashes', async () => {
    const a = { ...baseRecord(), roomAuthor: 'alice' };
    const b = { ...baseRecord(), roomAuthor: 'bob' };
    const ha = await computeRecordIntegrityHash(a);
    const hb = await computeRecordIntegrityHash(b);
    expect(ha).not.toBe(hb);
  });

  it('parentRecordId is part of canonical payload (Phase B will populate; hash discriminates today)', async () => {
    const orphan = baseRecord();
    const linked = { ...baseRecord(), parentRecordId: 'fr-parent-99' };
    const ho = await computeRecordIntegrityHash(orphan);
    const hl = await computeRecordIntegrityHash(linked);
    expect(ho).not.toBe(hl);
  });
});

describe('anchorUrl — canonical-payload back-compat + tamper-evidence', () => {
  it('produces byte-identical hash when anchorUrl is undefined (legacy back-compat)', async () => {
    const legacy = baseRecord();
    const hashLegacy = await computeRecordIntegrityHash(legacy);
    const explicitUndefined = { ...legacy, anchorUrl: undefined };
    const hashExplicit = await computeRecordIntegrityHash(explicitUndefined);
    expect(hashExplicit).toBe(hashLegacy);
  });

  it('produces a DIFFERENT hash when anchorUrl is populated (tamper-evidence)', async () => {
    const legacy = baseRecord();
    const hashLegacy = await computeRecordIntegrityHash(legacy);
    const anchored = {
      ...legacy,
      anchorUrl: 'https://x.com/synthetic_child_a/status/3001',
    };
    const hashAnchored = await computeRecordIntegrityHash(anchored);
    expect(hashAnchored).not.toBe(hashLegacy);
  });

  it('different anchorUrl values produce different hashes', async () => {
    const a = { ...baseRecord(), anchorUrl: 'https://x.com/a/status/1' };
    const b = { ...baseRecord(), anchorUrl: 'https://x.com/b/status/2' };
    const ha = await computeRecordIntegrityHash(a);
    const hb = await computeRecordIntegrityHash(b);
    expect(ha).not.toBe(hb);
  });

  it('anchorUrl hash is deterministic across runs', async () => {
    const anchored = { ...baseRecord(), anchorUrl: 'https://x.com/a/status/1' };
    const h1 = await computeRecordIntegrityHash(anchored);
    const h2 = await computeRecordIntegrityHash(anchored);
    expect(h1).toBe(h2);
  });
});

describe('§CT-12 Phase A — kind union expansion', () => {
  it('accepts kind="reply" without breaking canonical payload', async () => {
    const replyRecord = { ...baseRecord(), kind: 'reply' as const };
    const hash = await computeRecordIntegrityHash(replyRecord);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('reply and comment kinds produce different hashes (kind discriminates)', async () => {
    const asComment = { ...baseRecord(), kind: 'comment' as const };
    const asReply = { ...baseRecord(), kind: 'reply' as const };
    const hc = await computeRecordIntegrityHash(asComment);
    const hr = await computeRecordIntegrityHash(asReply);
    expect(hc).not.toBe(hr);
  });
});

describe('§CT-12 Phase A — truncateRoomCaption helper', () => {
  it('returns empty string for undefined / null / empty caption', () => {
    expect(truncateRoomCaption(undefined)).toBe('');
    expect(truncateRoomCaption(null)).toBe('');
    expect(truncateRoomCaption('')).toBe('');
    expect(truncateRoomCaption('   ')).toBe('');
  });

  it('returns the trimmed caption verbatim when under 200 chars', () => {
    const short = 'A short caption.';
    expect(truncateRoomCaption(short)).toBe('A short caption.');
  });

  it('returns trimmed caption when length is exactly 200', () => {
    const exact200 = 'a'.repeat(200);
    const result = truncateRoomCaption(exact200);
    expect(result).toBe(exact200);
    expect(result.length).toBe(200);
  });

  it('truncates captions over 200 chars and appends ellipsis', () => {
    const long = 'a'.repeat(250);
    const result = truncateRoomCaption(long);
    expect(result.length).toBe(200);
    expect(result.endsWith('…')).toBe(true);
    expect(result).toBe('a'.repeat(199) + '…');
  });

  it('preserves leading/trailing whitespace trim', () => {
    expect(truncateRoomCaption('  hello  ')).toBe('hello');
  });

  it('handles unicode-rich captions correctly (codeunit-based truncation)', () => {
    // 250 RO accented chars — emoji edge case is V1.5 polish.
    const ro = 'ăâîșț'.repeat(50); // 250 chars
    const result = truncateRoomCaption(ro);
    expect(result.length).toBe(200);
    expect(result.endsWith('…')).toBe(true);
  });
});
