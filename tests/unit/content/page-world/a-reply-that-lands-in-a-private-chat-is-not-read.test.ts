// @vitest-environment jsdom
//
// A feed request can still be on its way when the person opens their messages. The private-path check made when the
// request starts is not enough: when the response lands the page is a private conversation, and nothing from it is
// read. Fetch and XHR both ask again on arrival. A response that lands while the page is still on the feed is read.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installPageWorldInterceptor } from '../../../../src/content/page-world/fetch-interceptor';

const READ_URL = 'https://x.com/i/api/graphql/abc123/TweetDetail?variables=...';
const BODY = { data: { stub: 'permalink-response' } };

const goTo = (path: string) =>
  Object.defineProperty(window, 'location', { writable: true, configurable: true, value: new URL(`https://x.com${path}`) });

let originalFetch: typeof window.fetch;
const realOpen = XMLHttpRequest.prototype.open;
const realSend = XMLHttpRequest.prototype.send;
let dispose: (() => void) | null = null;
let events: CustomEvent[];
const listen = (e: Event) => { events.push(e as CustomEvent); };

beforeEach(() => {
  originalFetch = window.fetch;
  goTo('/home');
  events = [];
  document.addEventListener('fw:platform-payload', listen);
});

afterEach(() => {
  dispose?.();
  dispose = null;
  window.fetch = originalFetch;
  XMLHttpRequest.prototype.open = realOpen;
  XMLHttpRequest.prototype.send = realSend;
  document.removeEventListener('fw:platform-payload', listen);
});

const settle = () => new Promise((r) => setTimeout(r, 10));
const jsonResponse = () =>
  new Response(JSON.stringify(BODY), { status: 200, headers: { 'Content-Type': 'application/json' } });

/** A fetch whose response the test hands over when it chooses. */
function heldFetch(): (response: Response) => void {
  let deliver!: (response: Response) => void;
  const held = new Promise<Response>((resolve) => { deliver = resolve; });
  window.fetch = vi.fn(() => held);
  return deliver;
}

/** An XHR send that never touches the network; the test makes it load when it chooses. */
function heldXhr(): () => void {
  let sent: XMLHttpRequest | null = null;
  XMLHttpRequest.prototype.open = function () {} as typeof XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.send = function (this: XMLHttpRequest) { sent = this; };
  return () => {
    Object.defineProperty(sent!, 'responseText', { value: JSON.stringify(BODY) });
    Object.defineProperty(sent!, 'getResponseHeader', { value: () => 'application/json' });
    sent!.dispatchEvent(new Event('load'));
  };
}

describe('a feed response that lands after the person opened a private conversation', () => {
  it('fetch: control, a response that lands on the feed is read', async () => {
    const deliver = heldFetch();
    dispose = installPageWorldInterceptor();
    const got = window.fetch(READ_URL);
    deliver(jsonResponse());
    await got;
    await settle();
    expect(events).toHaveLength(1);
  });

  it('fetch: a response that lands in /messages is not read', async () => {
    const deliver = heldFetch();
    dispose = installPageWorldInterceptor();
    const got = window.fetch(READ_URL);
    goTo('/messages/123-456');
    deliver(jsonResponse());
    // The page still gets its response, untouched.
    expect(await (await got).json()).toEqual(BODY);
    await settle();
    expect(events).toEqual([]);
  });

  it('XHR: control, a response that lands on the feed is read', async () => {
    const load = heldXhr();
    dispose = installPageWorldInterceptor();
    const xhr = new XMLHttpRequest();
    xhr.open('GET', READ_URL);
    xhr.send();
    load();
    expect(events).toHaveLength(1);
  });

  it('XHR: a response that lands in /messages is not read', async () => {
    const load = heldXhr();
    dispose = installPageWorldInterceptor();
    const xhr = new XMLHttpRequest();
    xhr.open('GET', READ_URL);
    xhr.send();
    goTo('/messages/123-456');
    load();
    expect(events).toEqual([]);
  });
});
