// @vitest-environment jsdom
//
// Evidence-gap register item 6 (2026-09-06): the envelope is signed.
//
// Every number and every verdict sentence the reader relied on sat in an
// unsigned JSON envelope, so a file with records removed and its header edited
// to agree was fully self-consistent. Now the install signs a manifest over
// the envelope's records, anchors, keys, labels and wording; the embedded
// verifier recomputes the same digests from what the file carries, checks the
// signature under the file's own key first, and prints no verdict wording
// when it fails. The verdict sentences themselves are inlined into the script
// as code. This file drives the real signer and the embedded checker against
// each other, then tampers.

import { describe, it, expect } from 'vitest';
import { webcrypto } from 'node:crypto';
import {
  attachSignedManifest,
  buildForensicHtmlExport,
  FIXED_VERDICT_KEYS,
  I18N,
  manifestCanonical,
  extractProvenanceRows,
  verifierScript,
  VERIFIER_CORE_FNS_SOURCE,
  type ExportManifest,
  type ExportMetadata,
} from '../../../src/forensics/html-export';
import type { ForensicRecord } from '../../../src/types/forensic';

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}

const core = new Function(
  `"use strict";${VERIFIER_CORE_FNS_SOURCE}
   return { checkManifest: checkManifest, manifestCanonical: manifestCanonical, importPubKey: importPubKey, fingerprintJwk: fingerprintJwk, readProvenanceRows: readProvenanceRows };`,
)() as {
  checkManifest(data: unknown, pubKey: CryptoKey, fingerprint: string): Promise<string>;
  manifestCanonical(m: unknown): string;
  importPubKey(jwk: JsonWebKey): Promise<CryptoKey>;
  fingerprintJwk(jwk: JsonWebKey): Promise<string>;
  readProvenanceRows(): Array<[string, string]>;
};

async function keypair() {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const full = await crypto.subtle.exportKey('jwk', kp.publicKey);
  const jwk: JsonWebKey = { kty: 'EC', crv: 'P-256', x: full.x, y: full.y };
  const sign = async (hash: string): Promise<string> => {
    const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: { name: 'SHA-256' } }, kp.privateKey, new TextEncoder().encode(hash));
    return Buffer.from(sig).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
  return { jwk, fp: await core.fingerprintJwk(jwk), pub: await core.importPubKey(jwk), sign };
}

function rec(i: number): ForensicRecord {
  return {
    id: `r-${i}`, timestamp: `2026-07-01T10:00:0${i}.000Z`, platform: 'tiktok', originalText: `post ${i} <b>&`, originalHash: 'h',
    originalLength: 6, neutralizedText: '', author: '@user', postUrl: '', techniques: [], overallScore: 0, userAgeCategory: 'teen',
    aiSource: 'cloud', feedSource: 'for-you', integrityHash: 'deadbeef', signature: 'sig', publicKeyFingerprint: 'fp',
    chainPosition: i, kind: 'post', verdict: 'pass',
  } as ForensicRecord;
}

/**
 * Put the built page in the document, the way a recipient's browser has it.
 * The manifest's provenanceDigest is checked against the rows as rendered, so
 * the checker needs the real DOM and not only the payload.
 */
function render(html: string): void {
  document.documentElement.innerHTML = html.replace(/[\s\S]*?<body>/, '').replace(/<\/body>[\s\S]*/, '');
}

function payloadOf(html: string): Record<string, unknown> & { manifest?: ExportManifest } {
  const m = html.match(/<script type="application\/json" id="fw-export-data">([\s\S]*?)<\/script>/);
  return JSON.parse(m![1]);
}

