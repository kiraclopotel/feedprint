// @vitest-environment node
//
// The standalone checker (verifier/verify-export.mjs), built by
// scripts/build-standalone-verifier.ts from the same core every export
// embeds. Two locks:
//
// 1. Drift: the committed file is byte-identical to what the builder writes
//    now, so an edit to the core reaches the checker in the same commit.
// 2. Behavior: the built file, run as a child process the way a recipient
//    runs it, reads VERIFIED on a real signed export with its manifest,
//    PARTIALLY VERIFIED without the manifest and on a bare JSON envelope,
//    and BROKEN on a tampered record, naming the record and the reason.

import { describe, expect, it, beforeAll, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { SPAWN_TIMEOUT_MS } from '../../helpers/spawn-timeout';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { webcrypto } from 'node:crypto';
import { buildStandaloneVerifierSource, STANDALONE_VERIFIER_PATH } from '../../../scripts/build-standalone-verifier';
import { attachSignedManifest, buildForensicHtmlExport, type ExportMetadata } from '../../../src/forensics/html-export';
import { applyRedactions, redactionMarkerText } from '../../../src/forensics/redaction';
import type { RedactionMarkerInput } from '../../../src/types/redaction-marker';
import { computeRecordIntegrityHash } from '../../../src/forensics/canonical-payload';
import type { ForensicRecord } from '../../../src/types/forensic';

// This file starts child processes, so its tests do not fit vitest's 5s
// default under a 546-file parallel run. See tests/helpers/spawn-timeout.ts.
vi.setConfig({ testTimeout: SPAWN_TIMEOUT_MS });

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}

interface Report {
  state: 'verified' | 'partial' | 'failed';
  manifest: string;
  records: number;
  keys: number;
  // `unknownFields` is present only when the record carries keys this checker
  // does not know, which is what a file from a later version looks like here.
  failures: Array<{ index: number; id: string | null; reason: string; unknownFields?: string[] }>;
  unverified: { priorKey: number; unsigned: number; signatureUnverified: number; signatureRejected: number };
  redacted: number;
}

function run(file: string): { report: Report; code: number } {
  try {
    const out = execFileSync(process.execPath, [STANDALONE_VERIFIER_PATH, file, '--json'], { encoding: 'utf8' });
    return { report: JSON.parse(out) as Report, code: 0 };
  } catch (err) {
    const e = err as { status: number; stdout: string };
    return { report: JSON.parse(e.stdout) as Report, code: e.status };
  }
}

function runText(file: string): { text: string; code: number } {
  try {
    return { text: execFileSync(process.execPath, [STANDALONE_VERIFIER_PATH, file], { encoding: 'utf8' }), code: 0 };
  } catch (err) {
    const e = err as { status: number; stdout: string };
    return { text: e.stdout, code: e.status };
  }
}

