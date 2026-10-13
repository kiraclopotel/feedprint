// The polish program's first unit (12 Oct 2026, POLISH-2026-10-12.md, U0): six places a person confirmed on the walk.
// 1. Statistics' weekly flags were two slabs with no value; the balance card said its share twice.
// 2. Feed behavior's recurring voices table ran 37px past its card on a long handle (44 in Romanian).
// 3. The dashboard header's actions read as one search field and the plan name as a button; the Issues tab said 12
//    where its page said 1.
// 4. With a key, the popup Settings' two page buttons fell under the 600px fold (held in
//    tests/unit/ui/popup/receipts-settings-hold-only-the-recorder-switches.test.tsx).
// 5. The popup's big count took the other look's colour.
// 6. The License field's hint was cut mid-word in monospace and save was a grey ghost.

import { describe, expect, it } from 'vitest';
import * as React from 'react';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { KitCols, KitAxis } from '../../../../../src/ui/dashboard/components/chart-kit';

const src = (f: string) => readFileSync(new URL(`../../../../../src/ui/${f}`, import.meta.url), 'utf8');

describe('U0: what a person confirmed on the walk of 12 Oct 2026', () => {
  it('1: a capped column chart carries each value on its mark and keeps columns at most 72px', () => {
    const html = renderToStaticMarkup(React.createElement(KitCols, {
      height: 104, capped: true, cols: [{ tip: 'Oct 5 · 42', value: '42', parts: [{ h: 80, color: 'red' }] }, { tip: 'Oct 12 · 5', value: '5', parts: [{ h: 9, color: 'red' }] }],
    }));
    expect(html).toContain('class="fwc-cols capped"');
    expect(html.match(/class="fwc-col-val"[^>]*>(\d+)</g)?.length).toBe(2);
    expect(renderToStaticMarkup(React.createElement(KitAxis, { labels: ['a'], perCol: true, capped: true }))).toContain('class="fwc-axis per-col capped"');
    const css = src('dashboard/dashboard-design.css');
    expect(css).toMatch(/\.fwc-cols\.capped \.fwc-col \{ flex: 0 1 72px; \}/);
    const stats = src('dashboard/components/StatisticsTab.tsx');
    expect(stats).toMatch(/<KitCols\n\s*height=\{104\}\n\s*capped/);
    // The share is said once as a headline: the balance line is a caption under the legend, not a 22px line.
    expect(stats).toMatch(/<div className="fb-prov fwc-balance-line">\{t\.statsBalanceLine\(/);
    expect(stats).not.toMatch(/fontSize: 22, fontWeight: 700 \}\}>\{t\.statsBalanceLine/);
  });

  it('2: a name in the plain tables may break anywhere, so a long handle cannot push the table past its card', () => {
    expect(src('dashboard/dashboard-design.css')).toMatch(/table\.fb-plain td:not\(\.num\) \{ overflow-wrap: anywhere; \}/);
  });

  it('3: the header actions are pills, the plan is a label, the Issues tab shows its mark and no number', () => {
    const looks = src('dashboard/dashboard-looks.css');
    expect(looks).toMatch(/\.dash-header \.dash-record-actions \{ background: transparent; border: 0; padding: 0; gap: 8px; \}/);
    expect(looks).toMatch(/min-height: 32px; padding: 0 14px; border-radius: 16px;/);
    expect(looks).toMatch(/\.dash-header \.dash-tier-pill \{\n  background: none; border: 0; padding: 0;/);
    expect(src('dashboard/Dashboard.tsx')).not.toMatch(/\{t\.tabIssues\} \{opCount > 0 && <span className="count-pill">/);
  });

  it('5: the big count is the look’s own accent, never its second colour', () => {
    expect(src('popup/popup-panel.css')).toMatch(/\.fw-popup \.today-card \.pop-hero-value \{[^}]*color: var\(--fw-teal\);/);
    for (const f of ['popup/popup-life.css', 'popup/popup-looks.css']) {
      const lines = src(f).split('\n').filter((l) => l.includes('.pop-hero-value') && l.includes('color:'));
      for (const l of lines) expect(l, f).not.toMatch(/color: var\(--fw-purple\)/);
    }
  });

  it('6: the key field’s hint is in the body face and ends in an ellipsis; save is a pill of the family', () => {
    const css = src('popup/popup-design.css');
    expect(css).toMatch(/\.in-row input::placeholder \{ font-family: var\(--fw-font-sans, inherit\);[^}]*text-overflow: ellipsis; \}/);
    expect(css).toMatch(/\.in-row \.iconbtn\.key-save \{\n  min-height: 34px;/);
    expect(src('popup/panels/KeysTab.tsx')).toMatch(/className="iconbtn key-save" onClick=\{requestSave\}/);
  });
});
