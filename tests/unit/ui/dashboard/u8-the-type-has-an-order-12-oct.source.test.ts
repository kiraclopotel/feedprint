// The polish program's dashboard U8 (12 Oct 2026, POLISH-BACKLOG-2026-10-12.md, "## Dashboard", rows 18, 28, 41, 42, 43, 44, 47):
// the dashboard's type has an order, measured on a built copy before and after.
// 18. An explanation under a card title was 12px because a later rule beat the shell's 15px. It is the 14px caption size.
// 28. "Accounts not recorded" was a 14px title among 20px titles.
// 41 and 44. The verdict badges and the Record's small labels were spaced 0.07 to 0.09em apart; the house label spacing is 0.02em.
// 42. A Feed log row at 1200px and wider had three text sizes; its cells are one size, the verdict chip alone smaller.
// 43. The Overview's feed balance headline was larger than its card title.
// 47. The Timeline's gap divider was set as a heading with an accent square.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const src = (f: string) => readFileSync(new URL(`../../../../src/ui/dashboard/${f}`, import.meta.url), 'utf8');

// The body of the single rule that starts a line with this selector.
const rule = (css: string, selector: string): string => {
  const at = css.indexOf(`\n${selector} {`);
  expect(at, selector).toBeGreaterThanOrEqual(0);
  expect(css.indexOf(`\n${selector} {`, at + 1), `${selector} is stated once`).toBe(-1);
  return css.slice(at, css.indexOf('}', at));
};

describe('dashboard U8: the type has an order', () => {
  it('18: the explanation under a card title is 14px and no rule pins it to 12px', () => {
    expect(rule(src('dashboard-frame.css'), '.stats-sub')).toMatch(/font-size: \.875rem;/);
    expect(rule(src('dashboard-design.css'), '.stats-card .stats-sub')).not.toMatch(/font-size/);
  });

  it('28: the Accounts-not-recorded title is as large as every other card title', () => {
    expect(src('components/ForensicsTab.tsx')).toContain("<h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, letterSpacing: '-0.015em', lineHeight: 1.2 }}>{t.exclusionsTitle}</h3>");
  });

  it('41 and 44: badges and small labels use the house label spacing', () => {
    const design = src('dashboard-design.css');
    for (const sel of ['.fx-ledger-verdict', '.fc-action-label', '.usage-summary-item .l', '.anchor-row .anchor-data .anchor-label']) {
      expect(rule(design, sel), sel).toMatch(/letter-spacing: var\(--fw-track-label\);/);
    }
    expect(design).toMatch(/\.fc-timeline \.fc-action-label \{[^}]*letter-spacing: var\(--fw-track-label\);/);
  });

  it('42: a Feed log row is one text size across its cells at every width, and the verdict chip stays smaller', () => {
    const design = src('dashboard-design.css');
    for (const sel of ['.fx-ledger-time', '.fx-ledger-platform', '.fx-ledger-sev']) expect(rule(design, sel), sel).toMatch(/font-size: 13px;/);
    expect(rule(design, '.fl-row')).toMatch(/font-size: 13px;/);
    expect(design).toMatch(/@media \(min-width: 1200px\) \{\n  \.fl-row \{[^}]*font-size: 13px; \}/);
    expect(rule(design, '.fx-ledger-verdict')).toMatch(/font-size: 12px;/);
  });

  it('43: the feed balance headline sits under its card title', () => {
    expect(rule(src('dashboard-design.css'), '.ov-balance-headline')).toMatch(/font-size: 18px; font-weight: 600;/);
  });

  it('47: the gap divider is a quiet line, not a heading', () => {
    const css = src('dashboard-design.css');
    expect(rule(css, '.fc-tl-session .lbl')).toMatch(/font-size: 12px; font-weight: 500; letter-spacing: var\(--fw-track-label\); text-transform: none; color: var\(--fw-muted\);/);
    expect(rule(css, '.fc-tl-session .lbl::before')).toMatch(/background: var\(--fw-muted\);/);
  });
});
