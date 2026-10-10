// The export must CHECK its time anchors, not just print them.
//
// Before 2026-09-04 the anchors section showed a "TSA-claimed time" that was a
// string the FeelingWise Worker had scanned out of the token and handed to the
// client. Nothing compared the token to the hash it was supposed to cover, and
// nothing verified the signature, so the section asserted a fact no code had
// established. The export's own docblock said "V1.5 will add offline
// cryptographic verification of the TST bytes."
//
// These tests lock the wiring: the compiled verifier is in the file, each
// anchor gets a slot for its result, and - the part that matters - the fields
// the export actually embeds are enough to verify a genuine token. That last
// test is the one that catches a wiring mistake: if the export embedded the
// wrong base64 field, or the hash it claims was anchored did not match, the
// verification would fail here rather than in front of a recipient.

import { describe, it, expect } from 'vitest';
import { repoPath } from '../../helpers/repo-root';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { webcrypto } from 'node:crypto';
import { buildForensicHtmlExport, type ExportMetadata } from '../../../src/forensics/html-export';
import { RFC3161_VERIFIER_SOURCE } from '../../../src/forensics/rfc3161-inline.generated';
import type { ForensicRecord } from '../../../src/types/forensic';
import type { ChainAnchor } from '../../../src/forensics/chain-anchor-store';
import { buildMethodologyBlock } from '../../../src/forensics/methodology';

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}

/** SHA-256 of `feelingwise-rfc3161-fixture-v1`, the hash both fixtures stamp. */
const FIXTURE_HASH = '7dfe00431171bc9572dc376aff313d9e25918f114e41efd066243572d9ed3cbe';

const FIXTURES = repoPath('tests', 'fixtures', 'rfc3161');

function fixtureB64(name: string): string {
  return readFileSync(join(FIXTURES, name)).toString('base64');
}

const META: ExportMetadata = {
  fwVersion: 'V1.0.0-test',
  publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'AAA', y: 'BBB' },
  publicKeyFingerprint: 'a3f9c2e1deadbeef',
  locale: 'en',
};

function record(): ForensicRecord {
  return {
    id: 'r-1',
    timestamp: '2026-09-03T12:00:00Z',
    platform: 'twitter',
    originalText: 'sample post',
    originalHash: 'abc123',
    originalLength: 11,
    neutralizedText: '',
    author: '@example',
    postUrl: 'https://x.com/example/status/1',
    techniques: [],
    overallScore: 0.1,
    userAgeCategory: 'adult',
    aiSource: 'cloud',
    feedSource: 'for-you',
    integrityHash: FIXTURE_HASH,
    signature: 'sig',
    publicKeyFingerprint: 'a3f9c2e1deadbeef',
    chainPosition: 0,
  };
}

/**
 * An anchor in the exact shape the store writes, over a real token. The token
 * really was stamped over FIXTURE_HASH, so a correct export can verify it and
 * an incorrectly wired one cannot.
 */
function anchor(name: string, over: Partial<ChainAnchor> = {}): ChainAnchor {
  return {
    id: `anchor-${name}`,
    anchoredChainPosition: 0,
    anchoredIntegrityHash: FIXTURE_HASH,
    tsaProvider: name,
    responseB64: fixtureB64(`${name}-resp.der`),
    tstB64: '',
    generalizedTime: '2026-09-04T01:43:14Z',
    requestedAt: '2026-09-04T01:43:14.000Z',
    route: 'direct',
    ...over,
  };
}

interface InlineApi {
  verifyAnchorBase64(
    input: { tst?: string | null; response?: string | null },
    expectedHashHex: string | null,
  ): Promise<{ ok: boolean; genTime: string | null; checks: { name: string; ok: boolean }[] }>;
}

function loadInline(): InlineApi {
  return new Function(`${RFC3161_VERIFIER_SOURCE}; return __FW_RFC3161__;`)() as InlineApi;
}

