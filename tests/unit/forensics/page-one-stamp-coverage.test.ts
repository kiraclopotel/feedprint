// Page one says, per run, how many records fall under a time stamp.
//
// Read on a real two-run export: page one gave the newest run's range only, the older run's
// stamps reached part way through it, and the newest run had none. Read together, the range and
// the stamp list looked like full coverage, and neither the page nor the checker said what share
// of the records a stamp stood behind.
//
// A stamp names one record hash. Every record before it in the same run is fixed by it through
// the hash links, so a record falls under a stamp when a stamp in the file names it or a later
// record of its own run. Counted inside each run: a later run's stamp is not carried back. And
// only a stamp whose token checked counts: page one counts what the install verified when the
// token arrived; each checker counts what passes its own check of the token, so a file carrying
// two broken tokens says 0, not 6, of its first run.
//
// The two-run shape below is that export's, scaled down: the first run stamped part way, the
// second not at all.

import { beforeAll, describe, expect, it } from 'vitest';
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoPath } from '../../helpers/repo-root';
import { pathToFileURL } from 'node:url';
import type { ForensicRecord } from '../../../src/types/forensic';
import type { ChainAnchor } from '../../../src/types/chain-anchor';
import { computeRecordIntegrityHash } from '../../../src/forensics/canonical-payload';
import {
  attachSignedManifest,
  buildForensicHtmlExport,
  computeStampCoverage,
  extractProvenanceRows,
  VERIFIER_CORE_FNS_SOURCE,
} from '../../../src/forensics/html-export';
import { STANDALONE_VERIFIER_PATH } from '../../../scripts/build-standalone-verifier';

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}

type RunCoverage = { first: number; last: number; records: number; stamped: number; newest: string | null };
type Report = { state: string; manifest: string; stampCoverage?: RunCoverage[] };
type Checker = { verifyExportText(text: string): Promise<Report>; describe(report: Report, lang?: string): string };

let jwk: JsonWebKey;
let fingerprint = '';
let sign: (hash: string) => Promise<string>;
let checker: Checker;
let core: { stampCoverage(records: unknown[], anchors: unknown[]): RunCoverage[] };

