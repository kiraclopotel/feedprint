/** @vitest-environment jsdom */
//
// The popup told a parent "Child mode always softens swearing" and put a live
// switch underneath that turned it off.
//
// On 2026-09-19 the gate had no mode branch at all:
//
//   isFeatureEnabled(settings, 'soften-swearing', platform) || settings.strictLanguage
//
// A child install reached it only because `childPreset` seeds that switch ON,
// so a per-platform override, or a grid stored before that seeding, left
// swearing unmasked while the Strict-language row above painted ON and locked
// with the note "Child mode always softens swearing", and the soften-swearing
// row beneath it sat live and clickable. Two statements on one screen, and the
// clickable one won.
//
// That night the screen was made to keep the promise and the gate was left
// alone, because its docblock records a June decision, made on evidence, to be
// a switch rather than a mode wire. The residue was written into the register
// rather than hidden.
//
// The owner then closed it: a child install gets strict protection, since a
// parent would rather see swearing hidden whenever it is correctly caught.
// Child is now a rail. The evidence that retired the always-on
// TEEN rule is untouched and stays retired: 31 of 36 teen softenings acted on
// register profanity that was fine for a teen. This is the child cell only.
//
// So this file now holds three things: the rail, the locked rows that were the
// first fix and are still what a parent sees, and the sentences that must not
// go back to claiming more than the code does.

import { describe, expect, it } from 'vitest';
import { POPUP_STRINGS } from '../../../../src/i18n/popup-strings';
import { childPreset, teenPreset, adultPreset } from '../../../../src/storage/presets';
import { blanketProfanitySoften } from '../../../../src/analysis/pipeline';
import { readSource } from '../../../helpers/read-source';
import type { FWSettings } from '../../../../src/storage/settings';

const withGrid = (mode: string, features: ReturnType<typeof childPreset>, strict = false): FWSettings =>
  ({ mode, features, strictLanguage: strict } as unknown as FWSettings);

describe('the child swearing promise is kept (2026-09-19)', () => {
  it('child mode softens swearing whatever the switch says', () => {
    // Since 2026-09-20 Child is a rail: the switch cannot turn it off, on the
    // owner's word that a parent would rather see a swear word over-hidden.
    const off = { ...childPreset(), 'soften-swearing': { enabled: false } } as ReturnType<typeof childPreset>;
    expect(blanketProfanitySoften(withGrid('child', off)), 'the switch no longer decides in child').toBe(true);
    expect(blanketProfanitySoften(withGrid('child', childPreset()))).toBe(true);
    expect(blanketProfanitySoften(withGrid('adult', adultPreset())), 'and adult is off by default').toBe(false);
    expect(blanketProfanitySoften(withGrid('teen', teenPreset(), true)), 'strict language reaches it in any mode').toBe(true);
  });

  it('the child preset seeds the switch on, or nothing softens for a child at all', () => {
    expect(childPreset()['soften-swearing'].enabled).toBe(true);
  });

  it('Child mode locks the switch a child could otherwise flip', () => {
    const src = readSource('src/ui/popup/panels/SettingsPanel.tsx');
    // One switch for swearing since 11 Oct 2026 (one-switch-for-swearing.test.tsx): locked in Child mode only.
    expect(src, 'the row is disabled in child mode').toContain('disabled={childMode}');
    expect(src, 'and its click does nothing there').toContain('onClick={() => { if (!childMode) void toggleMask(); }}');
    expect(src, 'and it reads as on').toContain("on={childMode || settings.strictLanguage || isFeatureEnabled(settings, 'soften-swearing')}");
  });

  it('no language went back to the shorter promise the screen cannot show', () => {
    for (const [lang, t] of Object.entries(POPUP_STRINGS)) {
      // The Strict language row and its note left on 11 Oct 2026; the mask's note is the one a parent reads.
      const note = (t as unknown as { softenSwearingDescChild: string }).softenSwearingDescChild;
      expect(typeof note, lang).toBe('string');
      expect(note, `${lang} dropped the locked-switch half`).not.toMatch(/always softens|always soften|atenuează întotdeauna|siempre suaviza|sempre suaviza/i);
      expect(note, lang).not.toContain('—');
    }
  });

  it('every language explains why the row is locked', () => {
    for (const [lang, t] of Object.entries(POPUP_STRINGS)) {
      const note = (t as unknown as { softenSwearingDescChild: string }).softenSwearingDescChild;
      expect(typeof note, lang).toBe('string');
      expect(note.length, `${lang}`).toBeGreaterThan(10);
    }
  });

  it('neither comment describes the gate as it was before the rail', () => {
    for (const path of ['src/analysis/pipeline.ts', 'src/ui/popup/panels/SettingsPanel.tsx']) {
      expect(readSource(path), `${path}`).not.toContain('Child mode always softens register profanity');
    }
  });
});
