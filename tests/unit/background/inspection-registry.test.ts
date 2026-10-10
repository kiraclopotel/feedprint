// FeelingWise — inspection-tab registry (src/background/inspection-registry.ts).
//
// The registry is the SOLE source of the content script's inspection flag, so
// its invariants are child-safety invariants: an unknown tab must never look
// registered, an expired grant must die on read, and a closed tab's entry must
// be removable so a recycled tabId cannot inherit a grant.
//
// The 2026-08-01 owner repro added two invariants the old in-memory design
// failed: (1) TAB-CREATE RACE — a document_start content script queries before
// the SW knows the tabId, so a URL grant written BEFORE tab creation must
// resolve the query; (2) SW EVICTION — grants must survive a worker restart
// (a second registry instance over the same storage sees them).

import { describe, it, expect } from 'vitest';
import {
  createInspectionRegistry,
  normalizeInspectionUrl,
  INSPECTION_TAB_TTL_MS,
  INSPECTION_GRANTS_STORAGE_KEY,
  type InspectionGrantStorage,
} from '../../../src/background/inspection-registry';

function memoryStorage(): InspectionGrantStorage & { state: Record<string, unknown> } {
  const state: Record<string, unknown> = {};
  return {
    state,
    get: async (key: string) => (key in state ? { [key]: state[key] } : {}),
    set: async (items: Record<string, unknown>) => { Object.assign(state, items); },
  };
}

const URL_A = 'https://x.com/user/status/123';

describe('inspection-registry — grant resolution', () => {
  it('a tab bound via bindTab resolves its mode by tabId', async () => {
    const reg = createInspectionRegistry(memoryStorage(), () => 1_000);
    await reg.grantForUrl(URL_A, 'reveal');
    await reg.bindTab(URL_A, 'reveal', 7);
    expect(await reg.lookup(7)).toEqual({ mode: 'reveal' });
  });

  it('TAB-CREATE RACE: a URL grant written before the tab exists resolves the startup query by sender URL', async () => {
    // The exact owner-repro ordering: grant written → content script queries
    // (tabs.create not yet resolved, so no tabId binding happened) → the query
    // must still get the grant, matched by URL and bound to the querying tab.
    const reg = createInspectionRegistry(memoryStorage(), () => 1_000);
    await reg.grantForUrl(URL_A, 'observe');
    expect(await reg.lookup(42, URL_A)).toEqual({ mode: 'observe' });
    // And the grant is now bound: same tab keeps it by tabId alone.
    expect(await reg.lookup(42)).toEqual({ mode: 'observe' });
  });

  it('URL binding is ONE-SHOT: a second tab with the same URL gets nothing', async () => {
    const reg = createInspectionRegistry(memoryStorage(), () => 1_000);
    await reg.grantForUrl(URL_A, 'observe');
    await reg.lookup(42, URL_A); // consumes / binds
    expect(await reg.lookup(43, URL_A)).toBeNull(); // fail-closed for any other tab
  });

  it('SW EVICTION: a fresh registry instance over the same storage still resolves the grant', async () => {
    const storage = memoryStorage();
    const regA = createInspectionRegistry(storage, () => 1_000);
    await regA.grantForUrl(URL_A, 'observe');
    await regA.bindTab(URL_A, 'observe', 42);
    // Worker evicted; new SW realm builds a new registry over storage.session.
    const regB = createInspectionRegistry(storage, () => 2_000);
    expect(await regB.lookup(42)).toEqual({ mode: 'observe' });
  });

  it('SW EVICTION mid-race: pending URL grant survives the restart and binds in the new realm', async () => {
    const storage = memoryStorage();
    const regA = createInspectionRegistry(storage, () => 1_000);
    await regA.grantForUrl(URL_A, 'reveal'); // tab never bound — worker died first
    const regB = createInspectionRegistry(storage, () => 2_000);
    expect(await regB.lookup(9, URL_A)).toEqual({ mode: 'reveal' });
  });

  it('URL matching normalizes: twitter.com/x.com, www, query, hash, trailing slash', async () => {
    const reg = createInspectionRegistry(memoryStorage(), () => 1_000);
    await reg.grantForUrl('https://twitter.com/user/status/123', 'observe');
    expect(await reg.lookup(5, 'https://www.x.com/user/status/123/?ref=share#top')).toEqual({ mode: 'observe' });
  });

  it('a DIFFERENT URL never matches a pending grant (fail-closed)', async () => {
    const reg = createInspectionRegistry(memoryStorage(), () => 1_000);
    await reg.grantForUrl(URL_A, 'observe');
    expect(await reg.lookup(5, 'https://x.com/other/status/999')).toBeNull();
  });

  it('non-http(s) URLs get no grant and match nothing', async () => {
    const reg = createInspectionRegistry(memoryStorage(), () => 1_000);
    await reg.grantForUrl('javascript:alert(1)', 'reveal');
    expect(await reg.size()).toBe(0);
    expect(await reg.lookup(5, 'javascript:alert(1)')).toBeNull();
  });
});

