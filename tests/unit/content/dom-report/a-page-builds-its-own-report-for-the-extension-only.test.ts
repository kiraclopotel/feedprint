// @vitest-environment jsdom
//
// The page builds its own report, and only for a request from the extension (11 Oct 2026).
//
// These tests drive the real collector on a page full of people's words: it must say what the finders found, count what
// the ledger counted, name a menu that was open, leave a chat as one marker, refuse a messages page, and hand over text
// that passes the same grammar the relay applies. The listener answers the extension's popup and nobody else.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetRepairsForTest, applyRepairFile, selectorFamily, wordFamily } from '../../../../src/core/repairs/families';
import { validateReport } from '../../../../src/core/dom-report/report';
import { collectDomReport } from '../../../../src/content/dom-report/collect';
import { installDomReportListener } from '../../../../src/content/dom-report/listen';
import { __resetFinderLedgerForTest, recordFinderEvent } from '../../../../src/diagnostics/finder-ledger';

const store: Record<string, unknown> = {};
let handler: ((message: unknown, sender: any, send: (a: unknown) => void) => boolean) | null = null;

beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key];
  handler = null;
  vi.stubGlobal('chrome', {
    runtime: { id: 'fw-ext', onMessage: { addListener: (fn: any) => { handler = fn; } } },
    storage: { local: { get: async (keys: string[]) => Object.fromEntries(keys.map((k) => [k, store[k]]).filter(([, v]) => v !== undefined)), set: async (o: Record<string, unknown>) => { Object.assign(store, o); } } },
  });
  document.body.innerHTML = '';
  window.history.pushState({}, '', '/');
  __resetRepairsForTest();
  __resetFinderLedgerForTest();
});

afterEach(() => { vi.unstubAllGlobals(); });

const FEED = `
<div role="main">
  <div role="feed">
    <div role="article" aria-label="Post by Jane Doe">
      <a href="/jane.doe.1234/posts/9876543210">Jane Doe</a>
      <div dir="auto">Engaged to Michael Smith! Call 555-0100 😀</div>
      <div role="button" aria-label="Send Message">Send Message</div>
      <span class="renamed-count">19M</span>
    </div>
  </div>
  <div role="log" aria-label="Chat with Jane"><p>meet me at Cluj station at nine</p></div>
</div>
<div role="menu"><div role="menuitem" aria-label="Unfollow Jane Doe">Unfollow Jane Doe</div></div>`;

const ask = (over: Partial<Parameters<typeof collectDomReport>[0]> = {}) =>
  collectDomReport({ product: 'off', problem: 'hid-too-much', host: 'www.facebook.com', now: new Date('2026-10-11T18:30:00Z'), ...over });

describe('the collector', () => {
  it('hands over a report that passes the grammar and carries none of the page\'s words', async () => {
    document.body.innerHTML = FEED;
    const answer = await ask();
    expect(answer.ok).toBe(true);
    if (!answer.ok) return;
    const report = JSON.parse(answer.text);
    expect(validateReport(report)).toEqual([]);
    expect(report.site).toBe('facebook');
    expect(report.product).toBe('off');
    expect(report.day).toBe('2026-10-11');
    for (const word of ['Jane', 'Doe', 'Michael', 'Smith', '555', 'Cluj', 'station', 'nine', '9876543210', 'jane.doe', 'Engaged', '😀']) {
      expect(answer.text).not.toContain(word);
    }
    expect(answer.text).toContain('"t":"private"');
  });

  it('names an open menu as a layer, with the shape of its labels', async () => {
    document.body.innerHTML = FEED;
    const answer = await ask();
    if (!answer.ok) throw new Error('refused');
    const report = JSON.parse(answer.text);
    expect(report.layers).toHaveLength(1);
    expect(JSON.stringify(report.layers[0])).toContain('"l":"unfollow+2w"');
  });

  it('says what each family found before and after a repair', async () => {
    document.body.innerHTML = FEED;
    selectorFamily('finder.facebook.test-counts', ['.old-count']);
    wordFamily('finder.ads.test-words', ['sponsored', 'ad']);
    applyRepairFile({
      version: 4, issuedAt: '2026-10-11T16:00:00Z', expiresAt: null,
      entries: [{ family: 'finder.facebook.test-counts', add: ['.renamed-count'], remove: [], off: false }],
    });
    selectorFamily('finder.facebook.test-counts', ['.old-count']); // read again: the merged list is cached after the first read
    const answer = await ask();
    if (!answer.ok) throw new Error('refused');
    const report = JSON.parse(answer.text);
    expect(report.repair).toBe(4);
    const counts = report.families.find((f: any) => f.id === 'finder.facebook.test-counts');
    expect(counts).toMatchObject({ kind: 'selector', before: 0, now: 1 });
    const words = report.families.find((f: any) => f.id === 'finder.ads.test-words');
    expect(words).toMatchObject({ kind: 'word', before: 2, now: 2 });
  });

  it('carries the ledger\'s counters, numbers only', async () => {
    document.body.innerHTML = FEED;
    recordFinderEvent('refused.hide-action-buttons.landmark');
    recordFinderEvent('refused.hide-action-buttons.landmark');
    const answer = await ask();
    if (!answer.ok) throw new Error('refused');
    expect(JSON.parse(answer.text).ledger).toEqual({ 'refused.hide-action-buttons.landmark': 2 });
  });

  it('refuses a private messages page and a site that is not ours', async () => {
    document.body.innerHTML = FEED;
    window.history.pushState({}, '', '/messages/t/123456');
    expect(await ask()).toEqual({ ok: false, reason: 'private-surface' });
    window.history.pushState({}, '', '/');
    expect(await ask({ host: 'example.com' })).toEqual({ ok: false, reason: 'not-a-site' });
  });
});

describe('the listener', () => {
  const request = { type: 'fw-dom-report', problem: 'did-not-hide' };

  it('answers the extension\'s own request with the report', async () => {
    document.body.innerHTML = FEED;
    installDomReportListener('feedprint');
    const sent = new Promise<any>((resolve) => {
      const keep = handler!(request, { id: 'fw-ext' }, resolve);
      expect(keep).toBe(true);
    });
    // The page here is jsdom's own host; the collector refuses it as not one of our sites, and says so.
    expect(await sent).toEqual({ ok: false, reason: 'not-a-site' });
  });

  it('says nothing to another extension, or to a request of any other shape', () => {
    installDomReportListener('feedprint');
    const send = vi.fn();
    expect(handler!(request, { id: 'someone-else' }, send)).toBe(false);
    expect(handler!(request, {}, send)).toBe(false);
    expect(handler!({ type: 'fw-dom-report', problem: 'please send Jane Doe' }, { id: 'fw-ext' }, send)).toBe(false);
    expect(handler!({ type: 'other' }, { id: 'fw-ext' }, send)).toBe(false);
    expect(handler!('fw-dom-report', { id: 'fw-ext' }, send)).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });
});
