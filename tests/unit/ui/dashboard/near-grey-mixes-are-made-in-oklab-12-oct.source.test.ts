// A near-grey colour mixed in oklch loses its hue in Chrome: the computed value reads "oklch(L C none)" with the small
// chroma kept, and hue none is painted as hue 0, a pink wash on a cool look (measured by pixel on the popup's tab strip,
// crew/visuals/pu6-after). The dashboard's eight grey mixes (the header's backdrop, two hover washes, the
// children's band, the AI row, the scrollbar thumb and its colour) are made in oklab, which has no hue to lose. A mix
// whose first colour carries a hue (the record accent, the noise red, a technique colour) may stay in oklch.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const sheet = (f: string) => readFileSync(new URL(`../../../../src/ui/dashboard/${f}`, import.meta.url), 'utf8');
const greyTokens = /color-mix\(in oklch, var\(--fw-(text|text-secondary|muted|ink|bg|card|surface|ground|line|border)\) /;

describe('the dashboard mixes its greys in oklab', () => {
  it('no dashboard sheet mixes a grey token in oklch', () => {
    for (const f of ['dashboard-design.css', 'dashboard-frame.css', 'dashboard-looks.css', 'dashboard-house.css']) {
      expect(sheet(f), f).not.toMatch(greyTokens);
    }
  });
  it('the scrollbar thumb and the header backdrop are oklab mixes', () => {
    const design = sheet('dashboard-design.css');
    expect(design).toMatch(/::-webkit-scrollbar-thumb \{[^}]*color-mix\(in oklab, var\(--fw-muted\) 30%, transparent\)/);
    expect(design).toMatch(/scrollbar-color: color-mix\(in oklab, var\(--fw-muted\) 32%, transparent\) transparent/);
    expect(design).toMatch(/\.dash-header \{[^}]*color-mix\(in oklab, var\(--fw-bg\) 88%, transparent\)/);
  });
});
