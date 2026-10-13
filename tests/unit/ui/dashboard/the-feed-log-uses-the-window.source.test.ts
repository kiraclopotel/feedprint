// The Feed log fills the window's height; since 12 Oct 2026 it holds the page's width like every other tab (V7). The
// tabs answered a pointer only by a slightly darker word. These hold the sheet to what fixed both: the log fills its
// height, the header and tabs do not move, and a tab under the pointer or the keyboard changes colour in every look (the colours' contrast is held in dashboard-looks-contrast.source.test.ts).

import { describe, expect, it } from 'vitest';
import { readSource } from '../../../helpers/read-source';

const DESIGN = readSource('src/ui/dashboard/dashboard-design.css');
const LOOKS = readSource('src/ui/dashboard/dashboard-looks.css');
const FRAME = readSource('src/ui/dashboard/dashboard-frame.css');

// His walk of 12 Oct 2026 (V7, the dashboard zoomed out): "everything stretches". The log reached out to 1600px, the one
// tab wider than the page; it now holds the page's centred width like every other tab, and keeps filling the height.
describe('the Feed log on a wide window', () => {
  it('holds the page’s width: no reach past the shell', () => {
    expect(DESIGN).toMatch(/\.fl-wrap \{\n  width: auto;\n  margin-left: 0;/);
    expect(DESIGN).not.toMatch(/\.fl-wrap \{\s*width: min\(/);
  });

  it('fills the window’s height instead of a fixed box, and gives its rows more room from 1200px without a larger type', () => {
    expect(DESIGN).toMatch(/\.fl-body \{ max-height: max\(560px, calc\(100vh - 320px\)\); \}/);
    expect(DESIGN).toMatch(/@media \(min-width: 1200px\) \{\s*\.fl-row \{[^}]*padding: 12px 20px; font-size: 13px;/);
  });

  it('the page itself is capped and centred, so a wide window gets margins, not a stretched page', () => {
    expect(FRAME).toMatch(/^\.dash-shell \{ max-width: \d+px; \}$/m);
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

// Every other tab starts at the tabs' left edge; the Feed log's title, its filters and its notes reached out with the
// table and started 22 px further left at 1280 px (crew/visuals/heads-stack.png, 11 Oct 2026). Only the table reaches.
describe('the Feed log starts where the other tabs start', () => {
  const TAB = readSource('src/ui/dashboard/components/FeedLogTab.tsx');
  it('keeps its title, filters and notes outside the wide block, and the table inside it', () => {
    const wide = TAB.indexOf('className="fl-wrap"');
    expect(wide).toBeGreaterThan(-1);
    expect(TAB.indexOf('className="fl-head"')).toBeLessThan(wide);
    expect(TAB.lastIndexOf('className="fl-chips"')).toBeLessThan(wide);
    expect(TAB.indexOf('className="fx-ledger fl-log"')).toBeGreaterThan(wide);
  });
});
