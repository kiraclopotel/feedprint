// The polish program's Off U5 (12 Oct 2026, POLISH-BACKLOG-2026-10-12.md, "## Off popup"): the last rows, measured in
// a built dist-off at 396x600 (crew/visuals/ou5-before, ou5-after2). Rows 10, 23, 26, 27.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const src = (f: string) => readFileSync(new URL(`../../../../src/${f}`, import.meta.url), 'utf8');

describe('Off U5: the select, the (i) on long names, the hashtag box, Off’s dead motion', () => {
  it('10: the language select is 36 px with a drawn arrow, not an inline style', () => {
    expect(src('products/off/popup/OffPopup.tsx')).not.toMatch(/SELECT_STYLE/);
    expect(src('products/off/popup/OffPopup.tsx')).toMatch(/className="set-select"/);
    const off = src('products/off/popup/off-popup.css');
    expect(off).toMatch(/\.fw-off \.set-select \{\n  width: 100%; min-height: 36px;[^}]*appearance: none;/);
    expect(off).toMatch(/\.fw-off \.set-select \{[^}]*linear-gradient\(45deg, transparent 50%, var\(--fw-muted\) 50%\)/);
  });

  it('23: the last word and the (i) share one nowrap span', () => {
    const c = src('ui/popup/controls.tsx');
    expect(c).toContain("{name.slice(0, name.lastIndexOf(' ') + 1)}<span className=\"fr-tail\">{name.slice(name.lastIndexOf(' ') + 1)}");
    expect(c).toMatch(/<InfoIcon size=\{13\} \/>\n {12}<\/button>\n {10}\)\}<\/span>\n {8}<\/div>/);
    expect(src('ui/popup/popup-design.css')).toContain('.fr-tail { white-space: nowrap; }');
    // Feedprint's row name is a flex row: there the span steps aside, or the last word is drawn raised beside the rest.
    expect(src('ui/popup/popup-panel.css')).toContain('.fw-popup .feat-row .fr-name .fr-tail { display: contents; }');
  });

  it('26: the hashtag box and Add are 32 px on the card fill; Restore is 32 px with 12 px words', () => {
    const e = src('ui/popup/BlockAiHashtagEditor.tsx');
    expect(e).toMatch(/padding: '8px 10px',\n\s*borderRadius: 'var\(--fw-r-md\)',\n\s*border: '1px solid var\(--fw-border\)',\n\s*background: 'var\(--fw-card\)'/);
    expect(e).toMatch(/padding: '8px 12px'/);
    expect(e).toMatch(/style=\{\{ fontSize: 12, minHeight: 32 \}\}/);
  });

  it('27: Off keeps no motion the motion look overrides: no breathing mark, no arriving cards, no second switch rule', () => {
    const css = src('ui/popup/popup-design.css');
    expect(css).not.toMatch(/fw-breathe/);
    expect(css).not.toMatch(/fw-card-in/);
    expect(css).not.toMatch(/\.fw-off \.toggle \{ transition/);
  });

  it('U3’s folds stand still under reduced motion, in a rule of their own', () => {
    const life = src('ui/popup/popup-life.css');
    const reduce = life.slice(life.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduce).toContain('  html .fw-popup *::after { animation: none !important; transition: none !important; }');
    expect(reduce).toContain('  html .fw-popup *::details-content { transition: none !important; }');
  });
});