describe('attachSignedManifest and the embedded checkManifest', () => {
  it('signs the envelope the file carries, and the checker accepts it under the file key', async () => {
    const key = await keypair();
    const meta: ExportMetadata = { fwVersion: 'V-test', publicKeyJwk: key.jwk, publicKeyFingerprint: key.fp, locale: 'en' };
    const html = await attachSignedManifest(buildForensicHtmlExport([rec(0), rec(1), rec(2)], meta), key.sign);
    render(html);
    // The signer reads the rows out of the file; the recipient's browser reads
    // them out of the DOM. They must be the same string or the check is noise.
    expect(JSON.stringify(core.readProvenanceRows())).toBe(JSON.stringify(extractProvenanceRows(html)));
    const data = payloadOf(html);
    expect(data.manifest).toBeDefined();
    const m = data.manifest!;
    expect(m.version).toBe(2);
    expect(m.recordCount).toBe(3);
    expect(m.publicKeyFingerprint).toBe(key.fp);
    expect(core.manifestCanonical(m)).toBe(manifestCanonical(m));
    expect(await core.checkManifest(data, key.pub, key.fp)).toBe('ok');
    // The payload still parses as one JSON object with the `<` escape intact.
    expect(html).not.toMatch(/<script type="application\/json" id="fw-export-data">[^]*?<b>/);
    // Signing once is enough: a second pass leaves the file alone.
    expect(await attachSignedManifest(html, key.sign)).toBe(html);
  });

  // Found 2026-09-18 by an adversarial read of the export path, and it was
  // reachable: post text goes into the payload verbatim, so the six characters
  // below are a thing a stranger can write under a post the user is recording.
  // The signer used to un-escape the payload textually before parsing it, and
  // a doubled backslash turned that into `\<`, which no JSON parser accepts.
  // The export then went out unsigned, silently, and the recipient's checker
  // read the envelope as covered by nothing.
  it.each([
    ['the escape itself, written by a stranger', 'look at this: ' + String.fromCharCode(92) + 'u003c'],
    ['a doubled backslash before it', 'path C:' + String.fromCharCode(92, 92) + 'u003c'],
    ['the escape inside a longer run', String.fromCharCode(92) + 'u003cscript' + String.fromCharCode(92) + 'u003e'],
    ['a bare backslash at the end of the text', 'trailing ' + String.fromCharCode(92)],
    ['a real tag, which was always fine', 'a <script> b'],
  ])('a record whose text carries %s is still signed', async (_name, text) => {
    const key = await keypair();
    const meta: ExportMetadata = { fwVersion: 'V-test', publicKeyJwk: key.jwk, publicKeyFingerprint: key.fp, locale: 'en' };
    const hostile = { ...rec(0), originalText: text };
    const html = await attachSignedManifest(buildForensicHtmlExport([hostile, rec(1)], meta), key.sign);
    render(html);

    const data = payloadOf(html);
    expect(data.manifest, 'the export went out with no manifest').toBeDefined();
    expect(await core.checkManifest(data, key.pub, key.fp)).toBe('ok');
    // The text survives the round trip unchanged, which is the other half:
    // a file that signs but alters a record is worse than one that does not sign.
    expect((data.records as ForensicRecord[])[0].originalText).toBe(text);
    // And nothing that could close the script block is in the payload.
    const payloadText = html.slice(html.indexOf('id="fw-export-data">'), html.indexOf('</script>', html.indexOf('id="fw-export-data">')));
    expect(payloadText).not.toContain('<');
  });

  // Timed on this case: parsing the whole exported page in jsdom and over a hundred crypto calls take a
  // tenth of a second alone and seconds beside other test runs, so it gets 30 seconds, not the default 5.
  it('every kind of edit after signing is named, and a foreign key is refused', async () => {
    const key = await keypair();
    const other = await keypair();
    const meta: ExportMetadata = { fwVersion: 'V-test', publicKeyJwk: key.jwk, publicKeyFingerprint: key.fp, locale: 'en' };
    const html = await attachSignedManifest(buildForensicHtmlExport([rec(0), rec(1), rec(2)], meta), key.sign);
    render(html);
    const clean = () => payloadOf(html) as Record<string, unknown> & { manifest: ExportManifest; records: ForensicRecord[]; i18n: Record<string, string>; techLabels: Record<string, string>; anchors: unknown[] };

    const removed = clean(); removed.records = removed.records.slice(0, 2);
    expect(await core.checkManifest(removed, key.pub, key.fp)).toBe('records');
    const edited = clean(); edited.records[1] = { ...edited.records[1], originalText: 'something else' };
    expect(await core.checkManifest(edited, key.pub, key.fp)).toBe('records');
    const reworded = clean(); reworded.i18n.chainVerifiedBody = '';
    expect(await core.checkManifest(reworded, key.pub, key.fp)).toBe('wording');
    const relabelled = clean(); relabelled.techLabels['fear-appeal'] = 'harmless';
    expect(await core.checkManifest(relabelled, key.pub, key.fp)).toBe('labels');
    const anchored = clean(); anchored.anchors = [{ fake: true }];
    expect(await core.checkManifest(anchored, key.pub, key.fp)).toBe('anchors');
    const recounted = clean(); recounted.manifest = { ...recounted.manifest, recordCount: 3, recordsDigest: 'x'.repeat(64) };
    expect(await core.checkManifest(recounted, key.pub, key.fp)).toBe('records');
    const resigned = clean(); resigned.manifest = { ...resigned.manifest, generatedAt: '2020-01-01T00:00:00.000Z' };
    expect(await core.checkManifest(resigned, key.pub, key.fp)).toBe('digest');
    expect(await core.checkManifest(clean(), other.pub, key.fp)).toBe('signature');
    expect(await core.checkManifest(clean(), key.pub, other.fp)).toBe('key');
    // Register item 6, second pass: the provenance a reader is asked to
    // believe is inside the signature too. Before this each of these could be
    // rewritten with the manifest still verifying, and the row that says which
    // key was supplied with the records (item 12) was the sharpest of them.
    const relabelledKey = clean();
    (relabelledKey as Record<string, unknown>).keyOrigins = [{ fingerprint: 'fp', origin: 'generated-storage-empty', at: '2020-01-01T00:00:00.000Z' }];
    expect(await core.checkManifest(relabelledKey, key.pub, key.fp)).toBe('envelope');
    const reselected = clean();
    (reselected as Record<string, unknown>).selection = { drawnFrom: 99999, included: 3 };
    expect(await core.checkManifest(reselected, key.pub, key.fp)).toBe('envelope');
    const regenesis = clean();
    (regenesis as Record<string, unknown>).keyGenesis = { at: '2019-01-01T00:00:00.000Z' };
    expect(await core.checkManifest(regenesis, key.pub, key.fp)).toBe('envelope');
    const repointed = clean();
    (repointed as Record<string, unknown>).precisionDisclosure = 'above 99 percent of flags right';
    expect(await core.checkManifest(repointed, key.pub, key.fp)).toBe('envelope');
    const rekeyed = clean();
    (rekeyed as Record<string, unknown>).signingKeyCreatedAt = '2019-01-01T00:00:00.000Z';
    expect(await core.checkManifest(rekeyed, key.pub, key.fp)).toBe('envelope');

    // The rows a reader actually reads are signed as rendered: the envelope
    // digest covers the values, this covers the sentences drawn from them,
    // which are HTML a text editor can rewrite without touching the payload.
    const row = document.querySelector('dd[data-fw-prov="keyOrigin"]');
    expect(row).not.toBeNull();
    const wasText = row!.textContent;
    row!.textContent = 'this key was generated on this device';
    expect(await core.checkManifest(clean(), key.pub, key.fp)).toBe('page-rows');
    row!.textContent = wasText;
    expect(await core.checkManifest(clean(), key.pub, key.fp)).toBe('ok');
    const removedRow = document.querySelector('dd[data-fw-prov="precision"]')!;
    const parent = removedRow.parentNode!;
    parent.removeChild(removedRow);
    expect(await core.checkManifest(clean(), key.pub, key.fp)).toBe('page-rows');
    parent.appendChild(removedRow);

    // The disclosure block is a <p>, not a <dd>. It carried data-fw-prov from
    // the day it was written and the digest covered <dd> alone, so the one
    // sentence naming what the file reveals about its owner was the only
    // summary claim an editor could rewrite without breaking anything
    // (2026-09-08). Both the builder's regex and readProvenanceRows take dd
    // and p now; this is the pin that they still do.
    const discloses = document.querySelector('p[data-fw-prov="discloses"]');
    expect(discloses).not.toBeNull();
    const wasDisclosure = discloses!.textContent;
    discloses!.textContent = 'This file says nothing about you.';
    expect(await core.checkManifest(clean(), key.pub, key.fp)).toBe('page-rows');
    discloses!.textContent = wasDisclosure;
    expect(await core.checkManifest(clean(), key.pub, key.fp)).toBe('ok');

    // A file made by the first build of the manifest reads partial, not broken.
    const legacy = clean();
    legacy.manifest = { ...legacy.manifest, version: 1 as unknown as 2 };
    expect(await core.checkManifest(legacy, key.pub, key.fp)).toBe('legacy');

    const bare = clean(); delete (bare as { manifest?: unknown }).manifest;
    expect(await core.checkManifest(bare, key.pub, key.fp)).toBe('missing');
  }, 30_000);

  it('a document that cannot be signed is returned unchanged', async () => {
    const meta: ExportMetadata = { fwVersion: 'V-test', publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'A', y: 'B' }, publicKeyFingerprint: 'fp', locale: 'en' };
    const html = buildForensicHtmlExport([rec(0)], meta);
    expect(await attachSignedManifest(html, async () => { throw new Error('no key'); })).toBe(html);
    expect(await attachSignedManifest('<p>not an export</p>', async () => 'sig')).toBe('<p>not an export</p>');
  });
});

