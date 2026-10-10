// House-rule re-scope (2026-06-10) — blanket profanity-softening gate.
//
// Locks the decision in .brain/DECISIONS.md 2026-06-10: child mode keeps
// blanket softening of register profanity; teen/adult default leaves it
// alone (31/36 teen-mode softenings on the real-feed corpus
// claude-feed-2026-06-09 acted on content fine for a teen); the parent
// `strictLanguage` setting restores blanket softening in any mode.
//
// The PREVIOUS rule ("ALL swearing SOFTENS" in teen mode) had no test —
// it lived only in a code comment, which is how it survived unmeasured
// for three weeks. This predicate is shared by the posts pipeline
// (pipeline.ts step 0b) and the comments path (index.ts flushBatch
// house-rule handling) so the two gates cannot drift.
//
// NOT governed by this gate (asserted here as a contract reminder via the
// slur tier): identity slurs hide/act at all ages regardless of
// strictLanguage — that floor lives in pipeline step 0a + the batch
// override gates, not in this predicate.

// 2026-08-10 (wiring Q4, mode-rails C1): the gate now reads the
// soften-swearing feature toggle plus strictLanguage instead of the mode
// wire. The 2026-06-10 ruling's SUBSTANCE is preserved through the presets
// (child default softens, teen/adult defaults do not, strictLanguage
// restores it anywhere) and asserted below through those presets, so the
// decision stays locked while the spend becomes the parent's switch.

import { describe, it, expect, vi } from 'vitest';
import { blanketProfanitySoften } from '../../../src/analysis/pipeline';
import { childPreset, teenPreset, adultPreset } from '../../../src/storage/presets';
import type { FWSettings, FeatureToggles } from '../../../src/storage/settings';

function withPreset(features: FeatureToggles, strictLanguage = false): FWSettings {
  return { features, strictLanguage } as unknown as FWSettings;
}

/** A fresh, empty chrome.storage.local: getSettings() falls through to DEFAULTS. */
function installEmptyStorageStub(): void {
  (globalThis as any).chrome = {
    storage: {
      local: {
        get: async () => ({}),
        set: async () => undefined,
      },
    },
  };
}

describe('blanketProfanitySoften — house-rule re-scope gate', () => {
  it('child DEFAULT always softens register profanity (preset seeds the toggle ON)', () => {
    expect(blanketProfanitySoften(withPreset(childPreset(), false))).toBe(true);
    expect(blanketProfanitySoften(withPreset(childPreset(), true))).toBe(true);
  });

  it('teen default leaves register profanity alone', () => {
    expect(blanketProfanitySoften(withPreset(teenPreset(), false))).toBe(false);
  });

  it('adult default leaves register profanity alone', () => {
    expect(blanketProfanitySoften(withPreset(adultPreset(), false))).toBe(false);
  });

  it('strictLanguage restores blanket softening in any preset', () => {
    expect(blanketProfanitySoften(withPreset(teenPreset(), true))).toBe(true);
    expect(blanketProfanitySoften(withPreset(adultPreset(), true))).toBe(true);
  });

  it('ships with strictLanguage OFF by default (a fresh install reads the real DEFAULTS)', async () => {
    vi.resetModules();
    installEmptyStorageStub();
    const { getSettings } = await import('../../../src/storage/settings');
    const settings = await getSettings();
    expect(settings.strictLanguage).toBe(false);
    delete (globalThis as any).chrome;
  });
});
