// Incremental verify watermark (Q25 family, W41).
//
// extendChainIntegrity extends a completed FULL walk over appended records
// only: full crypto on the new segment, prefix proven unchanged by shape
// (tip id/hash/position, first position, count, known ids). It must REFUSE
// (null) whenever the prefix's shape moved — prune, re-anchor, substitution,
// tip mismatch — so the caller falls back to the honest unverified banner.
//
// Source-lock half: the Dashboard's passive refresh drops the verdict first
// (W13 honesty) and only then extends; load and manual Verify refresh the
// watermark from their full walks.

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('../../../src/forensics/signing', () => ({
  verifyHash: vi.fn(async () => true),
  signHash: vi.fn(async () => 'mock-sig'),
  getPublicKeyFingerprint: vi.fn(async () => 'mock-fp'),
}));

import type { ForensicRecord } from '../../../src/types/forensic';
import {
  verifyChainIntegrity,
  chainWatermarkFrom,
  extendChainIntegrity,
  CHAIN_GENESIS_HASH,
} from '../../../src/forensics/chain-integrity';
import { computeRecordIntegrityHash } from '../../../src/forensics/canonical-payload';

// Source-read path, hoisted so a decomposition step re-points one line.
const DASHBOARD_SHELL = 'src/ui/dashboard/Dashboard.tsx';

function basePayload(i: number): Omit<ForensicRecord, 'integrityHash' | 'signature' | 'publicKeyFingerprint' | 'chainAnchor'> {
  return {
    id: `fr-wm-${i}`,
    timestamp: `2026-04-25T00:00:${String(i % 60).padStart(2, '0')}.000Z`,
    platform: 'twitter',
    originalText: `original ${i}`,
    originalHash: `hash-${i}`,
    originalLength: `original ${i}`.length,
    neutralizedText: `neutralized ${i}`,
    author: `@author${i}`,
    postUrl: `https://x.com/p/${i}`,
    techniques: [{ name: 'fear-appeal', severity: 7, confidence: 0.9 }],
    overallScore: 7,
    userAgeCategory: 'teen',
    aiSource: 'cloud',
    feedSource: 'unknown',
    aiModel: 'llama-3.1-8b-instant',
    aiProvider: 'groq',
    detectionMode: 'combined-detect-neutralize',
    configSnapshot: { mode: 'teen', threshold: 0.4, dailyCap: 5000 },
    prevRecordHash: '',
    chainPosition: 0,
  };
}

async function buildChain(n: number): Promise<ForensicRecord[]> {
  const records: ForensicRecord[] = [];
  let prevHash = CHAIN_GENESIS_HASH;
  for (let i = 0; i < n; i++) {
    const payload = basePayload(i);
    payload.prevRecordHash = prevHash;
    payload.chainPosition = i;
    const integrityHash = await computeRecordIntegrityHash(payload);
    records.push({ ...payload, integrityHash, chainAnchor: i === 0 ? 'genesis-v1' : undefined });
    prevHash = integrityHash;
  }
  return records;
}

async function watermarkOver(records: ForensicRecord[]) {
  const result = await verifyChainIntegrity(records);
  const wm = chainWatermarkFrom(records, result);
  expect(wm).not.toBeNull();
  return wm!;
}

describe('chainWatermarkFrom', () => {
  it('refuses an invalid result', async () => {
    const chain = await buildChain(3);
    const result = await verifyChainIntegrity(chain);
    expect(chainWatermarkFrom(chain, { ...result, valid: false })).toBeNull();
  });

  it('captures the tip of a valid walk', async () => {
    const chain = await buildChain(4);
    const wm = await watermarkOver(chain);
    expect(wm.tipId).toBe(chain[3].id);
    expect(wm.tipHash).toBe(chain[3].integrityHash);
    expect(wm.tipPosition).toBe(3);
    expect(wm.firstPosition).toBe(0);
  });
});

describe('extendChainIntegrity', () => {
  it('verifies only the appended segment and merges the verdict', async () => {
    const full = await buildChain(8);
    const wm = await watermarkOver(full.slice(0, 5));
    const ext = await extendChainIntegrity(full, wm);
    expect(ext).not.toBeNull();
    expect(ext!.valid).toBe(true);
    expect(ext!.chainLength).toBe(8);
    for (const r of full) {
      expect(ext!.perRecord?.get(r.id)).toBe('unsigned'); // fixture is unsigned
    }
  });

  it('returns the prior result untouched when nothing was appended', async () => {
    const chain = await buildChain(4);
    const wm = await watermarkOver(chain);
    expect(await extendChainIntegrity(chain, wm)).toBe(wm.result);
  });

  it('refuses when the tip hash no longer matches (tip replaced)', async () => {
    const full = await buildChain(6);
    const wm = await watermarkOver(full.slice(0, 5));
    full[4] = { ...full[4], integrityHash: 'forged' };
    expect(await extendChainIntegrity(full, wm)).toBeNull();
  });

  it('refuses after a prune moved the chain head', async () => {
    const full = await buildChain(6);
    const wm = await watermarkOver(full.slice(0, 5));
    expect(await extendChainIntegrity(full.slice(1), wm)).toBeNull();
  });

  it('refuses when a prefix record was substituted under a new id', async () => {
    const full = await buildChain(6);
    const wm = await watermarkOver(full.slice(0, 5));
    full[2] = { ...full[2], id: 'fr-imposter' };
    expect(await extendChainIntegrity(full, wm)).toBeNull();
  });

  it('refuses when the first appended record does not link to the verified tip', async () => {
    const full = await buildChain(6);
    const wm = await watermarkOver(full.slice(0, 5));
    full[5] = { ...full[5], prevRecordHash: 'not-the-tip' };
    expect(await extendChainIntegrity(full, wm)).toBeNull();
  });

  it('reports a tampered appended record at its absolute index', async () => {
    const full = await buildChain(8);
    const wm = await watermarkOver(full.slice(0, 5));
    full[6] = { ...full[6], originalText: 'tampered after signing' };
    const ext = await extendChainIntegrity(full, wm);
    expect(ext).not.toBeNull();
    expect(ext!.valid).toBe(false);
    expect(ext!.brokenKind).toBe('tampered');
    expect(ext!.brokenAt).toBe(6);
    expect(ext!.perRecord?.get(full[6].id)).toBe('broken');
    // Prefix statuses survive the merge.
    expect(ext!.perRecord?.get(full[0].id)).toBe('unsigned');
  });
});

describe('Dashboard wiring (source-lock)', () => {
  const source = readFileSync(join(process.cwd(), DASHBOARD_SHELL), 'utf8');

  it('the refresh branch extends AFTER dropping the verdict (W13 order)', () => {
    const block = source.match(
      /if \(recordTip\(recs\) === lastRecordTipRef\.current\) return;[\s\S]{0,1800}/,
    )?.[0] ?? '';
    const dropAt = block.indexOf('setIntegrity(null)');
    // Since 2026-09-06 the walk reads the raw chain (rawRecs); `recs` is the blanked copy the tabs see.
    const extendAt = block.indexOf('extendChainIntegrity(rawRecs');
    expect(dropAt).toBeGreaterThan(-1);
    expect(extendAt).toBeGreaterThan(dropAt);
  });

  it('load and manual Verify both refresh the watermark from their full walks', () => {
    expect(source.match(/verifyWatermarkRef\.current = chainWatermarkFrom\(/g)?.length ?? 0)
      .toBeGreaterThanOrEqual(2);
  });
});
