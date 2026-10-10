// @vitest-environment jsdom
// R1 (quality loop, 29 Sep 2026): after "Add to Chrome" nothing opened. Setup lives only in the toolbar popup, and
// Chrome puts a new extension under the puzzle-piece menu, so a stranger who never found it never started setup and
// recorded nothing. A fresh install now opens the popup page in a tab, once; an update or a Chrome update does not.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from '../../helpers/repo-root';
import { CURRENT_SETTINGS_SCHEMA_VERSION, utcDayKey, utcMonthKey } from '../../../src/storage/settings';

// Loaded fresh for every test: the settings read keeps a snapshot, and each test starts from its own storage.
let openSetupOnInstall: (reason: string) => void;

const create = vi.fn();

// A fresh install: nothing stored but the schema markers. M6 (B2 unit 0) reads the stored setup state before
// opening, so the chrome stub now carries a storage area. 'down' makes every read fail.
let stored: Record<string, unknown> = {};
let down = false;

beforeEach(async () => {
  vi.resetModules();
  ({ openSetupOnInstall } = await import('../../../src/background/open-setup-on-install'));
  create.mockReset();
  create.mockResolvedValue({ id: 1 });
  down = false;
  stored = { settingsSchemaVersion: CURRENT_SETTINGS_SCHEMA_VERSION, lastResetDate: utcDayKey(), lastResetMonth: utcMonthKey() };
  (globalThis as unknown as { chrome: unknown }).chrome = {
    tabs: { create },
    runtime: { getURL: (p: string) => `chrome-extension://abc/${p}` },
    storage: {
      local: {
        get: async (keys: string | string[] | null | undefined) => {
          if (down) throw new Error('IO error: storage busy');
          if (keys === null || keys === undefined) return { ...stored };
          const out: Record<string, unknown> = {};
          for (const k of Array.isArray(keys) ? keys : [keys]) if (k in stored) out[k] = stored[k];
          return out;
        },
        set: async (obj: Record<string, unknown>) => { Object.assign(stored, obj); },
        remove: async () => undefined,
      },
      session: { get: async () => ({}), set: async () => undefined, remove: async () => undefined },
      onChanged: { addListener: () => {}, removeListener: () => {} },
    },
  };
});

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('a fresh install opens the setup', () => {
  it('opens the popup page in a tab, in its detached layout', async () => {
    openSetupOnInstall('install');
    await flush();
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0]).toEqual({ url: 'chrome-extension://abc/popup.html?detached=1' });
  });

  it.each(['update', 'chrome_update', 'shared_module_update'])('%s opens nothing', async (reason) => {
    openSetupOnInstall(reason);
    await flush();
    expect(create).not.toHaveBeenCalled();
  });

  it('a refused tab is logged, never thrown into the install listener', async () => {
    create.mockRejectedValue(new Error('no window'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => openSetupOnInstall('install')).not.toThrow();
    await flush();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

// M6 (B2 unit 0, 30 Sep 2026): in a test browser that loads the extension from a folder, the install reason came
// again at every start and the setup tab opened each time, after setup was finished. It now opens only while
// setup is unfinished (the popup's own rule: setupDone, a stored PIN, or a read that cannot say).
describe('the setup tab opens only while setup is unfinished', () => {
  it("reason 'install' with setup already finished opens no tab", async () => {
    stored['setupDone'] = true;
    openSetupOnInstall('install');
    await flush();
    await flush();
    expect(create).not.toHaveBeenCalled();
  });

  it("reason 'install' with a PIN stored opens no tab (setup was done, whatever the flag says)", async () => {
    stored['parentPin'] = 'pbkdf2$1$00$00';
    openSetupOnInstall('install');
    await flush();
    await flush();
    expect(create).not.toHaveBeenCalled();
  });

  it("reason 'install' on a fresh store opens one tab", async () => {
    openSetupOnInstall('install');
    await flush();
    await flush();
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('a storage read that fails opens nothing and throws nothing', async () => {
    down = true;
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => openSetupOnInstall('install')).not.toThrow();
    await flush();
    await new Promise((r) => setTimeout(r, 300));
    expect(create).not.toHaveBeenCalled();
    err.mockRestore();
    warn.mockRestore();
  });

  it('stays install-only: an update opens nothing even on a fresh store', async () => {
    openSetupOnInstall('update');
    await flush();
    await flush();
    expect(create).not.toHaveBeenCalled();
  });
});

describe('the install listener calls it', () => {
  it('with the install reason', () => {
    const src = readFileSync(join(REPO_ROOT, 'src/background/service-worker.ts'), 'utf8');
    const listener = src.match(/chrome\.runtime\.onInstalled\.addListener[\s\S]*?\n\}\);/)?.[0] ?? '';
    expect(listener, 'the listener was found').not.toBe('');
    expect(listener).toContain('openSetupOnInstall(details.reason)');
  });
});