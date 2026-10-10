/** @vitest-environment jsdom */
// Owner's screen, 2026-10-08 20:0x: Off 1.0.13 unpacked, reloaded under an
// open YouTube tab, logged three "getSettings read failed, failing closed:
// TypeError: Cannot read properties of undefined (reading 'local')" and
// painted the red Errors badge. The orphaned script's chrome.storage was
// undefined, so the read threw a TypeError, not "Extension context
// invalidated", and the guard missed it. That case is the quiet shutdown too;
// a TypeError while storage is still there stays a real error.

import { afterEach, describe, expect, it, vi } from 'vitest';

const saved = (globalThis as { chrome?: unknown }).chrome;
afterEach(() => {
  (globalThis as { chrome?: unknown }).chrome = saved;
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('a reload that takes chrome.storage away', () => {
  it('a TypeError while chrome.storage is gone is a context error', async () => {
    (globalThis as { chrome?: unknown }).chrome = { runtime: {} };
    const { isContextError } = await import('../../../src/storage/context-guard');
    expect(isContextError(new TypeError("Cannot read properties of undefined (reading 'local')"))).toBe(true);
  });

  it('a TypeError while chrome.storage is there is not', async () => {
    (globalThis as { chrome?: unknown }).chrome = { storage: { local: {} } };
    const { isContextError } = await import('../../../src/storage/context-guard');
    expect(isContextError(new TypeError("Cannot read properties of undefined (reading 'x')"))).toBe(false);
  });

  it('any other TypeError while chrome.storage is gone stays a real error', async () => {
    (globalThis as { chrome?: unknown }).chrome = { runtime: {} };
    const { isContextError } = await import('../../../src/storage/context-guard');
    expect(isContextError(new TypeError('foo is not a function'))).toBe(false);
  });

  it('getSettings fails closed without an error line when chrome.storage is gone', async () => {
    (globalThis as { chrome?: unknown }).chrome = { runtime: {} };
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const { getSettings } = await import('../../../src/storage/settings');
    const s = await getSettings();
    expect(s.readFailedFallback).toBe(true);
    expect(s.mode).toBe('child');
    expect(errors).not.toHaveBeenCalled();
  });
});
