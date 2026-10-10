// The dashboard chrome must not move when you change tabs.
//
// An outside reviewer opened the dashboard for the first time on 2026-08-21
// and the first thing he named was the buttons changing places as he clicked
// between the top tabs. He was right, and the cause was five CSS rules that
// scoped the header or the tab bar to `[data-tab="activity"]`: a full-bleed
// header and a 960px static tab bar above 1840px, plus a left-align and two
// width overrides below it. On Activity the logo, the health pill and the
// whole tab bar sat somewhere else than on every other tab.
//
// None of them was a mistake when written. Each aligned the chrome to the
// content beneath it on ONE tab, at a moment when only that tab was on
// screen. The defect is not in any single rule, it is that nobody was ever
// looking at the transition. A comment saying "keep the chrome stable" would
// not have caught it, because the rules that broke it were each added
// deliberately and locally. So the invariant is executable instead:
//
//   No rule may scope `.dash-header-inner` or `.dash-tabs` to a `data-tab`
//   value. The header and the tab bar are the same on every tab; only the
//   content BELOW them changes shape.
//
// Per-tab content width is untouched and stays legal: `.dash-shell`,
// `.activity-grid`, `.ov-shell` and friends may vary freely, because they
// live below the chrome and every shell variant is centred, so the chrome
// centred inside them lands in the same place.

import { describe, expect, it } from 'vitest';
import { readSource } from '../../../helpers/read-source';
import { repoPath } from '../../../helpers/repo-root';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const CSS_PATH = 'src/ui/dashboard/dashboard-design.css';

// Strip /* ... */ comments so the prose in this file's own explanatory notes
// (which necessarily names the forbidden selectors) can never trip the check.
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

// A selector list is everything before a `{`. Split on commas so one bad
// selector inside a group is still caught.
function selectors(css: string): string[] {
  const out: string[] = [];
  for (const match of css.matchAll(/([^{}]+)\{/g)) {
    const head = match[1].trim();
    if (!head || head.startsWith('@')) continue;
    for (const part of head.split(',')) {
      const s = part.trim();
      if (s) out.push(s);
    }
  }
  return out;
}

const CHROME = ['.dash-header-inner', '.dash-tabs'];

describe('dashboard chrome is invariant across tabs', () => {
  const css = stripComments(readSource(CSS_PATH));
  const all = selectors(css);

  it('reads a stylesheet that actually parses into selectors', () => {
    // Guard the guard: a regex that silently matched nothing would make every
    // assertion below pass forever.
    expect(all.length).toBeGreaterThan(200);
    expect(all.some(s => s.includes('.dash-tabs'))).toBe(true);
    expect(all.some(s => s.includes('.dash-header-inner'))).toBe(true);
  });

  for (const part of CHROME) {
    it(`never scopes ${part} to a data-tab value`, () => {
      const offenders = all.filter(s => s.includes(part) && s.includes('data-tab'));
      expect(
        offenders,
        `${part} must look the same on every tab. Offending selector(s):\n  ${offenders.join('\n  ')}\n`
        + 'Change the content below the chrome instead, not the chrome.',
      ).toEqual([]);
    });
  }

  it('keeps the one base rule that centres the tab bar', () => {
    // The fix relies on this: fit-content + auto margins inside a centred
    // shell puts the bar in the same screen position at every shell width.
    const base = css.match(/\.dash-tabs\s*\{[^}]*\}/);
    expect(base).not.toBeNull();
    expect(base![0]).toMatch(/margin:\s*12px auto 0/);
    expect(base![0]).toMatch(/width:\s*fit-content/);
  });

  it('keeps the header inner centred at one width', () => {
    const header = css.match(/\.dash-header-inner\s*\{[^}]*\}/);
    expect(header).not.toBeNull();
    expect(header![0]).toMatch(/max-width:\s*1320px/);
    expect(header![0]).toMatch(/margin:\s*0 auto/);
  });
});