beforeAll(async () => {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const full = await crypto.subtle.exportKey('jwk', kp.publicKey);
  jwk = { kty: 'EC', crv: 'P-256', x: full.x, y: full.y };
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${full.x}|${full.y}`));
  fingerprint = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
  sign = async (hash: string) => {
    const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: { name: 'SHA-256' } }, kp.privateKey, new TextEncoder().encode(hash));
    return Buffer.from(sig).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
  checker = await import(/* @vite-ignore */ pathToFileURL(STANDALONE_VERIFIER_PATH).href) as Checker;
  core = new Function(`"use strict";${VERIFIER_CORE_FNS_SOURCE}\nreturn { stampCoverage };`)() as typeof core;
});

/** One run of signed records, each linked to the one before it; a month marker opens a later run. */
async function run(month: string, n: number, priorChainHash?: string): Promise<ForensicRecord[]> {
  const out: ForensicRecord[] = [];
  let prev = '';
  for (let i = 0; i < n; i++) {
    const opener = i === 0 && priorChainHash !== undefined;
    const base = {
      id: `${month}-${i}`, timestamp: `${month}-0${i + 1}T10:00:00.000Z`, platform: 'tiktok', originalText: `post ${i}`,
      originalHash: 'h', originalLength: 6, neutralizedText: '', author: '@user', postUrl: '', techniques: [],
      overallScore: 0, userAgeCategory: 'adult', aiSource: 'cloud', feedSource: 'for-you',
      publicKeyFingerprint: fingerprint, chainPosition: i,
      prevRecordHash: opener ? 'feelingwise-chain-genesis-v1' : prev,
      ...(opener ? { kind: 'month-rotation-marker', priorChainHash } : { kind: 'post', verdict: 'pass' }),
    } as Omit<ForensicRecord, 'integrityHash' | 'signature' | 'chainAnchor'>;
    const integrityHash = await computeRecordIntegrityHash(base);
    out.push({ ...base, integrityHash, signature: await sign(integrityHash) } as ForensicRecord);
    prev = integrityHash;
  }
  return out;
}

/** The install's own check at arrival, as the store writes it. */
const CHECKED: ChainAnchor['verification'] = {
  ok: true, signerSubject: null, rootCertSha256: null, knownRootName: 'FreeTSA (freetsa.org) Root CA', checks: [],
};

function anchor(r: ForensicRecord, at: string, verification: ChainAnchor['verification'] = CHECKED): ChainAnchor {
  return {
    id: `a-${r.id}`, anchoredChainPosition: r.chainPosition as number, anchoredIntegrityHash: r.integrityHash,
    tsaProvider: 'freetsa', responseB64: '', tstB64: 'AAAA', generalizedTime: at, requestedAt: at, route: 'direct',
    ...(verification ? { verification } : {}),
  };
}

/** SHA-256 of `feelingwise-rfc3161-fixture-v1`: a real FreeTSA token in the fixtures stamps it. */
const FIXTURE_HASH = '7dfe00431171bc9572dc376aff313d9e25918f114e41efd066243572d9ed3cbe';
const FREETSA_RESPONSE = readFileSync(join(repoPath('tests', 'fixtures', 'rfc3161'), 'freetsa-resp.der')).toString('base64');

/** September 0..9 stamped at positions 2 and 5; October 0..5, opened by a linked rotation marker, no stamp. */
async function twoRuns(): Promise<{ records: ForensicRecord[]; anchors: ChainAnchor[] }> {
  const sep = await run('2026-09', 10);
  const oct = await run('2026-10', 6, sep[9].integrityHash);
  return {
    records: [...sep, ...oct],
    anchors: [anchor(sep[2], '2026-09-03T10:05:00Z'), anchor(sep[5], '2026-09-06T10:05:00Z')],
  };
}

const EXPECTED: RunCoverage[] = [
  { first: 0, last: 9, records: 10, stamped: 6, newest: '2026-09-06T10:05:00Z' },
  { first: 0, last: 5, records: 6, stamped: 0, newest: null },
];

async function signedExport(records: ForensicRecord[], anchors: ChainAnchor[]): Promise<string> {
  const html = buildForensicHtmlExport(records, {
    fwVersion: 'FeelingWise V2.5.16', publicKeyJwk: jwk, publicKeyFingerprint: fingerprint, locale: 'en', anchors,
  });
  return attachSignedManifest(html, sign);
}

describe('how many records fall under a time stamp, per run', () => {
  it('counts each run on its own: the stamped part of the first, nothing of the second', async () => {
    const { records, anchors } = await twoRuns();
    expect(computeStampCoverage(records, anchors)).toEqual(EXPECTED);
  });

  it('the checker core a recipient runs counts exactly what page one counts', async () => {
    const { records, anchors } = await twoRuns();
    expect(core.stampCoverage(records, anchors)).toEqual(computeStampCoverage(records, anchors));
  });

  it('a stamp whose position does not match its record, or whose record is absent, counts nothing', async () => {
    const { records, anchors } = await twoRuns();
    const wrongPosition = { ...anchors[1], anchoredChainPosition: 9 };
    const absent = { ...anchors[1], anchoredIntegrityHash: 'f'.repeat(64) };
    for (const a of [wrongPosition, absent]) {
      const got = computeStampCoverage(records, [anchors[0], a]);
      expect(got[0]).toEqual({ first: 0, last: 9, records: 10, stamped: 3, newest: '2026-09-03T10:05:00Z' });
      expect(core.stampCoverage(records, [anchors[0], a])).toEqual(got);
    }
  });

  it('a file with no stamp at all says 0 of every run', async () => {
    const { records } = await twoRuns();
    expect(computeStampCoverage(records, []).map((r) => r.stamped)).toEqual([0, 0]);
  });

  it('page one says it per run, under the signature, and the first run is not read as the whole', async () => {
    const { records, anchors } = await twoRuns();
    const rows = new Map(extractProvenanceRows(await signedExport(records, anchors)));
    expect(rows.get('stampCoverage.label')).toBe('Records under a time stamp:');
    const value = rows.get('stampCoverage') ?? '';
    expect(value).toContain('Positions 0 to 9: 6 of 10 records fall under a time stamp the install checked when it was taken, the newest at 2026-09-06T10:05:00Z.');
    expect(value).toContain('Positions 0 to 5: 0 of 6 records fall under a time stamp the install checked when it was taken.');
    expect(value).toContain('a later run');
  });

  it('page one counts no stamp the install did not check, or whose check failed', async () => {
    const { records, anchors } = await twoRuns();
    const failed = { ...CHECKED!, ok: false };
    const unpinned = { ...CHECKED!, knownRootName: null };
    for (const verification of [failed, unpinned, undefined]) {
      const shaky = anchors.map((a) => {
        const { verification: _drop, ...rest } = a;
        return verification ? { ...rest, verification } : rest;
      }) as ChainAnchor[];
      const rows = new Map(extractProvenanceRows(await signedExport(records, shaky)));
      expect(rows.get('stampCoverage') ?? '').toContain('Positions 0 to 9: 0 of 10 records fall under a time stamp');
    }
  });

  it('the public checker reads the row as signed, and counts no stamp whose token fails its own check', async () => {
    // The tokens here are four bytes of nothing: the install's stored verdict says they checked,
    // and the checker, which opens them itself, counts none.
    const { records, anchors } = await twoRuns();
    const report = await checker.verifyExportText(await signedExport(records, anchors));
    expect(report.manifest).toBe('ok');
    expect(report.stampCoverage).toEqual([
      { first: 0, last: 9, records: 10, stamped: 0, newest: null },
      { first: 0, last: 5, records: 6, stamped: 0, newest: null },
    ]);
    const text = checker.describe(report, 'en');
    expect(text).toContain('Positions 0 to 9: 0 of 10 records fall under a time stamp that passed this check.');
    expect(text).toContain('Positions 0 to 5: 0 of 6 records fall under a time stamp that passed this check.');
    expect(checker.describe(report, 'ro')).toContain('0 din 6');
  });

  it('the public checker counts a stamp whose real token verifies, with the time signed inside it', async () => {
    const base = await run('2026-09', 3);
    // The middle record carries the hash a real FreeTSA token stamps. Its own hash no longer
    // recomputes, which the checker reports separately; the count is about the stamp.
    const records = [base[0], { ...base[1], integrityHash: FIXTURE_HASH }, base[2]];
    const real: ChainAnchor = { ...anchor(records[1], '2026-09-04T01:43:14Z'), responseB64: FREETSA_RESPONSE, tstB64: '' };
    const broken = anchor(records[2], '2026-09-05T00:00:00Z');
    const html = buildForensicHtmlExport(records, {
      fwVersion: 'FeelingWise V2.5.16', publicKeyJwk: jwk, publicKeyFingerprint: fingerprint, locale: 'en', anchors: [real, broken],
    });
    const report = await checker.verifyExportText(html);
    expect(report.stampCoverage).toHaveLength(1);
    const [only] = report.stampCoverage!;
    expect(only).toMatchObject({ first: 0, last: 2, records: 3, stamped: 2 });
    expect(only.newest ?? '').toContain('2026-09-04');
  });

  it('changes nothing in a record or an anchor: the payload carries them byte for byte', async () => {
    const { records, anchors } = await twoRuns();
    const before = JSON.stringify(records);
    const html = await signedExport(records, anchors);
    expect(JSON.stringify(records)).toBe(before);
    for (const r of records) expect(await computeRecordIntegrityHash(r)).toBe(r.integrityHash);
    const open = html.indexOf('id="fw-export-data"');
    const payload = html.slice(html.indexOf('>', open) + 1, html.indexOf('</script>', open));
    const data = JSON.parse(payload) as { records: unknown; anchors: unknown };
    expect(JSON.stringify(data.records)).toBe(before);
    expect(data.anchors).toEqual(anchors);
  });
});
