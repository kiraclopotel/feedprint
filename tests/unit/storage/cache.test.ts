import { describe, it, expect, vi, beforeEach } from 'vitest';
import { processingCache } from '../../../src/storage/cache';
import { verdictCacheKeyInput } from '../../../src/storage/cache-key';
import { sha256 } from '../../../src/forensics/hasher';
import { AnalysisResult } from '../../../src/types/analysis';

function makeAnalysis(overrides: Partial<AnalysisResult> = {}): AnalysisResult {
  return {
    postId: 'test-post',
    techniques: [],
    overallScore: 7,
    overallConfidence: 0.85,
    isManipulative: true,
    processingTimeMs: 100,
    ...overrides,
  };
}

describe('ProcessingCache', () => {
  beforeEach(() => {
    processingCache.clear();
    vi.restoreAllMocks();
  });

  it('returns null for unknown hash', () => {
    expect(processingCache.get('unknown-hash')).toBeNull();
  });

  it('returns cached entry for known hash', () => {
    const analysis = makeAnalysis();
    processingCache.set('hash-1', analysis, 'neutralized text');

    const entry = processingCache.get('hash-1');
    expect(entry).not.toBeNull();
    expect(entry!.analysis).toEqual(analysis);
    expect(entry!.neutralizedText).toBe('neutralized text');
  });

  it('evicts expired entries', () => {
    const analysis = makeAnalysis();
    processingCache.set('hash-old', analysis, 'text');

    // Advance time past 60 minutes
    const realNow = Date.now;
    Date.now = () => realNow() + 61 * 60 * 1000;

    expect(processingCache.get('hash-old')).toBeNull();
    expect(processingCache.size).toBe(0);

    Date.now = realNow;
  });

  it('evicts oldest entry when at capacity', () => {
    const analysis = makeAnalysis();

    // Fill to capacity (5000)
    for (let i = 0; i < 5000; i++) {
      processingCache.set(`hash-${i}`, analysis, null);
    }
    expect(processingCache.size).toBe(5000);

    // Adding one more should evict the first
    processingCache.set('hash-new', analysis, null);
    expect(processingCache.size).toBe(5000);
    expect(processingCache.get('hash-0')).toBeNull();
    expect(processingCache.get('hash-new')).not.toBeNull();
  });

  it('LRU: recently accessed entry survives eviction', () => {
    const analysis = makeAnalysis();

    // Fill to capacity
    for (let i = 0; i < 5000; i++) {
      processingCache.set(`hash-${i}`, analysis, null);
    }

    // Touch hash-1 (moves it to end)
    processingCache.get('hash-1');

    // Add new entry — should evict hash-2 (now the oldest), not hash-1
    processingCache.set('hash-new', analysis, null);
    expect(processingCache.get('hash-1')).not.toBeNull();
  });

  it('clear() empties cache', () => {
    const analysis = makeAnalysis();
    processingCache.set('hash-a', analysis, null);
    processingCache.set('hash-b', analysis, 'text');
    expect(processingCache.size).toBe(2);

    processingCache.clear();
    expect(processingCache.size).toBe(0);
    expect(processingCache.get('hash-a')).toBeNull();
  });

  it('has() returns correct boolean without touching LRU', () => {
    const analysis = makeAnalysis();
    processingCache.set('hash-x', analysis, null);

    expect(processingCache.has('hash-x')).toBe(true);
    expect(processingCache.has('nonexistent')).toBe(false);
  });

  it('has() returns false for expired entries', () => {
    const analysis = makeAnalysis();
    processingCache.set('hash-exp', analysis, null);

    const realNow = Date.now;
    Date.now = () => realNow() + 61 * 60 * 1000;

    expect(processingCache.has('hash-exp')).toBe(false);

    Date.now = realNow;
  });
});

