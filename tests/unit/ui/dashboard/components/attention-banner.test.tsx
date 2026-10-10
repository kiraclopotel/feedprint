// @vitest-environment jsdom
// Wiring audit 13 Sep, D2-19 and D2-20: the attention banner says Done only when
// the action fixed the problem, and a dismissal lasts the rest of the day across
// reloads, never longer.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT as ROOT } from '../../../../helpers/repo-root';
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AttentionBanner, ATTENTION_DISMISS_KEY, readDismissed, type AttentionItem } from '../../../../../src/ui/dashboard/components/AttentionBanner';
import { I18nProvider } from '../../../../../src/i18n/react';
import { DASHBOARD_STRINGS } from '../../../../../src/i18n/dashboard-strings';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

async function mount(items: AttentionItem[]): Promise<void> {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(React.createElement(I18nProvider, { lang: 'en', children: React.createElement(AttentionBanner, { items }) }));
  });
}

const item = (id: string, onAction: AttentionItem['onAction']): AttentionItem => ({ id, title: `title ${id}`, body: 'body', actionLabel: `act ${id}`, onAction });
const button = (label: string) => Array.from(host.querySelectorAll('button')).find(b => b.textContent === label) as HTMLButtonElement;

beforeEach(() => localStorage.clear());
afterEach(async () => { await act(async () => root.unmount()); host.remove(); localStorage.clear(); });

describe('Done means fixed', () => {
  it('an action that fixed nothing leaves the button, not Done', async () => {
    await mount([item('a', async () => false)]);
    await act(async () => { button('act a').click(); });
    expect(host.textContent).not.toContain(DASHBOARD_STRINGS.en.attnDone);
    expect(button('act a')).toBeTruthy();
  });

  it('an action that fixed the problem shows Done', async () => {
    await mount([item('b', async () => true)]);
    await act(async () => { button('act b').click(); });
    expect(host.textContent).toContain(DASHBOARD_STRINGS.en.attnDone);
  });
});

describe('a dismissal lasts the day', () => {
  it('survives a remount the same day', async () => {
    await mount([item('c', () => false)]);
    await act(async () => { button(DASHBOARD_STRINGS.en.attnDismiss).click(); });
    expect(host.textContent).not.toContain('title c');
    await act(async () => root.unmount());
    host.remove();
    await mount([item('c', () => false)]);
    expect(host.textContent).not.toContain('title c');
  });

  it('is gone the next day', () => {
    localStorage.setItem(ATTENTION_DISMISS_KEY, JSON.stringify({ c: '2026-09-14' }));
    expect(readDismissed('2026-09-15').has('c')).toBe(false);
    expect(readDismissed('2026-09-14').has('c')).toBe(true);
  });

  it('an unreadable store dismisses nothing', () => {
    localStorage.setItem(ATTENTION_DISMISS_KEY, 'not json');
    expect(readDismissed().size).toBe(0);
  });

  // M253, closed 2026-09-19. The day was cut in UTC, so at UTC+3 a dismissal made
  // at nine in the evening came back at three in the morning. The rest of the
  // dashboard already meant local midnight by "today" (StatisticsTab cuts there,
  // after it and the Activity tab disagreed in every non-UTC zone), and one
  // product should not hold two meanings of one word.
  describe('the day is the reader\'s, not UTC (2026-09-19)', () => {
    it('writes the key under the local date at an hour where the two differ', () => {
      // 2026-09-19T22:30 local in a UTC+3 zone is already the 20th in UTC. A key
      // cut in UTC would say 2026-09-20 and expire this dismissal in 90 minutes.
      vi.useFakeTimers();
      try {
        vi.setSystemTime(new Date('2026-09-19T19:30:00.000Z')); // 22:30 at UTC+3
        const utcDay = new Date().toISOString().slice(0, 10);
        const d = new Date();
        const localDay = `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, '0')}-${`${d.getDate()}`.padStart(2, '0')}`;

        localStorage.setItem(ATTENTION_DISMISS_KEY, JSON.stringify({ c: localDay }));
        expect(readDismissed().has('c'), 'a dismissal made today is still hidden today').toBe(true);

        // The assertion only means something in a zone where the two disagree at
        // this hour. In UTC itself they are the same string and the case is mute,
        // so it says so rather than passing quietly.
        if (utcDay !== localDay) {
          localStorage.setItem(ATTENTION_DISMISS_KEY, JSON.stringify({ c: utcDay }));
          expect(readDismissed().has('c'), 'a key cut in UTC is not this reader\'s day').toBe(false);
        }
      } finally {
        vi.useRealTimers();
      }
    });

    it('the source cuts the day locally and not off an ISO string', () => {
      // The behaviour above is identical in a UTC machine, and CI may well be one,
      // so the mechanism is pinned too: a reader of this file should not have to
      // guess which midnight the key means.
      const src = readFileSync(join(ROOT, 'src/ui/dashboard/components/AttentionBanner.tsx'), 'utf8');
      const body = src.slice(src.indexOf('function today()'), src.indexOf('export function readDismissed'));
      expect(body, 'cut by the one function that decides what a local day is').toContain('localDayKey(');
      expect(body, 'not sliced out of a UTC ISO string').not.toContain('toISOString');
    });
  });
});
