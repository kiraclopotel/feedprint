// A stored level nobody can read used to be copied as it was, and levelOf() turned anything that was
// not 'child' or 'teen' into Relaxed: a damaged or foreign value opened the door to the loosest
// level. The read now narrows it through coerceLegacyMode, which has answered 'teen' (Moderate) for an
// unknown value since DEC-015. The three real values read as they are, and the stored value itself
// is never rewritten (L5: the ids stay).

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { levelOf } from '../../../src/types/mode';

function chromeWith(stored: Record<string, unknown>) {
  const set = vi.fn().mockResolvedValue(undefined);
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: { local: { get: vi.fn().mockResolvedValue(stored), set } },
  };
  return set;
}

describe('getSettings reads a stored level it does not know as Moderate', () => {
  beforeEach(() => { vi.resetModules(); });

  it.each([['xyz'], [''], ['ADULT'], ['kid'], [42], [null], [{ mode: 'adult' }]])(
    'a stored mode of %j reads as teen, which is the Moderate level',
    async (bad) => {
      chromeWith({ mode: bad, settingsSchemaVersion: '14' });
      const { getSettings } = await import('../../../src/storage/settings');
      const s = await getSettings();
      expect(s.mode).toBe('teen');
      expect(levelOf(s.mode)).toBe('moderate');
    },
  );

  it.each([['child', 'strict'], ['teen', 'moderate'], ['adult', 'relaxed']] as const)(
    'a stored %s reads unchanged, as %s',
    async (mode, level) => {
      chromeWith({ mode, settingsSchemaVersion: '14' });
      const { getSettings } = await import('../../../src/storage/settings');
      const s = await getSettings();
      expect(s.mode).toBe(mode);
      expect(levelOf(s.mode)).toBe(level);
    },
  );

  it('reads a fresh install (nothing stored) as it did, with the Moderate default', async () => {
    chromeWith({});
    const { getSettings } = await import('../../../src/storage/settings');
    const s = await getSettings();
    expect(s.mode).toBe('teen');
  });

  it('never writes the mode back: the stored value stays what it was', async () => {
    const set = chromeWith({ mode: 'xyz', settingsSchemaVersion: '14' });
    const { getSettings } = await import('../../../src/storage/settings');
    await getSettings();
    expect(set.mock.calls.some(([arg]) => 'mode' in (arg as Record<string, unknown>))).toBe(false);
  });
});
