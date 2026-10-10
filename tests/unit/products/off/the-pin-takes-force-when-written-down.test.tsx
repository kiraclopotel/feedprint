/** @vitest-environment jsdom */
// M8 (L5). Off stored the new PIN the moment "Set PIN" was pressed and only then showed the recovery
// phrase. A person who closed the popup before pressing "I wrote it down" came back to a lock, with
// a phrase they never saw. The PIN and the phrase now take force together, only at "I wrote it down".
// Each "open" below loads the popup page afresh: closing the popup throws its React state away.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let state: Record<string, unknown> = {};
let sessionState: Record<string, unknown> = {};
// One write that fails: the next `set` whose keys satisfy this rejects, then storage works again.
let failNext: ((keys: Record<string, unknown>) => boolean) | null = null;

function installStorage(): void {
  state = {};
  sessionState = {};
  failNext = null;
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get: vi.fn(async (keys: string | string[] | null | undefined) => {
          const list = keys === null || keys === undefined ? Object.keys(state) : Array.isArray(keys) ? keys : [keys];
          const out: Record<string, unknown> = {};
          for (const k of list) if (k in state) out[k] = state[k];
          return out;
        }),
        set: vi.fn(async (obj: Record<string, unknown>) => {
          if (failNext && failNext(obj)) { failNext = null; throw new Error('disk full'); }
          Object.assign(state, obj);
        }),
        remove: vi.fn(async (k: string | string[]) => { for (const key of Array.isArray(k) ? k : [k]) delete state[key]; }),
      },
      session: {
        get: vi.fn(async (keys: string | string[] | null | undefined) => {
          const list = keys === null || keys === undefined ? Object.keys(sessionState) : Array.isArray(keys) ? keys : [keys];
          const out: Record<string, unknown> = {};
          for (const k of list) if (k in sessionState) out[k] = sessionState[k];
          return out;
        }),
        set: vi.fn(async (obj: Record<string, unknown>) => { Object.assign(sessionState, obj); }),
        remove: vi.fn(async (k: string | string[]) => { for (const key of Array.isArray(k) ? k : [k]) delete sessionState[key]; }),
      },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    runtime: { sendMessage: vi.fn(async () => undefined), getManifest: () => ({ version: '1.0.11' }) },
  };
}

async function settle(until: () => boolean, ms = 4000): Promise<void> {
  // The PIN and the phrase are hashed with PBKDF2, which takes real time in jsdom.
  for (let waited = 0; waited < ms && !until(); waited += 50) {
    await act(async () => { await new Promise(r => setTimeout(r, 50)); });
  }
}

/** Opens the popup page as a browser does: a new document, new modules, storage as it stands. */
async function openOff(): Promise<HTMLElement> {
  document.body.innerHTML = '';
  const mount = document.createElement('div');
  mount.id = 'root';
  document.body.appendChild(mount);
  vi.resetModules();
  const { _setProductForTesting } = await import('../../../../src/product');
  _setProductForTesting('off');
  await act(async () => { await import('../../../../src/products/off/popup/OffPopup'); });
  await settle(() => mount.querySelector('.pin-overlay, .off-fold') !== null);
  return mount;
}

const buttons = (m: HTMLElement): HTMLButtonElement[] => Array.from(m.querySelectorAll('button'));
const findButton = (m: HTMLElement, text: string): HTMLButtonElement | undefined => buttons(m).find(b => b.textContent?.trim() === text);
const phraseOf = (m: HTMLElement): string | null => m.querySelector('[data-testid="recovery-phrase"]')?.textContent?.trim() ?? null;

