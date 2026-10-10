/** @vitest-environment jsdom */
//
// The headline figure of the Exposure tab said "This week" whatever period was
// chosen.
//
// The switcher offers three: this week, last week, and the last 4 weeks
// (28 days). The `<h3>` above the number was the literal `t.expoThisWeek` and
// the line under it was `t.expoThisWeekSub`, which ends "Week runs Sunday to
// Saturday". Neither depended on the choice, so a reader who picked 28 days was
// shown a 28-day total under a heading naming a week and a sentence describing
// how a week is cut.
//
// The same file had already fixed this for the chart's eyebrow and not for the
// card heading. In four languages, on the tab's headline number. Found
// 2026-09-19.
//
// The label each period prints was already here, in `periodChoiceLabel`, built
// for the switcher. The heading simply was not asking it.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { ExposureView } from '../../../../../src/ui/dashboard/components/ExposureView';
import { I18nProvider } from '../../../../../src/i18n/react';
import { DASHBOARD_STRINGS } from '../../../../../src/i18n/dashboard-strings';
import type { ForensicRecord } from '../../../../../src/types/forensic';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let seq = 0;
function rec(timestamp: string): ForensicRecord {
  seq++;
  return {
    id: `r-${seq}`, timestamp, platform: 'tiktok',
    originalText: 'a recorded item', originalHash: 'h', originalLength: 15,
    neutralizedText: '', author: 'someone', postUrl: '', techniques: [],
    overallScore: 0, userAgeCategory: 'adult', aiSource: 'cloud',
    feedSource: 'for-you', integrityHash: 'ih', chainPosition: seq,
    kind: 'post', verdict: 'pass',
  } as ForensicRecord;
}

let host: HTMLDivElement;
let root: Root;

/** A month of items, so every one of the three windows has something in it. */
const aMonth = (): ForensicRecord[] =>
  Array.from({ length: 28 }, (_, d) => rec(new Date(Date.now() - d * 24 * 3600_000).toISOString()));

async function render(lang: 'en' | 'ro' = 'en'): Promise<void> {
  await act(async () => {
    root.render(createElement(I18nProvider, { lang, children: createElement(ExposureView, { records: aMonth() }) }));
  });
  await act(async () => { await Promise.resolve(); });
}

/** The card heading, which is the one element this is about. */
const heading = (): string => host.querySelector('h3')?.textContent ?? '';

async function choosePeriod(label: string): Promise<void> {
  const button = [...host.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes(label));
  expect(button, `the switcher offers "${label}"`).toBeTruthy();
  await act(async () => { button!.click(); });
  await act(async () => { await Promise.resolve(); });
}

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  host.remove();
});

describe('the Exposure headline names its period (2026-09-19)', () => {
  it('says This week when this week is chosen', async () => {
    // The control: the default must not have moved.
    await render();
    expect(heading()).toBe(DASHBOARD_STRINGS.en.expoThisWeek);
  });

  it('says Last week when last week is chosen', async () => {
    await render();
    await choosePeriod('Last week');
    expect(heading()).toBe('Last week');
  });

  it('names the 28 days when the 28 days are chosen, and drops the week sentence', async () => {
    // Both halves. The heading is the finding; the sentence under it is the one
    // that was actively wrong rather than merely narrow, because a 28-day
    // window does not run Sunday to Saturday.
    await render();
    await choosePeriod('Last 4 weeks');
    expect(heading()).toContain('4 weeks');
    expect(host.textContent, 'the week-cut sentence is gone')
      .not.toContain('Week runs Sunday to Saturday');
    expect(host.textContent, 'and the period is described').toContain('last 28 days');
  });

  it('does it in Romanian too, since the heading is a string in four languages', async () => {
    await render('ro');
    expect(heading()).toBe(DASHBOARD_STRINGS.ro.expoThisWeek);
    await choosePeriod('Ultimele 4 săptămâni');
    expect(heading()).toContain('4 săptămâni');
    expect(host.textContent).not.toContain('duminică până sâmbătă');
  });
});
