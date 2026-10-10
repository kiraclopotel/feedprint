// The time-stamp call is the one routine outbound request the product makes on
// its own, and landing/privacy.html says exactly what rides on it:
//
//   "What is sent is a 64-character fingerprint of the record chain, and
//    nothing else: no posts, no names, no settings, and the fingerprint cannot
//    be turned back into the records."
//
// Until this file (found 2026-09-18) nothing checked that sentence against the
// bytes. scripts/verify/outbound-sweep.mjs proves no unnamed ADDRESS is in the
// build; it says nothing about the FIELDS on the request that goes to a named
// one. So a field added to buildTimeStampReq next month, or a header added to
// the fetch, would ship against a page that still says "and nothing else".
//
// This drives the real path — requestVerifiedTimestamps over a real chain-head
// integrityHash, with the host permission granted and fetch captured — and
// pins the whole request: every fetch option, every header, and every DER
// element of the TimeStampReq body, decoded and named. Nothing here asserts
// over an opaque blob: the body is re-encoded from its decoded parts and
// compared byte for byte, so an added element fails on both the named list and
// the bytes.
//
// WHAT THE PIN RECORDS, AND WHERE IT DISAGREES WITH THE PAGE
//
// The request carries four DER elements, not one. The fingerprint is there and
// is the only thing in it derived from the reader. The other three are the
// protocol's own: version 1, the SHA-256 algorithm identifier, an 8-byte
// random nonce (RFC 3161 2.4.1, so a replayed token is detectable) and
// certReq TRUE (so the authority embeds its certificate and the export can be
// verified offline). A nonce is still a field and certReq is still a field, so
// "a 64-character fingerprint ... and nothing else" is not true of the request
// as a list of fields; it is true of what the request reveals about the
// person. This test states the list. Changing the sentence is not its job.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ForensicRecord } from '../../../src/types/forensic';
import { computeRecordIntegrityHash } from '../../../src/forensics/canonical-payload';
import { requestVerifiedTimestamps, TSA_ENDPOINTS } from '../../../src/forensics/tsa-client';

// A synthetic key in the documented format `fw-<tier>-<secret>`. No real key or
// secret is read, written or printed by this file.
const TEST_LICENSE_KEY = 'fw-family-testkey0123';

interface CapturedCall {
  url: string;
  init: Record<string, unknown>;
}

let captured: CapturedCall[] = [];
let realFetch: typeof globalThis.fetch;

/**
 * A real chain head, not a placeholder hash: two linked records hashed by the
 * product's own canonical payload, so the 32 bytes on the wire are the bytes a
 * shipped install would send.
 */
async function realChainHeadHash(): Promise<string> {
  const base = (
    position: number,
    prev: string,
  ): Omit<ForensicRecord, 'integrityHash' | 'signature' | 'chainAnchor'> => ({
    id: `fr-anchor-shape-${position}`,
    timestamp: '2026-09-18T08:00:00.000Z',
    platform: 'twitter',
    originalText: 'a post long enough to be eligible for the record',
    originalHash: `h-original-${position}`,
    originalLength: 47,
    neutralizedText: 'a calmer wording of the same post',
    author: '@author',
    postUrl: 'https://x.com/author/status/1',
    techniques: [{ name: 'fear-appeal', severity: 6, confidence: 0.8 }],
    overallScore: 6,
    userAgeCategory: 'teen',
    aiSource: 'cloud',
    feedSource: 'unknown',
    aiModel: 'llama-3.1-8b-instant',
    aiProvider: 'groq',
    detectionMode: 'combined-detect-neutralize',
    configSnapshot: { mode: 'teen', threshold: 0.4, dailyCap: 5000 },
    prevRecordHash: prev,
    chainPosition: position,
    verdict: 'flagged',
  });

  const first = await computeRecordIntegrityHash(base(0, ''));
  return computeRecordIntegrityHash(base(1, first));
}

