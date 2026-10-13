// His walk of 12 Oct 2026 through the dashboard: three charts that did not read.
// V3: on Statistics the 95% interval rode in the bar row's narrow count column and ran up to 97px past the card; it is
//     now its own line under the bar (KitRow's note), and the count keeps "k/n · pct%".
// V5: the tone of the comment sections was three greys; it is a diverging scale (blue, grey, burnt orange) that never
//     borrows red, amber or green, which mean blocked, flagged and fine.
// V4: per platform, each technique keeps the colour the feed cards give it (TECHNIQUE_COLORS), not one white for all.

import { describe, expect, it } from 'vitest';
import * as React from 'react';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { KitRow } from '../../../../../src/ui/dashboard/components/chart-kit';
import { PatternsTab } from '../../../../../src/ui/dashboard/components/PatternsTab';
import { TONE } from '../../../../../src/ui/dashboard/house-tones';
import { I18nProvider } from '../../../../../src/i18n/react';
import type { ForensicRecord } from '../../../../../src/types/forensic';

const room = {
  id: 'room', timestamp: '2026-07-03T10:00:00.000Z', platform: 'tiktok', originalText: '', originalHash: 'h',
  originalLength: 0, neutralizedText: '', author: 'creator', postUrl: 'https://x/y', techniques: [], overallScore: 0,
  userAgeCategory: 'teen', aiSource: 'cloud', feedSource: 'for-you', integrityHash: 'ih', kind: 'environment',
  environment: { label: 'healthy-discussion', summary: 's', dominantTechnique: null, positivePct: 24, neutralPct: 56, negativePct: 20, sampled: 50 },
} as unknown as ForensicRecord;

const CSS = (f: string) => readFileSync(new URL(`../../../../../src/ui/dashboard/${f}`, import.meta.url), 'utf8');

describe('the charts of his 12 Oct walk read at a glance', () => {
  it('V3: an interval is a line of its own under the bar, never inside the count column', () => {
    const html = renderToStaticMarkup(React.createElement(KitRow, {
      label: 'anger', color: 'red', width: 50, count: '307/1060 · 29%', note: '95% interval 26–32%',
    }));
    expect(html).toMatch(/class="fwc-row has-note"/);
    expect(html).toMatch(/<span class="fwc-count">307\/1060 · 29%<\/span><span class="fwc-note">95% interval 26–32%<\/span>/);
    const css = CSS('dashboard-design.css');
    expect(css).toMatch(/\.fwc-note \{\s*grid-column: 2 \/ 4;/);
    expect(css).toMatch(/\.fwc-row\.has-note \{ grid-template-columns: 240px 1fr 120px;/);
  });

  it('V3: a row without a note keeps its old shape', () => {
    const html = renderToStaticMarkup(React.createElement(KitRow, { label: 'x', color: 'red', width: 10, count: 3 }));
    expect(html).toMatch(/class="fwc-row"/);
    expect(html).not.toContain('fwc-note');
  });

  it('V5: the three tones are three different colours from the tone scale, not greys of ink', () => {
    const html = renderToStaticMarkup(React.createElement(I18nProvider, {
      lang: 'en', children: React.createElement(PatternsTab, { records: [room], readingOffered: true }),
    }));
    for (const c of [TONE.tonePos, TONE.toneNeu, TONE.toneNeg]) expect(html).toContain(`background:${c}`);
    expect(html).not.toContain(`background:${TONE.light}`);
    const house = CSS('dashboard-house.css');
    for (const scope of [':root, :root[data-theme] {', ':root[data-theme="dark"]  {', ':root[data-theme="light"] {']) {
      const line = house.split('\n').find((l) => l.startsWith(scope) && l.includes('--fw-tone-pos'));
      expect(line, scope).toBeTruthy();
      // Never the status colours (ok, warn, danger) of either scheme.
      for (const status of ['#246b2b', '#8a4b00', '#b3261e', '#6fcf74', '#ffb454', '#ff8a80']) expect(line).not.toContain(status);
    }
  });

  it('V4: both technique charts of Statistics colour a technique by the shared map', () => {
    const src = readFileSync(new URL('../../../../../src/ui/dashboard/components/StatisticsTab.tsx', import.meta.url), 'utf8');
    // Through the map's themed reader since 12 Oct 2026, evening (the five named techniques take a light value).
    expect(src.match(/color=\{techniqueFill\(name\) \?\? TONE\.ink\}/g)?.length).toBe(2);
  });
});