describe('verdictCacheKeyInput — shared cache-key dimensions (comment↔post reframe reuse)', () => {
  beforeEach(() => {
    processingCache.clear();
  });

  it('encodes platform|mode|locale|outputLanguage|text in order', () => {
    expect(verdictCacheKeyInput('twitter', 'teen', 'en', 'auto', 'hello'))
      .toBe('twitter|teen|en|auto|hello');
  });

  it('is sensitive to every dimension (no accidental cross-key collisions)', () => {
    const base = verdictCacheKeyInput('twitter', 'teen', 'en', 'auto', 'x');
    expect(verdictCacheKeyInput('facebook', 'teen', 'en', 'auto', 'x')).not.toBe(base);
    expect(verdictCacheKeyInput('twitter', 'child', 'en', 'auto', 'x')).not.toBe(base);
    expect(verdictCacheKeyInput('twitter', 'teen', 'ro', 'auto', 'x')).not.toBe(base);
    expect(verdictCacheKeyInput('twitter', 'teen', 'en', 'ro', 'x')).not.toBe(base);
    expect(verdictCacheKeyInput('twitter', 'teen', 'en', 'auto', 'y')).not.toBe(base);
  });

  it('a comment reframe primed under the shared key is retrievable for the SAME text (cross-surface reuse)', async () => {
    // The comment-batch path primes the cache; the per-post pipeline reads it
    // when the same comment is opened as a focused tweet on its permalink. Both
    // derive the key via verdictCacheKeyInput → sha256, so they agree.
    const platform = 'twitter', mode = 'teen', locale = 'en', outputLanguage = 'auto';
    const text = 'this is precisely why world title is so far away from you';
    const rewrite = 'I think your attitude could be improved.';
    const hash = await sha256(verdictCacheKeyInput(platform, mode, locale, outputLanguage, text));
    processingCache.set(hash, makeAnalysis({ isManipulative: true }), rewrite);

    const rehash = await sha256(verdictCacheKeyInput(platform, mode, locale, outputLanguage, text));
    const hit = processingCache.get(rehash);
    expect(hit?.neutralizedText).toBe(rewrite);
    expect(hit?.analysis.isManipulative).toBe(true);
  });

  it('a different mode/locale does NOT hit the primed reframe (key isolation)', async () => {
    const text = 'same words';
    const rewrite = 'softened';
    const teenHash = await sha256(verdictCacheKeyInput('twitter', 'teen', 'en', 'auto', text));
    processingCache.set(teenHash, makeAnalysis({ isManipulative: true }), rewrite);
    const childHash = await sha256(verdictCacheKeyInput('twitter', 'child', 'en', 'auto', text));
    expect(processingCache.get(childHash)).toBeNull();
  });
});

// ─── L3 persistent tier (chrome.storage.local, e3) ─────────────────────────

interface ChromeAreaStub {
  data: Record<string, unknown>;
  get: (keys: string | string[] | null) => Promise<Record<string, unknown>>;
  set: (next: Record<string, unknown>) => Promise<void>;
  remove: (keys: string | string[]) => Promise<void>;
}

function makeArea(): ChromeAreaStub {
  const data: Record<string, unknown> = {};
  return {
    data,
    get: async (keys) => {
      if (keys === null) return { ...data };
      const list = Array.isArray(keys) ? keys : [keys];
      const out: Record<string, unknown> = {};
      for (const k of list) if (k in data) out[k] = data[k];
      return out;
    },
    set: async (next) => {
      Object.assign(data, next);
    },
    remove: async (keys) => {
      for (const k of Array.isArray(keys) ? keys : [keys]) delete data[k];
    },
  };
}

const APP_VERSION = '9.9.9';

function installChromeStub(): { session: ChromeAreaStub; local: ChromeAreaStub } {
  const session = makeArea();
  const local = makeArea();
  (globalThis as Record<string, unknown>).chrome = {
    storage: { session, local },
    runtime: { getManifest: () => ({ version: APP_VERSION }) },
  };
  return { session, local };
}

