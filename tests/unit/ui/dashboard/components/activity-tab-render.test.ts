// @vitest-environment jsdom
//
// Behavior locks on the mounted Activity tab (src/ui/dashboard/components/
// ActivityTab.tsx). These used to be source-text greps on Dashboard.tsx.
//
// 1. An empty feed after a FAILED store read renders the failure copy with a
//    retry action, never the first-run welcome (a parent cannot tell "nothing
//    recorded yet" from "the store could not be read" otherwise).
// 2. Q25: the search box echoes instantly but the record predicate reads the
//    150 ms debounced value, so a keystroke does not re-scan the chain.

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

function rec(id: string, text: string): ForensicRecord {
  return {
    id,
    timestamp: '2026-06-13T21:00:00.000Z',
    platform: 'tiktok',
    originalText: text,
    originalHash: 'h',
    originalLength: text.length,
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

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  host.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const t = DASHBOARD_STRINGS.en;

describe('ActivityTab: empty feed after a failed read', () => {
  it('renders the failure copy and a retry action, not the welcome', async () => {
    const onRetry = vi.fn();
    await mount(baseProps({ records: [], readFailed: true, onRetry }));
    const text = host.textContent ?? '';
    expect(text).toContain(t.loadFailedTitle);
    expect(text).toContain(t.loadFailedBody);
    expect(text).not.toContain(t.feedWelcomeTitle);
    const retry = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === t.retry);
    expect(retry).toBeDefined();
    await act(async () => { retry!.click(); });
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('renders the welcome when the store was read and is empty', async () => {
    await mount(baseProps({ records: [], readFailed: false }));
    const text = host.textContent ?? '';
    expect(text).toContain(t.feedWelcomeTitle);
    expect(text).not.toContain(t.loadFailedTitle);
  });
});

describe('ActivityTab: search is debounced before it reaches the record predicate (Q25)', () => {
  it('the trust line narrows only after the debounce elapses', async () => {
    await mount(baseProps({ records: [rec('1', 'apples are nice'), rec('2', 'bananas are nice')] }));
    // Only the timer pair the debounce uses; React's own scheduling stays real.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const showing = () => {
      const m = (host.textContent ?? '').match(new RegExp(`${t.showingBefore}(\\d+)${t.showingBetween}(\\d+)`));
      return m ? Number(m[1]) : null;
    };
    expect(showing()).toBe(2);

    const input = host.querySelector('input[type="search"]') as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setter.call(input, 'bananas');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(input.value).toBe('bananas');
    expect(showing()).toBe(2);

    await act(async () => { vi.advanceTimersByTime(100); });
    expect(showing()).toBe(2);

    await act(async () => { vi.advanceTimersByTime(100); });
    expect(showing()).toBe(1);
  });
});

describe('ActivityTab: the live record window is stated on screen', () => {
  // "Showing 500 of 500" reads as the whole history when it is the last few
  // days. The sentence has to reach the DOM, not just exist in the string
  // table. Expected dates are formatted the same way the component formats
  // them, so this does not fail in another timezone or another locale's month
  // ordering (the first draft asserted "3 September" and got "September 3",
  // one day later, because the newest record is late-evening UTC).
  it('names the span of the records it is showing', async () => {
    const oldest = '2026-09-03T08:00:00.000Z';
    const newest = '2026-09-05T21:30:00.000Z';
    const fmt = new Intl.DateTimeFormat('en-US', { day: 'numeric', month: 'long' });
    await mount(baseProps({
      records: [
        { ...rec('a', 'oldest one'), timestamp: oldest },
        { ...rec('b', 'newest one'), timestamp: newest },
      ],
    }));
    const text = host.textContent ?? '';
    expect(text).toContain(fmt.format(new Date(oldest)));
    expect(text).toContain(fmt.format(new Date(newest)));
    // And the ceiling, so the count above it means something.
    expect(text).toMatch(/10[\s.,]000/);
  });

  it('says nothing about a window when there are no records to bound', async () => {
    await mount(baseProps({ records: [], readFailed: false }));
    const text = host.textContent ?? '';
    expect(text).not.toMatch(/live record/i);
  });
});

describe('ActivityTab: the chain-broken line', () => {
  // The reason a chain failed to verify is the single most important sentence
  // this product prints. It sat in a flex row beside a pill and three buttons
  // with `flex: 1`, which is flex-basis 0, so in the feed column it took what
  // they left, about 120 pixels, and rendered as a tall strip of two-word
  // lines (seen 2026-09-17 in the dashboard probe's own screenshot; jsdom
  // cannot measure that, so this holds the shape that fixes it). A basis makes
  // the row wrap and gives the sentence a full-width line of its own.
  it('gives the reason a flex basis, so the row wraps instead of squeezing it', async () => {
    await mount(baseProps({
      records: [rec('a', 'a recorded post')],
      integrity: { valid: false, reason: 'Integrity hash mismatch at position 100: record content was modified after signing.' } as never,
    }));

    const note = host.querySelector<HTMLElement>('.fc-harm-row[role="alert"] .fc-harm-note');
    expect(note).not.toBeNull();
    expect(note!.textContent).toContain('Integrity hash mismatch');
    // Not `flex: 1`: a basis of zero is what squeezed it.
    expect(note!.style.flexBasis).not.toBe('0%');
    expect(parseInt(note!.style.flexBasis, 10)).toBeGreaterThanOrEqual(200);
    expect(note!.style.minWidth).toBe('0px');
  });

  it('prints nothing of the kind when the chain verifies', async () => {
    await mount(baseProps({
      records: [rec('a', 'a recorded post')],
      integrity: { valid: true } as never,
    }));
    expect(host.querySelector('.fc-harm-row[role="alert"]')).toBeNull();
  });
});

