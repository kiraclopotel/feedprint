// The name a reader sees for a switch a record says was on. The record signs the ids; the card
// prints the name the popup gives the same switch, so the two screens use one word for it.

import type { FeatureId } from '../../types/feature-id';
import type { PopupStrings } from '../../i18n/popup/types';
import type { DashboardStrings } from '../../i18n/dashboard/types';

const NAMES: Record<FeatureId, (p: PopupStrings, d: DashboardStrings) => string> = {
  'rewritten-comments-first': (p) => p.featRewriteName,
  'show-reframe-markers': (p) => p.featMarkersName,
  'hide-engagement-metrics': (p) => p.featHideMetricsName,
  'hide-action-buttons': (p) => p.featHideActionsName,
  'block-comment-posting': (p) => p.featBlockPostingName,
  'strip-emojis': (p) => p.featStripEmojisName,
  'block-ai-content': (p) => p.featBlockAiName,
  'block-reels': (p) => p.featBlockReelsName,
  'hide-stories': (p) => p.featHideStoriesName,
  'hide-suggestions': (p) => p.featHideSuggestionsName,
  'hide-marketplace': (p) => p.featHideMarketplaceName,
  'hide-groups': (p) => p.featHideGroupsName,
  'hide-right-column': (p) => p.featHideRightColumnName,
  'hide-home-feed': (p) => p.featHideHomeFeedName,
  'hide-recommended-videos': (p) => p.featHideRecommendedName,
  'media-timeout': (p) => p.groupBreak,
  'block-ads': (p) => p.featBlockAdsName,
  'parent-blocklist': (p) => p.rulesName,
  'soften-swearing': (p) => p.softenSwearingName,
  'reframe-rewrites': (p) => p.reframeRewritesName,
  'comments-to-analyze-per-video': (_p, d) => d.featCommentsPerVideo,
};

export const FEATURE_IDS = Object.keys(NAMES) as FeatureId[];

/** The reader's name for a signed switch id; an id no build names any more is shown as signed. */
export function featureLabel(id: string, p: PopupStrings, d: DashboardStrings): string {
  return Object.prototype.hasOwnProperty.call(NAMES, id) ? NAMES[id as FeatureId](p, d) : id;
}
