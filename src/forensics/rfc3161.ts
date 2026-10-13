// FeelingWise - offline RFC 3161 TimeStampToken verification.
//
// WHY THIS EXISTS
//
// Until this module, a chain anchor was believed, not checked. The extension
// asked the FeelingWise Worker for a timestamp, the Worker asked FreeTSA, and
// the client stored the token bytes plus a `generalizedTime` STRING that the
// Worker had scanned out of them (worker/src/proxy.ts extractGeneralizedTime).
// The dashboard and the HTML export then printed that string as "TSA-claimed
// time". Nothing anywhere re-derived the time from the signed bytes, nothing
// checked that the token was stamped over OUR hash, and nothing checked who
// signed it. The export said as much in a comment: "V1.5 will add offline
// cryptographic verification of the TST bytes."
//
// That gap matters in exactly the place the anchor was supposed to help. The
// anchor's whole job is to answer "how do we know the record is not backdated"
// with something that does not depend on the person holding the computer. An
// unchecked anchor moves that trust to the FeelingWise Worker instead of
// removing it. Once the token is verified on the recipient's machine, the
// Worker is only a courier: it cannot forge a time, cannot stamp a different
// hash, and cannot substitute a different authority without the check failing.
//
// WHAT THIS MODULE PROVES, EXACTLY
//
//   1. The TimeStampResp granted the request (PKIStatus 0 or 1).
//   2. The token's TSTInfo.messageImprint equals the hash we say was anchored.
//   3. The token's signed attributes carry a messageDigest that equals the
//      digest of the TSTInfo bytes, so the signature covers this TSTInfo and
//      not some other one.
//   4. The signature over the signed attributes verifies under the public key
//      of the certificate embedded in the token.
//   5. That certificate carries the critical Extended Key Usage id-kp-
//      timeStamping, which RFC 3161 section 2.3 requires of a TSA.
//   6. The genTime falls inside that certificate's validity window.
//   7. The certificate was issued by an issuer whose own certificate is
//      embedded in the token, and that issuer's signature over it verifies;
//      every issuer up the chain is marked as a certificate authority, allowed
//      to sign certificates, and valid at the genTime.
//   8. Whether that issuer is one of the roots pinned in KNOWN_TSA_ROOTS, by
//      SHA-256 of the root certificate's DER bytes.
//
// WHAT IT DOES NOT PROVE
//
//   - It is not a full X.509 path validation. There is no revocation check
//     (no OCSP, no CRL: the export must open with no network) and no name
//     constraint or policy processing.
//   - When the root is not in KNOWN_TSA_ROOTS the result still reports the
//     root's SHA-256 so a reader can compare it against the authority's own
//     published certificate by hand. That is a check a person completes, not
//     one this code completes.
//   - A timestamp proves the hash existed no later than genTime. It says
//     nothing about what the hash means, and nothing about earlier existence.
//
// The module is dependency-free by design. It parses DER by hand and verifies
// with Web Crypto, because the same source has to run inside a single HTML
// file that opens from file:// with no network and no imports.

// ---------------------------------------------------------------------------
// Request building
// ---------------------------------------------------------------------------
//
// Kept here beside the parser so the request and the checks on the reply share
// one file. Until 2026-09-04 only the Cloudflare Worker built requests
// (worker/src/proxy.ts); the client can now talk to an authority directly,
// which is what removes FeelingWise from the middle of its own evidence.

function derLength(n: number): Uint8Array {
  if (n < 0x80) return new Uint8Array([n]);
  if (n < 0x100) return new Uint8Array([0x81, n]);
  if (n < 0x10000) return new Uint8Array([0x82, (n >> 8) & 0xff, n & 0xff]);
  throw new Error('der: length too large');
}

function derPrimitive(tag: number, body: Uint8Array): Uint8Array {
  const lb = derLength(body.length);
  const out = new Uint8Array(1 + lb.length + body.length);
  out[0] = tag;
  out.set(lb, 1);
  out.set(body, 1 + lb.length);
  return out;
}

function derSequence(parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const body = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { body.set(p, o); o += p.length; }
  return derPrimitive(0x30, body);
}

/** DER INTEGER from bytes, adding the leading zero DER wants for a high bit. */
function derInteger(bytes: Uint8Array): Uint8Array {
  let i = 0;
  while (i < bytes.length - 1 && bytes[i] === 0) i++;
  const v = bytes.subarray(i);
  const needsPad = v.length > 0 && (v[0] & 0x80) !== 0;
  const body = new Uint8Array(v.length + (needsPad ? 1 : 0));
  body.set(v, needsPad ? 1 : 0);
  return derPrimitive(0x02, body);
}

// Copied into the standalone verifier by scripts/gen-rfc3161-inline.mjs, which reads the exported
// declarations out of this file. knip does not follow a generator.
export function hexToBytes(hex: string): Uint8Array {
  const s = hex.trim().toLowerCase();
  if (!/^[0-9a-f]+$/.test(s) || s.length % 2 !== 0) throw new Error('not hex');
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < s.length; i += 2) out[i / 2] = parseInt(s.slice(i, i + 2), 16);
  return out;
}

export interface TimeStampRequest {
  der: Uint8Array;
  /** Lowercase hex of the nonce, to compare against the one the reply echoes. */
  nonceHex: string;
}

/**
 * Build an RFC 3161 TimeStampReq over a SHA-256 hash.
 *
 *   TimeStampReq ::= SEQUENCE {
 *     version        INTEGER { v1(1) },
 *     messageImprint MessageImprint,
 *     reqPolicy      TSAPolicyId OPTIONAL,
 *     nonce          INTEGER OPTIONAL,
 *     certReq        BOOLEAN DEFAULT FALSE,
 *     extensions [0] IMPLICIT Extensions OPTIONAL }
 *
 * certReq is TRUE because the export has to verify offline: without the
 * authority's certificate travelling inside the token there is nothing on a
 * recipient's machine to check the signature against.
 *
 * The nonce is 8 random bytes. RFC 3161 section 2.4.1 requires the authority to
 * echo it in TSTInfo, so a matching nonce shows the token was minted for this
 * request rather than replayed from an earlier one.
 */