// ---------------------------------------------------------------------------
// An independent DER reader. Deliberately not imported from src: a check that
// borrows the encoder it is checking can only prove the encoder agrees with
// itself.
// ---------------------------------------------------------------------------

interface Tlv {
  tag: number;
  start: number;
  headerLen: number;
  len: number;
  end: number;
}

function readTlv(b: Uint8Array, off: number): Tlv {
  const tag = b[off];
  let len = b[off + 1];
  let headerLen = 2;
  if ((len & 0x80) !== 0) {
    const n = len & 0x7f;
    len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + b[off + 2 + i];
    headerLen = 2 + n;
  }
  return { tag, start: off, headerLen, len, end: off + headerLen + len };
}

function childrenOf(b: Uint8Array, t: Tlv): Tlv[] {
  const out: Tlv[] = [];
  let o = t.start + t.headerLen;
  while (o < t.end) {
    const c = readTlv(b, o);
    out.push(c);
    o = c.end;
  }
  return out;
}

function contentOf(b: Uint8Array, t: Tlv): Uint8Array {
  return b.subarray(t.start + t.headerLen, t.end);
}

function hex(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, '0');
  return s;
}

function oidOf(b: Uint8Array, t: Tlv): string {
  const v = contentOf(b, t);
  const parts: number[] = [Math.floor(v[0] / 40), v[0] % 40];
  let acc = 0;
  for (let i = 1; i < v.length; i++) {
    acc = acc * 128 + (v[i] & 0x7f);
    if ((v[i] & 0x80) === 0) {
      parts.push(acc);
      acc = 0;
    }
  }
  return parts.join('.');
}

/** A short factual name for an element the expected list does not account for. */
function unknownElement(b: Uint8Array, t: Tlv): string {
  const names: Record<number, string> = {
    0x01: 'BOOLEAN',
    0x02: 'INTEGER',
    0x04: 'OCTET STRING',
    0x05: 'NULL',
    0x06: 'OBJECT IDENTIFIER',
    0x30: 'SEQUENCE',
    0xa0: '[0] context-specific',
  };
  const name = names[t.tag] ?? `tag 0x${t.tag.toString(16).padStart(2, '0')}`;
  const value = t.tag === 0x06 ? oidOf(b, t) : hex(contentOf(b, t));
  return `${name} ${value}`;
}

/**
 * Name every field of the TimeStampReq in the order it appears on the wire.
 * An element the shape does not account for is named, not swallowed, so a
 * failure says which field arrived rather than only that the bytes moved.
 */
function nameFields(body: Uint8Array, expectedHashHex: string): string[] {
  const root = readTlv(body, 0);
  const labels: string[] = [];
  if (root.tag !== 0x30) return [`TimeStampReq is not a SEQUENCE: ${unknownElement(body, root)}`];
  if (root.end !== body.length) {
    labels.push(`trailing bytes after the TimeStampReq: ${hex(body.subarray(root.end))}`);
  }

  const kids = childrenOf(body, root);
  kids.forEach((k, i) => {
    if (i === 0 && k.tag === 0x02) {
      labels.push(`version: INTEGER ${hex(contentOf(body, k))}`);
      return;
    }
    if (i === 1 && k.tag === 0x30) {
      const imprint = childrenOf(body, k);
      imprint.forEach((m, j) => {
        if (j === 0 && m.tag === 0x30) {
          const alg = childrenOf(body, m);
          alg.forEach((a, n) => {
            if (n === 0 && a.tag === 0x06) labels.push(`messageImprint.hashAlgorithm: OID ${oidOf(body, a)}`);
            else if (n === 1 && a.tag === 0x05) labels.push('messageImprint.hashAlgorithm.parameters: NULL');
            else labels.push(`UNEXPECTED in messageImprint.hashAlgorithm at ${n}: ${unknownElement(body, a)}`);
          });
          return;
        }
        if (j === 1 && m.tag === 0x04) {
          const got = hex(contentOf(body, m));
          labels.push(
            got === expectedHashHex
              ? `messageImprint.hashedMessage: OCTET STRING ${m.len} bytes = the chain head fingerprint`
              : `messageImprint.hashedMessage: OCTET STRING ${m.len} bytes = ${got} (NOT the chain head fingerprint)`,
          );
          return;
        }
        labels.push(`UNEXPECTED in messageImprint at ${j}: ${unknownElement(body, m)}`);
      });
      return;
    }
    if (i === 2 && k.tag === 0x02) {
      // DER integers are minimal, so eight random bytes encode as eight only when
      // the top byte is non-zero: about 255 runs in 256. Pinning the exact length
      // made this fail on luck alone roughly one run in 256, and on 2026-09-21 it
      // did, blocking a commit that had nothing to do with time stamps. The bound
      // is what the field actually promises. Randomness itself is still checked,
      // by the caller collecting nonces across calls and requiring them to differ.
      labels.push(k.len >= 1 && k.len <= 8
        ? 'nonce: INTEGER up to 8 random bytes'
        : `nonce: INTEGER ${k.len} bytes, WIDER THAN THE 8 THE CODE ASKS FOR`);
      return;
    }
    if (i === 3 && k.tag === 0x01) {
      labels.push(`certReq: BOOLEAN ${hex(contentOf(body, k)) === 'ff'}`);
      return;
    }
    labels.push(`UNEXPECTED field at position ${i}: ${unknownElement(body, k)}`);
  });
  return labels;
}