async function typeDigits(inputs: HTMLInputElement[], pin: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  for (let i = 0; i < pin.length && i < inputs.length; i++) {
    await act(async () => {
      setter.call(inputs[i], pin[i]);
      inputs[i].dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
}

/** From a popup with no PIN: Set PIN, type the PIN twice, save, wait for the phrase card. Returns the phrase. */
async function setPinToPhrase(m: HTMLElement, pin: string): Promise<string> {
  await act(async () => { findButton(m, 'Set PIN')!.click(); });
  const inputs = Array.from(m.querySelectorAll<HTMLInputElement>('.pin-box'));
  expect(inputs.length).toBe(8);
  await typeDigits(inputs.slice(0, 4), pin);
  await typeDigits(inputs.slice(4, 8), pin);
  await act(async () => { findButton(m, 'Set PIN')!.click(); });
  await settle(() => phraseOf(m) !== null);
  const phrase = phraseOf(m);
  expect(phrase, 'the phrase card is shown').not.toBeNull();
  return phrase!;
}

let errors: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  localStorage.clear();
  installStorage();
});
afterEach(() => {
  errors.mockRestore();
  document.body.innerHTML = '';
});

describe('Off: the PIN takes force when "I wrote it down" is pressed (M8)', () => {
  it('closing the popup with the phrase showing leaves no PIN, and the next open offers Set PIN again', { timeout: 60000 }, async () => {
    const first = await openOff();
    expect(first.querySelector('.pin-overlay'), 'no PIN yet, so no lock').toBeNull();
    const phrase1 = await setPinToPhrase(first, '2468');

    // Nothing is stored while the person has not said they kept the phrase.
    expect(state['parentPin'], 'no PIN in force yet').toBeUndefined();
    expect(state['fw_pin_recovery'], 'no phrase stored yet').toBeUndefined();

    const second = await openOff();
    expect(second.querySelector('.pin-overlay'), 'no lock on the next open').toBeNull();
    expect(second.querySelector('.off-fold'), 'the settings are open').not.toBeNull();
    expect(findButton(second, 'Set PIN'), 'Set PIN is offered again').toBeDefined();
    expect(findButton(second, 'Change PIN')).toBeUndefined();

    const phrase2 = await setPinToPhrase(second, '2468');
    expect(phrase2, 'a new phrase is made').not.toBe(phrase1);
  });

  it('after "I wrote it down" the PIN and the phrase are stored, and the next open is locked behind that PIN', { timeout: 60000 }, async () => {
    const first = await openOff();
    const phrase = await setPinToPhrase(first, '2468');
    await act(async () => { first.querySelector<HTMLInputElement>('[data-testid="recovery-kept"]')!.click(); });
    await act(async () => { first.querySelector<HTMLButtonElement>('[data-testid="recovery-continue"]')!.click(); });
    await settle(() => state['fw_pin_recovery'] !== undefined && phraseOf(first) === null);

    expect(state['parentPin'], 'the PIN is stored').toBeDefined();
    expect(state['fw_pin_recovery'], 'the phrase is stored').toBeDefined();
    expect(phraseOf(first), 'the card is gone').toBeNull();
    expect(first.textContent).not.toContain(phrase);

    sessionState = {}; // no grace exists after setting a PIN (M11); cleared anyway so the lock is not in doubt
    const second = await openOff();
    expect(second.querySelector('.pin-overlay'), 'the lock shows').not.toBeNull();
    const boxes = Array.from(second.querySelectorAll<HTMLInputElement>('input.pin-box'));
    await typeDigits(boxes, '2468');
    await settle(() => second.querySelector('.off-fold') !== null);
    expect(second.querySelector('.off-fold'), 'the right PIN opens the settings').not.toBeNull();
    expect(findButton(second, 'Change PIN'), 'the row is Change PIN now').toBeDefined();

    // The phrase shown is the phrase stored: it resets the PIN.
    const { resetPinWithRecoveryPhrase, verifyPin } = await import('../../../../src/storage/settings');
    expect(await resetPinWithRecoveryPhrase(phrase, '1357')).toBe(true);
    expect(await verifyPin('1357')).toBe(true);
  });

  // M11 (was B2 unit 1): setting the first PIN is not an entry of it, so the very next open asks; only a typed
  // right PIN starts the 15-minute grace, and the open after that is not locked.
  it('after "I wrote it down" the next open asks, and after the PIN is typed the open after that does not', { timeout: 60000 }, async () => {
    const first = await openOff();
    await setPinToPhrase(first, '2468');
    expect(sessionState, 'no grace before the PIN is in force').toEqual({});
    await act(async () => { first.querySelector<HTMLInputElement>('[data-testid="recovery-kept"]')!.click(); });
    await act(async () => { first.querySelector<HTMLButtonElement>('[data-testid="recovery-continue"]')!.click(); });
    await settle(() => phraseOf(first) === null && state['parentPin'] !== undefined);

    expect(Object.keys(sessionState).length, 'setting a PIN marks nothing').toBe(0);
    const second = await openOff();
    expect(second.querySelector('.pin-overlay'), 'the lock asks at the next open').not.toBeNull();
    const boxes = Array.from(second.querySelectorAll<HTMLInputElement>('input.pin-box'));
    await typeDigits(boxes, '2468');
    await settle(() => second.querySelector('.off-fold') !== null);
    expect(second.querySelector('.off-fold'), 'the right PIN opens the settings').not.toBeNull();
    expect(Object.keys(sessionState).length, 'a typed right PIN marks the grace').toBeGreaterThan(0);

    const third = await openOff();
    expect(third.querySelector('.pin-overlay'), 'no lock within the grace after a typed PIN').toBeNull();
    expect(third.querySelector('.off-fold'), 'the settings are open').not.toBeNull();
    expect(findButton(third, 'Change PIN'), 'the row is Change PIN').toBeDefined();
  });

  it('a PIN that appears in another window while the phrase shows is not overwritten at "I wrote it down"', { timeout: 60000 }, async () => {
    const first = await openOff();
    await setPinToPhrase(first, '2468');

    const { setPin, setRecoveryPhrase } = await import('../../../../src/storage/settings');
    await setPin('1234');
    await setRecoveryPhrase('ABCD-EFGH');
    const storedPin = state['parentPin'];
    const storedPhrase = state['fw_pin_recovery'];

    await act(async () => { first.querySelector<HTMLInputElement>('[data-testid="recovery-kept"]')!.click(); });
    await act(async () => { first.querySelector<HTMLButtonElement>('[data-testid="recovery-continue"]')!.click(); });
    await settle(() => (first.textContent ?? '').includes('A PIN is set.'));

    expect(state['parentPin'], 'the other window\'s PIN stands').toBe(storedPin);
    expect(state['fw_pin_recovery'], 'the other window\'s phrase stands').toBe(storedPhrase);
    // HOLD 05:08 (b): no silent close. The person is told a PIN is set, and the card is still there.
    expect(first.textContent).toContain('A PIN is set. Off asks for it each time it opens, except for 15 minutes after you type it.');
    expect(phraseOf(first), 'the card stays until the person leaves it').not.toBeNull();
  });

  // HOLD 05:08 (a). The two writes are separate. If the phrase write fails, no PIN may be left in force,
  // and the second press must store both, not close over a half-stored PIN.
  it('a failed phrase write leaves no PIN, and the second press stores both', { timeout: 60000 }, async () => {
    const first = await openOff();
    const phrase = await setPinToPhrase(first, '2468');

    failNext = (keys) => 'fw_pin_recovery' in keys;
    await act(async () => { first.querySelector<HTMLInputElement>('[data-testid="recovery-kept"]')!.click(); });
    await act(async () => { first.querySelector<HTMLButtonElement>('[data-testid="recovery-continue"]')!.click(); });
    await settle(() => (first.textContent ?? '').includes('disk full'));

    expect(first.textContent, 'the error is shown').toContain('disk full');
    expect(state['parentPin'], 'no PIN is in force without its phrase').toBeUndefined();
    expect(phraseOf(first), 'the card stays').toBe(phrase);

    // The tick stays on after the failed write; the second press is Continue alone.
    await act(async () => { first.querySelector<HTMLButtonElement>('[data-testid="recovery-continue"]')!.click(); });
    await settle(() => phraseOf(first) === null && state['parentPin'] !== undefined);

    expect(state['parentPin'], 'the PIN is stored').toBeDefined();
    expect(state['fw_pin_recovery'], 'the phrase is stored').toBeDefined();
    expect(phraseOf(first), 'the card is gone').toBeNull();
    const { resetPinWithRecoveryPhrase } = await import('../../../../src/storage/settings');
    expect(await resetPinWithRecoveryPhrase(phrase, '1357'), 'the phrase shown is the phrase stored').toBe(true);
  });

  // The phrase goes first, so a failed PIN write leaves a phrase with no PIN, which locks nothing; the next
  // Set PIN makes a new phrase that replaces it.
  it('a failed PIN write after the phrase write leaves no lock, and the next Set PIN makes a new phrase that replaces the old one', { timeout: 60000 }, async () => {
    const first = await openOff();
    const phrase1 = await setPinToPhrase(first, '2468');

    failNext = (keys) => 'parentPin' in keys;
    await act(async () => { first.querySelector<HTMLInputElement>('[data-testid="recovery-kept"]')!.click(); });
    await act(async () => { first.querySelector<HTMLButtonElement>('[data-testid="recovery-continue"]')!.click(); });
    await settle(() => (first.textContent ?? '').includes('disk full'));
    expect(state['parentPin'], 'the PIN write failed').toBeUndefined();

    const second = await openOff();
    expect(second.querySelector('.pin-overlay'), 'no lock on the next open').toBeNull();
    expect(findButton(second, 'Set PIN'), 'Set PIN is offered again').toBeDefined();

    const phrase2 = await setPinToPhrase(second, '2468');
    expect(phrase2, 'a new phrase is made').not.toBe(phrase1);
    await act(async () => { second.querySelector<HTMLInputElement>('[data-testid="recovery-kept"]')!.click(); });
    await act(async () => { second.querySelector<HTMLButtonElement>('[data-testid="recovery-continue"]')!.click(); });
    await settle(() => phraseOf(second) === null && state['parentPin'] !== undefined);

    const { resetPinWithRecoveryPhrase } = await import('../../../../src/storage/settings');
    expect(await resetPinWithRecoveryPhrase(phrase1, '9999'), 'the old phrase no longer works').toBe(false);
    expect(await resetPinWithRecoveryPhrase(phrase2, '1357'), 'the new phrase works').toBe(true);
  });
});
