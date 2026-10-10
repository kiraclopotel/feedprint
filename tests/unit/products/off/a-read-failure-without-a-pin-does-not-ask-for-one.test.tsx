/** @vitest-environment jsdom */
// When Off's storage fails to read, the popup could not tell whether a PIN exists and always
// asked for one. A person who never set a PIN had nothing to type, so the popup was shut to them
// until the read came back. Now a read failure with no sign of a PIN says plainly that the
// settings could not be read and offers a retry. A PIN that is known to exist keeps the lock: the
// settings body is never shown on either path.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { readSource } from '../../../helpers/read-source';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// 'down': every read rejects. 'settings-down': the wide settings read rejects but a read of
// just the two PIN fields works, the way a blip or a bad value in some other field would look.
// 'up': everything reads.
type Mode = 'down' | 'settings-down' | 'up';
let mode: Mode = 'down';
let state: Record<string, unknown> = {};

function installStorage(initial: Record<string, unknown>, start: Mode): void {
  mode = start;
  state = { ...initial };
  const get = vi.fn(async (keys: string | string[] | null | undefined) => {
    const list = keys === null || keys === undefined ? Object.keys(state) : Array.isArray(keys) ? keys : [keys];
    if (mode === 'down') throw new Error('IO error: storage busy');
    if (mode === 'settings-down' && list.length > 2) throw new Error('IO error: storage busy');
    const out: Record<string, unknown> = {};
    for (const k of list) if (k in state) out[k] = state[k];
    return out;
  });
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get,
        set: vi.fn(async (obj: Record<string, unknown>) => { Object.assign(state, obj); }),
        remove: vi.fn(async () => undefined),
      },
      session: { get: vi.fn(async () => ({})), set: vi.fn(async () => undefined), remove: vi.fn(async () => undefined) },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    runtime: { sendMessage: vi.fn(async () => undefined), getManifest: () => ({ version: '1.0.11' }) },
  };
}

/** Long enough for the settings read to spend its retries. */
async function settle(ms = 500): Promise<void> {
  await act(async () => { await new Promise(r => setTimeout(r, ms)); });
}

async function openOff(): Promise<HTMLElement> {
  const mount = document.createElement('div');
  mount.id = 'root';
  document.body.appendChild(mount);
  vi.resetModules();
  const { _setProductForTesting } = await import('../../../../src/product');
  _setProductForTesting('off');
  await act(async () => { await import('../../../../src/products/off/popup/OffPopup'); });
  await settle();
  return mount;
}

function retryButton(mount: HTMLElement): HTMLButtonElement | undefined {
  return Array.from(mount.querySelectorAll('button')).find(b => b.textContent?.trim() === 'Retry');
}

const PIN_HASH = 'pbkdf2$1$00$00';

let errors: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  localStorage.clear();
});
afterEach(() => {
  errors.mockRestore();
  document.body.innerHTML = '';
});

describe('Off: a read failure with no PIN does not ask for one', () => {
  it('says the settings could not be read and offers a retry, with no PIN prompt and no settings', async () => {
    installStorage({}, 'down');
    const mount = await openOff();

    expect(mount.querySelector('.pin-overlay'), 'a person with no PIN has nothing to type').toBeNull();
    expect(mount.textContent).toContain('Off could not read its local settings');
    expect(retryButton(mount), 'a way to try again').toBeDefined();
    expect(mount.querySelector('.off-fold'), 'the settings are not shown either').toBeNull();
  });

  it('a retry that reads opens the popup for someone with no PIN', async () => {
    installStorage({}, 'down');
    const mount = await openOff();
    mode = 'up';

    await act(async () => { retryButton(mount)!.click(); });
    await settle(100);

    expect(mount.textContent).not.toContain('could not read');
    expect(mount.querySelector('.pin-overlay')).toBeNull();
    expect(mount.querySelector('.off-fold'), 'the settings are there').not.toBeNull();
  });

  it('a read that fails but can still see there is no PIN says the same, not a PIN prompt', async () => {
    installStorage({}, 'settings-down');
    const mount = await openOff();

    expect(mount.querySelector('.pin-overlay')).toBeNull();
    expect(mount.textContent).toContain('Off could not read its local settings');
    expect(retryButton(mount)).toBeDefined();
  });
});

describe('Off: a PIN that is known to exist keeps the lock when the read fails', () => {
  it('a stored PIN, seen by the narrow read, asks for the PIN and shows no settings', async () => {
    installStorage({ parentPin: PIN_HASH }, 'settings-down');
    const mount = await openOff();

    expect(mount.querySelector('.pin-overlay')).not.toBeNull();
    expect(mount.querySelector('.off-fold'), 'no settings behind the lock').toBeNull();
  });

  it('a stored recovery phrase alone is also a sign a PIN was set', async () => {
    installStorage({ fw_pin_recovery: PIN_HASH }, 'settings-down');
    const mount = await openOff();

    expect(mount.querySelector('.pin-overlay')).not.toBeNull();
    expect(mount.querySelector('.off-fold')).toBeNull();
  });
});

// Every read failing hides the stored PIN from storage itself, so the popup keeps its own note that
// a PIN was set (in the popup page's local storage, which is not the store that failed).
describe('Off: a PIN that was set keeps the lock even when every read fails', () => {
  it('every read failing, after a PIN was set here, still asks for the PIN', { timeout: 20000 }, async () => {
    installStorage({}, 'up');
    const { setPin } = await import('../../../../src/storage/settings');
    await setPin('1234');
    mode = 'down';

    const mount = await openOff();

    expect(mount.querySelector('.pin-overlay')).not.toBeNull();
    expect(mount.querySelector('.off-fold'), 'no settings behind the lock').toBeNull();
  });

  it('an install whose PIN predates the note gets the note the next time the popup reads it', { timeout: 20000 }, async () => {
    installStorage({ parentPin: PIN_HASH }, 'up');
    const first = await openOff();
    expect(first.querySelector('.pin-overlay'), 'a stored PIN locks the open popup').not.toBeNull();
    document.body.innerHTML = '';
    mode = 'down';

    const mount = await openOff();

    expect(mount.querySelector('.pin-overlay')).not.toBeNull();
  });

  it('a retry that finds a PIN keeps the lock', async () => {
    installStorage({ parentPin: PIN_HASH }, 'down');
    const mount = await openOff();
    expect(mount.querySelector('.pin-overlay'), 'nothing shows a PIN yet').toBeNull();
    mode = 'settings-down';

    await act(async () => { retryButton(mount)!.click(); });
    await settle(800);

    expect(mount.querySelector('.pin-overlay')).not.toBeNull();
    expect(mount.querySelector('.off-fold')).toBeNull();
  });

  it('every retry starts from undecided, so an earlier answer never carries over', () => {
    const src = readSource('src/products/off/popup/OffPopup.tsx');
    const start = src.indexOf('const start = useCallback');
    expect(start).toBeGreaterThan(0);
    const beforeRead = src.slice(start, src.indexOf('await getSettings()', start));
    expect(beforeRead).toContain('setLocked(null);');
  });
});
