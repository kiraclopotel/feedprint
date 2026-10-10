// Activity-feed virtualization invariants (known-issues M34 / record #412).
//
// The feed is virtualized by EXACTLY ONE mechanism: the JS useVirtualScroll window
// (spacers + a sliced range). Scroll position is held by NATIVE browser anchoring
// (CSS overflow-anchor), not JS. These guards lock the M34 fixes in:
//   1. content-visibility is gone from the feed stylesheet (it was a redundant
//      SECOND virtualizer whose intrinsic↔real height flip made media cards pop/jump).
//   2. native scroll anchoring is ON: the .fc-timeline container does NOT set
//      overflow-anchor:none, while the (zero-content) spacers DO — so the browser
//      anchors to a real row, never a spacer. The old JS window.scrollTo compensator
//      (which raced the scroll handler and yanked the feed up a row) is gone.
//   3. computeVirtualRange bounds the mounted set to O(viewport) regardless of chain
//      length — windowing, not content-visibility, keeps the DOM small.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { repoPath } from '../../../../helpers/repo-root';

import {
  computeVirtualRange,
  FEED_OVERSCAN,
  FEED_ESTIMATED_H,
} from '../../../../../src/ui/dashboard/components/virtual-scroll';

function readProjectFile(path: string): string {
  return readFileSync(repoPath(...path.split(String.fromCharCode(47))), 'utf8');
}

const DASHBOARD_DESIGN_CSS_PATH = 'src/ui/dashboard/dashboard-design.css';

/** CSS with /* … *​/ comments stripped — so a property check can't match prose. */
function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Body of the first CSS rule whose selector text starts with `selectorStart`. */
function ruleBody(css: string, selectorStart: string): string {
  const at = css.indexOf(selectorStart);
  expect(at, `rule ${selectorStart} must exist`).toBeGreaterThan(-1);
  const open = css.indexOf('{', at);
  const close = css.indexOf('}', open);
  expect(open).toBeGreaterThan(-1);
  expect(close).toBeGreaterThan(open);
  return css.slice(open + 1, close);
}

describe('Activity-feed: single virtualizer + native anchoring (M34 regression guard)', () => {
  const css = readProjectFile(DASHBOARD_DESIGN_CSS_PATH);
  const cssNoComments = stripCssComments(css);

  it('no content-visibility anywhere in the feed stylesheet (the M34 pop/jump cause)', () => {
    expect(cssNoComments).not.toMatch(/content-visibility/);
  });

  it('no contain-intrinsic-size either (inert without cv, and confusing)', () => {
    expect(cssNoComments).not.toMatch(/contain-intrinsic-size/);
  });

  it('the .fc-timeline container does NOT disable scroll anchoring (native anchoring holds position)', () => {
    expect(ruleBody(css, '.fc-timeline {')).not.toMatch(/overflow-anchor/);
  });

  it('the spacers DO keep overflow-anchor:none (a zero-content spacer is never the anchor)', () => {
    expect(ruleBody(css, '.fc-virtual-spacer')).toMatch(/overflow-anchor:\s*none/);
  });
});

describe('Activity-feed: windowing bounds the DOM O(viewport), independent of count', () => {
  const keyAt = (i: number) => `k${i}`;
  const VIEW_H = 1080;
  // Worst case (every row at the minimum estimate) mounted-row count.
  const maxRows = Math.ceil((VIEW_H + 2 * FEED_OVERSCAN) / FEED_ESTIMATED_H) + 4; // + slack

  function windowAt(count: number) {
    const scrollY = Math.floor((count * FEED_ESTIMATED_H) / 2); // middle of the feed
    return computeVirtualRange(count, keyAt, new Map(), 0, scrollY, VIEW_H);
  }

  it('mounts only a viewport-sized window at 10k records', () => {
    const r = windowAt(10_000);
    const mounted = r.end - r.start + 1;
    expect(mounted).toBeGreaterThan(0);
    expect(mounted).toBeLessThanOrEqual(maxRows);
    // Spacers preserve the full scroll height above and below the window.
    expect(r.topH).toBeGreaterThan(0);
    expect(r.bottomH).toBeGreaterThan(0);
  });

  it('mounts the SAME-sized window at 50k as at 10k (count-independent)', () => {
    const a = windowAt(10_000);
    const b = windowAt(50_000);
    const mountedA = a.end - a.start + 1;
    const mountedB = b.end - b.start + 1;
    expect(Math.abs(mountedA - mountedB)).toBeLessThanOrEqual(2);
    expect(mountedB).toBeLessThanOrEqual(maxRows);
  });
});

describe('Activity-feed: unmount ResizeObserver tick must never poison the height map', () => {
  // A row removed from the DOM by the windowing gets a FINAL ResizeObserver
  // callback with contentRect 0×0. If that 0 is stored, the spacer math counts
  // every previously-unmounted row as 0px tall (`?? FEED_ESTIMATED_H` does not
  // rescue a stored 0) — the feed's total height collapses/restores at rAF
  // rate and native scroll anchoring turns it into self-sustaining whole-feed
  // flicker + scroll teleports (found 2026-07-01, post-reset feed).
  // Browser-verified both ways in
  // docs/redesign/mockups/2026-07-01/feed-divider-oscillation.html:
  // jump-park at 20000px → dragged to 0 with recompute churn unguarded;
  // motionless with 0 recomputes guarded.

  it('the math honors a stored 0 (this is WHY the guard is load-bearing)', () => {
    const keyAt = (i: number) => `k${i}`;
    const exact = new Map([['k0', 500], ['k1', 500], ['k2', 500]]);
    const poisoned = new Map([['k0', 0], ['k1', 500], ['k2', 500]]);
    const scrollY = 500 + FEED_OVERSCAN + 1; // just past row 0's unmount edge
    const a = computeVirtualRange(3, keyAt, exact, 0, scrollY, 1080);
    const b = computeVirtualRange(3, keyAt, poisoned, 0, scrollY, 1080);
    // Same scroll position, but the poisoned map places the window one row
    // further down — a row the user should see is skipped ("skips posts").
    expect(a.start).toBe(1);
    expect(b.start).toBe(2);
    // And the implied total feed height collapses by the poisoned row's real
    // 500px — the shrink native scroll anchoring converts into a scroll jump.
    const total = (r: { topH: number; bottomH: number; start: number; end: number },
                   h: Map<string, number>) => {
      let mounted = 0;
      for (let i = r.start; i <= r.end; i++) mounted += h.get(keyAt(i)) ?? FEED_ESTIMATED_H;
      return r.topH + mounted + r.bottomH;
    };
    expect(total(a, exact)).toBe(1500);
    expect(total(b, poisoned)).toBe(1000);
  });

  // The guard itself (a disconnected row's 0x0 tick is never stored) is a
  // behavior test that mounts the hook: tests/unit/ui/dashboard/components/use-virtual-scroll.test.ts.
});