describe('export carries the anchor verifier', () => {
  it('inlines the compiled verifier and the script that drives it', () => {
    const html = buildForensicHtmlExport([record()], { ...META, anchors: [anchor('freetsa')] });
    expect(html).toContain('__FW_RFC3161__');
    expect(html).toContain('verifyAnchorBase64');
    // The generated bundle, not a hand-written second copy.
    expect(html).toContain(RFC3161_VERIFIER_SOURCE);
  });

  it('gives every anchor a slot for its result, in the order the section sorts', () => {
    const html = buildForensicHtmlExport([record()], {
      ...META,
      anchors: [
        anchor('digicert', { anchoredChainPosition: 40 }),
        anchor('freetsa', { anchoredChainPosition: 10 }),
      ],
    });
    expect(html).toContain('data-anchor-check="0"');
    expect(html).toContain('data-anchor-check="1"');
    // Sorted ascending by position, so slot 0 belongs to the position-10 anchor.
    expect(html.indexOf('data-anchor-index="0"')).toBeLessThan(html.indexOf('data-anchor-index="1"'));
  });

  it('carries a third headline for an authority it does not recognise', () => {
    // The forged fixture passes every check a forger controls. Printing
    // "every check passed" over it, directly above a red cross on the one
    // check that looks outside the token, was the overclaim. The amber string
    // has to exist in the file for the script to reach for it.
    const html = buildForensicHtmlExport([record()], { ...META, anchors: [anchor('freetsa')] });
    expect(html).toContain('this page does not recognise the authority that signed it');
    expect(html).toContain('Anyone can run a timestamping service and sign their own tokens');
    // And the green one now says what it means.
    expect(html).toContain('the authority that signed is one this page recognises');
  });

  it('renders the completeness block without anyone pressing Verify', () => {
    // The page-one summary is static HTML written when the file was made. A
    // recipient who reads the document without clicking used to see only that.
    const html = buildForensicHtmlExport([record()], META);
    expect(html).toContain('id="fw-completeness"');
    // Placed above the button, not inside the results the button fills.
    expect(html.indexOf('id="fw-completeness"')).toBeLessThan(html.indexOf('id="fw-verify-btn"'));
  });

  it('says plainly what a reader without JavaScript is left with', () => {
    const html = buildForensicHtmlExport([record()], { ...META, anchors: [anchor('freetsa')] });
    expect(html).toContain('This check needs JavaScript');
  });

  it('no longer tells the reader to go and use OpenSSL for the whole job', () => {
    const html = buildForensicHtmlExport([record()], { ...META, anchors: [anchor('freetsa')] });
    expect(html).toContain('This page checks each timestamp in your browser');
    // The honesty line about qualified status has to survive copy edits.
    expect(html).toContain('qualified trust service provider');
  });
});

describe('the key-genesis block travels and is checked against the key in the file', () => {
  const keyFixture = JSON.parse(
    readFileSync(join(FIXTURES, 'keygen-key.json'), 'utf8'),
  ) as { publicJwk: JsonWebKey; publicKeyDigest: string };
  const keyToken = readFileSync(join(FIXTURES, 'keygen-resp.der')).toString('base64');

  const withGenesis = () => buildForensicHtmlExport([record()], {
    ...META,
    publicKeyJwk: keyFixture.publicJwk,
    keyGenesis: {
      publicKeyDigest: keyFixture.publicKeyDigest,
      fingerprint: keyFixture.publicKeyDigest.slice(0, 16),
      anchors: [{
        tsaProvider: 'freetsa', route: 'direct', responseB64: keyToken, tstB64: '',
        generalizedTime: '2026-09-04T02:00:00Z', requestedAt: '2026-09-04T02:00:00.000Z',
      }],
    },
  });

  it('renders the section with a slot per stamp', () => {
    const html = withGenesis();
    expect(html).toContain('When the signing key first existed');
    expect(html).toContain('data-keygen-check="0"');
    expect(html).toContain('data-keygen-headline');
  });

  it('states the limit of the claim on the page, not only in the code', () => {
    const html = withGenesis();
    expect(html).toContain('does not show that the key stayed with one person');
  });

  // The tester's line 107 (9 Oct 2026): a file whose key was stamped also said it carried no time stamp from an outside
  // service. With the key stamped and no stamp over the records, the records' section now says which is which.
  it('with the key stamped and no record stamped, does not say the file carries no time stamp at all', () => {
    const html = withGenesis();
    expect(html).not.toContain('<em>This export carries no time stamp from an outside service');
    expect(html).toContain('The signing key itself was stamped, as the section above shows: that dates the key, not the records.');
  });

  it('with no stamp anywhere, still says the export carries none', () => {
    expect(buildForensicHtmlExport([record()], META)).toContain('<em>This export carries no time stamp from an outside service');
  });

  it('says so plainly when no stamp was taken', () => {
    const html = buildForensicHtmlExport([record()], META);
    expect(html).toContain('No timestamp was taken over the signing key');
  });

  it('the embedded token verifies against the digest recomputed from the embedded key', async () => {
    const html = withGenesis();
    const m = html.match(/<script type="application\/json" id="fw-export-data">([\s\S]*?)<\/script>/);
    const payload = JSON.parse(m![1].replace(/\u003c/g, '<'));
    // Exactly what the inline script does: derive the digest from the key in
    // the file rather than trusting the stored publicKeyDigest.
    const jwk = payload.publicKeyJwk;
    const d = await crypto.subtle.digest(
      'SHA-256', new TextEncoder().encode(`${jwk.x}|${jwk.y}`),
    );
    const derived = Array.from(new Uint8Array(d)).map(b => b.toString(16).padStart(2, '0')).join('');
    expect(derived).toBe(keyFixture.publicKeyDigest);

    const v = await loadInline().verifyAnchorBase64(
      { tst: payload.keyGenesis.anchors[0].tstB64, response: payload.keyGenesis.anchors[0].responseB64 },
      derived,
    );
    expect(v.ok).toBe(true);
  });

  it('a stamp over some other key fails the imprint check', async () => {
    const html = withGenesis();
    const m = html.match(/<script type="application\/json" id="fw-export-data">([\s\S]*?)<\/script>/);
    const payload = JSON.parse(m![1].replace(/\u003c/g, '<'));
    const v = await loadInline().verifyAnchorBase64(
      { response: payload.keyGenesis.anchors[0].responseB64 }, 'a'.repeat(64),
    );
    expect(v.ok).toBe(false);
    expect(v.checks.find(c => c.name === 'message-imprint')?.ok).toBe(false);
  });
});

