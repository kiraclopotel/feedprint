// @vitest-environment jsdom
//
// Finder families: a repair changes the list a finder reads, and only as far as it is allowed to (11 Oct 2026).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RepairEntry, RepairFile } from '../../../../src/core/repairs/format';
import {
  __resetRepairsForTest, activeRepairVersion, applyRepairFile, knownFamilies, selectorFamily, setRepairEventSink, wordFamily,
} from '../../../../src/core/repairs/families';
import { __pendingFinderEventsForTest, __resetFinderLedgerForTest, recordFinderEvent } from '../../../../src/diagnostics/finder-ledger';

const file = (version: number, ...entries: Partial<RepairEntry>[]): RepairFile => ({
  version,
  issuedAt: '2026-10-11T16:00:00Z',
  expiresAt: null,
  entries: entries.map((e) => ({ family: 'youtube.count', add: [], remove: [], off: false, ...e })),
});

const DEFAULTS = ['like-button-view-model .old', 'ytd-watch-info-text'] as const;

beforeEach(() => {
  document.body.replaceChildren();
  __resetRepairsForTest();
  __resetFinderLedgerForTest();
  setRepairEventSink(recordFinderEvent);
});

afterEach(() => {
  __resetRepairsForTest();
  __resetFinderLedgerForTest();
});

describe('with no repair a family is its default list', () => {
  it('returns the very list it was given and remembers the family', () => {
    expect(selectorFamily('youtube.count', DEFAULTS)).toBe(DEFAULTS);
    expect(knownFamilies().get('youtube.count')).toBe('selector');
    expect(wordFamily('ads.words', ['Sponsored'])).toEqual(['Sponsored']);
    expect(knownFamilies().get('ads.words')).toBe('word');
  });
});

describe('a repair adds, removes and switches off', () => {
  it('adds a selector that is specific and sane', () => {
    applyRepairFile(file(1, { add: ['like-button-view-model .renamed'] }));
    expect(selectorFamily('youtube.count', DEFAULTS)).toEqual([...DEFAULTS, 'like-button-view-model .renamed']);
    expect(__pendingFinderEventsForTest()).toEqual({ 'repaired.youtube.count.added': 1 });
  });

  it('removes only an entry the default list holds, exactly', () => {
    applyRepairFile(file(1, { remove: ['like-button-view-model .old', 'not in the list'] }));
    expect(selectorFamily('youtube.count', DEFAULTS)).toEqual(['ytd-watch-info-text']);
  });

  it('switches a family off', () => {
    applyRepairFile(file(1, { off: true }));
    expect(selectorFamily('youtube.count', DEFAULTS)).toEqual([]);
  });

  it('does not add what is already there, twice or with a repeat', () => {
    applyRepairFile(file(1, { add: ['ytd-watch-info-text', '.fresh', '.fresh'] }));
    expect(selectorFamily('youtube.count', DEFAULTS)).toEqual([...DEFAULTS, '.fresh']);
  });

  it('touches only the family it names', () => {
    applyRepairFile(file(1, { family: 'other.family', off: true }));
    expect(selectorFamily('youtube.count', DEFAULTS)).toBe(DEFAULTS);
  });

  it('adds a word to a word list', () => {
    applyRepairFile(file(1, { family: 'ads.words', add: ['Promovat', '<b>x</b>'] }));
    expect(wordFamily('ads.words', ['Sponsored'])).toEqual(['Sponsored', 'Promovat']);
    expect(__pendingFinderEventsForTest()).toMatchObject({ 'repaired.ads.words.refused': 1, 'repaired.ads.words.added': 1 });
  });
});

describe('a selector is judged on the page where it is first read', () => {
  it('drops one that is not specific, with a count', () => {
    applyRepairFile(file(1, { add: ['div', '*', '.ok-class'] }));
    expect(selectorFamily('youtube.count', DEFAULTS)).toEqual([...DEFAULTS, '.ok-class']);
    expect(__pendingFinderEventsForTest()['repaired.youtube.count.refused']).toBe(2);
  });

  it('drops one that does not compile', () => {
    applyRepairFile(file(1, { add: ['[data-x="a"', '.fine'] }));
    expect(selectorFamily('youtube.count', DEFAULTS)).toEqual([...DEFAULTS, '.fine']);
  });

  it('drops one that matches too many elements on the page', () => {
    document.body.innerHTML = '<div>' + '<i class="many"></i>'.repeat(301) + '</div><b class="few"></b>';
    applyRepairFile(file(1, { add: ['.many', '.few'] }));
    expect(selectorFamily('youtube.count', DEFAULTS)).toEqual([...DEFAULTS, '.few']);
  });

  it('drops one that matches the page itself, a landmark, or something holding a landmark', () => {
    document.body.innerHTML = '<main class="m"><p class="p">x</p></main><div class="wrap"><nav>n</nav></div><div class="ok">y</div>';
    applyRepairFile(file(1, { add: ['.m', '.wrap', '.ok', 'body.nothing, .m'] }));
    expect(selectorFamily('youtube.count', DEFAULTS)).toEqual([...DEFAULTS, '.ok']);
  });
});

describe('a protective list takes additions only', () => {
  it('ignores a remove and an off', () => {
    applyRepairFile(file(1, { family: 'safety.words', remove: ['block'], off: true, add: ['bloquer'] }));
    expect(wordFamily('safety.words', ['block', 'report'], { protective: true })).toEqual(['block', 'report', 'bloquer']);
  });
});

describe('versions only go up', () => {
  it('an older file is ignored once a newer one is in force', () => {
    expect(applyRepairFile(file(5, { off: true }))).toBe(true);
    expect(activeRepairVersion()).toBe(5);
    expect(applyRepairFile(file(4, { family: 'youtube.count', add: ['.older'] }))).toBe(false);
    expect(selectorFamily('youtube.count', DEFAULTS)).toEqual([]);
    expect(applyRepairFile(file(5, { add: ['.same'] }))).toBe(true);
    expect(selectorFamily('youtube.count', DEFAULTS)).toEqual([...DEFAULTS, '.same']);
  });

  it('null clears the repair', () => {
    applyRepairFile(file(3, { off: true }));
    applyRepairFile(null);
    expect(activeRepairVersion()).toBe(0);
    expect(selectorFamily('youtube.count', DEFAULTS)).toBe(DEFAULTS);
  });
});

describe('the merged list is kept until the repair changes', () => {
  it('does not run the page checks again on every read', () => {
    applyRepairFile(file(1, { add: ['.once'] }));
    const spy = vi.spyOn(document, 'querySelectorAll');
    selectorFamily('youtube.count', DEFAULTS);
    const first = spy.mock.calls.length;
    selectorFamily('youtube.count', DEFAULTS);
    selectorFamily('youtube.count', DEFAULTS);
    expect(spy.mock.calls.length).toBe(first);
    spy.mockRestore();
  });
});
