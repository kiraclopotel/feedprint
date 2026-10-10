// A report holds the flagged part of the record. The stamp alarm names the
// newest record, which is nearly always one the report leaves out, and the
// checker reads a stamp over a record the file does not hold as a record
// missing or past the tail, so a report from any install that had been stamped
// read PARTIALLY VERIFIED although its selection accounted for every hole.
// Measured on the 2.5.18 build: a fresh profile, two stamps over a passed post
// at position 20, the report button, the node checker: PARTIALLY VERIFIED,
// "1 independently timestamped record(s) are not in this file". A report now
// carries only the stamps over a record it holds, matched as the checker
// matches them (the same hash at the same position).

import { beforeAll, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildForensicHtmlExport, I18N, VERIFIER_CORE_FNS_SOURCE, type ExportMetadata } from '../../../src/forensics/html-export';
import { computeRecordIntegrityHash } from '../../../src/forensics/canonical-payload';
import type { ForensicRecord } from '../../../src/types/forensic';
import type { ChainAnchor } from '../../../src/types/chain-anchor';

vi.mock('../../../src/forensics/chain-anchor-store', () => ({ getAnchors: vi.fn(async () => []) }));
import { anchorsOverHeldRecords, stampedRecordsLeftOut } from '../../../src/forensics/exporter';

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}

interface AnchorInfo { checked: number; notInFile: number; beyondTail: number }
interface Verifier {
  verificationState(perRecord: Array<{ ok: boolean }>, chain: unknown, extra?: unknown): string;
  coverageFromRecords(records: unknown[]): { missingBefore: number; gapsInside: number };
  anchorFindings(records: unknown[], anchors: unknown[]): AnchorInfo;
}

let verifier: Verifier;
beforeAll(() => {
  verifier = new Function(
    `"use strict";${VERIFIER_CORE_FNS_SOURCE}
     return { verificationState, coverageFromRecords, anchorFindings };`,
  )() as Verifier;
});

async function buildChain(n: number): Promise<ForensicRecord[]> {
  const out: ForensicRecord[] = [];
  let prev = '';
  for (let i = 0; i < n; i++) {
    const body = {
      id: `r-${i}`, timestamp: `2026-10-07T10:${String(i).padStart(2, '0')}:00.000Z`, platform: 'twitter',
      originalText: `post ${i}`, originalHash: `h${i}`, originalLength: 6, neutralizedText: '', author: '@someone',
      postUrl: `https://x.com/someone/status/${i}`, techniques: [], overallScore: 0.1, userAgeCategory: 'adult',
      aiSource: 'cloud', feedSource: 'for-you', chainPosition: i, prevRecordHash: prev,
    };
    const integrityHash = await computeRecordIntegrityHash(body as Omit<ForensicRecord, 'integrityHash' | 'signature' | 'chainAnchor'>);
    out.push({ ...body, integrityHash, signature: 'sig' } as ForensicRecord);
    prev = integrityHash;
  }
  return out;
}

function stamp(r: ForensicRecord, by: string): ChainAnchor {
  return { id: `${by}-${r.chainPosition}`, anchoredChainPosition: r.chainPosition as number, anchoredIntegrityHash: r.integrityHash, tsaProvider: by, verification: { ok: true, knownRootName: 'Test Root' } } as ChainAnchor;
}

/** The measured case: 21 records, the report holds positions 6 to 17 (12 of 21, 9 left out), stamps over 20 and 17. */
async function measuredCase() {
  const chain = await buildChain(21);
  const held = chain.slice(6, 18);
  const anchors = [stamp(chain[20], 'sectigo'), stamp(chain[20], 'digicert'), stamp(chain[17], 'sectigo')];
  const read = (carried: ChainAnchor[]) => verifier.verificationState(
    held.map(() => ({ ok: true })),
    { ok: true, outside: 1, branches: 0, restarts: 0, setAside: 0 },
    { anchors: verifier.anchorFindings(held, carried), coverage: verifier.coverageFromRecords(held), selection: { leftOut: 9 } },
  );
  return { chain, held, anchors, read };
}

