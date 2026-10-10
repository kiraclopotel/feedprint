// The popup's tab bar announced itself as tabs controlling panels that did not
// exist.
//
// `PopTabBar` was given `role="tablist"`, `role="tab"`, `aria-selected` and
// `aria-controls` on 2026-09-18, because before that it looked like a tab bar
// and was a row of plain buttons with a teal fill for state, which is colour
// alone. Its own comment then said, in the file: "Popup.tsx itself (not owned
// here) still needs role='tabpanel' on the two panels these ids point at."
//
// It never got them. So both `aria-controls` pointed at ids that were nowhere
// in the document. To a screen reader that is worse than the plain buttons it
// replaced: a reader is told a relationship, follows it, and lands on nothing.
// The dashboard closed exactly this gap the same day; the popup was not
// carried.
//
// Found 2026-09-19. This reads the source rather than rendering, because the
// pairing is a fact about two files, and the defect was precisely that the file
// holding one end could pass every test of its own.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from '../../../helpers/repo-root';

const read = (rel: string): string => readFileSync(join(REPO_ROOT, rel), 'utf8');

/** Every id an aria-controls names, and every id the document defines. */
function idsIn(src: string): { controlled: string[]; defined: string[] } {
  const controlled = [...src.matchAll(/aria-controls="([^"]+)"/g)].map((m) => m[1]);
  const defined = [...src.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
  return { controlled, defined };
}

describe('the popup tab bar points at something (2026-09-19)', () => {
  it('every aria-controls in the tab bar names a panel the popup renders', () => {
    const bar = idsIn(read('src/ui/popup/panels/header.tsx'));
    const popup = idsIn(read('src/ui/popup/Popup.tsx'));
    expect(bar.controlled.length, 'the bar controls something at all').toBeGreaterThanOrEqual(2);
    const missing = bar.controlled.filter((id) => !popup.defined.includes(id));
    expect(
      missing,
      missing.length === 0 ? '' :
        `the tab bar says it controls ${missing.join(', ')}, and nothing in Popup.tsx has those ids. ` +
        'A reader is told a relationship and cannot follow it, which is worse than no relationship.',
    ).toEqual([]);
  });

  it('each of those panels is a tabpanel, labelled by its own tab', () => {
    const src = read('src/ui/popup/Popup.tsx');
    for (const [panel, tab] of [['pop-tabpanel-home', 'pop-tab-home'], ['pop-tabpanel-keys', 'pop-tab-keys']]) {
      const el = src.match(new RegExp(`<div id="${panel}"[^>]*>`))?.[0] ?? '';
      expect(el, `${panel} is rendered`).not.toBe('');
      expect(el, `${panel} says what it is`).toContain('role="tabpanel"');
      expect(el, `${panel} is announced by the word the person pressed`).toContain(`aria-labelledby="${tab}"`);
      // Without this a keyboard cannot reach the panel after the tab, which is
      // the whole point of pairing them.
      expect(el, `${panel} can be reached`).toContain('tabIndex={0}');
    }
  });

  it('the tab bar still carries its own half', () => {
    // The control. Half a pairing is what this file exists to catch, in either
    // direction: a panel with no tab is as broken as a tab with no panel.
    const bar = read('src/ui/popup/panels/header.tsx');
    expect(bar).toContain('role="tablist"');
    expect((bar.match(/role="tab"/g) ?? []).length, 'both tabs are marked').toBeGreaterThanOrEqual(2);
    expect(bar, 'and state is not colour alone').toContain('aria-selected=');
  });

  it("the file's own note no longer asks for what is now there", () => {
    // A comment asking for work already done sends the next reader to do it
    // again, and this one named the exact thing that was missing for a day.
    expect(read('src/ui/popup/panels/header.tsx'))
      .not.toContain('still needs role="tabpanel"');
  });
});