export function buildTimeStampReq(hashHex: string): TimeStampRequest {
  const hash = hexToBytes(hashHex);
  if (hash.length !== 32) throw new Error('expected a SHA-256 hash');
  const nonce = crypto.getRandomValues(new Uint8Array(8));
  // Clear the top bit so the DER INTEGER stays positive without padding, which
  // some authorities handle better than a 9-byte padded nonce.
  nonce[0] &= 0x7f;
  const sha256Oid = new Uint8Array([0x06, 0x09, 0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01]);
  const asn1Null = new Uint8Array([0x05, 0x00]);
  const der = derSequence([
    new Uint8Array([0x02, 0x01, 0x01]),
    derSequence([derSequence([sha256Oid, asn1Null]), derPrimitive(0x04, hash)]),
    derInteger(nonce),
    new Uint8Array([0x01, 0x01, 0xff]),
  ]);
  return { der, nonceHex: toHex(nonce) };
}

/** One named check with its outcome, so a UI can show the reasoning, not a verdict alone. */
interface TsaCheck {
  /** Stable machine name. UI strings are looked up from this, never parsed from `detail`. */
  name:
    | 'response-granted'
    | 'message-imprint'
    | 'signed-attrs-digest'
    | 'signature'
    | 'timestamping-eku'
    | 'genTime-in-cert-validity'
    | 'issuer-signature'
    | 'known-root'
    | 'nonce-echo';
  ok: boolean;
  /** Short factual note. Never a claim beyond what was computed. */
  detail: string;
}

export interface TsaVerification {
  /** True when every check except `known-root` passed. `known-root` is reported, not required. */
  ok: boolean;
  /** ISO-8601 time read out of the SIGNED TSTInfo, not from any sidecar field. Null if unparseable. */
  genTime: string | null;
  /** Lowercase hex of TSTInfo.messageImprint.hashedMessage. */
  messageImprintHex: string | null;
  /** Dotted OID of the imprint's hash algorithm (2.16.840.1.101.3.4.2.1 is SHA-256). */
  messageImprintAlgorithm: string | null;
  /** TSTInfo.serialNumber as lowercase hex, the authority's own reference for this token. */
  serialNumber: string | null;
  /** TSTInfo.policy OID. */
  policyOid: string | null;
  /** The nonce the authority echoed back, lowercase hex, or null when it sent none. */
  nonceHex: string | null;
  /** Human-readable RDN string of the signing certificate's subject. */
  signerSubject: string | null;
  /** SHA-256 of the signing certificate's DER bytes, lowercase hex. */
  signerCertSha256: string | null;
  /** SHA-256 of the issuing certificate's DER bytes when the token carries it. */
  rootCertSha256: string | null;
  /** Name from KNOWN_TSA_ROOTS when `rootCertSha256` matches one, else null. */
  knownRootName: string | null;
  checks: TsaCheck[];
  /** Set when parsing failed outright; `checks` is then empty or partial. */
  error: string | null;
  /**
   * True when the browser could not run the check at all, rather than the
   * token failing it. Web Crypto is unavailable outside a secure context, so
   * an export opened from a data: URL or an http: page has no crypto.subtle.
   * A reader must not be told a good timestamp failed because their browser
   * could not look at it.
   */
  couldNotCheck?: boolean;
}

/**
 * The certificates the authorities in TSA_ENDPOINTS put at the top of the
 * chains they embed, by SHA-256 of their DER bytes. A match lets the verifier
 * say WHICH authority signed, rather than only that the token is
 * self-consistent.
 *
 * CESNET's root stays although the client stopped asking CESNET on 2026-09-23:
 * records made up to Receipts 2.5.14 can carry a CESNET token, and dropping the
 * pin would turn every one of them into an unrecognised authority. A pin is
 * removed only when no record can hold a token under it.
 *
 * A miss is not a failure. The verifier prints the certificate's SHA-256 so a
 * reader can compare it against the certificate that authority publishes. That
 * is a check a person completes; this table only names what we have seen.
 *
 * Recognising a certificate here is not the same as the operating system
 * trusting it, and the wording shown to a reader says "one this page
 * recognises" for that reason. Taken from tokens fetched 2026-09-04; verify any
 * entry with:
 *   openssl dgst -sha256 root.der
 */
export const KNOWN_TSA_ROOTS: Readonly<Record<string, string>> = Object.freeze({
  // O=Free TSA, OU=Root CA, CN=www.freetsa.org. Self-signed, 2016-03-13 to 2041-03-07.
  a6379e7cecc05faa3cbf076013d745e327bbbaa38c0b9af22469d4701d18aabc: 'FreeTSA (freetsa.org) Root CA',
  // DC=cz, O=CESNET CA, CN=CESNET CA Root. Self-signed.
  c0712e7f295d643e9aa6b72686dde19ab68169c22b63a13bf91580d9055262ab: 'CESNET CA Root',
  // C=US, O=DigiCert Inc, CN=DigiCert Trusted Root G4.
  '33846b545a49c9be4903c60e01713c1bd4e4ef31ea65cd95d69e62794f30b941': 'DigiCert Trusted Root G4',
  // C=GB, O=Sectigo Limited, CN=Sectigo Public Time Stamping Root R46.
  b53ac15cc1afb6e2ac06828f555bb3bf5bad8b2bac1733ce4cb7aafe729356de: 'Sectigo Public Time Stamping Root R46',
});

// ---------------------------------------------------------------------------
// DER reader
// ---------------------------------------------------------------------------

interface Tlv {
  tag: number;
  /** Offset of the identifier octet. */
  start: number;
  /** Offset of the first content octet. */
  contentStart: number;
  /** Content length in octets. */
  length: number;
  /** Offset one past the last content octet. */
  end: number;
}