// ---------------------------------------------------------------------------

function derLength(n: number): number[] {
  if (n < 0x80) return [n];
  if (n < 0x100) return [0x81, n];
  return [0x82, (n >> 8) & 0xff, n & 0xff];
}

function der(tag: number, body: number[]): number[] {
  return [tag, ...derLength(body.length), ...body];
}

/**
 * Re-encode the request from the four things the product is entitled to send,
 * taking only the nonce from what was observed. Byte equality with the real
 * body is the statement that nothing else is in there: not a padding byte, not
 * a hidden extension, not a second copy of anything.
 */
function reencode(hashHex: string, nonceBytes: Uint8Array): Uint8Array {
  const hashBytes = [...Array(32).keys()].map(i => parseInt(hashHex.slice(i * 2, i * 2 + 2), 16));
  const sha256Oid = [0x06, 0x09, 0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01];
  const imprint = der(0x30, [
    ...der(0x30, [...sha256Oid, 0x05, 0x00]),
    ...der(0x04, hashBytes),
  ]);
  return new Uint8Array(
    der(0x30, [
      0x02, 0x01, 0x01,
      ...imprint,
      ...der(0x02, [...nonceBytes]),
      0x01, 0x01, 0xff,
    ]),
  );
}

function countOccurrences(haystack: Uint8Array, needle: Uint8Array): number {
  let n = 0;
  outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer;
    n++;
  }
  return n;
}

beforeEach(() => {
  captured = [];
  realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init: Record<string, unknown>) => {
    captured.push({ url: String(input), init });
    // 503 stops the client before it parses anything, so the round tries every
    // authority and then the proxy: one run captures every request the product
    // can make on this path.
    return { ok: false, status: 503 } as unknown as Response;
  }) as unknown as typeof globalThis.fetch;

  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: { id: 'test-extension' },
    permissions: { contains: async () => true },
    storage: { local: { get: async () => ({ fw_license_key: TEST_LICENSE_KEY }) } },
  };
});

afterEach(() => {
  globalThis.fetch = realFetch;
  delete (globalThis as unknown as { chrome?: unknown }).chrome;
});

