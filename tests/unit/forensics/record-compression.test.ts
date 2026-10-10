// FeelingWise — forensic record compression round-trip.
//
// Locks the contract for src/forensics/record-compression.ts:
//   • compressRecord → decompressRecord is lossless (deep-equal).
//   • Envelope exposes the IDB index keypaths at top level so existing
//     indexes (timestamp / platform / chainPosition) keep working.
//   • Envelope carries the `__compressed: true` discriminator so the
//     read-side can distinguish envelopes from raw legacy records.
//   • Mixed-shape unwrap: unwrapStoredEntry returns a raw record passed
//     through (back-compat for records written before this module shipped).
//   • Compression actually reduces size on a realistic text payload (the
//     point of the feature; assertion is loose — >= some win).

import { describe, it, expect } from 'vitest';
import {
  compressRecord,
  decompressRecord,
  isCompressedEnvelope,
  unwrapStoredEntry,
  unwrapStoredEntries,
} from '../../../src/forensics/record-compression';
import type { ForensicRecord } from '../../../src/types/forensic';

function makeRecord(overrides: Partial<ForensicRecord> = {}): ForensicRecord {
  return {
    id: 'fr-test-1',
    timestamp: '2026-05-21T22:30:00.000Z',
    platform: 'twitter',
    originalText: 'You are absolutely disgusting and everyone hates you',
    originalHash: 'a'.repeat(64),
    originalLength: 53,
    neutralizedText: "I disagree with what you're doing",
    author: 'synthetic_author',
    postUrl: 'https://twitter.com/synthetic_author/status/123',
    techniques: [
      { name: 'shame-attack', severity: 7, confidence: 0.9 },
      { name: 'scapegoating', severity: 5, confidence: 0.7 },
    ],
    overallScore: 7,
    userAgeCategory: 'teen',
    aiSource: 'cloud',
    feedSource: 'unknown',
    aiModel: 'llama-3.1-8b-instant',
    aiProvider: 'groq',
    detectionMode: 'combined',
    integrityHash: 'b'.repeat(64),
    signature: 'sig-' + 'c'.repeat(86),
    publicKeyFingerprint: 'd'.repeat(16),
    prevRecordHash: 'feelingwise-chain-genesis-v1',
    chainPosition: 0,
    chainAnchor: 'genesis-v1',
    verdict: 'flagged',
    kind: 'post',
    roomAuthor: 'synthetic_author',
    roomCaption: 'Some long room caption text repeated across many comments',
    roomUrl: 'https://twitter.com/synthetic_author/status/123',
    ...overrides,
  };
}

describe('record-compression', () => {
  it('round-trips a record losslessly (compress → decompress = deep-equal)', async () => {
    const record = makeRecord();
    const envelope = await compressRecord(record);
    const restored = await decompressRecord(envelope);
    expect(restored).toEqual(record);
  });

  it('envelope carries the __compressed discriminator', async () => {
    const envelope = await compressRecord(makeRecord());
    expect(envelope.__compressed).toBe(true);
    expect(isCompressedEnvelope(envelope)).toBe(true);
  });

  it('envelope lifts IDB index keypaths (id / timestamp / platform / chainPosition) to top level', async () => {
    const record = makeRecord({ chainPosition: 42 });
    const envelope = await compressRecord(record);
    expect(envelope.id).toBe(record.id);
    expect(envelope.timestamp).toBe(record.timestamp);
    expect(envelope.platform).toBe(record.platform);
    expect(envelope.chainPosition).toBe(42);
  });

  it('envelope leaves chainPosition undefined for pre-chain records (back-compat)', async () => {
    const record = makeRecord({ chainPosition: undefined, chainAnchor: 'pre-chain' });
    const envelope = await compressRecord(record);
    expect(envelope.chainPosition).toBeUndefined();
  });

  it('uncompressedSize reflects the JSON byte length', async () => {
    const record = makeRecord();
    const envelope = await compressRecord(record);
    const expected = new TextEncoder().encode(JSON.stringify(record)).byteLength;
    expect(envelope.uncompressedSize).toBe(expected);
  });

  it('payload is a Uint8Array', async () => {
    const envelope = await compressRecord(makeRecord());
    expect(envelope.payload).toBeInstanceOf(Uint8Array);
    expect(envelope.payload.byteLength).toBeGreaterThan(0);
  });

  it('compression reduces size on realistic text payloads (sanity check)', async () => {
    // Build a record with intentionally compressible text so the assertion
    // doesn't depend on platform-specific gzip behavior. Real production
    // records typically see 40-60% reduction; we assert ≥10% for safety.
    const record = makeRecord({
      originalText: 'You are absolutely disgusting '.repeat(50),
      neutralizedText: "I disagree with what you're doing ".repeat(50),
      roomCaption: 'Some long room caption text '.repeat(30),
    });
    const envelope = await compressRecord(record);
    expect(envelope.payload.byteLength).toBeLessThan(envelope.uncompressedSize * 0.9);
  });

  it('isCompressedEnvelope returns false for raw ForensicRecord', () => {
    const raw = makeRecord();
    expect(isCompressedEnvelope(raw)).toBe(false);
  });

  it('isCompressedEnvelope returns false for nullish / non-object', () => {
    expect(isCompressedEnvelope(null)).toBe(false);
    expect(isCompressedEnvelope(undefined)).toBe(false);
    expect(isCompressedEnvelope('string')).toBe(false);
    expect(isCompressedEnvelope(42)).toBe(false);
  });

  it('isCompressedEnvelope rejects objects missing the payload Uint8Array', () => {
    // Defensive: an attacker who flips __compressed on a raw record would
    // fail the payload-shape check and avoid spurious decompression attempts.
    const fake = { __compressed: true as const, id: 'x', timestamp: '', platform: 'twitter' as const, payload: 'not-bytes', uncompressedSize: 0 };
    expect(isCompressedEnvelope(fake)).toBe(false);
  });

  it('unwrapStoredEntry passes a raw record through (legacy back-compat)', async () => {
    const raw = makeRecord();
    const unwrapped = await unwrapStoredEntry(raw);
    expect(unwrapped).toEqual(raw);
  });

  it('unwrapStoredEntry decompresses an envelope', async () => {
    const record = makeRecord();
    const envelope = await compressRecord(record);
    const unwrapped = await unwrapStoredEntry(envelope);
    expect(unwrapped).toEqual(record);
  });
});

