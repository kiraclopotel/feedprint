/** @vitest-environment jsdom */
// The reading's calls leave from the extension's worker, not from the social site's page (the Tester's full test,
// 11 Oct 2026: 76 calls whose initiator was the site's own origin, CORS preflights, the browser's error reports to a
// third party, and the key header readable in the site's network panel).
//
// relayFetch (ai/relay-fetch.ts) is what a content script calls; carryOutRelayFetch (background/relay-fetch.ts) is the
// worker's side. Neither is a proxy for anything else: only POSTs to the relay's host, and nothing at Strict.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const bumped = vi.hoisted(() => [] as string[]);
vi.mock('../../../src/diagnostics/diagnostics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/diagnostics/diagnostics')>()),
  bumpCounter: vi.fn((name: string) => { bumped.push(name); }),
}));

import { relayFetch } from '../../../src/ai/relay-fetch';
import { DeadlineError } from '../../../src/ai/fetch-with-deadline';

type Sent = { type: string; payload: Record<string, unknown> };

interface Setup {
  sent: Sent[];
  reply: (m: Sent) => unknown;
}

function installRuntime(setup: Setup): void {
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: {
      id: 'ext-id',
      sendMessage: vi.fn((m: Sent) => {
        setup.sent.push(m);
        return Promise.resolve(setup.reply(m));
      }),
    },
  };
}

const URL_OK = 'https://api.feelingwise.org/v1/chat/completions';
const INIT: RequestInit = { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer fw-x-1' }, body: '{"a":1}' };

let setup: Setup;
beforeEach(() => {
  setup = { sent: [], reply: () => ({ ok: true, status: 200, headers: [['content-type', 'application/json'], ['x-fw-provider', 'deepinfra']], body: '{"ok":true}' }) };
  installRuntime(setup);
});
afterEach(() => {
  delete (globalThis as { chrome?: unknown }).chrome;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('a content script hands the call to the worker', () => {
  it('sends one message with the url, the headers, the body and the deadline, and builds a Response from the answer', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const res = await relayFetch(URL_OK, INIT, 40_000);
    expect(fetchSpy, 'nothing leaves from the page').not.toHaveBeenCalled();
    expect(setup.sent).toHaveLength(1);
    expect(setup.sent[0].type).toBe('RELAY_FETCH');
    expect(setup.sent[0].payload).toMatchObject({ url: URL_OK, body: '{"a":1}', deadlineMs: 40_000, headers: { Authorization: 'Bearer fw-x-1' } });
    expect(res.status).toBe(200);
    expect(res.headers.get('x-fw-provider')).toBe('deepinfra');
    expect(await res.json()).toEqual({ ok: true });
  });

  it('a refusal by the relay comes back as a Response with its status and headers (the caller reads Retry-After from it)', async () => {
    setup.reply = () => ({ ok: true, status: 429, headers: [['retry-after', '7']], body: '{"error":{"code":"rate_limited"}}' });
    const res = await relayFetch(URL_OK, INIT, 40_000);
    expect(res.ok).toBe(false);
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('7');
    expect((await res.clone().json()).error.code).toBe('rate_limited');
  });

  it("the worker's own deadline is the caller's DeadlineError", async () => {
    setup.reply = () => ({ ok: false, kind: 'deadline' });
    await expect(relayFetch(URL_OK, INIT, 40_000)).rejects.toBeInstanceOf(DeadlineError);
  });

  it('a call the worker could not make reads as a network failure, the way a refused fetch does', async () => {
    for (const reply of [{ ok: false, kind: 'network' }, { ok: false, kind: 'refused', why: 'no-agreement' }] as const) {
      setup.reply = () => reply;
      await expect(relayFetch(URL_OK, INIT, 40_000)).rejects.toBeInstanceOf(TypeError);
    }
  });

  it('a refusal is counted by its cause and warned of once per cause, so a refused call is not a mystery', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    bumped.length = 0;
    try {
      setup.reply = () => ({ ok: false, kind: 'refused', why: 'switch-off' });
      await expect(relayFetch(URL_OK, INIT, 40_000)).rejects.toBeInstanceOf(TypeError);
      await expect(relayFetch(URL_OK, INIT, 40_000)).rejects.toBeInstanceOf(TypeError);
      expect(bumped).toEqual(['relayFetchRefused:switch-off', 'relayFetchRefused:switch-off']);
      const said = warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('refused a reading call'));
      expect(said).toEqual(['[FW relay-fetch] the extension worker refused a reading call (switch-off).']);
      setup.reply = () => ({ ok: false, kind: 'refused', why: 'shape' });
      await expect(relayFetch(URL_OK, INIT, 40_000)).rejects.toBeInstanceOf(TypeError);
      expect(warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('refused a reading call'))).toHaveLength(2);
    } finally {
      warn.mockRestore();
    }
  });

  it('a caller that cancels gets an AbortError and the worker is told to stop', async () => {
    let answer!: (v: unknown) => void;
    setup.reply = (m) => (m.type === 'RELAY_FETCH' ? new Promise((r) => { answer = r; }) : undefined);
    const ac = new AbortController();
    const pending = relayFetch(URL_OK, INIT, 40_000, ac.signal);
    const caught = pending.then(() => null, (e: Error) => e);
    ac.abort();
    const err = await caught;
    expect(err?.name).toBe('AbortError');
    const types = setup.sent.map((m) => m.type);
    expect(types).toEqual(['RELAY_FETCH', 'RELAY_FETCH_CANCEL']);
    expect(setup.sent[1].payload.id).toBe(setup.sent[0].payload.id);
    answer({ ok: true, status: 200, headers: [], body: '{}' });
  });

  it('an already cancelled caller sends nothing', async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(relayFetch(URL_OK, INIT, 40_000, ac.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(setup.sent).toHaveLength(0);
  });

  it('a worker that never answers is given up a little after the deadline', async () => {
    vi.useFakeTimers();
    setup.reply = (m) => (m.type === 'RELAY_FETCH' ? new Promise(() => undefined) : undefined);
    const pending = relayFetch(URL_OK, INIT, 1_000).catch((e: Error) => e);
    await vi.advanceTimersByTimeAsync(3_500);
    expect(await pending).toBeInstanceOf(DeadlineError);
    expect(setup.sent.map((m) => m.type)).toEqual(['RELAY_FETCH', 'RELAY_FETCH_CANCEL']);
  });
});

