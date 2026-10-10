/** @vitest-environment jsdom */
//
// On the Exposure tab, "Observed again and again" comes first and the period's headline ("This week") below it:
// the threads a feed served over and over are what a parent opens this tab to see.
//
// When nothing repeated, the empty sentence stays lower down: an empty card at the top would push the headline
// down to say nothing.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { ExposureView } from '../../../../../src/ui/dashboard/components/ExposureView';
import { I18nProvider } from '../../../../../src/i18n/react';
import { DASHBOARD_STRINGS } from '../../../../../src/i18n/dashboard-strings';
import type { ForensicRecord } from '../../../../../src/types/forensic';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let seq = 0;
function rec(over: Partial<ForensicRecord> = {}): ForensicRecord {
  seq++;
  return {
    id: `r-${seq}`, timestamp: new Date(Date.now() - seq * 60_000).toISOString(), platform: 'tiktok',
    originalText: 'a recorded item', originalHash: 'h', originalLength: 15,
    neutralizedText: '', author: 'someone', postUrl: '', techniques: [],
    overallScore: 0, userAgeCategory: 'adult', aiSource: 'cloud',
    feedSource: 'for-you', integrityHash: 'ih', chainPosition: seq,
    kind: 'post', verdict: 'pass',
    ...over,
  } as ForensicRecord;
}

let host: HTMLDivElement;
let root: Root;

async function render(records: ForensicRecord[]): Promise<string[]> {
  await act(async () => {
    root.render(createElement(I18nProvider, { lang: 'en', children: createElement(ExposureView, { records }) }));
  });
  await act(async () => { await Promise.resolve(); });
  return [...host.querySelectorAll('h3')].map((h) => h.textContent ?? '');
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

const en = DASHBOARD_STRINGS.en;

describe('the Exposure tab puts the repeats first', () => {
  it('shows "Observed again and again" above "This week" when a thread repeated', async () => {
    const room = { roomCaption: 'the same thread, served again', roomUrl: 'https://www.tiktok.com/@a/video/1' };
    const headings = await render([rec(room), rec(room), rec(room), rec()]);
    const repeated = headings.indexOf(en.expoRepeatedTitle);
    const week = headings.indexOf(en.expoThisWeek);
    expect(repeated, 'the repeats card is there').toBeGreaterThan(-1);
    expect(week, 'the headline is there').toBeGreaterThan(-1);
    expect(repeated).toBeLessThan(week);
    // First of all the cards, and across the whole width.
    expect(repeated).toBe(0);
    const card = [...host.querySelectorAll('h3')][repeated].closest('.stats-card')!;
    expect(card.classList.contains('full')).toBe(true);
  });

  it('keeps the headline first when nothing repeated', async () => {
    const headings = await render([rec(), rec()]);
    expect(headings[0]).toBe(en.expoThisWeek);
    expect(headings).toContain(en.expoRepeatedTitle);
  });
});
