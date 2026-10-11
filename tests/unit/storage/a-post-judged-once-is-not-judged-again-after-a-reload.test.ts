// A post judged once is not judged again after a page reload (11 Oct 2026, the Tester's full test: 34 calls for 24 post
// reads, nothing cached across a reload).
//
// The cache has three tiers: memory (gone with the page), chrome.storage.session, and chrome.storage.local for seven
// days. A content script cannot reach the session area unless the worker grants it, so there the lookup ended at the
// second tier and the third, which is written on every verdict, was never read. The lookup now goes on to the third when
// the second is absent or refuses. A verdict is stamped with the build that made it, so a rebuild (a new check on the
// rewrite, a changed prompt) never serves what an older build decided.

import { describe, it, expect, beforeEach, vi } from 'vitest';

type Area = { data: Record<string, unknown>; get: (k: unknown) => Promise<Record<string, unknown>>; set: (o: Record<string, unknown>) => Promise<void>; remove: (k: unknown) => Promise<void> };

function area(): Area {
  const data: Record<string, unknown> = {};
  return {
    data,
    get: async (keys) => {
      const out: Record<string, unknown> = {};
      for (const k of Array.isArray(keys) ? keys : [keys as string]) if (k in data) out[k] = data[k];
      return out;
    },
    set: async (o) => { Object.assign(data, o); },
    remove: async (keys) => { for (const k of Array.isArray(keys) ? keys : [keys as string]) delete data[k]; },
  };
}

const analysis = { postId: 'p', isManipulative: true, techniques: [], overallScore: 6, overallConfidence: 0.8 } as never;

/** A page load: a fresh module, so the in-memory tier is empty, over the same stored areas. */
async function pageLoad(local: Area, session: 'absent' | 'refusing', build = 'fwbid-one') {
  vi.resetModules();
  const sessionArea = session === 'absent' ? undefined : {
    get: async () => { throw new Error('Access to storage is not allowed from this context.'); },
    set: async () => { throw new Error('Access to storage is not allowed from this context.'); },
    remove: async () => undefined,
  };
  (globalThis as Record<string, unknown>).chrome = {
    storage: { local, ...(sessionArea ? { session: sessionArea } : {}) },
    runtime: { getManifest: () => ({ version: '9.9.9' }) },
  };
  const { provideBuildId } = await import('../../../src/core/build-id');
  provideBuildId(build);
  return (await import('../../../src/storage/cache')).processingCache;
}

beforeEach(() => {
  delete (globalThis as Record<string, unknown>).chrome;
});

describe('a verdict outlives the page', () => {
  it.each(['absent', 'refusing'] as const)('with the session area %s, the next page load finds the rewrite in the local tier', async (session) => {
    const local = area();
    const first = await pageLoad(local, session);
    first.set('h-reload', analysis, 'a calmer way to say it');
    await new Promise((r) => setTimeout(r, 0));

    const second = await pageLoad(local, session);
    const hit = await second.getPersistent('h-reload');
    expect(hit?.neutralizedText).toBe('a calmer way to say it');
  });

  it('a passed post is remembered too, so it is not read again', async () => {
    const local = area();
    const first = await pageLoad(local, 'absent');
    first.set('h-pass', { ...(analysis as object), isManipulative: false } as never, null);
    await new Promise((r) => setTimeout(r, 0));
    const hit = await (await pageLoad(local, 'absent')).getPersistent('h-pass');
    expect(hit).not.toBeNull();
    expect(hit?.neutralizedText).toBeNull();
  });

  it('a rebuild does not serve what the earlier build decided', async () => {
    const local = area();
    const first = await pageLoad(local, 'absent', 'fwbid-one');
    first.set('h-build', analysis, 'text from the old build');
    await new Promise((r) => setTimeout(r, 0));

    expect(await (await pageLoad(local, 'absent', 'fwbid-one')).getPersistent('h-build')).not.toBeNull();
    expect(await (await pageLoad(local, 'absent', 'fwbid-two')).getPersistent('h-build')).toBeNull();
  });

  it('nothing stored means a miss, not an error', async () => {
    const miss = await (await pageLoad(area(), 'refusing')).getPersistent('never-seen');
    expect(miss).toBeNull();
  });
});
