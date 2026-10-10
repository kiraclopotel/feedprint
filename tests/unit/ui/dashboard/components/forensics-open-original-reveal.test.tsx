// @vitest-environment jsdom
// Wiring audit 13 Sep, D2-40: "Open original post" in the Forensics ledger goes
// through the reveal route (Dashboard.tsx handleViewOriginal) like the
// Activity cards, so protection does not hide the post the parent came to see.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { FeedLogTab } from '../../../../../src/ui/dashboard/components/FeedLogTab';
import { I18nProvider } from '../../../../../src/i18n/react';
import type { ForensicRecord } from '../../../../../src/types/forensic';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const record = {
  id: 'r-1', timestamp: '2026-09-15T06:00:00.000Z', platform: 'twitter', originalText: 'a post body', originalHash: 'h1',
  originalLength: 11, neutralizedText: '', author: '@someone', postUrl: 'https://x.com/someone/status/1', techniques: [],
  overallScore: 0, userAgeCategory: 'adult', aiSource: 'cloud', feedSource: 'for-you', integrityHash: 'ih1', verdict: 'pass',
  kind: 'post', chainPosition: 0,
} as unknown as ForensicRecord;

let host: HTMLDivElement;
let root: Root;
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

describe('Feed log (the ledger until 10 Oct 2026): open original', () => {
  it('routes the click through onViewOriginal and keeps the browser from following the plain link', async () => {
    const onViewOriginal = vi.fn();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root.render(React.createElement(I18nProvider, { lang: 'en', children: React.createElement(FeedLogTab, {
        records: [record], loadingRest: false, filter: { window: 'all' }, onFilter: () => {}, integrity: null, onViewOriginal,
      } as unknown as React.ComponentProps<typeof FeedLogTab>) }));
    });
    const row = host.querySelector('[data-testid="feed-log-row"]') as HTMLElement;
    expect(row).not.toBeNull();
    await act(async () => { row.click(); });
    const link = Array.from(host.querySelectorAll('a')).find(a => a.getAttribute('href') === record.postUrl) as HTMLAnchorElement;
    expect(link).toBeTruthy();
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
    await act(async () => { link.dispatchEvent(ev); });
    expect(onViewOriginal).toHaveBeenCalledWith(record, record.postUrl);
    expect(ev.defaultPrevented).toBe(true);
  });

  it('the dashboard hands the Feed log the same handler the Activity tab gets', () => {
    const shell = readFileSync(join(process.cwd(), 'src/ui/dashboard/Dashboard.tsx'), 'utf8');
    expect(shell.match(/onViewOriginal=\{handleViewOriginal\}/g)?.length).toBeGreaterThanOrEqual(2);
  });
});
