// Feedprint's Settings page, his word of 12 Oct 2026 (relayed by the Leader at 21:2x), measured in a built dist at
// 396x600, dark and light (crew/visuals/set-before, set-after; the probe pop-set.mjs): the folds' hover is a visible
// step, with a key Live Rephrase leads, and the page is tighter (40 px pills, the open header stays where the pill was,
// the level buttons 8 px over the rows).

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const src = (f: string) => readFileSync(new URL(`../../../../src/${f}`, import.meta.url), 'utf8');

describe('Settings: a hover that shows, the reading first with a key, a tighter page', () => {
  it('the green pill steps down its own green under the pointer and the press; a card pill takes a step of ink', () => {
    const css = src('ui/popup/popup-design.css');
    expect(css).toContain('--ai-pill-hover: #16a34a; --ai-pill-press: #16a34a;');
    expect(css).toContain('--ai-pill-hover: #166534; --ai-pill-press: #14532d;');
    expect(css).toContain('.fw-popup .ai-drawer.closed:not(.idle):has(> .ai-drawer-head:hover) { background: var(--ai-pill-hover); border-color: var(--ai-pill-hover); }');
    expect(css).toContain('.fw-popup .ai-drawer.closed:not(.idle):has(> .ai-drawer-head:active) { background: var(--ai-pill-press); border-color: var(--ai-pill-press); }');
    expect(css).toMatch(/\.fw-popup \.ai-drawer\.closed\.idle:has\(> \.ai-drawer-head:hover\) \{\n  background: color-mix\(in oklab, var\(--fw-text\) 16%, var\(--fw-card\)\);/);
    // The grey smudge the chevron's square drew on the green (an oklch mix of the pill's ink) is gone.
    expect(css).not.toContain('.ai-drawer.closed .ai-drawer-head:hover .ai-drawer-chip { background: color-mix(in oklch, currentColor 14%, transparent); }');
  });

  it('with a key the reading leads, then General, then PIN and language', () => {
    const p = src('ui/popup/panels/SettingsPanel.tsx');
    const ai = p.indexOf('<AiCard\n'), general = p.indexOf('<Fold name="general"'), device = p.indexOf('<Fold name="device"');
    expect(ai).toBeGreaterThan(0);
    expect(ai).toBeLessThan(general);
    expect(general).toBeLessThan(device);
  });

  it('a shut fold is a 40 px pill with a 40 px header; open, the header stays where the pill had it', () => {
    const css = src('ui/popup/popup-design.css');
    expect(css).toContain('border-radius: 20px; padding: 0 14px;');
    expect(css).toMatch(/\.ai-drawer-head \{\n  display: flex; align-items: center; gap: 8px; width: 100%; min-height: 40px; padding: 4px 0; margin-top: -1px;/);
    expect(css).toContain('.ai-drawer.closed .ai-drawer-head { margin-bottom: -1px; }');
    expect(css).toContain('.fw-popup .pop-card.ai-drawer:not(.closed) { padding-top: 0; }');
  });

  it('the level buttons sit 8 px over the sentence that says what the level shows', () => {
    const panel = src('ui/popup/popup-panel.css');
    expect(panel).toContain('.fw-popup .level-sentence { margin: var(--pop-2) 0 0; padding: 0 2px; font-size: var(--fw-text-12); line-height: 1.45; color: var(--fw-text); }');
    expect(panel).not.toContain('.level-list');
    expect(panel).not.toContain('.level-row');
  });
});
