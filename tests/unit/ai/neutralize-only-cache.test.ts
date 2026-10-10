// Rewrite-cache regression suite for `src/ai/neutralize-only.ts`. Pins the
// contract introduced by the cache-and-pipeline-optimization audit
// (`.audit-cache/cache-and-pipeline-optimization.md` win #1):
//
//   • cache hit — same (technique, text) → no second Groq call
//   • cache miss on technique mismatch — same text, different technique
//   • cache miss on text mismatch — same technique, different text
//   • TTL expiry — entries older than REWRITE_CACHE_MAX_AGE_MS miss
//   • failClosed not cached — validator-rejected rewrites do not poison
//     subsequent calls
//   • eviction at REWRITE_CACHE_MAX_ENTRIES — oldest entry drops first
//   • prompt-version-keyed — model name is in the key, so a model bump
//     invalidates naturally on reload
//
// The cache is module-local; tests reset it via the exported
// `__resetRewriteCacheForTests` to avoid cross-test bleed.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../src/ai/client', () => ({
  callAI: vi.fn(),
  GROQ_FAST_MODEL: 'llama-3.1-8b-instant',
}));

import {
  neutralizeText,
  __resetRewriteCacheForTests,
} from '../../../src/ai/neutralize-only';
import { callAI } from '../../../src/ai/client';
import { Ok } from '../../../src/ai/ai-error';

const mockCallAI = callAI as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockCallAI.mockReset();
  __resetRewriteCacheForTests();
});

// ─────────────────────────────────────────────────────────────────────────
// CACHE HIT — same (technique, text) → second call returns cached value
// without invoking callAI. The throw-on-second-call pattern proves no
// Groq round-trip happens on the cache hit.
// ─────────────────────────────────────────────────────────────────────────

