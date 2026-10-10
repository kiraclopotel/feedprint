// Detached-window "On this page" tab resolution (audit E2).
//
// The Home tab's coverage card asks Chrome for the page the parent is looking
// at. In the action popup, `{active: true, currentWindow: true}` IS that page.
// In the detached window (popup.html?detached=1 via chrome.windows.create),
// the same query resolves to the detached window's OWN chrome-extension:// tab,
// so the card permanently showed the not-a-supported-site copy — in exactly the
// mode built for keeping the popup open beside the feed. queryCoverageTab must
// instead resolve the last-focused NORMAL browser window's active tab when
// detached, and fall back to null (→ the existing unsupported-site copy) when
// no normal window exists.

import { describe, it, expect, vi } from 'vitest';
import { queryCoverageTab } from '../../../../src/ui/popup/Popup';

// The detached popup's own tab — what the buggy currentWindow query returns.
const SELF_TAB = { id: 1, url: 'chrome-extension://abcdef/popup.html?detached=1' };
// The feed the parent is actually looking at, in a separate normal window.
const FEED_TAB = { id: 42, url: 'https://www.tiktok.com/foryou' };
const NORMAL_WINDOW_ID = 7;

function stubChrome(opts: {
  getLastFocused?: ReturnType<typeof vi.fn>;
  query?: ReturnType<typeof vi.fn>;
}) {
  const query = opts.query ?? vi.fn().mockResolvedValue([]);
  const getLastFocused = opts.getLastFocused ?? vi.fn().mockResolvedValue(undefined);
  (globalThis as unknown as { chrome: unknown }).chrome = {
    tabs: { query },
    windows: { getLastFocused },
  };
  return { query, getLastFocused };
}

// A query mock that behaves like Chrome does from inside the detached window:
// currentWindow resolves to the popup's own extension tab; only an explicit
// windowId aimed at the normal window reaches the feed.
function chromeLikeQuery(feedTab: { id: number; url?: string }[] = [FEED_TAB]) {
  return vi.fn().mockImplementation((q: { currentWindow?: boolean; windowId?: number }) => {
    if (q.windowId === NORMAL_WINDOW_ID) return Promise.resolve(feedTab);
    return Promise.resolve([SELF_TAB]);
  });
}

describe('queryCoverageTab — attached (action popup)', () => {
  it('returns the active tab of the current window, untouched behavior', async () => {
    const { query, getLastFocused } = stubChrome({
      query: vi.fn().mockResolvedValue([FEED_TAB]),
    });
    const tab = await queryCoverageTab(false);
    expect(query).toHaveBeenCalledWith({ active: true, currentWindow: true });
    expect(getLastFocused).not.toHaveBeenCalled();
    expect(tab?.url).toBe(FEED_TAB.url);
  });

  it('no active tab → null', async () => {
    stubChrome({ query: vi.fn().mockResolvedValue([]) });
    expect(await queryCoverageTab(false)).toBeNull();
  });
});

describe('queryCoverageTab — detached window (audit E2)', () => {
  it('resolves the last-focused normal window\'s active tab, not its own extension tab', async () => {
    const { query, getLastFocused } = stubChrome({
      getLastFocused: vi.fn().mockResolvedValue({ id: NORMAL_WINDOW_ID }),
      query: chromeLikeQuery(),
    });
    const tab = await queryCoverageTab(true);
    // Must scope the window lookup to normal browser windows so the detached
    // popup window (and devtools/app windows) can never be picked.
    expect(getLastFocused).toHaveBeenCalledWith({ windowTypes: ['normal'] });
    expect(query).toHaveBeenCalledWith({ active: true, windowId: NORMAL_WINDOW_ID });
    expect(tab?.url).toBe(FEED_TAB.url);
  });

  it('never issues the currentWindow query that resolves to itself', async () => {
    const { query } = stubChrome({
      getLastFocused: vi.fn().mockResolvedValue({ id: NORMAL_WINDOW_ID }),
      query: chromeLikeQuery(),
    });
    const tab = await queryCoverageTab(true);
    for (const call of query.mock.calls) {
      expect(call[0]).not.toMatchObject({ currentWindow: true });
    }
    expect(tab?.url).not.toContain('chrome-extension://');
  });

  it('no normal window (getLastFocused rejects) → null, so the card keeps the unsupported-site copy', async () => {
    const { query } = stubChrome({
      getLastFocused: vi.fn().mockRejectedValue(new Error('No last-focused window')),
      query: chromeLikeQuery(),
    });
    expect(await queryCoverageTab(true)).toBeNull();
    expect(query).not.toHaveBeenCalled();
  });

  it('getLastFocused resolves a window without an id → null', async () => {
    stubChrome({
      getLastFocused: vi.fn().mockResolvedValue({}),
      query: chromeLikeQuery(),
    });
    expect(await queryCoverageTab(true)).toBeNull();
  });

  it('normal window exists but has no active tab → null', async () => {
    stubChrome({
      getLastFocused: vi.fn().mockResolvedValue({ id: NORMAL_WINDOW_ID }),
      query: chromeLikeQuery([]),
    });
    expect(await queryCoverageTab(true)).toBeNull();
  });
});