function readTlv(b: Uint8Array, off: number): Tlv {
  if (off + 1 > b.length) throw new Error('der: truncated at tag');
  const tag = b[off];
  let i = off + 1;
  if (i >= b.length) throw new Error('der: truncated at length');
  let len = b[i++];
  if (len & 0x80) {
    const n = len & 0x7f;
    // Indefinite length (n === 0) is BER, not DER, and never valid here.
    if (n === 0 || n > 4) throw new Error('der: unsupported length form');
    if (i + n > b.length) throw new Error('der: truncated length octets');
    len = 0;
    for (let k = 0; k < n; k++) len = len * 256 + b[i++];
  }
  const end = i + len;
  if (end > b.length) throw new Error('der: length exceeds buffer');
  return { tag, start: off, contentStart: i, length: len, end };
}

/** Every direct child of a constructed TLV, in order. */
function children(b: Uint8Array, t: Tlv): Tlv[] {
  const out: Tlv[] = [];
  let o = t.contentStart;
  while (o < t.end) {
    const c = readTlv(b, o);
    out.push(c);
    o = c.end;
  }
  return out;
}

function content(b: Uint8Array, t: Tlv): Uint8Array {
  return b.subarray(t.contentStart, t.end);
}

function bytesOf(b: Uint8Array, t: Tlv): Uint8Array {
  return b.subarray(t.start, t.end);
}

export function toHex(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, '0');
  return s;
}

