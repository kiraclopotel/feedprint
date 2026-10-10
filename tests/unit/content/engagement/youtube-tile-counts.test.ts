// @vitest-environment jsdom
//
// The counts switch on YouTube's video tiles: the home grid, the list beside a video and the search
// results show "views" in each tile's metadata. The count is hidden by the counts stylesheet alone
// (a walk of YouTube's page crashed tabs, youtube-engagement.ts); the channel, the title and the date
// stay. The tiles carry the shapes read on youtube.com signed out on 2026-10-06, with synthetic text.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TILE_COUNT_SELECTORS, startYouTubeEngagementControl } from '../../../../src/content/engagement/youtube-engagement';
import { adultPreset } from '../../../../src/storage/presets';
import type { FWSettings, FeatureId } from '../../../../src/storage/settings';

function settingsWith(...on: FeatureId[]): FWSettings {
  const features = adultPreset();
  for (const id of on) features[id] = { enabled: true };
  return { features } as unknown as FWSettings;
}

const ROW = 'ytContentMetadataViewModelMetadataRow';
const TEXT = 'ytAttributedStringHost ytContentMetadataViewModelMetadataText';
const LAST = 'ytContentMetadataViewModelMetadataTextLastPart';
const DOT = 'ytContentMetadataViewModelDelimiter';

// A lockup as the list beside a video draws it: the channel row, then "count • date".
const LOCKUP = `
<yt-lockup-view-model id="lockup"><div><yt-lockup-metadata-view-model>
  <h3><a id="title" href="/watch?v=t1"><span role="text">A synthetic title</span></a></h3>
  <div><yt-content-metadata-view-model>
    <div class="${ROW}" role="group"><span id="channel" class="${TEXT} ${LAST}" role="text">Synthetic channel</span><span class="ytContentMetadataViewModelIcon">v</span></div>
    <div class="${ROW}" role="group"><span id="eye" class="ytContentMetadataViewModelLeadingIcon">i</span><span id="views" class="${TEXT}" role="text">7.5M views</span><span id="dot" class="${DOT}">•</span><span id="date" class="${TEXT} ${LAST}" role="text">7 years ago</span></div>
  </yt-content-metadata-view-model></div>
</yt-lockup-metadata-view-model></div></yt-lockup-view-model>`;

// A playlist lockup: the channel row carries a dot of its own, and the second row has no count.
const PLAYLIST = `
<yt-lockup-view-model id="playlist"><yt-content-metadata-view-model>
  <div class="${ROW}" role="group"><span id="pl-channel" class="${TEXT}" role="text">Synthetic channel</span><span class="${DOT}">•</span><span id="pl-kind" class="${TEXT} ${LAST}" role="text">Playlist</span></div>
  <div class="${ROW}" role="group"><span id="pl-view" class="${TEXT} ${LAST}" role="text">View full playlist</span></div>
</yt-content-metadata-view-model></yt-lockup-view-model>`;

// The older tile body, still drawn on search results: "count" then "date" in #metadata-line.
const META_BLOCK = `
<ytd-video-renderer><ytd-video-meta-block><div id="metadata"><div id="byline-container"><a id="byline" href="/@synthetic">Synthetic channel</a></div>
  <div id="metadata-line"><span id="old-views" class="inline-metadata-item style-scope ytd-video-meta-block">1.2K views</span><span id="old-date" class="inline-metadata-item style-scope ytd-video-meta-block">3 days ago</span></div>
</div></ytd-video-meta-block></ytd-video-renderer>
<ytd-video-renderer><ytd-video-meta-block><div id="metadata-line"><span id="old-only" class="inline-metadata-item style-scope ytd-video-meta-block">Scheduled for tomorrow</span></div></ytd-video-meta-block></ytd-video-renderer>`;

