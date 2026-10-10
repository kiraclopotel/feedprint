/** @vitest-environment jsdom */
// RS1 (board/units/RS1.md; desk row 7 of THU-VOICE-LOOK.md). The reading screen that asks before the first paid reading says
// it is a modal (role="dialog", aria-modal="true") but Tab walked out of it into the popup painted underneath, and when it closed
// the focus was lost. It now keeps Tab and Shift+Tab inside the dialog, gives the focus back to whatever had it before it
// opened, and answers Escape with the close mark and nothing else: Escape never means "Start" and never means "Not now" (the two
// answers weigh the same; a nudged answer is no consent, the file's own header). With no close mark (onClose absent) Escape does
// nothing. The pattern is PinOverlay's (controls.tsx, the 2026-09-18 accessibility audit), copied small.
//
// jsdom moves no focus on Tab, so `tab()` plays the browser: it sends the key, and when the page did not stop it, moves the focus
// to the next (or previous) tabbable element of the whole document, which is how a trap that is missing shows as focus outside.
// The first group renders the screen alone between two buttons that stand for the popup under it; the second group drives the real
// popup (harness copied from the-consent-close-mark-sits-beside-the-heading.test.tsx, which is not edited).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { installChromeStorageStub, type ChromeStorageStub } from '../../../helpers/chrome-storage';
import { utcDayKey, utcMonthKey, CURRENT_SETTINGS_SCHEMA_VERSION } from '../../../../src/storage/settings';
import { POPUP_STRINGS } from '../../../../src/i18n/popup-strings';
import { I18nProvider } from '../../../../src/i18n/react';
import { ReadingConsentScreen } from '../../../../src/ui/popup/panels/ReadingConsentScreen';

const pins = vi.hoisted(() => ({ right: '1234', wrong: '9999' }));

// The PIN's own hashing and throttle have their tests; here only the popup's gate is under test.
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

// ─── The screen alone, between two buttons that stand for the popup under it ────────────────────────────────────────────

let root: Root | null = null;

interface Spies {
  onStart: ReturnType<typeof vi.fn<(shownText: string, provider: string) => void>>;
  onNotNow: ReturnType<typeof vi.fn<() => void>>;
  onClose: ReturnType<typeof vi.fn<() => void>>;
}

function mountScreen(opts: { withClose?: boolean; provider?: string | null } = {}): Spies & { before: HTMLElement; after: HTMLElement; dialog: HTMLElement } {
  const spies: Spies = {
    onStart: vi.fn<(shownText: string, provider: string) => void>(),
    onNotNow: vi.fn<() => void>(),
    onClose: vi.fn<() => void>(),
  };
  document.body.innerHTML = '<button id="before">popup control before</button><div id="slot"></div><button id="after">popup control after</button>';
  const before = document.getElementById('before')!;
  const after = document.getElementById('after')!;
  before.focus();
  root = createRoot(document.getElementById('slot')!);
  act(() => {
    root!.render(
      <I18nProvider lang="en">
        <ReadingConsentScreen
          provider={opts.provider === undefined ? SERVED : opts.provider}
          onStart={spies.onStart}
          onNotNow={spies.onNotNow}
          onClose={opts.withClose === false ? undefined : spies.onClose}
        />
      </I18nProvider>,
    );
  });
  const dialog = document.querySelector<HTMLElement>('[data-testid="reading-consent"]')!;
  return { ...spies, before, after, dialog };
}

function unmountScreen(): void {
  act(() => { root?.unmount(); });
  root = null;
}

const markOf = (): HTMLElement => document.querySelector<HTMLElement>('[data-testid="consent-close"]')!;
const startOf = (): HTMLElement => document.querySelector<HTMLElement>('[data-testid="consent-start"]')!;
const notNowOf = (): HTMLElement => document.querySelector<HTMLElement>('[data-testid="consent-not-now"]')!;

