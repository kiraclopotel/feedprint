// @vitest-environment jsdom
//
// V1.5 substrate swap — page-world interceptor tests.
//
// Verifies that installPageWorldInterceptor wraps window.fetch and
// XMLHttpRequest.prototype.send such that responses whose URL matches
// a known X GraphQL pattern dispatch a fw:platform-payload CustomEvent
// on document, and pass through for unmatched URLs / non-JSON
// responses / errors without disturbing page JS.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installPageWorldInterceptor } from '../../../../src/content/page-world/fetch-interceptor';

describe('installPageWorldInterceptor — fetch wrap', () => {
  let originalFetch: typeof window.fetch;
  let dispose: (() => void) | null = null;

  beforeEach(() => {
    originalFetch = window.fetch;
    // Force the hostname check to register a supported platform.
    Object.defineProperty(window, 'location', {
      writable: true,
      configurable: true,
      value: new URL('https://x.com/home'),
    });
  });

  afterEach(() => {
    dispose?.();
    dispose = null;
    window.fetch = originalFetch;
  });

  it('dispatches fw:platform-payload when fetch URL matches TweetDetail', async () => {
    const tweetDetailBody = { data: { stub: 'permalink-response' } };
    window.fetch = vi.fn(async () =>
      new Response(JSON.stringify(tweetDetailBody), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const events: CustomEvent[] = [];
    document.addEventListener('fw:platform-payload', (e) =>
      events.push(e as CustomEvent),
    );

    dispose = installPageWorldInterceptor();
    await window.fetch('https://x.com/i/api/graphql/abc123/TweetDetail?variables=...');
    // Wait for the clone().json() microtask chain to drain.
    await new Promise((r) => setTimeout(r, 0));

    expect(events).toHaveLength(1);
    expect(events[0].detail).toMatchObject({
      platform: 'twitter',
      url: expect.stringContaining('TweetDetail'),
      body: tweetDetailBody,
    });
  });

  it('passes through non-matching URLs without dispatching', async () => {
    window.fetch = vi.fn(async () => new Response('{}'));

    const events: CustomEvent[] = [];
    document.addEventListener('fw:platform-payload', (e) =>
      events.push(e as CustomEvent),
    );

    dispose = installPageWorldInterceptor();
    await window.fetch('https://x.com/i/api/2/notifications/all.json');
    await new Promise((r) => setTimeout(r, 0));

    expect(events).toHaveLength(0);
  });

  it('dispose restores original fetch', () => {
    const originalImpl = vi.fn(async () => new Response('{}'));
    window.fetch = originalImpl;
    dispose = installPageWorldInterceptor();
    expect(window.fetch).not.toBe(originalImpl);
    dispose();
    dispose = null;
    expect(window.fetch).toBe(originalImpl);
  });

  it('survives a fetch that throws', async () => {
    window.fetch = vi.fn(async () => {
      throw new Error('network');
    });
    dispose = installPageWorldInterceptor();
    await expect(
      window.fetch('https://x.com/i/api/graphql/abc/TweetDetail'),
    ).rejects.toThrow('network');
  });

  it('survives non-JSON response (HTML) — does not dispatch', async () => {
    window.fetch = vi.fn(
      async () =>
        new Response('<!doctype html>', {
          headers: { 'Content-Type': 'text/html' },
        }),
    );
    const events: CustomEvent[] = [];
    document.addEventListener('fw:platform-payload', (e) =>
      events.push(e as CustomEvent),
    );
    dispose = installPageWorldInterceptor();
    await window.fetch('https://x.com/i/api/graphql/abc/TweetDetail');
    await new Promise((r) => setTimeout(r, 0));

    expect(events).toHaveLength(0);
  });
});

describe('installPageWorldInterceptor — facebook /api/graphql/ wrap', () => {
  let originalFetch: typeof window.fetch;
  let dispose: (() => void) | null = null;

  beforeEach(() => {
    originalFetch = window.fetch;
    Object.defineProperty(window, 'location', {
      writable: true,
      configurable: true,
      value: new URL('https://www.facebook.com/'),
    });
  });

  afterEach(() => {
    dispose?.();
    dispose = null;
    window.fetch = originalFetch;
  });

  it('dispatches fw:platform-payload with platform=facebook for /api/graphql/', async () => {
    const fbBody = {
      data: { stub: 'fb-response' },
      extensions: { is_final: true },
    };
    window.fetch = vi.fn(async () =>
      new Response(JSON.stringify(fbBody), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const events: CustomEvent[] = [];
    document.addEventListener('fw:platform-payload', (e) =>
      events.push(e as CustomEvent),
    );

    dispose = installPageWorldInterceptor();
    // Facebook responses are read only for a named, non-messaging operation.
    await window.fetch('https://www.facebook.com/api/graphql/', {
      method: 'POST',
      body: 'fb_api_req_friendly_name=MWChatThreadListQuery',
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(events).toHaveLength(0);

    await window.fetch('https://www.facebook.com/api/graphql/', {
      method: 'POST',
      body: 'av=1&fb_api_req_friendly_name=CometNewsFeedPaginationQuery',
    });
    await new Promise((r) => setTimeout(r, 0));

    expect(events).toHaveLength(1);
    expect(events[0].detail).toMatchObject({
      platform: 'facebook',
      url: expect.stringContaining('/api/graphql/'),
      body: fbBody,
    });
  });

  it('does not dispatch for non-graphql FB endpoints (e.g. notifications)', async () => {
    window.fetch = vi.fn(async () => new Response('{}'));
    const events: CustomEvent[] = [];
    document.addEventListener('fw:platform-payload', (e) =>
      events.push(e as CustomEvent),
    );
    dispose = installPageWorldInterceptor();
    await window.fetch('https://www.facebook.com/api/lite/notifications/');
    await new Promise((r) => setTimeout(r, 0));

    expect(events).toHaveLength(0);
  });

  it('does NOT match X /i/api/graphql/ URLs as facebook (live-probe regression)', async () => {
    // Live MCP walk on x.com home (2026-05-23) caught a phantom
    // facebook-attributed event when an X GraphQL operation that wasn't
    // one of the recognized twitter ops fell through to the FB matcher.
    // The exclusion of `/i/api/` in the FB pattern prevents this.
    const xUnrecognizedOp = { data: { stub: 'x-unrecognized-op' } };
    window.fetch = vi.fn(async () =>
      new Response(JSON.stringify(xUnrecognizedOp), {
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const events: CustomEvent[] = [];
    document.addEventListener('fw:platform-payload', (e) =>
      events.push(e as CustomEvent),
    );
    dispose = installPageWorldInterceptor();
    // X URL pattern with /api/graphql/ substring but with /i/api/ prefix
    // AND with an op name that's not in the twitter PATTERNS list.
    await window.fetch(
      'https://www.facebook.com/i/api/graphql/synthetic-doc-id/UnrecognizedOpName',
    );
    await new Promise((r) => setTimeout(r, 0));

    // No FB event because /i/api/ is excluded; no twitter event because
    // op name isn't recognized.
    expect(events).toHaveLength(0);
  });
});

describe('installPageWorldInterceptor — instagram /graphql/query/ wrap', () => {
  let originalFetch: typeof window.fetch;
  let dispose: (() => void) | null = null;

  beforeEach(() => {
    originalFetch = window.fetch;
    Object.defineProperty(window, 'location', {
      writable: true,
      configurable: true,
      value: new URL('https://www.instagram.com/'),
    });
  });

  afterEach(() => {
    dispose?.();
    dispose = null;
    window.fetch = originalFetch;
  });

  it('dispatches fw:platform-payload with platform=instagram for /graphql/query/', async () => {
    const igBody = { data: { shortcode_media: { id: '1' } }, status: 'ok' };
    window.fetch = vi.fn(async () =>
      new Response(JSON.stringify(igBody), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const events: CustomEvent[] = [];
    document.addEventListener('fw:platform-payload', (e) =>
      events.push(e as CustomEvent),
    );

    dispose = installPageWorldInterceptor();
    await window.fetch(
      'https://www.instagram.com/graphql/query/?query_hash=abc&variables={}',
    );
    await new Promise((r) => setTimeout(r, 0));

    expect(events).toHaveLength(1);
    expect(events[0].detail).toMatchObject({
      platform: 'instagram',
      url: expect.stringContaining('/graphql/query/'),
      body: igBody,
    });
  });

  it('does not dispatch for non-graphql IG endpoints', async () => {
    window.fetch = vi.fn(async () => new Response('{}'));
    const events: CustomEvent[] = [];
    document.addEventListener('fw:platform-payload', (e) =>
      events.push(e as CustomEvent),
    );
    dispose = installPageWorldInterceptor();
    await window.fetch('https://www.instagram.com/api/v1/users/web_profile_info/');
    await new Promise((r) => setTimeout(r, 0));

    expect(events).toHaveLength(0);
  });
});

describe('installPageWorldInterceptor — tiktok /comment/list/ wrap', () => {
  let originalFetch: typeof window.fetch;
  let dispose: (() => void) | null = null;

  beforeEach(() => {
    originalFetch = window.fetch;
    Object.defineProperty(window, 'location', {
      writable: true,
      configurable: true,
      value: new URL('https://www.tiktok.com/'),
    });
  });

  afterEach(() => {
    dispose?.();
    dispose = null;
    window.fetch = originalFetch;
  });

  it('dispatches fw:platform-payload with platform=tiktok for /aweme/v1/comment/list/', async () => {
    const ttBody = { comments: [], has_more: 0, status_code: 0 };
    window.fetch = vi.fn(async () =>
      new Response(JSON.stringify(ttBody), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const events: CustomEvent[] = [];
    document.addEventListener('fw:platform-payload', (e) =>
      events.push(e as CustomEvent),
    );

    dispose = installPageWorldInterceptor();
    await window.fetch(
      'https://www.tiktok.com/aweme/v1/comment/list/?aweme_id=7600000000000000001',
    );
    await new Promise((r) => setTimeout(r, 0));

    expect(events).toHaveLength(1);
    expect(events[0].detail).toMatchObject({
      platform: 'tiktok',
      url: expect.stringContaining('/comment/list/'),
      body: ttBody,
    });
  });

  it('also matches /api/comment/list/ (alternate TT endpoint)', async () => {
    window.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ comments: [] }), {
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const events: CustomEvent[] = [];
    document.addEventListener('fw:platform-payload', (e) =>
      events.push(e as CustomEvent),
    );
    dispose = installPageWorldInterceptor();
    await window.fetch('https://www.tiktok.com/api/comment/list/?aweme_id=1');
    await new Promise((r) => setTimeout(r, 0));

    expect(events).toHaveLength(1);
    expect(events[0].detail).toMatchObject({ platform: 'tiktok' });
  });

  it('does not dispatch for non-comment TT endpoints', async () => {
    window.fetch = vi.fn(async () => new Response('{}'));
    const events: CustomEvent[] = [];
    document.addEventListener('fw:platform-payload', (e) =>
      events.push(e as CustomEvent),
    );
    dispose = installPageWorldInterceptor();
    await window.fetch('https://www.tiktok.com/aweme/v1/feed/');
    await new Promise((r) => setTimeout(r, 0));

    expect(events).toHaveLength(0);
  });
});
