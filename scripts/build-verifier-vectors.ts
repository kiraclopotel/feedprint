/**
 * Builds verifier/vectors/: small exports with the reading the checker must
 * give each, for a second implementer of the format or of the checker.
 *
 * Twenty-six files, each a complete export built by the real exporter over records
 * signed with a throwaway key (or, for the dated key, the fixture key whose
 * genesis FreeTSA stamped on 2026-09-04): valid with its manifest; without
 * the manifest; a record edited; the manifest's file edited; a withheld
 * record on its signed marker; an earlier generation's key carried; that key
 * missing; a self-minted time-stamp token; the signing key dated; a stated
 * selection; then the five added on 2026-09-18 after an engineer wrote a
 * checker from FORMAT.md alone and named what the set never exercised:
 * text that is not plain ASCII, a forged signature, an unsigned record, a
 * withheld record with no marker, and a chain seam beside a branch; then three
 * more the same day, each a rule FORMAT.md states and nothing drove: an edited
 * record that names no key, the file's own key failing its own fingerprint,
 * and a withheld record pointing at the wrong marker; then a nineteenth,
 * a chain seam the file cannot attribute by signature; and a twentieth on
 * 2026-09-19, a withheld record carrying no signature at all, which the
 * checker used to wave through as VERIFIED; and four on 2026-09-20 for the
 * month rotation, the first files in the set to cross a month: the linked run
 * that reads VERIFIED and the three ways the link can fail to earn it; then two
 * for records that carry a `subject` instead of a feed item: one of each kind,
 * and the same file with a subject edited after signing.
 * EXPECTED.json
 * beside them is the projection of the checker's report over each, written by
 * this script from the checker's own run; the test compares a fresh run to it.
 *
 * Generated once and committed, like the demo: ECDSA draws a fresh nonce per
 * signature, so the files are not byte-stable across runs. Rerun only when
 * the exporter or the checker changes what a file carries, then commit the
 * new files with the change. You no longer have to remember: the lock below
 * compares the inline scripts in every committed vector with the ones the
 * exporter writes today and fails when they differ. It was written on
 * 2026-09-16, when these files had been sitting two scripts behind the
 * exporter, the numbers engine among them.
 *
 *   npx tsx scripts/build-verifier-vectors.ts
 * Lock: tests/gates/verifier-vectors.test.ts
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { webcrypto } from 'node:crypto';
import { attachSignedManifest, buildForensicHtmlExport, type EmbeddedPublicKey, type ExportMetadata } from '../src/forensics/html-export';
import { computeRecordIntegrityHash } from '../src/forensics/canonical-payload';
import type { ForensicRecord } from '../src/types/forensic';
import { underFixedClock } from './fixed-clock';

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}

const here = dirname(fileURLToPath(import.meta.url));
export const VECTORS_DIR = join(here, '..', 'verifier', 'vectors');
export const EXPECTED_PATH = join(VECTORS_DIR, 'EXPECTED.json');
const FIXTURES = join(here, '..', 'tests', 'fixtures', 'rfc3161');
const STANDALONE = join(here, '..', 'verifier', 'verify-export.mjs');

type Sign = (hash: string) => Promise<string>;
interface Key { jwk: JsonWebKey; fp: string; sign: Sign }

function b64u(buf: ArrayBuffer): string {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function fingerprintOf(jwk: JsonWebKey): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${jwk.x}|${jwk.y}`));
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

async function keyFrom(privateJwk: JsonWebKey, publicJwk: JsonWebKey): Promise<Key> {
  const priv = await crypto.subtle.importKey('jwk', privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const jwk: JsonWebKey = { kty: 'EC', crv: 'P-256', x: publicJwk.x, y: publicJwk.y };
  const sign: Sign = async (hash) => b64u(await crypto.subtle.sign({ name: 'ECDSA', hash: { name: 'SHA-256' } }, priv, new TextEncoder().encode(hash)));
  return { jwk, fp: await fingerprintOf(jwk), sign };
}

// The keys and the clock are fixed, so a rebuild moves only what the change that asked for it
// moves: wording, scripts, the digests over them and the signatures. With keys drawn fresh on every
// run, each rebuild also moved every key, fingerprint and record hash, and a wording change could
// not be reviewed by its diff. ECDSA still draws a fresh nonce, so signatures move on every run.
const VECTOR_KEYS = join(here, '..', 'tests', 'fixtures', 'verifier-vectors', 'keys.json');
const VECTOR_CLOCK = '2026-09-07T09:00:00.000Z';

async function fixtureKey(name: 'own' | 'old' | 'substituted'): Promise<Key> {
  const all = JSON.parse(readFileSync(VECTOR_KEYS, 'utf8')) as Record<string, { publicJwk: JsonWebKey; privateJwk: JsonWebKey }>;
  return keyFrom(all[name].privateJwk, all[name].publicJwk);
}


/**
 * One record, built the way `chain` builds them but with the three things a
 * vector needs to vary held apart: `fpKey` is the key the record NAMES in
 * `publicKeyFingerprint`, `signer` is the key that actually signs it (null
 * leaves the record unsigned), and `pos` is its `chainPosition` where that has
 * to differ from its place in the file. Added 2026-09-18: with `chain` alone
 * there was no way to write a record whose hash is right and whose signature is
 * wrong, so `key-mismatch`, the security property the whole format rests on,
 * had no vector behind it, and no way to write a record with no signature at
 * all or two records at one position.
 */
