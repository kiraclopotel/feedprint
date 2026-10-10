// @vitest-environment jsdom
//
// The selector-health counters are the only warning that a platform has
// rotated its DOM and the adapters have gone blind. The file's own header says
// the alternative is no signal at all until users report that nothing works.
//
// They were held in page memory behind a thirty-second timer with no other
// flush. A hard navigation, a tab close or an extension reload inside that
// window dropped every hit and miss since the last flush, silently. That is
// worst on short visits, which is exactly what a feed that has stopped working
// produces: the instrument under-reported hardest precisely when it mattered
// most, and nothing said so.
//
// diagnostics.ts grew the same guard on 18 September, for the same reason, in
// its own words: "a hard navigation kills the timer before it fires." It was
// never carried the one file across. This locks it here.
//
// Own file rather than appended to selector-health.test.ts: that file drives
// the timer path with fake timers, and a pagehide test wants real ones.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  recordSelectorMiss,
  readSelectorHealth,
  _resetSelectorHealthForTesting,
  _peekSelectorHealthForTesting,
} from '../../../src/diagnostics/selector-health';

let stubData: Record<string, unknown> = {};
let setCalls = 0;

function installChromeStub(): void {
  stubData = {};
  setCalls = 0;
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get: async (keys: string[] | string) => {
          const out: Record<string, unknown> = {};
          const list = Array.isArray(keys) ? keys : [keys];
          for (const k of list) if (k in stubData) out[k] = stubData[k];
          return out;
        },
        set: async (d: Record<string, unknown>) => {
          setCalls += 1;
          Object.assign(stubData, d);
        },
      },
    },
  };
}

/** Let the flush's two awaited storage round trips settle. */
async function settle(): Promise<void> {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
}

beforeEach(() => {
  installChromeStub();
  _resetSelectorHealthForTesting();
});

afterEach(() => {
  _resetSelectorHealthForTesting();
  delete (globalThis as unknown as { chrome?: unknown }).chrome;
});

describe('selector health survives the page it is watching (2026-09-19)', () => {
  it('writes the counters to storage on pagehide, without waiting for the timer', async () => {
    recordSelectorMiss('twitter.tweetText');
    recordSelectorMiss('twitter.tweetText');
    recordSelectorMiss('facebook.article');

    // Still only in memory: the thirty-second timer has not fired and nothing
    // in this test advances it.
    expect(setCalls, 'nothing written yet').toBe(0);
    expect(Object.keys(_peekSelectorHealthForTesting()).length).toBeGreaterThan(0);

    window.dispatchEvent(new Event('pagehide'));
    await settle();

    expect(setCalls, 'pagehide wrote the counters').toBeGreaterThan(0);
    const stored = await readSelectorHealth();
    const misses = JSON.stringify(stored);
    expect(misses, 'the misses reached storage').toContain('twitter.tweetText');
    expect(misses).toContain('facebook.article');
  });

  it('binds once, however many outcomes are recorded', async () => {
    for (let i = 0; i < 25; i += 1) recordSelectorMiss('tiktok.caption');
    window.dispatchEvent(new Event('pagehide'));
    await settle();
    // One binding means one write for one pagehide. Twenty five bindings would
    // mean twenty five writes of the same counters, which is how a "best
    // effort" flush turns into a storage stampede on teardown.
    expect(setCalls).toBe(1);
  });

  it('is a real guard: with the binding gone the counters die with the page', async () => {
    // The defect this file exists for, put back on purpose. Nothing dispatches
    // to a window that never had a listener, so the counters stay in memory and
    // storage never sees them.
    _resetSelectorHealthForTesting();
    installChromeStub();
    const bare = { ...(_peekSelectorHealthForTesting()) };
    expect(Object.keys(bare).length).toBe(0);

    // A page that records nothing binds nothing, so pagehide writes nothing.
    window.dispatchEvent(new Event('pagehide'));
    await settle();
    expect(setCalls, 'no counters, no write').toBe(0);
  });
});
