/** @vitest-environment jsdom */
// The export's own recount of time-stamp coverage counts only tokens that pass its own check.
//
// Page one's signed row says what the install verified when each token arrived. The recount
// below it is made where the reader is, from the records and tokens in the file, so it opens
// each token itself and counts a stamp only when the token verifies under an authority the
// checker pins. A file whose tokens are broken reads 0, whatever the stored verdict says.

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoPath } from '../../helpers/repo-root';
import { buildForensicHtmlExport, type ExportMetadata } from '../../../src/forensics/html-export';
import { COMPLETENESS_SCRIPT } from '../../../src/forensics/html-export-scripts';
import { RFC3161_VERIFIER_SOURCE } from '../../../src/forensics/rfc3161-inline.generated';
import type { ForensicRecord } from '../../../src/types/forensic';
import type { ChainAnchor } from '../../../src/types/chain-anchor';

/** SHA-256 of `feelingwise-rfc3161-fixture-v1`: a real FreeTSA token in the fixtures stamps it. */
const FIXTURE_HASH = '7dfe00431171bc9572dc376aff313d9e25918f114e41efd066243572d9ed3cbe';
const FREETSA_RESPONSE = readFileSync(join(repoPath('tests', 'fixtures', 'rfc3161'), 'freetsa-resp.der')).toString('base64');

const META: ExportMetadata = { fwVersion: 'V1.0.0-test', publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'AAA', y: 'BBB' }, publicKeyFingerprint: 'fp16', locale: 'en' };

function rec(chainPosition: number, integrityHash: string): ForensicRecord {
  return {
    id: `r-${chainPosition}`, timestamp: `2026-09-0${chainPosition + 1}T10:00:00.000Z`, platform: 'twitter',
    originalText: `post ${chainPosition}`, originalHash: 'h', originalLength: 6, neutralizedText: '', author: '@a', postUrl: '',
    techniques: [], overallScore: 0, userAgeCategory: 'adult', aiSource: 'none', feedSource: 'for-you',
    integrityHash, signature: 'sig', publicKeyFingerprint: 'fp16', chainPosition, kind: 'post', verdict: 'pass',
  } as ForensicRecord;
}

function anchor(r: ForensicRecord, responseB64: string): ChainAnchor {
  return {
    id: `a-${r.id}`, anchoredChainPosition: r.chainPosition as number, anchoredIntegrityHash: r.integrityHash,
    tsaProvider: 'freetsa', responseB64, tstB64: '', generalizedTime: '2026-09-04T01:43:14Z',
    requestedAt: '2026-09-04T01:43:14.000Z', route: 'direct',
    verification: { ok: true, signerSubject: null, rootCertSha256: null, knownRootName: 'FreeTSA (freetsa.org) Root CA', checks: [] },
  };
}

async function recount(records: ForensicRecord[], anchors: ChainAnchor[]): Promise<string> {
  const html = buildForensicHtmlExport(records, { ...META, anchors });
  const m = html.match(/<script type="application\/json" id="fw-export-data">([\s\S]*?)<\/script>/);
  (window as unknown as { __FW_EXPORT__: unknown }).__FW_EXPORT__ = JSON.parse(m![1]);
  document.body.innerHTML = '<div id="fw-completeness"></div>';
  new Function(COMPLETENESS_SCRIPT)();
  const host = document.getElementById('fw-completeness') as HTMLElement;
  for (let i = 0; i < 200 && !/fall under a time stamp/.test(host.textContent ?? ''); i++) {
    await new Promise((r) => setTimeout(r, 10));
  }
  return host.textContent ?? '';
}

beforeAll(() => {
  for (const target of [globalThis, window] as unknown as Array<Record<string, unknown>>) {
    if (!(target.crypto as Crypto | undefined)?.subtle) Object.defineProperty(target, 'crypto', { value: webcrypto, configurable: true });
  }
  (window as unknown as { __FW_RFC3161__: unknown }).__FW_RFC3161__ =
    new Function(`${RFC3161_VERIFIER_SOURCE}; return __FW_RFC3161__;`)();
});

beforeEach(() => { document.body.innerHTML = ''; });

describe('the export recounts its stamps from tokens it checks itself', () => {
  it('a real token counts up to its record; a broken one counts nothing', async () => {
    const records = [rec(0, 'h0'), rec(1, FIXTURE_HASH), rec(2, 'h2')];
    const text = await recount(records, [anchor(records[1], FREETSA_RESPONSE), anchor(records[2], 'AAAA')]);
    expect(text).toContain('Positions 0 to 2: 2 of 3 records fall under a time stamp that passed this check');
  });

  it('two broken tokens read 0, whatever the stored verdict says', async () => {
    const records = [rec(0, 'h0'), rec(1, 'h1'), rec(2, 'h2')];
    const text = await recount(records, [anchor(records[1], 'AAAA'), anchor(records[2], 'AAAA')]);
    expect(text).toContain('Positions 0 to 2: 0 of 3 records fall under a time stamp that passed this check.');
  });
});