describe('neutralizeText — cache hit', () => {
  it('second call with same (technique, text) returns cached rewrite without hitting Groq', async () => {
    const input = { text: 'I really hate everyone here', technique: 'shame-attack' };
    const rewrite = "I'm frustrated with the people here.";
    mockCallAI.mockResolvedValueOnce(Ok(rewrite));

    const first = await neutralizeText(input);
    expect(first).toBe(rewrite);
    expect(mockCallAI).toHaveBeenCalledTimes(1);

    // Throw on a second invocation — the cache MUST short-circuit before
    // callAI is invoked. If the cache misses, this rejection surfaces and
    // the test fails.
    mockCallAI.mockImplementation(() => {
      throw new Error('cache miss — Groq should not have been called');
    });

    const second = await neutralizeText(input);
    expect(second).toBe(rewrite);
    expect(mockCallAI).toHaveBeenCalledTimes(1);
  });

  it('cache hit returns the exact post-validation string (not the raw model output)', async () => {
    // The raw model output is wrapped in a markdown fence; the post-strip
    // rewrite is what gets cached. Cache hit must return the stripped form.
    const input = { text: 'I really hate everyone here', technique: 'shame-attack' };
    mockCallAI.mockResolvedValueOnce(Ok("```\nI'm frustrated with the people here.\n```"));

    const first = await neutralizeText(input);
    expect(first).toBe("I'm frustrated with the people here.");

    mockCallAI.mockImplementation(() => {
      throw new Error('cache miss — Groq should not have been called');
    });

    const second = await neutralizeText(input);
    expect(second).toBe("I'm frustrated with the people here.");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// CACHE MISS — different technique
// ─────────────────────────────────────────────────────────────────────────

describe('neutralizeText — cache miss on technique mismatch', () => {
  it('same text + different technique re-invokes Groq', async () => {
    const text = 'I really hate everyone here';
    const rewriteA = "I'm frustrated with the people here.";
    const rewriteB = "I'm worried about the people here.";

    mockCallAI.mockResolvedValueOnce(Ok(rewriteA));
    const first = await neutralizeText({ text, technique: 'shame-attack' });
    expect(first).toBe(rewriteA);
    expect(mockCallAI).toHaveBeenCalledTimes(1);

    mockCallAI.mockResolvedValueOnce(Ok(rewriteB));
    const second = await neutralizeText({ text, technique: 'fear-appeal' });
    expect(second).toBe(rewriteB);
    expect(mockCallAI).toHaveBeenCalledTimes(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// CACHE MISS — different text
// ─────────────────────────────────────────────────────────────────────────

describe('neutralizeText — cache miss on text mismatch', () => {
  it('same technique + different text re-invokes Groq', async () => {
    const technique = 'shame-attack';
    const rewriteA = "I'm frustrated with the people here.";
    const rewriteB = "I'm frustrated with the situation today.";

    mockCallAI.mockResolvedValueOnce(Ok(rewriteA));
    const first = await neutralizeText({
      text: 'I really hate everyone here',
      technique,
    });
    expect(first).toBe(rewriteA);
    expect(mockCallAI).toHaveBeenCalledTimes(1);

    mockCallAI.mockResolvedValueOnce(Ok(rewriteB));
    const second = await neutralizeText({
      text: 'I really hate the situation today',
      technique,
    });
    expect(second).toBe(rewriteB);
    expect(mockCallAI).toHaveBeenCalledTimes(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// TTL EXPIRY — entries older than REWRITE_CACHE_MAX_AGE_MS (5 min) miss.
// Uses Date.now stub (same pattern as cache.test.ts) rather than
// vi.useFakeTimers, because the production code calls Date.now() directly
// for timestamp comparison and a Date stub is the surgical seam.
// ─────────────────────────────────────────────────────────────────────────

describe('neutralizeText — cache TTL expiry', () => {
  it('entry past 5-min TTL misses and re-invokes Groq', async () => {
    const input = { text: 'I really hate everyone here', technique: 'shame-attack' };
    const rewriteA = "I'm frustrated with the people here.";
    const rewriteB = "I'm frustrated with the people now.";

    mockCallAI.mockResolvedValueOnce(Ok(rewriteA));
    const first = await neutralizeText(input);
    expect(first).toBe(rewriteA);
    expect(mockCallAI).toHaveBeenCalledTimes(1);

    // Advance past the 5-min TTL, from the moment the entry was written rather
    // than from a clock that keeps running: the stub below is read after an
    // await, so `realNow()` inside it is a later instant every time.
    const realNow = Date.now;
    const written = realNow();
    Date.now = () => written + 5 * 60 * 1000 + 1;

    try {
      mockCallAI.mockResolvedValueOnce(Ok(rewriteB));
      const second = await neutralizeText(input);
      expect(second).toBe(rewriteB);
      expect(mockCallAI).toHaveBeenCalledTimes(2);
    } finally {
      Date.now = realNow;
    }
  });

  it('entry just inside the 5-min TTL still hits', async () => {
    const input = { text: 'I really hate everyone here', technique: 'shame-attack' };
    const rewrite = "I'm frustrated with the people here.";

    // 1 ms before the 5-min boundary, anchored to an instant AT OR BEFORE the
    // cache write. The two TTL tests need OPPOSITE anchors and that is the whole
    // trick: production compares `Date.now() - entry.timestamp > MAX_AGE`
    // (src/ai/neutralize-only.ts:86), so the age this stub produces is
    // `anchor + MAX_AGE - 1 - written`, and only an anchor no later than
    // `written` keeps that strictly under the limit whatever the machine does in
    // between. The test above wants a MISS and so anchors after the write, where
    // any delay only pushes it further outside.
    //
    // Anchoring this one after the write too was the 2026-09-17 repair, and it
    // left the coin toss in place rather than removing it: one millisecond spent
    // writing put the entry a millisecond outside the window it was meant to be
    // inside. It failed in a full run on 2026-09-17 and again on 2026-09-21, and
    // passed alone every time it was re-run, which is what kept it unexplained:
    // running it alone is the one condition under which it cannot fail.
    const realNow = Date.now;
    const before = realNow();

    mockCallAI.mockResolvedValueOnce(Ok(rewrite));
    const first = await neutralizeText(input);
    expect(first).toBe(rewrite);

    // A deliberate delay AFTER the write, which is exactly where the 2026-09-17
    // shape took its anchor. It turns this from a test that usually passes into
    // one that cannot fail while the anchor is right and cannot pass while it is
    // wrong. Anchored before the write, as below, the delay only LOWERS the age
    // (299,994 ms, inside the limit). Anchored after it, the same delay raises
    // the age to 300,004 and the test fails on every machine rather than once in
    // a loaded run. Do not remove it to make this file faster: the five
    // milliseconds are the whole regression guard, and it was checked by putting
    // the old anchor back and watching this fail.
    await new Promise((resolve) => setTimeout(resolve, 5));

    Date.now = () => before + 5 * 60 * 1000 - 1;

    try {
      mockCallAI.mockImplementation(() => {
        throw new Error('cache miss — entry should still be inside TTL');
      });
      const second = await neutralizeText(input);
      expect(second).toBe(rewrite);
      expect(mockCallAI).toHaveBeenCalledTimes(1);
    } finally {
      Date.now = realNow;
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// FAIL-CLOSED NOT CACHED — a validator-rejected rewrite must not poison
// the cache. Subsequent calls re-roll Groq.
// ─────────────────────────────────────────────────────────────────────────

describe('neutralizeText — failClosed paths are not cached', () => {
  it('meta-talk rejection does not cache; next call re-invokes Groq', async () => {
    const input = { text: 'I really hate everyone here', technique: 'shame-attack' };

    // First call: model emits a meta-talk leak → validator rejects → ''
    mockCallAI.mockResolvedValueOnce(
      Ok('The author expresses frustration about the people here.'),
    );
    const first = await neutralizeText(input);
    expect(first).toBe('');
    expect(mockCallAI).toHaveBeenCalledTimes(1);

    // Second call: model emits a clean rewrite → passes validators → cached.
    mockCallAI.mockResolvedValueOnce(Ok("I'm frustrated with the people here."));
    const second = await neutralizeText(input);
    expect(second).toBe("I'm frustrated with the people here.");
    expect(mockCallAI).toHaveBeenCalledTimes(2);
  });

  it('callAI throw does not cache; next call re-invokes Groq', async () => {
    const input = { text: 'I really hate everyone here', technique: 'shame-attack' };

    mockCallAI.mockRejectedValueOnce(new Error('network down'));
    const first = await neutralizeText(input);
    expect(first).toBe('');
    expect(mockCallAI).toHaveBeenCalledTimes(1);

    mockCallAI.mockResolvedValueOnce(Ok("I'm frustrated with the people here."));
    const second = await neutralizeText(input);
    expect(second).toBe("I'm frustrated with the people here.");
    expect(mockCallAI).toHaveBeenCalledTimes(2);
  });

  it('empty model output does not cache; next call re-invokes Groq', async () => {
    const input = { text: 'I really hate everyone here', technique: 'shame-attack' };

    mockCallAI.mockResolvedValueOnce(Ok(''));
    const first = await neutralizeText(input);
    expect(first).toBe('');
    expect(mockCallAI).toHaveBeenCalledTimes(1);

    mockCallAI.mockResolvedValueOnce(Ok("I'm frustrated with the people here."));
    const second = await neutralizeText(input);
    expect(second).toBe("I'm frustrated with the people here.");
    expect(mockCallAI).toHaveBeenCalledTimes(2);
  });

  it('short-rewrite rejection does not cache; next call re-invokes Groq', async () => {
    const input = { text: 'I really hate everyone here', technique: 'shame-attack' };

    // <5 chars → rejected.
    mockCallAI.mockResolvedValueOnce(Ok('ok'));
    const first = await neutralizeText(input);
    expect(first).toBe('');
    expect(mockCallAI).toHaveBeenCalledTimes(1);

    mockCallAI.mockResolvedValueOnce(Ok("I'm frustrated with the people here."));
    const second = await neutralizeText(input);
    expect(second).toBe("I'm frustrated with the people here.");
    expect(mockCallAI).toHaveBeenCalledTimes(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// LRU EVICTION — fill to REWRITE_CACHE_MAX_ENTRIES (100) + add 1 more →
// oldest evicts.
// ─────────────────────────────────────────────────────────────────────────

describe('neutralizeText — LRU eviction at 100-entry cap', () => {
  it('101st distinct entry evicts the first; the first now misses', async () => {
    // Fill the cache with 100 distinct rewrites.
    for (let i = 0; i < 100; i++) {
      mockCallAI.mockResolvedValueOnce(Ok(`rewrite content ${i} that is long enough`));
      await neutralizeText({
        text: `comment text instance number ${i} that is long enough`,
        technique: 'shame-attack',
      });
    }
    expect(mockCallAI).toHaveBeenCalledTimes(100);

    // Add the 101st — evicts entry #0.
    mockCallAI.mockResolvedValueOnce(Ok('rewrite content 100 that is long enough'));
    await neutralizeText({
      text: 'comment text instance number 100 that is long enough',
      technique: 'shame-attack',
    });
    expect(mockCallAI).toHaveBeenCalledTimes(101);

    // Re-request entry #0 — it should MISS (was evicted) and re-invoke Groq.
    mockCallAI.mockResolvedValueOnce(Ok('rewrite content 0 take 2 that is long enough'));
    const reRequest = await neutralizeText({
      text: 'comment text instance number 0 that is long enough',
      technique: 'shame-attack',
    });
    expect(reRequest).toBe('rewrite content 0 take 2 that is long enough');
    expect(mockCallAI).toHaveBeenCalledTimes(102);
  });

  it('touching an entry moves it to the back; eviction targets the new oldest', async () => {
    // Fill the cache to 100.
    for (let i = 0; i < 100; i++) {
      mockCallAI.mockResolvedValueOnce(Ok(`rewrite content ${i} that is long enough`));
      await neutralizeText({
        text: `comment text instance number ${i} that is long enough`,
        technique: 'shame-attack',
      });
    }

    // Touch entry #0 (cache hit refreshes its LRU position).
    mockCallAI.mockImplementation(() => {
      throw new Error('should not hit Groq for the cache-hit refresh');
    });
    await neutralizeText({
      text: 'comment text instance number 0 that is long enough',
      technique: 'shame-attack',
    });
    mockCallAI.mockReset();

    // Add the 101st — entry #1 (now the oldest) evicts; entry #0 survives.
    mockCallAI.mockResolvedValueOnce(Ok('rewrite content 100 that is long enough'));
    await neutralizeText({
      text: 'comment text instance number 100 that is long enough',
      technique: 'shame-attack',
    });

    // Re-request entry #0 — still a HIT (touch saved it).
    mockCallAI.mockImplementation(() => {
      throw new Error('entry #0 should have been preserved by LRU touch');
    });
    const hit = await neutralizeText({
      text: 'comment text instance number 0 that is long enough',
      technique: 'shame-attack',
    });
    expect(hit).toBe('rewrite content 0 that is long enough');

    // Re-request entry #1 — MISS (evicted).
    mockCallAI.mockReset();
    mockCallAI.mockResolvedValueOnce(Ok('rewrite content 1 take 2 that is long enough'));
    const miss = await neutralizeText({
      text: 'comment text instance number 1 that is long enough',
      technique: 'shame-attack',
    });
    expect(miss).toBe('rewrite content 1 take 2 that is long enough');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// PROMPT-VERSION-KEYED — model name is included in the cache key. Bumping
// the model (or shipping a prompt-revision under a different model pin)
// invalidates all entries naturally. This test uses vi.resetModules +
// dynamic import to swap the mocked GROQ_FAST_MODEL between runs.
// ─────────────────────────────────────────────────────────────────────────

describe('neutralizeText — cache key includes prompt/model version', () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock('../../../src/ai/client');
  });

  it('changing the model name invalidates cached entries (fresh module load)', async () => {
    vi.resetModules();
    vi.doMock('../../../src/ai/client', () => ({
      callAI: vi.fn(),
      GROQ_FAST_MODEL: 'old-model-v1',
    }));

    const modA = await import('../../../src/ai/neutralize-only');
    const clientA = await import('../../../src/ai/client');
    const callA = clientA.callAI as unknown as ReturnType<typeof vi.fn>;
    callA.mockResolvedValueOnce(Ok("I'm frustrated with the people here."));

    const first = await modA.neutralizeText({
      text: 'I really hate everyone here',
      technique: 'shame-attack',
    });
    expect(first).toBe("I'm frustrated with the people here.");
    expect(callA).toHaveBeenCalledTimes(1);

    // Bump the model — under a new module load this acts as a "next
    // extension release with a different prompt/model pin". The cache is
    // module-local so the new load starts with an empty Map, but the
    // contract we're pinning is that the KEY shape includes the model,
    // so even within one module load a model-flip would miss. Verify the
    // shape by switching mocks under a fresh module load.
    vi.resetModules();
    vi.doMock('../../../src/ai/client', () => ({
      callAI: vi.fn(),
      GROQ_FAST_MODEL: 'new-model-v2',
    }));

    const modB = await import('../../../src/ai/neutralize-only');
    const clientB = await import('../../../src/ai/client');
    const callB = clientB.callAI as unknown as ReturnType<typeof vi.fn>;
    callB.mockResolvedValueOnce(Ok("I'm frustrated with the people here."));

    // Same (technique, text) but a fresh model pin → miss → Groq invoked.
    const second = await modB.neutralizeText({
      text: 'I really hate everyone here',
      technique: 'shame-attack',
    });
    expect(second).toBe("I'm frustrated with the people here.");
    expect(callB).toHaveBeenCalledTimes(1);
  });
});
