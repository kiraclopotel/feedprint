// @vitest-environment jsdom
//
// A report is checked against a closed grammar before it leaves and again when it arrives (11 Oct 2026).
//
// The skeleton builder is written never to copy words. The grammar is the second lock: a report is accepted only if every
// string in it is a member of a closed set (a tag, a role, an attribute name, an interface word, a site section, a build
// id) or has a fixed shape (a count, a day, a counter name), so a bug in the builder, a hand-edited report or a forged one
// that carries a sentence is refused whole. Fields the grammar does not name are refused too.

import { describe, expect, it } from 'vitest';
import { assembleReport, validateReport, validateSkeleton, MAX_NODES } from '../../../../src/core/dom-report/report';
import { MAX_REPORT_CHARS } from '../../../../src/core/dom-report/skeleton';

const GOOD = () => ({
  v: 1,
  product: 'off',
  site: 'facebook',
  day: '2026-10-11',
  build: 'fwbid-mv3w1eyc-iqayk2',
  repair: 1,
  chrome: 141,
  problem: 'hid-too-much',
  view: [1400, 900],
  families: [{ id: 'finder.facebook.comment-block', kind: 'selector', before: 12, now: 0 }],
  ledger: { 'refused.hide-action-buttons.landmark': 3, 'repaired.finder.ads.label-words.added': 1 },
  page: { t: 'div', r: 'main', c: [{ t: 'div', r: 'article', a: ['aria-label', 'class'], l: 'send+message', h: '/*/posts/0?', n: 3, e: 1, s: 'n', v: { 'data-pagelet': 'FeedUnit_0' }, x: 4, c: [] }] },
  layers: [{ t: 'div', r: 'menu', c: [{ t: 'div', r: 'menuitem', l: 'unfollow' }] }],
});

describe('a good report', () => {
  it('passes', () => {
    expect(validateReport(GOOD())).toEqual([]);
  });

  it('may carry no layers and an empty ledger', () => {
    const r: any = GOOD();
    r.layers = [];
    r.ledger = {};
    r.families = [];
    expect(validateReport(r)).toEqual([]);
  });
});

describe('a report that carries a word of its own is refused', () => {
  const cases: Array<[string, (r: any) => void]> = [
    ['a field the grammar does not name', (r) => { r.note = 'Jane called me'; }],
    ['a text field on a node', (r) => { r.page.c[0].text = 'hello'; }],
    ['a tag that is not a tag', (r) => { r.page.t = 'jane'; }],
    ['a role that is not a role', (r) => { r.page.c[0].r = 'jane-doe'; }],
    ['a label with a word off the list', (r) => { r.page.c[0].l = 'send+jane'; }],
    ['a label with a name and a space', (r) => { r.page.c[0].l = 'jane doe'; }],
    ['a label with too many kept words', (r) => { r.page.c[0].l = 'send+message+like+share'; }],
    ['an address that names a person', (r) => { r.page.c[0].h = '/jane.doe/posts/0'; }],
    ['an address with a host', (r) => { r.page.c[0].h = 'https://example.com/x'; }],
    ['an attribute name that is not an attribute name', (r) => { r.page.c[0].a = ['jane']; }],
    ['an attribute name with a sentence in it', (r) => { r.page.c[0].a = ['data-hello world']; }],
    ['an attribute value with a space', (r) => { r.page.c[0].v = { 'data-pagelet': 'Jane Doe' }; }],
    ['an attribute value with a handle', (r) => { r.page.c[0].v = { 'data-pagelet': '@jane' }; }],
    ['a value on an attribute that has none to give', (r) => { r.page.c[0].v = { href: 'x' }; }],
    ['an enum attribute with another value', (r) => { r.page.c[0].v = { 'aria-expanded': 'jane' }; }],
    ['a text size that is not a size', (r) => { r.page.c[0].n = 77; }],
    ['a count that is not a count', (r) => { r.page.c[0].x = 'many'; }],
    ['a hidden state that is not a state', (r) => { r.page.c[0].s = 'jane'; }],
    ['a site that is not one of ours', (r) => { r.site = 'example.com'; }],
    ['a build that is a sentence', (r) => { r.build = 'my build is good'; }],
    ['a day that is not a day', (r) => { r.day = 'yesterday'; }],
    ['a problem that is free text', (r) => { r.problem = 'it hid Jane'; }],
    ['a ledger name with a space', (r) => { r.ledger = { 'Jane Doe': 1 }; }],
    ['a ledger value that is a word', (r) => { r.ledger = { 'refused.x.y': 'jane' }; }],
    ['a ledger value that is huge', (r) => { r.ledger = { 'refused.x.y': 1e15 }; }],
    ['a family id off our scheme', (r) => { r.families[0].id = 'jane'; }],
    ['a product that is not ours', (r) => { r.product = 'other'; }],
    ['a view that is not two numbers', (r) => { r.view = ['wide', 'tall']; }],
    ['a layer that is a string', (r) => { r.layers = ['Jane Doe']; }],
    ['more than three layers', (r) => { r.layers = [r.layers[0], r.layers[0], r.layers[0], r.layers[0]]; }],
  ];
  for (const [name, tamper] of cases) {
    it(`refuses ${name}`, () => {
      const r: any = GOOD();
      tamper(r);
      expect(validateReport(r).length).toBeGreaterThan(0);
    });
  }

  it('refuses something that is not an object at all', () => {
    for (const value of [null, 'Jane Doe', 42, [], undefined]) expect(validateReport(value).length).toBeGreaterThan(0);
  });
});

