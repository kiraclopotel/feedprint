// @vitest-environment jsdom
//
// A heavy page still sends a report (12 Oct 2026, Board row 383).
//
// Each skeleton is built to fit its own half of the report's cap, but a page and three open layers together could still pass
// the cap, and the whole-report check then refused the report with no trimming: the person saw "Reload the page once, then try
// again" for a page that was only large. The collector now builds the page and the layers again with half as many elements
// until the whole report fits.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetRepairsForTest } from '../../../../src/core/repairs/families';
import { LAYER_MAX_NODES, MAX_LAYERS, MAX_REPORT_CHARS } from '../../../../src/core/dom-report/grammar';
import { validateReport } from '../../../../src/core/dom-report/report';
import { buildSkeleton } from '../../../../src/core/dom-report/skeleton';
import { collectDomReport } from '../../../../src/content/dom-report/collect';
import { __resetFinderLedgerForTest } from '../../../../src/diagnostics/finder-ledger';

beforeEach(() => {
  vi.stubGlobal('chrome', {
    runtime: { id: 'fw-ext', onMessage: { addListener: () => {} } },
    storage: { local: { get: async () => ({}), set: async () => {} } },
  });
  document.body.innerHTML = '';
  __resetRepairsForTest();
  __resetFinderLedgerForTest();
});

// A page whose elements differ from one another (identical siblings are described once, so a plain list stays small), made
// the same way every run.
let seed = 7;
const rnd = (n: number): number => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
const TAGS = ['div', 'span', 'section', 'article', 'ul', 'li', 'a', 'button', 'p', 'h2', 'nav', 'aside', 'form', 'label', 'figure', 'header'];
const ATTRS = ['role="button"', 'role="link"', 'role="listitem"', 'aria-label="x"', 'aria-hidden="true"', 'tabindex="0"', 'dir="auto"',
  'aria-expanded="false"', 'aria-haspopup="true"', 'aria-live="polite"', 'type="button"', 'data-a="1"', 'data-b="2"', 'data-c="3"', 'lang="en"'];
function node(depth: number): string {
  const tag = TAGS[rnd(TAGS.length)];
  const attrs = ATTRS.filter(() => rnd(3) === 0).join(' ');
  const kids = depth < 6 ? Array.from({ length: rnd(4) }, () => node(depth + 1)).join('') : '';
  return `<${tag} ${attrs}>${kids}</${tag}>`;
}
const many = (count: number): string => Array.from({ length: count }, () => node(0)).join('');

function heavyPage(): void {
  seed = 7;
  const dialog = (n: number): string => `<div role="dialog" aria-label="D${n}">${many(200)}</div>`;
  document.body.innerHTML = `<div role="main"><div role="feed">${many(900)}</div></div>${dialog(1)}${dialog(2)}${dialog(3)}`;
}

const ask = () => collectDomReport({ product: 'off', problem: 'hid-too-much', host: 'www.facebook.com', now: new Date('2026-10-12T09:00:00Z') });

describe('a heavy page', () => {
  it('is large enough that the full-size picture is over the whole-report cap (the test is not empty)', () => {
    heavyPage();
    const page = JSON.stringify(buildSkeleton(document.querySelector('[role="main"]')!, { ownHost: 'www.facebook.com' })).length;
    const layers = Array.from(document.querySelectorAll('[role="dialog"]'))
      .map((el) => JSON.stringify(buildSkeleton(el, { ownHost: 'www.facebook.com', maxNodes: LAYER_MAX_NODES })).length);
    expect(page, 'the page alone fits its half').toBeLessThanOrEqual(MAX_REPORT_CHARS / 2);
    expect(layers.length).toBe(MAX_LAYERS);
    expect(page + layers.reduce((a, b) => a + b, 0)).toBeGreaterThan(MAX_REPORT_CHARS);
  });

  it('still sends a report: smaller, within the cap, clean, and with its open layers', async () => {
    heavyPage();
    const answer = await ask();
    expect(answer.ok).toBe(true);
    if (!answer.ok) return;
    expect(answer.text.length).toBeLessThanOrEqual(MAX_REPORT_CHARS);
    const report = JSON.parse(answer.text);
    expect(validateReport(report)).toEqual([]);
    expect(report.layers).toHaveLength(MAX_LAYERS);
  });

  it('a page that already fits is built at full size, as before', async () => {
    document.body.innerHTML = '<div role="main"><div role="article"><span role="button" aria-label="Like"></span></div></div>';
    const answer = await ask();
    expect(answer.ok).toBe(true);
    if (!answer.ok) return;
    expect(JSON.parse(answer.text).page.c?.length ?? 0).toBeGreaterThan(0);
  });
});
