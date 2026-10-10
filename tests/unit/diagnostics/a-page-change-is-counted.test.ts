// @vitest-environment jsdom
//
// DRIFT1: when a site changes its page, the product counts it. A selector that no longer compiles
// moves `selectorFailed.<platform>`; a wire parser that throws moves `parserThrew.<platform>`.
// Both go into the existing diagnostics counters (fw_diagnostics), numbers only, and what each
// does today (skip the selector and go on; return no items) does not change.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/content/platforms/wire/x', () => ({
  parseXPayload: vi.fn(),
}));

import {
  queryWithFallback,
  queryAllWithFallback,
  extractTextWithFallback,
} from '../../../src/content/platforms/selector-chain';
import { receiveWirePayload } from '../../../src/content/page-world/relay';
import { parseXPayload as mockedParseXPayload } from '../../../src/content/platforms/wire/x';
import {
  _getDiagnosticCountersForTesting,
  _resetDiagnosticsForTesting,
  flushDiagnosticsNow,
} from '../../../src/diagnostics/diagnostics';
import { _peekSelectorHealthForTesting, _resetSelectorHealthForTesting } from '../../../src/diagnostics/selector-health';

const parseXPayload = mockedParseXPayload as unknown as ReturnType<typeof vi.fn>;

// A selector that cannot compile, and that carries text which must never be stored.
const BROKEN = '[[[SECRET-SELECTOR-TEXT';

function dom(html: string): HTMLElement {
  const div = document.createElement('div');
  div.innerHTML = html;
  return div;
}

