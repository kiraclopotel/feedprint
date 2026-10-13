// The polish program's Off U1 (12 Oct 2026, POLISH-BACKLOG-2026-10-12.md, "## Off popup"): Off's first screen, measured
// in a built dist-off at 396x600, en and ro, dark and light (crew/visuals/ou1-before and ou1-after).
// 1. The six fold heads were 11 px grey capitals with no surface, the main thing to press drawn as the quietest.
// 2. Describe sat 1 px under the line above it, centred while every other line starts at the card's edge.
// 3. An open head would stick to its card.
// 4. The window's mark was a teal dot where the toolbar shows Off's red tile.
// 14. The tagline sat 8 px off centre. (15, the header's tint short of the sides, is the scrollbar gutters, which
// Chromium fills with the flat page colour; not built.)
// 16. The guide was grey capitals, the opener with the least cue. 18. The footer had 6 px under its words.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../../../../src/products/off/popup/off-popup.css', import.meta.url), 'utf8');

describe('Off U1: the first screen after the read of 12 Oct 2026', () => {
  it('1 and 3: a fold head is a 40 px row of the page-button family, its chevron at the right, 8 px from its open card', () => {
    expect(css).toMatch(/\.fw-off \.off-fold > summary \{\n  box-sizing: border-box; min-height: 40px; margin: 6px 8px 0;[^}]*background: var\(--fw-card\); border: 1px solid var\(--fw-border\);[^}]*font-size: 13px; font-weight: 600; text-transform: none;/);
    expect(css).toMatch(/\.fw-off \.off-fold > summary::before \{ order: 3; margin: 0 2px 0 auto;/);
    expect(css).toMatch(/\.fw-off \.off-fold\[open\] > summary \{ margin-bottom: 8px; \}/);
    expect(css).toMatch(/\.fw-off \.off-fold > summary:hover \{\n  border-color: color-mix\(in srgb, var\(--fw-teal\) 55%/);
  });

  it('2: Describe is a full-width 40 px row with air above it', () => {
    expect(css).toMatch(/\.fw-off \.describe-open\.fw-page-btn \{ display: flex; width: 100%; justify-content: space-between; min-height: 40px; margin: 8px 0 10px; \}/);
  });

  it('4: the window shows Off’s own toolbar tile, still, never Feedprint’s', () => {
    expect(css).toMatch(/background: url\(\.\.\/\.\.\/\.\.\/\.\.\/assets\/icons-off\/icon-48\.png\) center \/ cover; animation: none;/);
    expect(css).not.toMatch(/url\(\/assets\/icons\//);
  });

  it('14, 16, 18: the tagline on the card edge, a teal guide, room round the footer', () => {
    expect(css).toMatch(/\.fw-off \.pop-header \.fw-off-tagline \{ text-align: right; \}/);
    // Since Off U3 the header has two columns and no empty third one, whose 10 px gap kept the tagline short of 378.
    expect(css).toMatch(/\.fw-off \.pop-header::after \{ content: none; \}/);
    expect(css).toMatch(/\.fw-off \.off-card-fold > summary\.grp-hdr \{ color: var\(--fw-teal\);/);
    expect(css).toMatch(/\.fw-popup\.fw-off \.foot \{ padding-top: 16px; padding-bottom: 12px; \}/);
  });
});
