// YouTube's home feed and the videos it recommends beside, under and at the end of a video: the two
// switches a person turns on to be rid of them.
//
// The surface switches promise that their worst case is a missed surface, never a hidden feed. These
// two hide a feed on purpose, so their guard is the other way round: only the YouTube components
// named below are ever hidden, by their own element names, and nothing is found by walking the page.
// One stylesheet keyed on attributes set on <html> does the hiding, so a hide costs no observer and
// holds whenever YouTube draws the component again; a walk of YouTube's page is what crashed tabs
// (youtube-engagement.ts). The route is read only to place the note on the home page.

import { isFeatureEnabled, type FWSettings } from '../../storage/settings';
import { ensureStyleTag, removeStyleTag } from './style-tag';
import { countHiddenFor } from './mark-hidden';
import { MARKER_STRINGS } from '../../i18n/marker-strings';
import { resolveUiLanguage } from '../../i18n';

export const YOUTUBE_FEED_FEATURES = ['hide-home-feed', 'hide-recommended-videos'] as const;

export const YT_HOME_ATTR = 'data-fw-yt-home';
export const YT_RECS_ATTR = 'data-fw-yt-recs';
/** Set while the person chose to see the home feed on this visit; the next page clears it. */
export const YT_HOME_SHOWN_ATTR = 'data-fw-yt-home-shown';
export const YT_HOME_NOTE_ATTR = 'data-fw-yt-home-note';
export const YT_FEEDS_STYLE_ID = 'fw-youtube-feeds-css';

/** The grid on youtube.com/, with its topic chips and its Shorts shelf; the other pages' grids stay. */
export const HOME_FEED_SELECTORS: readonly string[] = [
  'ytd-browse[page-subtype="home"] ytd-rich-grid-renderer',
];

export const RECOMMENDED_SELECTORS: readonly string[] = [
  // The list beside a video, and under it on a narrow window, where YouTube moves the same element.
  'ytd-watch-next-secondary-results-renderer',
  // The player draws its end screen, the creator's end cards, autoplay's "Up next" countdown and the
  // grid under a full-screen video with class names only: it has no element names inside it, so
  // these are the one place this module names a class, each held inside the player.
  '#movie_player .ytp-endscreen-content',
  '#movie_player .ytp-endscreen-previous',
  '#movie_player .ytp-endscreen-next',
  '#movie_player .ytp-ce-element',
  '#movie_player .ytp-autonav-endscreen-countdown-overlay',
  '#movie_player .ytp-fullscreen-grid-stills-container',
];

const HOME_NOTE_HOST = 'ytd-browse[page-subtype="home"] ytd-two-column-browse-results-renderer > #primary';
// The note's place can arrive after the content script, and YouTube changes pages without a load, so
// the route is read again on its own navigation event, on popstate, and on a slow tick that reads one
// element and nothing else.
const ROUTE_TICK_MS = 2000;

function css(): string {
  const root = (attr: string, extra = '') => `html[${attr}="on"]${extra}`;
  const home = HOME_FEED_SELECTORS.map(s => `${root(YT_HOME_ATTR, `:not([${YT_HOME_SHOWN_ATTR}])`)} ${s}`);
  const recs = RECOMMENDED_SELECTORS.map(s => `${root(YT_RECS_ATTR)} ${s}`);
  return `${[...home, ...recs].join(',\n')} { display: none !important; }`;
}

const isHome = (): boolean => location.pathname === '/';

// The note is held here, so the route tick on every other page costs nothing: no search of the page.
let homeNote: HTMLElement | null = null;

function removeNote(): void {
  homeNote?.remove();
  homeNote = null;
}

function placeNote(text: string, showLabel: string): void {
  // YouTube can redraw the column and drop the note with it; then it is placed again.
  if (homeNote?.isConnected) return;
  const host = document.querySelector<HTMLElement>(HOME_NOTE_HOST);
  if (!host) return;
  const note = document.createElement('div');
  note.setAttribute(YT_HOME_NOTE_ATTR, 'true');
  note.style.cssText = 'margin:48px auto;max-width:520px;padding:0 24px;text-align:center;'
    + 'font:14px/1.5 Roboto,Arial,sans-serif;color:var(--yt-spec-text-secondary,#606060);';
  const line = document.createElement('p');
  line.textContent = text;
  line.style.cssText = 'margin:0 0 12px;';
  const show = document.createElement('button');
  show.type = 'button';
  show.textContent = showLabel;
  show.style.cssText = 'font:inherit;color:var(--yt-spec-text-primary,#0f0f0f);background:transparent;'
    + 'border:1px solid var(--yt-spec-10-percent-layer,#ccc);border-radius:18px;padding:6px 16px;cursor:pointer;';
  // Shows YouTube's own feed for this visit and changes no setting: the switch itself lives in Off's
  // popup, where a page script cannot turn it off by clicking for the person.
  show.addEventListener('click', () => {
    document.documentElement.setAttribute(YT_HOME_SHOWN_ATTR, 'true');
    removeNote();
  });
  note.append(line, show);
  host.prepend(note);
  homeNote = note;
  countHiddenFor('hide-home-feed');
}

export function resetYouTubeFeedsDOM(): void {
  const html = document.documentElement;
  html.removeAttribute(YT_HOME_ATTR);
  html.removeAttribute(YT_RECS_ATTR);
  html.removeAttribute(YT_HOME_SHOWN_ATTR);
  removeStyleTag(YT_FEEDS_STYLE_ID);
  removeNote();
  // Once, at a stop: a note left by an earlier start of the content script on this page.
  document.querySelectorAll(`[${YT_HOME_NOTE_ATTR}]`).forEach(n => n.remove());
}

export function startYouTubeFeeds(settings: FWSettings): () => void {
  const home = isFeatureEnabled(settings, 'hide-home-feed', 'youtube');
  const recs = isFeatureEnabled(settings, 'hide-recommended-videos', 'youtube');
  if (!home && !recs) return () => {};

  ensureStyleTag(YT_FEEDS_STYLE_ID, css());
  const html = document.documentElement;
  if (home) html.setAttribute(YT_HOME_ATTR, 'on');
  if (recs) html.setAttribute(YT_RECS_ATTR, 'on');

  const t = MARKER_STRINGS[resolveUiLanguage(settings.uiLanguage)];
  // The popup's tally for the recommendations: one per video watched, since the stylesheet hides
  // without a per-element step to count.
  let countedVideo = '';
  const syncRoute = (): void => {
    if (home) {
      if (isHome() && !html.hasAttribute(YT_HOME_SHOWN_ATTR)) placeNote(t.ytHomeHidden, t.ytHomeShow);
      else if (!isHome()) removeNote();
    }
    const video = location.pathname === '/watch' ? new URLSearchParams(location.search).get('v') ?? '' : '';
    if (recs && video && video !== countedVideo) {
      countedVideo = video;
      countHiddenFor('hide-recommended-videos');
    }
  };
  // A new page ends the visit the person chose to see the home feed on.
  const onNavigate = (): void => {
    html.removeAttribute(YT_HOME_SHOWN_ATTR);
    syncRoute();
  };
  syncRoute();
  document.addEventListener('yt-navigate-finish', onNavigate);
  window.addEventListener('popstate', onNavigate);
  const tick = setInterval(syncRoute, ROUTE_TICK_MS);
  return () => {
    document.removeEventListener('yt-navigate-finish', onNavigate);
    window.removeEventListener('popstate', onNavigate);
    clearInterval(tick);
    resetYouTubeFeedsDOM();
  };
}