async function makeRecord(
  i: number,
  prev: string,
  fpKey: Key,
  signer: Key | null,
  text: string,
  extra: Record<string, unknown> = {},
  pos = i,
): Promise<ForensicRecord> {
  const base = {
    id: `v-${i}`, timestamp: `2026-09-06T12:00:0${i}.000Z`, platform: 'tiktok', originalText: text, originalHash: 'h',
    originalLength: text.length, neutralizedText: '', author: `@author-${i}`, postUrl: `https://www.tiktok.com/@author-${i}/video/${i}`,
    techniques: [], overallScore: 0, userAgeCategory: 'adult', aiSource: 'cloud', feedSource: 'for-you',
    publicKeyFingerprint: fpKey.fp, chainPosition: pos, prevRecordHash: prev, kind: 'post', verdict: 'pass',
    ...extra,
  } as unknown as Omit<ForensicRecord, 'integrityHash' | 'signature' | 'chainAnchor'>;
  const integrityHash = await computeRecordIntegrityHash(base);
  const rec = { ...base, integrityHash } as ForensicRecord;
  if (signer) rec.signature = await signer.sign(integrityHash);
  return rec;
}

/**
 * A signed redaction marker for one record: the hashed line names the record,
 * its hash and the fields, in the form redactionMarkerText writes and
 * redactionOf in the checker parses. Added 2026-09-18 with vector 18, which
 * needs two markers in one file; vector 05 still builds its single marker
 * inline above.
 */
async function makeRedactionMarker(id: string, target: ForensicRecord, fields: string[], pos: number, prev: string, key: Key): Promise<ForensicRecord> {
  const base = {
    id, timestamp: '2026-09-06T12:05:00.000Z', platform: 'tiktok',
    originalText: `[redaction-marker @ 2026-09-06T12:05:00.000Z] record=${target.id} recordHash=${target.integrityHash} fields=${fields.join(',')} reason=test vector`,
    originalHash: 'h', originalLength: 0, neutralizedText: '', author: 'system', postUrl: '', techniques: [], overallScore: 0,
    userAgeCategory: 'adult', aiSource: 'rules', feedSource: 'unknown', publicKeyFingerprint: key.fp, chainPosition: pos,
    prevRecordHash: prev, kind: 'redaction-marker', verdict: 'pass',
    resetReason: `withheld at the parent's request: record ${target.id}, ${fields.length} fields`,
  } as unknown as Omit<ForensicRecord, 'integrityHash' | 'signature' | 'chainAnchor'>;
  const integrityHash = await computeRecordIntegrityHash(base);
  return { ...base, integrityHash, signature: await key.sign(integrityHash) } as ForensicRecord;
}

/** The copy of a record that leaves the file: the fields are gone and `redacted` names a marker. */
function blankFields(target: ForensicRecord, fields: string[], markerId: string): ForensicRecord {
  const out: Record<string, unknown> = { ...target };
  for (const f of fields) delete out[f];
  out.redacted = { markerId, at: '2026-09-06T12:05:00.000Z', fields };
  return out as unknown as ForensicRecord;
}

/** Three plain records at positions 0..2, each signed by the key given for it, linked by hash. */
async function chain(keys: Key[], texts = ['first post', 'second post', 'third post']): Promise<ForensicRecord[]> {
  const out: ForensicRecord[] = [];
  let prev = '';
  for (let i = 0; i < texts.length; i++) {
    const key = keys[Math.min(i, keys.length - 1)];
    const base = {
      id: `v-${i}`, timestamp: `2026-09-06T12:00:0${i}.000Z`, platform: 'tiktok', originalText: texts[i], originalHash: 'h',
      originalLength: texts[i].length, neutralizedText: '', author: `@author-${i}`, postUrl: `https://www.tiktok.com/@author-${i}/video/${i}`,
      techniques: [], overallScore: 0, userAgeCategory: 'adult', aiSource: 'cloud', feedSource: 'for-you',
      publicKeyFingerprint: key.fp, chainPosition: i, prevRecordHash: prev, kind: 'post', verdict: 'pass',
    } as Omit<ForensicRecord, 'integrityHash' | 'signature' | 'chainAnchor'>;
    const integrityHash = await computeRecordIntegrityHash(base);
    out.push({ ...base, integrityHash, signature: await key.sign(integrityHash) } as ForensicRecord);
    prev = integrityHash;
  }
  return out;
}

const PAYLOAD_RE = /(<script type="application\/json" id="fw-export-data">)([\s\S]*?)(<\/script>)/;
function editPayload(html: string, edit: (data: Record<string, unknown>) => void): string {
  return html.replace(PAYLOAD_RE, (_m, open: string, body: string, close: string) => {
    const data = JSON.parse(body) as Record<string, unknown>;
    edit(data);
    return open + JSON.stringify(data).replace(/</g, '\\u003c') + close;
  });
}

function meta(key: Key, extra: Partial<ExportMetadata> = {}): ExportMetadata {
  return { fwVersion: 'FeelingWise TEST VECTOR: every record in this file is invented', publicKeyJwk: key.jwk, publicKeyFingerprint: key.fp, locale: 'en', ...extra };
}

