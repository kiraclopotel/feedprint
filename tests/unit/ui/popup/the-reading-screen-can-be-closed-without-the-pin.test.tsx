/** @vitest-environment jsdom */
// W2-CLOSE. The harness below is a copy of the top of the-consent-answer-waits-for-the-pin.test.tsx (its PIN mock,
// its stored install, the probe answer and the helpers), so this file drives the real popup the same way; the suite
// that follows is new. Kept as its own file because an existing check is never edited by the maker.
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


import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ─── W2-CLOSE: a close mark on the reading screen that answers nothing ────────────────────────────────────────────
//
// Right after setup, at Moderate with a key and a PIN, "Before the first reading" asked for the PIN on either answer, and
// Cancel on the PIN put the same screen back: a person without the PIN could not reach Home. The close mark is a third way
// out that answers nothing: it hides the screen for this open only (no consent stored, no setting changed, no reading
// started, nothing sent), so it needs no PIN, and the screen shows again at the next open. Both answers keep their PIN
// (pinned above, unchanged). This screen carries consent, so the checks below also prove what the close mark must NOT do
// (the head, IN.md 14:46): (a) it starts no reading and sends nothing, and the stored answer is as it was; (b) from Home,
// after closing, no control starts the reading or changes that answer without the PIN; (c) the next open asks again.

function closeMark(): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>('[data-testid="consent-close"]');
}

async function pressClose(): Promise<void> {
  const btn = closeMark();
  if (!btn) throw new Error('no close mark: the consent screen is not shown or has none');
  await act(async () => { btn.click(); });
  await settle();
}

/** What goes out of the popup: the count of network calls and of messages to the worker so far. */
function sentSoFar(): { fetches: number; messages: number } {
  const g = globalThis as unknown as { fetch: { mock: { calls: unknown[] } }; chrome: { runtime: { sendMessage: { mock: { calls: unknown[] } } } } };
  return { fetches: g.fetch.mock.calls.length, messages: g.chrome.runtime.sendMessage.mock.calls.length };
}

/** Counts the messages to the worker from here on (the stub's own sendMessage does nothing and counts nothing). */
function countMessages(): void {
  (globalThis as unknown as { chrome: { runtime: { sendMessage: unknown } } }).chrome.runtime.sendMessage = vi.fn();
}

function consentControls(): Element[] {
  return Array.from(document.querySelectorAll('[data-testid="consent-start"], [data-testid="consent-not-now"], [data-testid="reading-consent"]'));
}

