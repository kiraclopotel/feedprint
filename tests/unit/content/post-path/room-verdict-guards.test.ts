/** @vitest-environment jsdom */
// The guards added after the fresh-context review of item 4 (2026-09-15):
//   • a post with short REAL text is not judged by its room;
//   • a synthetic TikTok id (reused DOM container) is never held;
//   • the comment batch and the held post meet on the same key;
//   • the page-world wrapper does not read private surfaces, and never throws
//     into the page on an odd request.

import { afterEach, describe, expect, it } from 'vitest';
import {
  hasNoOwnText,
  holdForRoomVerdict,
  isRoomJudgeable,
  releaseHeldRoomVerdicts,
  settleRoomVerdict,
} from '../../../../src/content/post-path/room-verdict';
import {
  _peekPendingBatchKeysForTesting,
  clearPendingCommentBatchState,
  enqueueCommentForBatch,
} from '../../../../src/content/comment-batch/queue';
import {
  _mayReadForTesting as mayRead,
  installPageWorldInterceptor,
} from '../../../../src/content/page-world/fetch-interceptor';
import type { PostContent } from '../../../../src/types/post';

afterEach(() => {
  releaseHeldRoomVerdicts();
  clearPendingCommentBatchState();
  window.history.replaceState(null, '', '/');
});

describe('what counts as no text of its own', () => {
  it.each([
    [''],
    ['   '],
    ['#fyp #viral #foryou'],
    ['@someone 🔥🔥🔥'],
    ['original sound - somebody'],
    ['sunet original'],
    ['https://example.com/x 123'],
  ])('%j has no own text', (text) => {
    expect(hasNoOwnText(text)).toBe(true);
  });

  it.each([
    ['Mayor lies'],
    ['vote for me'],
    ['eu mint'],
    ['#fyp you are ugly'],
  ])('%j has its own text, however short', (text) => {
    expect(hasNoOwnText(text)).toBe(false);
  });
});

describe('which posts the room may judge', () => {
  const post = (id: string, text: string) => ({ id, parentVideoId: id, text });

  it('a text-less post with a real id', () => {
    expect(isRoomJudgeable(post('7400000000000000001', '#fyp'), 'pre-llm-too-short')).toBe(true);
  });

  it('not a short post with real words', () => {
    expect(isRoomJudgeable(post('7400000000000000001', 'Mayor lies'), 'pre-llm-too-short')).toBe(false);
  });

  it('not a synthetic TikTok id, which a reused container can hand to another video', () => {
    expect(isRoomJudgeable(post('tk-music-1789-abc123', ''), 'pre-llm-too-short')).toBe(false);
  });

  it('not a pass for any other reason', () => {
    expect(isRoomJudgeable(post('7400000000000000001', ''), 'post-llm-not-manipulative')).toBe(false);
  });
});

describe('the comment batch and the held post meet on one key', () => {
  it('a comment under the video files into the bucket the hold waits on', () => {
    const videoId = '7400000000000000002';
    const writes: unknown[] = [];
    expect(holdForRoomVerdict({ platform: 'tiktok', id: videoId, parentVideoId: videoId }, (room) => writes.push(room))).toBe(true);

    const el = document.createElement('div');
    const comment = {
      id: 'c1', text: 'a comment long enough to be read', author: 'someone',
      timestamp: '2026-09-15T06:00:00Z', platform: 'tiktok', kind: 'top-comment',
      parentVideoId: videoId, domRef: new WeakRef(el),
    } as unknown as PostContent;
    enqueueCommentForBatch(comment, async () => undefined);
    const [bucketKey] = _peekPendingBatchKeysForTesting();
    expect(bucketKey).toBe(videoId);

    // flushBatch settles with (bucket.platform, its own key): the same pair.
    expect(settleRoomVerdict('tiktok', bucketKey, {
      manipulative: false, technique: null, severity: 0, confidence: 0.5,
      summary: '', batchSize: 1, aiModel: 'm', aiProvider: 'p',
    })).toBe(true);
    expect(writes).toHaveLength(1);
  });
});

describe('page-world wrapper: private surfaces', () => {
  it('reads nothing on a chat path, on any platform', () => {
    for (const path of ['/messages/t/123', '/direct/inbox/', '/messenger']) {
      window.history.replaceState(null, '', path);
      expect(mayRead('instagram', null), path).toBe(false);
      expect(mayRead('tiktok', null), path).toBe(false);
    }
  });

  it('on Facebook reads a named feed operation and not a messaging one', () => {
    window.history.replaceState(null, '', '/');
    expect(mayRead('facebook', 'av=1&fb_api_req_friendly_name=CometNewsFeedPaginationQuery&doc_id=2')).toBe(true);
    expect(mayRead('facebook', 'fb_api_req_friendly_name=MWChatThreadListQuery')).toBe(false);
    expect(mayRead('facebook', 'fb_api_req_friendly_name=LSPlatformGraphQLLightspeedRequestQuery')).toBe(false);
    const form = new URLSearchParams({ fb_api_req_friendly_name: 'MessengerInboxQuery' });
    expect(mayRead('facebook', form)).toBe(false);
  });

  it('on Facebook an unnamed request is not read', () => {
    expect(mayRead('facebook', undefined)).toBe(false);
    expect(mayRead('facebook', 'doc_id=2')).toBe(false);
  });
});

describe('page-world wrapper: never throws into the page', () => {
  it('an XHR opened with a null address still opens', () => {
    const dispose = installPageWorldInterceptor();
    try {
      const xhr = new XMLHttpRequest();
      expect(() => xhr.open('GET', null as unknown as string)).not.toThrow();
    } finally {
      dispose();
    }
  });
});
