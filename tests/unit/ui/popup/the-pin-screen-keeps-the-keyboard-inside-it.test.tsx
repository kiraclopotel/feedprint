/** @vitest-environment jsdom */
// RS2 (board/units/RS2.md; maker 1's own finding in RS1's report). The PIN screen says it is a modal (role="dialog", aria-modal="true")
// and traps Tab, but only at its two ends: it tested "the focus is on the first control" and "the focus is on the last control". A
// Shift+Tab from the panel itself, or from a line of text inside it that holds the focus (a click on it), and a Tab from such a place
// after the last control, walked out into the popup painted underneath. The reading screen closed the same hole in RS1 (cfad892a):
// from a place that is not in the list of controls it counts the controls before and after it, and with the focus outside the dialog
// it brings the focus in. Here the same, for PinOverlay.
//
// jsdom moves no focus on Tab, so `tab()` plays the browser (the shape of the-reading-screen-keeps-the-keyboard-inside-it.test.tsx,
// which is not edited): it sends the key, and when the page did not stop it, moves the focus to the next (or previous) tabbable
// element of the whole document, which is how a trap that is missing shows as focus outside. The first group renders the PIN screen
// alone between two buttons that stand for the popup under it; the second drives the real popup with the PIN screen over the reading screen.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { installChromeStorageStub } from '../../../helpers/chrome-storage';
import { utcDayKey, utcMonthKey, CURRENT_SETTINGS_SCHEMA_VERSION } from '../../../../src/storage/settings';
import { POPUP_STRINGS } from '../../../../src/i18n/popup-strings';
import { I18nProvider } from '../../../../src/i18n/react';
import { PinOverlay } from '../../../../src/ui/popup/controls';

const pins = vi.hoisted(() => ({ right: '1234' }));

// The PIN's own hashing and throttle have their tests; here only the screen's keyboard is under test.
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
const SERVED = 'Served Company Inc., USA';
const STORED_PIN = 'a'.repeat(64);

// ─── The keyboard, played by hand ───────────────────────────────────────────────────────────────────────────────────────

function tabbables(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('button, input, select, textarea, [href], [tabindex]'))
    .filter((el) => !(el as HTMLButtonElement).disabled && el.tabIndex >= 0);
}

function keydown(key: string, shift = false): KeyboardEvent {
  const target = (document.activeElement ?? document.body) as HTMLElement;
  const ev = new KeyboardEvent('keydown', { key, shiftKey: shift, bubbles: true, cancelable: true });
  act(() => { target.dispatchEvent(ev); });
  return ev;
}

/** Tab or Shift+Tab as a browser does it: the page may stop it; if it does not, the focus moves on through the whole document. */
function tab(shift = false): void {
  const ev = keydown('Tab', shift);
  if (ev.defaultPrevented) return;
  const active = (document.activeElement ?? document.body) as HTMLElement;
  const list = tabbables();
  const at = list.indexOf(active);
  let next: HTMLElement | undefined;
  if (at !== -1) next = list[at + (shift ? -1 : 1)];
  else if (shift) next = [...list].reverse().find((el) => active.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING);
  else next = list.find((el) => active.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING);
  if (next) next.focus();
  else active.blur();
}

async function settle(ms = 20): Promise<void> {
  await act(async () => { await new Promise((r) => setTimeout(r, ms)); });
}

// ─── The PIN screen alone, between two buttons that stand for the popup under it ────────────────────────────────────────

let root: Root | null = null;

