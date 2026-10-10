// @vitest-environment jsdom
// Wiring audit 13 Sep, D1-22: a "most recorded techniques" bar counts records
// by their DOMINANT technique; pressing it opens exactly those records, not
// every record that carries the technique anywhere.

import { afterEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { StatisticsTab } from '../../../../../src/ui/dashboard/components/StatisticsTab';
import { I18nProvider } from '../../../../../src/i18n/react';
import { DASHBOARD_STRINGS } from '../../../../../src/i18n/dashboard-strings';
import type { ForensicRecord } from '../../../../../src/types/forensic';
import type { ForensicStats } from '../../../../../src/forensics/store';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
class FakeResizeObserver { observe(): void {} unobserve(): void {} disconnect(): void {} }

function rec(id: string, techniques: Array<[string, number]>): ForensicRecord {
  return {
    id, timestamp: '2026-07-03T10:00:00.000Z', platform: 'tiktok', originalText: 't', originalHash: `h${id}`, originalLength: 1,
    neutralizedText: '', author: 'a', postUrl: '', overallScore: 6, userAgeCategory: 'teen', aiSource: 'cloud', feedSource: 'for-you',
    integrityHash: 'ih', verdict: 'flagged', kind: 'post',
    techniques: techniques.map(([name, severity]) => ({ name, severity, confidence: 0.9 })),
  } as unknown as ForensicRecord;
}

const STATS: ForensicStats = {
  total: 4, byTechnique: {}, byPlatform: { tiktok: 4 }, today: 0, thisWeek: 0, thisMonth: 0,
  blockedThisWeek: 0, blockedTotal: 0, unsignedRecordsCount: 0,
};

let host: HTMLDivElement;
let root: Root;
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

describe('Statistics technique bar drill', () => {
  it('opens the records counted under that technique as dominant, and no others', async () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    const records = [
      rec('a', [['fear-appeal', 7]]),
      rec('b', [['fear-appeal', 6], ['anger-trigger', 3]]),
      rec('c', [['anger-trigger', 8], ['fear-appeal', 2]]),
      rec('d', [['anger-trigger', 5]]),
    ];
    const onDrill = vi.fn();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root.render(React.createElement(I18nProvider, { lang: 'en', children: React.createElement(StatisticsTab, {
        records, stats: STATS, now: new Date('2026-07-03T12:00:00.000Z'), onDrill,
      } as unknown as React.ComponentProps<typeof StatisticsTab>) }));
    });
    const label = DASHBOARD_STRINGS.en.techniqueLabel('fear-appeal');
    const row = Array.from(host.querySelectorAll('[title]'))
      .find(el => el.getAttribute('title') === DASHBOARD_STRINGS.en.statsDrillHint && (el.textContent ?? '').includes(label)) as HTMLElement;
    expect(row, 'fear-appeal bar').toBeTruthy();
    expect(row.textContent).toContain('2/4');
    await act(async () => { row.click(); });
    expect(onDrill).toHaveBeenCalledTimes(1);
    const d = onDrill.mock.calls[0][0] as { recordIds: string[]; technique?: string };
    expect([...d.recordIds].sort()).toEqual(['a', 'b']);
    expect(d.technique).toBeUndefined();
  });
});
