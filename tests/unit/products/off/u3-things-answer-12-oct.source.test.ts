// The polish program's Off U3 (12 Oct 2026, POLISH-BACKLOG-2026-10-12.md, "## Off popup"): how things answer, measured
// in a built dist-off at 396x600 (crew/visuals/ou3-before, ou3-after, ou3-after-m). Rows 5, 19, 25, 32, 33, 34, with
// row 15 (the scrollbar strips, the Leader's call) and the tagline that ended 10 px short of the cards' edge.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const src = (f: string) => readFileSync(new URL(`../../../../src/${f}`, import.meta.url), 'utf8');

describe('Off U3: things answer, and the header reaches the window edges', () => {
  it('5: Off’s switches slide without the motion look', () => {
    const life = src('ui/popup/popup-life.css');
    expect(life).toMatch(/html:not\(\.fw-life-motion\) \.fw-popup\.fw-off \.toggle \{ transition: background-color 180ms ease; \}/);
    expect(life).toMatch(/html:not\(\.fw-life-motion\) \.fw-popup\.fw-off \.toggle::after \{ transition: left 180ms/);
  });

  it('19: a fold’s body opens over 200 ms', () => {
    const off = src('products/off/popup/off-popup.css');
    expect(off).toMatch(/\.fw-off :is\(\.off-fold, \.off-card-fold\)::details-content \{ block-size: 0; overflow: clip; transition: block-size 200ms ease/);
    expect(off).toMatch(/\.fw-off :is\(\.off-fold, \.off-card-fold\)\[open\]::details-content \{ block-size: auto; \}/);
  });

  it('25 and 32: one teal ring on links, buttons and selects; links answer the pointer', () => {
    const css = src('ui/popup/popup-design.css');
    expect(css).toMatch(/\.fw-popup :is\(a, \.lnk, \.pop-cta, \.iconbtn, select\):focus-visible \{ outline: 2px solid var\(--fw-teal\); outline-offset: 2px; \}/);
    expect(css).toMatch(/\.lnk:hover, \.fw-off \.off-help a:hover \{ text-decoration-thickness: 2px;/);
    expect(css).toMatch(/\.lnk:active, \.fw-off \.off-help a:active \{ opacity: \.7; \}/);
  });

  it('33 and 34: a page over the popup and a PIN panel arrive, and stand still under reduced motion', () => {
    const pb = src('ui/popup/page-button.css');
    expect(pb).toMatch(/\.fw-subpage \{ animation: fw-subpage-in 180ms ease-out both; \}/);
    expect(pb).toMatch(/@media \(prefers-reduced-motion: reduce\) \{[^}]*\}\s*\.fw-subpage \{ animation: none; \}|\.fw-subpage \{ animation: none; \}/);
    expect(src('ui/popup/popup-design.css')).toMatch(/\.pin-panel \{ animation: chip-in 180ms ease-out; transform-origin: top left; \}/);
    expect(src('ui/popup/controls.tsx').match(/<div className="pin-panel" style=/g)?.length).toBe(3);
  });

  it('15 and the tagline: no scrollbar strips, the header to both edges, the tagline on the cards’ edge', () => {
    const off = src('products/off/popup/off-popup.css');
    expect(off).toMatch(/html:has\(\.fw-off\) \{ scrollbar-gutter: auto; scrollbar-width: none; \}/);
    expect(off).toMatch(/\.fw-popup\.fw-off \{ box-sizing: border-box; width: 396px; max-width: 100%; padding-left: 10px; padding-right: 10px; \}/);
    expect(off).toMatch(/\.fw-off \.pop-header \{ margin-left: -10px; margin-right: -10px; padding-left: 18px; padding-right: 18px; \}/);
    expect(off).toMatch(/\.fw-off \.pop-header \{ grid-template-columns: auto 1fr; \}\n\.fw-off \.pop-header::after \{ content: none; \}/);
  });
});
