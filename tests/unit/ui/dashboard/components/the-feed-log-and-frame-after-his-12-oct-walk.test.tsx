// His walk of 12 Oct 2026 through the dashboard, the rows after the charts.
// V1: the Feed log's filters are one bar (the window and the outcome as two joined groups, the clock note at its end),
//     not three lines that pushed the list below his window.
// V6: an account he stopped recording can be found and opened again: the Feed log filters by one account, the Record
//     tab's list opens the Feed log on it, and the Feed log's bar opens that list.
// V7: the Feed log's table holds the page's width instead of reaching out to 1600px.
// V2 and V8: the filter rail's hover is the accent's tint with an edge, and anything pressable answers the pointer and
//     the keyboard with the accent.

import { describe, expect, it } from 'vitest';
import * as React from 'react';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { FeedLogTab } from '../../../../../src/ui/dashboard/components/FeedLogTab';
import { feedLogSlice } from '../../../../../src/ui/dashboard/components/feed-log';
import { exclusionKey } from '../../../../../src/forensics/author-exclusions';
import { I18nProvider } from '../../../../../src/i18n/react';
import { DASHBOARD_STRINGS } from '../../../../../src/i18n/dashboard-strings';
import type { ForensicRecord } from '../../../../../src/types/forensic';

const AT = '2026-10-12T08:00:00.000Z';
const rec = (id: string, author: string, platform = 'instagram'): ForensicRecord => ({
  id, timestamp: AT, platform, originalText: 'sample text', originalHash: 'h', originalLength: 11, neutralizedText: '',
  author, postUrl: 'https://www.instagram.com/p/1', techniques: [], overallScore: 0, userAgeCategory: 'teen',
  aiSource: 'rules', feedSource: 'home', integrityHash: 'ih', verdict: 'pass', kind: 'post', chainPosition: 3,
} as unknown as ForensicRecord);

const src = (f: string) => readFileSync(new URL(`../../../../../src/ui/dashboard/${f}`, import.meta.url), 'utf8');

describe('the Feed log and the frame after his 12 Oct walk', () => {
  it('V1: the window, the outcome and the clock note sit in one bar above the list', () => {
    const html = renderToStaticMarkup(React.createElement(I18nProvider, {
      lang: 'en',
      children: React.createElement(FeedLogTab, { records: [rec('a', '@one')], filter: { window: 'all' }, onFilter: () => {}, integrity: null } as unknown as React.ComponentProps<typeof FeedLogTab>),
    }));
    const bar = html.slice(html.indexOf('class="fl-bar"'), html.indexOf('class="fl-wrap"'));
    expect(bar).toBeTruthy();
    expect(bar.split('class="fl-chips"').length - 1).toBe(2);
    expect(bar).toContain(DASHBOARD_STRINGS.en.feedLogClock);
    expect(html.split(DASHBOARD_STRINGS.en.feedLogClock).length - 1).toBe(1);
    expect(src('dashboard-design.css')).toMatch(/\.fl-bar \.fl-chips \.chip \+ \.chip \{ margin-left: -1px; \}/);
  });

  it('V6: the Feed log filters by one account, with or without @ and in any case', () => {
    const rows = [rec('a', '@Sunrise.Bakery'), rec('b', 'sunrise.bakery'), rec('c', '@other'), rec('d', '@sunrise.bakery', 'facebook')];
    const slice = feedLogSlice(rows, { window: 'all', account: { key: exclusionKey('instagram', '@sunrise.bakery'), label: '@sunrise.bakery' } }, new Date(AT));
    expect(slice.rows.map((r) => r.id).sort()).toEqual(['a', 'b']);
  });

  it('V6: the way back is wired both ways, with words the dashboard already has', () => {
    const dash = src('Dashboard.tsx');
    expect(dash).toMatch(/onOpenExclusions=\{openExclusions\}/);
    expect(dash).toMatch(/onOpenAccount=\{\(e\) => openFeedLog\(\{ account: \{ key: e\.key, label: e\.author \} \}\)\}/);
    const log = src('components/FeedLogTab.tsx');
    expect(log).toMatch(/\{t\.exclusionsTitle\} <b>\{formatCount\(excludedKeys\.size, lang\)\}<\/b>/);
    const recordTab = src('components/ForensicsTab.tsx');
    expect(recordTab).toMatch(/onClick=\{\(\) => onOpenAccount\(e\)\}>\{t\.tabFeedLog\}/);
  });

  it('V7: the Feed log table holds the page width', () => {
    const css = src('dashboard-design.css');
    expect(css).not.toMatch(/width: min\(1600px/);
    expect(css).toMatch(/\.fl-wrap \{\n  width: auto;\n  margin-left: 0;/);
  });

  it('V2 and V8: the rail hover is the accent tint with an edge; every control has a hover and a focus fallback', () => {
    const looks = src('dashboard-looks.css');
    expect(looks).toMatch(/\.frail-opt:not\(\.on\):hover,\n\.frail-opt:not\(\.on\):focus-visible \{\n  background: color-mix\(in oklch, var\(--fw-record\) 14%, var\(--fw-ground\)\); color: var\(--fw-ink\);\n  box-shadow: inset 3px 0 0 var\(--fw-record\);/);
    expect(looks).toMatch(/:where\(\.dash-root\) :where\(button, summary, \[role="button"\], a\[href\], select\):not\(:disabled\):hover \{/);
    expect(looks).toMatch(/:where\(\.dash-root\) :where\(button, summary, \[role="button"\], \[role="tab"\], \[tabindex="0"\], a\[href\], select, input\):focus-visible \{\n  outline: 2px solid var\(--fw-record\);/);
    // A bar read by its tooltip does not show the hand.
    expect(looks).toMatch(/\.usage-bar \{ cursor: help; \}/);
  });
});
