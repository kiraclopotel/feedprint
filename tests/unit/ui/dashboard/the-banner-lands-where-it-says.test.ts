// Two defects found on a live install, 2026-09-19, with one shape between them:
// a control that names an act it does not perform.
//
// The banner's button said "Back up now" and called setTab('export'), which
// backs nothing up and drops the reader at the top of a long tab with the
// backup card most of the way down it. The name field committed on blur and on
// Enter, both of which work and neither of which is visible, so a person who
// typed a name had no way to tell whether it had taken.
//
// Neither was a crash, neither failed a test, and both are the kind of thing
// only somebody actually using the product finds. These cases hold the fixes:
// the label says where the press goes, the press carries a landing target, and
// the field has a button whose disabled state doubles as the answer to "did
// that save?".

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT as ROOT } from '../../../helpers/repo-root';
import { DASHBOARD_STRINGS } from '../../../../src/i18n/dashboard-strings';

const EXPORT_TAB = readFileSync(join(ROOT, 'src/ui/dashboard/components/ExportTab.tsx'), 'utf8');
const DASHBOARD = readFileSync(join(ROOT, 'src/ui/dashboard/Dashboard.tsx'), 'utf8');
function landOnEffect(): string {
  const start = EXPORT_TAB.indexOf("if (landOn !== 'backup') return;");
  const end = EXPORT_TAB.indexOf('}, [landOn]);', start);
  return EXPORT_TAB.slice(start, end);
}

const LANGS = ['en', 'ro', 'es', 'pt-BR'] as const;

describe('the backup banner lands on the button that does it (2026-09-19)', () => {
  it('the action carries a landing target, not just a tab change', () => {
    expect(DASHBOARD, 'the banner asks for the backup card by name')
      .toContain("setExportLandOn('backup'); setTab('export')");
    expect(EXPORT_TAB, 'and the tab takes it').toContain("landOn?: 'backup' | null");
  });

  it('scrolls the backup button into view and puts the cursor on it', () => {
    const effect = landOnEffect();
    expect(effect).toContain('scrollIntoView');
    expect(effect, 'centred, because the default hides the sentence above the card')
      .toContain("block: 'center'");
    expect(effect, 'focus follows, so the next keypress is the backup').toContain('.focus(');
  });

  it('does not press it for them', () => {
    // A banner takes somebody to the thing. Backing up without being asked would
    // also write a file to their disk on a tab change, which is not a thing a
    // notice gets to decide.
    const effect = landOnEffect();
    expect(effect).not.toContain('.click()');
    expect(DASHBOARD, 'and it still never says Done, because nothing is fixed yet')
      .toContain("setExportLandOn('backup'); setTab('export'); return false;");
  });

  it('the landing is forgotten when the reader leaves the tab', () => {
    // Otherwise every later visit to Export yanks them back down to the backup.
    expect(DASHBOARD).toContain("if (tab !== 'export') setExportLandOn(null);");
  });

  it('the label no longer promises an act the press does not perform', () => {
    for (const lang of LANGS) {
      const label = DASHBOARD_STRINGS[lang].attnBackupFailingAction;
      expect(label.length, `${lang} has a label`).toBeGreaterThan(3);
    }
    expect(DASHBOARD_STRINGS.en.attnBackupFailingAction, 'English says where it goes')
      .toBe('Take me to the backup');
    expect(DASHBOARD_STRINGS.en.attnBackupFailingAction).not.toBe('Back up now');
  });
});

describe('the name field has a button (2026-09-19)', () => {
  it('there is one, and it commits the same way Enter did', () => {
    const block = EXPORT_TAB.slice(EXPORT_TAB.indexOf('data-testid="profile-name-save"'));
    expect(block).toContain('void commitProfileName()');
  });

  it('it is off while there is nothing to save, so the button reports the state', () => {
    const block = EXPORT_TAB.slice(EXPORT_TAB.indexOf('data-testid="profile-name-save"'));
    expect(block).toContain("disabled={profileName.trim() === (profileSavedName ?? '')}");
  });

  it('blur and Enter still work, so nobody who learned the old way loses it', () => {
    expect(EXPORT_TAB).toContain('onBlur={() => { void commitProfileName(); }}');
    expect(EXPORT_TAB).toContain("if (e.key === 'Enter')");
  });

  it('every language has the word on the button', () => {
    for (const lang of LANGS) {
      const label = DASHBOARD_STRINGS[lang].profileNameSave;
      expect(label, `${lang} names the button`).toBeTruthy();
      expect(label.length, `${lang} is a word, not a sentence`).toBeLessThan(24);
    }
  });

  it('wears a class the stylesheet actually defines', () => {
    // The first version used `fw-btn`, which nothing defines: an unstyled button
    // is its own small version of this same defect.
    const block = EXPORT_TAB.slice(EXPORT_TAB.indexOf('data-testid="profile-name-save"') - 200);
    expect(block).toContain('className="btn"');
    const css = readFileSync(join(ROOT, 'src/ui/dashboard/dashboard-design.css'), 'utf8');
    expect(css, 'and the stylesheet has it').toMatch(/^\.btn\b/m);
  });
});