describe('the close mark on the reading screen answers nothing', () => {
  it('is on the screen, named with the word the popup already uses for closing a notice', async () => {
    await openPopup(STORED_PIN);
    const mark = closeMark();
    expect(mark, 'the reading screen has a close mark').not.toBeNull();
    expect(mark!.getAttribute('aria-label')).toBe(t.updateNoticeDismiss);
    expect(consentScreen()!.contains(mark), 'it is on the reading screen').toBe(true);
  });

  it('with a PIN set: shows Home, asks for no PIN, and stores no answer', async () => {
    await openPopup(STORED_PIN);
    await pressClose();
    expect(pinDialog(), 'no PIN is asked for').toBeNull();
    expect(consentScreen(), 'the screen is gone for this open').toBeNull();
    expect(document.querySelector('#pop-tab-home'), 'Home is shown').not.toBeNull();
    expect(storage.state.aiAnalysisEnabled, 'the reading switch is unchanged').toBe(true);
    expect(storage.state.readingConsent, 'no consent was stored').toBeUndefined();
  });

  it('with no PIN: shows Home and stores no answer either (it is not "Not now")', async () => {
    await openPopup('');
    await pressClose();
    expect(pinDialog(), 'no PIN dialog').toBeNull();
    expect(consentScreen(), 'the screen is gone for this open').toBeNull();
    expect(storage.state.aiAnalysisEnabled, 'the reading is still on: closing is not "Not now"').toBe(true);
    expect(storage.state.readingConsent, 'no consent was stored').toBeUndefined();
  });

  // (a) it starts no reading and sends nothing
  it.each([['a PIN set', STORED_PIN], ['no PIN', '']])('with %s: closing sends nothing (no network call, no message to the worker) and leaves the stored answer as it was', async (_label, pin) => {
    await openPopup(pin);
    countMessages();
    const before = sentSoFar();
    const storedBefore = JSON.stringify(storage.state);
    await pressClose();
    await settle();
    expect(sentSoFar(), 'nothing left the popup when it was closed').toEqual(before);
    expect(JSON.stringify(storage.state), 'storage is as it was before the screen was closed').toBe(storedBefore);
    expect(storage.state.aiAnalysisEnabled, 'the reading switch is as it was').toBe(true);
    expect(storage.state.readingConsent, 'no consent stored').toBeUndefined();
  });

  // (b) from Home, after closing, nothing starts the reading or changes the answer without the PIN
  it('with a PIN set, after closing: Home and the Keys tab carry no control that answers the question', async () => {
    await openPopup(STORED_PIN);
    await pressClose();
    expect(consentControls(), 'no consent control on Home').toEqual([]);
    const storedBefore = JSON.stringify(storage.state);
    const keysTab = document.querySelector<HTMLButtonElement>('#pop-tab-keys');
    expect(keysTab, 'the tab bar is there').not.toBeNull();
    await act(async () => { keysTab!.click(); });
    await settle();
    expect(consentControls(), 'no consent control on the Keys tab').toEqual([]);
    expect(JSON.stringify(storage.state), 'visiting the tabs changes nothing').toBe(storedBefore);
  });

  it('with a PIN set, after closing: the only way to the reading switch, Settings, asks for the PIN and opens nothing without it', async () => {
    await openPopup(STORED_PIN);
    await pressClose();
    const storedBefore = JSON.stringify(storage.state);
    const gear = document.querySelector<HTMLButtonElement>(`button[aria-label="${t.settingsBtn}"]`);
    expect(gear, 'Home has its Settings button').not.toBeNull();
    await act(async () => { gear!.click(); });
    await settle();
    expect(pinDialog(), 'Settings asks for the PIN').not.toBeNull();
    expect(document.querySelector('#pop-tab-home'), 'Home stays: Settings is not open').not.toBeNull();
    await typePin(pins.wrong);
    expect(pinDialog(), 'a wrong PIN opens nothing').not.toBeNull();
    expect(JSON.stringify(storage.state), 'the answer is untouched').toBe(storedBefore);
    expect(storage.state.aiAnalysisEnabled).toBe(true);
    expect(storage.state.readingConsent).toBeUndefined();
  });

  it('in the popup, the code that records the consent or switches the reading off from the screen sits inside the PIN gate', () => {
    const popup = readFileSync(resolve(process.cwd(), 'src/ui/popup/Popup.tsx'), 'utf8').split('\n');
    const writers = popup.filter((l) => l.includes('recordReadingConsent(') || l.includes('aiAnalysisEnabled: false'));
    expect(writers.length, 'the two answers are the only writers in Popup.tsx').toBe(2);
    for (const line of writers) expect(line, 'each answer goes through answerWithPin').toContain('answerWithPin(');
    const screen = readFileSync(resolve(process.cwd(), 'src/ui/popup/panels/ReadingConsentScreen.tsx'), 'utf8');
    expect(screen, 'the screen itself never writes storage or sends').not.toMatch(/saveSettings|recordReadingConsent\(|chrome\.|fetch\(/);
  });

  // (c) the next open shows the screen again
  it.each([['a PIN set', STORED_PIN], ['no PIN', '']])('with %s: the screen shows again at the next open, since nothing was answered', async (_label, pin) => {
    await openPopup(pin);
    await pressClose();
    expect(consentScreen(), 'closed for this open').toBeNull();
    vi.resetModules();
    document.body.innerHTML = '';
    await openPopup(pin);
    expect(consentScreen(), 'the next open asks again').not.toBeNull();
  });
});
