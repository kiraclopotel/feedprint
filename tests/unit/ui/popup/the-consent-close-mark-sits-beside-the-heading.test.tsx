/** @vitest-environment jsdom */
// W2-CLOSE, third commit. The harness below is a copy of the top of the-consent-answer-waits-for-the-pin.test.tsx (its
// PIN mock, its stored install, the probe answer and the helpers), so this file drives the real popup the same way;
// the suite that follows is new. Kept as its own file because an existing check is never edited by the maker.
// The consent screen's two answers change the parent's settings: "Start" stores a consent that ends
// the refund right, and "Not now" switches the reading off. So when a parent PIN is set, or the
// settings read could not say whether one is, either answer asks for the PIN first and changes
// nothing until it is entered; cancelling changes nothing at all. With no PIN, each answer acts at
// once. And the screen waits for the licence probe, because before it answers the company's name is
// not known and the screen would flash "not named" at the person.
//
// The consent screen is itself drawn with the .pin-overlay class, so the PIN dialog is found as a
// .pin-overlay that is not the consent screen; a bare .pin-overlay query would pass with no PIN
// dialog on screen at all.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';

import { installChromeStorageStub, type ChromeStorageStub } from '../../../helpers/chrome-storage';
import { utcDayKey, utcMonthKey, CURRENT_SETTINGS_SCHEMA_VERSION } from '../../../../src/storage/settings';
import { POPUP_STRINGS } from '../../../../src/i18n/popup-strings';

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

async function settle(ms = 20): Promise<void> {
  await act(async () => { await new Promise((r) => setTimeout(r, ms)); });
}

let storage: ChromeStorageStub;

async function openPopup(parentPin: string, opts: { probe?: Promise<Response>; settingsReadFails?: boolean } = {}): Promise<HTMLElement> {
  storage = installChromeStorageStub({ initial: stored(parentPin), sendMessage: () => undefined });
  // The settings module outlives vi.resetModules through the mock above, and so does its read cache:
  // a write drops it, so no case reads the PIN or the reading switch a case before it left.
  await (await import('../../../../src/storage/settings')).saveSettings({});
  if (opts.settingsReadFails) {
    // Only the settings read fails, the way a storage blip that outlasts its retry does; the
    // licence and the consent still read, so the screen has a key to ask about.
    const local = (globalThis as unknown as { chrome: { storage: { local: { get: (k: unknown) => Promise<Record<string, unknown>> } } } }).chrome.storage.local;
    const realGet = local.get;
    local.get = (keys: unknown) => (Array.isArray(keys) && keys.includes('parentPin')
      ? Promise.reject(new Error('IO error: storage busy'))
      : realGet(keys));
  }
  const answer = opts.probe ?? Promise.resolve(probeAnswer(SERVED));
  (globalThis as { fetch: unknown }).fetch = vi.fn(() => answer);
  document.body.innerHTML = '<div id="root"></div>';
  await import('../../../../src/ui/popup/Popup');
  // The failing settings read retries before it falls back, so it needs the longer wait.
  await settle(opts.settingsReadFails ? 1500 : 20);
  await settle();
  const root = document.getElementById('root') as HTMLElement;
  expect(root.querySelector('#pop-tab-home'), 'the main screen is shown, so the test is looking at the real popup').not.toBeNull();
  return root;
}

function consentScreen(): Element | null {
  return document.querySelector('[data-testid="reading-consent"]');
}

function pinDialog(): Element | null {
  return document.querySelector('.pin-overlay:not([data-testid="reading-consent"])');
}

function pinInputs(): HTMLInputElement[] {
  return Array.from(document.querySelectorAll<HTMLInputElement>('.pin-overlay:not([data-testid="reading-consent"]) input'));
}

async function press(testId: 'consent-start' | 'consent-not-now'): Promise<void> {
  const btn = document.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`);
  if (!btn) throw new Error(`no ${testId} button: the consent screen is not shown`);
  await act(async () => { btn.click(); });
  await settle();
}

async function typePin(pin: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  const inputs = pinInputs();
  expect(inputs.length, 'the PIN dialog has its digit boxes').toBe(4);
  for (let i = 0; i < pin.length; i++) {
    await act(async () => {
      setter.call(inputs[i], pin[i]);
      inputs[i].dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
  await settle();
  await settle();
}

async function cancelPin(): Promise<void> {
  const dialog = pinDialog();
  const btn = dialog && Array.from(dialog.querySelectorAll('button')).find((b) => b.textContent?.trim() === t.cancel);
  if (!btn) throw new Error('no Cancel button in the PIN dialog');
  await act(async () => { btn.click(); });
  await settle();
}

beforeEach(() => {
  vi.resetModules();
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = ''; });


// ─── W2-CLOSE, third commit: the close mark sits beside the heading, not in its box ───────────────────────────────────
//
// When the reading screen opens, focus sits on its heading, and the heading's focus ring is drawn around the heading's whole
// box. The close mark was floated to the right ahead of the heading, so the heading's box ran under it and the ring
// enclosed the mark: it read like a clear button in a text field (the verifier's 01-mark-zoom.png). The mark now sits in
// a row beside the heading, so the ring encloses the words only. Placement only: the mark keeps its place in the reading
// order (before the heading), its label and its answer (none). jsdom draws nothing, so the check is on the structure that
// decides the box: the mark is outside the heading element, floats nowhere, and shares a flex row with the heading.

describe('the close mark sits beside the heading and outside its box', () => {
  it('is not inside the heading element, is not floated, and shares a flex row with it', async () => {
    await openPopup(STORED_PIN);
    const heading = document.getElementById('fw-consent-title');
    const mark = document.querySelector<HTMLButtonElement>('[data-testid="consent-close"]');
    expect(heading, 'the reading screen has its heading').not.toBeNull();
    expect(mark, 'the reading screen has its close mark').not.toBeNull();
    expect(heading!.contains(mark), 'the mark is outside the heading element').toBe(false);
    expect(mark!.style.float, 'the mark is not floated over the heading\'s box').toBe('');
    const row = mark!.parentElement as HTMLElement;
    expect(row.style.display, 'the mark is in a flex row').toBe('flex');
    expect(heading!.parentElement, 'the heading is in the same row, its own flex item').toBe(row);
  });

  it('keeps its place in the reading order, before the heading, and its label', async () => {
    await openPopup(STORED_PIN);
    const heading = document.getElementById('fw-consent-title')!;
    const mark = document.querySelector<HTMLButtonElement>('[data-testid="consent-close"]')!;
    expect(mark.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING, 'the mark comes before the heading in the document').toBeTruthy();
    expect(mark.getAttribute('aria-label')).toBe(t.updateNoticeDismiss);
  });

  it('focus still sits on the heading when the screen opens', async () => {
    await openPopup(STORED_PIN);
    expect(document.activeElement, 'focus is on the heading').toBe(document.getElementById('fw-consent-title'));
  });
});