describe('where there is no worker to ask, the call goes out as it always did', () => {
  it('no extension runtime', async () => {
    delete (globalThis as { chrome?: unknown }).chrome;
    const fetchSpy = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    const res = await relayFetch(URL_OK, INIT, 40_000);
    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('a runtime nobody answers on (a message with no listener) falls back to the direct call, and says so', async () => {
    setup.reply = () => undefined;
    const fetchSpy = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    bumped.length = 0;
    try {
      const res = await relayFetch(URL_OK, INIT, 40_000);
      expect(res.status).toBe(200);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      // The bench saw an older worker answer nothing after the files were swapped: every call then left from the page,
      // quietly. The counter is for the diagnostics, the warning for whoever has the console open.
      expect(bumped).toEqual(['relayFetchFellBackToPage']);
      expect(warn.mock.calls.map((c) => String(c[0])).join('\n')).toContain('[FW relay-fetch]');
      await relayFetch(URL_OK, INIT, 40_000);
      expect(bumped, 'counted every time').toHaveLength(2);
      expect(warn, 'but warned once').toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  it('a GET (the licence probe) is not a reading and goes out directly', async () => {
    const fetchSpy = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    await relayFetch(URL_OK, { method: 'GET' }, 5_000);
    expect(setup.sent).toHaveLength(0);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe("the worker's side", () => {
  async function load(settings: Record<string, unknown>) {
    vi.resetModules();
    vi.doMock('../../../src/storage/settings', () => ({ getSettings: vi.fn(async () => settings) }));
    return import('../../../src/background/relay-fetch');
  }
  const request = { id: 'rf-1', url: URL_OK, headers: { Authorization: 'Bearer fw-x-1' }, body: '{"a":1}', deadlineMs: 40_000 };

  afterEach(() => { vi.doUnmock('../../../src/storage/settings'); vi.resetModules(); });

  it('carries a well-formed call out with no referrer and gives the answer back whole', async () => {
    const { carryOutRelayFetch } = await load({ mode: 'teen', levelChosen: true });
    const fetchSpy = vi.fn(async () => new Response('{"x":1}', { status: 200, headers: { 'x-fw-provider': 'deepinfra' } }));
    vi.stubGlobal('fetch', fetchSpy);
    const reply = await carryOutRelayFetch(request);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(URL_OK);
    expect(init.referrerPolicy).toBe('no-referrer');
    expect(init.method).toBe('POST');
    expect(reply).toMatchObject({ ok: true, status: 200, body: '{"x":1}' });
    expect(reply.ok && Object.fromEntries(reply.headers)['x-fw-provider']).toBe('deepinfra');
  });

  it('carries an error status out as an answer, not a failure', async () => {
    const { carryOutRelayFetch } = await load({ mode: 'teen', levelChosen: true });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":{"code":"x"}}', { status: 503 })));
    expect(await carryOutRelayFetch(request)).toMatchObject({ ok: true, status: 503 });
  });

  it('refuses any address that is not the relay, and anything malformed', async () => {
    const { carryOutRelayFetch } = await load({ mode: 'teen', levelChosen: true });
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    for (const bad of [
      { ...request, url: 'https://evil.example/v1/chat/completions' },
      { ...request, url: 'https://api.feelingwise.org.evil.example/x' },
      { ...request, url: 'http://api.feelingwise.org/v1/chat/completions' },
      { ...request, id: '' },
      { ...request, body: 5 },
      { ...request, headers: { A: 5 } },
      { ...request, deadlineMs: 0 },
      null,
      'text',
    ]) {
      expect(await carryOutRelayFetch(bad)).toEqual({ ok: false, kind: 'refused', why: 'shape' });
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('makes no call at Silent without a key, nor before the level is chosen, and names why', async () => {
    for (const [settings, why] of [[{ mode: 'child' }, 'no-key'], [{ mode: 'teen', levelChosen: false }, 'level-not-chosen']] as const) {
      const { carryOutRelayFetch } = await load(settings);
      const fetchSpy = vi.fn();
      vi.stubGlobal('fetch', fetchSpy);
      expect(await carryOutRelayFetch(request)).toEqual({ ok: false, kind: 'refused', why });
      expect(fetchSpy).not.toHaveBeenCalled();
    }
  });

  it('gives up before the worker would be ended, and says it was the deadline', async () => {
    vi.useFakeTimers();
    const { carryOutRelayFetch, WORKER_FETCH_DEADLINE_MS } = await load({ mode: 'teen', levelChosen: true });
    vi.stubGlobal('fetch', vi.fn((_u: string, init: RequestInit) => new Promise((_res, rej) => {
      init.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')));
    })));
    const pending = carryOutRelayFetch(request);
    await vi.advanceTimersByTimeAsync(WORKER_FETCH_DEADLINE_MS + 10);
    expect(await pending).toEqual({ ok: false, kind: 'deadline' });
    expect(WORKER_FETCH_DEADLINE_MS).toBeLessThan(30_000);
  });

  it('a cancel from the page stops the call and says it was aborted', async () => {
    const { carryOutRelayFetch, cancelRelayFetch } = await load({ mode: 'teen', levelChosen: true });
    vi.stubGlobal('fetch', vi.fn((_u: string, init: RequestInit) => new Promise((_res, rej) => {
      init.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')));
    })));
    const pending = carryOutRelayFetch(request);
    await Promise.resolve();
    await Promise.resolve();
    cancelRelayFetch('rf-1');
    expect(await pending).toEqual({ ok: false, kind: 'aborted' });
  });

  it('a network failure is a network failure', async () => {
    const { carryOutRelayFetch } = await load({ mode: 'teen', levelChosen: true });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    expect(await carryOutRelayFetch(request)).toEqual({ ok: false, kind: 'network' });
  });
});
