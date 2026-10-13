// What can be pressed shows it. The cues are drawn by the dashboard's sheets, so each rule is held in its sheet:
// an unchosen lens keeps an edge; the chip that removes a filter stands apart from the chosen period; a primary button
// that is not allowed yet drops the accent fill; a log row, a drill row and an account row end in a chevron while rows
// that only report have none; the verbatim toggle is an underlined accent link; a chosen state is a tint of the accent
// with the accent under it, and the solid accent belongs to the primary button alone.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const src = (f: string) => readFileSync(new URL(`../../../../src/ui/dashboard/${f}`, import.meta.url), 'utf8');

describe('the dashboard controls read as controls', () => {
  it('an unchosen lens has an edge, so the row reads as a switch and not a caption', () => {
    expect(src('dashboard-frame.css')).toMatch(/\.fb-lens \{ background: none; border-color: var\(--fw-border\);/);
  });

  it('the chip that removes a filter is set apart from the joined choices', () => {
    const design = src('dashboard-design.css');
    expect(design).toMatch(/\.fl-bar \.fl-chips \.chip\.active:not\(\[aria-pressed\]\) \{ margin-left: 8px; \}/);
    // It must come after the rule that joins neighbours, or the join would win the tie.
    expect(design.indexOf('.chip.active:not([aria-pressed]) { margin-left: 8px; }'))
      .toBeGreaterThan(design.indexOf('.fl-bar .fl-chips .chip + .chip { margin-left: -1px; }'));
  });

  it('a blocked primary button has the quiet fill, and it wins over the disabled hover', () => {
    const design = src('dashboard-design.css');
    expect(design).toMatch(/\.btn\.primary:disabled \{ opacity: 1; background: var\(--fw-surface-2\); color: var\(--fw-muted\); border-color: var\(--fw-border\); \}/);
    expect(design.indexOf('.btn.primary:disabled {')).toBeGreaterThan(design.indexOf('.btn:disabled:hover {'));
    // The accent fill stays the primary button's.
    expect(design).toMatch(/\.btn\.primary \{ background: var\(--fw-accent\); color: var\(--fw-on-accent\);/);
  });

  it('the rows that open end in a chevron drawn with borders, not a glyph the face sets too small to see', () => {
    const design = src('dashboard-design.css');
    expect(design).toMatch(/\.fl-row:not\(\.fl-row-head\) \.fl-why \{ position: relative; padding-right: 28px; \}/);
    expect(design).toMatch(/\.fl-row:not\(\.fl-row-head\) \.fl-why::after \{\n  content: ''; position: absolute; right: 9px; top: 50%; width: 7px; height: 7px;\n  border: solid var\(--fw-muted\); border-width: 0 2px 2px 0; transform: translateY\(-6px\) rotate\(45deg\);/);
    expect(design).toMatch(/\.fl-row\[aria-expanded="true"\] \.fl-why::after \{ border-color: var\(--fw-record\); transform: translateY\(-1px\) rotate\(-135deg\); \}/);
    // Only the drill rows (the ones with a click) carry it.
    expect(design).toMatch(/\.fwc-row\.drill \.fwc-label::after \{\n  content: ''; flex: none; width: 6px; height: 6px; margin: 0 4px 0 6px;\n  border: solid var\(--fw-record\); border-width: 0 2px 2px 0; transform: rotate\(-45deg\);\n\}/);
    expect(design).not.toMatch(/\n\.fwc-row \.fwc-label::after/);
    expect(design).toMatch(/\.ov-src-row::after \{\n  content: ''; flex: none; width: 7px; height: 7px; margin: 0 5px 0 6px;\n  border: solid var\(--fw-record\); border-width: 0 2px 2px 0; transform: rotate\(-45deg\);\n\}/);
  });

  it('the verbatim toggle is an underlined accent link and its caret is not faded', () => {
    const design = src('dashboard-design.css');
    const rule = /\.fc-reveal-btn \{([^}]*)\}/.exec(design)?.[1] ?? '';
    expect(rule).toMatch(/color: var\(--fw-record\);/);
    expect(rule).toMatch(/text-decoration: underline; text-underline-offset: 3px;/);
    expect(design).toMatch(/\.fc-reveal-caret \{ opacity: 1;/);
  });

  it('a chosen state is a tint with the accent under it, for every control that shows a choice', () => {
    const looks = src('dashboard-looks.css');
    const tint = 'background: color-mix(in oklch, var(--fw-record) 18%, var(--fw-ground)); color: var(--fw-ink);';
    expect(looks).toContain(`.fb-lens.active {\n  ${tint}\n  border-color: var(--fw-record); box-shadow: inset 0 -2px 0 var(--fw-record);\n}`);
    expect(looks).toContain(`.chip.active {\n  ${tint}\n  border-color: var(--fw-record); box-shadow: inset 0 -2px 0 var(--fw-record);\n}`);
    // Under the pointer the tint deepens and keeps the ink; none of these goes back to the solid accent.
    const hover = 'background: color-mix(in oklch, var(--fw-record) 28%, var(--fw-ground))';
    expect(looks).toContain(`.chip.active:hover { ${hover}; color: var(--fw-ink); }`);
    expect(looks).toContain(`.frail-opt.on:hover { ${hover}; }`);
    expect(looks).toContain(`.feed-breakdown-btn[aria-expanded="true"]:hover {\n  ${hover};\n}`);
    expect(looks).not.toMatch(/(\.chip\.active|\.fb-lens\.active|\.frail-opt\.on)[^{]*\{[^}]*background: var\(--fw-record\)/);
    // The Feed log bar keeps its joined geometry: the chosen chip is still lifted over its neighbours' edges.
    expect(src('dashboard-design.css')).toMatch(/\.fl-bar \.fl-chips \.chip\.active, \.fl-bar \.fl-chips \.chip:hover, \.fl-bar \.fl-chips \.chip:focus-visible \{ position: relative; z-index: 1; \}/);
  });
});
