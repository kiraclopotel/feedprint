// @vitest-environment jsdom
// Wiring audit 13 Sep, D2-38 and D2-39: the filter chip is on the bucket row
// without opening the phrase list; phrases are counted whole and clipped only
// for display; an unknown bucket id matches nothing.

import { afterEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { SafetyCategoriesPanel, recordMatchesBucket, displayPhrase, type BucketId } from '../../../../../src/ui/dashboard/components/SafetyCategoriesPanel';
import { I18nProvider } from '../../../../../src/i18n/react';
import { DASHBOARD_STRINGS } from '../../../../../src/i18n/dashboard-strings';
import type { ForensicRecord } from '../../../../../src/types/forensic';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const swear = (id: string, evidence: string): ForensicRecord => ({
  id, timestamp: '2026-09-15T06:00:00Z', platform: 'twitter', originalText: 'x', verdict: 'flagged',
  techniques: [{ name: 'profanity', severity: 3, confidence: 1, evidence }],
} as unknown as ForensicRecord);

let host: HTMLDivElement;
let root: Root;
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

describe('safety categories', () => {
  it('shows the filter chip without expanding, and pressing it picks the bucket', async () => {
    const onPickBucket = vi.fn();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root.render(React.createElement(I18nProvider, { lang: 'en', children: React.createElement(SafetyCategoriesPanel, {
        records: [swear('a', 'a long swearing sentence number one here')], onPickBucket, activeBucket: null,
      }) }));
    });
    const label = DASHBOARD_STRINGS.en.safetyBucketLabel.swearing;
    const chip = Array.from(host.querySelectorAll('button')).find(b => b.textContent === DASHBOARD_STRINGS.en.safetyFilterTo(label)) as HTMLButtonElement;
    expect(chip, 'filter chip visible before any expand').toBeTruthy();
    await act(async () => { chip.click(); });
    expect(onPickBucket).toHaveBeenCalledWith('swearing');
  });

  it('counts two phrases that share their first 30 characters as two', async () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    const shared = 'an identical opening of thirty chars';
    await act(async () => {
      root.render(React.createElement(I18nProvider, { lang: 'en', children: React.createElement(SafetyCategoriesPanel, {
        records: [swear('a', `${shared} then one ending`), swear('b', `${shared} then another`)],
      }) }));
    });
    const row = host.querySelector('button[aria-expanded]') as HTMLButtonElement;
    await act(async () => { row.click(); });
    const counts = Array.from(host.querySelectorAll('span.chip strong')).map(s => s.textContent);
    expect(counts).toEqual(['×1', '×1']);
  });

  it('clips only for display, and an unknown bucket matches nothing', () => {
    expect(displayPhrase('short')).toBe('short');
    expect(displayPhrase('x'.repeat(40))).toHaveLength(30);
    expect(recordMatchesBucket(swear('a', 'fuck'), 'no-such-bucket' as BucketId)).toBe(false);
  });
});
