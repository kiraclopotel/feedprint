// @vitest-environment jsdom
//
// The worker carries the reading's calls out (background/relay-fetch.ts), and its gate reads the settings, the key and the
// agreement itself, from storage, in the worker. The Tester's twenty-fifth read (13 Oct 2026): at Silent with a key and the
// agreement not one reading call left the browser while Calm made 15 and Open 25 on the same install, and the page logged
// "AI call failed". Every earlier test of the gate mocked the settings, the licence and the agreement, so none of them
// read what the worker reads. This one keeps all three real over a stored copy of the browser's storage.

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

import { carryOutRelayFetch } from '../../../src/background/relay-fetch';
import { relayFetch } from '../../../src/ai/relay-fetch';
import { getSettings, saveSettings } from '../../../src/storage/settings';
import { gateRefusal } from '../../../src/ai/gate-with-agreement';
import { LICENSE_STORAGE_KEY } from '../../../src/storage/license';
import { bearerOf, recordReadingConsent } from '../../../src/storage/reading-consent';

const URL_CALL = 'https://api.feelingwise.org/v1/chat/completions';
const KEY = 'fw-family-abcdefgh12345678';

let store: Map<string, unknown>;
let fetchSpy: ReturnType<typeof vi.fn>;

function installChrome(): void {
  store = new Map();
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: {
      id: 'ext-id',
      sendMessage: async (m: { type: string; payload: unknown }) => (m.type === 'RELAY_FETCH' ? carryOutRelayFetch(m.payload) : undefined),
    },
    permissions: { contains: async () => true },
    storage: {
      local: {
        get: async (keys: string | string[] | null) => {
          const out: Record<string, unknown> = {};
          const list = keys === null ? [...store.keys()] : Array.isArray(keys) ? keys : [keys];
          for (const k of list) if (store.has(k)) out[k] = store.get(k);
          return out;
        },
        set: async (o: Record<string, unknown>) => { for (const [k, v] of Object.entries(o)) store.set(k, v); },
        remove: async (k: string | string[]) => { for (const x of Array.isArray(k) ? k : [k]) store.delete(x); },
      },
      onChanged: { addListener: () => undefined },
    },
  };
}

const request = () => ({ id: `r-${Math.random().toString(36).slice(2)}`, url: URL_CALL, body: '{}', deadlineMs: 1000, headers: { Authorization: `Bearer ${KEY}` } });

beforeEach(() => {
  installChrome();
  fetchSpy = vi.fn(async () => new Response('{"ok":true}', { status: 200 }));
  vi.stubGlobal('fetch', fetchSpy);
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete (globalThis as { chrome?: unknown }).chrome;
});

async function install(mode: 'child' | 'teen' | 'adult', agreed: boolean): Promise<void> {
  store.set(LICENSE_STORAGE_KEY, KEY);
  await saveSettings({ mode, levelChosen: true });
  if (agreed) await recordReadingConsent(bearerOf({ tier: 'family', secret: 'abcdefgh12345678' }), 'the words shown', 'DeepInfra');
}

describe('what the worker reads for its gate', () => {
  it('Calm: the call goes out', async () => {
    await install('teen', true);
    const reply = await carryOutRelayFetch(request());
    expect(reply.ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('Silent with a key and the agreement: the call goes out', async () => {
    await install('child', true);
    const reply = await carryOutRelayFetch(request());
    expect(reply).toMatchObject({ ok: true });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('Silent with a key and the agreement, from the page through the worker: the call goes out', async () => {
    await install('child', true);
    const res = await relayFetch(URL_CALL, { method: 'POST', headers: { Authorization: `Bearer ${KEY}` }, body: '{}' }, 5000);
    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('Silent with a key and no agreement: refused, naming the agreement; nothing leaves', async () => {
    await install('child', false);
    const reply = await carryOutRelayFetch(request());
    expect(reply).toEqual({ ok: false, kind: 'refused', why: 'no-agreement' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// A refused call names its cause (the page counts it and warns once, ai/relay-fetch.ts), over the same real storage.
describe('the cause of a refusal, read from real storage', () => {
  it('each way the gate says no has its own word, and the ways it says yes have none', async () => {
    await install('child', true);
    expect(await gateRefusal(await getSettings())).toBeNull();

    await saveSettings({ aiAnalysisEnabled: false });
    expect(await gateRefusal(await getSettings())).toBe('switch-off');
    await saveSettings({ aiAnalysisEnabled: true });

    await saveSettings({ levelChosen: false });
    expect(await gateRefusal(await getSettings())).toBe('level-not-chosen');
    await saveSettings({ levelChosen: true });

    await saveSettings({ mode: 'teen' });
    expect(await gateRefusal(await getSettings()), 'Calm needs neither the key nor the agreement here').toBeNull();
    await saveSettings({ mode: 'child' });
  });
});