beforeEach(() => {
  _resetDiagnosticsForTesting();
  _resetSelectorHealthForTesting();
  parseXPayload.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('a selector that no longer compiles is counted', () => {
  it('queryWithFallback moves the counter by one and goes on to the next selector', () => {
    const root = dom('<span class="ok">hello</span>');
    const found = queryWithFallback(root, [BROKEN, '.ok'], 'twitter.post-text');
    expect(found?.textContent).toBe('hello');
    expect(_getDiagnosticCountersForTesting()['selectorFailed.twitter']).toBe(1);
  });

  it('queryAllWithFallback and extractTextWithFallback count the same way', () => {
    const root = dom('<p class="ok">a long enough piece of text here for the check</p>');
    expect(queryAllWithFallback(root, [BROKEN, '.ok'], 'facebook.feed')).toHaveLength(1);
    const got = extractTextWithFallback(root, [BROKEN, '.ok'], 5, 'youtube.title');
    expect(got?.text).toContain('long enough');
    const counters = _getDiagnosticCountersForTesting();
    expect(counters['selectorFailed.facebook']).toBe(1);
    expect(counters['selectorFailed.youtube']).toBe(1);
  });

  it('a chain that all fails still returns nothing, as before, and counts each dead selector', () => {
    const root = dom('<span>nothing</span>');
    expect(queryWithFallback(root, [BROKEN, '.gone', '[[[again'], 'tiktok.comment')).toBeNull();
    expect(_getDiagnosticCountersForTesting()['selectorFailed.tiktok']).toBe(2);
  });

  // The critic's HOLD (16:38): a real YouTube label has no dot, and X's tweet text and Facebook's ad text stay
  // unlabeled on purpose (a label there feeds the drift verdict), so each says its platform another way.
  it('the real YouTube labels count under youtube, not under their own names', () => {
    const root = dom('<span class="ok">a long enough piece of text here for the check</span>');
    extractTextWithFallback(root, [BROKEN, '.ok'], 5, 'yt-community');
    queryWithFallback(root, [BROKEN, '.ok'], 'yt-community-author');
    const counters = _getDiagnosticCountersForTesting();
    expect(counters['selectorFailed.youtube']).toBe(2);
    expect(Object.keys(counters).filter((n) => n.includes('yt-'))).toEqual([]);
  });

  it('an unlabeled call that names its platform counts under it, and still feeds no selector-health counter', () => {
    const root = dom('<span class="ok">a long enough piece of text here for the check</span>');
    expect(queryAllWithFallback(root, [BROKEN, '.ok'], undefined, 'twitter')).toHaveLength(1);
    extractTextWithFallback(root, [BROKEN, '.ok'], 5, undefined, 'facebook');
    const counters = _getDiagnosticCountersForTesting();
    expect(counters['selectorFailed.twitter']).toBe(1);
    expect(counters['selectorFailed.facebook']).toBe(1);
    expect(_peekSelectorHealthForTesting()).toEqual({});
  });

  it('a call with no label and no platform moves the plain selectorFailed, and a made-up platform is not a name', () => {
    const root = dom('<span class="ok">fine</span>');
    queryWithFallback(root, [BROKEN, '.ok']);
    queryWithFallback(root, [BROKEN, '.ok'], undefined, 'SECRET-SELECTOR-TEXT');
    expect(_getDiagnosticCountersForTesting()).toEqual({ selectorFailed: 2 });
  });

  it('a chain of working selectors counts nothing', () => {
    const root = dom('<span class="ok">fine</span>');
    queryWithFallback(root, ['.ok'], 'twitter.post-text');
    const names = Object.keys(_getDiagnosticCountersForTesting());
    expect(names.filter((n) => n.startsWith('selectorFailed'))).toEqual([]);
  });
});

describe('a wire parser that throws is counted', () => {
  it('moves parserThrew.<platform> by one and files nothing, as before', () => {
    parseXPayload.mockImplementation(() => {
      throw new Error('parser blew up on a new shape');
    });
    const filed = receiveWirePayload('twitter', 'https://x.com/i/api/graphql/abc/HomeTimeline', {}, { pathname: '/home' });
    expect(filed).toEqual([]);
    expect(_getDiagnosticCountersForTesting()['parserThrew.twitter']).toBe(1);
  });

  it('a parser that works counts nothing', () => {
    parseXPayload.mockReturnValue([]);
    receiveWirePayload('twitter', 'https://x.com/i/api/graphql/abc/HomeTimeline', {}, { pathname: '/home' });
    expect(Object.keys(_getDiagnosticCountersForTesting()).filter((n) => n.startsWith('parserThrew'))).toEqual([]);
  });
});

describe('what is stored is numbers only', () => {
  it('the stored diagnostics hold no selector text and only known keys for these counters', async () => {
    let stored: Record<string, unknown> = {};
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: vi.fn(async () => ({})),
          set: vi.fn(async (obj: Record<string, unknown>) => {
            stored = obj;
          }),
        },
      },
    });
    queryWithFallback(dom('<i class="ok">x</i>'), [BROKEN, '.ok'], 'twitter.post-text');
    parseXPayload.mockImplementation(() => {
      throw new Error('SECRET-PAGE-TEXT in the message');
    });
    receiveWirePayload('twitter', 'https://x.com/i/api/graphql/abc/HomeTimeline', { text: 'SECRET-PAGE-TEXT' }, { pathname: '/home' });

    await flushDiagnosticsNow();

    const text = JSON.stringify(stored);
    expect(text).not.toContain('SECRET-SELECTOR-TEXT');
    expect(text).not.toContain('SECRET-PAGE-TEXT');
    expect(text).not.toContain('x.com');

    const counters = _getDiagnosticCountersForTesting();
    const mine = Object.entries(counters).filter(([n]) => /^(selectorFailed|parserThrew)/.test(n));
    expect(mine.length).toBeGreaterThan(0);
    for (const [name, value] of mine) {
      expect(name).toMatch(/^(selectorFailed(\.(twitter|facebook|instagram|tiktok|youtube))?|parserThrew\.(twitter|facebook|instagram|tiktok|youtube))$/);
      expect(typeof value).toBe('number');
    }
  });
});
