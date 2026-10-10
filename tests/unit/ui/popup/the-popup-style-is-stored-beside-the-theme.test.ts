// @vitest-environment jsdom
// The popup's style is a setting beside the theme: saved with the other settings, read back on the next opening, and
// absent on every install stored before the choice existed, which therefore opens on A. A value this build does not
// know opens on A too. The page carries the style as one attribute, and a mirror lets the next opening apply it before
// chrome.storage answers.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function installChromeShim(store: Map<string, unknown>): void {
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get: vi.fn(async (keys?: string | string[] | null) => {
          const out: Record<string, unknown> = {};
          const names = keys == null ? [...store.keys()] : Array.isArray(keys) ? keys : [keys];
          for (const k of names) if (store.has(k)) out[k] = store.get(k);
          return out;
        }),
        set: vi.fn(async (items: Record<string, unknown>) => {
          for (const [k, v] of Object.entries(items)) store.set(k, v);
        }),
        remove: vi.fn(async () => undefined),
      },
      onChanged: { addListener: vi.fn() },
    },
    runtime: { sendMessage: vi.fn(async () => undefined), onMessage: { addListener: vi.fn() } },
  };
}

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  delete document.documentElement.dataset.look;
});
afterEach(() => {
  delete (globalThis as unknown as { chrome?: unknown }).chrome;
});

describe('the popup style is stored beside the theme', () => {
  it('a chosen style survives save and a fresh read', async () => {
    const store = new Map<string, unknown>();
    installChromeShim(store);
    const first = await import('../../../../src/storage/settings');
    await first.saveSettings({ popupLook: 'c' });
    vi.resetModules();
    installChromeShim(store);
    const second = await import('../../../../src/storage/settings');
    expect((await second.getSettings()).popupLook).toBe('c');
  });

  it('an install stored before the choice existed opens on A, its theme untouched', async () => {
    const store = new Map<string, unknown>([['settingsSchemaVersion', '14'], ['dashboardTheme', 'light'], ['mode', 'adult']]);
    installChromeShim(store);
    const { getSettings } = await import('../../../../src/storage/settings');
    const s = await getSettings();
    expect(s.popupLook).toBe('a');
    expect(s.dashboardTheme).toBe('light');
  });

  it('A sets no attribute; B and C set theirs; an unknown value opens on A', async () => {
    const { applyLook, readAppliedLook } = await import('../../../../src/ui/shared/looks');
    applyLook('b');
    expect(document.documentElement.dataset.look).toBe('b');
    applyLook('a');
    expect(document.documentElement.dataset.look).toBeUndefined();
    applyLook('c');
    expect(readAppliedLook()).toBe('c');
    applyLook('z');
    expect(document.documentElement.dataset.look).toBeUndefined();
    expect(readAppliedLook()).toBe('a');
  });

  it('the next opening applies the mirrored style before storage answers, then the stored one', async () => {
    const store = new Map<string, unknown>([['popupLook', 'c']]);
    installChromeShim(store);
    const looks = await import('../../../../src/ui/shared/looks');
    looks.applyLook('b');
    delete document.documentElement.dataset.look;
    looks.eagerApplyStoredLook();
    expect(document.documentElement.dataset.look).toBe('b');
    await vi.waitFor(() => expect(document.documentElement.dataset.look).toBe('c'));
    expect(looks.readLookMirror()).toBe('c');
  });

  it('a look chosen in the other page is applied in this one while it is open', async () => {
    installChromeShim(new Map());
    const looks = await import('../../../../src/ui/shared/looks');
    looks.followStoredLook();
    const listen = (globalThis as unknown as { chrome: { storage: { onChanged: { addListener: ReturnType<typeof vi.fn> } } } })
      .chrome.storage.onChanged.addListener;
    const changed = listen.mock.calls[0][0] as (changes: Record<string, { newValue: unknown }>, area: string) => void;
    changed({ popupLook: { newValue: 'e' } }, 'local');
    expect(document.documentElement.dataset.look).toBe('e');
    changed({ popupLook: { newValue: 'a' } }, 'local');
    expect(document.documentElement.dataset.look).toBeUndefined();
  });
});
