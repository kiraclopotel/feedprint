// @vitest-environment jsdom
//
// The recorder writes a heartbeat up to every fifteen minutes while a feed is
// open. Each one used to take a full card in the Activity list, labelled as a
// clean-up of old entries, with a platform-switch divider around it because its
// storage slot says "twitter". A night of them buried the posts. A run of
// housekeeping records now reads as one quiet line that counts them; a gap
// marker, which says the recorder was off, keeps its own line where it
// happened; and the "Showing N of M" count is unchanged, because the fold only
// changes how the records are drawn, not which ones are listed.

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

let seq = 0;
function post(id: string, at: string, session: string): ForensicRecord {
  seq += 1;
  return {
    id,
    timestamp: at,
    viewportSeenAt: at,
    surfaceSessionId: session,
    observedSequence: seq,
    chainPosition: seq,
    platform: 'tiktok',
    kind: 'post',
    originalText: `post ${id}`,
    originalHash: 'h',
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

function marker(kind: string, id: string, at: string): ForensicRecord {
  seq += 1;
  return {
    id,
    timestamp: at,
    chainPosition: seq,
    platform: 'twitter',
    kind,
    originalText: `[${kind} @ ${at}]`,
    originalHash: 'h',
    originalLength: 10,
    neutralizedText: '',
    author: '',
    postUrl: '',
    techniques: [],
    overallScore: 0,
    verdict: 'pass',
    userAgeCategory: 'teen',
    aiSource: 'none',
    feedSource: 'unknown',
    detectionMode: kind,
    integrityHash: 'ih',
  } as unknown as ForensicRecord;
}

function at(h: number, m: number): string {
  return `2026-09-24T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00.000Z`;
}

/**
 * Chain order: two posts in one session, twelve heartbeats 03:00 to 05:45, a
 * post in a second session, the recorder off (gap marker), two more heartbeats.
 * 18 records: 3 posts, 14 heartbeats, 1 gap.
 */
function chain(): ForensicRecord[] {
  seq = 0;
  const out: ForensicRecord[] = [post('p1', at(1, 0), 's1'), post('p2', at(1, 5), 's1')];
  for (let i = 0; i < 12; i++) out.push(marker('heartbeat-marker', `hb-a${i}`, at(3 + Math.floor(i / 4), (i % 4) * 15)));
  out.push(post('p3', at(6, 0), 's2'));
  out.push(marker('gap-marker', 'gap-1', at(7, 30)));
  out.push(marker('heartbeat-marker', 'hb-b0', at(8, 0)));
  out.push(marker('heartbeat-marker', 'hb-b1', at(8, 15)));
  return out;
}

type Props = Parameters<typeof ActivityTab>[0];
const noop = () => {};
function props(over: Partial<Props>): Props {
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

async function mount(p: Props): Promise<void> {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(createElement(I18nProvider, { lang: 'en', children: createElement(ActivityTab, p) }));
  });
}

const t = DASHBOARD_STRINGS.en;

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  // Tall enough that the virtualizer mounts every row of this short chain.
  Object.defineProperty(window, 'innerHeight', { value: 100_000, configurable: true });
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  host.remove();
  vi.unstubAllGlobals();
});

function feedText(): string {
  return host.querySelector('.fc-timeline')?.textContent ?? '';
}

/** The rows the list draws, in order. A card nests its own key inside its row's, so each key counts once. */
function rowKeys(): string[] {
  const keys = Array.from(host.querySelectorAll('.fc-timeline [data-fw-key]'))
    .map((el) => el.getAttribute('data-fw-key') ?? '');
  return Array.from(new Set(keys));
}

function showing(): [number, number] | null {
  const m = (host.textContent ?? '').match(new RegExp(`${t.showingBefore}(\\d+)${t.showingBetween}(\\d+)`));
  return m ? [Number(m[1]), Number(m[2])] : null;
}

describe('Activity list: heartbeats fold into one line per run', () => {
  it('draws each run of heartbeats as one counted line, not a card each', async () => {
    await mount(props({ records: chain() }));
    const runs = Array.from(host.querySelectorAll('.fc-timeline .fc-marker-run'));
    expect(runs.map((r) => r.getAttribute('data-fw-marker-count'))).toEqual(['2', '12']);
    expect(runs[1].textContent).toContain(`12 ${t.feedMarkerKindWord('heartbeat-marker', 12)}`);
    // Not one heartbeat is drawn as a card of its own.
    expect(host.querySelectorAll('.fc-timeline .feed-card[data-fw-key^="hb-"]')).toHaveLength(0);
    // And none is called a clean-up of old entries, which is what they were labelled.
    expect(feedText()).not.toContain(t.feedMarkerPrune);
  });

  it('keeps the gap marker as its own line, between the runs it splits', async () => {
    await mount(props({ records: chain() }));
    const gap = host.querySelector('.fc-timeline [data-fw-key="gap-1"]');
    expect(gap).not.toBeNull();
    expect(gap!.textContent).toContain(t.feedGapHeading(''));
    expect(rowKeys()).toEqual(['markers:hb-b1', 'gap-1', 'p3', 'markers:hb-a11', 'p1', 'p2']);
  });

  it('puts no platform-switch divider around a run: a heartbeat was not served from any feed', async () => {
    await mount(props({ records: chain() }));
    expect(feedText()).not.toContain('→');
  });

  it('leaves the Showing count alone: every record is still listed, some of them folded', async () => {
    await mount(props({ records: chain() }));
    expect(showing()).toEqual([18, 18]);
    const folded = Array.from(host.querySelectorAll('.fc-timeline .fc-marker-run'))
      .reduce((n, el) => n + Number(el.getAttribute('data-fw-marker-count')), 0);
    const drawnAlone = rowKeys().filter((k) => !k.startsWith('markers:')).length;
    expect(folded + drawnAlone).toBe(18);
  });

  it('folds the same way in the flat list a filter opens', async () => {
    await mount(props({
      records: chain(),
      drill: { since: '2026-09-24T00:00:00.000Z', until: '2026-09-25T00:00:00.000Z', seq: 1 },
    }));
    expect(showing()).toEqual([18, 18]);
    const runs = Array.from(host.querySelectorAll('.fc-timeline .fc-marker-run'));
    // Flat is newest first by chain order: the late pair, then the twelve.
    expect(runs.map((r) => r.getAttribute('data-fw-marker-count'))).toEqual(['2', '12']);
    expect(host.querySelectorAll('.fc-timeline .feed-card[data-fw-key^="hb-"]')).toHaveLength(0);
    expect(host.querySelector('.fc-timeline [data-fw-key="gap-1"]')?.textContent).toContain(t.feedGapHeading(''));
  });
});
