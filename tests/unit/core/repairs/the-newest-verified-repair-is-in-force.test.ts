// @vitest-environment node
//
// Which repair file is in force, and how Feedprint fetches one (11 Oct 2026).
//
// The package carries a signed repair file; Feedprint may fetch a newer one. Whatever sits in storage is verified again
// every time it is read, the newest verified one wins, and a fetch changes nothing unless it verifies and is newer.
// The fetch carries no identifier and obeys the same rule as every other outside call: Strict, and a level nobody has
// chosen yet, ask no one.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RepairPublicKey } from '../../../../src/core/repairs/signed';

const keys = vi.hoisted(() => ({ list: [] as RepairPublicKey[] }));
const packaged = vi.hoisted(() => ({ text: '' }));
const settings = vi.hoisted(() => ({ value: { mode: 'adult', levelChosen: true } as { mode: string; levelChosen?: boolean } }));

vi.mock('../../../../src/core/repairs/public-keys', () => ({ get REPAIR_PUBLIC_KEYS() { return keys.list; } }));
vi.mock('../../../../src/core/repairs/packaged', () => ({ get PACKAGED_REPAIRS() { return packaged.text; } }));
vi.mock('../../../../src/storage/settings', () => ({ getSettings: vi.fn(async () => settings.value) }));

import { acceptFetchedRepairs, loadRepairs, REPAIRS_STATUS_KEY, REPAIRS_STORAGE_KEY } from '../../../../src/core/repairs/store';
import { __resetRepairsForTest, activeRepairVersion, wordFamily } from '../../../../src/core/repairs/families';
import { syncRepairs, syncRepairsIfDue } from '../../../../src/background/repairs-sync';

let sign: (text: string) => Promise<string>;
let signOther: (text: string) => Promise<string>;

async function pair(): Promise<{ publicKeyB64: string; sign: (text: string) => Promise<string> }> {
  const kp = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
  return {
    publicKeyB64: b64(new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey))),
    sign: async (text) => b64(new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, kp.privateKey, new TextEncoder().encode(text)))),
  };
}

beforeAll(async () => {
  const ours = await pair();
  const theirs = await pair();
  keys.list = [{ id: 'r1', publicKeyB64: ours.publicKeyB64 }];
  sign = ours.sign;
  signOther = theirs.sign;
});

async function envelope(version: number, words: string[] = [], signer: (t: string) => Promise<string> = sign): Promise<string> {
  const payload = JSON.stringify({ v: 1, version, issuedAt: '2026-10-11T16:00:00Z', entries: [{ family: 'ads.words', add: words }] });
  return JSON.stringify({ payload, signature: await signer(payload), keyId: 'r1' });
}

let storage: Record<string, unknown>;

beforeEach(async () => {
  storage = {};
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn(async (names: string[]) => Object.fromEntries(names.filter((n) => n in storage).map((n) => [n, storage[n]]))),
        set: vi.fn(async (items: Record<string, unknown>) => { Object.assign(storage, items); }),
      },
    },
  });
  settings.value = { mode: 'adult', levelChosen: true };
  packaged.text = await envelope(1, ['Packaged']);
  __resetRepairsForTest();
});

afterEach(() => {
  vi.unstubAllGlobals();
  __resetRepairsForTest();
});

describe('the file in force', () => {
  it('is the packaged one when nothing was fetched', async () => {
    expect(await loadRepairs()).toBe(1);
    expect(activeRepairVersion()).toBe(1);
    expect(wordFamily('ads.words', ['Sponsored'])).toEqual(['Sponsored', 'Packaged']);
  });

  it('is a fetched one when it is newer', async () => {
    storage[REPAIRS_STORAGE_KEY] = await envelope(5, ['Fetched']);
    expect(await loadRepairs()).toBe(5);
    expect(wordFamily('ads.words', ['Sponsored'])).toEqual(['Sponsored', 'Fetched']);
  });

  it('is the packaged one when the stored one is older, forged, or not a file', async () => {
    for (const stored of [await envelope(0, ['Old']), await envelope(9, ['Forged'], signOther), 'garbage', 42]) {
      __resetRepairsForTest();
      storage[REPAIRS_STORAGE_KEY] = stored;
      expect(await loadRepairs(), String(stored).slice(0, 30)).toBe(1);
      expect(wordFamily('ads.words', ['Sponsored'])).toEqual(['Sponsored', 'Packaged']);
    }
  });

  it('is no repair at all when the packaged file does not verify and nothing else exists', async () => {
    packaged.text = 'garbage';
    expect(await loadRepairs()).toBe(0);
    expect(wordFamily('ads.words', ['Sponsored'])).toEqual(['Sponsored']);
  });

  it('still loads with no storage to read (a page without the extension API)', async () => {
    vi.unstubAllGlobals();
    expect(await loadRepairs()).toBe(1);
  });
});

