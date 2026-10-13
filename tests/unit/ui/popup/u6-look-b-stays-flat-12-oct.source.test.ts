// The polish program's popup U6 (12 Oct 2026, POLISH-BACKLOG-2026-10-12.md, "## Feedprint popup", rows 38 to 40): look
// B's flat promise kept, measured in a built popup (crew/visuals/pu6-before and pu6-after): the open tab cast a shadow
// and a glow, the page pill's hover a tinted glow, and the pills were 7.2 px round under a 6 px card.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const looks = readFileSync(new URL('../../../../src/ui/popup/popup-looks.css', import.meta.url), 'utf8');
const sheet = (f: string) => readFileSync(new URL(`../../../../src/ui/popup/${f}`, import.meta.url), 'utf8');

describe('popup U6: look B stays flat', () => {
  it('38: the open tab casts no shadow in look B', () => {
    expect(looks).toMatch(/html\[data-look="b"\] \.fw-popup \.pop-tab\.active \{ box-shadow: none; \}/);
  });
  it('39: the page pill lifts on the pointer without a glow in look B', () => {
    expect(looks).toMatch(/html\[data-look="b"\] \.fw-page-btn:hover \{ box-shadow: none; \}/);
  });
  it('40: the page pill takes the controls’ corner in look B', () => {
    expect(looks).toMatch(/html\[data-look="b"\] \.fw-page-btn \{ border-radius: var\(--fw-r-md\); \}/);
  });
  it('11: a mix of a near-grey text colour is made in oklab, so it keeps its hue (no warm tint on a cool look)', () => {
    expect(sheet('popup-panel.css')).toMatch(/\.fw-popup \.pop-tabbar \{[^}]*background: color-mix\(in oklab, var\(--fw-text\) 5%, var\(--fw-bg\)\);/);
    for (const f of ['popup-panel.css', 'popup-design.css']) {
      expect(sheet(f), f).not.toMatch(/color-mix\(in oklch, var\(--fw-(text|muted|text-secondary)\) /);
    }
    expect(sheet('popup-panel.css')).toMatch(/\.fw-popup \.pop-tab:hover:not\(\.active\) \{[^}]*color-mix\(in oklab, var\(--fw-text\) 6%, transparent\)/);
  });
});
