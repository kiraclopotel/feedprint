// The polish program's dashboard U2 (12 Oct 2026, POLISH-BACKLOG-2026-10-12.md, "## Dashboard"): Statistics, the
// Tester's worst place, measured on a built copy (crew/visuals/du2-before and du2-after). Row 3's capped columns with
// their values came with U0 (u0-what-a-person-confirmed-12-oct.test.tsx).
// 4. Flagged was white in the charts and amber in the Feed log, on one page.
// 5. A number tile drew a card inside its card, the number touching the inner edge.
// 6. Neutral bars that carry a count were the hairline colour, 1.3:1 against their card.
// 17. The interval line was ink while the card's other small lines are muted.
// 19. Four tiles at a third each left 'blocked' alone on a row.
// 23. A column's value showed on the pointer only.
// 45. 'Seen a lot' wore the blocked colour and 'active platforms' the teal, meaning neither.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { TONE } from '../../../../src/ui/dashboard/house-tones';

const src = (f: string) => readFileSync(new URL(`../../../../src/ui/dashboard/${f}`, import.meta.url), 'utf8');

describe('dashboard U2: Statistics after the walk of 12 Oct 2026', () => {
  it('4: flagged is the warn colour in every chart that draws it', () => {
    expect(TONE.flagged).toBe('var(--fw-warn, var(--fw-amber))');
    const stats = src('components/StatisticsTab.tsx');
    expect(stats).toMatch(/color: TONE\.flagged \}\],\n/);
    expect(stats).toMatch(/stackedColumn\(d\.total, d\.flagged, dailyMax, 92, TONE\.flagged\)/);
    expect(stats).toMatch(/\{ label: t\.statsBalanceFlagged, n: flagged, color: TONE\.flagged \}/);
    expect(stats).toMatch(/label=\{t\.kpiFlagged\} color=\{TONE\.flagged\}/);
    expect(src('components/OverviewTab.tsx').match(/\[t\.statsBalanceFlagged, balance\.flagged, TONE\.flagged\]/g)?.length).toBe(2);
    const expo = src('components/ExposureView.tsx');
    expect(expo).toMatch(/\{ key: 'detection',  color: TONE\.flagged \}/);
    expect(expo).toMatch(/stackedColumn\(b\.total, b\.flagged, dayMax, 48, TONE\.flagged\)/);
    expect(expo).not.toMatch(/color: TONE\.ink, strong: flaggedCount/);
  });

  it('5: a number tile is not given the card look inside its card', () => {
    const frame = src('dashboard-frame.css');
    const list = frame.slice(0, frame.indexOf('.pat-section {'));
    expect(list.slice(list.lastIndexOf('.feed-card,'))).not.toMatch(/\.fwc-tile/);
  });

  it('6: a neutral bar is drawn at 3:1 and above, not in the hairline colour', () => {
    expect(src('dashboard-house.css')).toMatch(/--fwc-neutral: color-mix\(in oklab, var\(--fw-ink\) 46%, var\(--fw-ground\)\);/);
    expect(TONE.light).toBe('var(--fwc-neutral, var(--fw-line, var(--fw-border)))');
    expect(src('dashboard-frame.css')).toMatch(/\.today-head-day i \{[^}]*background: var\(--fwc-neutral\); \}/);
  });

  it('17: the interval line is muted', () => {
    expect(src('components/StatisticsTab.tsx')).toMatch(/className="fwc-pct" style=\{\{ fontSize: 13, marginTop: 2, color: 'var\(--fw-muted\)' \}\}/);
  });

  it('19: the first four tiles share one row, two a row under 980px', () => {
    expect(src('components/StatisticsTab.tsx').match(/<SnapshotTile quarter /g)?.length).toBe(4);
    const css = src('dashboard-design.css');
    expect(css).toMatch(/\.stats-card\.quarter \{ grid-column: span 3; \}/);
    expect(css).toMatch(/@media \(max-width: 980px\) \{ \.stats-grid > \.stats-card\.quarter \{ grid-column: span 6; \} \}/);
  });

  it('23: a column shows its value on keyboard focus as on the pointer', () => {
    expect(src('dashboard-design.css')).toMatch(/\.fwc-col\[data-tip\]:hover::after, \.fwc-col\[data-tip\]:focus-visible::after \{/);
  });

  it('45: Seen a lot and active platforms are ink; flagged and blocked keep their meaning colours', () => {
    const stats = src('components/StatisticsTab.tsx');
    expect(stats).toMatch(/<SnapshotTile quarter value=\{sets\.seenALot\} label=\{seenALotLabel\} \/>/);
    expect(stats).toMatch(/<SnapshotTile value=\{platforms24h\} label=\{t\.kpiActivePlatforms\} \/>/);
    expect(stats).toMatch(/label=\{t\.kpiBlocked\} color=\{TONE\.noise\}/);
  });
});
