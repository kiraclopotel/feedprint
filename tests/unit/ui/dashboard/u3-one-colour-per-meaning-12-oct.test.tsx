// The polish program's dashboard U3 (12 Oct 2026, POLISH-BACKLOG-2026-10-12.md, "## Dashboard"): one colour per meaning
// across tabs, measured on a built copy (crew/visuals/du3-before and du3-after).
// 9. Exposure's bar split flagged against hidden while its rows split by family: 21 softened words read as 21 harmful.
// 20. Blocked was the record colour on the Timeline, in Usage time and in the blocked pills; flagged grey on the Timeline.
// 21. Exposure's techniques were all ink. 22. Each platform group in Statistics ran on its own scale.
// 46. A low-severity dot in the log wore the accent. 66. An Overview account told its platform by a square only.
// 74. The interpretation tag wore the flagged colour. 75. By platform's swatches were all grey.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { KitRow } from '../../../../src/ui/dashboard/components/chart-kit';

const src = (f: string) => readFileSync(new URL(`../../../../src/ui/dashboard/${f}`, import.meta.url), 'utf8');

describe('dashboard U3: one colour per meaning across tabs, 12 Oct 2026', () => {
  it('9: Exposure’s bar and legend read the rows’ families, in the rows’ order and colours', () => {
    const expo = src('components/ExposureView.tsx');
    expect(expo).toMatch(/\.\.\.ACTION_ROWS\.map\(\(row\) => \(\{ n: families\[row\.key\], color: row\.color,/);
    expect(expo).toMatch(/\.\.\.ACTION_ROWS\.filter\(\(row\) => families\[row\.key\] > 0\)\.map\(\(row\) => \(\{ color: row\.color, strong: families\[row\.key\]/);
    expect(expo).not.toMatch(/n: Math\.max\(0, flaggedCount - hiddenCount\)/);
  });

  it('20: blocked is the noise colour on the Timeline, in Usage time and in its pills; flagged is amber on the Timeline', () => {
    const css = src('dashboard-design.css');
    expect(css).toMatch(/\.fc-timeline \.fc-action-label\.blocked::before \{ background: var\(--fw-noise\); \}/);
    expect(css).toMatch(/\.fc-timeline \.fc-action-label\.flagged::before \{ background: var\(--fw-amber\); \}/);
    expect(css).toMatch(/\.usage-bar \.seg\.blocked \{ background: var\(--fw-noise\); \}/);
    for (const sel of ['.aggregate-pill.blocked', '.fc-action-label.blocked', '.fx-ledger-verdict.blocked']) {
      const line = css.split('\n').find((l) => l.startsWith(sel + ' '));
      expect(line, sel).toMatch(/background: var\(--fw-noise-soft\); color: var\(--fw-noise\);/);
    }
    expect(src('components/UsageTimePanel.tsx')).not.toMatch(/var\(--fw-purple\)/);
  });

  it('21 and 22: Exposure’s techniques wear their colours; the per-platform card has one scale', () => {
    // Through the map's themed reader since 12 Oct 2026, evening (the five named techniques take a light value).
    expect(src('components/ExposureView.tsx')).toMatch(/label=\{t\.techniqueLabel\(name\)\}\n\s*color=\{techniqueFill\(name\) \?\? TONE\.ink\}/);
    const stats = src('components/StatisticsTab.tsx');
    expect(stats).toMatch(/const platTechMax = Math\.max\(1, \.\.\.platTech\.map\(\(p\) => p\.top\[0\]\?\.\[1\] \?\? 0\)\);/);
    expect(stats).toMatch(/width=\{\(n \/ platTechMax\) \* 100\}/);
  });

  it('46: a low-severity dot is the low marker, darker in light', () => {
    expect(src('components/FeedLogTab.tsx')).toMatch(/return 'var\(--fw-marker-low\)';/);
    expect(src('dashboard-house.css')).toMatch(/:root\[data-theme="light"\] \{ --fw-marker-low: #2f7f77; \}/);
  });

  it('66: an Overview account row names its platform', () => {
    expect(src('components/OverviewTab.tsx')).toMatch(/\{pfLabel\(s\.platform\)\} · \{t\.ovSourceSeen\(s\.count\)\}/);
  });

  it('74: the interpretation tag is told by its dashed edge, not the flagged colour', () => {
    expect(src('dashboard-design.css')).toMatch(/\.fb-caution-tag \{[^}]*color: var\(--fw-muted\); border: 1px dashed var\(--fw-ink\);/);
  });

  it('75: a row’s swatch can name its entity while the bar stays a tone of ink', () => {
    const html = renderToStaticMarkup(React.createElement(KitRow, { label: 'x.com', color: 'grey', swatch: '#1da1f2', width: 50, count: 3, dot: true }));
    expect(html).toMatch(/class="fwc-dot" style="--sw:#1da1f2"/);
    expect(html).toMatch(/--c:grey/);
    expect(src('components/StatisticsTab.tsx')).toMatch(/swatch=\{PLATFORM_COLORS\[p\]\}/);
  });
});
