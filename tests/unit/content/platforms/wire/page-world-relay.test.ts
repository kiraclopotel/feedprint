// @vitest-environment jsdom
//
// Content-script relay routing tests.
//
// The contract changed on 2026-09-14 (PLAN-2026-09-14 item 4). The relay used
// to parse one platform and, behind a shadow-mode flag, dispatch the parsed
// records into the pipeline through an onPost callback. It now parses all five
// platforms and dispatches NOTHING: each parsed item is filed into the wire
// store, which fills fields onto the record the DOM-captured item produces.
// The shadow-mode flag is gone with the emit path it guarded.
//
// These tests verify the listener attaches, every platform reaches its own
// parser, the stand-down surfaces are refused, dispose detaches, and a parser
// that throws does not kill the listener.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PostContent } from '../../../../../src/types/post';

// vi.mock hoists above the relay import. The relay then receives the
// mocked parsers rather than the real implementations.
vi.mock('../../../../../src/content/platforms/wire/x', () => ({
  parseXPayload: vi.fn(),
}));

import { installPageWorldRelay, receiveWirePayload } from '../../../../../src/content/page-world/relay';
import { parseXPayload as mockedParseXPayload } from '../../../../../src/content/platforms/wire/x';
import {
  clearWireStore,
  wireFieldsFor,
  _wireStoreSizeForTesting,
} from '../../../../../src/content/page-world/wire-store';

const parseXPayload = mockedParseXPayload as unknown as ReturnType<typeof vi.fn>;

function makePost(id: string): PostContent {
  return {
    id,
    text: `body of ${id}`,
    author: 'someone',
    timestamp: new Date().toISOString(),
    platform: 'twitter',
    domRef: undefined as unknown as WeakRef<HTMLElement>,
    sourceUrl: `https://x.com/someone/status/${id}`,
    feedSource: 'for-you',
  };
}

const X_URL = 'https://x.com/i/api/graphql/abc/TweetDetail';

describe('installPageWorldRelay — routing', () => {
  let dispose: (() => void) | null = null;

  beforeEach(() => {
    parseXPayload.mockReset();
    clearWireStore();
  });

  afterEach(() => {
    dispose?.();
    dispose = null;
    clearWireStore();
  });

  it('files every parsed item into the wire store and dispatches none of them', async () => {
    parseXPayload.mockReturnValue([makePost('100'), makePost('101')]);
    dispose = installPageWorldRelay();

    document.dispatchEvent(
      new CustomEvent('fw:platform-payload', {
        detail: { platform: 'twitter', url: X_URL, body: { stub: true } },
      }),
    );
    await new Promise((r) => setTimeout(r, 0));

    expect(parseXPayload).toHaveBeenCalledTimes(1);
    expect(parseXPayload).toHaveBeenCalledWith(
      X_URL,
      { stub: true },
      expect.objectContaining({ pathname: expect.any(String) }),
    );
    // Filed, not dispatched: the wire path has no way to reach onPostDetected,
    // which is what makes "never a second record" structural.
    expect(_wireStoreSizeForTesting()).toBe(2);
    expect(wireFieldsFor('twitter', '100')?.feedSource).toBe('for-you');
  });

  it.each(['facebook', 'instagram', 'tiktok', 'youtube'])(
    '%s has a parser now — a payload on that platform is read, not skipped',
    (platform) => {
      const filed = receiveWirePayload(
        platform,
        `https://www.${platform}.com/api/`,
        { data: {} },
        { pathname: '/' },
      );
      // The real parsers run here (only X is mocked). An empty stub body
      // yields no items, which is the honest answer, but the call must not
      // throw and must not fall through to the X parser.
      expect(filed).toEqual([]);
      expect(parseXPayload).not.toHaveBeenCalled();
    },
  );

  it('refuses a payload on a surface the inventory stands down on', () => {
    parseXPayload.mockReturnValue([makePost('100')]);
    // A YouTube live chat is a stand-down surface
    // (docs/design/SURFACES-2026-09-06.md); the recorder does no work there,
    // whatever endpoint the response came from.
    const filed = receiveWirePayload(
      'youtube',
      'https://www.youtube.com/youtubei/v1/next',
      {},
      { pathname: '/live_chat' },
    );
    expect(filed).toEqual([]);
    expect(_wireStoreSizeForTesting()).toBe(0);
  });

  it('ignores payloads from a platform with no parser', () => {
    const filed = receiveWirePayload('reddit', 'https://reddit.com/x', {}, { pathname: '/' });
    expect(filed).toEqual([]);
    expect(parseXPayload).not.toHaveBeenCalled();
  });

  it('ignores malformed payload (missing detail.platform / url)', async () => {
    dispose = installPageWorldRelay();

    document.dispatchEvent(new CustomEvent('fw:platform-payload', { detail: {} }));
    document.dispatchEvent(
      new CustomEvent('fw:platform-payload', {
        detail: { platform: 'twitter' /* no url */ },
      }),
    );
    await new Promise((r) => setTimeout(r, 0));

    expect(parseXPayload).not.toHaveBeenCalled();
    expect(_wireStoreSizeForTesting()).toBe(0);
  });

  it('dispose stops further parsing', async () => {
    parseXPayload.mockReturnValue([makePost('200')]);
    const localDispose = installPageWorldRelay();
    localDispose();

    document.dispatchEvent(
      new CustomEvent('fw:platform-payload', {
        detail: { platform: 'twitter', url: X_URL, body: {} },
      }),
    );
    await new Promise((r) => setTimeout(r, 0));

    expect(parseXPayload).not.toHaveBeenCalled();
    expect(_wireStoreSizeForTesting()).toBe(0);
  });

  it('swallows parser exceptions without crashing the listener', async () => {
    parseXPayload.mockImplementationOnce(() => {
      throw new Error('parser blew up');
    });
    parseXPayload.mockReturnValue([makePost('300')]);
    dispose = installPageWorldRelay();

    document.dispatchEvent(
      new CustomEvent('fw:platform-payload', {
        detail: { platform: 'twitter', url: X_URL, body: {} },
      }),
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(_wireStoreSizeForTesting()).toBe(0);

    // Second dispatch should succeed, proving the listener survived.
    document.dispatchEvent(
      new CustomEvent('fw:platform-payload', {
        detail: { platform: 'twitter', url: X_URL, body: {} },
      }),
    );
    await new Promise((r) => setTimeout(r, 0));

    expect(_wireStoreSizeForTesting()).toBe(1);
    expect(wireFieldsFor('twitter', '300')).toBeDefined();
  });
});