describe('the verdict wording is code, and the verifier gates on the manifest', () => {
  it('verifierScript inlines the fixed sentences for the locale and reads none of them from the envelope', () => {
    for (const locale of ['en', 'ro', 'es', 'pt-BR'] as const) {
      const script = verifierScript(I18N[locale]);
      expect(script.startsWith('(function(){var FIXED={')).toBe(true);
      const fixed = JSON.parse(script.slice('(function(){var FIXED='.length, script.indexOf('};') + 1)) as Record<string, string>;
      for (const k of FIXED_VERDICT_KEYS) expect(fixed[k], `${locale}.${k}`).toBe(I18N[locale][k]);
      for (const k of FIXED_VERDICT_KEYS) expect(script).not.toContain(`i18n.${k}`);
      expect(script).toContain('FIXED.chainVerified');
      expect(script).toContain('FIXED.chainVerifiedBody');
    }
  });

  it('the built page carries the per-locale script and the manifest gate before any verdict', () => {
    const html = buildForensicHtmlExport([rec(0)], { fwVersion: 'V', publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'A', y: 'B' }, publicKeyFingerprint: 'fp', locale: 'ro' });
    expect(html).toContain(`var FIXED=${JSON.stringify(Object.fromEntries(FIXED_VERDICT_KEYS.map(k => [k, I18N.ro[k]])))}`.replace(/</g, '\\u003c'));
    const gate = html.indexOf("var manifestState=await checkManifest(window.__FW_EXPORT__,keySetup.pubKey,keySetup.fingerprint);");
    // The verified header names the report's selection when the file states one, and the plain verdict otherwise.
    const verdict = html.indexOf(':FIXED.chainVerified]));');
    expect(gate).toBeGreaterThan(0);
    expect(verdict).toBeGreaterThan(gate);
    expect(html).toContain("if((manifestState==='missing'||manifestState==='legacy')&&state==='verified') state='partial';");
    expect(html).toContain("if(manifestState!=='ok'&&manifestState!=='missing'&&manifestState!=='legacy'){");
  });

  it('every interface language carries both manifest sentences', () => {
    for (const locale of Object.keys(I18N) as Array<keyof typeof I18N>) {
      expect(I18N[locale].manifestFailed.length).toBeGreaterThan(40);
      expect(I18N[locale].manifestMissing.length).toBeGreaterThan(40);
    }
  });
});
