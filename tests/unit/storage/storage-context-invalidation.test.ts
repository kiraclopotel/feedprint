// Orphaned-content-script hygiene — getLicense / getSettings read chrome.storage
// directly, bypassing the messaging context-guard. After an extension reload the
// orphaned content script keeps calling them and every read throws "Extension
// context invalidated"; before the fix each call logged + fell back, flooding the
// extension error log with hundreds of identical lines (found 2026-06-20) and
// thrashing the FREE-tier fallback. The fix routes both through context-guard so
// the FIRST context error flips a shared flag and every later read short-circuits
// silently — and a tab refresh (fresh module graph) resumes normally.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const CONTEXT_ERR = () => new Error('Extension context invalidated');

describe('storage reads go dormant on "Extension context invalidated"', () => {
  beforeEach(() => {
    vi.resetModules(); // fresh context-guard flag per test == a refreshed tab
  });

  it('getLicense: returns FREE, does NOT console.warn, and the next call skips storage', async () => {
    const get = vi.fn().mockRejectedValue(CONTEXT_ERR());
    (globalThis as unknown as { chrome: unknown }).chrome = { storage: { local: { get } } };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});

    const { getLicense } = await import('../../../src/storage/license');

    expect((await getLicense()).tier).toBe('free');
    expect(get).toHaveBeenCalledTimes(1); // first call probed storage
    expect(warn).not.toHaveBeenCalled(); // context error is the graceful path, not a warn
    expect(info).toHaveBeenCalledTimes(1); // ONE refresh-hint line for the whole flood

    expect((await getLicense()).tier).toBe('free');
    expect(get).toHaveBeenCalledTimes(1); // second call short-circuited — no flood

    warn.mockRestore();
    info.mockRestore();
  });

  it('getSettings: fails closed to Child WITHOUT console.error, then short-circuits', async () => {
    const get = vi.fn().mockRejectedValue(CONTEXT_ERR());
    (globalThis as unknown as { chrome: unknown }).chrome = {
      storage: { local: { get, set: vi.fn().mockResolvedValue(undefined) } },
    };
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});

    const { getSettings } = await import('../../../src/storage/settings');

    expect((await getSettings()).mode).toBe('child'); // strongest protection
    expect(error).not.toHaveBeenCalled(); // graceful path, not the unexpected-read-error log
    expect(get).toHaveBeenCalledTimes(1);

    expect((await getSettings()).mode).toBe('child');
    expect(get).toHaveBeenCalledTimes(1); // short-circuited

    error.mockRestore();
  });

  it('the dead-context flag is SHARED: a getLicense context error makes getSettings skip storage too', async () => {
    const get = vi.fn().mockRejectedValue(CONTEXT_ERR());
    (globalThis as unknown as { chrome: unknown }).chrome = {
      storage: { local: { get, set: vi.fn().mockResolvedValue(undefined) } },
    };
    vi.spyOn(console, 'info').mockImplementation(() => {});

    const { getLicense } = await import('../../../src/storage/license');
    const { getSettings } = await import('../../../src/storage/settings');

    await getLicense(); // flips the shared flag
    expect(get).toHaveBeenCalledTimes(1);

    await getSettings(); // sees the dead context and never touches storage
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('a NON-context storage error still surfaces (warn) and fails closed — behavior unchanged', async () => {
    const get = vi.fn().mockRejectedValue(new Error('QuotaExceeded'));
    (globalThis as unknown as { chrome: unknown }).chrome = { storage: { local: { get } } };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { getLicense } = await import('../../../src/storage/license');

    expect((await getLicense()).tier).toBe('free');
    expect(warn).toHaveBeenCalledTimes(1); // a real read failure is NOT suppressed

    warn.mockRestore();
  });
});
