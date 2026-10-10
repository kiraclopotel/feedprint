// The first-run screen for an adult (14 Sep 2026): no PIN, no phrase, one
// button. Until this, "setup done" meant "a PIN exists", so every install
// had to type a PIN before the popup would open, and a fresh install after a
// reinstall was sent back to the wizard on every click until it did. The
// owner's father, over 70, could not get through it. The popup shell is
// locked by source reads, the idiom of the dashboard's own locks; the
// settings half is exercised for real.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { POPUP_STRINGS } from '../../../src/i18n/popup-strings';

// The wizard has its own file since PLAN-2026-09-16 item 10.3, and the shell decides which screen
// opens. Both are read, so the scan does not care which of the two a line sits in.
const POPUP_PATHS = ['src/ui/popup/panels/SetupWizard.tsx', 'src/ui/popup/Popup.tsx'];
const popup = POPUP_PATHS.map((p) => readFileSync(join(process.cwd(), p), 'utf8')).join('\n');
// The field is declared in the shape file and defaulted in settings.ts, split apart by
// PLAN-2026-09-16 item 10.3. Both are read so neither half can go missing unnoticed.
const settingsShape = readFileSync(join(process.cwd(), 'src/storage/settings-shape.ts'), 'utf8');
const settings = readFileSync(join(process.cwd(), 'src/storage/settings.ts'), 'utf8');

describe('first run for an adult: nothing to type', () => {
  it('setupDone exists, defaults to false, and is persisted', () => {
    expect(settingsShape).toMatch(/setupDone\?: boolean;/);
    expect(settings).toMatch(/\n  parentPin: '',\n  setupDone: false,\n/);
    expect(settings).toMatch(/'parentPin', 'setupDone',/);
  });

  it('the popup opens on the main screen once setup is done, or when a PIN exists from before', () => {
    expect(popup).toContain("setScreen(s.setupDone || s.parentPin || parentPinUnknown(s) ? 'main' : 'setup')");
    expect(popup).not.toContain("setScreen(s.parentPin ? 'main' : 'setup')");
  });

  it('Adult finishes on the mode step with one button and sets no PIN; Child and Teen still set one', () => {
    expect(popup).toContain('data-testid="setup-start-free"');
    expect(popup).toContain("mode === 'adult'\n            ? <button");
    expect(popup).toContain("if (mode !== 'adult' && pinDigits.length === 4) {");
    expect(popup).toContain('await saveSettings({ setupDone: true });');
    // finishSetup is declared before the step renders, so step 1 can call it.
    expect(popup.indexOf('const finishSetup = async')).toBeLessThan(popup.indexOf('if (step === 0) {'));
  });

  it('says so in every language', () => {
    for (const locale of Object.keys(POPUP_STRINGS) as Array<keyof typeof POPUP_STRINGS>) {
      const t = POPUP_STRINGS[locale];
      expect(t.setupAdultNoPin.length, `${locale}`).toBeGreaterThan(40);
      expect(t.setupStartFree.length, `${locale}`).toBeGreaterThan(2);
    }
  });
});
