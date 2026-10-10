/** @vitest-environment jsdom */
//
// "FeelingWise hasn't witnessed enough yet" is true on a fresh install and
// false on a record holding thousands of items the reader simply has not
// browsed this week.
//
// The Exposure view slices the record into a window and a previous window. When
// both came back empty it printed the fresh-install sentence, whatever the rest
// of the record held, so a household coming back from a holiday was told its
// recorder had seen nothing (2026-09-17, on the dashboard probe's own seeded
// profile: 36 records in the chain, all from August, and the week view said
// nothing had been witnessed). Two facts, two sentences.

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
    id: `r-${seq}`,
    timestamp,
    platform: 'tiktok',
    originalText: 'a recorded item',
    originalHash: 'h',
    originalLength: 15,
    neutralizedText: '',
    author: 'someone',
    postUrl: '',
    techniques: [],
    overallScore: 0,
    userAgeCategory: 'adult',
    aiSource: 'cloud',
    feedSource: 'for-you',
    integrityHash: 'ih',
    chainPosition: seq,
    kind: 'post',
    verdict: 'pass',
  } as ForensicRecord;
}

let host: HTMLDivElement;
let root: Root;

async function render(records: ForensicRecord[], lang: 'en' | 'ro' = 'en'): Promise<string> {
  await act(async () => {
    root.render(createElement(I18nProvider, {
      lang,
      children: createElement(ExposureView, { records }),
    }));
  });
  // The windows are computed off the render; let the effects settle.
  await act(async () => { await Promise.resolve(); });
  return host.textContent ?? '';
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

describe('the Exposure view tells an empty record from an empty window', () => {
  it('an empty record says nothing has been witnessed yet', async () => {
    const text = await render([]);
    expect(text).toContain(DASHBOARD_STRINGS.en.expoEmpty);
  });

  it('a record with nothing in this window says so, and says where the newest item is', async () => {
    // Two months back: outside this week and outside the previous week.
    const old = new Date(Date.now() - 60 * 24 * 3600_000).toISOString();
    const text = await render([rec(old)]);

    expect(text).not.toContain(DASHBOARD_STRINGS.en.expoEmpty);
    expect(text).toContain('Nothing was recorded in this window');
    // The date is what tells the reader where to look; the year is enough to
    // prove it came from the record rather than from the window.
    expect(text).toContain(String(new Date(old).getFullYear()));
  });

  it('says it in the language the dashboard is in', async () => {
    const old = new Date(Date.now() - 60 * 24 * 3600_000).toISOString();
    const text = await render([rec(old)], 'ro');
    expect(text).toContain('Nu s-a înregistrat nimic în acest interval');
    expect(text).not.toContain('Nothing was recorded in this window');
  });
});
