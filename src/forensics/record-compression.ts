// FeelingWise — forensic record compression at the IDB storage layer.
//
// Wraps a ForensicRecord in an envelope whose top-level keypaths match the
// existing IDB indexes (id, timestamp, platform, chainPosition), with the
// full record JSON gzipped into `payload`. Reduces per-record IDB footprint
// by 40-60% on text-heavy records.
//
// Chain-integrity contract preserved per VISION §1.1:
//   • `computeRecordIntegrityHash` (canonical-payload.ts) runs over
//     ForensicRecord fields BEFORE compression and AFTER decompression —
//     the hash is over the fields, not the storage bytes. Signature
//     verification works identically before and after this change.
//   • The envelope's top-level index fields duplicate values that are also
//     inside the compressed payload. Both copies must agree on read. The
//     envelope copy is what IDB indexes see; the decompressed copy is what
//     hash/signature verification sees. A mismatch (introduced by tampering
//     with the envelope but not the payload) would be detected on the next
//     hash recompute — the record's stored hash was computed over the
//     payload fields.
//
// CompressionStream is available in Chrome MV3 service workers (Chrome 80+)
// and Node 18+. Defensive passthrough below for any context where it's not.

import type { ForensicRecord } from '../types/forensic';

export interface CompressedRecordEnvelope {
  /** Discriminator — distinguishes envelopes from raw legacy records on read. */
  __compressed: true;
  /** Lifted to envelope top so IDB index keypath 'id' resolves on the envelope. */
  id: string;
  /** Lifted for the 'timestamp' index. */
  timestamp: string;
  /** Lifted for the 'platform' index. */
  platform: ForensicRecord['platform'];
  /** Lifted for the 'chainPosition' index (added in DB v2). Undefined on pre-chain records. */
  chainPosition?: number;
  /**
   * Lifted so index-walks (getChainState, resetForensicChain's terminal
   * lookup) can skip relegated (pre-rekey) records WITHOUT decompressing —
   * relegated records keep their original chainPosition (it is canonical-
   * hashed content) and therefore appear in the chainPosition index.
   * Envelopes written before this field existed cannot be pre-rekey with a
   * position (the old relegation stripped chainPosition, excluding them
   * from the index), so a missing value safely reads as "active".
   */
  chainAnchor?: ForensicRecord['chainAnchor'];
  /** Gzipped JSON.stringify(record). */
  payload: Uint8Array;
  /**
   * Size of the JSON.stringify(record) UTF-8 bytes before compression. Used by
   * the batched read path (unwrapStoredEntries) to split the single
   * concatenated-gzip decode back into per-record JSON, with a sum-vs-decoded
   * length guard, so this must stay exact for envelopes that join the batch.
   */
  uncompressedSize: number;
}

export function isCompressedEnvelope(v: unknown): v is CompressedRecordEnvelope {
  return (
    typeof v === 'object' &&
    v !== null &&
    (v as { __compressed?: unknown }).__compressed === true &&
    (v as { payload?: unknown }).payload instanceof Uint8Array
  );
}

export async function compressRecord(record: ForensicRecord): Promise<CompressedRecordEnvelope> {
  const json = JSON.stringify(record);
  const bytes = new TextEncoder().encode(json);
  const payload = await gzipBytes(bytes);
  return {
    __compressed: true,
    id: record.id,
    timestamp: record.timestamp,
    platform: record.platform,
    chainPosition: record.chainPosition,
    chainAnchor: record.chainAnchor,
    payload,
    uncompressedSize: bytes.byteLength,
  };
}

export async function decompressRecord(envelope: CompressedRecordEnvelope): Promise<ForensicRecord> {
  const bytes = await gunzipBytes(envelope.payload);
  const json = new TextDecoder().decode(bytes);
  return JSON.parse(json) as ForensicRecord;
}

/**
 * The id, position and timestamp a stored row carries outside its payload, read
 * without decoding it. A row whose payload will not decode can still be filed,
 * matched and named by these, which is what lets upkeep carry it forward as the
 * bytes it was stored as instead of stopping on it.
 */
export function storedEntryIndexFields(entry: unknown): { id?: string; chainPosition?: number; timestamp?: string } {
  const loose = entry as { id?: unknown; chainPosition?: unknown; timestamp?: unknown } | null;
  const out: { id?: string; chainPosition?: number; timestamp?: string } = {};
  if (!loose || typeof loose !== 'object') return out;
  if (typeof loose.id === 'string') out.id = loose.id;
  if (typeof loose.chainPosition === 'number') out.chainPosition = loose.chainPosition;
  if (typeof loose.timestamp === 'string') out.timestamp = loose.timestamp;
  return out;
}

