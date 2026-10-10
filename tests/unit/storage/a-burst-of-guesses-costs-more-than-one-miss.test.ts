/** @vitest-environment jsdom */
//
// The PIN throttle counted a batch of parallel guesses as a single miss.
//
// `verifyPin` read the attempt state, checked the PIN, then handed that same
// snapshot to `recordPinAttempt`, which wrote `state.misses + 1`. Three awaits,
// and every attempt ran them on its own. Fire N attempts in parallel and all N
// read the same count and all N write that count plus one, so a burst of any
// size costs one wrong guess and the lockout never arrives.
//
// The module header claims the throttle makes the four-digit space
// non-exhaustible. Against a keyboard it does. Against a loop it did not, and
// the stored PIN is a salted PBKDF2 digest, so a copy of storage is no
// substitute for guessing: this was the cheaper of the two paths, not a
// redundant one. The same hole sat under the recovery phrase, whose own
// docblock promises it "cannot be guessed faster than the PIN".
//
// Found 2026-09-19 by a read-only scan of the child-safety promise, ranked
// last by the scout and verified here because the salted hash is what makes it
// worth more than it looked.
//
// The fix serialises the read-check-record sequence: a queued attempt reads
// the count the one before it wrote. PIN entries are rare and human-paced, so
// the queue costs nothing in the case that matters.

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

let store: Record<string, unknown>;

beforeEach(() => {
  vi.resetModules();
  store = {};
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: async (k: string | string[]) => {
          const keys = Array.isArray(k) ? k : [k];
          const out: Record<string, unknown> = {};
          for (const key of keys) if (key in store) out[key] = store[key];
          return out;
        },
        set: async (patch: Record<string, unknown>) => { Object.assign(store, patch); },
        remove: async (k: string) => { delete store[k]; },
      },
      session: { get: async () => ({}), set: async () => {} },
      onChanged: { addListener: () => {}, removeListener: () => {} },
    },
    runtime: { id: 'test' },
  });
});

afterEach(() => { vi.unstubAllGlobals(); });

/** The attempt record the throttle keeps. */
const attempts = (): { misses: number; lockedUntil: number } =>
  (store['fw_pin_attempts'] as { misses: number; lockedUntil: number } | undefined)
  ?? { misses: 0, lockedUntil: 0 };

describe('a burst of guesses costs more than one miss (2026-09-19)', () => {
  it('ten wrong PINs at once are ten misses, not one', async () => {
    const settings = await import('../../../src/storage/settings');
    await settings.setPin('1234');
    // setPin clears the counter, so the burst starts from zero either way.
    store['fw_pin_attempts'] = { misses: 0, lockedUntil: 0 };

    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => settings.verifyPin(String(1000 + i))),
    );
    expect(results.every(r => r === false), 'none of them was the PIN').toBe(true);
    // Before the fix this was 1. The exact number after the free attempts run
    // out is not the point; that it grows with the burst is.
    expect(attempts().misses, 'every guess was counted').toBeGreaterThan(1);
    expect(attempts().lockedUntil, 'and the lockout arrived').toBeGreaterThan(Date.now());
  });

  it('the right PIN still opens, and clears the counter behind it', async () => {
    // The other side. A throttle that locks a parent out of their own install
    // is not an improvement.
    const settings = await import('../../../src/storage/settings');
    await settings.setPin('4321');
    expect(await settings.verifyPin('0000'), 'a wrong one is refused').toBe(false);
    expect(attempts().misses).toBe(1);
    expect(await settings.verifyPin('4321'), 'the right one opens').toBe(true);
    expect(attempts().misses, 'and the slate is clean').toBe(0);
  });

  it('a queued attempt sees the lockout the one before it caused', async () => {
    // What serialising actually buys: the later attempts in a burst are
    // refused on the lockout rather than each getting its own free check.
    const settings = await import('../../../src/storage/settings');
    await settings.setPin('1111');
    store['fw_pin_attempts'] = { misses: 0, lockedUntil: 0 };
    await Promise.all(Array.from({ length: 12 }, () => settings.verifyPin('9999')));
    const locked = attempts().lockedUntil;
    expect(locked).toBeGreaterThan(Date.now());
    // Even the correct PIN waits while the lock stands, which is the point of
    // a lock.
    expect(await settings.verifyPin('1111')).toBe(false);
  });
});
