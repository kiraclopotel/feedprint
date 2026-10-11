// The verdict cache was keyed on the text alone, so "same here" under a kind post and under a cruel one shared one
// verdict, though the judge reads the post an item answers. The parent's text is now part of the key; an item with no
// parent keeps the exact key it always had, so cached verdicts for root posts stay valid.

import { describe, expect, it } from 'vitest';
import { verdictCacheKeyInput } from '../../../src/storage/cache-key';

const key = (parent?: string) => verdictCacheKeyInput('twitter', 'teen', 'en', 'auto', 'same here, couldn\'t agree more', parent);

describe('the verdict cache key carries the parent', () => {
  it('the same comment under two different posts gives two keys', () => {
    expect(key('What a lovely thing to do for your neighbours.')).not.toBe(key('People like her should be run out of town.'));
  });

  it('the same comment under the same post gives one key', () => {
    expect(key('What a lovely thing to do.')).toBe(key('What a lovely thing to do.'));
  });

  it('with no parent, or a blank one, the key is the one it always was', () => {
    const before = 'twitter|teen|en|auto|same here, couldn\'t agree more';
    expect(key()).toBe(before);
    expect(key('   ')).toBe(before);
  });
});
