/** @vitest-environment jsdom */
// When the settings read fails, getSettings returns a fail-closed snapshot with
// setupDone false and parentPin empty. The popup took that for an install that
// was never set up and opened the setup wizard, whose last step overwrites the
// parent's mode, features and PIN. The Keys tab took the same empty PIN for "no
// PIN" and removed the licence key without asking for one.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const licenseMocks = vi.hoisted(() => ({
  clearLicense: vi.fn(async () => undefined),
}));

vi.mock('../../../../src/storage/license', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/storage/license')>();
  return { ...actual, clearLicense: licenseMocks.clearLicense };
});
vi.mock('../../../../src/ai/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/ai/client')>();
  return { ...actual, probeProxy: vi.fn(async () => 'ok') };
});

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Every storage read rejects, the way a blip that outlasts the read's retry does. */
function installFailingStorage(): void {
  const failing = {
    get: vi.fn(async () => { throw new Error('IO error: storage busy'); }),
    set: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
  };
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: failing,
      session: failing,
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    runtime: {
      sendMessage: vi.fn(async () => undefined),
      getManifest: () => ({ version: '2.5.6' }),
      getURL: (p: string) => `chrome-extension://x/${p}`,
    },
  };
}

/** Long enough for the settings and licence reads to exhaust their retries. */
async function settle(ms = 400): Promise<void> {
  await act(async () => { await new Promise((r) => setTimeout(r, ms)); });
}

async function click(host: HTMLElement, button: HTMLButtonElement | undefined, name: string): Promise<void> {
  if (!button || !host.contains(button)) throw new Error(`no button "${name}"`);
  await act(async () => { button.click(); });
}

function buttonByText(host: HTMLElement, text: string): HTMLButtonElement | undefined {
  return Array.from(host.querySelectorAll('button')).find(b => b.textContent?.trim() === text);
}

let errors: ReturnType<typeof vi.spyOn>;
let warns: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  warns = vi.spyOn(console, 'warn').mockImplementation(() => {});
  licenseMocks.clearLicense.mockClear();
  installFailingStorage();
});
afterEach(() => {
  errors.mockRestore();
  warns.mockRestore();
  document.body.innerHTML = '';
});

describe('a settings read that failed keeps the parent side locked', () => {
  it('the popup opens on the main screen, not the setup wizard, and Settings asks for the PIN', async () => {
    const mount = document.createElement('div');
    mount.id = 'root';
    document.body.appendChild(mount);

    vi.resetModules();
    await act(async () => { await import('../../../../src/ui/popup/Popup'); });
    await settle();

    expect(mount.querySelector('.setup-step'), 'the wizard would overwrite mode, features and PIN').toBeNull();
    expect(mount.querySelector('#pop-tab-home'), 'the main screen is shown').not.toBeNull();

    await click(mount, mount.querySelector<HTMLButtonElement>('button[aria-label="Settings"]') ?? undefined, 'Settings');
    expect(mount.querySelector('.pin-overlay'), 'Settings stays behind the PIN').not.toBeNull();
  });

  it('the Keys tab asks for the PIN before removing the licence', async () => {
    const { KeysTab } = await import('../../../../src/ui/popup/Popup');
    const { I18nProvider } = await import('../../../../src/i18n/react');
    const { getSettings } = await import('../../../../src/storage/settings');
    const settings = await getSettings();
    expect(settings.readFailedFallback, 'this is the fail-closed snapshot').toBe(true);
    expect(settings.parentPin, 'which carries no PIN, whether or not one exists').toBe('');

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root: Root = createRoot(host);
    await act(async () => {
      root.render(createElement(I18nProvider, {
        lang: 'en',
        children: createElement(KeysTab, {
          settings,
          license: { tier: 'starter', secret: 'abc123def456' },
          probeResult: 'ok',
          onChange: async () => {},
        }),
      }));
    });

    await click(host, buttonByText(host, 'Remove license'), 'Remove license');
    await click(host, buttonByText(host, 'Remove'), 'Remove');
    await settle(20);

    expect(host.querySelector('.pin-overlay'), 'the PIN is asked for').not.toBeNull();
    expect(licenseMocks.clearLicense).not.toHaveBeenCalled();
    await act(async () => { root.unmount(); });
  });
});
