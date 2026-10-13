// @vitest-environment jsdom
//
// What the platform said about an item outlives the address, and the longer text wins (the capture study of 12 Oct 2026,
// rows 3, 6 and 7 of its section 3):
//   - the platform's caption, paid-placement flag, media and author are keyed by the item's own number and stay true when the
//     address moves; only where the item was served from belongs to the surface that is left. On Reels the address changes
//     with every scroll, so almost no held caption was ever used;
//   - a shorter repeat of an item's caption (a feed's snippet beside the item's own page) does not replace the longer text;
//   - X leaves no ellipsis on a long post, and the mark the adapter put on it, cut, is not turned into folded by the later reading.

import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearPendingBatchesForRouteChange,
} from '../../../../src/content/index';
import {
  clearWireStore, enrichPostFromWire, rememberWireItem, wireFieldsFor,
} from '../../../../src/content/page-world/wire-store';
import { stampTextFold } from '../../../../src/content/record/text-fold';
import type { PostContent } from '../../../../src/types/post';

const LONG = 'A caption of a reel that Instagram sent whole with the next page of the feed, long enough to be told from a fragment.';

function fromWire(over: Partial<PostContent>): PostContent {
  return {
    id: 'DAbc123', text: LONG, author: 'poster', timestamp: '2026-10-12T09:00:00.000Z', platform: 'instagram',
    kind: 'video', parentVideoId: 'DAbc123', feedSource: 'for-you', ...over,
  } as unknown as PostContent;
}

beforeEach(() => { clearWireStore(); document.body.innerHTML = ''; });

describe('a route change keeps what the platform said about the item', () => {
  it('keeps the caption, the flag, the media and the author, and lets go of where it was served from', () => {
    rememberWireItem(fromWire({ is_sponsored: true, mediaUrls: ['https://cdn.example/a.jpg'] }));
    expect(wireFieldsFor('instagram', 'DAbc123')?.feedSource).toBe('for-you');

    clearPendingBatchesForRouteChange();

    const kept = wireFieldsFor('instagram', 'DAbc123');
    expect(kept?.text).toBe(LONG);
    expect(kept?.isSponsored).toBe(true);
    expect(kept?.mediaUrls).toEqual(['https://cdn.example/a.jpg']);
    expect(kept?.author).toBe('poster');
    expect(kept?.feedSource).toBeUndefined();
  });

  it('a cut caption read on the next address is completed from the text that arrived on the one before', () => {
    rememberWireItem(fromWire({}));
    clearPendingBatchesForRouteChange();
    const dom = fromWire({ text: 'A caption of a reel that Instagram sent whole with the next page… more', textCapture: 'cut', feedSource: 'unknown' });
    const filled = enrichPostFromWire(dom);
    expect(filled).toContain('text');
    expect(dom.text).toBe(LONG);
    expect(dom.textCapture).toBe('platform');
    expect(dom.feedSource).toBe('unknown');
  });
});

describe('the longer of two texts is kept', () => {
  it('a shorter repeat does not replace the longer text', () => {
    rememberWireItem(fromWire({}));
    rememberWireItem(fromWire({ text: 'A caption of a reel that Instagram sent' }));
    expect(wireFieldsFor('instagram', 'DAbc123')?.text).toBe(LONG);
  });

  it('a longer one replaces the snippet that came first', () => {
    rememberWireItem(fromWire({ text: 'A caption of a reel that Instagram sent' }));
    rememberWireItem(fromWire({}));
    expect(wireFieldsFor('instagram', 'DAbc123')?.text).toBe(LONG);
  });

  it('an empty text changes nothing', () => {
    rememberWireItem(fromWire({}));
    rememberWireItem(fromWire({ text: '   ' }));
    expect(wireFieldsFor('instagram', 'DAbc123')?.text).toBe(LONG);
  });
});

describe("the adapter's cut mark stands when the platform's text did not complete it", () => {
  it('X: a long post read as cut stays cut, though its link sits beside the text and no ellipsis ends it', () => {
    document.body.innerHTML = '<article><div data-testid="tweetText">The first two hundred and eighty characters of a long post</div><a data-testid="tweet-text-show-more-link" role="link">Show more</a></article>';
    const el = document.querySelector<HTMLElement>('[data-testid="tweetText"]')!;
    const post = { id: '1', text: el.textContent!.trim(), platform: 'twitter', domRef: new WeakRef(el), textCapture: 'cut' } as unknown as PostContent;
    stampTextFold(post);
    expect(post.textCapture).toBe('cut');
  });

  it('a post with no mark is still read from its element, as before', () => {
    document.body.innerHTML = '<article><div data-testid="tweetText">The first two hundred and eighty characters of a long post</div><a data-testid="tweet-text-show-more-link" role="link">Show more</a></article>';
    const el = document.querySelector<HTMLElement>('[data-testid="tweetText"]')!;
    const post = { id: '1', text: el.textContent!.trim(), platform: 'twitter', domRef: new WeakRef(el) } as unknown as PostContent;
    stampTextFold(post);
    expect(post.textCapture).toBe('folded');
  });
});