// Batched whole-chain decompress — one DecompressionStream over the concatenated
// gzip payloads, split back by uncompressedSize. The fast path that fixes the
// dashboard-boot lag; correctness must match per-record decompress exactly.
describe('record-compression — unwrapStoredEntries (batched)', () => {
  it('round-trips a batch losslessly and IN ORDER', async () => {
    const records = Array.from({ length: 50 }, (_, i) =>
      makeRecord({ id: 'fr-' + i, chainPosition: i, originalText: `comment number ${i} ` + 'x'.repeat(i) }),
    );
    const envelopes = await Promise.all(records.map(compressRecord));
    const out = await unwrapStoredEntries(envelopes);
    expect(out).toEqual(records); // deep-equal AND same order
  });

  it('matches per-record decompress exactly', async () => {
    const records = Array.from({ length: 20 }, (_, i) => makeRecord({ id: 'm-' + i, chainPosition: i }));
    const envelopes = await Promise.all(records.map(compressRecord));
    const batched = await unwrapStoredEntries(envelopes);
    const perRecord = await Promise.all(envelopes.map(decompressRecord));
    expect(batched).toEqual(perRecord);
  });

  it('handles a mix of gzip envelopes and raw legacy records, preserving order', async () => {
    const a = makeRecord({ id: 'a', chainPosition: 0 });
    const legacy = makeRecord({ id: 'legacy-raw', chainPosition: 1 }); // stored raw, not an envelope
    const c = makeRecord({ id: 'c', chainPosition: 2 });
    const entries = [await compressRecord(a), legacy, await compressRecord(c)];
    const out = await unwrapStoredEntries(entries);
    expect(out.map((r) => r.id)).toEqual(['a', 'legacy-raw', 'c']);
    expect(out[1]).toEqual(legacy); // raw passed through untouched
  });

  it('falls back to per-record (still correct) when an envelope has a corrupt uncompressedSize', async () => {
    const records = Array.from({ length: 5 }, (_, i) => makeRecord({ id: 'k-' + i, chainPosition: i }));
    const envelopes = await Promise.all(records.map(compressRecord));
    // Corrupt one size so the concatenated split would misalign — the up-front
    // sum-vs-decoded guard must trip and route the whole set to per-record.
    envelopes[2] = { ...envelopes[2], uncompressedSize: envelopes[2].uncompressedSize + 17 };
    const out = await unwrapStoredEntries(envelopes);
    // Records still come back correct (the fallback decompresses each envelope's
    // own payload; uncompressedSize is not used there).
    expect(out.map((r) => r.id)).toEqual(['k-0', 'k-1', 'k-2', 'k-3', 'k-4']);
    expect(out[0]).toEqual(records[0]);
  });

  it('returns [] for an empty chain', async () => {
    expect(await unwrapStoredEntries([])).toEqual([]);
  });
});
