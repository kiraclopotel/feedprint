// Regression C-2 — getSettings() must FAIL CLOSED on a read error.
//
// Before the fix, the catch block returned `_settingsCache ?? {...DEFAULTS}`.
// DEFAULTS is mode:'teen' with parentPin:'' — the LIGHTEST protection. So a
// transient chrome.storage read failure in a fresh realm (content script just
// injected, SW just woke) silently downgraded a Child-mode install to Teen
// and blanked the PIN posture, with the parent never told.
//
// For a child-safety product the safe failure direction is the STRONGEST
// protection, not the lightest. On a read error with no cache, getSettings
// must return Child mode with child feature toggles.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { childPreset } from '../../../src/storage/presets';

describe('getSettings — fail-closed on read error (C-2)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns Child mode (max protection) when storage.local.get rejects and no cache exists', async () => {
    const getReject = vi.fn().mockRejectedValue(new Error('storage IO error'));
    (globalThis as unknown as { chrome: unknown }).chrome = {
      storage: { local: { get: getReject, set: vi.fn().mockResolvedValue(undefined) } },
    };

    const { getSettings } = await import('../../../src/storage/settings');
    const settings = await getSettings();

    // Strongest protection, not the permissive teen DEFAULTS.
    expect(settings.mode).toBe('child');
    // Child feature toggles applied (e.g. the max-protection grid), not teen.
    expect(settings.features).toEqual(childPreset());
  });
});
