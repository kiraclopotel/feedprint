// The dashboard's last controls under 32px take the control height, and the four headings that scale with the window land
// on whole pixels. The controls kept at 24px as small targets stay as they are.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const dash = (f: string) => readFileSync(new URL(`../../../../src/ui/dashboard/${f}`, import.meta.url), 'utf8');

// The body of the single rule that starts a line with this selector.
const rule = (css: string, selector: string): string => {
  const at = css.indexOf(`\n${selector} {`);
  expect(at, selector).toBeGreaterThanOrEqual(0);
  expect(css.indexOf(`\n${selector} {`, at + 1), `${selector} is stated once`).toBe(-1);
  return css.slice(at, css.indexOf('}', at));
};

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

describe('dashboard: the last heights and the fluid headings', () => {
  it('the Timeline rail\'s options and search field are 32px tall', () => {
    const design = dash('dashboard-design.css');
    // The label sits at the top of a wrapped option, so a single line gets its room from the padding, not from the floor alone.
    expect(design).toMatch(/\n\.frail-opt \{\n[^}]*padding: 8px; min-height: 32px;/);
    expect(rule(design, '.frail-search input')).toMatch(/box-sizing: border-box;[^}]*min-height: 32px;/);
  });

  it('a Statistics or Exposure row that opens the Timeline is 32px tall, padding included', () => {
    expect(rule(dash('dashboard-design.css'), '.fwc-row.drill')).toMatch(/box-sizing: border-box; min-height: 32px;/);
  });

  it('the header\'s health line takes the height of the controls beside it', () => {
    expect(dash('dashboard-looks.css')).toMatch(/^\.dash-header \.dash-integrity-pill \{ box-sizing: border-box; min-height: 32px; \}$/m);
  });

  it('the controls kept as small targets are not raised', () => {
    const design = dash('dashboard-design.css');
    expect(design).toMatch(/\.frail-hint > button \{[^}]*min-height: 24px; min-width: 24px;/);
    // The period buttons sit inside a 32px group, so they stay at their own height.
    expect(rule(design, '.fwc-seg-switch button')).not.toMatch(/min-height|height:/);
  });

  it('each heading that scales with the window is rounded to a whole pixel, with the plain clamp kept for an engine without round()', () => {
    const frame = dash('dashboard-frame.css');
    const headings: Array<[string, string]> = [
      ['.today-head-line', 'clamp(2rem, 3.3vw, 3rem)'],
      ['.feed-welcome h3', 'clamp(1.75rem, 2.6vw, 2.25rem)'],
      ['.chain-banner-title', 'clamp(1.5rem, 2.4vw, 2rem)'],
      ['.ops-allgood h3', 'clamp(1.75rem, 2.6vw, 2.25rem)'],
    ];
    for (const [selector, clamp] of headings) {
      // The plain clamp first, the rounded one after it, both with the same importance.
      const both = new RegExp(`font-size: ${escapeRegex(clamp)}( !important)?;[^}]*font-size: round\\(nearest, ${escapeRegex(clamp)}, 1px\\)\\1;`);
      expect(rule(frame, selector), selector).toMatch(both);
    }
    // No heading of the sheet scales with the window without the rounded line beside it.
    expect(frame.match(/font-size: clamp\(/g)).toHaveLength(headings.length);
    expect(frame.match(/font-size: round\(nearest, clamp\(/g)).toHaveLength(headings.length);
  });
});
