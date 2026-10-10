// Twitter engagement-metric extraction — the action-bar aria-label parser.
//
// X's per-button count spans abbreviate ("13K") and, as of the 2026-06-15 live
// DOM, concatenate adjacent numbers, which broke `extractTweetMetrics`. The
// robust, exact source is the action-bar `role="group"` aria-label (an
// accessibility contract X keeps stable). These cases lock the parser against
// labels captured verbatim from the live x.com home feed on 2026-06-15.

import { describe, it, expect } from 'vitest';
import { parseTweetGroupAriaLabel } from '../../../../src/content/platforms/twitter';

describe('parseTweetGroupAriaLabel', () => {
  it('parses a full label into exact counts', () => {
    expect(
      parseTweetGroupAriaLabel('40 replies, 52 reposts, 549 likes, 55 bookmarks, 13878 views'),
    ).toEqual({ replies: 40, reposts: 52, likes: 549, bookmarks: 55, views: 13878 });
  });

  it('omits the zero-count actions X leaves out of the label', () => {
    // A post with no replies and no bookmarks: those segments are simply absent
    // — the key stays undefined (omitted from the record), never recorded as 0.
    expect(parseTweetGroupAriaLabel('5 reposts, 19 likes, 255863 views')).toEqual({
      reposts: 5,
      likes: 19,
      views: 255863,
    });
  });

  it('does not cross-match the nouns (replies / reposts / likes)', () => {
    expect(
      parseTweetGroupAriaLabel('98 replies, 337 reposts, 1489 likes, 586 bookmarks, 475547 views'),
    ).toEqual({ replies: 98, reposts: 337, likes: 1489, bookmarks: 586, views: 475547 });
  });

  it('strips comma-grouped thousands defensively', () => {
    expect(parseTweetGroupAriaLabel('1,354 reposts, 1,055,853 views')).toEqual({
      reposts: 1354,
      views: 1055853,
    });
  });

  it('returns an empty object for null/empty input', () => {
    expect(parseTweetGroupAriaLabel(null)).toEqual({});
    expect(parseTweetGroupAriaLabel(undefined)).toEqual({});
    expect(parseTweetGroupAriaLabel('')).toEqual({});
  });
});
