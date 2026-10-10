/** @vitest-environment jsdom */
// RS3 (board/units/RS3.md; RS2's finding, out/maker/RS2-REPORT.md). PinOverlay's own comment says it gives the focus back to whatever had
// it before it opened (the Settings gear, the "Change PIN" link), whichever way it closes. It did not: it recorded the element in an effect
// of its own, but PinDigits, its child, takes the focus on the first digit box in an earlier effect, so the overlay remembered its own box,
// and on close the focus went to an element that was gone (the page body). A person on a keyboard started again from the top of the popup
// instead of the control they pressed. The overlay now records the focus before its child takes it.
//
// The first group mounts the PIN screen alone after a button had the focus and closes it three ways (Cancel, Escape, a right PIN); the
// second drives the real popup: the Settings gear with a PIN set, then Escape.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { installChromeStorageStub } from '../../../helpers/chrome-storage';
import { utcDayKey, utcMonthKey, CURRENT_SETTINGS_SCHEMA_VERSION } from '../../../../src/storage/settings';
import { POPUP_STRINGS } from '../../../../src/i18n/popup-strings';
import { I18nProvider } from '../../../../src/i18n/react';
import { PinOverlay } from '../../../../src/ui/popup/controls';

const pins = vi.hoisted(() => ({ right: '1234' }));

// The PIN's own hashing and throttle have their tests; here only the screen's focus is under test.
vi.mock('../../../../src/storage/settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/storage/settings')>();
  return {
    ...actual,
    verifyPin: vi.fn(async (pin: string) => pin === pins.right),
    pinLockRemainingMs: vi.fn(async () => 0),
    isPinGraceActive: vi.fn(async () => false),
  };
});

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const t = POPUP_STRINGS.en;
const STORED_PIN = 'a'.repeat(64);

function keydown(key: string): void {
  const target = (document.activeElement ?? document.body) as HTMLElement;
  act(() => { target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })); });
}

async function settle(ms = 20): Promise<void> {
  await act(async () => { await new Promise((r) => setTimeout(r, ms)); });
}

// ─── The PIN screen alone, mounted after a button had the focus ─────────────────────────────────────────────────────────

let root: Root | null = null;

function mountPin(): { before: HTMLElement; closed: { by: string | null } } {
  const closed: { by: string | null } = { by: null };
  document.body.innerHTML = '<button id="before">the control pressed</button><div id="slot"></div>';
  const before = document.getElementById('before')!;
  before.focus();
  root = createRoot(document.getElementById('slot')!);
  act(() => {
    root!.render(
      <I18nProvider lang="en">
        <PinOverlay onSuccess={() => { closed.by = 'success'; }} onCancel={() => { closed.by = 'cancel'; }} />
      </I18nProvider>,
    );
  });
  return { before, closed };
}

function unmountPin(): void {
  act(() => { root?.unmount(); });
  root = null;
}

const boxesOf = (): HTMLInputElement[] => Array.from(document.querySelectorAll<HTMLInputElement>('.pin-overlay input.pin-box'));
const setter = () => Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;

afterEach(() => {
  if (root) unmountPin();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('RS3: the PIN screen gives the focus back when it closes', () => {
  it('guard: the first focus is on the first digit box', () => {
    mountPin();
    expect(document.activeElement).toBe(boxesOf()[0]);
  });

  it('Cancel: the control that had the focus before has it again', () => {
    const { before, closed } = mountPin();
    const cancel = Array.from(document.querySelectorAll<HTMLButtonElement>('.pin-overlay button')).find((b) => b.textContent === t.cancel)!;
    act(() => { cancel.click(); });
    expect(closed.by, 'Cancel closed the screen').toBe('cancel');
    unmountPin();
    expect(document.activeElement, 'the control pressed has the focus again').toBe(before);
  });

  it('Escape: the control that had the focus before has it again', () => {
    const { before, closed } = mountPin();
    keydown('Escape');
    expect(closed.by, 'Escape closed the screen').toBe('cancel');
    unmountPin();
    expect(document.activeElement, 'the control pressed has the focus again').toBe(before);
  });

  it('a right PIN: the control that had the focus before has it again', async () => {
    const { before, closed } = mountPin();
    for (const [i, d] of ['1', '2', '3', '4'].entries()) {
      const el = document.activeElement as HTMLInputElement;
      expect(el, `digit ${i + 1} goes into a box`).toBe(boxesOf()[i]);
      await act(async () => { setter().call(el, d); el.dispatchEvent(new Event('input', { bubbles: true })); });
    }
    await settle();
    expect(closed.by, 'the right PIN was accepted').toBe('success');
    unmountPin();
    expect(document.activeElement, 'the control pressed has the focus again').toBe(before);
  });
});

// ─── The real popup: the Settings gear with a PIN set, then Escape ──────────────────────────────────────────────────────

describe('RS3 in the real popup', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('Settings asks for the PIN; Escape closes it and the gear has the focus again', async () => {
    installChromeStorageStub({
      initial: {
        settingsSchemaVersion: CURRENT_SETTINGS_SCHEMA_VERSION, lastResetDate: utcDayKey(), lastResetMonth: utcMonthKey(),
        fw_license_key: 'fw-starter-abc12345', dailyCap: 2500, totalChecksToday: 0, totalTokensThisMonth: 100,
        setupDone: true, mode: 'teen', levelChosen: true, aiAnalysisEnabled: false, parentPin: STORED_PIN,
      },
      sendMessage: () => undefined,
    });
    await (await import('../../../../src/storage/settings')).saveSettings({});
    (globalThis as { fetch: unknown }).fetch = vi.fn(() => Promise.resolve({ status: 200, headers: { get: () => null } } as unknown as Response));
    document.body.innerHTML = '<div id="root"></div>';
    await import('../../../../src/ui/popup/Popup');
    await settle();
    await settle();
    const gear = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.getAttribute('aria-label') === t.settingsBtn);
    expect(gear, 'the Settings control is on the header').toBeTruthy();
    gear!.focus();
    await act(async () => { gear!.click(); });
    await settle();
    const lock = document.querySelector<HTMLElement>('.pin-overlay');
    expect(lock, 'the PIN lock is open').not.toBeNull();
    expect(lock!.contains(document.activeElement), 'the focus is inside the lock').toBe(true);
    keydown('Escape');
    await settle();
    expect(document.querySelector('.pin-overlay'), 'the lock is closed').toBeNull();
    expect(document.activeElement, 'the gear has the focus again').toBe(gear);
  });
});