/** The projection of a checker report that EXPECTED.json holds and the test compares. */
export interface Expected {
  state: string;
  manifest: string;
  records: number;
  keys: number;
  firstFailure: { index: number; reason: string } | null;
  // `signatureRejected` was declared nowhere here while EXPECTED.json has
  // carried it since the counter shipped: project() passes the checker's own
  // object through with a cast, so the type could be wrong without anything
  // failing. Found 2026-09-18 by reading the interface against the file.
  unverified: { priorKey: number; unsigned: number; signatureUnverified: number; signatureRejected: number };
  carriedKey: number;
  redacted: number;
  anchorAuthorities: Array<string | null>;
  anchorsOk: boolean[];
  keyDatedBy: string[] | null;
  holding: { kind: string; included: number; totalSource: number | null; leftOut: number } | null;
  outside: number;
  // Added 2026-09-18 with vector 15. A seam and a branch have their own rules
  // in FORMAT.md section 4 and their own reason for reading partial, but the
  // projection carried only `outside`, so a vector exercising them would have
  // recorded a reading that says nothing about what it exercises.
  branches: number;
  restarts: number;
  // The fourth chain counter, added 2026-09-18 for the same reason the two
  // above it were: a seam the checker could not attribute by signature has its
  // own rule in FORMAT.md section 4, and a vector exercising it would otherwise
  // record a reading that says nothing about it.
  unattributed: number;
  // Records that continue from the record a reset or rotation marker names, on a line the record
  // did not keep. FORMAT.md section 4 gives them their own count and their own reason for partial.
  setAside: number;
}

export function project(report: Record<string, unknown>): Expected {
  const failures = (report.failures as Array<{ index: number; reason: string }>) ?? [];
  const ts = (report.timestamps as { anchors: Array<{ ok: boolean; authority: string | null }>; keyGenesis: { authorities: string[] } | null } | undefined);
  const h = report.holding as { kind: string; included: number; totalSource: number | null; leftOut: number } | undefined;
  return {
    holding: h ? { kind: h.kind, included: h.included, totalSource: h.totalSource, leftOut: h.leftOut } : null,
    outside: ((report.chain as { outside?: number } | null)?.outside) ?? 0,
    branches: ((report.chain as { branches?: number } | null)?.branches) ?? 0,
    restarts: ((report.chain as { restarts?: number } | null)?.restarts) ?? 0,
    unattributed: ((report.chain as { unattributed?: number } | null)?.unattributed) ?? 0,
    setAside: ((report.chain as { setAside?: number } | null)?.setAside) ?? 0,
    state: report.state as string,
    manifest: report.manifest as string,
    records: report.records as number,
    keys: report.keys as number,
    firstFailure: failures.length ? { index: failures[0].index, reason: failures[0].reason } : null,
    unverified: report.unverified as Expected['unverified'],
    carriedKey: report.carriedKey as number,
    redacted: report.redacted as number,
    anchorAuthorities: (ts?.anchors ?? []).map((a) => a.authority),
    anchorsOk: (ts?.anchors ?? []).map((a) => a.ok),
    keyDatedBy: ts?.keyGenesis ? ts.keyGenesis.authorities : null,
  };
}

export function buildVectors(): Promise<Record<string, string>> {
  return underFixedClock(VECTOR_CLOCK, buildVectorsOnFixedKeys);
}

