// @vitest-environment jsdom
// "Withhold this record" and "Stop recording this account" asked their reason in the browser's own grey prompt box
// (window.prompt): the only place in the dashboard that did not use its own controls, and it froze the whole page while
// open (tester, 11 Oct 2026). The reason is now asked inside the opened row, with the same words, and can be cancelled.
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { FeedLogTab } from '../../../../../src/ui/dashboard/components/FeedLogTab';
import { I18nProvider } from '../../../../../src/i18n/react';
import { DASHBOARD_STRINGS } from '../../../../../src/i18n/dashboard-strings';
import type { ForensicRecord } from '../../../../../src/types/forensic';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const record = {
  id: 'r-1', timestamp: '2026-09-15T06:00:00.000Z', platform: 'twitter', originalText: 'a post body', originalHash: 'h1',
  originalLength: 11, neutralizedText: '', author: '', postUrl: 'https://x.com/someone/status/1', techniques: [],
  overallScore: 0, userAgeCategory: 'adult', aiSource: 'cloud', feedSource: 'for-you', integrityHash: 'ih1', verdict: 'pass',
  kind: 'post', chainPosition: 0,
} as unknown as ForensicRecord;
const en = DASHBOARD_STRINGS.en;

let host: HTMLDivElement;
let root: Root;
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });

async function openRow(onWithhold: (r: ForensicRecord, reason: string) => Promise<boolean>) {
  vi.spyOn(window, 'prompt').mockImplementation(() => { throw new Error('window.prompt was called'); });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(React.createElement(I18nProvider, { lang: 'en', children: React.createElement(FeedLogTab, {
      records: [record], loadingRest: false, filter: { window: 'all' }, onFilter: () => {}, integrity: null, onWithhold,
    } as unknown as React.ComponentProps<typeof FeedLogTab>) }));
  });
  await act(async () => { (host.querySelector('[data-testid="feed-log-row"]') as HTMLElement).click(); });
  const btn = Array.from(host.querySelectorAll('button')).find(b => b.textContent === en.withholdBtn) as HTMLButtonElement;
  await act(async () => { btn.click(); });
}

const type = async (el: HTMLTextAreaElement, text: string) => {
  const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  await act(async () => { set.call(el, text); el.dispatchEvent(new Event('input', { bubbles: true })); });
};

describe('the withhold reason', () => {
  it('is asked in the row, in the prompt\'s words, and goes to the withhold with what was typed', async () => {
    const onWithhold = vi.fn(async () => true);
    await openRow(onWithhold);
    const field = host.querySelector('textarea') as HTMLTextAreaElement;
    expect(field).not.toBeNull();
    expect(host.textContent).toContain(en.withholdPrompt);
    await type(field, 'a stranger\'s address');
    const confirm = Array.from(host.querySelectorAll('.fl-ask button')).find(b => b.textContent === en.withholdBtn) as HTMLButtonElement;
    await act(async () => { confirm.click(); });
    expect(onWithhold).toHaveBeenCalledWith(record, 'a stranger\'s address');
    expect(host.querySelector('textarea')).toBeNull();
  });

  it('can be cancelled, and then nothing is withheld', async () => {
    const onWithhold = vi.fn(async () => true);
    await openRow(onWithhold);
    const cancel = Array.from(host.querySelectorAll('.fl-ask button')).find(b => b.textContent === en.cancel) as HTMLButtonElement;
    await act(async () => { cancel.click(); });
    expect(host.querySelector('textarea')).toBeNull();
    expect(onWithhold).not.toHaveBeenCalled();
  });
});

// "Stop recording this account" opened the same form with the withhold sentence ("Withhold this record from every
// export...") over a button that stops an account: a person could not tell which act they confirmed (Tester, 11 Oct
// 2026, P2). Its form now says what stopping an account does, in the Record tab's own words for the list (exclusionsSub).
describe('the stop-recording form', () => {
  it('says what stopping an account does, not the withhold sentence, and confirms with its own button', async () => {
    vi.spyOn(window, 'prompt').mockImplementation(() => { throw new Error('window.prompt was called'); });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    const withAuthor = { ...record, author: '@someone' } as unknown as ForensicRecord;
    const onWithhold = vi.fn(async () => true);
    await act(async () => {
      root.render(React.createElement(I18nProvider, { lang: 'en', children: React.createElement(FeedLogTab, {
        records: [withAuthor], loadingRest: false, filter: { window: 'all' }, onFilter: () => {}, integrity: null, onWithhold,
      } as unknown as React.ComponentProps<typeof FeedLogTab>) }));
    });
    await act(async () => { (host.querySelector('[data-testid="feed-log-row"]') as HTMLElement).click(); });
    const open = Array.from(host.querySelectorAll('button')).find(b => b.textContent === en.excludeBtn) as HTMLButtonElement;
    await act(async () => { open.click(); });
    const form = host.querySelector('.fl-ask') as HTMLElement;
    expect(form.textContent).toContain(en.exclusionsSub);
    expect(form.textContent).not.toContain(en.withholdPrompt);
    const go = Array.from(form.querySelectorAll('button')).find(b => b.textContent === en.excludeBtn) as HTMLButtonElement;
    await act(async () => { go.click(); });
    for (let i = 0; i < 3; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(onWithhold).not.toHaveBeenCalled();
    expect(host.querySelector('.fl-ask')).toBeNull();
    expect(host.textContent).toContain(en.excludeDone);
  });
});