describe('inspection-registry — fail-closed defaults', () => {
  it('lookup returns null for a tab that was never registered', async () => {
    const reg = createInspectionRegistry(memoryStorage(), () => 0);
    expect(await reg.lookup(99)).toBeNull();
    expect(await reg.lookup(99, 'https://x.com/a/b')).toBeNull();
  });

  it('a throwing storage resolves lookup to null, never a grant', async () => {
    const broken: InspectionGrantStorage = {
      get: async () => { throw new Error('storage dead'); },
      set: async () => { throw new Error('storage dead'); },
    };
    const reg = createInspectionRegistry(broken, () => 0);
    expect(await reg.lookup(1, URL_A)).toBeNull();
  });

  it('a null storage area (no chrome.storage.session) resolves lookup to null', async () => {
    const reg = createInspectionRegistry(null, () => 0);
    await reg.grantForUrl(URL_A, 'reveal');
    expect(await reg.lookup(1, URL_A)).toBeNull();
  });

  it('malformed stored entries are ignored', async () => {
    const storage = memoryStorage();
    storage.state[INSPECTION_GRANTS_STORAGE_KEY] = [
      { mode: 'root', url: 'x.com/a', tabId: 1, expiresAt: 9e15 },
      'garbage',
      null,
      { mode: 'reveal' },
    ];
    const reg = createInspectionRegistry(storage, () => 0);
    expect(await reg.lookup(1)).toBeNull();
  });
});

describe('inspection-registry — TTL and removal', () => {
  it('an expired grant is null on lookup and pruned from storage', async () => {
    let now = 0;
    const storage = memoryStorage();
    const reg = createInspectionRegistry(storage, () => now);
    await reg.grantForUrl(URL_A, 'reveal');
    await reg.bindTab(URL_A, 'reveal', 7);
    now = INSPECTION_TAB_TTL_MS; // exactly at expiry — grant is over
    expect(await reg.lookup(7)).toBeNull();
    expect(await reg.size()).toBe(0);
  });

  it('a grant within its TTL survives repeated lookups', async () => {
    let now = 0;
    const reg = createInspectionRegistry(memoryStorage(), () => now);
    await reg.grantForUrl(URL_A, 'observe');
    await reg.bindTab(URL_A, 'observe', 7);
    now = INSPECTION_TAB_TTL_MS - 1;
    expect(await reg.lookup(7)).toEqual({ mode: 'observe' });
    expect(await reg.lookup(7)).toEqual({ mode: 'observe' });
  });

  it('remove (tab closed) drops the entry so a recycled tabId gets nothing', async () => {
    const reg = createInspectionRegistry(memoryStorage(), () => 0);
    await reg.grantForUrl(URL_A, 'reveal');
    await reg.bindTab(URL_A, 'reveal', 5);
    await reg.remove(5);
    expect(await reg.lookup(5)).toBeNull();
    // The recycled tab also cannot re-match by URL — the grant is gone.
    expect(await reg.lookup(5, URL_A)).toBeNull();
    expect(await reg.size()).toBe(0);
  });

  it('re-binding a tab overwrites its mode', async () => {
    const reg = createInspectionRegistry(memoryStorage(), () => 0);
    await reg.bindTab(URL_A, 'observe', 3);
    await reg.bindTab(URL_A, 'reveal', 3);
    expect(await reg.lookup(3)).toEqual({ mode: 'reveal' });
  });
});

describe('normalizeInspectionUrl', () => {
  it.each([
    ['https://www.x.com/a/b/?q=1#h', 'x.com/a/b'],
    ['https://twitter.com/a/b', 'x.com/a/b'],
    ['http://TIKTOK.com/@u/video/1/', 'tiktok.com/@u/video/1'],
    ['javascript:alert(1)', null],
    ['file:///etc/passwd', null],
    ['not a url', null],
    ['', null],
    [undefined, null],
  ])('%s → %s', (input, expected) => {
    expect(normalizeInspectionUrl(input as string | undefined)).toBe(expected);
  });
});