function readOid(b: Uint8Array, t: Tlv): string {
  const v = content(b, t);
  if (v.length === 0) return '';
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

function readIntegerHex(b: Uint8Array, t: Tlv): string {
  // Strip DER's leading zero sign byte so the hex reads like the serial a TSA prints.
  let v = content(b, t);
  let i = 0;
  while (i < v.length - 1 && v[i] === 0) i++;
  v = v.subarray(i);
  return toHex(v);
}

/**
 * ASN.1 GeneralizedTime to ISO-8601. RFC 3161 requires UTC ("Z") with optional
 * fractional seconds. Anything else is rejected rather than guessed at, because
 * a misread timestamp is worse than an absent one.
 */
function readGeneralizedTime(b: Uint8Array, t: Tlv): string | null {
  const s = new TextDecoder().decode(content(b, t));
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\.\d{1,6})?Z$/.exec(s);
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${m[7] ?? ''}Z`;
}

/** X.509 UTCTime, two-digit year, RFC 5280 sliding window at 50. */
function readUtcTime(b: Uint8Array, t: Tlv): string | null {
  const s = new TextDecoder().decode(content(b, t));
  const m = /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?Z$/.exec(s);
  if (!m) return null;
  const yy = Number(m[1]);
  const year = yy >= 50 ? 1900 + yy : 2000 + yy;
  return `${year}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] ?? '00'}Z`;
}

function readTime(b: Uint8Array, t: Tlv): string | null {
  if (t.tag === 0x17) return readUtcTime(b, t);
  if (t.tag === 0x18) return readGeneralizedTime(b, t);
  return null;
}

// ---------------------------------------------------------------------------
// OIDs
// ---------------------------------------------------------------------------

const OID_SIGNED_DATA = '1.2.840.113549.1.7.2';
const OID_CT_TST_INFO = '1.2.840.113549.1.9.16.1.4';
const OID_ATTR_MESSAGE_DIGEST = '1.2.840.113549.1.9.4';
const OID_ATTR_CONTENT_TYPE = '1.2.840.113549.1.9.3';
const OID_EKU = '2.5.29.37';
const OID_SUBJECT_KEY_ID = '2.5.29.14';
const OID_BASIC_CONSTRAINTS = '2.5.29.19';
const OID_KEY_USAGE = '2.5.29.15';
const OID_KP_TIMESTAMPING = '1.3.6.1.5.5.7.3.8';

const OID_RSA_ENCRYPTION = '1.2.840.113549.1.1.1';
const OID_EC_PUBLIC_KEY = '1.2.840.10045.2.1';

const DIGEST_BY_OID: Readonly<Record<string, string>> = Object.freeze({
  '1.3.14.3.2.26': 'SHA-1',
  '2.16.840.1.101.3.4.2.1': 'SHA-256',
  '2.16.840.1.101.3.4.2.2': 'SHA-384',
  '2.16.840.1.101.3.4.2.3': 'SHA-512',
});

/**
 * Signature algorithm OIDs to the Web Crypto import/verify shape. Only the
 * families a TSA actually uses are listed; an unknown OID fails the signature
 * check loudly rather than being waved through.
 */
const SIG_ALG_BY_OID: Readonly<Record<string, { kind: 'rsa' | 'ecdsa'; hash: string }>> = Object.freeze({
  '1.2.840.113549.1.1.5': { kind: 'rsa', hash: 'SHA-1' },
  '1.2.840.113549.1.1.11': { kind: 'rsa', hash: 'SHA-256' },
  '1.2.840.113549.1.1.12': { kind: 'rsa', hash: 'SHA-384' },
  '1.2.840.113549.1.1.13': { kind: 'rsa', hash: 'SHA-512' },
  '1.2.840.10045.4.3.2': { kind: 'ecdsa', hash: 'SHA-256' },
  '1.2.840.10045.4.3.3': { kind: 'ecdsa', hash: 'SHA-384' },
  '1.2.840.10045.4.3.4': { kind: 'ecdsa', hash: 'SHA-512' },
});

const CURVE_BY_OID: Readonly<Record<string, { name: string; size: number }>> = Object.freeze({
  '1.2.840.10045.3.1.7': { name: 'P-256', size: 32 },
  '1.3.132.0.34': { name: 'P-384', size: 48 },
  '1.3.132.0.35': { name: 'P-521', size: 66 },
});

const RDN_LABELS: Readonly<Record<string, string>> = Object.freeze({
  '2.5.4.3': 'CN',
  '2.5.4.6': 'C',
  '2.5.4.7': 'L',
  '2.5.4.8': 'ST',
  '2.5.4.10': 'O',
  '2.5.4.11': 'OU',
  '1.2.840.113549.1.9.1': 'emailAddress',
});

// ---------------------------------------------------------------------------
// Certificate
// ---------------------------------------------------------------------------

interface ParsedCertificate {
  der: Uint8Array;
  /** The signed TBSCertificate bytes, which is what the issuer's signature covers. */
  tbsDer: Uint8Array;
  serialHex: string;
  issuerDer: Uint8Array;
  subjectDer: Uint8Array;
  issuerString: string;
  subjectString: string;
  notBefore: string | null;
  notAfter: string | null;
  /** SubjectPublicKeyInfo bytes, importable by Web Crypto as 'spki'. */
  spkiDer: Uint8Array;
  publicKeyAlgOid: string;
  /** Named curve OID for EC keys, else null. */
  curveOid: string | null;
  /** OID of the algorithm the ISSUER used to sign this certificate. */
  signatureAlgOid: string;
  signatureValue: Uint8Array;
  extendedKeyUsage: string[];
  /** True when the EKU extension is present and marked critical. */
  ekuCritical: boolean;
  /** Lowercase hex of the SubjectKeyIdentifier extension, when present. */
  subjectKeyIdentifierHex: string | null;
  /** BasicConstraints cA flag; false when the extension is absent (RFC 5280 4.2.1.9). */
  isCa: boolean;
  /** KeyUsage keyCertSign bit, or null when the certificate carries no KeyUsage extension. */
  keyCertSign: boolean | null;
}

function rdnToString(b: Uint8Array, nameTlv: Tlv): string {
  const parts: string[] = [];
  for (const rdn of children(b, nameTlv)) {
    for (const atv of children(b, rdn)) {
      const kids = children(b, atv);
      if (kids.length < 2) continue;
      const oid = readOid(b, kids[0]);
      const label = RDN_LABELS[oid] ?? oid;
      const value = new TextDecoder().decode(content(b, kids[1]));
      parts.push(`${label}=${value}`);
    }
  }
  return parts.join(', ');
}

export function parseCertificate(b: Uint8Array, certTlv: Tlv): ParsedCertificate {
  const cert = children(b, certTlv);
  const tbs = cert[0];
  const sigAlg = cert[1];
  const sigValue = cert[2];

  const tbsKids = children(b, tbs);
  let i = 0;
  // [0] EXPLICIT version is optional and defaults to v1.
  if (tbsKids[0]?.tag === 0xa0) i = 1;
  const serial = tbsKids[i++];
  i++; // inner signature AlgorithmIdentifier, a restatement of sigAlg
  const issuer = tbsKids[i++];
  const validity = tbsKids[i++];
  const subject = tbsKids[i++];
  const spki = tbsKids[i++];

  const validityKids = children(b, validity);
  const notBefore = validityKids[0] ? readTime(b, validityKids[0]) : null;
  const notAfter = validityKids[1] ? readTime(b, validityKids[1]) : null;

  const spkiKids = children(b, spki);
  const algKids = children(b, spkiKids[0]);
  const publicKeyAlgOid = readOid(b, algKids[0]);
  const curveOid =
    publicKeyAlgOid === OID_EC_PUBLIC_KEY && algKids[1] ? readOid(b, algKids[1]) : null;

  // Extensions live in [3] EXPLICIT at the end of the TBS.
  const extendedKeyUsage: string[] = [];
  let ekuCritical = false;
  let subjectKeyIdentifierHex: string | null = null;
  let isCa = false;
  let keyCertSign: boolean | null = null;
  for (let k = i; k < tbsKids.length; k++) {
    if (tbsKids[k].tag !== 0xa3) continue;
    const extSeq = children(b, tbsKids[k])[0];
    if (!extSeq) continue;
    for (const ext of children(b, extSeq)) {
      const kids = children(b, ext);
      if (kids.length < 2) continue;
      const oid = readOid(b, kids[0]);
      if (oid === OID_SUBJECT_KEY_ID) {
        const octetSki = kids[kids.length - 1];
        try {
          const innerSki = readTlv(b, octetSki.contentStart);
          subjectKeyIdentifierHex = toHex(content(b, innerSki));
        } catch { /* a malformed extension is simply not a usable identifier */ }
        continue;
      }
      if (oid === OID_BASIC_CONSTRAINTS) {
        // SEQUENCE { cA BOOLEAN DEFAULT FALSE, pathLenConstraint INTEGER OPTIONAL }
        try {
          const bc = readTlv(b, kids[kids.length - 1].contentStart);
          const first = children(b, bc)[0];
          isCa = first?.tag === 0x01 && content(b, first)[0] !== 0x00;
        } catch { isCa = false; }
        continue;
      }
      if (oid === OID_KEY_USAGE) {
        // BIT STRING; keyCertSign is bit 5, the 0x04 bit of the first content octet after the
        // unused-bits count.
        try {
          const ku = content(b, readTlv(b, kids[kids.length - 1].contentStart));
          keyCertSign = ku.length > 1 && (ku[1] & 0x04) !== 0;
        } catch { keyCertSign = false; }
        continue;
      }
      if (oid !== OID_EKU) continue;
      const critical = kids[1].tag === 0x01 && content(b, kids[1])[0] !== 0x00;
      const octet = kids[kids.length - 1];
      const inner = readTlv(b, octet.contentStart);
      for (const purpose of children(b, inner)) extendedKeyUsage.push(readOid(b, purpose));
      ekuCritical = critical;
    }
  }

  return {
    der: bytesOf(b, certTlv),
    tbsDer: bytesOf(b, tbs),
    serialHex: readIntegerHex(b, serial),
    issuerDer: bytesOf(b, issuer),
    subjectDer: bytesOf(b, subject),
    issuerString: rdnToString(b, issuer),
    subjectString: rdnToString(b, subject),
    notBefore,
    notAfter,
    spkiDer: bytesOf(b, spki),
    publicKeyAlgOid,
    curveOid,
    signatureAlgOid: readOid(b, children(b, sigAlg)[0]),
    // BIT STRING content begins with the count of unused bits, which is 0 here.
    signatureValue: content(b, sigValue).subarray(1),
    extendedKeyUsage,
    ekuCritical,
    subjectKeyIdentifierHex,
    isCa,
    keyCertSign,
  };
}

// ---------------------------------------------------------------------------
// Signature verification
// ---------------------------------------------------------------------------

/** True when `time` falls inside the certificate's validity window. */
function validAt(cert: ParsedCertificate, time: string | null): boolean {
  if (!time || !cert.notBefore || !cert.notAfter) return false;
  const t = Date.parse(time);
  return Number.isFinite(t) && t >= Date.parse(cert.notBefore) && t <= Date.parse(cert.notAfter);
}

function sameBytes(a: Uint8Array, c: Uint8Array): boolean {
  if (a.length !== c.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== c[i]) return false;
  return true;
}

/**
 * CMS and X.509 carry ECDSA signatures as DER SEQUENCE { INTEGER r, INTEGER s }.
 * Web Crypto wants the raw fixed-width r||s pair, so convert. Returns null when
 * the input is not that shape, which fails the check rather than passing a
 * wrongly padded buffer to verify().
 */
function ecdsaDerToRaw(der: Uint8Array, size: number): Uint8Array | null {
  let seq: Tlv;
  try {
    seq = readTlv(der, 0);
  } catch {
    return null;
  }
  if (seq.tag !== 0x30) return null;
  const kids = children(der, seq);
  if (kids.length !== 2 || kids[0].tag !== 0x02 || kids[1].tag !== 0x02) return null;
  const out = new Uint8Array(size * 2);
  for (let n = 0; n < 2; n++) {
    let v = content(der, kids[n]);
    let i = 0;
    while (i < v.length - 1 && v[i] === 0) i++;
    v = v.subarray(i);
    if (v.length > size) return null;
    out.set(v, size * (n + 1) - v.length);
  }
  return out;
}

async function verifyWithCert(
  cert: ParsedCertificate,
  signatureAlgOid: string,
  signature: Uint8Array,
  signedBytes: Uint8Array,
  /**
   * Digest to use when the algorithm OID names only the key type. RFC 5652
   * section 5.3 lets SignerInfo.signatureAlgorithm be plain `rsaEncryption`
   * with the digest carried separately in `digestAlgorithm`, and DigiCert's
   * TSA emits exactly that. Without this fallback a perfectly good token is
   * reported unverifiable.
   */
  fallbackHash?: string,
): Promise<{ ok: boolean; detail: string }> {
  const alg = SIG_ALG_BY_OID[signatureAlgOid]
    ?? (signatureAlgOid === OID_RSA_ENCRYPTION && fallbackHash
      ? { kind: 'rsa' as const, hash: fallbackHash }
      : signatureAlgOid === OID_EC_PUBLIC_KEY && fallbackHash
        ? { kind: 'ecdsa' as const, hash: fallbackHash }
        : null);
  if (!alg) return { ok: false, detail: `unsupported signature algorithm ${signatureAlgOid}` };

  // Web Crypto's importKey requires an ArrayBuffer view that starts at 0 for
  // some implementations; copy to be safe across subarray-backed buffers.
  const spki = Uint8Array.from(cert.spkiDer);

  try {
    if (alg.kind === 'rsa') {
      const key = await crypto.subtle.importKey(
        'spki', spki,
        { name: 'RSASSA-PKCS1-v1_5', hash: { name: alg.hash } },
        false, ['verify'],
      );
      const ok = await crypto.subtle.verify(
        'RSASSA-PKCS1-v1_5', key, Uint8Array.from(signature), Uint8Array.from(signedBytes),
      );
      return { ok, detail: ok ? `RSA ${alg.hash}` : `RSA ${alg.hash} did not verify` };
    }

    const curve = cert.curveOid ? CURVE_BY_OID[cert.curveOid] : null;
    if (!curve) return { ok: false, detail: `unsupported EC curve ${cert.curveOid ?? 'none'}` };
    const raw = ecdsaDerToRaw(signature, curve.size);
    if (!raw) return { ok: false, detail: 'malformed ECDSA signature encoding' };
    const key = await crypto.subtle.importKey(
      'spki', spki, { name: 'ECDSA', namedCurve: curve.name }, false, ['verify'],
    );
    const ok = await crypto.subtle.verify(
      { name: 'ECDSA', hash: { name: alg.hash } }, key, Uint8Array.from(raw), Uint8Array.from(signedBytes),
    );
    return {
      ok,
      detail: ok ? `ECDSA ${curve.name} ${alg.hash}` : `ECDSA ${curve.name} ${alg.hash} did not verify`,
    };
  } catch (err) {
    return { ok: false, detail: `verify failed: ${(err as Error).message}` };
  }
}

async function digest(hashName: string, data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest(hashName, Uint8Array.from(data)));
}

// ---------------------------------------------------------------------------
// TimeStampResp / TimeStampToken
// ---------------------------------------------------------------------------

export interface TimeStampRespParse {
  /** PKIStatus. 0 granted, 1 grantedWithMods, 2 rejection, 3 waiting, 4 revocationWarning, 5 revocationNotification. */
  status: number;
  /** The inner ContentInfo bytes, or null when the authority refused. */
  token: Uint8Array | null;
}

/**
 * Split a TimeStampResp into its status and its TimeStampToken. Callers that
 * already hold a bare token (the `tst` field of a stored anchor) skip this.
 */
export function parseTimeStampResp(der: Uint8Array): TimeStampRespParse {
  const top = readTlv(der, 0);
  const kids = children(der, top);
  const statusInfo = children(der, kids[0]);
  // PKIStatus is an INTEGER. Reading only the first content octet accepts a
  // non-minimally encoded rejection (00 02) as granted, so read the whole
  // value and refuse anything that is not a single small byte.
  const statusBytes = content(der, statusInfo[0]);
  let status = 2;
  if (statusInfo[0].tag === 0x02) {
    let i = 0;
    while (i < statusBytes.length - 1 && statusBytes[i] === 0) i++;
    const trimmed = statusBytes.subarray(i);
    status = trimmed.length === 1 ? trimmed[0] : 2;
  }
  const token = kids.length > 1 ? bytesOf(der, kids[1]) : null;
  return { status, token };
}

/**
 * Verify a TimeStampToken against the hash the caller believes was anchored.
 *
 * `expectedHashHex` is the exact lowercase hex the extension sent to the TSA.
 * Passing null skips only the message-imprint check and reports the imprint
 * found, which is what a reader wants when inspecting a token on its own.
 */
export async function verifyTimeStampToken(
  tokenDer: Uint8Array,
  expectedHashHex: string | null,
  /**
   * The nonce sent in the request. When given, the token must echo it
   * (RFC 3161 section 2.4.1), which shows it was minted for this request and
   * not replayed. Null skips the check, which is what a reader inspecting a
   * stored token has to do: the nonce is not kept after the anchor is written.
   */
  expectedNonceHex: string | null = null,
): Promise<TsaVerification> {
  const result: TsaVerification = {
    ok: false,
    genTime: null,
    messageImprintHex: null,
    messageImprintAlgorithm: null,
    serialNumber: null,
    policyOid: null,
    nonceHex: null,
    signerSubject: null,
    signerCertSha256: null,
    rootCertSha256: null,
    knownRootName: null,
    checks: [],
    error: null,
  };
  const add = (name: TsaCheck['name'], ok: boolean, detail: string): void => {
    result.checks.push({ name, ok, detail });
  };

  // Without Web Crypto nothing below can run. Say that, rather than reporting
  // a failure the token did not earn.
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    result.couldNotCheck = true;
    result.error = 'this browser cannot run cryptographic checks here (Web Crypto is only available in a secure context)';
    return result;
  }

  let signedData: Tlv;
  let b: Uint8Array;
  try {
    b = tokenDer;
    const contentInfo = readTlv(b, 0);
    const ciKids = children(b, contentInfo);
    if (readOid(b, ciKids[0]) !== OID_SIGNED_DATA) {
      result.error = 'token is not a CMS SignedData';
      return result;
    }
    signedData = children(b, ciKids[1])[0];
  } catch (err) {
    result.error = `token parse failed: ${(err as Error).message}`;
    return result;
  }

  try {
    const sdKids = children(b, signedData);
    // SignedData ::= SEQUENCE { version, digestAlgorithms, encapContentInfo,
    //                           [0] certificates OPTIONAL, [1] crls OPTIONAL,
    //                           signerInfos }
    const encap = sdKids[2];
    const encapKids = children(b, encap);
    if (readOid(b, encapKids[0]) !== OID_CT_TST_INFO) {
      result.error = 'encapsulated content is not id-ct-TSTInfo';
      return result;
    }
    // eContent is [0] EXPLICIT OCTET STRING; TSTInfo is inside that OCTET STRING.
    const eContentOctet = readTlv(b, encapKids[1].contentStart);
    const tstInfoBytes = content(b, eContentOctet);

    // --- TSTInfo -----------------------------------------------------------
    const tstTop = readTlv(tstInfoBytes, 0);
    const tstKids = children(tstInfoBytes, tstTop);
    // TSTInfo ::= SEQUENCE { version, policy, messageImprint, serialNumber,
    //                        genTime, accuracy?, ordering?, nonce?, tsa?, exts? }
    result.policyOid = readOid(tstInfoBytes, tstKids[1]);
    const imprint = children(tstInfoBytes, tstKids[2]);
    result.messageImprintAlgorithm = readOid(tstInfoBytes, children(tstInfoBytes, imprint[0])[0]);
    result.messageImprintHex = toHex(content(tstInfoBytes, imprint[1]));
    result.serialNumber = readIntegerHex(tstInfoBytes, tstKids[3]);
    result.genTime = readGeneralizedTime(tstInfoBytes, tstKids[4]);
    // After genTime the optional fields are accuracy (SEQUENCE), ordering
    // (BOOLEAN), nonce (INTEGER), tsa ([0]) and extensions ([1]). The nonce is
    // the only INTEGER among them, so the first one found is it.
    for (let n = 5; n < tstKids.length; n++) {
      if (tstKids[n].tag !== 0x02) continue;
      result.nonceHex = readIntegerHex(tstInfoBytes, tstKids[n]);
      break;
    }
    if (expectedNonceHex !== null) {
      // Compare as unsigned magnitudes: an authority may re-encode the integer
      // with or without a leading zero, so strip both sides before comparing.
      const strip = (h: string): string => h.replace(/^(00)+/, '') || '0';
      const ok = result.nonceHex !== null
        && strip(result.nonceHex) === strip(expectedNonceHex.toLowerCase());
      add('nonce-echo', ok, ok
        ? 'the authority echoed the nonce this request carried'
        : `the authority echoed ${result.nonceHex ?? 'no nonce'}, this request sent ${expectedNonceHex}`);
    }

    if (expectedHashHex === null) {
      add('message-imprint', true, `imprint ${result.messageImprintHex} (nothing to compare against)`);
    } else {
      const want = expectedHashHex.trim().toLowerCase();
      const ok = result.messageImprintHex === want;
      add('message-imprint', ok, ok
        ? `stamped over ${want}`
        : `stamped over ${result.messageImprintHex}, expected ${want}`);
    }

    // --- Certificates ------------------------------------------------------
    const certs: ParsedCertificate[] = [];
    for (const kid of sdKids) {
      if (kid.tag !== 0xa0) continue;
      for (const c of children(b, kid)) {
        if (c.tag === 0x30) certs.push(parseCertificate(b, c));
      }
    }

    // --- SignerInfo --------------------------------------------------------
    const signerInfos = sdKids[sdKids.length - 1];
    const si = children(b, signerInfos)[0];
    if (!si) {
      result.error = 'token carries no SignerInfo';
      return result;
    }
    const siKids = children(b, si);
    // SignerInfo ::= SEQUENCE { version, sid, digestAlgorithm,
    //                           [0] signedAttrs OPTIONAL, signatureAlgorithm,
    //                           signature, [1] unsignedAttrs OPTIONAL }
    const sid = siKids[1];
    const digestAlgOid = readOid(b, children(b, siKids[2])[0]);
    const digestName = DIGEST_BY_OID[digestAlgOid];
    if (!digestName) {
      result.error = `unsupported digest algorithm ${digestAlgOid}`;
      return result;
    }

    let idx = 3;
    let signedAttrs: Tlv | null = null;
    if (siKids[idx]?.tag === 0xa0) signedAttrs = siKids[idx++];
    const sigAlgOid = readOid(b, children(b, siKids[idx++])[0]);
    const signature = content(b, siKids[idx]);

    // Pick the signing certificate the SignerInfo names. Two forms exist:
    // issuerAndSerialNumber (a SEQUENCE) and subjectKeyIdentifier ([0]).
    // The SignerInfo NAMES its certificate. Take that one or none.
    //
    // An earlier version fell back to "the certificate with the timestamping
    // EKU, else the first one" when the name matched nothing. That fallback is
    // the bug: a token can carry several certificates, and picking a different
    // one from the one the signer named means the signature is checked against
    // a certificate that did not make it. If the name resolves to nothing, the
    // token is malformed and says so.
    let signer: ParsedCertificate | null = null;
    if (sid.tag === 0x30) {
      const sidKids = children(b, sid);
      const wantIssuer = bytesOf(b, sidKids[0]);
      const wantSerial = readIntegerHex(b, sidKids[1]);
      signer = certs.find(c => c.serialHex === wantSerial && sameBytes(c.issuerDer, wantIssuer)) ?? null;
      if (!signer) {
        result.error = 'the certificate the signature names is not in this token';
        return result;
      }
    } else if (sid.tag === 0x80) {
      // subjectKeyIdentifier form: [0] IMPLICIT OCTET STRING. Match it against
      // each certificate's SubjectKeyIdentifier extension.
      const wantSki = toHex(content(b, sid));
      signer = certs.find(c => c.subjectKeyIdentifierHex === wantSki) ?? null;
      if (!signer) {
        result.error = 'the certificate the signature names by key identifier is not in this token';
        return result;
      }
    }
    if (!signer) {
      result.error = 'the signature does not name a certificate in a form this checker reads';
      return result;
    }
    result.signerSubject = signer.subjectString;
    result.signerCertSha256 = toHex(await digest('SHA-256', signer.der));

    // --- signedAttrs digest ------------------------------------------------
    if (!signedAttrs) {
      // RFC 3161 tokens in the wild always carry signedAttrs. Without them the
      // signature would cover the TSTInfo directly; treat the absence as a
      // shape we do not verify rather than silently accepting it.
      add('signed-attrs-digest', false, 'token has no signed attributes');
    } else {
      let messageDigestAttr: Uint8Array | null = null;
      let contentTypeOk = false;
      for (const attr of children(b, signedAttrs)) {
        const kids = children(b, attr);
        const oid = readOid(b, kids[0]);
        const values = children(b, kids[1]);
        if (oid === OID_ATTR_MESSAGE_DIGEST && values[0]) {
          messageDigestAttr = content(b, values[0]);
        } else if (oid === OID_ATTR_CONTENT_TYPE && values[0]) {
          contentTypeOk = readOid(b, values[0]) === OID_CT_TST_INFO;
        }
      }
      const actual = await digest(digestName, tstInfoBytes);
      const ok = messageDigestAttr !== null && sameBytes(messageDigestAttr, actual) && contentTypeOk;
      add('signed-attrs-digest', ok, ok
        ? `${digestName} of the timestamp body matches the signed messageDigest attribute`
        : 'the signed messageDigest attribute does not cover this timestamp body');
    }

    // --- Signature ---------------------------------------------------------
    // The signature covers the DER SET OF signedAttrs. On the wire the tag is
    // [0] IMPLICIT (0xa0); RFC 5652 section 5.4 says to re-tag it 0x31 before
    // hashing. Rebuild rather than mutate so the source buffer stays intact.
    if (signedAttrs) {
      const attrsDer = Uint8Array.from(bytesOf(b, signedAttrs));
      attrsDer[0] = 0x31;
      const v = await verifyWithCert(signer, sigAlgOid, signature, attrsDer, digestName);
      add('signature', v.ok, v.ok
        ? `signed by the embedded certificate (${v.detail})`
        : `signature did not verify (${v.detail})`);
    } else {
      const v = await verifyWithCert(signer, sigAlgOid, signature, tstInfoBytes, digestName);
      add('signature', v.ok, v.ok ? `signed by the embedded certificate (${v.detail})` : v.detail);
    }

    // --- Certificate is allowed to time-stamp ------------------------------
    const eku = signer.extendedKeyUsage.includes(OID_KP_TIMESTAMPING);
    add('timestamping-eku', eku && signer.ekuCritical, eku
      ? (signer.ekuCritical
          ? 'the certificate is marked, critically, for time stamping only'
          : 'the certificate allows time stamping but the extension is not marked critical')
      : 'the certificate is not marked for time stamping');

    // --- genTime inside the certificate's validity --------------------------
    if (result.genTime && signer.notBefore && signer.notAfter) {
      const t = Date.parse(result.genTime);
      const from = Date.parse(signer.notBefore);
      const to = Date.parse(signer.notAfter);
      const ok = Number.isFinite(t) && t >= from && t <= to;
      add('genTime-in-cert-validity', ok, ok
        ? `${result.genTime} falls inside ${signer.notBefore} to ${signer.notAfter}`
        : `${result.genTime} falls outside ${signer.notBefore} to ${signer.notAfter}`);
    } else {
      add('genTime-in-cert-validity', false, 'the token or the certificate has no readable time');
    }

    // --- Chain walk up to the certificate the token anchors on ---------------
    //
    // Authorities embed different chain lengths: FreeTSA sends the signing
    // certificate and its self-signed root, DigiCert sends a longer chain.
    // Walk upward through whatever the token carries, verifying each link, and
    // stop at a self-signed certificate or when the issuer is absent. Every
    // link must verify; the terminal certificate is what a reader compares
    // against the authority's published one.
    const chain: ParsedCertificate[] = [signer];
    const links: { child: ParsedCertificate; issuer: ParsedCertificate; ok: boolean; detail: string }[] = [];
    let cursor: ParsedCertificate = signer;
    // A chain longer than the certificate set cannot happen without a cycle.
    for (let hop = 0; hop < certs.length; hop++) {
      if (sameBytes(cursor.subjectDer, cursor.issuerDer)) break; // self-signed: the top
      const issuer = certs.find(c => sameBytes(c.subjectDer, cursor.issuerDer) && c !== cursor);
      if (!issuer) break;
      const v = await verifyWithCert(
        issuer, cursor.signatureAlgOid, cursor.signatureValue, cursor.tbsDer,
      );
      // A signature alone does not make a certificate an authority: the issuer must be marked
      // as a certificate authority, allowed to sign certificates when it lists its uses, and
      // valid at the time the token states (RFC 5280 4.2.1.3, 4.2.1.9).
      let ok = v.ok;
      let detail = v.detail;
      if (ok && !issuer.isCa) {
        ok = false;
        detail = `${issuer.subjectString} is not marked as a certificate authority`;
      } else if (ok && issuer.keyCertSign === false) {
        ok = false;
        detail = `${issuer.subjectString} is not allowed to sign certificates`;
      } else if (ok && !validAt(issuer, result.genTime)) {
        ok = false;
        detail = `${issuer.subjectString} was not valid at ${result.genTime ?? 'the stamp time'}`;
      }
      links.push({ child: cursor, issuer, ok, detail });
      chain.push(issuer);
      cursor = issuer;
      if (!ok) break;
    }

    const terminal = chain[chain.length - 1];
    const selfSigned = sameBytes(terminal.subjectDer, terminal.issuerDer);
    result.rootCertSha256 = toHex(await digest('SHA-256', terminal.der));

    if (links.length === 0) {
      add('issuer-signature', false, 'the token does not carry the issuing certificate');
    } else {
      const bad = links.find(l => !l.ok);
      add('issuer-signature', !bad, bad
        ? `a certificate in the chain was not signed by the one above it (${bad.detail})`
        : `${links.length} certificate link${links.length === 1 ? '' : 's'} verified, up to ${terminal.subjectString}`
          + (selfSigned ? ' (self-signed)' : ' (the token carries no certificate above this one)'));
    }

    // A recognised certificate at the top of a chain that did not verify says
    // nothing: the signer was never shown to descend from it. Both halves have
    // to hold before the authority can be named.
    const chainHolds = links.length > 0 && links.every(l => l.ok);
    const name = chainHolds ? KNOWN_TSA_ROOTS[result.rootCertSha256] : undefined;
    result.knownRootName = name ?? null;
    add('known-root', Boolean(name), name
      ? `the chain ends at ${name}`
      : !chainHolds
        ? 'the certificate chain did not verify, so the authority at the top of it is not established'
        : `the chain ends at a certificate FeelingWise does not pin: ${terminal.subjectString},`
          + ` SHA-256 ${result.rootCertSha256}. Compare it against the authority's published certificate.`);
  } catch (err) {
    result.error = `token verification failed: ${(err as Error).message}`;
    return result;
  }

  // `known-root` is reported, never required: a token from an authority we have
  // not pinned is still a verified token, and the reader can check the root by
  // hand. Everything else must pass.
  result.ok = result.checks.every(c => c.ok || c.name === 'known-root');
  return result;
}