/** Two stored rows are the same bytes: the same envelope fields and the same compressed payload. */
export function sameStoredBytes(a: unknown, b: unknown): boolean {
  if (!isCompressedEnvelope(a) || !isCompressedEnvelope(b)) return false;
  if (a.id !== b.id || a.timestamp !== b.timestamp || a.chainPosition !== b.chainPosition) return false;
  if (a.uncompressedSize !== b.uncompressedSize || a.payload.byteLength !== b.payload.byteLength) return false;
  for (let i = 0; i < a.payload.byteLength; i++) if (a.payload[i] !== b.payload[i]) return false;
  return true;
}

/**
 * Unwrap either an envelope (decompress) or a raw legacy record (pass through).
 * The dual-shape read path in `store.ts` calls this on every cursor / getAll
 * result so callers always see a plain ForensicRecord.
 */
export async function unwrapStoredEntry(entry: unknown): Promise<ForensicRecord> {
  if (isCompressedEnvelope(entry)) {
    return decompressRecord(entry);
  }
  // Raw legacy record — written before this module shipped. IDB returns it
  // by structured clone; the shape matches ForensicRecord since no
  // intermediate envelope was used at write time.
  return entry as ForensicRecord;
}

/**
 * Unwrap the whole-chain read path (getRecords): decode each stored entry,
 * gzip envelopes per-record, raw/legacy/passthrough entries individually.
 *
 * History: a "concatenate every gzip member into ONE DecompressionStream" fast
 * path lived here, on the premise that gzip multi-member concatenation decodes
 * in one pass. It does in Node — but Chrome's `DecompressionStream('gzip')`
 * REJECTS a multi-member stream ("TypeError: Failed to fetch"), so with ≥2
 * records the batch ALWAYS threw in the extension and fell back to per-record
 * anyway, logging a warning on every dashboard load (found 2026-06-22). Measured
 * in real Chrome: per-record decode of 10k records ≈ 0.5s, and a parallel
 * variant was no faster (stream-setup overhead dominates). So the batch was pure
 * overhead + noise in the only runtime that matters — removed. Decompress is not
 * the dashboard's scale bottleneck (the non-virtualized feed is).
 */
export async function unwrapStoredEntries(entries: unknown[]): Promise<ForensicRecord[]> {
  const out = new Array<ForensicRecord>(entries.length);
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (
      typeof DecompressionStream !== 'undefined' &&
      isCompressedEnvelope(e) &&
      Number.isFinite(e.uncompressedSize) &&
      e.payload.byteLength >= 2 && e.payload[0] === 0x1f && e.payload[1] === 0x8b
    ) {
      out[i] = await decompressRecord(e);
    } else {
      // Raw legacy record, passthrough payload, or no DecompressionStream.
      out[i] = await unwrapStoredEntry(e);
    }
  }
  return out;
}

async function gzipBytes(input: Uint8Array): Promise<Uint8Array> {
  if (typeof CompressionStream === 'undefined') {
    // Passthrough — record still round-trips, just without size win.
    return input;
  }
  // Cast around a Node-vs-DOM lib-type mismatch: the lib types declare the
  // ReadableStream chunk as Uint8Array<ArrayBufferLike> while CompressionStream's
  // writable expects BufferSource. The runtime behavior is identical.
  const source = new ReadableStream({
    start(controller) {
      controller.enqueue(input);
      controller.close();
    },
  });
  const stream = (source as ReadableStream<BufferSource>).pipeThrough(new CompressionStream('gzip'));
  const buf = await new Response(stream as unknown as ReadableStream).arrayBuffer();
  return new Uint8Array(buf);
}

async function gunzipBytes(input: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    return input;
  }
  // Detect passthrough envelopes (would have been written when
  // CompressionStream was unavailable). Real gzip begins with magic bytes
  // 0x1f 0x8b — anything else is treated as raw JSON bytes.
  if (input.byteLength < 2 || input[0] !== 0x1f || input[1] !== 0x8b) {
    return input;
  }
  const source = new ReadableStream({
    start(controller) {
      controller.enqueue(input);
      controller.close();
    },
  });
  const stream = (source as ReadableStream<BufferSource>).pipeThrough(new DecompressionStream('gzip'));
  const buf = await new Response(stream as unknown as ReadableStream).arrayBuffer();
  return new Uint8Array(buf);
}