// A channel's own Videos tab: one row only, the channel names first, then the view icon, the count and the date.
const CHANNEL_VIDEOS = `
<ytd-browse page-subtype="channels"><ytd-rich-item-renderer><yt-lockup-view-model id="ch-lockup">
  <h3><a id="ch-title" href="/watch?v=c1"><span role="text">A synthetic upload</span></a></h3>
  <yt-content-metadata-view-model>
    <div class="${ROW}" role="group"><span id="ch-name" class="${TEXT}" role="text">Synthetic channel</span><span class="ytContentMetadataViewModelIcon">v</span><span id="ch-dot1" class="${DOT}">•</span><span id="ch-guest" class="${TEXT}" role="text">and a guest</span><span id="ch-dot2" class="${DOT}">•</span><span id="ch-eye" class="ytContentMetadataViewModelLeadingIcon">i</span><span id="ch-views" class="${TEXT}" role="text">3.5M</span><span id="ch-dot3" class="${DOT}">•</span><span id="ch-date" class="${TEXT} ${LAST}" role="text">5d ago</span></div>
  </yt-content-metadata-view-model>
</yt-lockup-view-model></ytd-rich-item-renderer></ytd-browse>`;

// A playlist page whose tiles carry no channel row: the first row is the count row.
const PLAYLIST_PAGE = `
<ytd-browse page-subtype="playlist"><yt-lockup-view-model id="pp-lockup">
  <h3><a id="pp-title" href="/watch?v=p1&list=PLsynthetic"><span role="text">A synthetic item</span></a></h3>
  <yt-content-metadata-view-model>
    <div class="${ROW}" role="group"><span id="pp-eye" class="ytContentMetadataViewModelLeadingIcon">i</span><span id="pp-views" class="${TEXT}" role="text">3M</span><span id="pp-dot" class="${DOT}">•</span><span id="pp-date" class="${TEXT} ${LAST}" role="text">9y ago</span></div>
  </yt-content-metadata-view-model>
</yt-lockup-view-model></ytd-browse>`;

const shown = (id: string): boolean => getComputedStyle(document.getElementById(id) as Element).display !== 'none';
let stop: (() => void) | null = null;

beforeEach(() => {
  document.body.innerHTML = LOCKUP + PLAYLIST + META_BLOCK;
  window.history.pushState({}, '', '/');
});
afterEach(() => { stop?.(); stop = null; });

describe('youtube counts switch: video tiles', () => {
  it('hides the count, its icon and the dot after it, and leaves the channel, the title and the date', () => {
    stop = startYouTubeEngagementControl(settingsWith('hide-engagement-metrics'));
    for (const id of ['views', 'eye', 'dot', 'old-views']) expect(shown(id), id).toBe(false);
    for (const id of ['title', 'channel', 'date', 'old-date', 'pl-channel', 'pl-kind', 'pl-view', 'old-only', 'lockup']) {
      expect(shown(id), id).toBe(true);
    }
  });

  it('each selector matches a count and never a channel, title or date (two-sided)', () => {
    const matches = (id: string) => TILE_COUNT_SELECTORS.some(sel => (document.getElementById(id) as Element).matches(sel));
    for (const id of ['views', 'old-views']) expect(matches(id), id).toBe(true);
    for (const id of ['title', 'channel', 'date', 'old-date', 'pl-channel', 'pl-kind', 'pl-view', 'old-only']) expect(matches(id), id).toBe(false);
  });

  it('on a channel\'s Videos tab, hides the count after the view icon and keeps the channel names, the title and the date', () => {
    document.body.innerHTML = CHANNEL_VIDEOS;
    stop = startYouTubeEngagementControl(settingsWith('hide-engagement-metrics'));
    for (const id of ['ch-eye', 'ch-views', 'ch-dot3']) expect(shown(id), id).toBe(false);
    for (const id of ['ch-title', 'ch-name', 'ch-dot1', 'ch-guest', 'ch-dot2', 'ch-date']) expect(shown(id), id).toBe(true);
  });

  it('on a playlist page whose tiles have no channel row, hides the count and keeps the title and the date', () => {
    document.body.innerHTML = PLAYLIST_PAGE;
    stop = startYouTubeEngagementControl(settingsWith('hide-engagement-metrics'));
    for (const id of ['pp-eye', 'pp-views', 'pp-dot']) expect(shown(id), id).toBe(false);
    for (const id of ['pp-title', 'pp-date']) expect(shown(id), id).toBe(true);
  });

  it('leaves every tile whole while the counts switch is off', () => {
    stop = startYouTubeEngagementControl(settingsWith());
    for (const id of ['views', 'eye', 'dot', 'old-views']) expect(shown(id), id).toBe(true);
  });
});