/**
 * Convenience for stored anchors: accepts either the full TimeStampResp or the
 * bare token, both base64, and verifies against `expectedHashHex`.
 */
/**
 * Subject RDN string trimmed to what a person needs: the common name and the
 * organisation. The full string is kept in `signerSubject` for anyone who wants
 * it, because a TSA certificate can carry a paragraph of description.
 */
// Copied into the standalone verifier by scripts/gen-rfc3161-inline.mjs, like hexToBytes and
// parseCertificate above: the verifier prints it, the vectors carry it, and knip sees none of
// that because it does not follow a generator.
export function shortSubject(subject: string | null): string | null {
  if (!subject) return null;
  const parts = subject.split(', ');
  const pick = parts.filter(p => /^(CN|O)=/.test(p));
  return pick.length ? pick.join(', ') : subject;
}

export async function verifyAnchorBase64(
  input: { tst?: string | null; response?: string | null },
  expectedHashHex: string | null,
): Promise<TsaVerification> {
  // An empty string is absent, not a token. `??` alone would accept '' and
  // then fail to decode it, which is how a stored anchor that carries only the
  // response envelope silently failed to verify.
  const b64 = (input.tst || input.response || '').trim() || null;
  if (!b64) {
    return {
      ok: false, genTime: null, messageImprintHex: null, messageImprintAlgorithm: null,
      serialNumber: null, policyOid: null, nonceHex: null, signerSubject: null, signerCertSha256: null,
      rootCertSha256: null, knownRootName: null, checks: [], error: 'anchor carries no token',
    };
  }
  let bytes: Uint8Array;
  try {
    const bin = atob(b64.replace(/\s+/g, ''));
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  } catch {
    return {
      ok: false, genTime: null, messageImprintHex: null, messageImprintAlgorithm: null,
      serialNumber: null, policyOid: null, nonceHex: null, signerSubject: null, signerCertSha256: null,
      rootCertSha256: null, knownRootName: null, checks: [], error: 'anchor token is not base64',
    };
  }
  // A TimeStampResp starts SEQUENCE { PKIStatusInfo SEQUENCE ... }; a bare
  // token starts SEQUENCE { OID id-signedData ... }. Look at the first child.
  try {
    const top = readTlv(bytes, 0);
    const first = readTlv(bytes, top.contentStart);
    if (first.tag === 0x30) {
      const parsed = parseTimeStampResp(bytes);
      if (parsed.status !== 0 && parsed.status !== 1) {
        return {
          ok: false, genTime: null, messageImprintHex: null, messageImprintAlgorithm: null,
          serialNumber: null, policyOid: null, nonceHex: null, signerSubject: null, signerCertSha256: null,
          rootCertSha256: null, knownRootName: null,
          checks: [{ name: 'response-granted', ok: false, detail: `the authority refused, PKIStatus ${parsed.status}` }],
          error: null,
        };
      }
      if (parsed.token) {
        const v = await verifyTimeStampToken(parsed.token, expectedHashHex);
        v.checks.unshift({ name: 'response-granted', ok: true, detail: `PKIStatus ${parsed.status}` });
        return v;
      }
    }
  } catch {
    // Fall through and try the bytes as a bare token.
  }
  return verifyTimeStampToken(bytes, expectedHashHex);
}