describe('the file says which file it is', () => {
  it('renders when it was made, what made it, how many entries and the key', () => {
    const html = buildForensicHtmlExport([record()], {
      ...META,
      signingKeyCreatedAt: '2026-08-01T09:00:00.000Z',
      methodology: { ...buildMethodologyBlock('2.4.0'), generatedAt: '2026-09-04T05:00:00.000Z' },
    });
    expect(html).toContain('This file');
    // generatedAt and extensionVersion were computed and rendered nowhere
    // until 2026-09-04, so the document could not say when it was created or
    // which build created it.
    expect(html).toContain('2026-09-04T05:00:00.000Z');
    expect(html).toContain('2.4.0');
    expect(html).toContain('2026-08-01T09:00:00.000Z');
    expect(html).toContain(META.publicKeyFingerprint);
    expect(html).toContain('data-file-digest');
  });

  it('leaves the digest to the reader rather than asserting one', () => {
    const html = buildForensicHtmlExport([record()], META);
    // A file cannot carry a hash of itself, and a value the reader derives is
    // worth more than one the file asserts.
    expect(html).toContain('Computed in your browser from the entries this file carries');
  });

  it('omits rows it has no value for instead of printing blanks', () => {
    const withKey = buildForensicHtmlExport([record()], {
      ...META, signingKeyCreatedAt: '2026-08-01T09:00:00.000Z',
    });
    const without = buildForensicHtmlExport([record()], META);
    // The label is in the embedded i18n table either way, so assert on the
    // rendered row rather than on the string appearing anywhere in the file.
    const row = '<dt data-fw-prov="keyCreated.label">Key first stored on that computer (its own clock):</dt>';
    expect(withKey).toContain(row);
    expect(without).not.toContain(row);
  });
});

describe('what the export embeds is enough to verify a real token', () => {
  for (const name of ['freetsa', 'digicert']) {
    it(`verifies the embedded ${name} anchor from the payload alone`, async () => {
      const html = buildForensicHtmlExport([record()], { ...META, anchors: [anchor(name)] });
      const m = html.match(/<script type="application\/json" id="fw-export-data">([\s\S]*?)<\/script>/);
      expect(m).not.toBeNull();
      const payload = JSON.parse(m![1].replace(/\\u003c/g, '<'));
      const embedded = payload.anchors[0];

      const v = await loadInline().verifyAnchorBase64(
        { tst: embedded.tstB64, response: embedded.responseB64 },
        embedded.anchoredIntegrityHash,
      );
      expect(v.ok).toBe(true);
      expect(v.checks.find(c => c.name === 'message-imprint')?.ok).toBe(true);
      expect(v.checks.find(c => c.name === 'signature')?.ok).toBe(true);
    });
  }

  it('reads the time from the token, which is what the page then shows', async () => {
    const v = await loadInline().verifyAnchorBase64(
      { response: fixtureB64('freetsa-resp.der') }, FIXTURE_HASH,
    );
    // openssl ts -reply -text on the fixture: Sep 4 01:43:14 2026 GMT.
    expect(v.genTime).toBe('2026-09-04T01:43:14Z');
  });

  it('fails when the anchor claims a hash the token does not cover', async () => {
    const v = await loadInline().verifyAnchorBase64(
      { response: fixtureB64('freetsa-resp.der') }, 'b'.repeat(64),
    );
    expect(v.ok).toBe(false);
    expect(v.checks.find(c => c.name === 'message-imprint')?.ok).toBe(false);
  });
});
