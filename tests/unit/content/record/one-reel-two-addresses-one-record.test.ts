// @vitest-environment jsdom
//
// One Instagram reel has more than one address: /reels/<code>/ in the Reels view, /<account>/reel/<code>/ on the account's page, /p/<code>/
// for a post. The duplicate key used the address as written, so a reel recorded from one address and read again at another wrote a second
// row for one item (the Tester's recheck, 12 Oct 2026). The key now reads the address down to the code.

import { beforeEach, describe, expect, it } from 'vitest';
import { forensicDedupKey, shouldLogForensic, _resetForensicDedupForTesting } from '../../../../src/content/record/forensic-gate';
import { clearWireStore, enrichPostFromWire, rememberRecordedText } from '../../../../src/content/page-world/wire-store';
import type { PostContent } from '../../../../src/types/post';

const TEXT = 'A caption long enough to be told apart from a fragment, about a telescope image and the people behind it.';

const at = (sourceUrl: string, over: Record<string, unknown> = {}) =>
  ({ platform: 'instagram', id: 'DeTUk4sDSp-', text: TEXT, sourceUrl, kind: 'video', ...over });

beforeEach(() => { _resetForensicDedupForTesting(); clearWireStore(); });

describe('one reel, two addresses, one key', () => {
  it('the Reels view, the account\'s page and the post address share a key', () => {
    const a = forensicDedupKey(at('https://www.instagram.com/reels/DeTUk4sDSp-/'));
    expect(forensicDedupKey(at('https://www.instagram.com/nasa/reel/DeTUk4sDSp-/'))).toBe(a);
    expect(forensicDedupKey(at('https://www.instagram.com/reel/DeTUk4sDSp-/'))).toBe(a);
    expect(forensicDedupKey(at('/nasa/p/DeTUk4sDSp-/'))).toBe(a);
  });

  it('a different code is a different item', () => {
    expect(forensicDedupKey(at('https://www.instagram.com/reels/DeTUk4sDSp-/')))
      .not.toBe(forensicDedupKey(at('https://www.instagram.com/reels/DzzOther123/')));
  });

  it('the same code with different words is still two records', () => {
    expect(forensicDedupKey(at('https://www.instagram.com/reels/DeTUk4sDSp-/')))
      .not.toBe(forensicDedupKey(at('https://www.instagram.com/nasa/reel/DeTUk4sDSp-/', { text: TEXT.slice(0, 30) + '…' })));
  });

  it('an Instagram comment keeps its own address, so two comments under one post stay two', () => {
    const one = { platform: 'instagram', id: 'c1', text: 'same words', kind: 'comment', anchorUrl: 'https://www.instagram.com/p/DeTUk4sDSp-/c/111/' };
    const two = { platform: 'instagram', id: 'c2', text: 'same words', kind: 'comment', anchorUrl: 'https://www.instagram.com/p/DeTUk4sDSp-/c/222/' };
    expect(forensicDedupKey(one)).not.toBe(forensicDedupKey(two));
  });

  it('other platforms are keyed as before', () => {
    const x = { platform: 'twitter', id: 'a', text: 'same', sourceUrl: 'https://x.com/someone/status/123' };
    expect(forensicDedupKey(x)).toBe('twitter\u0000https://x.com/someone/status/123\u0000same');
    const fb = { platform: 'facebook', id: 'a', text: 'same', sourceUrl: 'https://www.facebook.com/reel/123' };
    expect(forensicDedupKey(fb)).toBe('facebook\u0000https://www.facebook.com/reel/123\u0000same');
  });

  it('an address with no code is left as written', () => {
    expect(forensicDedupKey(at('https://www.instagram.com/nasa/'))).toBe('instagram\u0000https://www.instagram.com/nasa/\u0000' + TEXT);
  });
});

describe('the reel of the recheck: recorded whole, read again cut at its second address', () => {
  it('is one row, not two', () => {
    const first = { ...at('https://www.instagram.com/reels/DeTUk4sDSp-/'), textCapture: 'whole' } as unknown as PostContent;
    expect(shouldLogForensic(forensicDedupKey(first))).toBe(true);
    rememberRecordedText(first);

    const second = {
      ...at('https://www.instagram.com/nasa/reel/DeTUk4sDSp-/'), text: 'A caption long enough to be told apart from a fr… more', textCapture: 'cut',
    } as unknown as PostContent;
    enrichPostFromWire(second);
    expect(second.text).toBe(TEXT);
    expect(shouldLogForensic(forensicDedupKey(second))).toBe(false);
  });
});