function mountPin(): { onCancel: ReturnType<typeof vi.fn<() => void>>; before: HTMLElement; after: HTMLElement; dialog: HTMLElement; panel: HTMLElement } {
  const onCancel = vi.fn<() => void>();
  document.body.innerHTML = '<button id="before">popup control before</button><div id="slot"></div><button id="after">popup control after</button>';
  const before = document.getElementById('before')!;
  const after = document.getElementById('after')!;
  before.focus();
  root = createRoot(document.getElementById('slot')!);
  act(() => {
    root!.render(
      <I18nProvider lang="en">
        <PinOverlay onSuccess={() => {}} onCancel={onCancel} />
      </I18nProvider>,
    );
  });
  const dialog = document.querySelector<HTMLElement>('.pin-overlay')!;
  const panel = dialog.querySelector<HTMLElement>('.panel')!;
  return { onCancel, before, after, dialog, panel };
}

function unmountPin(): void {
  act(() => { root?.unmount(); });
  root = null;
}

const boxesOf = (): HTMLInputElement[] => Array.from(document.querySelectorAll<HTMLInputElement>('.pin-overlay input.pin-box'));
const controlsOf = (): HTMLElement[] => Array.from(document.querySelectorAll<HTMLElement>('.pin-overlay button:not([disabled]), .pin-overlay input:not([disabled])'));
const cancelOf = (): HTMLElement => controlsOf()[controlsOf().length - 1];

/** A place inside the panel the focus can sit on without being a control: the panel itself, or a line of text a click focused. */
function focusAsAClickWould(el: HTMLElement): void {
  el.setAttribute('tabindex', '-1');
  el.focus();
  expect(document.activeElement, 'the place holds the focus').toBe(el);
}

