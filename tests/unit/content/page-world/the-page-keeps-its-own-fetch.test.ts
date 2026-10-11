// @vitest-environment jsdom
//
// The page-world fetch wrapper hands the page back the very promise its fetch made. It used to await that promise in
// its own async frame and return a new one, so every failure of the page's own requests (a site's telemetry blocked by
// its own policy, which the extension never reads) surfaced as the extension's uncaught "Failed to fetch". A response
// the extension reads is read on a side branch: it still arrives, the page can still read the body, and a failed
// request reaches only the page's own promise.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installPageWorldInterceptor } from '../../../../src/content/page-world/fetch-interceptor';

const READ_URL = 'https://x.com/i/api/graphql/abc123/TweetDetail?variables=...';
const NOT_OURS = 'https://telemetry.example.run.app/events?cee=no';

let originalFetch: typeof window.fetch;
let dispose: (() => void) | null = null;
const unhandled: unknown[] = [];
const onUnhandled = (reason: unknown) => { unhandled.push(reason); };

beforeEach(() => {
  originalFetch = window.fetch;
  Object.defineProperty(window, 'location', { writable: true, configurable: true, value: new URL('https://x.com/home') });
  unhandled.length = 0;
  process.on('unhandledRejection', onUnhandled);
});

afterEach(() => {
  dispose?.();
  dispose = null;
  window.fetch = originalFetch;
  process.off('unhandledRejection', onUnhandled);
});

const settle = () => new Promise((r) => setTimeout(r, 10));

describe('the page keeps its own fetch', () => {
  it('a request the extension does not read gets back the very promise the page\'s fetch made', async () => {
    const made = Promise.resolve(new Response('ok'));
    window.fetch = vi.fn(() => made);
    dispose = installPageWorldInterceptor();
    expect(window.fetch(NOT_OURS)).toBe(made);
  });

  it('a request that fails and is not ours rejects only through the page\'s promise', async () => {
    const failed = Promise.reject(new TypeError('Failed to fetch'));
    failed.catch(() => {});
    window.fetch = vi.fn(() => failed);
    dispose = installPageWorldInterceptor();
    const got = window.fetch(NOT_OURS);
    expect(got).toBe(failed);
    await expect(got).rejects.toThrow('Failed to fetch');
    await settle();
    expect(unhandled).toEqual([]);
  });

  it('a request the extension reads also returns the page\'s own promise, and its reading still arrives', async () => {
    const body = { data: { stub: 'permalink-response' } };
    const made = Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    window.fetch = vi.fn(() => made);
    const events: CustomEvent[] = [];
    const listen = (e: Event) => events.push(e as CustomEvent);
    document.addEventListener('fw:platform-payload', listen);
    dispose = installPageWorldInterceptor();

    const got = window.fetch(READ_URL);
    expect(got).toBe(made);
    // The page reads the body itself; the extension's clone was taken first and does not spend it.
    expect(await (await got).json()).toEqual(body);
    await settle();
    document.removeEventListener('fw:platform-payload', listen);
    expect(events).toHaveLength(1);
    expect(events[0].detail.body).toEqual(body);
  });

  it('a request the extension reads that fails leaves no rejection of the extension\'s own', async () => {
    const failed = Promise.reject(new TypeError('Failed to fetch'));
    failed.catch(() => {});
    window.fetch = vi.fn(() => failed);
    dispose = installPageWorldInterceptor();
    const got = window.fetch(READ_URL);
    expect(got).toBe(failed);
    await expect(got).rejects.toThrow('Failed to fetch');
    await settle();
    expect(unhandled).toEqual([]);
  });
});
