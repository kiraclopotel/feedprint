// @vitest-environment jsdom
//
// TikTok video-caption engagement metrics. The caption record never carried
// metrics before (only comments did), so TikTok posts showed blank engagement.
// extractTikTokVideoMetrics reads the For-You action rail's data-e2e counts,
// scoped to the video's own recommend-list-item-container. Values + structure
// captured from the live tiktok.com/foryou DOM on 2026-06-15.

import { describe, it, expect } from 'vitest';
import { extractTikTokVideoMetrics } from '../../../../src/content/platforms/tiktok';

function container(html: string): HTMLElement {
  const el = document.createElement('div');
  el.setAttribute('data-e2e', 'recommend-list-item-container');
  el.innerHTML = html;
  return el;
}

describe('extractTikTokVideoMetrics', () => {
  it('reads exact like / comment / share counts from the action rail', () => {
    const c = container(`
      <strong data-e2e="like-count">6723</strong>
      <strong data-e2e="comment-count">23</strong>
      <strong data-e2e="favorite-count">535</strong>
      <strong data-e2e="share-count">75</strong>
    `);
    expect(extractTikTokVideoMetrics(c)).toEqual({ likes: 6723, reply_count: 23, shares: 75 });
  });

  it('expands compressed counts (1.2K / 3M)', () => {
    const c = container(`
      <strong data-e2e="like-count">1.2M</strong>
      <strong data-e2e="comment-count">10.5K</strong>
      <strong data-e2e="share-count">2K</strong>
    `);
    expect(extractTikTokVideoMetrics(c)).toEqual({ likes: 1_200_000, reply_count: 10_500, shares: 2_000 });
  });

  it('omits keys whose count is absent (partial rail)', () => {
    const c = container('<strong data-e2e="like-count">6723</strong>');
    expect(extractTikTokVideoMetrics(c)).toEqual({ likes: 6723 });
  });

  it('returns undefined when the action rail has not rendered (off-screen video)', () => {
    expect(extractTikTokVideoMetrics(container('<div>no rail yet</div>'))).toBeUndefined();
  });

  it('does not cross-read — only counts inside this container', () => {
    // Two video containers; the function must read only its own.
    const own = container('<strong data-e2e="like-count">100</strong><strong data-e2e="comment-count">5</strong>');
    const other = document.createElement('div');
    other.innerHTML = '<strong data-e2e="like-count">999999</strong>';
    document.body.append(own, other);
    expect(extractTikTokVideoMetrics(own)).toEqual({ likes: 100, reply_count: 5 });
    document.body.innerHTML = '';
  });
});
