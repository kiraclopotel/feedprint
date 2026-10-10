// @vitest-environment jsdom
// Wiring audit 13 Sep, D1-12: the feed's session and platform-switch dividers
// render inside the group's measured row, so the virtualizer's
// ResizeObserver counts their height. A divider outside every data-fw-key
// child of the timeline was never measured and each one scrolled past shifted
// the spacer offsets.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ActivityTab } from '../../../../../src/ui/dashboard/components/ActivityTab';
import { I18nProvider } from '../../../../../src/i18n/react';
import type { ForensicRecord } from '../../../../../src/types/forensic';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class FakeResizeObserver { observe(): void {} unobserve(): void {} disconnect(): void {} }

function rec(id: string, ts: string, platform: ForensicRecord['platform']): ForensicRecord {
  return {
    id, timestamp: ts, platform, originalText: `post ${id}`, originalHash: `h-${id}`, originalLength: 6,
    neutralizedText: '', author: 'someone', postUrl: '', techniques: [], overallScore: 0, verdict: 'pass',
    userAgeCategory: 'adult', aiSource: 'cloud', feedSource: 'for-you', integrityHash: `ih-${id}`, kind: 'post',
  } as unknown as ForensicRecord;
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => { vi.stubGlobal('ResizeObserver', FakeResizeObserver); });
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe('feed dividers are part of a measured row', () => {
  it('every session and platform-switch divider sits inside a keyed child of the timeline', async () => {
    const records = [
      rec('a', '2026-09-14T08:00:00.000Z', 'twitter'),
      rec('b', '2026-09-14T08:01:00.000Z', 'facebook'),
      rec('c', '2026-09-14T11:00:00.000Z', 'facebook'),
      rec('d', '2026-09-14T14:00:00.000Z', 'tiktok'),
    ];
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root.render(createElement(I18nProvider, {
        lang: 'en',
        children: createElement(ActivityTab, {
          records, stats: null, parentFeedback: new Map(), settings: {},
          onConfirm: () => {}, onDispute: () => {}, onViewOriginal: () => {}, onRecheck: async () => false,
        } as Parameters<typeof ActivityTab>[0]),
      }));
    });
    const timeline = host.querySelector('.fc-timeline');
    expect(timeline).not.toBeNull();
    const dividers = Array.from(host.querySelectorAll('.fc-tl-session, .fc-tl-row.gap'));
    expect(dividers.length).toBeGreaterThan(0);
    for (const d of dividers) {
      const keyed = d.closest('[data-fw-key]') as HTMLElement | null;
      expect(keyed, d.textContent ?? '').not.toBeNull();
      expect(keyed!.parentElement).toBe(timeline);
    }
    // Nothing but spacers and keyed rows sits directly in the timeline.
    for (const child of Array.from(timeline!.children)) {
      const el = child as HTMLElement;
      expect(el.dataset.fwKey !== undefined || el.classList.contains('fc-virtual-spacer'), el.className).toBe(true);
    }
  });
});
