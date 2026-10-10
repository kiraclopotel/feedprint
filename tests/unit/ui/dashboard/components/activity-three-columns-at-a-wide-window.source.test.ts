// At a wide window the Activity tab is three columns: the filter rail at the left, the feed in the middle, and
// the side cards as ONE column at the right edge of the window.
//
// Before, above 1840px, the side cards were split into two narrow CSS columns and the whole band was centred on a
// 1640px width, so on a 1914px window the cards started mid-page and crowded the feed. Read on a 1914px window.
//
// The rule is read from the stylesheet, because jsdom applies no media queries. The markup already holds the three
// in this order (the rail and the feed inside .feed-layout, then .side-rail); only the widths change here.

import { describe, it, expect } from 'vitest';
import { readSource } from '../../../../helpers/read-source';

function wideBlock(): string {
  const css = readSource('src/ui/dashboard/dashboard-design.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const start = css.indexOf('@media (min-width: 1840px)');
  expect(start, 'the wide breakpoint exists').toBeGreaterThan(-1);
  // Walk the braces to the end of the media block.
  let depth = 0;
  for (let i = css.indexOf('{', start); i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') { depth--; if (depth === 0) return css.slice(start, i + 1); }
  }
  throw new Error('unbalanced wide block');
}

function ruleIn(block: string, selector: string): string {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = block.match(new RegExp(esc + '\\s*\\{[^}]*\\}'));
  expect(m, `${selector} has a rule at the wide width`).not.toBeNull();
  return m![0];
}

describe('the Activity tab at a wide window', () => {
  it('keeps the side cards in one column, not two', () => {
    // No multi-column rule at the wide width; the side rail keeps its base one-column flex rule.
    expect(wideBlock()).not.toMatch(/(^|[\s;{])columns:/);
    const base = readSource('src/ui/dashboard/dashboard-design.css').match(/\n\.side-rail\s*\{[^}]*\}/);
    expect(base![0]).toMatch(/flex-direction:\s*column/);
  });

  it('gives the feed the free width and pins the side column to the right', () => {
    const grid = ruleIn(wideBlock(), '.dash-shell[data-tab="activity"] .activity-grid');
    expect(grid).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)\s+\d+px/);
    expect(grid).not.toMatch(/justify-content:\s*center/);
  });

  it('no longer centres the tab on a fixed band narrower than the window', () => {
    expect(wideBlock()).not.toMatch(/1640px/);
  });
});
