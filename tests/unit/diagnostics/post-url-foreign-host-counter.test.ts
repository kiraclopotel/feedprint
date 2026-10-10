// @vitest-environment jsdom
//
// `postUrlForeignHost` (src/content/record/post-url.ts, notePostUrlHost) is bumped
// once per buildPostUrl call whose sourceUrl carries an absolute host that
// disagrees with the document host. Observation only: the URL is returned
// unchanged, and the console line fires once per distinct
// platform|documentHost|urlHost pairing for the life of the module.
//
// Every pairing below is fabricated and distinct, because the announced set
// is module-level and a shared pairing would make the warn assertion depend
// on test order.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/diagnostics/diagnostics', () => ({
  bumpCounter: vi.fn(),
}));

import { buildPostUrl } from '../../../src/content/record/post-url';
import { bumpCounter } from '../../../src/diagnostics/diagnostics';
import type { PostContent } from '../../../src/types/post';

const mockBump = bumpCounter as unknown as ReturnType<typeof vi.fn>;

function bumps(name: string): number {
  return mockBump.mock.calls.filter((c) => c[0] === name).length;
}

function setHost(hostname: string): void {
  Object.defineProperty(window, 'location', {
    value: { hostname, pathname: '/', href: `https://${hostname}/` },
    writable: true,
    configurable: true,
  });
}

function post(platform: PostContent['platform'], sourceUrl: string): PostContent {
  return {
    id: 'FwSynthUrl1',
    text: 'A caption long enough to be a post.',
    author: 'synth_author',
    timestamp: '2026-09-05T00:00:00.000Z',
    platform,
    domRef: new WeakRef(document.createElement('div')),
    sourceUrl,
  };
}

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  mockBump.mockReset();
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
});

describe('postUrlForeignHost counter', () => {
  it('bumps once per call when the URL host disagrees with the document host, and keeps the URL', () => {
    setHost('www.instagram.com');
    const url = 'https://www.facebook.com/synth.page/posts/1001';

    expect(buildPostUrl(post('instagram', url))).toBe(url);
    expect(buildPostUrl(post('instagram', url))).toBe(url);

    expect(bumps('postUrlForeignHost')).toBe(2);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('instagram record on www.instagram.com carries a www.facebook.com URL');
  });

  it('does not bump for the same host, a www or m front, or the x.com and twitter.com pair', () => {
    setHost('www.tiktok.com');
    expect(buildPostUrl(post('tiktok', 'https://m.tiktok.com/@synth/video/7100000000000000009'))).toContain('7100000000000000009');
    setHost('x.com');
    expect(buildPostUrl(post('twitter', 'https://twitter.com/synth/status/8100000000000000009'))).toContain('8100000000000000009');

    expect(bumps('postUrlForeignHost')).toBe(0);
    expect(warn).not.toHaveBeenCalled();
  });

  it('does not bump for a relative or unparseable sourceUrl', () => {
    setHost('www.youtube.com');
    expect(buildPostUrl(post('youtube', '/watch?v=FwSynthVid1'))).toBe('/watch?v=FwSynthVid1');
    expect(buildPostUrl(post('youtube', 'http://'))).toBe('http://');

    expect(bumps('postUrlForeignHost')).toBe(0);
  });

  it('warns once per distinct pairing, counts every call', () => {
    setHost('www.facebook.com');
    buildPostUrl(post('facebook', 'https://www.tiktok.com/@synth/video/7100000000000000010'));
    buildPostUrl(post('facebook', 'https://www.tiktok.com/@synth/video/7100000000000000011'));
    buildPostUrl(post('facebook', 'https://www.youtube.com/watch?v=FwSynthVid2'));

    expect(bumps('postUrlForeignHost')).toBe(3);
    expect(warn).toHaveBeenCalledTimes(2);
  });
});
