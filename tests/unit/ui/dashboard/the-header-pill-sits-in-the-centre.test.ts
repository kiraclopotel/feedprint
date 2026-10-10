// @vitest-environment jsdom
//
// The "Record is healthy" pill sat at the right, among the theme button, the tier and the record count, where it
// read as one more setting. It is the header's one status, so it has the middle of the row to itself: left, the
// wordmark and the record's actions; centre, the pill; right, everything else.
//
// Two halves, both needed. The markup gives the pill its own slot between the two groups, and the stylesheet
// centres that slot on the row, so the pill lands in the middle however wide the two sides are.

import { describe, it, expect } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DashHeader } from '../../../../src/ui/dashboard/components/DashHeader';
import { I18nProvider } from '../../../../src/i18n/react';
import { readSource } from '../../../helpers/read-source';

function render(): HTMLElement {
  const html = renderToStaticMarkup(
    React.createElement(I18nProvider, {
      lang: 'en',
      children: React.createElement(DashHeader, {
        records: [],
        integrity: null,
        license: { tier: 'free' } as never,
        theme: 'dark',
        setTheme: () => {},
        onVerify: () => {},
        onReset: () => {},
      }),
    }),
  );
  const host = document.createElement('div');
  host.innerHTML = html;
  return host;
}

describe('the header pill sits in the centre of the row', () => {
  it('has three slots, with the pill alone in the middle one', () => {
    const inner = render().querySelector('.dash-header-inner')!;
    const slots = [...inner.children];
    expect(slots.map((s) => s.className)).toEqual(['dash-header-left', 'dash-header-centre', 'dash-header-meta']);
    expect(slots[0].querySelector('.dash-wordmark')).not.toBeNull();
    expect(slots[0].querySelector('.dash-record-actions')).not.toBeNull();
    expect(slots[1].querySelector('.dash-integrity-pill')).not.toBeNull();
    expect(slots[2].querySelector('.dash-integrity-pill')).toBeNull();
    expect(slots[2].querySelector('.dash-tier-stack')).not.toBeNull();
  });

  it('centres the middle slot with two equal side tracks', () => {
    const css = readSource('src/ui/dashboard/dashboard-design.css').replace(/\/\*[\s\S]*?\*\//g, '');
    const inner = [...css.matchAll(/\.dash-header-inner\s*\{[^}]*\}/g)].map((m) => m[0]);
    expect(inner.some((r) => /display:\s*grid/.test(r) && /grid-template-columns:\s*1fr auto 1fr/.test(r))).toBe(true);
    expect(css).toMatch(/\.dash-header-left\s*\{[^}]*justify-self:\s*start/);
    expect(css).toMatch(/\.dash-header-centre\s*\{[^}]*justify-self:\s*center/);
    expect(css).toMatch(/\.dash-header-meta\s*\{[^}]*justify-self:\s*end/);
  });

  it('lets the left slot wrap at 1000px and below, as the whole header did before it had slots', () => {
    // In Romanian at a 900px window the header ran past the window until it was allowed a second line.
    // The wordmark and the record's actions now sit in one slot, so that slot has to be allowed to wrap too.
    const css = readSource('src/ui/dashboard/dashboard-design.css').replace(/\/\*[\s\S]*?\*\//g, '');
    const start = css.indexOf('@media (max-width: 1000px)');
    expect(start, 'the narrow header rule exists').toBeGreaterThan(-1);
    let depth = 0;
    let block = '';
    for (let i = css.indexOf('{', start); i < css.length; i++) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') { depth--; if (depth === 0) { block = css.slice(start, i + 1); break; } }
    }
    expect(block).toMatch(/\.dash-header-inner\s*\{[^}]*display:\s*flex[^}]*flex-wrap:\s*wrap/);
    expect(block).toMatch(/\.dash-header-left\s*\{[^}]*flex-wrap:\s*wrap/);
  });
});