describe('a report carries only the stamps over a record it holds', () => {
  it('with every stamp, the report reads PARTIALLY VERIFIED over the stamp on a record it left out', async () => {
    const { held, anchors, read } = await measuredCase();
    expect(verifier.anchorFindings(held, anchors).notInFile).toBe(1);
    expect(read(anchors)).toBe('partial');
  });

  it('with the stamps over held records only, the same report reads VERIFIED and keeps the stamp it can vouch for', async () => {
    const { held, anchors, read } = await measuredCase();
    const carried = anchorsOverHeldRecords(anchors, held);
    expect(carried.map((a) => a.id)).toEqual(['sectigo-17']);
    expect(verifier.anchorFindings(held, carried)).toMatchObject({ checked: 1, notInFile: 0, beyondTail: 0 });
    expect(read(carried)).toBe('verified');
  });

  it('matches as the checker matches: the same hash at another position, or a record from before a key change, is not held', async () => {
    const { chain, held } = await measuredCase();
    const moved = { ...stamp(chain[10], 'sectigo'), anchoredChainPosition: 19 };
    expect(anchorsOverHeldRecords([moved], held)).toEqual([]);
    const preRekey = held.map((r) => (r.chainPosition === 10 ? { ...r, chainAnchor: 'pre-rekey' as const } : r));
    expect(anchorsOverHeldRecords([stamp(chain[10], 'sectigo')], preRekey)).toEqual([]);
  });

  it('only the report is narrowed: the whole-record file builds its own list of every stamp', () => {
    const src = readFileSync(join(process.cwd(), 'src/forensics/exporter.ts'), 'utf8');
    expect(src).toContain('const anchors = filter ? anchorsOverHeldRecords(allAnchors, targetRecords) : allAnchors;');
    expect(src).toContain('const anchors = [...archivedAnchors, ...(await getAnchors())]');
  });
});

describe('the report says how many records it left out sit under a stamp the install holds', () => {
  const selection = { included: 12, totalSource: 21, excludedUnreviewed: 0, excludedLowConfidence: 0, excludedNonDetection: 9 };
  const meta = (stampedRecordsLeftOut: number): ExportMetadata => ({
    fwVersion: 'V1.0.0-test', publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'AAA', y: 'BBB' }, publicKeyFingerprint: 'fp16', locale: 'en',
    selection, stampedRecordsLeftOut,
  });

  it('counts each left-out record once, however many authorities stamped it', async () => {
    const { chain, held, anchors } = await measuredCase();
    expect(stampedRecordsLeftOut(anchors, chain, held)).toBe(1);
  });

  it('does not count a stamp over a held record, a record this chain does not hold, or one no recognised authority checked', async () => {
    const { chain, held } = await measuredCase();
    const unchecked = { ...stamp(chain[19], 'x'), verification: { ok: false } } as ChainAnchor;
    const archived = { ...stamp(chain[19], 'y'), anchoredChainPosition: 40, anchoredIntegrityHash: 'f'.repeat(64) } as ChainAnchor;
    expect(stampedRecordsLeftOut([stamp(chain[17], 'a'), unchecked, archived], chain, held)).toBe(0);
    // A held record from before a key change: the report cannot carry its stamp, but it did not leave the record out.
    const marked = chain.map((r) => (r.chainPosition === 10 ? { ...r, chainAnchor: 'pre-rekey' as const } : r));
    expect(stampedRecordsLeftOut([stamp(chain[10], 'a')], marked, marked.slice(6, 18))).toBe(0);
  });

  it('the row is signed, says this file neither carries nor checks those stamps, and is absent at zero', async () => {
    const { held } = await measuredCase();
    const html = buildForensicHtmlExport(held, meta(1));
    expect(html).toContain('<dt data-fw-prov="stampsElsewhere.label">Left-out records under a time stamp:</dt>');
    const row = html.match(/<dd data-fw-prov="stampsElsewhere">([\s\S]*?)<\/dd>/)?.[1] ?? '';
    expect(row).toBe(I18N.en.summaryStampsElsewhereValue.replace('{n}', '1'));
    expect(row).toContain('This file does not carry or check those stamps');
    expect(buildForensicHtmlExport(held, meta(0))).not.toContain('stampsElsewhere');
  });

  it('every language opens with the count and fills nothing else', () => {
    for (const lang of ['en', 'ro', 'es', 'pt-BR'] as const) {
      const value = I18N[lang].summaryStampsElsewhereValue;
      expect(value, lang).toMatch(/^\{n\}\. /);
      expect(value.replace('{n}', ''), lang).not.toContain('{');
    }
  });
});
