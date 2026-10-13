import {
  VIDEO_FEED_SURFACES,
  afterFeedItemHidden,
  snapshotCommentPanel,
  snapshotWatched,
} from '../../src/content/protection/video-feed-hide';

/**
 * A hide that takes a card's box away (display:none), the way a TikTok card was hidden before 13 Oct 2026, followed by the step
 * every hide of a video feed's card takes (afterFeedItemHidden). TikTok's own cards keep their box now (video-feed-hide.ts
 * keepsItemBox), but the move to the next card and the hold of the watched one belong to any hide that does move the feed,
 * so the tests of their timing make the collapse themselves.
 */
export function collapseCard(item: HTMLElement): void {
  const surface = VIDEO_FEED_SURFACES.find((s) => s.name === 'tiktok-feed')!;
  const comments = snapshotCommentPanel(surface);
  const watch = snapshotWatched(item, surface);
  item.setAttribute('data-fw-hard-hidden', 'true');
  item.style.setProperty('display', 'none', 'important');
  afterFeedItemHidden(item, surface, comments, watch);
}
