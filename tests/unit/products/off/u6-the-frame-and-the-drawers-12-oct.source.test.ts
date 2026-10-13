// The polish program's Off U6 (his word 12 Oct 2026, 21:2x; POLISH-BACKLOG-2026-10-12.md, "## Off popup"): Off's frame
// and drawers in Feedprint's manner, measured in a built dist-off at 396x600, dark and light (crew/visuals/ou6-before,
// ou6-after). All of it is Off's sheet; the popup script does not grow.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const off = () => readFileSync(new URL('../../../../src/products/off/popup/off-popup.css', import.meta.url), 'utf8');

describe('Off U6: a soft frame in the mark’s crimson, and folds drawn as drawers', () => {
  it('the frame: a line in the mark’s colour 1 px inside the window with a faint inner glow, above the sticky header', () => {
    const css = off();
    expect(css).toContain(':root { --off-mark: #d31147; }');
    expect(css).toMatch(/body:not\(\.fw-detached\) \.fw-popup\.fw-off::after \{\n  content: ""; position: fixed; inset: 1px; pointer-events: none; z-index: 6;/);
    expect(css).toContain('border: 1px solid color-mix(in oklab, var(--off-mark) 50%, transparent);');
    expect(css).toContain('border-color: color-mix(in oklab, var(--off-mark) 34%, transparent);');
  });

  it('the header is a plate 1 px inside the line, its crimson tint fading into the page, over the motion sheet’s teal', () => {
    const css = off();
    expect(css).toMatch(/html body:not\(\.fw-detached\) \.fw-popup\.fw-off \.pop-header \{\n  margin: 1px -9px 0; padding-left: 17px; padding-right: 17px;/);
    expect(css).toContain('background: linear-gradient(180deg, color-mix(in oklab, var(--off-mark) 11%, var(--fw-bg)), var(--fw-bg));');
    expect(css).toContain('html[data-theme="light"] body:not(.fw-detached) .fw-popup.fw-off .pop-header {');
  });

  it('shut, a fold is a 40 px pill as wide as its words; the pointer steps it by ink', () => {
    const css = off();
    expect(css).toMatch(/\.fw-off \.off-fold:not\(\[open\]\) > summary \{\n  width: fit-content; max-width: calc\(100% - 16px\); margin: 8px 8px 0; gap: 10px; border-radius: 20px;/);
    expect(css).toMatch(/\.fw-off \.off-fold:not\(\[open\]\) > summary:hover \{\n  background: color-mix\(in oklab, var\(--fw-text\) 16%, var\(--fw-card\)\);/);
  });

  it('open, the fold is one card: the header across it, the chevron in a 32 px square, the card inside it plain', () => {
    const css = off();
    expect(css).toMatch(/\.fw-off \.off-fold\[open\] \{\n  margin: 8px 8px 0; padding-bottom: 4px; background: var\(--fw-card\);/);
    expect(css).toMatch(/\.fw-off \.off-fold\[open\] > summary::after \{\n  content: ""; position: absolute; right: 8px; top: 50%; width: 32px; height: 32px;/);
    expect(css).toContain('.fw-popup.fw-off .off-fold[open] > .pop-card { margin: 0; border-color: transparent; background: transparent; box-shadow: none; }');
  });
});