afterEach(() => {
  if (root) unmountPin();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('RS2: the PIN screen keeps Tab inside it from every place in it', () => {
  it('guard: focus starts on the first digit box', () => {
    mountPin();
    expect(document.activeElement, 'focus is on the first box').toBe(boxesOf()[0]);
  });

  it('guard: Tab from the last control goes to the first, and Shift+Tab from the first to the last', () => {
    const { dialog } = mountPin();
    const first = controlsOf()[0];
    const last = cancelOf();
    last.focus();
    tab();
    expect(dialog.contains(document.activeElement), 'focus stayed inside').toBe(true);
    expect(document.activeElement, 'it wrapped to the first control').toBe(first);
    tab(true);
    expect(dialog.contains(document.activeElement), 'focus stayed inside').toBe(true);
    expect(document.activeElement, 'it wrapped to the last control').toBe(last);
  });

  it('guard: a Tab in the middle of the dialog is left to the browser', () => {
    mountPin();
    controlsOf()[1].focus();
    expect(keydown('Tab').defaultPrevented, 'the page does not stop a Tab that stays inside').toBe(false);
  });

  it('Shift+Tab from the panel itself goes to the last control, not out into the popup', () => {
    const { dialog, panel } = mountPin();
    focusAsAClickWould(panel);
    tab(true);
    expect(dialog.contains(document.activeElement), 'focus stayed inside the dialog').toBe(true);
    expect(document.activeElement, 'it wrapped to the last control').toBe(cancelOf());
  });

  it('Shift+Tab from the title line (a click on its text) goes to the last control, not out into the popup', () => {
    const { dialog } = mountPin();
    const title = Array.from(dialog.querySelectorAll<HTMLElement>('h3')).find((h) => h.textContent === t.pinTitle)!;
    expect(title, 'the title is on the screen').toBeTruthy();
    focusAsAClickWould(title);
    tab(true);
    expect(dialog.contains(document.activeElement), 'focus stayed inside the dialog').toBe(true);
    expect(document.activeElement, 'it wrapped to the last control').toBe(cancelOf());
  });

  it('Tab from a line of text after the last control goes to the first control, not out into the popup', () => {
    const { dialog, panel } = mountPin();
    const tail = document.createElement('p');
    tail.textContent = 'a line after the last control';
    panel.appendChild(tail);
    focusAsAClickWould(tail);
    tab();
    expect(dialog.contains(document.activeElement), 'focus stayed inside the dialog').toBe(true);
    expect(document.activeElement, 'it wrapped to the first control').toBe(controlsOf()[0]);
  });

  it('Tab from the title line moves on as the browser does, inside the dialog', () => {
    const { dialog } = mountPin();
    const title = Array.from(dialog.querySelectorAll<HTMLElement>('h3')).find((h) => h.textContent === t.pinTitle)!;
    focusAsAClickWould(title);
    expect(keydown('Tab').defaultPrevented, 'a Tab that has a control after it is left to the browser').toBe(false);
  });

  it('with the focus outside the dialog, Shift+Tab brings it in at the last control and Tab at the first', () => {
    const { dialog, before, after } = mountPin();
    before.focus();
    tab(true);
    expect(dialog.contains(document.activeElement), 'Shift+Tab from the control before: inside').toBe(true);
    expect(document.activeElement).toBe(cancelOf());
    after.focus();
    tab();
    expect(dialog.contains(document.activeElement), 'Tab from the control after: inside').toBe(true);
    expect(document.activeElement).toBe(controlsOf()[0]);
  });

  it('walking forward twelve times and back twelve times from the panel never leaves the dialog', () => {
    const { dialog, panel } = mountPin();
    focusAsAClickWould(panel);
    for (let i = 0; i < 12; i++) {
      tab();
      expect(dialog.contains(document.activeElement), `forward step ${i + 1} is inside`).toBe(true);
    }
    focusAsAClickWould(panel);
    for (let i = 0; i < 12; i++) {
      tab(true);
      expect(dialog.contains(document.activeElement), `back step ${i + 1} is inside`).toBe(true);
    }
  });

  it('guard: Escape cancels', () => {
    const { onCancel } = mountPin();
    keydown('Escape');
    expect(onCancel, 'Escape is Cancel').toHaveBeenCalledTimes(1);
  });
});

// ─── The real popup: the PIN screen over the reading screen ─────────────────────────────────────────────────────────────

function stored(): Record<string, unknown> {
  return {
    settingsSchemaVersion: CURRENT_SETTINGS_SCHEMA_VERSION, lastResetDate: utcDayKey(), lastResetMonth: utcMonthKey(),
    fw_license_key: 'fw-starter-abc12345', dailyCap: 2500, totalChecksToday: 0, totalTokensThisMonth: 100,
    setupDone: true, mode: 'adult', aiAnalysisEnabled: true, parentPin: STORED_PIN,
  };
}

function probeAnswer(header: string | null): Response {
  return { status: 200, headers: { get: (n: string) => (n.toLowerCase() === 'x-fw-provider-legal' ? header : null) } } as unknown as Response;
}

describe('RS2 in the real popup', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('with the PIN screen open over the reading screen, Shift+Tab from the panel stays in the PIN screen', async () => {
    installChromeStorageStub({ initial: stored(), sendMessage: () => undefined });
    await (await import('../../../../src/storage/settings')).saveSettings({});
    (globalThis as { fetch: unknown }).fetch = vi.fn(() => Promise.resolve(probeAnswer(SERVED)));
    document.body.innerHTML = '<div id="root"></div>';
    await import('../../../../src/ui/popup/Popup');
    await settle();
    await settle();
    expect(document.querySelector('[data-testid="reading-consent"]'), 'the reading screen is asked for').not.toBeNull();
    await act(async () => { document.querySelector<HTMLButtonElement>('[data-testid="consent-start"]')!.click(); });
    await settle();
    const pin = document.querySelector<HTMLElement>('.pin-overlay:not([data-testid="reading-consent"])');
    expect(pin, 'the PIN screen is open').not.toBeNull();
    focusAsAClickWould(pin!.querySelector<HTMLElement>('.panel')!);
    tab(true);
    expect(pin!.contains(document.activeElement), 'Shift+Tab from the panel stayed in the PIN screen').toBe(true);
    tab();
    expect(pin!.contains(document.activeElement), 'and Tab from the last control wraps inside it').toBe(true);
  });
});
