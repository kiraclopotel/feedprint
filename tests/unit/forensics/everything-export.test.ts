/** @vitest-environment jsdom */
// Q35 — everything-export. The active chain caps at 10,000 and rotation
// moves history into per-month archives, so "export all" produced 10k
// fragments. The everything-export walks every archive month (oldest
// first, stored order) plus the sorted active chain into ONE file. The
// embedded verifier's gap-tolerant walk covers month boundaries because
// a terminal position N followed by the next chain's position 0 is not
// contiguous, so no link is enforced across it.

import { describe, expect, it, vi } from 'vitest';
import type { ForensicRecord } from '../../../src/types/forensic';

vi.mock('../../../src/forensics/archive-reader', () => ({
  loadArchivesOldestFirst: vi.fn(async () => [
    { monthKey: '2026-06', records: [rec('a-jun-0', 0), rec('a-jun-1', 1)] },
    { monthKey: '2026-07', records: [rec('a-jul-0', 0), rec('a-jul-1', 1), rec('a-jul-2', 2)] },
  ]),
}));
vi.mock('../../../src/forensics/chain-anchor-store', () => ({ getAnchors: vi.fn(async () => []) }));
vi.mock('../../../src/forensics/signing', () => ({
  getSigningKeyCreatedAt: vi.fn(async () => '2026-08-01T09:00:00.000Z'),
  getPublicKeyJWK: vi.fn(async () => ({ kty: 'EC', x: 'x', y: 'y' })),
  getPublicKeyFingerprint: vi.fn(async () => 'fp1234567890abcd'),
  getSigningKeyOrigins: vi.fn(async () => []),
  // Register item 6: the exporter signs the envelope manifest; this test is about ordering.
  signHash: vi.fn(async () => 'sig'),
}));

function rec(id: string, pos: number): ForensicRecord {
  return {
    id,
    timestamp: '2026-08-01T00:00:00.000Z',
    platform: 'twitter',
    originalText: 'x',
    originalHash: 'h',
    originalLength: 1,
    neutralizedText: '',
    author: '@a',
    postUrl: '',
    techniques: [],
    overallScore: 0,
    userAgeCategory: 'adult',
    aiSource: 'local',
    feedSource: 'unknown',
    integrityHash: `ih-${id}`,
    chainPosition: pos,
    verdict: 'pass',
  } as unknown as ForensicRecord;
}

describe('exportEverythingHtml', () => {
  it('concatenates archives oldest-first before the active chain and reports counts', async () => {
    // Capture the record order handed to the HTML builder.
    let seen: ForensicRecord[] | null = null;
    vi.doMock('../../../src/forensics/html-export', async (orig) => {
      const real = await orig() as Record<string, unknown>;
      return {
        ...real,
        buildForensicHtmlExport: (records: ForensicRecord[]) => {
          seen = records;
          return '<html>stub</html>';
        },
      };
    });
    if (typeof URL.createObjectURL !== 'function') {
      (URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = () => 'blob:t';
    }
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:t');
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const { exportEverythingHtml } = await import('../../../src/forensics/exporter');

    const active = [rec('act-0', 0), rec('act-1', 1)];
    // Wiring audit 13 Sep, D2-28: the export reports its steps, in order, with
    // the record count it is working on.
    const stages: Array<[string, number]> = [];
    const result = await exportEverythingHtml(active, 'en', undefined, (s, n) => stages.push([s, n]));
    expect(stages).toEqual([['reading-archives', 2], ['reading-keys', 7], ['building', 7], ['saving', 7]]);

    expect(result.archivedMonths).toBe(2);
    expect(result.totalRecords).toBe(7);
    expect(seen).not.toBeNull();
    expect((seen as unknown as ForensicRecord[]).map(r => r.id)).toEqual([
      'a-jun-0', 'a-jun-1', 'a-jul-0', 'a-jul-1', 'a-jul-2', 'act-0', 'act-1',
    ]);
    vi.restoreAllMocks();
  });

  it('places salvaged prior-generation records in a trailing section, never among the live chain', async () => {
    // Recovered records carry chainPositions from a chain that was cleared, so
    // they collide with the live ones. If they were interleaved, the
    // recipient's contiguity walk would compare two unrelated records with
    // adjacent positions and report the LIVE record as broken. The trailing
    // section is what keeps recovery from discrediting the thing it recovers.
    vi.resetModules();
    vi.doMock('../../../src/forensics/salvage-store', () => ({
      readSalvagedRecords: vi.fn(async () => [
        { ...rec('salv-0', 0), chainAnchor: 'pre-rekey', publicKeyFingerprint: 'oldkey0000000000' },
        { ...rec('salv-1', 1), chainAnchor: 'pre-rekey', publicKeyFingerprint: 'oldkey0000000000' },
      ]),
    }));
    let seen: ForensicRecord[] | null = null;
    vi.doMock('../../../src/forensics/html-export', async (orig) => {
      const real = await orig() as Record<string, unknown>;
      return { ...real, buildForensicHtmlExport: (records: ForensicRecord[]) => { seen = records; return '<html>stub</html>'; } };
    });
    if (typeof URL.createObjectURL !== 'function') {
      (URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = () => 'blob:t';
    }
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:t');
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const { exportEverythingHtml } = await import('../../../src/forensics/exporter');

    await exportEverythingHtml([rec('act-0', 0), rec('act-1', 1)], 'en');

    const ids = (seen as unknown as ForensicRecord[]).map(r => r.id);
    expect(ids).toContain('salv-0');
    // Both salvaged records sit after every live record, despite sharing
    // positions 0 and 1 with them.
    expect(ids.indexOf('salv-0')).toBeGreaterThan(ids.indexOf('act-1'));
    expect(ids.indexOf('salv-1')).toBeGreaterThan(ids.indexOf('act-1'));
    vi.restoreAllMocks();
  });
});
