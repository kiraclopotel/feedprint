// @vitest-environment jsdom
//
// Cold audit 13 Oct 2026, finding 6: on Facebook the Messenger dock is served by the same /api/graphql/ endpoint
// as the feed, so the page-world script told them apart by a deny-list of messaging words in the operation name. A
// session in a real logged-in Facebook (14 Oct 2026, names only) saw the Messenger menu send five requests, and the
// deny-list caught one. A Facebook response is now read only when its operation is one of the feed operations seen
// carrying posts; the deny-list stays as a second lock.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installPageWorldInterceptor } from '../../../../src/content/page-world/fetch-interceptor';

const FEED = [
  'CometNewsFeedPaginationQuery',
  'ProfileCometTimelineFeedRefetchQuery',
  'CometSinglePostDialogContentQuery',
  'CommentsListComponentsPaginationQuery',
  'FBUnifiedVideoRootWithEntrypointQuery',
];

// What the Messenger menu sent on 14 Oct 2026.
const MESSENGER_MENU = [
  'CometMessagingJewelDropdownEBUpsellContainerQuery',
  'CometMessagingJewelDropdownOnboardingUpsellQuery',
  'useMWEncryptedBackupsFetchBackupIdsV2Query',
  'RTWebCallBlockSettingHooksQuery',
  'OhaiWebPublicKeyConfigQuery',
  'MAWVerifyThreadCutover_ContactCapabilities2Query',
];

describe('Facebook: only known feed operations are read', () => {
  let originalFetch: typeof window.fetch;
  let dispose: (() => void) | null = null;
  let events: CustomEvent[];
  const listen = (e: Event) => events.push(e as CustomEvent);

  beforeEach(() => {
    originalFetch = window.fetch;
    Object.defineProperty(window, 'location', {
      writable: true,
      configurable: true,
      value: new URL('https://www.facebook.com/'),
    });
    window.fetch = vi.fn(async () => new Response(JSON.stringify({ data: {} }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    events = [];
    document.addEventListener('fw:platform-payload', listen);
    dispose = installPageWorldInterceptor();
  });

  afterEach(() => {
    dispose?.();
    dispose = null;
    document.removeEventListener('fw:platform-payload', listen);
    window.fetch = originalFetch;
  });

  async function request(name: string): Promise<number> {
    const before = events.length;
    await window.fetch('https://www.facebook.com/api/graphql/', {
      method: 'POST',
      body: `av=1&fb_api_req_friendly_name=${encodeURIComponent(name)}&doc_id=1`,
    });
    await new Promise((r) => setTimeout(r, 0));
    return events.length - before;
  }

  it.each(FEED)('a feed operation is read: %s', async (name) => {
    expect(await request(name)).toBe(1);
  });

  it.each(MESSENGER_MENU)('a Messenger menu operation is not read: %s', async (name) => {
    expect(await request(name)).toBe(0);
  });

  it('an operation nobody has seen carry posts is not read', async () => {
    expect(await request('CometSearchBootstrapKeywordsDataSourceQuery')).toBe(0);
    expect(await request('SomeOperationAddedNextMonthQuery')).toBe(0);
  });

  it('an unnamed request is not read', async () => {
    await window.fetch('https://www.facebook.com/api/graphql/', { method: 'POST', body: 'av=1&doc_id=1' });
    await new Promise((r) => setTimeout(r, 0));
    expect(events).toHaveLength(0);
  });
});
