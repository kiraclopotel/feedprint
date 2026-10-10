// A look ships only with its contrast table: every look the chooser offers besides A has a dark and a light colour
// block in popup-looks.css, and every pair the popup draws from those colours clears WCAG (4.5:1 for text, 3:1 for a
// control's edge or fill). Look A, which draws the base tokens, is held to the same pairs. The state colours (red,
// amber, green) are never a look's to set, so they keep their meaning in every look; they are checked against each
// look's card here.

import { describe, expect, it } from 'vitest';
import { readSource } from '../../../helpers/read-source';
import { POPUP_LOOKS } from '../../../../src/ui/shared/looks';
import { mixOklch, mixSrgb, share } from '../../../helpers/colour-mix';

const LOOKS_CSS = readSource('src/ui/popup/popup-looks.css');
const TOKENS_CSS = readSource('src/ui/shared/tokens.css');

function block(css: string, start: RegExp): Record<string, string> {
  const m = start.exec(css);
  if (!m) throw new Error(`block not found: ${start}`);
  const from = m.index + m[0].length;
  const body = css.slice(from, css.indexOf('\n}', from));
  const out: Record<string, string> = {};
  for (const d of body.matchAll(/(--[a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) out[d[1]] = d[2].toLowerCase();
  return out;
}

const lin = (c: number) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lum = (h: string) => 0.2126 * lin(parseInt(h.slice(1, 3), 16)) + 0.7152 * lin(parseInt(h.slice(3, 5), 16)) + 0.0722 * lin(parseInt(h.slice(5, 7), 16));
const ratio = (a: string, b: string) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

const baseDark = block(TOKENS_CSS, /^:root \{/m);
const baseLight = { ...baseDark, ...block(TOKENS_CSS, /:root\[data-theme="light"\] \{/) };

// Text pairs at 4.5:1, then the edges and fills a control is seen by at 3:1.
const TEXT_PAIRS: Array<[string, string]> = [
  ['--fw-text', '--fw-bg'], ['--fw-text', '--fw-card'], ['--fw-text', '--fw-surface-2'],
  ['--fw-text-secondary', '--fw-card'], ['--fw-muted', '--fw-card'], ['--fw-muted', '--fw-bg'], ['--fw-muted', '--fw-surface-2'],
  ['--fw-teal', '--fw-card'], ['--fw-teal', '--fw-bg'], ['--fw-on-accent', '--fw-teal'], ['--pop-on-accent', '--fw-teal'],
  ['--fw-purple', '--fw-card'], ['--fw-purple', '--fw-bg'], ['--fw-on-accent', '--fw-purple'],
  ['--fw-red', '--fw-card'], ['--fw-amber', '--fw-card'],
];
const CONTROL_PAIRS: Array<[string, string]> = [
  ['--fw-border', '--fw-card'], ['--fw-border', '--fw-bg'], ['--fw-teal', '--fw-card'], ['--fw-green', '--fw-card'],
];

const others = POPUP_LOOKS.filter((l) => l !== 'a');

// Look A draws the base tokens, with the page colour on the accent (popup-design.css's --pop-on-accent fallback) and,
// in light, the popup's own darker border from popup-design.css.
const DESIGN_CSS = readSource('src/ui/popup/popup-design.css');
const lookALight = block(DESIGN_CSS, /^:root\[data-theme="light"\]:not\(\[data-look\]\) \{/m);

describe('every look ships with its contrast table', () => {
  it('the chooser offers A and at least one other look', () => {
    expect(POPUP_LOOKS[0]).toBe('a');
    expect(others.length).toBeGreaterThan(0);
  });

  for (const mode of ['dark', 'light'] as const) {
    it(`look a, ${mode}: every text pair clears 4.5:1 and every control 3:1`, () => {
      const base = mode === 'dark' ? baseDark : { ...baseLight, ...lookALight };
      const t: Record<string, string> = { ...base, '--pop-on-accent': base['--fw-bg'] };
      const fails: string[] = [];
      for (const [fg, bg] of TEXT_PAIRS) if (ratio(t[fg], t[bg]) < 4.5) fails.push(`${fg} on ${bg} ${ratio(t[fg], t[bg]).toFixed(2)}`);
      for (const [fg, bg] of CONTROL_PAIRS) if (ratio(t[fg], t[bg]) < 3) fails.push(`${fg} against ${bg} ${ratio(t[fg], t[bg]).toFixed(2)}`);
      expect(fails).toEqual([]);
    });
  }

  for (const look of others) {
    for (const mode of ['dark', 'light'] as const) {
      it(`look ${look}, ${mode}: every text pair clears 4.5:1 and every control 3:1`, () => {
        const start = mode === 'dark'
          ? new RegExp(`:root\\[data-look="${look}"\\]:not\\(\\[data-theme="light"\\]\\) \\{`)
          : new RegExp(`:root\\[data-look="${look}"\\]\\[data-theme="light"\\] \\{`);
        const own = block(LOOKS_CSS, start);
        // A look states every colour it changes; the rest come from the mode's base tokens.
        for (const k of ['--fw-bg', '--fw-card', '--fw-surface-2', '--fw-text', '--fw-muted', '--fw-teal', '--fw-on-accent', '--pop-on-accent', '--fw-purple']) {
          expect(own[k], `${look} ${mode} sets ${k}`).toMatch(/^#/);
        }
        const t = { ...(mode === 'dark' ? baseDark : baseLight), ...own };
        const fails: string[] = [];
        for (const [fg, bg] of TEXT_PAIRS) if (ratio(t[fg], t[bg]) < 4.5) fails.push(`${fg} on ${bg} ${ratio(t[fg], t[bg]).toFixed(2)}`);
        for (const [fg, bg] of CONTROL_PAIRS) if (ratio(t[fg], t[bg]) < 3) fails.push(`${fg} against ${bg} ${ratio(t[fg], t[bg]).toFixed(2)}`);
        expect(fails).toEqual([]);
      });
    }
  }

  // Teal's second colour shows on Home, on the day's card, and not only in the blocklist editor's account chips.
  const LIFE_CSS = readSource('src/ui/popup/popup-life.css');
  it("look a's Home shows its pink-violet outside the blocklist editor", () => {
    const sheets = [LIFE_CSS, DESIGN_CSS, readSource('src/ui/popup/popup-panel.css')];
    const rules = sheets.flatMap((css) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)])
      .filter(([, selector, body]) => /var\(--fw-purple\)/.test(body) && !/data-look="/.test(selector) && !/chip-account/.test(selector));
    expect(rules.some(([selector]) => /\.today-card/.test(selector))).toBe(true);
  });

  for (const mode of ['dark', 'light'] as const) {
    it(`look a, ${mode}: the text on the day card's pink-violet tint clears 4.5:1`, () => {
      const t = mode === 'dark' ? baseDark : { ...baseLight, ...lookALight };
      const tint = mixSrgb(t['--fw-purple'], share(LIFE_CSS, /:not\(\[data-look\]\) \.fw-popup \.today-card \{\s*background: linear-gradient\(165deg, color-mix\(in srgb, var\(--fw-purple\) (\d+)%, var\(--fw-card\)\)/), t['--fw-card']);
      const fails: string[] = [];
      for (const fg of ['--fw-text', '--fw-text-secondary', '--fw-muted', '--fw-purple']) if (ratio(t[fg], tint) < 4.5) fails.push(`${fg} on the day card's tint ${ratio(t[fg], tint).toFixed(2)}`);
      expect(fails).toEqual([]);
    });
  }

  // The vivid looks lay tints under text: the header runs from the accent through the second colour into the page, and
  // the today card fades from the accent. The shares are read from the sheet and mixed in oklch, as the sheet mixes.
  for (const look of ['d', 'e'].filter((l) => (POPUP_LOOKS as readonly string[]).includes(l))) {
    for (const mode of ['dark', 'light'] as const) {
      it(`look ${look}, ${mode}: the text on the header's run and on the today card's tint clears 4.5:1`, () => {
        const start = mode === 'dark'
          ? new RegExp(String.raw`:root\[data-look="${look}"\]:not\(\[data-theme="light"\]\) \{`)
          : new RegExp(String.raw`:root\[data-look="${look}"\]\[data-theme="light"\] \{`);
        const t = { ...(mode === 'dark' ? baseDark : baseLight), ...block(LOOKS_CSS, start) };
        const header = new RegExp(
          (mode === 'dark' ? String.raw`html\[data-look="d"\] \.fw-popup \.pop-header,` : String.raw`html\[data-look="d"\]\[data-theme="light"\] \.fw-popup \.pop-header,`)
          + String.raw`[^{]*\{\s*background: linear-gradient\(120deg,\s*color-mix\(in oklch, var\(--fw-teal\) (\d+)%, var\(--fw-bg\)\) 0%,\s*color-mix\(in oklch, var\(--fw-purple\) (\d+)%`);
        const stops = [mixOklch(t['--fw-teal'], share(LOOKS_CSS, header, 1), t['--fw-bg']), mixOklch(t['--fw-purple'], share(LOOKS_CSS, header, 2), t['--fw-bg']), t['--fw-bg']];
        const today = mixOklch(t['--fw-teal'], share(LOOKS_CSS, /\.today-card \{\s*background: linear-gradient\(160deg, color-mix\(in oklch, var\(--fw-teal\) (\d+)%, var\(--fw-card\)\)/), t['--fw-card']);
        const fails: string[] = [];
        stops.forEach((stop, i) => {
          for (const fg of ['--fw-text', '--fw-text-secondary', '--fw-muted']) if (ratio(t[fg], stop) < 4.5) fails.push(`${fg} on header stop ${i} ${ratio(t[fg], stop).toFixed(2)}`);
        });
        for (const fg of ['--fw-text', '--fw-text-secondary', '--fw-muted', '--fw-purple']) if (ratio(t[fg], today) < 4.5) fails.push(`${fg} on the today card's tint ${ratio(t[fg], today).toFixed(2)}`);
        expect(fails).toEqual([]);
      });
    }
  }

  it('no look sets a state colour', () => {
    expect(LOOKS_CSS).not.toMatch(/--fw-(red|amber|green)(-soft)?\s*:/);
  });

  it('Receipts loads the looks sheet; Off, which has no dark/light choice either, stays on A', () => {
    expect(readSource('src/ui/popup/Popup.tsx')).toMatch(/^import '\.\/popup-looks\.css';$/m);
    expect(readSource('src/products/off/popup/OffPopup.tsx')).not.toMatch(/popup-looks/);
  });
});