function clearChromeStub(): void {
  delete (globalThis as Record<string, unknown>).chrome;
}

describe('ProcessingCache — L3 persistent tier', () => {
  beforeEach(() => {
    clearChromeStub();
    // Clear L1 only (no chrome installed → storage clears are no-ops).
    processingCache.clear();
    vi.restoreAllMocks();
  });

  it('getPersistent falls through L1+L2 miss to an L3 hit and hydrates the fast tiers', async () => {
    const { session, local } = installChromeStub();
    const analysis = makeAnalysis();
    local.data['fwvc:h1'] = {
      analysis,
      neutralizedText: 'soft',
      timestamp: Date.now() - 3 * 24 * 60 * 60 * 1000, // 3 days old — inside 7d, outside 60min
      v: APP_VERSION,
    };

    const hit = await processingCache.getPersistent('h1');
    expect(hit).not.toBeNull();
    expect(hit!.neutralizedText).toBe('soft');
    // Hydrated into L1 (synchronous get now works) + L2 with a fresh stamp.
    expect(processingCache.get('h1')).not.toBeNull();
    await new Promise((r) => setTimeout(r, 0)); // L2 hydration is fire-and-forget
    expect(session.data['fwc:h1']).toBeDefined();
  });

  it('an L3 entry from a different extension version is a miss and is removed', async () => {
    const { local } = installChromeStub();
    local.data['fwvc:h2'] = {
      analysis: makeAnalysis(),
      neutralizedText: null,
      timestamp: Date.now(),
      v: '0.0.1',
    };

    expect(await processingCache.getPersistent('h2')).toBeNull();
    await new Promise((r) => setTimeout(r, 0));
    expect(local.data['fwvc:h2']).toBeUndefined();
  });

  it('an L3 entry older than 7 days is a miss and is removed', async () => {
    const { local } = installChromeStub();
    local.data['fwvc:h3'] = {
      analysis: makeAnalysis(),
      neutralizedText: null,
      timestamp: Date.now() - 8 * 24 * 60 * 60 * 1000,
      v: APP_VERSION,
    };

    expect(await processingCache.getPersistent('h3')).toBeNull();
    await new Promise((r) => setTimeout(r, 0));
    expect(local.data['fwvc:h3']).toBeUndefined();
  });

  it('set() writes a version-stamped L3 entry', async () => {
    const { local } = installChromeStub();
    vi.spyOn(Math, 'random').mockReturnValue(1); // suppress the sweep
    processingCache.set('h4', makeAnalysis(), null);
    await new Promise((r) => setTimeout(r, 0));
    const entry = local.data['fwvc:h4'] as { v: string } | undefined;
    expect(entry).toBeDefined();
    expect(entry!.v).toBe(APP_VERSION);
  });

  it('the lazy sweep drops expired + version-stale entries and keeps live ones', async () => {
    const { local } = installChromeStub();
    local.data['fwvc:stale-version'] = {
      analysis: makeAnalysis(), neutralizedText: null, timestamp: Date.now(), v: '0.0.1',
    };
    local.data['fwvc:expired'] = {
      analysis: makeAnalysis(), neutralizedText: null,
      timestamp: Date.now() - 8 * 24 * 60 * 60 * 1000, v: APP_VERSION,
    };
    local.data['fwvc:alive'] = {
      analysis: makeAnalysis(), neutralizedText: null, timestamp: Date.now(), v: APP_VERSION,
    };
    local.data['unrelated-key'] = { anything: true };

    vi.spyOn(Math, 'random').mockReturnValue(0); // force the sweep on this write
    processingCache.set('h5', makeAnalysis(), null);
    await new Promise((r) => setTimeout(r, 10));

    expect(local.data['fwvc:stale-version']).toBeUndefined();
    expect(local.data['fwvc:expired']).toBeUndefined();
    expect(local.data['fwvc:alive']).toBeDefined();
    expect(local.data['fwvc:h5']).toBeDefined();
    expect(local.data['unrelated-key']).toBeDefined();
  });
});