async function b64u(sig: ArrayBuffer): Promise<string> {
  return Buffer.from(sig).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function fingerprint(jwk: JsonWebKey): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${jwk.x}|${jwk.y}`));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

const PAYLOAD_RE = /(<script type="application\/json" id="fw-export-data">)([\s\S]*?)(<\/script>)/;

function editPayload(html: string, edit: (data: Record<string, unknown>) => void): string {
  return html.replace(PAYLOAD_RE, (_m, open: string, body: string, close: string) => {
    const data = JSON.parse(body) as Record<string, unknown>;
    edit(data);
    return open + JSON.stringify(data).replace(/</g, '\\u003c') + close;
  });
}

let dir: string;
let signedHtml: string;
let unsignedHtml: string;

let buildRedactedExport: () => Promise<{ html: string }>;
let buildUnfingerprintedExport: () => Promise<{ html: string }>;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'fw-standalone-verifier-'));
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const full = await crypto.subtle.exportKey('jwk', kp.publicKey);
  const jwk: JsonWebKey = { kty: 'EC', crv: 'P-256', x: full.x, y: full.y };
  const fp = await fingerprint(jwk);
  const sign = async (hash: string): Promise<string> =>
    b64u(await crypto.subtle.sign({ name: 'ECDSA', hash: { name: 'SHA-256' } }, kp.privateKey, new TextEncoder().encode(hash)));

  const records: ForensicRecord[] = [];
  let prev = '';
  for (let i = 0; i < 3; i++) {
    const base = {
      id: `r-${i}`, timestamp: `2026-07-01T10:00:0${i}.000Z`, platform: 'tiktok', originalText: `post ${i} <b>&`, originalHash: 'h',
      originalLength: 6, neutralizedText: '', author: '@user', postUrl: '', techniques: [], overallScore: 0, userAgeCategory: 'teen',
      aiSource: 'cloud', feedSource: 'for-you', publicKeyFingerprint: fp, chainPosition: i, prevRecordHash: prev, kind: 'post', verdict: 'pass',
    } as Omit<ForensicRecord, 'integrityHash' | 'signature' | 'chainAnchor'>;
    const integrityHash = await computeRecordIntegrityHash(base);
    records.push({ ...base, integrityHash, signature: await sign(integrityHash) } as ForensicRecord);
    prev = integrityHash;
  }
  const meta: ExportMetadata = { fwVersion: 'V-test', publicKeyJwk: jwk, publicKeyFingerprint: fp, locale: 'en' };
  unsignedHtml = buildForensicHtmlExport(records, meta);
  signedHtml = await attachSignedManifest(unsignedHtml, sign);
  expect(signedHtml).not.toBe(unsignedHtml);

  // A file whose second record names no key — the shape a record written before
  // the fingerprint field existed has — and whose signature does not verify.
  // Its hash is computed WITHOUT the field, so the record is otherwise sound
  // and the signature check is the only thing that can speak.
  buildUnfingerprintedExport = async () => {
    const rs: ForensicRecord[] = [];
    let prev = '';
    for (let i = 0; i < 3; i++) {
      const base = {
        id: `u-${i}`, timestamp: `2026-07-02T10:00:0${i}.000Z`, platform: 'tiktok', originalText: `post ${i}`,
        originalHash: 'h', originalLength: 6, neutralizedText: '', author: '@user', postUrl: '', techniques: [],
        overallScore: 0, userAgeCategory: 'teen', aiSource: 'cloud', feedSource: 'for-you',
        chainPosition: i, prevRecordHash: prev, kind: 'post', verdict: 'pass',
        ...(i === 1 ? {} : { publicKeyFingerprint: fp }),
      } as Omit<ForensicRecord, 'integrityHash' | 'signature' | 'chainAnchor'>;
      const integrityHash = await computeRecordIntegrityHash(base);
      rs.push({ ...base, integrityHash, signature: i === 1 ? 'A'.repeat(86) : await sign(integrityHash) } as ForensicRecord);
      prev = integrityHash;
    }
    return { html: buildForensicHtmlExport(rs, meta) };
  };

  // A file where one record's content was withheld: the blanked record, the
  // signed marker that names it, and a manifest over the whole thing — the
  // shape a person hands over after redacting one post.
  buildRedactedExport = async () => {
    const markerInput: RedactionMarkerInput = {
      recordId: 'r-1', recordHash: records[1].integrityHash,
      fields: ['originalText'], reason: 'a name',
    };
    const markerBase = {
      id: 'm-1', timestamp: '2026-07-01T10:00:05.000Z', platform: 'tiktok',
      originalText: redactionMarkerText(markerInput, '2026-07-01T10:00:05.000Z', false),
      originalHash: 'h', originalLength: 6, neutralizedText: '', author: '', postUrl: '',
      techniques: [], overallScore: 0, userAgeCategory: 'teen', aiSource: 'rules',
      feedSource: 'unknown', publicKeyFingerprint: fp, chainPosition: 3,
      prevRecordHash: records[2].integrityHash, kind: 'redaction-marker', verdict: 'pass',
    } as unknown as Omit<ForensicRecord, 'integrityHash' | 'signature' | 'chainAnchor'>;
    const mh = await computeRecordIntegrityHash(markerBase);
    const marker = { ...markerBase, integrityHash: mh, signature: await sign(mh) } as ForensicRecord;
    const withMarker = [...records, marker];
    const blanked = applyRedactions(withMarker);
    const html = await attachSignedManifest(buildForensicHtmlExport(blanked, meta), sign);
    return { html };
  };
});

describe('verifier/verify-export.mjs is built from the embedded core', () => {
  it('the committed file is what the builder writes now', () => {
    expect(readFileSync(STANDALONE_VERIFIER_PATH, 'utf8')).toBe(buildStandaloneVerifierSource());
  });

  it('carries the core verbatim, with its canonical payload', () => {
    const src = readFileSync(STANDALONE_VERIFIER_PATH, 'utf8');
    expect(src).toContain('function canonicalPayload(r){');
    expect(src).toContain('async function checkManifest(data,pubKey,fingerprint){');
    expect(src).toContain('Apache License, Version 2.0');
  });
});

describe('verifier/verify-export.mjs over a real export', () => {
  it('reads VERIFIED, exit 0, on a signed export with its manifest', () => {
    const file = join(dir, 'signed.html');
    writeFileSync(file, signedHtml, 'utf8');
    const { report, code } = run(file);
    expect(code).toBe(0);
    expect(report.state).toBe('verified');
    expect(report.manifest).toBe('ok');
    expect(report.records).toBe(3);
    expect(report.keys).toBe(1);
    expect(report.failures).toEqual([]);
    const { text } = runText(file);
    // Line one says what the reader is holding; line two is the verdict.
    expect(text.split('\n')[0]).toContain('You are holding the whole record: 3 record(s)');
    expect(text.split('\n')[0]).toContain('no time stamp from an outside service');
    expect(text.split('\n')[1].startsWith('VERIFIED: 3 record(s)')).toBe(true);
    expect(text).toContain('does not establish who made the file');
  });

  it('reads PARTIALLY VERIFIED, exit 1, without the manifest', () => {
    const file = join(dir, 'unsigned.html');
    writeFileSync(file, unsignedHtml, 'utf8');
    const { report, code } = run(file);
    expect(code).toBe(1);
    expect(report.state).toBe('partial');
    expect(report.manifest).toBe('missing');
    expect(report.failures).toEqual([]);
  });

  it('reads FAILED at the manifest, exit 2, when a record is edited under a signed manifest', () => {
    const file = join(dir, 'edited-signed.html');
    writeFileSync(file, editPayload(signedHtml, (d) => { (d.records as ForensicRecord[])[1].originalText = 'edited'; }), 'utf8');
    const { report, code } = run(file);
    expect(code).toBe(2);
    expect(report.state).toBe('failed');
    expect(report.failures[0]).toMatchObject({ index: -1, reason: 'manifest', detail: 'records' });
  });

  it('reads FAILED at record 2 (tampered), exit 2, when a record is edited and the manifest removed', () => {
    const file = join(dir, 'edited-unsigned.html');
    writeFileSync(file, editPayload(signedHtml, (d) => { (d.records as ForensicRecord[])[1].originalText = 'edited'; delete d.manifest; }), 'utf8');
    const { report, code } = run(file);
    expect(code).toBe(2);
    expect(report.failures[0]).toMatchObject({ index: 1, id: 'r-1', reason: 'tampered' });
    const { text } = runText(file);
    expect(text.split('\n')[1].startsWith('FAILED at record 2 (r-1): tampered.')).toBe(true);
  });

  it('names the fields it does not know, and still says BROKEN, on a record from a later version', () => {
    // A checker older than the file cannot hash a key appended after it was
    // built, so a sound file fails its recomputation and the only verdict the
    // checker has says the record was edited. Simulated from this side: put a
    // key on the record that this checker's payload list has never heard of and
    // leave the stored hash as it is, which is what a newer build's record looks
    // like from here. The verdict does not move; the names are added so a reader
    // can tell a stale checker from an edit (2026-09-17).
    const file = join(dir, 'from-a-later-version.html');
    writeFileSync(file, editPayload(signedHtml, (d) => {
      const rec = (d.records as Record<string, unknown>[])[1];
      rec.somethingAddedLater = 'a value';
      rec.originalText = 'edited';
      delete d.manifest;
    }), 'utf8');

    const { report, code } = run(file);
    expect(code).toBe(2);
    expect(report.failures[0]).toMatchObject({ index: 1, reason: 'tampered' });
    expect(report.failures[0].unknownFields).toEqual(['somethingAddedLater']);

    const { text } = runText(file);
    expect(text).toContain('somethingAddedLater');
    expect(text).toContain('A checker older than the file fails exactly this way');
    // The verdict line is untouched: an unknown key never softens it.
    expect(text.split(/\r?\n/)[1].startsWith('FAILED at record 2')).toBe(true);
  });

  // WHOSE CLAIM IS COMPLETENESS. The checker described any HTML file with no
  // selection field as "the whole record: N records, everything the install
  // still had" — a positive claim of completeness derived from the ABSENCE of a
  // field the file itself supplies. Its own closing line said completeness is
  // not established, so one output said both.
  //
  // It matters because without a signed manifest the chain walk cannot see it.
  // Measured on the demo with the manifest stripped: dropping the newest
  // record, dropping the oldest, and swapping two adjacent records each read
  // chain ok with zero failures. verifyChain resolves a predecessor ANYWHERE in
  // the file on purpose — a real recovered chain held 1,062 positions twice —
  // so tightening the walk is not the fix. Saying whose claim it is, is.
  it('a file with no signed manifest gets the claim attributed to it, not asserted', () => {
    const file = join(dir, 'no-manifest.html');
    writeFileSync(file, editPayload(signedHtml, (d) => { delete d.manifest; }), 'utf8');
    const { text } = runText(file);
    const first = text.split(String.fromCharCode(10))[0];
    expect(first).toContain('The file says it is the whole record');
    expect(first).toContain('not checked here');
    expect(first).toContain('removed from the end or put out of order would not show');
    expect(first).not.toContain('everything the install still had');
  });

  it('with the manifest present the checker makes the claim itself', () => {
    const file = join(dir, 'signed-holding.html');
    writeFileSync(file, signedHtml, 'utf8');
    const { text } = runText(file);
    const first = text.split(String.fromCharCode(10))[0];
    expect(first).toContain('You are holding the whole record');
    expect(first).toContain('everything the install still had');
    expect(first).not.toContain('not checked here');
  });

  // The tampering the manifest DOES catch, so the reassurance above is earned.
  it.each([
    ['newest record removed', (r: ForensicRecord[]) => r.slice(0, -1)],
    ['oldest record removed', (r: ForensicRecord[]) => r.slice(1)],
    ['two records swapped', (r: ForensicRecord[]) => [r[1], r[0], ...r.slice(2)]],
  ])('a signed manifest catches %s', (name, mutate) => {
    const file = join(dir, `tamper-${name.replace(/ /g, '-')}.html`);
    writeFileSync(file, editPayload(signedHtml, (d) => { d.records = mutate(d.records as ForensicRecord[]); }), 'utf8');
    const { report, code } = run(file);
    expect(code).toBe(2);
    expect(report.state).toBe('failed');
    expect(report.failures[0]).toMatchObject({ reason: 'manifest' });
  });

  // WITHHELD CONTENT WAS COUNTED AND NEVER SAID. The headline verdict reads
  // "every hash recomputed", and for a redacted record it was not: the content
  // the hash covers has left the file. report.redacted has counted these since
  // the marker shipped and describe() printed the number nowhere.
  //
  // The same branch also gave the record its tick without checking its
  // signature — a marker naming the id plus a string comparison was the whole
  // test. The hash cannot be recomputed, so that signature is the only thing
  // saying the install made this record rather than someone else.
  it('says when content was withheld, and checks the signature that is all a redacted record has', async () => {
    const red = await buildRedactedExport();
    const file = join(dir, 'redacted.html');
    writeFileSync(file, red.html, 'utf8');
    const { report } = run(file);
    expect(report.redacted).toBe(1);
    const { text } = runText(file);
    expect(text).toContain('1 record(s) had fields withheld before this file was made');
    expect(text).toContain('their hash was not recomputed');

    // Break only the signature on the redacted record, with the manifest
    // removed so the per-record check is the last line of defence rather than
    // the manifest catching the edit first. The marker still names the record
    // and the hash string still matches, which is everything the old branch
    // asked for.
    const forged = join(dir, 'redacted-forged.html');
    writeFileSync(forged, editPayload(red.html, (d) => {
      delete d.manifest;
      const rs = d.records as ForensicRecord[];
      const target = rs.find(r => r.redacted);
      expect(target).toBeDefined();
      target!.signature = 'A'.repeat(86);
    }), 'utf8');
    const { report: bad } = run(forged);
    expect(bad.failures.some(f => f.reason === 'tampered')).toBe(true);
  });

  it('accepts a bare JSON envelope and reads it as partial, because the manifest needs the rendered rows', () => {
    const m = PAYLOAD_RE.exec(signedHtml);
    const data = JSON.parse(m![2]) as Record<string, unknown>;
    delete data.manifest;
    const file = join(dir, 'envelope.json');
    writeFileSync(file, JSON.stringify(data), 'utf8');
    const { report, code } = run(file);
    expect(code).toBe(1);
    expect(report.state).toBe('partial');
    expect(report.records).toBe(3);
  });

  // A bare envelope WITH its manifest — the input form this checker's own usage
  // line, index.html and FORMAT.md all advertise — read BROKEN (manifest:
  // summary-rows). A bare envelope carries no page rows, so a digest over zero
  // rows can never equal the manifest's digest over the page's rows. Telling a
  // recipient that a good file is broken is the worst false alarm this checker
  // can raise. The test above passed only because it deletes the manifest.
  // A SIGNATURE THAT WAS RUN AND FAILED is not a signature that could not be
  // checked, and both were reported with the same word under a verdict line
  // reading "no hash failed and no signature failed". A record naming no key
  // may have been signed under a key that has since rotated, so this is not
  // called forgery — but the reader must not be told nothing failed when
  // something did.
  it('a signature that is checked and fails is not reported as unchecked', async () => {
    const file = join(dir, 'sig-fails.html');
    const built = await buildUnfingerprintedExport();
    writeFileSync(file, built.html, 'utf8');
    const { report, code } = run(file);
    // Still not a failure — the record names no key, so this is ambiguous.
    expect(code).toBe(1);
    expect(report.failures).toEqual([]);
    // But counted apart, and said out loud.
    expect(report.unverified.signatureRejected).toBe(1);
    expect(report.unverified.signatureUnverified).toBe(0);
    const { text } = runText(file);
    expect(text).toContain('their signature did not verify');
    expect(text).not.toContain('no signature failed');
  });

  // REDACTING ONE RECORD INSIDE A FILTERED REPORT BROKE THE REPORT. A report
  // states how many of the install's records it holds, and selectionOf accepted
  // that statement only when the count matched the file's length. A redaction
  // marker is an EXTRA record, so the count stopped matching, the statement was
  // discarded, and the report's own gaps — which it had explained under
  // signature — read as unexplained links. Measured on a four-record report:
  // with the marker, selection null and state partial; without it, 2 of 4 and
  // verified. A sound file fell a grade for doing the thing the product tells
  // people to do with a name they want out.
  it('a filtered report keeps its signed selection when a record in it is redacted', async () => {
    const red = await buildRedactedExport();
    const file = join(dir, 'report-redacted.html');
    // Same file, but stating a selection: 3 content records of 5 the install had.
    writeFileSync(file, editPayload(red.html, (d) => {
      const content = (d.records as ForensicRecord[]).filter(r => r.kind !== 'redaction-marker');
      d.selection = { included: content.length, totalSource: content.length + 2, excludedUnreviewed: 0, excludedLowConfidence: 0, excludedNonDetection: 2 };
      delete d.manifest;  // the manifest signs the envelope, and we just edited it
    }), 'utf8');
    const { report } = run(file);
    const { text } = runText(file);
    // The statement is read: the report is described as a report, with its own
    // numbers, rather than as a bare set whose gaps nobody explained.
    expect(text).toContain('You are holding a report');
    expect(text).toContain('of the ' + (report.records - 1 + 2) + ' records the install had');
  });

  it('a bare JSON envelope that KEEPS its manifest reads partial, not broken', () => {
    const m = PAYLOAD_RE.exec(signedHtml);
    const file = join(dir, 'envelope-with-manifest.json');
    writeFileSync(file, m![2], 'utf8');
    const { report, code } = run(file);
    expect(code).toBe(1);
    expect(report.state).toBe('partial');
    expect(report.manifest).toBe('no-rows');
    expect(report.failures).toEqual([]);
    const { text } = runText(file);
    expect(text).toContain('everything in the manifest was checked except the digest over the page rows');
  });

  // What that leniency must NOT cost. checkManifest verifies recordsDigest and
  // envelopeDigest BEFORE it reaches the page rows, so tampering with the
  // record set in a bare envelope still fails, and its completeness claim is
  // still an earned one rather than the file's own word.
  it('a bare envelope still fails when its record set is edited', () => {
    const m = PAYLOAD_RE.exec(signedHtml);
    const data = JSON.parse(m![2]) as { records: ForensicRecord[] };
    data.records = data.records.slice(0, -1);
    const file = join(dir, 'envelope-head-removed.json');
    writeFileSync(file, JSON.stringify(data), 'utf8');
    const { report, code } = run(file);
    expect(code).toBe(2);
    expect(report.failures[0]).toMatchObject({ reason: 'manifest', detail: 'records' });
  });

  it('opens the time-stamp tokens: the key dated by a recognised authority, an anchor over a hash not in the file, a self-minted token, a failed imprint', async () => {
    // The keygen fixture is a real P-256 key whose x|y digest FreeTSA stamped
    // on 2026-09-04; its private half signs the records and the manifest, so
    // the file is fully consistent and the genesis token is over ITS key.
    const FIX = join(process.cwd(), 'tests', 'fixtures', 'rfc3161');
    const key = JSON.parse(readFileSync(join(FIX, 'keygen-key.json'), 'utf8')) as { publicJwk: JsonWebKey; privateJwk: JsonWebKey; publicKeyDigest: string };
    const priv = await crypto.subtle.importKey('jwk', key.privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
    const jwk: JsonWebKey = { kty: 'EC', crv: 'P-256', x: key.publicJwk.x, y: key.publicJwk.y };
    const fp = await fingerprint(jwk);
    expect(key.publicKeyDigest.startsWith(fp)).toBe(true);
    const sign = async (hash: string): Promise<string> =>
      b64u(await crypto.subtle.sign({ name: 'ECDSA', hash: { name: 'SHA-256' } }, priv, new TextEncoder().encode(hash)));
    const der = (name: string): string => readFileSync(join(FIX, name)).toString('base64');
    const FIXTURE_HASH = '7dfe00431171bc9572dc376aff313d9e25918f114e41efd066243572d9ed3cbe';
    const FORGED_HASH = 'f234ff9e567d48d727a2849d07276ef32ec3f8c088aa850842b883ccbb817cde';

    const records: ForensicRecord[] = [];
    let prev = '';
    for (let i = 0; i < 2; i++) {
      const base = {
        id: `k-${i}`, timestamp: `2026-09-04T10:00:0${i}.000Z`, platform: 'tiktok', originalText: `post ${i}`, originalHash: 'h',
        originalLength: 6, neutralizedText: '', author: '@user', postUrl: '', techniques: [], overallScore: 0, userAgeCategory: 'adult',
        aiSource: 'cloud', feedSource: 'for-you', publicKeyFingerprint: fp, chainPosition: i, prevRecordHash: prev, kind: 'post', verdict: 'pass',
      } as Omit<ForensicRecord, 'integrityHash' | 'signature' | 'chainAnchor'>;
      const integrityHash = await computeRecordIntegrityHash(base);
      records.push({ ...base, integrityHash, signature: await sign(integrityHash) } as ForensicRecord);
      prev = integrityHash;
    }
    const genesis = { publicKeyDigest: key.publicKeyDigest, fingerprint: fp, anchors: [{ tsaProvider: 'freetsa', route: 'direct', responseB64: der('keygen-resp.der'), tstB64: '', generalizedTime: null, requestedAt: '' }] };
    const anchorOf = (position: number, hash: string, file: string, provider: string) => ({
      id: `a-${position}`, anchoredChainPosition: position, anchoredIntegrityHash: hash, tsaProvider: provider, responseB64: der(file), tstB64: '', generalizedTime: null, requestedAt: '2026-09-04T10:00:00.000Z', route: 'direct',
    });

    // 1. Key dated, no chain anchors: VERIFIED and the headline names FreeTSA.
    const dated = await attachSignedManifest(buildForensicHtmlExport(records, { fwVersion: 'V-test', publicKeyJwk: jwk, publicKeyFingerprint: fp, locale: 'en', keyGenesis: genesis as never }), sign);
    const f1 = join(dir, 'dated.html');
    writeFileSync(f1, dated, 'utf8');
    const r1 = run(f1);
    expect(r1.code).toBe(0);
    const ts1 = (r1.report as unknown as { timestamps: { anchors: unknown[]; keyGenesis: { existedBy: string | null; authorities: string[]; expectedDigest: string } } }).timestamps;
    expect(ts1.anchors).toEqual([]);
    expect(ts1.keyGenesis.expectedDigest).toBe(key.publicKeyDigest);
    expect(ts1.keyGenesis.authorities).toEqual(['FreeTSA (freetsa.org) Root CA']);
    expect(ts1.keyGenesis.existedBy).toMatch(/^2026-09-04T/);
    expect(runText(f1).text).toContain('The signing key existed no later than 2026-09-04T');

    // 2. Three chain anchors: a real FreeTSA token over a hash this file does
    //    not carry, the self-minted token over its own hash, and a real
    //    DigiCert token asked to vouch for a record hash it never stamped.
    const anchors = [
      anchorOf(0, FIXTURE_HASH, 'freetsa-resp.der', 'freetsa'),
      anchorOf(1, FORGED_HASH, 'forged-selfminted-resp.der', 'digicert'),
      anchorOf(1, records[1].integrityHash, 'digicert-resp.der', 'digicert'),
    ];
    const anchored = await attachSignedManifest(buildForensicHtmlExport(records, { fwVersion: 'V-test', publicKeyJwk: jwk, publicKeyFingerprint: fp, locale: 'en', keyGenesis: genesis as never, anchors: anchors as never }), sign);
    const f2 = join(dir, 'anchored.html');
    writeFileSync(f2, anchored, 'utf8');
    const r2 = run(f2);
    expect(r2.code).toBe(1);
    expect(r2.report.state).toBe('partial');
    const ts2 = (r2.report as unknown as { timestamps: { anchors: Array<{ position: number; ok: boolean; authority: string | null; failed: string[] }> } }).timestamps;
    expect(ts2.anchors.map((a) => [a.position, a.ok, a.authority, a.failed])).toEqual([
      [0, true, 'FreeTSA (freetsa.org) Root CA', []],
      [1, true, null, ['known-root']],
      [1, false, 'DigiCert Trusted Root G4', ['message-imprint']],
    ]);
    const text2 = runText(f2).text;
    expect(text2).toContain('1 verified under a recognised authority (FreeTSA (freetsa.org) Root CA); 1 under an authority this checker does not recognise; 1 failed.');
    expect(text2).toContain('anyone can run a timestamping service');
    expect(text2).toContain('position 1: failed message-imprint.');
    expect(text2).toContain('record(s) stamped by an outside time-stamp service are not in this file');
  });

  // M187, 2026-09-18. The provenance rows used to be read with one regex whose
  // lazy body scanned to the end of the file when an opener had no close, so a
  // file of unclosed openers cost its own length once per opener: measured at
  // 216ms for 2,000 openers and 22 seconds for 128,000, four times the work each
  // time the file doubled. It runs before the key is imported and before the
  // manifest is checked, on a file somebody else handed you.
  //
  // A real export carries 7 rows whose longest body is 502 characters, so this
  // file is 4,000 times the rows of a real one. The bound is on openers looked
  // at, not rows kept, which is what makes the work independent of the file's
  // size. The ceiling here is deliberately loose: the point is the difference
  // between "finishes" and "the tab is gone", not a stopwatch.
  it('does not hang on a file built to make the row reader scan forever', () => {
    const file = join(dir, 'hostile-rows.html');
    writeFileSync(file, `${'<dd data-fw-prov="a">'.repeat(30000)}${'x'.repeat(200000)}`, 'utf8');
    const started = Date.now();
    let code = 0;
    try { execFileSync(process.execPath, [STANDALONE_VERIFIER_PATH, file], { encoding: 'utf8', stdio: 'pipe' }); }
    catch (err) { code = (err as { status: number }).status; }
    const elapsed = Date.now() - started;
    // It is not an export, so the verdict is the same one every non-export gets.
    expect(code).toBe(3);
    expect(elapsed, `took ${elapsed}ms`).toBeLessThan(10000);
  });

  it('exits 3 on a file that is not an export: no payload, a JSON object with no records, a JSON array', () => {
    const cases: Array<[string, string]> = [
      ['not-an-export.html', '<!DOCTYPE html><p>hello</p>'],
      ['empty-object.json', '{}'],
      ['no-key.json', '{"records":[]}'],
      ['array.json', '[]'],
      ['payload-without-records.html', '<script type="application/json" id="fw-export-data">{"publicKeyJwk":{}}</script>'],
    ];
    for (const [name, body] of cases) {
      const file = join(dir, name);
      writeFileSync(file, body, 'utf8');
      let code = 0;
      let stderr = '';
      try { execFileSync(process.execPath, [STANDALONE_VERIFIER_PATH, file], { encoding: 'utf8', stdio: 'pipe' }); }
      catch (err) { code = (err as { status: number; stderr: string }).status; stderr = (err as { stderr: string }).stderr; }
      expect(code, name).toBe(3);
      expect(stderr, name).toContain('not a FeelingWise export');
    }
  });

  it('tells a reader who sent a bare JSON array what is actually wrong', () => {
    // The case above has held `[]` since it was written and asserts only the
    // shared prefix, which is why the misleading half of the sentence survived
    // in it. Until 2026-09-21 a bare array fell through to the HTML branch and
    // was answered "no fw-export-data payload", sending a reader to look for a
    // wrapper that was never the problem. Exporting the records array on its
    // own is the obvious way to arrive here, and receive-export.mjs relays this
    // same sentence to whoever POSTed the file.
    const dir = mkdtempSync(join(tmpdir(), 'fw-standalone-array-'));
    const file = join(dir, 'array.json');
    writeFileSync(file, '[]', 'utf8');
    let stderr = '';
    try { execFileSync(process.execPath, [STANDALONE_VERIFIER_PATH, file], { encoding: 'utf8', stdio: 'pipe' }); }
    catch (err) { stderr = (err as { stderr: string }).stderr; }

    expect(stderr).toContain('the payload is not an object');
    expect(stderr).not.toContain('fw-export-data payload');
  });
});
