/** @vitest-environment jsdom */
//
// "Block this" could be a press that did nothing and said nothing.
//
// Found 2026-09-19 by a read of the free product. The popup wrote the arming
// into storage and immediately closed itself. Nothing checked that any tab had
// taken it, and the popup cannot check on its own: the free product asks for
// the `storage` permission and nothing else, so it cannot see what page is in
// front of it.
//
// Three ways to press it and get nothing, all ordinary:
//
//   the tab is a site Off does not run on at all;
//   the tab is a private-message surface, where the content script declines to
//     run on purpose, which is right and still leaves the button silent;
//   the tab has been open since before Off was installed or updated, so no
//     content script is in it until a reload.
//
// The fix is a handshake over the one permission there is. The content script
// writes the arming's own timestamp back once the crosshair is really up, and
// the popup waits a moment for it: on an answer it closes as before, on
// silence it stays open and says to open the site and reload it. Both halves
// live in picker.ts so they cannot drift apart.
//
// These cases are the two sides: the answer is written only when a tab really
// arms, and the wait reports the truth either way.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PICKER_ACK_KEY, PICKER_ARMED_KEY, PICK_ANSWER_MS, pickWasTaken, startPicker } from '../../../../src/content/engagement/picker';
import { _setProductForTesting } from '../../../../src/product';
import type { FWSettings } from '../../../../src/storage/settings';

type Listener = (changes: Record<string, chrome.storage.StorageChange>) => void;
let listeners: Listener[];
let store: Record<string, unknown>;

/** Write through the stub the way chrome does: set, then notify. */
function write(patch: Record<string, unknown>): void {
  const changes: Record<string, chrome.storage.StorageChange> = {};
  for (const [k, v] of Object.entries(patch)) {
    changes[k] = { oldValue: store[k], newValue: v };
    store[k] = v;
  }
  for (const l of [...listeners]) l(changes);
}

beforeEach(() => {
  listeners = [];
  store = {};
  vi.stubGlobal('chrome', {
    storage: {
      onChanged: {
        addListener: (l: Listener) => { listeners.push(l); },
        removeListener: (l: Listener) => { listeners = listeners.filter(x => x !== l); },
      },
      local: {
        get: async (k: string) => (k in store ? { [k]: store[k] } : {}),
        set: async (patch: Record<string, unknown>) => { write(patch); },
        remove: async () => {},
      },
    },
    runtime: { id: 'test' },
  });
  _setProductForTesting('off');
});

afterEach(() => {
  _setProductForTesting(null);
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const settings = { uiLanguage: 'en' } as unknown as FWSettings;

describe('the pick button hears back or says so (2026-09-19)', () => {
  it('a tab that arms answers with the arming it took', async () => {
    const stop = startPicker('twitter', settings);
    const at = Date.now();
    write({ [PICKER_ARMED_KEY]: { at, many: false } });
    expect(store[PICKER_ACK_KEY], 'the tab said which arming it has').toBe(at);
    stop();
  });

  it('a tab that declines the arming answers nothing', async () => {
    // Not visible: a background tab stands down, and must not claim the pick,
    // or the popup would close on a window where no crosshair ever appeared.
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    const stop = startPicker('twitter', settings);
    write({ [PICKER_ARMED_KEY]: { at: Date.now(), many: false } });
    expect(store[PICKER_ACK_KEY], 'silence, not a false yes').toBeUndefined();
    stop();
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  });

  it('an arming too old to take is not answered either', async () => {
    const stop = startPicker('twitter', settings);
    write({ [PICKER_ARMED_KEY]: { at: Date.now() - 120_000, many: false } });
    expect(store[PICKER_ACK_KEY]).toBeUndefined();
    stop();
  });

  it('the wait says yes when a tab answers', async () => {
    const at = 1_000;
    const taken = pickWasTaken(at);
    write({ [PICKER_ACK_KEY]: at });
    expect(await taken).toBe(true);
  });

  it('the wait says no when nothing answers, and the popup stays open on that', async () => {
    vi.useFakeTimers();
    const taken = pickWasTaken(2_000);
    await vi.advanceTimersByTimeAsync(PICK_ANSWER_MS + 1);
    expect(await taken).toBe(false);
  });

  it('an answer for a different arming is not this one', async () => {
    // Two presses in a row: the older answer must not close the newer press.
    vi.useFakeTimers();
    const taken = pickWasTaken(4_000);
    write({ [PICKER_ACK_KEY]: 3_000 });
    await vi.advanceTimersByTimeAsync(PICK_ANSWER_MS + 1);
    expect(await taken).toBe(false);
  });

  it('an answer that lands as the wait ends is still an answer', async () => {
    // The last look at storage, so the button does not report silence over a
    // tab that armed a millisecond late.
    vi.useFakeTimers();
    const at = 5_000;
    const taken = pickWasTaken(at);
    store[PICKER_ACK_KEY] = at;
    await vi.advanceTimersByTimeAsync(PICK_ANSWER_MS + 1);
    expect(await taken).toBe(true);
  });
});
