/** @vitest-environment jsdom */
// FeelingWise — resilient chrome.storage.local read contract.
//
// getLocalWithRetry must absorb a TRANSIENT storage blip (retry → recover) so a
// momentary failure under heavy video/audio I/O never collapses a paid/dev user
// to FREE or pauses the video budget. A DEAD context must NOT be retried — it is
// a permanent shutdown and retrying only floods the log.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { getLocalWithRetry, LOCAL_READ_ATTEMPTS } from '../../../src/storage/local-read';

function installGet(get: (keys: string | string[]) => Promise<Record<string, unknown>>): void {
  (globalThis as any).chrome = { storage: { local: { get } } };
}

describe('getLocalWithRetry', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the value on first success without retrying', async () => {
    const get = vi.fn(async () => ({ k: 'v' }));
    installGet(get);
    const out = await getLocalWithRetry('k', 3, 1);
    expect(out).toEqual({ k: 'v' });
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('recovers from a transient failure: rejects once, then resolves', async () => {
    let calls = 0;
    const get = vi.fn(async () => {
      calls++;
      if (calls === 1) throw new Error('storage IO error');
      return { k: 'recovered' };
    });
    installGet(get);
    const out = await getLocalWithRetry('k', 3, 1);
    expect(out).toEqual({ k: 'recovered' });
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('rethrows after exhausting every attempt on persistent transient failure', async () => {
    const get = vi.fn(async () => {
      throw new Error('storage IO error');
    });
    installGet(get);
    await expect(getLocalWithRetry('k', 3, 1)).rejects.toThrow('storage IO error');
    expect(get).toHaveBeenCalledTimes(3);
    expect(LOCAL_READ_ATTEMPTS).toBe(3);
  });

  it('rethrows a dead-context error IMMEDIATELY without retrying', async () => {
    const get = vi.fn(async () => {
      throw new Error('Extension context invalidated');
    });
    installGet(get);
    await expect(getLocalWithRetry('k', 3, 1)).rejects.toThrow('Extension context invalidated');
    expect(get).toHaveBeenCalledTimes(1); // permanent — no retry
  });

  it('with isPresent: retries a resolved-but-missing key, then returns the recovered record', async () => {
    // Under heavy I/O get can RESOLVE without the key (empty record, no throw).
    // A caller that opts in via isPresent gets the same retry a rejection gets.
    let calls = 0;
    const get = vi.fn(async () => {
      calls++;
      return calls === 1 ? {} : { k: 'recovered' };
    });
    installGet(get);
    const out = await getLocalWithRetry('k', 3, 1, (r) => 'k' in r);
    expect(out).toEqual({ k: 'recovered' });
    expect(get).toHaveBeenCalledTimes(2); // first empty resolve was retried
  });

  it('with isPresent: a genuinely-absent key resolves (never throws) after exhausting retries', async () => {
    // The empty-retry must NOT turn a genuinely-absent key into an error — after
    // every attempt still resolves empty, the empty record is returned as-is.
    const get = vi.fn(async () => ({}));
    installGet(get);
    const out = await getLocalWithRetry('k', 3, 1, (r) => 'k' in r);
    expect(out).toEqual({});
    expect(get).toHaveBeenCalledTimes(3); // retried the empty read, then gave up softly
  });

  it('without isPresent: an empty resolve is accepted on the first attempt (no retry)', async () => {
    // Existing callers that expect absence keep the resolve-once behavior.
    const get = vi.fn(async () => ({}));
    installGet(get);
    const out = await getLocalWithRetry('k', 3, 1);
    expect(out).toEqual({});
    expect(get).toHaveBeenCalledTimes(1);
  });
});