// A cache hit re-serves a cloud verdict without calling anything. The record
// written from it said aiSource 'cloud' with no aiModel — a record asserting a
// judgement it could not attribute (38 such rows in the 2026-09-08 export).
describe('ProcessingCache — the judge that made the cached verdict', () => {
  it('a re-served verdict names the same judge the first serving named', () => {
    processingCache.set('hm1', makeAnalysis(), 'rewritten', { model: 'openai/gpt-oss-20b', provider: 'groq' });
    expect(processingCache.get('hm1')?.aiMeta).toEqual({ model: 'openai/gpt-oss-20b', provider: 'groq' });
  });

  // A rules-path verdict has no model, and an entry cached before the field
  // existed carries none. Absent must read as "not recorded", never as a
  // model that did not run.
  it('a verdict with no judge carries no judge', () => {
    processingCache.set('hm2', makeAnalysis(), null);
    expect(processingCache.get('hm2')?.aiMeta).toBeUndefined();
  });

  // The adult rewrite is written by another model than the judge, and a re-served rewrite goes back
  // on the page under the AI mark naming that writer.
  it('a re-served rewrite names the model that wrote it, apart from the judge', () => {
    processingCache.set('hm3', makeAnalysis(), 'rewritten', { model: 'openai/gpt-oss-120b', provider: 'deepinfra' }, 'openai/gpt-oss-20b');
    expect(processingCache.get('hm3')?.writerModel).toBe('openai/gpt-oss-20b');
    expect(processingCache.get('hm3')?.aiMeta?.model).toBe('openai/gpt-oss-120b');
    processingCache.set('hm4', makeAnalysis(), 'rewritten');
    expect(processingCache.get('hm4')?.writerModel).toBeUndefined();
  });

  // The persistent tier (L3, chrome.storage.local) is the common path, not an
  // edge case: cross-day re-serves are the product's core thesis (see the
  // top-of-file comment). set() stores aiMeta into L3 same as L1/L2, but
  // getL3's rehydration rebuilt its return value from a hand-listed subset of
  // fields (analysis, neutralizedText, timestamp) that never included aiMeta.
  // A verdict served from L1/L2 named its judge; the identical verdict served
  // a day later from L3 silently lost it. This is the shape the 2026-09-08
  // export's 38 unattributed rows came from.
  it('aiMeta survives set() through an L1+L2 expiry into the L3 rehydration path', async () => {
    const { session, local } = installChromeStub();
    try {
      vi.spyOn(Math, 'random').mockReturnValue(1); // suppress the lazy sweep, not under test here
      const aiMeta = { model: 'openai/gpt-oss-20b', provider: 'groq' };
      processingCache.set('hm3', makeAnalysis(), 'rewritten', aiMeta);
      await new Promise((r) => setTimeout(r, 0)); // let the fire-and-forget L2/L3 writes land
      expect(local.data['fwvc:hm3']).toBeDefined();

      // Age L1 and L2 past their 60-minute TTL without touching L3's own
      // 7-day TTL ("clearing the first two tiers"), so getPersistent() must
      // fall all the way through to the L3 rehydration this test pins down.
      const realNow = Date.now;
      Date.now = () => realNow() + 61 * 60 * 1000;
      let hit: Awaited<ReturnType<typeof processingCache.getPersistent>>;
      try {
        hit = await processingCache.getPersistent('hm3');
      } finally {
        Date.now = realNow;
      }

      expect(hit).not.toBeNull();
      expect(hit!.neutralizedText).toBe('rewritten'); // sanity: L3 hit did happen
      expect(hit!.aiMeta).toEqual(aiMeta);
      expect(session.data['fwc:hm3']).toBeDefined();
    } finally {
      clearChromeStub();
    }
  });
});