async function buildVectorsOnFixedKeys(): Promise<Record<string, string>> {
  const own = await fixtureKey('own');
  const old = await fixtureKey('old');
  const files: Record<string, string> = {};

  const plain = await chain([own]);
  const valid = await attachSignedManifest(buildForensicHtmlExport(plain, meta(own)), own.sign);
  files['01-verified.html'] = valid;
  files['02-no-manifest.html'] = buildForensicHtmlExport(plain, meta(own));
  files['03-record-edited.html'] = editPayload(valid, (d) => { (d.records as ForensicRecord[])[1].originalText = 'edited after signing'; delete d.manifest; });
  files['04-manifest-edited.html'] = editPayload(valid, (d) => { (d.records as ForensicRecord[])[1].originalText = 'edited after signing'; });

  // A withheld record: the marker is a signed record of its own kind whose
  // hashed line names the record, its hash and the fields; the copy that
  // leaves has those fields removed and carries `redacted`.
  const target = plain[1];
  const fields = ['author', 'originalText'];
  const markerBase = {
    id: 'v-marker-1', timestamp: '2026-09-06T12:05:00.000Z', platform: 'tiktok',
    originalText: `[redaction-marker @ 2026-09-06T12:05:00.000Z] record=${target.id} recordHash=${target.integrityHash} fields=${fields.join(',')} reason=test vector`,
    originalHash: 'h', originalLength: 0, neutralizedText: '', author: 'system', postUrl: '', techniques: [], overallScore: 0,
    userAgeCategory: 'adult', aiSource: 'rules', feedSource: 'unknown', publicKeyFingerprint: own.fp, chainPosition: 3,
    prevRecordHash: plain[2].integrityHash, kind: 'redaction-marker', verdict: 'pass', resetReason: 'withheld at the parent\'s request: record v-1, 2 fields',
  } as unknown as Omit<ForensicRecord, 'integrityHash' | 'signature' | 'chainAnchor'>;
  const markerHash = await computeRecordIntegrityHash(markerBase);
  const marker = { ...markerBase, integrityHash: markerHash, signature: await own.sign(markerHash) } as ForensicRecord;
  const blanked: Record<string, unknown> = { ...target };
  for (const f of fields) delete blanked[f];
  blanked.redacted = { markerId: marker.id, at: marker.timestamp, fields };
  const withheld = [plain[0], blanked as unknown as ForensicRecord, plain[2], marker];
  files['05-withheld-record.html'] = await attachSignedManifest(buildForensicHtmlExport(withheld, meta(own)), own.sign);

  // Two generations: positions 0 and 1 signed by an earlier key, 2 by the file's own.
  const twoGen = await chain([old, old, own]);
  const carried: EmbeddedPublicKey[] = [{ fingerprint: own.fp, jwk: own.jwk }, { fingerprint: old.fp, jwk: old.jwk }];
  files['06-carried-key.html'] = await attachSignedManifest(buildForensicHtmlExport(twoGen, meta(own, { publicKeys: carried })), own.sign);
  files['07-prior-key-missing.html'] = await attachSignedManifest(buildForensicHtmlExport(twoGen, meta(own, { publicKeys: [carried[0]] })), own.sign);

  // A self-minted token: internally sound, chained to no authority the checker recognises.
  const forged = readFileSync(join(FIXTURES, 'forged-selfminted-resp.der')).toString('base64');
  const anchors = [{ id: 'a-0', anchoredChainPosition: 0, anchoredIntegrityHash: 'f234ff9e567d48d727a2849d07276ef32ec3f8c088aa850842b883ccbb817cde', tsaProvider: 'digicert', responseB64: forged, tstB64: '', generalizedTime: null, requestedAt: '2026-09-04T10:00:00.000Z', route: 'direct' }];
  files['08-self-minted-token.html'] = await attachSignedManifest(buildForensicHtmlExport(plain, meta(own, { anchors: anchors as never })), own.sign);

  // The signing key dated: the fixture key FreeTSA stamped on 2026-09-04 signs the records.
  const fixture = JSON.parse(readFileSync(join(FIXTURES, 'keygen-key.json'), 'utf8')) as { publicJwk: JsonWebKey; privateJwk: JsonWebKey; publicKeyDigest: string };
  const dated = await keyFrom(fixture.privateJwk, fixture.publicJwk);
  const datedChain = await chain([dated]);
  const genesis = { publicKeyDigest: fixture.publicKeyDigest, fingerprint: dated.fp, anchors: [{ tsaProvider: 'freetsa', route: 'direct', responseB64: readFileSync(join(FIXTURES, 'keygen-resp.der')).toString('base64'), tstB64: '', generalizedTime: null, requestedAt: '2026-09-04T10:00:00.000Z' }] };
  files['09-key-dated.html'] = await attachSignedManifest(buildForensicHtmlExport(datedChain, meta(dated, { keyGenesis: genesis as never })), dated.sign);

  // A report: the export gate kept the first and the last of three records and
  // the file says so under its signature; the last one's missing predecessor
  // is the report's own doing. (The first record of any file is never checked
  // for a predecessor, so the gap must sit in the middle to be counted.)
  const kept = [plain[0], plain[2]];
  files['10-report-selection.html'] = await attachSignedManifest(buildForensicHtmlExport(kept, meta(own, {
    selection: { included: 2, totalSource: 3, excludedUnreviewed: 0, excludedLowConfidence: 0, excludedNonDetection: 1 },
  })), own.sign);

  // 11. Rule: section 3, the canonical payload is "JSON.stringify" of the
  // payload object, and section 5's recordsDigest is SHA-256 over
  // JSON.stringify(records). Why it did not exist before: measured on
  // 2026-09-18 over all thirty records in vectors 01 to 10, not one character
  // in the set was outside printable ASCII, and no record carried a quote, a
  // backslash, a control character, a fractional number or a nested object.
  // "JSON.stringify" names a function in one language; everything a second
  // implementer must reproduce by hand was therefore stated by the spec and
  // exercised by nothing: non-ASCII left raw, `/` left unescaped, the short
  // forms \b \f \n \r \t, lone surrogates escaped, the shortest
  // round-tripping form of a number, and the key order a JS object imposes.
  // The `severityFloor` keys are written here in the order 10, 2, 1 and a JS
  // object reorders them to 1, 2, 10 before serialisation: an implementer
  // building records from their own structures must reproduce that ordering,
  // and one re-serialising already-parsed JSON never sees it.
  // `tieBreak: 1e-7` is here because the shortest form of a number is not the
  // same string in every language, and that difference survives a parse.
  const nasty: ForensicRecord[] = [];
  {
    const texts = [
      '\u{1F9FF} she said \u201Cthis is fine\u201D then typed "ok" at C:\\Users\\me and linked /watch?v=1',
      'line one\nline two\r\nafter the CR\ttabbed\bbackspace\fform feed\u0001unit one and a lone half \uD83D',
      'accents: \u00e9\u00e8\u00ea \u0219i \u021b \u2014 \u0448\u0442\u043e \u4f60\u597d \u0645\u0631\u062d\u0628\u0627',
    ];
    const extras: Array<Record<string, unknown>> = [
      {},
      { author: '@\u00e9lodie\u2019s_account', postUrl: 'https://www.tiktok.com/@e/video/1?q=a%20b&r="x"' },
      {
        overallScore: 3.25,
        techniques: [{ name: 'contempt', severity: 3, confidence: 0.6666666666666666, why: 'a \u201Cquote\u201D inside a reason' }],
        configSnapshot: { mode: 'standard', severityFloor: { '10': 0.9, '2': 0.55, '1': 0.2 }, tieBreak: 1e-7 },
        topic: 'politic\u0103',
      },
    ];
    let prev = '';
    for (let i = 0; i < texts.length; i++) {
      const rec = await makeRecord(i, prev, own, own, texts[i], extras[i]);
      nasty.push(rec);
      prev = rec.integrityHash;
    }
  }
  files['11-text-escaping.html'] = await attachSignedManifest(buildForensicHtmlExport(nasty, meta(own)), own.sign);

  // 12. Rule: section 4 check 3, `key-mismatch`: a signature that does not
  // verify under the key the record names fails the file. Why it did not exist
  // before: vector 03 edits a record's text, so the hash check at step 2 fails
  // first and the signature is never reached. The central security property of
  // the format had no vector behind it. Here the hash is right and only the
  // signature is wrong: record 1 is stamped with this file's own fingerprint
  // and signed with a key that is not in the file at all, which is what a
  // forgery looks like once the forger has fixed up the hash. The manifest is
  // signed over these records, so it verifies and the record still fails.
  const forgedSig: ForensicRecord[] = [];
  {
    let prev = '';
    for (let i = 0; i < 3; i++) {
      const rec = await makeRecord(i, prev, own, i === 1 ? old : own, `post ${i}`);
      forgedSig.push(rec);
      prev = rec.integrityHash;
    }
  }
  files['12-forged-signature.html'] = await attachSignedManifest(buildForensicHtmlExport(forgedSig, meta(own)), own.sign);

  // 13. Rule: section 4 check 3, `unsigned`: a record with no signature is
  // accepted and never green. Why it did not exist before: `unsigned` is one of
  // the three reasons a file reads PARTIALLY VERIFIED and every record in every
  // vector carried a signature, so the reason was written down and never shown.
  const unsigned: ForensicRecord[] = [];
  {
    let prev = '';
    for (let i = 0; i < 3; i++) {
      const rec = await makeRecord(i, prev, own, i === 1 ? null : own, `post ${i}`);
      unsigned.push(rec);
      prev = rec.integrityHash;
    }
  }
  files['13-unsigned-record.html'] = await attachSignedManifest(buildForensicHtmlExport(unsigned, meta(own)), own.sign);

  // 14. Rule: section 4 check 1, `redaction-unattested`: a record whose
  // content has been withheld is accepted ONLY on a signed marker in the same
  // file that names its id and its hash. Why it did not exist before: vector 05
  // shows the good half of the rule and nothing showed the bad half, so a
  // checker that accepted `redacted` on the strength of the field alone, which
  // is the whole hole the rule closes, passed every vector in the set.
  const orphanTarget = plain[1];
  const orphanFields = ['author', 'originalText'];
  const orphan: Record<string, unknown> = { ...orphanTarget };
  for (const f of orphanFields) delete orphan[f];
  orphan.redacted = { markerId: 'v-marker-absent', at: '2026-09-06T12:05:00.000Z', fields: orphanFields };
  const unattested = [plain[0], orphan as unknown as ForensicRecord, plain[2]];
  files['14-redaction-unattested.html'] = await attachSignedManifest(buildForensicHtmlExport(unattested, meta(own)), own.sign);

  // 15. Rule: section 4's chain paragraph. A predecessor absent where
  // positions are consecutive is a seam, a position held twice is a branch, and
  // either alone reads PARTIALLY VERIFIED. Why it did not exist before: every
  // vector but 10 was one unbroken run of consecutive positions, and 10's gap
  // is a stated selection, which is the one case that reads VERIFIED. The two
  // shapes an install actually produces after a record loss and recovery (read
  // on a real chain, 2026-09-03: 1,062 positions held twice or three times,
  // every link still resolving) had no vector. Record 1 names a
  // predecessor that is not here at position 1 (the seam, attributed: both
  // sides verify), and record 3 sits at position 2 beside record 2 (the
  // branch). Nothing here fails, so the file is a clean read of "partial for a
  // reason that is not a failure".
  const SEAM_PREV = 'b7d3a1c95e6f4028d1a4c07be98f52d6c3a0918f4e2b7d6c5a3f10e9b8c7d264';
  const seam: ForensicRecord[] = [];
  {
    const r0 = await makeRecord(0, '', own, own, 'before the loss');
    const r1 = await makeRecord(1, SEAM_PREV, own, own, 'first after the recovery');
    const r2 = await makeRecord(2, r1.integrityHash, own, own, 'second after the recovery');
    const r3 = await makeRecord(3, r2.integrityHash, own, own, 'signed at a position already used', {}, 2);
    seam.push(r0, r1, r2, r3);
  }
  files['15-seam-and-branch.html'] = await attachSignedManifest(buildForensicHtmlExport(seam, meta(own)), own.sign);

  // 16. Rule: section 4 check 3's soft branch. A record that names NO key and
  // whose signature does not verify under the file's own is
  // `signature-did-not-verify`: counted under `unverified.signatureRejected`,
  // never a failure, because a record written before the fingerprint field
  // existed may have been signed by a key that has since rotated and nothing in
  // the file tells that apart from an edit. This is the sharpest edge in the
  // format and it had no vector: the same edited file reads `failed` with
  // `key-mismatch` and exit 2 while `publicKeyFingerprint` is there, and
  // `partial` with an empty `failures` list and exit 1 once that one field is
  // deleted and the hash recomputed. An implementer working from the document
  // alone would emit `key-mismatch` here and diverge on a file nobody would
  // think to test. No manifest, because `recordsDigest` catches the edit before
  // any of this is reached and the branch is then never seen.
  // The edit is on the LAST record on purpose. Edit a middle one and its
  // recomputed hash leaves the next record's prevRecordHash pointing at a hash
  // that is no longer in the file: a seam, which caps the reading at partial by
  // itself, so the file would read partial with the fingerprint left in place
  // too and would demonstrate nothing. Nothing points at the last record, so
  // this file's partial is traceable to the one counter it exists for
  // (measured 2026-09-18: restarts 1 with the middle record edited, 0 here).
  const unfingerprinted: ForensicRecord[] = [];
  {
    let prev = '';
    for (let i = 0; i < 3; i++) {
      const rec = await makeRecord(i, prev, own, own, `post ${i}`);
      unfingerprinted.push(rec);
      prev = rec.integrityHash;
    }
    const sound = unfingerprinted[2];
    const edited: Record<string, unknown> = { ...sound, originalText: 'edited after signing' };
    delete edited.publicKeyFingerprint;
    edited.integrityHash = await computeRecordIntegrityHash(edited as unknown as Omit<ForensicRecord, 'integrityHash' | 'signature' | 'chainAnchor'>);
    edited.signature = sound.signature;
    unfingerprinted[2] = edited as unknown as ForensicRecord;
  }
  files['16-edited-unfingerprinted.html'] = buildForensicHtmlExport(unfingerprinted, meta(own));

  // 17. Rule: section 4's reading, the file's own key. The key is set up before
  // any record is looked at, and a file whose embedded key fails its own
  // fingerprint stops there: `records: 0`, `keys: 0`, one failure at
  // `index: -1` with `reason: key-setup`. Why it did not exist before: every
  // vector carried a sound key, so the one check that runs before all the
  // others, and the only terminal reading besides a failed manifest, was
  // published and never shown. Of the three causes this is the one an attacker
  // produces: the public key in the file is swapped for one whose private half
  // they hold, so their signatures verify, and the stated fingerprint is left
  // alone because the page prints it and a reader may have it from elsewhere.
  // The recomputed fingerprint no longer matches what the file states, and the
  // reading is terminal before a single signature is checked.
  const substituted = await fixtureKey('substituted');
  files['17-key-setup-fingerprint-mismatch.html'] = editPayload(valid, (d) => { d.publicKeyJwk = substituted.jwk; });

  // 18. Rule: section 4 check 1, the third of the four things a withheld record
  // is checked on: the record's own `redacted.markerId` must be the id of the
  // marker that names it, so the two point at each other and not merely at the
  // same hash. Why it did not exist before: vector 05 has one marker and one
  // withheld record whose ids agree, and vector 14 has no marker at all, so a
  // checker that never read `redacted.markerId` passed the whole set. Here the
  // file attests both withheld records properly and the FIRST one points at the
  // OTHER one's marker: everything a lax checker looks at is present and
  // correct, the id is right, a marker names the record and the hashes match,
  // and the record is still unattested. The second withheld record is the
  // control in the same file: it points at its own marker and reads as withheld.
  const redFields = ['author', 'originalText'];
  const markerA = await makeRedactionMarker('v-marker-a', plain[1], redFields, 3, plain[2].integrityHash, own);
  const markerB = await makeRedactionMarker('v-marker-b', plain[2], redFields, 4, markerA.integrityHash, own);
  const crossed = [
    plain[0],
    blankFields(plain[1], redFields, markerB.id),
    blankFields(plain[2], redFields, markerB.id),
    markerA,
    markerB,
  ];
  files['18-redaction-marker-mismatch.html'] = await attachSignedManifest(buildForensicHtmlExport(crossed, meta(own)), own.sign);

  // 19. Rule: section 4's chain paragraph, the attribution of a seam. A seam is
  // attributed when the records on both sides verify under a key the file
  // carries, and unattributed when either side does not, which is the counter
  // `unattributed`. Why it did not exist before: `unattributed` reached the
  // published projection only on 2026-09-18, and every vector left it at zero,
  // so an implementer could attribute every seam, or none, and pass the whole
  // set. Vector 15's seam cannot show it: both its sides are signed under the
  // file's own key, so it is attributed by construction.
  // This is the shape the core's comment names, a reinstall: the record before
  // the seam belongs to a generation whose key the file no longer carries, so
  // it reads prior-key, and nothing in the file can say the same install signed
  // both sides of the break. The restart is counted and the attribution is
  // withheld, and neither is a failure.
  const unattributedSeam: ForensicRecord[] = [];
  {
    const r0 = await makeRecord(0, '', old, old, 'the generation before the reinstall');
    const r1 = await makeRecord(1, SEAM_PREV, own, own, 'first record after the reinstall');
    const r2 = await makeRecord(2, r1.integrityHash, own, own, 'second record after the reinstall');
    unattributedSeam.push(r0, r1, r2);
  }
  files['19-unattributed-seam.html'] = await attachSignedManifest(buildForensicHtmlExport(unattributedSeam, meta(own)), own.sign);

  // 20. Rule: section 4 check 1, the signature over a withheld record, in the
  // one case the checker never reached. A withheld record's content has left
  // the file, so there is nothing to re-hash: the signature over its stored
  // hash is the only thing left in the file saying the install made it. Until
  // 2026-09-19 the verify was gated on the field BEING there, so a withheld
  // record with no `signature` at all came back a clean tick and the whole file
  // read VERIFIED. Deleting one field, on the only kind of record whose content
  // cannot be checked any other way, bought a green verdict. Vector 05 cannot
  // show it: its withheld record carries the signature it was born with, so the
  // gate is true and the verify runs. This file is vector 05 with that one
  // field removed, attested by the same marker, and it must read partial with
  // `unsigned: 1` and no failure, exactly as an unsigned ordinary record does.
  const blankedUnsigned: Record<string, unknown> = { ...blanked };
  delete blankedUnsigned.signature;
  const withheldUnsigned = [plain[0], blankedUnsigned as unknown as ForensicRecord, plain[2], marker];
  files['20-withheld-unsigned.html'] = await attachSignedManifest(buildForensicHtmlExport(withheldUnsigned, meta(own)), own.sign);

  // 21. Rule: section 4's chain paragraph, the linked run. Positions restart at
  // 0 at every month rotation, and the marker that opens the new month carries,
  // inside its hashed payload, the hash of the last record of the month before
  // (`priorChainHash`). When that record is in the file the two months are one
  // linked record and the file reads VERIFIED. Why it did not exist before:
  // every vector was one month. A whole-record export made by the product's own
  // code across one ordinary month flip, 17 records, read PARTIALLY VERIFIED
  // with "7 chain seams" on 2026-09-20, because each position of the new month
  // was counted as a position held twice and the marker as naming a predecessor
  // outside the file. That is every install after its first month. The marker
  // here has the fields src/forensics/chain-rotation.ts writes.
  const GENESIS = 'feelingwise-chain-genesis-v1';
  const rotationExtra = (priorChainHash: string): Record<string, unknown> => ({
    kind: 'month-rotation-marker', detectionMode: 'month-rotation-marker', chainAnchor: 'month-rotation',
    author: '', postUrl: '', aiSource: 'none', feedSource: 'unknown', platform: 'twitter', priorChainHash,
  });
  const monthOne = await chain([own], ['last month, first', 'last month, second', 'last month, third']);
  const flip = await makeRecord(3, GENESIS, own, own, '[month-rotation @ 2026-09-06T12:00:03.000Z from=2026-08]', rotationExtra(monthOne[2].integrityHash), 0);
  const after1 = await makeRecord(4, flip.integrityHash, own, own, 'this month, first', {}, 1);
  const after2 = await makeRecord(5, after1.integrityHash, own, own, 'this month, second', {}, 2);
  files['21-month-rotation-linked.html'] = await attachSignedManifest(buildForensicHtmlExport([...monthOne, flip, after1, after2], meta(own)), own.sign);

  // 22. The other side of 21, so the rule cannot be widened by accident. The
  // same file, and the marker names a record that is NOT here (a month missing
  // between the two). Nothing in the file shows that the run before the marker
  // is the one it follows, so the reused positions are counted as they always
  // were and the file reads PARTIALLY VERIFIED. A marker only earns a new run
  // by pointing at a record the reader can see.
  const ABSENT_PRIOR = 'c4e1f09a7b3d5286e0a9d4c1b7f3e5a2968d0c4b1e7f3a5d2c8b6e0f4a1d9c73';
  const flipLoose = await makeRecord(3, GENESIS, own, own, '[month-rotation @ 2026-09-06T12:00:03.000Z from=2026-08]', rotationExtra(ABSENT_PRIOR), 0);
  const loose1 = await makeRecord(4, flipLoose.integrityHash, own, own, 'this month, first', {}, 1);
  const loose2 = await makeRecord(5, loose1.integrityHash, own, own, 'this month, second', {}, 2);
  files['22-month-rotation-unlinked.html'] = await attachSignedManifest(buildForensicHtmlExport([...monthOne, flipLoose, loose1, loose2], meta(own)), own.sign);

  // 23 and 24. In 23 the marker names a record that IS in the file and is not
  // the last of its run (the first record of last month), which is the shape a
  // restore leaves: the run links, and the two records after the one named are
  // counted as set aside, so the file reads PARTIALLY VERIFIED and no count is
  // erased. In 24 the marker names the right record and carries no signature: a
  // marker nobody vouched for may not erase branch counts by being present, so
  // the reused positions count as three branches.
  const flipMiddle = await makeRecord(3, GENESIS, own, own, '[month-rotation @ 2026-09-06T12:00:03.000Z from=2026-08]', rotationExtra(monthOne[0].integrityHash), 0);
  const middle1 = await makeRecord(4, flipMiddle.integrityHash, own, own, 'this month, first', {}, 1);
  const middle2 = await makeRecord(5, middle1.integrityHash, own, own, 'this month, second', {}, 2);
  files['23-month-rotation-names-a-middle-record.html'] = await attachSignedManifest(buildForensicHtmlExport([...monthOne, flipMiddle, middle1, middle2], meta(own)), own.sign);

  const flipUnsigned = await makeRecord(3, GENESIS, own, null, '[month-rotation @ 2026-09-06T12:00:03.000Z from=2026-08]', rotationExtra(monthOne[2].integrityHash), 0);
  const unsigned1 = await makeRecord(4, flipUnsigned.integrityHash, own, own, 'this month, first', {}, 1);
  const unsigned2 = await makeRecord(5, unsigned1.integrityHash, own, own, 'this month, second', {}, 2);
  files['24-month-rotation-marker-unsigned.html'] = await attachSignedManifest(buildForensicHtmlExport([...monthOne, flipUnsigned, unsigned1, unsigned2], meta(own)), own.sign);

  // 25 and 26. Records about something other than a feed item carry `subject`, hashed whole and last,
  // and no feed field (FORMAT.md section 2): one record of each kind, linked and signed, reads
  // VERIFIED; the same file with the consent string changed after signing fails at that record.
  const subjects = await subjectChain(own);
  files['25-subject-records.html'] = await attachSignedManifest(buildForensicHtmlExport(subjects, meta(own)), own.sign);
  files['26-subject-edited.html'] = editPayload(files['25-subject-records.html'], (d) => {
    const consent = (d.records as Array<{ subject: { string: string } }>)[1];
    consent.subject.string = 'CQSbk4AQSbk4ANwAAAENAwCgAAAAAAAAAAYgACPAAAAA';
    delete d.manifest;
  });

  return files;
}

