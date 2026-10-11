// The Feed log, held to the shell's width and a 560px box, filled a third of a 1920px screen; the tabs answered a
// pointer only by a slightly darker word. These hold the sheet to what fixed both: the log reaches out to the window
// up to a cap and fills its height, the header and tabs do not move, and a tab under the pointer or the keyboard
// changes colour in every look (the colours' contrast is held in dashboard-looks-contrast.source.test.ts).

import { describe, expect, it } from 'vitest';
import { readSource } from '../../../helpers/read-source';

const DESIGN = readSource('src/ui/dashboard/dashboard-design.css');
const LOOKS = readSource('src/ui/dashboard/dashboard-looks.css');
const FRAME = readSource('src/ui/dashboard/dashboard-frame.css');

describe('the Feed log on a wide window', () => {
  it('reaches from the shell’s centre to the window, less 32px each side, up to 1600px', () => {
    expect(DESIGN).toMatch(/\.fl-wrap \{\s*width: min\(1600px, calc\(100vw - 64px\)\);\s*margin-left: calc\(50% - min\(800px, 50vw - 32px\)\);/);
  });

  it('fills the window’s height instead of a fixed box, and grows its rows from 1200px', () => {
    expect(DESIGN).toMatch(/\.fl-body \{ max-height: max\(560px, calc\(100vh - 320px\)\); \}/);
    expect(DESIGN).toMatch(/@media \(min-width: 1200px\) \{\s*\.fl-row \{[^}]*font-size: 14px;/);
  });

  // The block's place, worked out from the numbers the sheets hold: the shell's cap (dashboard-frame.css) and side
  // padding, and the block's own width and offset. Change any of them and the edges here move.
  const num = (css: string, re: RegExp): number => {
    const m = re.exec(css);
    if (!m) throw new Error(`not in the sheet: ${re}`);
    return Number(m[1]);
  };
  const SHELL_CAP = num(FRAME, /^\.dash-shell \{ max-width: (\d+)px; \}$/m);
  const SHELL_PAD = num(DESIGN, /^\.dash-shell \{ padding: 0 (\d+)px 80px; \}$/m);
  const CAP = num(DESIGN, /\.fl-wrap \{\s*width: min\((\d+)px,/);
  const GUTTER = num(DESIGN, /\.fl-wrap \{\s*width: min\(\d+px, calc\(100vw - (\d+)px\)\);/) / 2;
  const place = (vw: number) => {
    const shell = Math.min(vw, SHELL_CAP);
    const contentLeft = (vw - shell) / 2 + SHELL_PAD;
    const content = shell - 2 * SHELL_PAD;
    const width = Math.min(CAP, vw - 2 * GUTTER);
    const left = contentLeft + content / 2 - Math.min(CAP / 2, vw / 2 - GUTTER);
    return { left, right: left + width, tabsLeft: contentLeft };
  };

  for (const vw of [1024, 1366, 1920, 2560]) {
    it(`at ${vw}px it stays inside the window with its gutter, centred on the page, and never narrower than the tabs`, () => {
      const p = place(vw);
      expect(p.left).toBeGreaterThanOrEqual(GUTTER - 0.5);
      expect(p.right).toBeLessThanOrEqual(vw - GUTTER + 0.5);
      expect(Math.abs((p.left + p.right) / 2 - vw / 2)).toBeLessThan(1);
      expect(p.left).toBeLessThanOrEqual(p.tabsLeft + 0.5);
    });
  }

  it('at 1024px, where the shell already fills the window, it lines up with the tabs and does not overflow', () => {
    const p = place(1024);
    expect(p.left).toBeCloseTo(p.tabsLeft, 1);
    expect(p.right).toBeCloseTo(1024 - SHELL_PAD, 1);
  });
});

describe('a tab under the pointer or the keyboard', () => {
  it('takes the accent and a tint in every look, and the keyboard gets a ring', () => {
    expect(LOOKS).toMatch(/^\.dash-tab:hover, \.dash-tab:focus-visible \{ color: var\(--fw-record\); background: color-mix\(in oklch, var\(--fw-record\) \d+%, var\(--fw-ground\)\); \}$/m);
    expect(LOOKS).toMatch(/^\.dash-tab:focus-visible \{ outline: 2px solid var\(--fw-record\); outline-offset: -2px; \}$/m);
    // Unscoped by look, so every look and both modes wear it.
    expect(LOOKS).not.toMatch(/data-look="[a-e]"\][^{]*\.dash-tab:hover/);
  });
});
