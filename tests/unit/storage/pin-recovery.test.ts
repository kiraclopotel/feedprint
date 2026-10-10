/** @vitest-environment jsdom */
// UX-I18N-A11Y-1: a forgotten PIN used to mean uninstall (which deletes the
// record). Setup now issues a recovery phrase whose salted hash is the only
// thing stored; the phrase resets the PIN through the same attempt throttle
// as the PIN gate, and the Settings panel can change the PIN with the
// current one.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { utcDayKey, utcMonthKey, CURRENT_SETTINGS_SCHEMA_VERSION } from '../../../src/storage/settings';
import { sha256 } from '../../../src/forensics/hasher';

const PIN = '1234';
const NEW_PIN = '5678';

function installStorageStub(initial: Record<string, unknown>): Record<string, unknown> {
  const state: Record<string, unknown> = { ...initial };
  (globalThis as any).chrome = {
    storage: {
      local: {
        get: (keys: string | string[]) => {
          const arr = Array.isArray(keys) ? keys : [keys];
          const out: Record<string, unknown> = {};
          for (const k of arr) if (k in state) out[k] = state[k];
          return Promise.resolve(out);
        },
        set: (obj: Record<string, unknown>) => { Object.assign(state, obj); return Promise.resolve(); },
        remove: (keys: string | string[]) => {
          for (const k of Array.isArray(keys) ? keys : [keys]) delete state[k];
          return Promise.resolve();
        },
      },
      session: { set: () => Promise.resolve(), get: () => Promise.resolve({}) },
    },
    runtime: { sendMessage: () => undefined },
  };
  return state;
}

async function seeded(): Promise<{ state: Record<string, unknown>; phrase: string }> {
  const state = installStorageStub({
    settingsSchemaVersion: CURRENT_SETTINGS_SCHEMA_VERSION,
    lastResetDate: utcDayKey(),
    lastResetMonth: utcMonthKey(),
  });
  const { setPin, generateRecoveryPhrase, setRecoveryPhrase } = await import('../../../src/storage/settings');
  await setPin(PIN);
  const phrase = generateRecoveryPhrase();
  await setRecoveryPhrase(phrase);
  return { state, phrase };
}

beforeEach(() => { vi.resetModules(); });

describe('recovery phrase', () => {
  it('is 8 unambiguous characters in XXXX-XXXX form and differs per call', async () => {
    const { generateRecoveryPhrase } = await import('../../../src/storage/settings');
    const a = generateRecoveryPhrase();
    const b = generateRecoveryPhrase();
    expect(a).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    expect(a).not.toBe(b);
  });

  it('stores only a salted hash, never the phrase or its bare digest', async () => {
    const { state, phrase } = await seeded();
    const stored = state['fw_pin_recovery'] as string;
    expect(stored).toBeTypeOf('string');
    expect(stored).not.toContain(phrase);
    expect(stored).not.toContain(phrase.replace('-', ''));
    expect(stored).not.toBe(await sha256(phrase));
    expect(stored.startsWith('pbkdf2$')).toBe(true);
    expect(JSON.stringify(state)).not.toContain(phrase.replace('-', ''));
  });

  it('resets the PIN with the right phrase, accepting lowercase and a missing dash', async () => {
    const { phrase } = await seeded();
    const { resetPinWithRecoveryPhrase, verifyPin, hasRecoveryPhrase } = await import('../../../src/storage/settings');
    expect(await hasRecoveryPhrase()).toBe(true);
    expect(await resetPinWithRecoveryPhrase(phrase.toLowerCase().replace('-', ''), NEW_PIN)).toBe(true);
    expect(await verifyPin(PIN)).toBe(false);
    expect(await verifyPin(NEW_PIN)).toBe(true);
    // The phrase is not consumed: the parent keeps the one they wrote down.
    expect(await hasRecoveryPhrase()).toBe(true);
  });

  it('a wrong phrase does not reset the PIN and counts toward the lockout', async () => {
    const { state } = await seeded();
    const { resetPinWithRecoveryPhrase, verifyPin } = await import('../../../src/storage/settings');
    expect(await resetPinWithRecoveryPhrase('AAAA-AAAA', NEW_PIN)).toBe(false);
    expect(await verifyPin(NEW_PIN)).toBe(false);
    expect((state['fw_pin_attempts'] as { misses: number }).misses).toBe(2);
    expect(await verifyPin(PIN)).toBe(true);
  });

  it('refuses while the PIN gate is locked and when no phrase was ever set', async () => {
    const { state, phrase } = await seeded();
    const { resetPinWithRecoveryPhrase } = await import('../../../src/storage/settings');
    state['fw_pin_attempts'] = { misses: 6, lockedUntil: Date.now() + 60_000 };
    expect(await resetPinWithRecoveryPhrase(phrase, NEW_PIN)).toBe(false);
    delete state['fw_pin_attempts'];
    delete state['fw_pin_recovery'];
    expect(await resetPinWithRecoveryPhrase(phrase, NEW_PIN)).toBe(false);
  });

  it('rejects a malformed new PIN without touching the stored one', async () => {
    const { state, phrase } = await seeded();
    const before = state['parentPin'];
    const { resetPinWithRecoveryPhrase } = await import('../../../src/storage/settings');
    expect(await resetPinWithRecoveryPhrase(phrase, '12')).toBe(false);
    expect(state['parentPin']).toBe(before);
  });
});

describe('changePin', () => {
  it('needs the current PIN and then stores the new one', async () => {
    await seeded();
    const { changePin, verifyPin } = await import('../../../src/storage/settings');
    expect(await changePin('0000', NEW_PIN)).toBe(false);
    expect(await verifyPin(NEW_PIN)).toBe(false);
    expect(await changePin(PIN, NEW_PIN)).toBe(true);
    expect(await verifyPin(NEW_PIN)).toBe(true);
    expect(await verifyPin(PIN)).toBe(false);
  });
});