const TERMS = 'Terms of Service. This plan renews every year. To leave, give 30 days notice.';

/** A document, a consent string and a note, in that order, linked by hash and signed by `key`. */
async function subjectChain(key: Key): Promise<ForensicRecord[]> {
  const textHash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(TERMS))))
    .map((b) => b.toString(16).padStart(2, '0')).join('');
  const bodies: Array<{ kind: string; subject: Record<string, unknown> }> = [
    { kind: 'document', subject: {
      v: 1, address: 'https://shop.example/terms', title: 'Terms of Service', textHash, textReader: 'fw-visible-text/1',
      text: TERMS, boxes: [{ label: 'I agree to the terms', checked: true, type: 'checkbox' }], by: 'click',
    } },
    { kind: 'consent', subject: {
      v: 1, address: 'https://news.example/', standard: 'tcf-eu-2',
      string: 'CQSbk4AQSbk4ANwAAAENAwCgAAAAAAAAAAYgACPAAAAA.IDKQA4AAgAKAGQAygAAA.YAAAAAAAAAAA', route: 'message',
      api: { eventStatus: 'useractioncomplete', gdprApplies: true, cmpStatus: 'loaded' }, by: 'click',
    } },
    { kind: 'note', subject: { v: 1, agreement: 'ag-1', about: ['s-0'], fields: [{ name: 'renews', value: '2027-10-09' }] } },
  ];
  const out: ForensicRecord[] = [];
  let prev = '';
  for (let i = 0; i < bodies.length; i++) {
    const base = {
      id: `s-${i}`, timestamp: `2026-09-06T12:00:0${i}.000Z`, prevRecordHash: prev, chainPosition: i,
      publicKeyFingerprint: key.fp, ...bodies[i],
    } as unknown as Omit<ForensicRecord, 'integrityHash' | 'signature' | 'chainAnchor'>;
    const integrityHash = await computeRecordIntegrityHash(base);
    out.push({ ...base, integrityHash, signature: await key.sign(integrityHash) } as ForensicRecord);
    prev = integrityHash;
  }
  return out;
}

async function main(): Promise<void> {
  const { verifyExportText } = await import(pathToFileURL(STANDALONE).href) as { verifyExportText(text: string): Promise<Record<string, unknown>> };
  mkdirSync(VECTORS_DIR, { recursive: true });
  const files = await buildVectors();
  const expected: Record<string, Expected> = {};
  for (const [name, html] of Object.entries(files)) {
    writeFileSync(join(VECTORS_DIR, name), html, 'utf8');
    expected[name] = project(await verifyExportText(html));
    console.log(name.padEnd(28), expected[name].state.padEnd(9), expected[name].manifest, expected[name].firstFailure ? JSON.stringify(expected[name].firstFailure) : '');
  }
  writeFileSync(EXPECTED_PATH, JSON.stringify(expected, null, 2) + '\n', 'utf8');
  console.log('wrote ' + Object.keys(files).length + ' vectors and EXPECTED.json to ' + VECTORS_DIR);
}

// tsx transpiles this file to CommonJS, so no top-level await here.
const invokedDirectly = !!process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) void main();
