// The polish program's dashboard U1 (12 Oct 2026, POLISH-BACKLOG-2026-10-12.md, "## Dashboard", rows 10 to 14): the
// header and the tab strip, measured on a built copy (crew/visuals/du1-before and du1-after).
// 10. The open tab was bold, 7px wider, so every tab after it moved on each click.
// 11. The page moved sideways between a short tab and a long one.
// 12. "Record is healthy" had no light (the heartbeat it drew is hidden in the header); a dialog was a flat box.
// 13. The small labels were spaced 0.06 to 0.16em apart.
// 14. The header's controls were 28 to 34px tall; the count was the only weight-800 text.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const src = (f: string) => readFileSync(new URL(`../../../../src/ui/dashboard/${f}`, import.meta.url), 'utf8');

describe('dashboard U1: the header and the tab strip after the walk of 12 Oct 2026', () => {
  it('10: the open tab keeps the strip weight, so no tab moves', () => {
    expect(src('dashboard-frame.css')).toMatch(/\.dash-tab\.active \{[^}]*font-weight: 500;/);
    // And the nine English tabs fit one row at 900 in the shipped face; Romanian scrolls in one line, never two rows.
    expect(src('dashboard-frame.css')).toMatch(/\.dash-tabs \{ flex-wrap: nowrap; justify-content: flex-start; overflow-x: auto;/);
    // Under 1000px the words 'last record' leave the eye but not the screen reader.
    expect(src('components/DashHeader.tsx')).toMatch(/<span className="dash-last-label">\{t\.hdrLastRecord\}<\/span>/);
    expect(src('dashboard-frame.css')).toMatch(/@media \(max-width: 1000px\) \{ \.dash-tab \{ padding-left: 12px; padding-right: 12px; \} \}/);
  });

  it('11: the scrollbar room is always kept', () => {
    expect(src('dashboard-design.css')).toMatch(/html \{ scrollbar-gutter: stable; \}/);
  });

  it('12: the health line draws its square in every state, healthy with a glow; a dialog has lift', () => {
    const header = src('components/DashHeader.tsx');
    expect(header).not.toMatch(/dash-ecg/);
    expect(header).toMatch(/<span className="dot" \/>/);
    expect(src('dashboard-frame.css')).toMatch(/\.dash-integrity-pill\.ok \.dot \{[^}]*width: 8px; height: 8px; box-shadow:/);
    expect(src('dashboard-looks.css')).toMatch(/\.modal \{\n  border-color: color-mix\(in oklch, var\(--fw-record\) 38%/);
  });

  it('13: the header small labels use the house label spacing', () => {
    const design = src('dashboard-design.css');
    for (const sel of ['.dash-wordmark-text small', '.pg-records-chip .pg-trust-chip-label', '.dash-tier-pill']) {
      const rules = design.split('\n').filter((l) => l.startsWith(sel + ' {') && l.includes('letter-spacing'));
      for (const l of rules) expect(l, sel).toMatch(/letter-spacing: var\(--fw-track-label\)/);
    }
    expect(src('dashboard-looks.css')).toMatch(/\.dash-header \.dash-tier-pill \{[^}]*letter-spacing: var\(--fw-track-label\);/);
  });

  it('14: one 32px control height in the header; the count is weight 700', () => {
    const looks = src('dashboard-looks.css');
    expect(looks).toMatch(/\.dash-header \.dash-icon-btn \{ box-sizing: border-box; width: 32px; height: 32px; \}/);
    expect(looks).toMatch(/\.dash-header \.pg-records-chip \{ box-sizing: border-box; height: 32px; align-items: center; \}/);
    expect(src('dashboard-design.css')).toMatch(/\.pg-records-chip \.pg-trust-chip-count \{[^}]*font-weight: 700;/);
  });
});
