// The popup's small text buttons (the mode switch's confirm and cancel, the licence's remove and cancel) carry the
// class iconbtn, and Reset to standard is a text link on its own line (class lnk). Its only rule was scoped to .in-row, so everywhere else they drew as the browser's
// white default on the dark popup; a store picture of Settings showed it.

import { describe, expect, it } from 'vitest';
import { readSource } from '../../../helpers/read-source';

const SHEET = readSource('src/ui/popup/popup-design.css');

describe('the small buttons have a style', () => {
  it('.iconbtn has a rule of its own, not only inside .in-row', () => {
    expect(SHEET).toMatch(/^\.iconbtn\s*\{[^}]*background:\s*var\(--fw-card\)/m);
  });

  it('Reset to standard is a styled text link', () => {
    expect(readSource('src/ui/popup/panels/SettingsPanel.tsx')).toMatch(/className="lnk"[^>]*onClick=\{modeSwitch\.requestReset\}/);
    expect(SHEET).toMatch(/^\.lnk\s*\{[^}]*color:\s*var\(--fw-teal\)/m);
  });
});
