// Untranslated-leftover scan.
//
// Key parity is compiler-guaranteed, so the failure mode a new language can
// still have is a VALUE leak: a key copied from EN and never translated. Some
// values are correctly identical across languages (product names, "OK",
// "Reels", "%1×"), so the check is a budget on the share of identical string
// values per table, not a per-key assertion.
//
// Measured 2026-09-04, the day Spanish and Brazilian Portuguese landed:
// dashboard 3/638 (es), 5/638 (pt-BR), 7/638 (ro); export 4/331, 4/331,
// 3/331; popup 1/233, 1/233, 6/233; marker 0. The worst is 2.6%, so 5% is
// headroom for legitimate shared tokens and nowhere near a copied block.

import { describe, it, expect } from 'vitest';
import { UI_LANGUAGES } from '../../../src/i18n';
import { POPUP_STRINGS } from '../../../src/i18n/popup-strings';
import { DASHBOARD_STRINGS } from '../../../src/i18n/dashboard-strings';
import { MARKER_STRINGS } from '../../../src/i18n/marker-strings';
import { I18N } from '../../../src/forensics/html-export';

const TRANSLATED = UI_LANGUAGES.filter((l) => l !== 'en');

/** Share of plain-string keys whose value is byte-identical to the EN value. */
function identicalShare(
  en: Record<string, unknown>,
  other: Record<string, unknown>,
): { share: number; total: number; same: string[] } {
  const same: string[] = [];
  let total = 0;
  for (const [key, value] of Object.entries(en)) {
    if (typeof value !== 'string') continue;
    total += 1;
    if (other[key] === value) same.push(key);
  }
  return { share: same.length / Math.max(1, total), total, same };
}

describe.each([
  ['popup', POPUP_STRINGS as unknown as Record<string, Record<string, unknown>>, 0.05],
  ['dashboard', DASHBOARD_STRINGS as unknown as Record<string, Record<string, unknown>>, 0.05],
  ['marker', MARKER_STRINGS as unknown as Record<string, Record<string, unknown>>, 0.05],
  ['export', I18N as unknown as Record<string, Record<string, unknown>>, 0.05],
])('%s table has no untranslated block', (name, table, budget) => {
  it.each(TRANSLATED)(`%s differs from en on all but a few shared tokens`, (lang) => {
    const { share, total, same } = identicalShare(table.en, table[lang]);
    expect(total, `${name} has no string keys to check`).toBeGreaterThan(20);
    expect(
      share,
      `${name}.${lang}: ${same.length}/${total} values identical to EN, e.g. ${same.slice(0, 8).join(', ')}`,
    ).toBeLessThan(budget);
  });
});