describe('a report that is too big is refused', () => {
  it('refuses more nodes than the cap', () => {
    const r: any = GOOD();
    r.page.c = Array.from({ length: MAX_NODES + 5 }, () => ({ t: 'div' }));
    expect(validateReport(r).join(' ')).toMatch(/nodes/);
  });

  it('refuses a tree that is too deep', () => {
    let node: any = { t: 'div' };
    for (let i = 0; i < 30; i++) node = { t: 'div', c: [node] };
    expect(validateSkeleton(node).join(' ')).toMatch(/deep/);
  });

  it('refuses a report longer than the cap', () => {
    const names = ['aria-label', 'aria-hidden', 'aria-expanded', 'aria-haspopup', 'aria-pressed', 'aria-checked', 'aria-selected', 'aria-live',
      'aria-modal', 'aria-disabled', 'aria-busy', 'aria-controls', 'aria-describedby', 'aria-labelledby', 'aria-owns', 'aria-current',
      'aria-level', 'aria-posinset', 'aria-setsize', 'aria-orientation'];
    const r: any = GOOD();
    r.page.c = Array.from({ length: 450 }, () => ({ t: 'div', a: names }));
    expect(JSON.stringify(r).length).toBeGreaterThan(MAX_REPORT_CHARS);
    expect(validateReport(r).join(' ')).toMatch(/too long/);
  });
});

describe('assembling a report', () => {
  const page = { t: 'div', r: 'main' };
  const base = {
    product: 'off' as const, site: 'facebook' as const, now: new Date('2026-10-11T18:20:00Z'), build: 'fwbid-mv3w1eyc-iqayk2',
    repair: 1, chrome: 141, problem: 'did-not-hide' as const, view: [1437, 913] as [number, number], families: [], page, layers: [],
  };

  it('writes the day and not the time, and rounds the window to the hundred', () => {
    const r = assembleReport({ ...base, ledger: {} });
    expect(r.day).toBe('2026-10-11');
    expect(r.view).toEqual([1400, 900]);
    expect(validateReport(r)).toEqual([]);
  });

  it('drops a ledger counter that is not a counter and keeps the rest', () => {
    const r = assembleReport({ ...base, ledger: { 'refused.hide-action-buttons.landmark': 3, 'Jane Doe': 4, 'x': -1, 'repaired.finder.a.added': 2.5 } });
    expect(Object.keys(r.ledger)).toEqual(['refused.hide-action-buttons.landmark']);
    expect(validateReport(r)).toEqual([]);
  });

  it('keeps at most three layers', () => {
    const r = assembleReport({ ...base, ledger: {}, layers: [page, page, page, page, page] });
    expect(r.layers).toHaveLength(3);
  });
});
