// LOOP-053 — selector-health counter module.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  recordSelectorHit,
  recordSelectorMiss,
  recordSelectorOutcome,
  flushNow,
  readSelectorHealth,
  _resetSelectorHealthForTesting,
  _peekSelectorHealthForTesting,
} from '../../../src/diagnostics/selector-health';

// Minimal chrome.storage.local stub. Records writes; reads last stored value.
let stubData: Record<string, unknown> = {};

function installChromeStub(): void {
  stubData = {};
  (globalThis as unknown as {
    chrome: { storage: { local: { get: (k: string[] | string) => Promise<Record<string, unknown>>; set: (d: Record<string, unknown>) => Promise<void> } } };
  }).chrome = {
    storage: {
      local: {
        get: async (keys) => {
          if (Array.isArray(keys)) {
            const out: Record<string, unknown> = {};
            for (const k of keys) if (k in stubData) out[k] = stubData[k];
            return out;
          }
          if (typeof keys === 'string') return keys in stubData ? { [keys]: stubData[keys] } : {};
          return { ...stubData };
        },
        set: async (next) => { Object.assign(stubData, next); },
      },
    },
  };
}

function clearChromeStub(): void {
  stubData = {};
  delete (globalThis as Partial<{ chrome: unknown }>).chrome;
}

beforeEach(() => {
  _resetSelectorHealthForTesting();
  installChromeStub();
});

afterEach(() => {
  _resetSelectorHealthForTesting();
  clearChromeStub();
  vi.useRealTimers();
});

describe('selector-health — counter increments', () => {
  it('primary hit increments only the primary counter', () => {
    recordSelectorHit('twitter.post-text', 0);
    const c = _peekSelectorHealthForTesting()['twitter.post-text'];
    expect(c.primary).toBe(1);
    expect(c.fallback1).toBe(0);
    expect(c.miss).toBe(0);
  });

  it('fallback-1 hit increments only the fallback1 counter', () => {
    recordSelectorHit('twitter.post-text', 1);
    const c = _peekSelectorHealthForTesting()['twitter.post-text'];
    expect(c.fallback1).toBe(1);
    expect(c.primary).toBe(0);
  });

  it('fallback-2 hit increments the fallback2 counter', () => {
    recordSelectorHit('twitter.post-text', 2);
    const c = _peekSelectorHealthForTesting()['twitter.post-text'];
    expect(c.fallback2).toBe(1);
  });

  it('index >= 3 increments the fallbackDeep counter', () => {
    recordSelectorHit('twitter.post-text', 3);
    recordSelectorHit('twitter.post-text', 5);
    const c = _peekSelectorHealthForTesting()['twitter.post-text'];
    expect(c.fallbackDeep).toBe(2);
  });

  it('recordSelectorMiss increments the miss counter', () => {
    recordSelectorMiss('twitter.post-text');
    const c = _peekSelectorHealthForTesting()['twitter.post-text'];
    expect(c.miss).toBe(1);
  });

  it('mixed sequence accumulates correctly across tiers', () => {
    recordSelectorHit('twitter.post-text', 0);
    recordSelectorHit('twitter.post-text', 0);
    recordSelectorHit('twitter.post-text', 1);
    recordSelectorHit('twitter.post-text', 2);
    recordSelectorMiss('twitter.post-text');
    const c = _peekSelectorHealthForTesting()['twitter.post-text'];
    expect(c.primary).toBe(2);
    expect(c.fallback1).toBe(1);
    expect(c.fallback2).toBe(1);
    expect(c.miss).toBe(1);
  });

  it('different labels maintain separate counters', () => {
    recordSelectorHit('twitter.post-text', 0);
    recordSelectorMiss('tiktok.comment-list');
    const snapshot = _peekSelectorHealthForTesting();
    expect(snapshot['twitter.post-text'].primary).toBe(1);
    expect(snapshot['twitter.post-text'].miss).toBe(0);
    expect(snapshot['tiktok.comment-list'].miss).toBe(1);
    expect(snapshot['tiktok.comment-list'].primary).toBe(0);
  });

  it('recordSelectorOutcome is equivalent to the helpers for the primary tier', () => {
    recordSelectorOutcome('twitter.post-text', 'primary');
    expect(_peekSelectorHealthForTesting()['twitter.post-text'].primary).toBe(1);
  });
});

describe('selector-health — flushNow persistence', () => {
  it('writes in-memory counters into chrome.storage.local.fw_selector_health', async () => {
    recordSelectorHit('twitter.post-text', 0);
    recordSelectorHit('twitter.post-text', 0);
    recordSelectorMiss('tiktok.comment-list');
    await flushNow();
    const raw = (await chrome.storage.local.get(['fw_selector_health']))['fw_selector_health'] as
      | { date: string; counters: Record<string, { primary: number; miss: number }> }
      | undefined;
    expect(raw).toBeTruthy();
    expect(raw!.counters['twitter.post-text'].primary).toBe(2);
    expect(raw!.counters['tiktok.comment-list'].miss).toBe(1);
  });

  it('flushNow clears in-memory counters so subsequent flushes do not double-count', async () => {
    recordSelectorHit('twitter.post-text', 0);
    await flushNow();
    // Between flushes, counter resets and next flush only adds NEW activity.
    expect(_peekSelectorHealthForTesting()['twitter.post-text']).toBeUndefined();
    recordSelectorHit('twitter.post-text', 0);
    await flushNow();
    const raw = (await chrome.storage.local.get(['fw_selector_health']))['fw_selector_health'] as
      | { counters: Record<string, { primary: number }> }
      | undefined;
    expect(raw!.counters['twitter.post-text'].primary).toBe(2); // 1 + 1 accumulated across flushes
  });

  it('flushNow is a no-op when no counters have been recorded', async () => {
    await flushNow();
    const raw = (await chrome.storage.local.get(['fw_selector_health']))['fw_selector_health'];
    expect(raw).toBeUndefined();
  });

  it('flushNow survives missing chrome.storage gracefully', async () => {
    clearChromeStub();
    recordSelectorHit('twitter.post-text', 0);
    // Must not throw.
    await expect(flushNow()).resolves.toBeUndefined();
  });
});

describe('selector-health — readSelectorHealth', () => {
  it('returns empty shell when storage is empty', async () => {
    const snap = await readSelectorHealth();
    expect(snap.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(snap.counters).toEqual({});
  });

  it('returns the persisted snapshot when present for today', async () => {
    recordSelectorHit('twitter.post-text', 1);
    await flushNow();
    const snap = await readSelectorHealth();
    expect(snap.counters['twitter.post-text'].fallback1).toBe(1);
  });
});
