// The proxy's time-stamp route authenticates every caller and its key pattern has no free tier, so a
// free install asking it could only be refused after handing over the chain fingerprint and its
// address. A free install still asks the authorities directly; only the proxy fallback is closed.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { requestVerifiedTimestamps, TSA_ENDPOINTS } from '../../../src/forensics/tsa-client';

const PROXY_TSA_URL = 'https://api.feelingwise.org/v1/tsa';
// A synthetic key in the documented format `fw-<tier>-<secret>`; no real key is read or written here.
const PAID_TEST_KEY = 'fw-family-testkey0123';
const HEAD = 'ab'.repeat(32);

let fetched: string[] = [];
let realFetch: typeof globalThis.fetch;

function installChrome(stored: Record<string, unknown>, hostPermission: boolean): void {
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: { id: 'test-extension' },
    permissions: { contains: async () => hostPermission },
    storage: { local: { get: async () => ({ ...stored }) } },
  };
}

beforeEach(() => {
  fetched = [];
  realFetch = globalThis.fetch;
  // Every authority answers 503, so each round reaches the point where the proxy would be asked.
  globalThis.fetch = (async (input: unknown) => {
    fetched.push(String(input));
    return { ok: false, status: 503 } as unknown as Response;
  }) as unknown as typeof globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  delete (globalThis as unknown as { chrome?: unknown }).chrome;
});

describe('a free install never sends its fingerprint to the proxy', () => {
  it('asks every authority directly and then stops, when all of them fail', async () => {
    installChrome({}, true);
    const round = await requestVerifiedTimestamps(HEAD);
    expect(fetched.filter(url => url === PROXY_TSA_URL)).toEqual([]);
    expect(fetched.sort()).toEqual(TSA_ENDPOINTS.map(e => e.url).sort());
    expect(round.anchors).toEqual([]);
  });

  it('makes no request at all when no authority can be reached directly', async () => {
    installChrome({}, false);
    const round = await requestVerifiedTimestamps(HEAD);
    expect(fetched).toEqual([]);
    expect(round.reasons[0]).toMatch(/_no_host_permission$/);
  });

  it('a paid install still falls back to the proxy once', async () => {
    installChrome({ fw_license_key: PAID_TEST_KEY }, true);
    await requestVerifiedTimestamps(HEAD);
    expect(fetched.filter(url => url === PROXY_TSA_URL)).toHaveLength(1);
  });
});
