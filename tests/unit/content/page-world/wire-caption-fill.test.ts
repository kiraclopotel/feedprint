// @vitest-environment jsdom
//
// The caption the page does not put in its HTML (docs/spec/known-issues.md M138): TikTok's For
// You unit carries no caption element, so the DOM adapter records the video with empty text and
// the room under it decides. Since 2026-09-17 (PLAN-2026-09-17 item 6) the caption the platform's
// own data sent for that video is written into the empty text, and the record says where it came
// from: `textCapture: 'platform'`. Three things this file holds:
//   1. an empty DOM text takes the wire caption and is marked;
//   2. a text the DOM did read, however short, is never replaced and never re-marked;
//   3. a video the platform itself sent without a caption stays empty, so the room still decides.
import { beforeEach, describe, expect, it } from 'vitest';

import { receiveWirePayload } from '../../../../src/content/page-world/relay';
import { clearWireStore, enrichPostFromWire } from '../../../../src/content/page-world/wire-store';
import type { PostContent } from '../../../../src/types/post';
import tiktokForYou from '../../../fixtures/wire/tiktok/item-list-for-you.json';

const URL = 'https://www.tiktok.com/api/recommend/item_list/';

function domVideo(id: string, text: string): PostContent {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return {
    id: `tk-vid-${id}`,
    text,
    author: 'unknown',
    timestamp: '2026-09-17T03:00:00.000Z',
    platform: 'tiktok',
    domRef: new WeakRef(el),
    kind: 'video',
    parentVideoId: `tk-vid-${id}`,
    feedSource: 'unknown',
  } as unknown as PostContent;
}

beforeEach(() => {
  clearWireStore();
  document.body.innerHTML = '';
  receiveWirePayload('tiktok', URL, tiktokForYou, { pathname: '/' });
});

describe('a caption the page did not carry comes from the platform data, and says so', () => {
  it('fills an empty text with the wire caption and marks the record', () => {
    const dom = domVideo('7000000000000000001', '');
    const filled = enrichPostFromWire(dom);
    expect(filled).toContain('text');
    expect(dom.text).toBe('Synthetic caption for a for-you video.');
    expect(dom.textCapture).toBe('platform');
  });

  it('never replaces a text the DOM read, however short', () => {
    const dom = domVideo('7000000000000000001', 'ok');
    const filled = enrichPostFromWire(dom);
    expect(filled).not.toContain('text');
    expect(dom.text).toBe('ok');
    expect(dom.textCapture).toBeUndefined();
  });

  it('leaves a video the platform sent without a caption empty, for the room to decide', () => {
    const dom = domVideo('7000000000000000002', '');
    const filled = enrichPostFromWire(dom);
    expect(filled).not.toContain('text');
    expect(dom.text).toBe('');
    expect(dom.textCapture).toBeUndefined();
  });

  it('whitespace is not a text: it is filled like an empty one', () => {
    const dom = domVideo('7000000000000000001', '  \n ');
    enrichPostFromWire(dom);
    expect(dom.text).toBe('Synthetic caption for a for-you video.');
    expect(dom.textCapture).toBe('platform');
  });
});
