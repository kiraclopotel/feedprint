// Sequence analysis slice 4 — sidecar theme cache (chainFingerprint
// invalidation semantics) + a loose performance bound on the clustering
// core at scale. IDB round-trip itself is environment-dependent and
// covered by the no-throw contract (readThemeCache/writeThemeCache resolve
// null/void without indexedDB).

import { describe, it, expect } from 'vitest';
import type { ForensicRecord } from '../../../src/types/forensic';
import { chainFingerprint, readThemeCache, writeThemeCache } from '../../../src/forensics/theme-cache';
import { buildThemes } from '../../../src/forensics/topics';

let seq = 0;
function rec(text: string, ts?: string): ForensicRecord {
  seq++;
  return {
    id: `r${seq}`,
    timestamp: ts ?? new Date(Date.UTC(2026, 5, 1, 10, 0, seq % 60, seq)).toISOString(),
    platform: 'tiktok',
    originalText: text,
    author: 'a',
    verdict: 'pass',
  } as ForensicRecord;
}

describe('chainFingerprint', () => {
  it('changes when a record is added and is order-independent', () => {
    const a = rec('one'), b = rec('two');
    const fp2 = chainFingerprint([a, b]);
    expect(chainFingerprint([b, a])).toBe(fp2);
    expect(chainFingerprint([a])).not.toBe(fp2);
    expect(chainFingerprint([])).toBe('0::');
  });
});

describe('cache no-throw contract without indexedDB', () => {
  it('read resolves null, write resolves undefined', async () => {
    const records = [rec('x')];
    await expect(readThemeCache(records)).resolves.toBeNull();
    await expect(writeThemeCache(records, [], new Map(), 0)).resolves.toBeUndefined();
  });
});

describe('clustering performance bound (slice 4)', () => {
  it('builds themes over 20k records well inside the interactive budget', async () => {
    const records: ForensicRecord[] = [];
    const topics = [
      'alegeri candidat campanie vot primar consiliu',
      'reteta ciorba legume gatit bucatarie aroma',
      'fotbal meci echipa gol campionat stadion',
      'telefon baterie ecran aplicatie update model',
      'vacanta mare plaja soare munte drumetie',
    ];
    for (let i = 0; i < 20_000; i++) {
      const t = topics[i % topics.length];
      records.push(rec(`${t} varianta ${i} cu detalii despre subiect ${i % 97}`));
    }
    const t0 = performance.now();
    const { themes } = await buildThemes(records);
    const elapsed = performance.now() - t0;
    expect(themes.length).toBeGreaterThan(0);
    // Loose CI-safe bound — the design target is <=3s at 100k in a browser;
    // 20k in Node must stay comfortably interactive.
    expect(elapsed).toBeLessThan(8_000);
  }, 20_000);
});

// Wiring audit 13 Sep, D2-25: a blocked IndexedDB open never answers; the read
// must give up and count as a miss so the Patterns tab computes instead of
// showing "computing" forever.
describe('a cache read that never answers', () => {
  it('resolves null after the timeout', async () => {
    const { vi } = await import('vitest');
    vi.resetModules();
    const never = { set onsuccess(_f: unknown) {}, set onerror(_f: unknown) {}, set onupgradeneeded(_f: unknown) {} };
    vi.stubGlobal('indexedDB', { open: () => never });
    try {
      const mod = await import('../../../src/forensics/theme-cache');
      const t0 = Date.now();
      const out = await mod.readThemeCache([], 30);
      expect(out).toBeNull();
      // It waited for the timeout (the open never answered), and no longer.
      expect(Date.now() - t0).toBeGreaterThanOrEqual(25);
      expect(Date.now() - t0).toBeLessThan(2000);
    } finally {
      vi.unstubAllGlobals();
      vi.resetModules();
    }
  });
});
