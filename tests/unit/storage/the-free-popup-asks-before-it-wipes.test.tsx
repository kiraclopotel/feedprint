/** @vitest-environment jsdom */
//
// One tap on Child, Teen or Adult in the free popup threw away everything the
// person had typed, with no prompt and no message.
//
// `pickMode` called `applyPreset(m)` and `saveSettings({ features })`, and that
// write replaces the whole `features` key. The preset hard-codes
// `parent-blocklist` back to `{ words: [], phrases: [], accounts: [] }` and
// `media-timeout` back to off, so the tap deleted:
//
//   every word, phrase and account in the Rules editor;
//   every account blocked with "Block this", which writes to the same place;
//   the quiet-hours schedule;
//   every per-platform break.
//
// The pick list stayed on screen afterwards, because it lives under its own
// top-level key, so the popup looked untouched while the rules behind it were
// gone.
//
// The machine that prevents this already existed and the other popup already
// used it: `useModeSwitch`, which confirms when a switch would reset anything
// and demands the PIN when a child's install is leaving Child mode inside the
// fifteen-minute grace window. `applyModePreset` beside it carries the comment
// "Shared by both popups", which was a description of an intention.
//
// Found 2026-09-19 by a read-only scout over the Off product, verified against
// the write path before anything moved.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from '../../helpers/repo-root';
import { applyPreset } from '../../../src/storage/settings';
import { modeSwitchResetsToggles, modeSwitchRequiresPin, resolveModeClick } from '../../../src/ui/popup/switches';
import type { FeatureToggles } from '../../../src/storage/settings';

const read = (rel: string): string => readFileSync(join(REPO_ROOT, rel), 'utf8');

/** A free install with rules typed in, quiet hours set, and one break on. */
function anInstallWithRules(): FeatureToggles {
  const features = applyPreset('teen').features;
  return {
    ...features,
    'parent-blocklist': {
      enabled: true,
      value: { words: ['gateword'], phrases: ['flat earth'], accounts: ['@someone'] },
    },
    'media-timeout': {
      enabled: true,
      value: { schedule: [{ days: [1, 2, 3], startMin: 22 * 60, endMin: 7 * 60 }] },
      perPlatform: { tiktok: { enabled: true } },
    },
  } as unknown as FeatureToggles;
}

describe('the free popup asks before it wipes (2026-09-19)', () => {
  it('the preset really does throw the rules away, which is the whole reason for the prompt', () => {
    // Stated as a measurement, not as a claim about intent. The preset is right
    // to be a clean slate; what was missing is anybody being told.
    const before = anInstallWithRules();
    const after = applyPreset('adult').features as unknown as Record<string, { value?: { words?: string[] } }>;
    expect((before as unknown as Record<string, { value: { words: string[] } }>)['parent-blocklist'].value.words)
      .toEqual(['gateword']);
    expect(after['parent-blocklist'].value?.words, 'the preset hands back empty lists').toEqual([]);
    expect(modeSwitchResetsToggles(before, 'adult'), 'so the switch is destructive here').toBe(true);
  });

  it('a switch that would reset anything asks first', () => {
    expect(resolveModeClick({ mode: 'teen', features: anInstallWithRules() }, 'adult')).toBe('confirm');
  });

  it('a switch that would change nothing applies in one tap', () => {
    // The other half, and narrower than it first looks. The three presets are
    // genuinely different grids, so a switch between modes normally DOES change
    // something and normally does ask. The silent path is the one where the
    // grid already equals the target preset: somebody whose switches are the
    // adult set, on a profile still marked teen, loses nothing by saying so.
    //
    // The first draft of this case used an untouched teen grid and expected
    // 'apply', which was a guess about the presets rather than a reading of
    // them. They differ, so it asked, and it was right to.
    const alreadyAdultGrid = applyPreset('adult').features;
    expect(resolveModeClick({ mode: 'teen', features: alreadyAdultGrid }, 'adult')).toBe('apply');
    // Teen and adult now differ only in switches Receipts no longer has, so a child grid stands in.
    expect(resolveModeClick({ mode: 'teen', features: applyPreset('child').features }, 'adult'),
      'and a grid that differs in a switch Receipts has is not that case').toBe('confirm');
  });

  it('leaving Child with a PIN set demands the PIN, grace window or not', () => {
    expect(modeSwitchRequiresPin({ mode: 'child', parentPin: 'hashed' }, 'adult')).toBe(true);
    expect(modeSwitchRequiresPin({ mode: 'child', parentPin: 'hashed' }, 'child'), 'staying is not a downgrade').toBe(false);
    expect(modeSwitchRequiresPin({ mode: 'teen', parentPin: 'hashed' }, 'adult'), 'and neither is teen to adult').toBe(false);
  });

  it('the free popup has no preset row, so it cannot write a preset at all', () => {
    // Off's popup dropped Child, Teen and Adult: it asks nothing about who uses
    // the browser. With no row there is no tap that could wipe the rules.
    const src = read('src/products/off/popup/OffPopup.tsx');
    expect(src, 'no segments').not.toContain('mode-seg-btn');
    expect(src, 'no mode machine').not.toContain('useModeSwitch');
    // The line the defect was: applying a preset straight from this file.
    expect(src, 'nothing here applies a preset by hand').not.toContain('applyPreset(');
    // One mode write is allowed, and only this one: turning swearing off on an install saved as
    // Child moves it to Adult with swearing off and leaves the grid alone (off-popup.test.tsx).
    const LEAVE_CHILD = "saveSettings({ mode: 'adult', strictLanguage: false })";
    expect(src.split(LEAVE_CHILD).length - 1, 'the one way out of Child').toBe(1);
    expect(src.replace(LEAVE_CHILD, ''), 'and no other mode write').not.toMatch(/saveSettings\(\{[^}]*\bmode\b/);
  });

  it("the shared helper's comment says which popup uses it", () => {
    // It once claimed "Shared by both popups" while one popup was not using
    // it; a wrong comment is worse than none, so this one is held to the code.
    const src = read('src/ui/popup/switches.ts');
    expect(src).toContain("Off's popup has none, so nothing there applies a preset");
    expect(src).not.toContain('Shared by both popups');
  });
});