describe('the time-stamp call carries the fingerprint and the protocol, and nothing else', () => {
  it('sends four DER fields, one fetch option set and one header, to every authority', async () => {
    const head = await realChainHeadHash();
    expect(head).toMatch(/^[0-9a-f]{64}$/);

    await requestVerifiedTimestamps(head);

    const direct = captured.filter(c => c.url !== 'https://api.feelingwise.org/v1/tsa');
    expect(direct.map(c => c.url).sort()).toEqual(TSA_ENDPOINTS.map(e => e.url).sort());

    const nonces: string[] = [];
    for (const call of direct) {
      // Every fetch option, named, and the three that say what the BROWSER may
      // add pinned to their values rather than merely allowed. They were absent
      // when this test was first written and were added the same day: without
      // them the authority could also be handed a cookie it set on an earlier
      // visit and a referrer naming the extension, neither of which this code
      // sends and both of which the privacy page's sentence would then be wrong
      // about. A `mode` or `keepalive` added later still arrives as a failure.
      expect(Object.keys(call.init).sort())
        .toEqual(['body', 'cache', 'credentials', 'headers', 'method', 'referrerPolicy', 'signal']);
      expect(call.init.method).toBe('POST');
      expect(call.init.headers).toEqual({ 'Content-Type': 'application/timestamp-query' });
      expect(call.init.credentials).toBe('omit');
      expect(call.init.referrerPolicy).toBe('no-referrer');
      expect(call.init.cache).toBe('no-store');
      expect(call.init.signal).toBeInstanceOf(AbortSignal);

      const body = call.init.body as Uint8Array;
      expect(body).toBeInstanceOf(Uint8Array);

      // The named field list. This is the sentence the privacy page owes: the
      // fingerprint, plus the protocol fields listed at the top of this file.
      expect(nameFields(body, head)).toEqual([
        'version: INTEGER 01',
        'messageImprint.hashAlgorithm: OID 2.16.840.1.101.3.4.2.1',
        'messageImprint.hashAlgorithm.parameters: NULL',
        'messageImprint.hashedMessage: OCTET STRING 32 bytes = the chain head fingerprint',
        'nonce: INTEGER up to 8 random bytes',
        'certReq: BOOLEAN true',
      ]);

      // The fingerprint travels once. A second copy anywhere in the body would
      // be a second place it could be read out of.
      const hashBytes = new Uint8Array(
        [...Array(32).keys()].map(i => parseInt(head.slice(i * 2, i * 2 + 2), 16)),
      );
      expect(countOccurrences(body, hashBytes)).toBe(1);

      // Byte equality against an independently encoded request.
      const root = readTlv(body, 0);
      const nonceTlv = childrenOf(body, root)[2];
      const nonce = contentOf(body, nonceTlv);
      expect(hex(body)).toBe(hex(reencode(head, nonce)));
      nonces.push(hex(nonce));
    }

    // The nonce is the only element that changes between requests, and it
    // changes every time: it is random, not anything about the reader or the
    // chain. Two authorities never see the same one.
    expect(new Set(nonces).size).toBe(nonces.length);
  });

  it('the proxy fallback sends the fingerprint as its whole body, and a bearer beside it', async () => {
    const head = await realChainHeadHash();
    await requestVerifiedTimestamps(head);

    const proxy = captured.filter(c => c.url === 'https://api.feelingwise.org/v1/tsa');
    expect(proxy).toHaveLength(1);
    const init = proxy[0].init;
    expect(Object.keys(init).sort())
      .toEqual(['body', 'cache', 'credentials', 'headers', 'method', 'referrerPolicy', 'signal']);
    expect(init.credentials).toBe('omit');
    expect(init.referrerPolicy).toBe('no-referrer');
    expect(init.cache).toBe('no-store');

    // The body names one field and it is the fingerprint, lowercased.
    const parsed = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(Object.keys(parsed)).toEqual(['hash']);
    expect(parsed.hash).toBe(head.toLowerCase());

    // The headers are the finding. The proxy route authenticates, so the
    // request carries the whole licence key in Authorization, not a
    // fingerprint of it: on this route FeelingWise sees which install asked.
    // Pinned by shape so no key value is ever printed by a failure.
    const headers = init.headers as Record<string, string>;
    expect(Object.keys(headers).sort()).toEqual(['Authorization', 'Content-Type']);
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers.Authorization).toMatch(/^Bearer fw-(free|starter|family|extended|dev)-[a-z0-9]*$/);
  });
});
