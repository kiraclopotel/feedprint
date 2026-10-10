// @vitest-environment jsdom
// Decision 8 (the Head, 10 Oct 2026): the dashboard made a new Date() on every render and handed it to Statistics as
// `now`, so every memo keyed on it was thrown away each time anything on the page changed. The page now keeps one
// clock, read once a minute; a redraw with the same clock reuses the sums. Measured on the owner's shape (13,700
// entries in the active record over 21 days).

import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT as ROOT } from '../../../helpers/repo-root';
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ForensicRecord } from '../../../../src/types/forensic';
import { computeStats } from '../../../../src/forensics/store';
import { StatisticsTab } from '../../../../src/ui/dashboard/components/StatisticsTab';
import { I18nProvider } from '../../../../src/i18n/react';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SHELL = readFileSync(join(ROOT, 'src/ui/dashboard/Dashboard.tsx'), 'utf8');

function largeRecord(): ForensicRecord[] {
  const out: ForensicRecord[] = [];
  const start = new Date(2026, 8, 19).getTime();
  const end = new Date(2026, 9, 10, 12).getTime();
  const sites = ['facebook', 'instagram', 'twitter', 'youtube', 'tiktok'] as const;
  for (let i = 0; i < 13_700; i++) {
    const flagged = i % 7 === 0;
    out.push({
      id: `r${i}`, chainPosition: i, kind: 'post', platform: sites[i % 5], originalText: 'text',
      timestamp: new Date(start + ((end - start) * i) / 13_700).toISOString(),
      verdict: flagged ? 'flagged' : 'pass',
      techniques: flagged ? [{ name: i % 2 ? 'fear-appeal' : 'shame-attack', severity: 4 + (i % 6), confidence: 0.8 }] : [],
    } as unknown as ForensicRecord);
  }
  return out;
}

let host: HTMLDivElement | undefined;
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = undefined;
  host = undefined;
});

describe('the Statistics page keeps its sums between redraws', () => {
  it('the dashboard hands Statistics one clock read once a minute, not a new Date() per render', () => {
    expect(SHELL).toContain('const [now, setNow] = useState(() => new Date());');
    expect(SHELL).toMatch(/setInterval\(\(\) => setNow\(new Date\(\)\), 60_000\)/);
    expect(SHELL).not.toContain('const now = new Date();');
  });

  it('on 13,700 entries a redraw with the same clock costs a fraction of the first draw', async () => {
    const records = largeRecord();
    const stats = computeStats(records);
    const now = new Date(2026, 9, 10, 12, 30);
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    const draw = (n: number) => React.createElement(I18nProvider, {
      lang: 'en',
      children: React.createElement(StatisticsTab, { records, stats, now, allTimeCount: records.length + n }),
    });
    let t0 = performance.now();
    await act(async () => { root!.render(draw(0)); });
    const first = performance.now() - t0;
    // A redraw for a reason unrelated to the clock (here, the whole-record count moves by one).
    t0 = performance.now();
    await act(async () => { root!.render(draw(1)); });
    const again = performance.now() - t0;
    console.info(`[statistics] 13,700 entries: first draw ${first.toFixed(0)} ms, redraw with the same clock ${again.toFixed(0)} ms`);
    expect(host.textContent ?? '').not.toBe('');
    expect(again).toBeLessThan(first);
    expect(again).toBeLessThan(400);
  });
});
