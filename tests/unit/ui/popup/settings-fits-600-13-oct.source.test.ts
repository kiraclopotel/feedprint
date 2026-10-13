// Feedprint's Settings page after the level card (13 Oct 2026, the Leader's list at 00:0x), measured in a built dist at
// 396x600 in four languages (crew/visuals/set2-*, set3-*; the probe pop-set.mjs): with General open the page ran to 608 in
// ro, es and pt-BR, and with Live Rephrase open to 604 in es and pt-BR. The fold bodies come down on the scale: at Calm any one
// fold open ends at 598 or less in all four languages (Open: en and ro), and every fold starts shut until the person opens it.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const src = (f: string) => readFileSync(new URL(`../../../../src/${f}`, import.meta.url), 'utf8');

describe('Settings: the fold bodies on the scale, and every fold starts shut', () => {
  it('the own-rules line is the fold\'s last line: the card\'s 8 px is the space under it, and the row above it starts a step below its hairline', () => {
    expect(src('ui/popup/popup-design.css')).toContain('.set-rules-line { margin-top: -4px; padding-bottom: 0; }');
    expect(src('ui/popup/popup-panel.css')).toContain(
      '.fw-popup .set-rules-jump { margin-top: var(--pop-2); padding-top: var(--pop-1); border-top: 1px solid var(--fw-border-light); }',
    );
  });

  it('the rewrites\' language sits a step over its field, its name one line of text with no switch height', () => {
    const css = src('ui/popup/popup-panel.css');
    expect(css).toContain('.fw-popup .feat-row.fr-stack { flex-direction: column; align-items: stretch; gap: var(--pop-1); }');
    expect(css).toContain('.fw-popup .feat-row.fr-stack .fr-name { min-height: 0; }');
    const card = src('ui/popup/panels/ai/AiCard.tsx');
    expect(card).toContain('<div className="feat-row fr-stack">');
    expect(card).not.toContain("flexDirection: 'column', alignItems: 'stretch', gap: 8");
  });

  it('no fold opens by itself the first time', () => {
    expect(src('ui/popup/panels/Fold.tsx')).toContain('export const FOLD_DEFAULT_OPEN = { general: false, reading: false, topics: false, device: false } as const;');
  });
});