describe('accepting a fetched file', () => {
  it('keeps one that verifies and is newer', async () => {
    const text = await envelope(3, ['A']);
    expect(await acceptFetchedRepairs(text)).toBe('stored');
    expect(storage[REPAIRS_STORAGE_KEY]).toBe(text);
  });

  it('keeps nothing that is the same age, older, forged or not a file', async () => {
    expect(await acceptFetchedRepairs(await envelope(1, ['Same']))).toBe('older');
    expect(await acceptFetchedRepairs(await envelope(9, ['Forged'], signOther))).toBe('invalid');
    expect(await acceptFetchedRepairs('garbage')).toBe('invalid');
    expect(REPAIRS_STORAGE_KEY in storage).toBe(false);
  });

  it('is not moved backwards by an older file after a newer one was stored', async () => {
    expect(await acceptFetchedRepairs(await envelope(4, ['Four']))).toBe('stored');
    expect(await acceptFetchedRepairs(await envelope(3, ['Three']))).toBe('older');
    expect(await loadRepairs()).toBe(4);
  });
});

function fakeFetch(body: string, init: { ok?: boolean; length?: number; status?: number } = {}): typeof fetch {
  return vi.fn(async () => ({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    headers: { get: (name: string) => (name.toLowerCase() === 'content-length' && init.length !== undefined ? String(init.length) : null) },
    text: async () => body,
  })) as unknown as typeof fetch;
}

describe('the fetch', () => {
  it('asks once with nothing attached, and stores a newer file', async () => {
    const fetcher = fakeFetch(await envelope(6, ['Six']));
    expect(await syncRepairs(fetcher)).toBe('stored');
    const call = (fetcher as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0];
    expect(call[0]).toBe('https://api.feelingwise.org/v1/repairs');
    expect(call[1]).toMatchObject({ method: 'GET', cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' });
    expect(call[1].headers).toBeUndefined();
    expect(call[1].body).toBeUndefined();
    expect((storage[REPAIRS_STATUS_KEY] as { result: string }).result).toBe('stored');
  });

  it('reads 204 as nothing newer than the package, and stores nothing', async () => {
    expect(await syncRepairs(fakeFetch('', { status: 204 }))).toBe('older');
    expect(REPAIRS_STORAGE_KEY in storage).toBe(false);
    expect((storage[REPAIRS_STATUS_KEY] as { result: string }).result).toBe('older');
  });

  it('asks no one in Strict, and none while the level is not chosen', async () => {
    const fetcher = fakeFetch(await envelope(6));
    settings.value = { mode: 'child', levelChosen: true };
    expect(await syncRepairs(fetcher)).toBe('not-allowed');
    settings.value = { mode: 'adult', levelChosen: false };
    expect(await syncRepairs(fetcher)).toBe('not-allowed');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('changes nothing when the answer is bad, large, forged or the relay is down', async () => {
    expect(await syncRepairs(fakeFetch('garbage'))).toBe('invalid');
    expect(await syncRepairs(fakeFetch(await envelope(8), { length: 90_000 }))).toBe('offline');
    expect(await syncRepairs(fakeFetch('x'.repeat(80_001)))).toBe('invalid');
    expect(await syncRepairs(fakeFetch(await envelope(8, [], signOther)))).toBe('invalid');
    expect(await syncRepairs(fakeFetch('', { ok: false }))).toBe('offline');
    expect(await syncRepairs((async () => { throw new Error('down'); }) as unknown as typeof fetch)).toBe('offline');
    expect(REPAIRS_STORAGE_KEY in storage).toBe(false);
  });
});

describe('when it is time', () => {
  const HOUR = 60 * 60 * 1000;

  it('asks when it never has, then not again for six hours, then again', async () => {
    const fetcher = fakeFetch(await envelope(2, ['Two']));
    const t0 = Date.now();
    expect(await syncRepairsIfDue(fetcher, t0)).toBe('stored');
    expect(await syncRepairsIfDue(fetcher, t0 + HOUR)).toBe('not-due');
    expect(await syncRepairsIfDue(fetcher, t0 + 5 * HOUR)).toBe('not-due');
    expect(await syncRepairsIfDue(fetcher, t0 + 7 * HOUR)).toBe('older');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('tries again after an hour when the relay could not be reached', async () => {
    const down = fakeFetch('', { ok: false });
    const t0 = Date.now();
    expect(await syncRepairsIfDue(down, t0)).toBe('offline');
    expect(await syncRepairsIfDue(down, t0 + 30 * 60 * 1000)).toBe('not-due');
    expect(await syncRepairsIfDue(down, t0 + 61 * 60 * 1000)).toBe('offline');
  });
});