afterEach(() => {
  if (root) unmountScreen();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('RS1: the reading screen keeps Tab inside it', () => {
  it('guard: focus starts on the heading, and neither answer has it first', () => {
    mountScreen();
    expect(document.activeElement, 'focus is on the heading').toBe(document.getElementById('fw-consent-title'));
    expect(document.activeElement).not.toBe(startOf());
    expect(document.activeElement).not.toBe(notNowOf());
  });

  it('Tab from the last control goes to the first, and focus never leaves the dialog', () => {
    const { dialog } = mountScreen();
    notNowOf().focus();
    tab();
    expect(dialog.contains(document.activeElement), 'focus stayed inside the dialog').toBe(true);
    expect(document.activeElement, 'it wrapped to the first control, the close mark').toBe(markOf());
  });

  it('Shift+Tab from the first control goes to the last, and focus never leaves the dialog', () => {
    const { dialog } = mountScreen();
    markOf().focus();
    tab(true);
    expect(dialog.contains(document.activeElement), 'focus stayed inside the dialog').toBe(true);
    expect(document.activeElement, 'it wrapped to the last control, "Not now"').toBe(notNowOf());
  });

  it('Shift+Tab from the heading with no close mark goes to the last control, not out of the dialog', () => {
    const { dialog } = mountScreen({ withClose: false });
    expect(document.activeElement).toBe(document.getElementById('fw-consent-title'));
    tab(true);
    expect(dialog.contains(document.activeElement), 'focus stayed inside the dialog').toBe(true);
  });

  it('walking forward twelve times and back twelve times never leaves the dialog, with the screen unable to start', () => {
    const { dialog } = mountScreen({ provider: null });
    for (let i = 0; i < 12; i++) {
      tab();
      expect(dialog.contains(document.activeElement), `forward step ${i + 1} is inside`).toBe(true);
    }
    for (let i = 0; i < 12; i++) {
      tab(true);
      expect(dialog.contains(document.activeElement), `back step ${i + 1} is inside`).toBe(true);
    }
  });

  it('a Tab in the middle of the dialog is left to the browser', () => {
    mountScreen();
    startOf().focus();
    const ev = keydown('Tab');
    expect(ev.defaultPrevented, 'the page does not stop a Tab that stays inside').toBe(false);
  });
});

describe('RS1: Escape answers with the close mark and nothing else', () => {
  it('with the close mark: Escape closes the screen the way the mark does, and answers nothing', () => {
    const { onStart, onNotNow, onClose } = mountScreen();
    keydown('Escape');
    expect(onClose, 'Escape is the close mark').toHaveBeenCalledTimes(1);
    expect(onStart, 'Escape never starts the reading').not.toHaveBeenCalled();
    expect(onNotNow, 'Escape never says "Not now"').not.toHaveBeenCalled();
  });

  it('with the focus on an answer: Escape still only closes, and never presses the answer', () => {
    const { onStart, onNotNow, onClose } = mountScreen();
    startOf().focus();
    keydown('Escape');
    notNowOf().focus();
    keydown('Escape');
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(onStart).not.toHaveBeenCalled();
    expect(onNotNow).not.toHaveBeenCalled();
  });

  it('without the close mark: Escape does nothing at all', () => {
    const { onStart, onNotNow, onClose } = mountScreen({ withClose: false });
    keydown('Escape');
    expect(onClose).not.toHaveBeenCalled();
    expect(onStart).not.toHaveBeenCalled();
    expect(onNotNow).not.toHaveBeenCalled();
    expect(document.querySelector('[data-testid="reading-consent"]'), 'the screen is still there').not.toBeNull();
  });
});

describe('RS1: the screen gives the focus back when it closes', () => {
  it('whatever way it closes, the control that had the focus before has it again', () => {
    const { before } = mountScreen();
    expect(document.activeElement, 'the heading took the focus').toBe(document.getElementById('fw-consent-title'));
    unmountScreen();
    expect(document.activeElement, 'the control that had the focus before has it again').toBe(before);
  });
});

// ─── The real popup ─────────────────────────────────────────────────────────────────────────────────────────────────────

function stored(parentPin: string): Record<string, unknown> {
  return {
    settingsSchemaVersion: CURRENT_SETTINGS_SCHEMA_VERSION, lastResetDate: utcDayKey(), lastResetMonth: utcMonthKey(),
    fw_license_key: 'fw-starter-abc12345', dailyCap: 2500, totalChecksToday: 0, totalTokensThisMonth: 100,
    setupDone: true, mode: 'adult', aiAnalysisEnabled: true, parentPin,
  };
}

function probeAnswer(header: string | null): Response {
  return { status: 200, headers: { get: (n: string) => (n.toLowerCase() === 'x-fw-provider-legal' ? header : null) } } as unknown as Response;
}

let storage: ChromeStorageStub;

async function openPopup(parentPin: string): Promise<void> {
  storage = installChromeStorageStub({ initial: stored(parentPin), sendMessage: () => undefined });
  // The settings module outlives vi.resetModules through the mock above, and so does its read cache:
  // a write drops it, so no case reads the PIN or the reading switch a case before it left.
  await (await import('../../../../src/storage/settings')).saveSettings({});
  (globalThis as { fetch: unknown }).fetch = vi.fn(() => Promise.resolve(probeAnswer(SERVED)));
  document.body.innerHTML = '<div id="root"></div>';
  await import('../../../../src/ui/popup/Popup');
  await settle();
  await settle();
  expect(document.querySelector('#pop-tab-home'), 'the main screen is shown, so the test is looking at the real popup').not.toBeNull();
}

const consentScreen = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-testid="reading-consent"]');
const pinDialog = (): HTMLElement | null => document.querySelector<HTMLElement>('.pin-overlay:not([data-testid="reading-consent"])');

describe('RS1 in the real popup', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  // Until 9 Oct 2026 this case brought the screen back with Home's "Read this for me" button; the button is gone (his
  // word), so the screen is closed with Escape where it first opens.
  it('Escape closes the reading screen like the mark, and answers nothing', async () => {
    await openPopup(STORED_PIN);
    expect(consentScreen(), 'the reading screen is asked for').not.toBeNull();
    keydown('Escape');
    await settle();
    expect(consentScreen(), 'Escape closed it').toBeNull();
    expect(storage.state, 'Escape stored no answer').not.toHaveProperty('readingConsent');
    expect(storage.state.aiAnalysisEnabled, 'Escape switched nothing off').toBe(true);
  });

  it('guard: with the PIN dialog open on top, the screen under it leaves Tab and Escape to the PIN dialog', async () => {
    await openPopup(STORED_PIN);
    await act(async () => { document.querySelector<HTMLButtonElement>('[data-testid="consent-start"]')!.click(); });
    await settle();
    const pin = pinDialog();
    expect(pin, 'the PIN dialog is open').not.toBeNull();
    // Tab keeps working inside the PIN dialog: from its last control it wraps inside it, never into the screen under it.
    const controls = Array.from(pin!.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])'));
    controls[controls.length - 1].focus();
    tab();
    expect(pin!.contains(document.activeElement), 'Tab stayed in the PIN dialog').toBe(true);
    // Escape in the PIN dialog cancels the PIN, and does not also close the reading screen under it.
    keydown('Escape');
    await settle();
    expect(pinDialog(), 'the PIN dialog is closed').toBeNull();
    expect(consentScreen(), 'the reading screen is still there, unanswered').not.toBeNull();
  });
});
