// The polish program's popup U1 (12 Oct 2026, POLISH-BACKLOG-2026-10-12.md, "## Feedprint popup"), measured in a built
// popup at 396x600 in looks A, B and D, dark and light (crew/visuals/pu1-before and pu1-after).
// 1. The product's name was the smallest text in its header (10.5 px type, a 5.25 px byline at 60%).
// 2. The header plate stood 6 px inside the frame line: a second rounded frame inside the first.
// 3. Look D's header ended in a hard line across the window.
// 10. D's day card edge was the dimmest edge in D.
// 31. The raised Home tab's edge was under 3:1 in every look.
// 35. The gear sat 6.5 px further in than the logo.
// And the two home stops that drew the browser's 1 px ring, and the last half-step size.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const src = (f: string) => readFileSync(new URL(`../../../../src/ui/${f}`, import.meta.url), 'utf8');

describe('popup U1: the header, the tabs and the day card after the read of 12 Oct 2026', () => {
  it('1: the name is the header’s largest word and the byline can be read', () => {
    const brand = src('shared/brand.tsx');
    expect(brand).toMatch(/x="74" y="31"\n[^\n]*\n\s*fontSize="30" fontWeight="600"/);
    expect(brand).toMatch(/fontSize="19" fontWeight="500" letterSpacing="0\.2"\n\s*fill="currentColor" opacity="0\.8"/);
  });

  it('2 and 35: the header plate meets the frame line; the lockup keeps its place; the gear lines up', () => {
    const css = src('popup/popup-panel.css');
    expect(css).toMatch(/box-shadow: none; padding: 0 0 6px; overflow: visible;/);
    expect(css).toMatch(/\.fw-popup \.pop-header \{ margin: 1px 1px 0; border-radius: calc\(11px/);
    expect(css).toMatch(/\.pop-header \{ padding-left: calc\(var\(--pop-edge\) - 1px\); padding-right: calc\(var\(--pop-edge\) - 1px\); padding-top: calc\(var\(--pop-2\) \+ 7px\); \}/);
    expect(css).toMatch(/\.fw-popup \.pop-header \.hdr-iconbtn:last-child \{ margin-right: -6px; \}/);
  });

  it('3 and 10: look D’s header fades out at its foot and its day card edge matches its other cards', () => {
    const looks = src('popup/popup-looks.css');
    expect(looks.match(/linear-gradient\(180deg, transparent 50%, var\(--fw-bg\) 100%\), linear-gradient\(120deg,/g)?.length).toBe(2);
    expect(looks).toMatch(/border-color: color-mix\(in oklab, var\(--fw-teal\) 25%, var\(--fw-border\)\);/);
  });

  it('31: the open tab’s edge is drawn strong enough to see', () => {
    expect(src('popup/popup-panel.css')).toMatch(/\.fw-popup \.pop-tab\.active \{[^}]*border-color: color-mix\(in oklab, var\(--fw-teal\) 85%, transparent\);/);
  });

  it('the chip and the tab panel take the house ring; no half-step size is left in the key help', () => {
    const css = src('popup/popup-design.css');
    expect(css).toMatch(/\.fw-popup \.status-chip:focus-visible \{ outline: 2px solid var\(--fw-teal\); outline-offset: 2px; \}/);
    expect(css).toMatch(/\.fw-popup \[role="tabpanel"\]:focus-visible \{ outline: 2px solid var\(--fw-teal\); outline-offset: -2px;/);
    expect(css).toMatch(/\.key-help \.mono \{[^}]*font-size: 11px; \}/);
  });
});
