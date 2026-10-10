// @vitest-environment jsdom
//
// Wiring audit of 13 Sep 2026, batch B, D1-11, D2-11, C1: the Activity side
// panels wait for the full read instead of printing totals off a 400-record
// page; once the archived months are in the list the notes say they are
// included, and the window note describes the live chain, not the whole list.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { ActivityTab } from '../../../../../src/ui/dashboard/components/ActivityTab';
import { I18nProvider } from '../../../../../src/i18n/react';
import { DASHBOARD_STRINGS } from '../../../../../src/i18n/dashboard-strings';
import type { ForensicRecord } from '../../../../../src/types/forensic';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class FakeResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

function rec(id: string, timestamp: string): ForensicRecord {
  return {
    id,
    timestamp,
    platform: 'tiktok',
    originalText: `text ${id}`,
    originalHash: `h${id}`,
    originalLength: 6,
    neutralizedText: '',
    author: 'creator99',
    postUrl: `https://www.tiktok.com/@creator99/video/${id}`,
    techniques: [],
    overallScore: 0,
    verdict: 'pass',
    userAgeCategory: 'teen',
    aiSource: 'cloud',
    feedSource: 'foryou',
    integrityHash: 'ih',
  } as unknown as ForensicRecord;
}

type Props = Parameters<typeof ActivityTab>[0];
const noop = () => {};
function baseProps(over: Partial<Props>): Props {
  return {
    records: [],
    stats: null,
    parentFeedback: new Map(),
    settings: {},
    onConfirm: noop,
    onDispute: noop,
    onViewOriginal: noop,
    onRecheck: async () => false,
    ...over,
  };
}

let host: HTMLDivElement;
let root: Root;

async function mount(props: Props): Promise<void> {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(createElement(I18nProvider, { lang: 'en', children: createElement(ActivityTab, props) }));
  });
}

beforeEach(() => { vi.stubGlobal('ResizeObserver', FakeResizeObserver); });
afterEach(async () => {
  await act(async () => { root.unmount(); });
  host.remove();
  vi.unstubAllGlobals();
});

const t = DASHBOARD_STRINGS.en;

/** The side panels sit behind the timeline's breakdown fold (closed on open, 9 Oct 2026); open it as a reader would. */
async function openBreakdown(): Promise<void> {
  const btn = host.querySelector<HTMLButtonElement>('.feed-breakdown-btn');
  expect(btn, 'the breakdown fold is offered').not.toBeNull();
  expect(btn!.getAttribute('aria-expanded')).toBe('false');
  await act(async () => { btn!.click(); });
  expect(btn!.getAttribute('aria-expanded')).toBe('true');
}

describe('D1-11, D2-11: the side panels wait for the full read', () => {
  it('while only a page is loaded the rail says so and prints no panel numbers', async () => {
    await mount(baseProps({ records: [rec('a', '2026-09-03T08:00:00.000Z')], archiveLoading: true }));
    await openBreakdown();
    expect(host.querySelector('[data-fw-side-pending="1"]')).not.toBeNull();
    expect(host.textContent).toContain(t.sidePanelsPending);
    expect(host.textContent).not.toContain(t.platformBreakdown);
    expect(host.textContent).not.toContain(t.techniqueFrequency);
  });

  it('with the full read in, the panels render', async () => {
    await mount(baseProps({ records: [rec('a', '2026-09-03T08:00:00.000Z')], archiveLoading: false }));
    // Closed, the timeline is the whole first look: no panel prints yet.
    expect(host.textContent).not.toContain(t.platformBreakdown);
    await openBreakdown();
    expect(host.querySelector('[data-fw-side-pending="1"]')).toBeNull();
    expect(host.textContent).toContain(t.platformBreakdown);
  });
});

describe('C1: the archived months in the list', () => {
  const archived = [rec('old1', '2026-07-01T08:00:00.000Z'), rec('old2', '2026-07-02T08:00:00.000Z')];
  const live = [rec('a', '2026-09-03T08:00:00.000Z'), rec('b', '2026-09-05T21:30:00.000Z')];

  it('says the archived records are included, and the window note describes the live chain only', async () => {
    await mount(baseProps({ records: [...archived, ...live], archivedCount: 2, archivesIncluded: true, liveCount: 2 }));
    const text = host.textContent ?? '';
    expect(text).toContain(t.showingArchivedIncluded(2));
    expect(text).not.toContain(t.showingArchivedNote(2));
    const fmt = new Intl.DateTimeFormat('en-US', { day: 'numeric', month: 'long' });
    // The live span, September, not July.
    expect(text).toContain(t.recordWindowNote(fmt.format(new Date(live[0].timestamp)), fmt.format(new Date(live[1].timestamp)), 2, 10000));
    // The archived days do show in the list's own day headings, so the July check reads the notes alone.
    const notes = [...host.querySelectorAll('.feed-showing-archived')].map((n) => n.textContent ?? '').join(' ');
    expect(notes).not.toContain(fmt.format(new Date(archived[0].timestamp)));
    // And the list itself counts all four.
    expect(text).toContain(`${t.showingBefore}4${t.showingBetween}4`);
  });

  it('before the archives land, the note still says they are not listed', async () => {
    await mount(baseProps({ records: live, archivedCount: 2, archivesIncluded: false, liveCount: 2 }));
    expect(host.textContent).toContain(t.showingArchivedNote(2));
  });
});
