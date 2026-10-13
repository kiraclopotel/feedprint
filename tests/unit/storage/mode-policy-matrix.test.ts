// Mode effective-policy matrix — the tested truth table the BOARD's
// mode-audit line demanded (2026-07-12): mode posture, feature preset, and
// analyzer consent are THREE SEPARATE AXES. This file locks the axis
// boundaries so a future change that tangles them fails here first.
// Plain-language companion: docs/history/reality/MODE_POLICY_MATRIX.md.

import { describe, it, expect } from 'vitest';
import { applyPreset, ALL_FEATURE_IDS, type FeatureToggles } from '../../../src/storage/settings';
import { blanketProfanitySoften } from '../../../src/analysis/pipeline';

const MODES = ['child', 'teen', 'adult'] as const;

describe('axis 1 — selecting a mode reapplies ONLY the feature grid', () => {
  it('applyPreset returns exactly { features, presets } and nothing else', () => {
    for (const mode of MODES) {
      const patch = applyPreset(mode);
      expect(Object.keys(patch).sort()).toEqual(['features', 'presets']);
    }
  });

  it('never touches the consent scalars or strict language (inheritance lock)', () => {
    for (const mode of MODES) {
      const patch = applyPreset(mode) as Record<string, unknown>;
      expect(patch).not.toHaveProperty('strictLanguage');
      expect(patch).not.toHaveProperty('dailyCap');
      expect(patch).not.toHaveProperty('parentPin');
    }
  });

  it('reseeds every feature toggle on every mode change (no partial grids)', () => {
    for (const mode of MODES) {
      const { features } = applyPreset(mode);
      for (const id of ALL_FEATURE_IDS) {
        expect(features).toHaveProperty(id);
      }
    }
  });

  it('pins the preset grids (the seeded defaults per mode)', () => {
    const enabledIds = (features: FeatureToggles): string[] =>
      ALL_FEATURE_IDS.filter((id) => {
        const f = (features as Record<string, { enabled?: boolean } | boolean | undefined>)[id];
        return typeof f === 'object' && f !== null ? f.enabled === true : f === true;
      }).sort();

    const child = enabledIds(applyPreset('child').features);
    const teen = enabledIds(applyPreset('teen').features);
    const adult = enabledIds(applyPreset('adult').features);

    // Monotone strictness: adult ⊆ teen ⊆ child. The marker is a view, not a protection: Silent shows the calm version
    // with no dot to press, so it starts off there while Calm and Open start with it on.
    for (const id of adult) expect(teen).toContain(id);
    for (const id of teen.filter((x) => x !== 'show-reframe-markers')) expect(child).toContain(id);
    expect(child).not.toContain('show-reframe-markers');
    expect(teen).toContain('show-reframe-markers');
    // The known deltas (presets.ts): teen drops these from child's grid...
    for (const id of ['hide-action-buttons', 'block-comment-posting', 'block-reels']) {
      expect(child).toContain(id);
      expect(teen).not.toContain(id);
    }
    // ...and adult keeps only the reading aids + ad hygiene, plus the two
    // toggles that are enabled in every mode because they carry a value and
    // do nothing until the parent fills it: the analysis-capacity count and
    // the parent's own blocklist (empty by default, so enabling it is a
    // no-op — see storage/presets.ts and core/parent-blocklist.ts).
    expect(adult).toEqual(
      [
        'block-ads',
        'comments-to-analyze-per-video',
        'parent-blocklist',
        'rewritten-comments-first',
        'show-reframe-markers',
        // W44 (Q2): the calmer-rewrite spend tier is ON in every preset so
        // defaults are unchanged; the switch exists so the spend has an owner.
        'reframe-rewrites',
      ].sort(),
    );
  });
});

describe('axis 2 — mode-posture hard rails (branch on mode directly)', () => {
  it('blanket profanity soften: soften-swearing toggle (child preset ON) or strict language (Q4 conversion)', () => {
    // Converted from a mode wire to a switch (wiring Q4, mode-rails C1):
    // the DEFAULTS are equivalent to the old matrix because the child preset
    // seeds the toggle ON and teen/adult seed it OFF, but the spend is now
    // the parent's switch, not the mode's.
    const withToggle = (enabled: boolean, strictLanguage: boolean) => ({
      features: { 'soften-swearing': { enabled } },
      strictLanguage,
    }) as unknown as Parameters<typeof blanketProfanitySoften>[0];
    // Old child default (preset seeds ON) and old teen/adult defaults (OFF):
    expect(blanketProfanitySoften(withToggle(true, false))).toBe(true);
    expect(blanketProfanitySoften(withToggle(false, false))).toBe(false);
    // strictLanguage implies the soften regardless of the toggle:
    expect(blanketProfanitySoften(withToggle(false, true))).toBe(true);
  });
});
