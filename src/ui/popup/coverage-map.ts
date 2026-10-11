// FeelingWise: per-page coverage map (what the popup says each page gets).
//
// The notes below say first what happens on the page, and a limit as one clause
// of method. No reason for a limit, no "yet", no weakness a later build already
// removed: on 2026-09-27 the YouTube notes still said comments were not read,
// while yt-watch-comments.ts has recorded them since 2026-08-02.
//
// Answers, for a given URL, "what does FeelingWise actually protect on THIS
// page?" so a parent can see the gaps instead of assuming blanket protection
// (the "silent Swiss cheese" failure). PURE: takes hostname + pathname, reads
// no DOM, so the popup can call it for the active tab.
//
// This is a deliberately-maintained SUMMARY that mirrors the per-platform
// adapters' real behavior (src/content/platforms/*.ts) as of 2026-06-05,
// cross-checked against code. It is NOT auto-derived from the adapters — when a
// platform adapter gains/loses a supported surface, update this map in the same
// change. The unit tests in tests/unit/ui/popup/coverage-map.test.ts lock the documented
// surfaces so drift surfaces as a test failure.
//
// Display strings (surface labels, gap notes) are localized via the optional
// `lang` parameter; default 'en' keeps every unthreaded caller byte-identical.
// Platform display names (X, Facebook…) are brand names, not copy.

import type { ResolvedUiLanguage } from '../../i18n';
import { platformOfHost } from '../../core/host-platform';
// The adapters' own surface table, read rather than copied. ui is above content
// in the layer order, so this is a downward import.
import { classifySurface, shouldStandDown } from '../../content/post-path/surfaces';

export type CoveragePlatform = 'twitter' | 'instagram' | 'tiktok' | 'facebook' | 'youtube';

interface PageProtections {
  /** Posts / captions are scanned and softened (needs a paid license + AI). */
  postScan: boolean;
  /** Comments are scanned and softened. */
  comments: boolean;
  /** Engagement counts (likes/views) can be hidden (free, DOM-only). */
  metricsHidden: boolean;
  /** Action buttons can be hidden (free, DOM-only). */
  buttonsHidden: boolean;
  /** Reels/Shorts can be blocked in child mode. */
  reelsBlockable: boolean;
}

export interface PageCoverage {
  platform: CoveragePlatform;
  platformLabel: string;
  surfaceLabel: string;
  protections: PageProtections;
  /** True when both posts AND comments are scanned here (the "full" case). */
  fullyProtected: boolean;
  /** The note shown when this surface is not fully covered (set only then). */
  gapNote?: string;
}

export const PLATFORM_LABELS: Record<CoveragePlatform, string> = {
  twitter: 'X',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  facebook: 'Facebook',
  youtube: 'YouTube',
};

// ─── Localized display strings ──────────────────────────────────────────────

interface CoverageStrings {
  // Surface labels (composed into the popup's "On this X page · {surface}").
  postReplies: string;
  photo: string;
  searchResults: string;
  homeFeed: string;
  thisFeed: string;
  reels: string;
  stories: string;
  exploreGrid: string;
  post: string;
  profileGrid: string;
  thisPage: string;
  videoComments: string;
  mainFeed: string;
  thumbnailGrid: string;
  theFeed: string;
  video: string;
  shorts: string;
  // Gap notes.
  tileGap: string;
  storiesGap: string;
  fbReelsGap: string;
  ytWatchGap: string;
  ytShortsGap: string;
  ytPageGap: string;
  ytSearchGap: string;
  ytStandDownGap: string;
}

const COVERAGE_EN: CoverageStrings = {
  postReplies: 'a post + replies',
  photo: 'a photo',
  searchResults: 'search results',
  homeFeed: 'home feed',
  thisFeed: 'this feed',
  reels: 'Reels',
  stories: 'Stories',
  exploreGrid: 'Explore grid',
  post: 'a post',
  profileGrid: 'a profile grid',
  thisPage: 'this page',
  videoComments: 'a video + comments',
  mainFeed: 'the main feed',
  thumbnailGrid: 'a thumbnail grid',
  theFeed: 'the feed',
  video: 'a video',
  shorts: 'Shorts',
  tileGap: 'On a thumbnail grid, nothing is checked. Open a post to have the post and its comments checked.',
  storiesGap: 'Stories are not checked.',
  fbReelsGap: 'Reels are not checked here.',
  ytWatchGap: 'The video and its comments go into your record; flagged comments are marked, not rewritten.',
  ytShortsGap: 'Shorts and their comments are not checked.',
  ytPageGap: 'Posts on this page are checked; comments here are not.',
  ytSearchGap: 'Community posts here are checked; the videos listed on this page are not.',
  ytStandDownGap: 'Nothing on this page is recorded. It is one of the pages the recorder steps back from.',
};

const COVERAGE_RO: CoverageStrings = {
  postReplies: 'o postare + răspunsuri',
  photo: 'o fotografie',
  searchResults: 'rezultate de căutare',
  homeFeed: 'feedul principal',
  thisFeed: 'acest feed',
  reels: 'Reels',
  stories: 'Stories',
  exploreGrid: 'grila Explore',
  post: 'o postare',
  profileGrid: 'grila unui profil',
  thisPage: 'această pagină',
  videoComments: 'un videoclip + comentarii',
  mainFeed: 'feedul principal',
  thumbnailGrid: 'o grilă de miniaturi',
  theFeed: 'feedul',
  video: 'un videoclip',
  shorts: 'Shorts',
  tileGap: 'Pe o grilă de miniaturi nu se verifică nimic. Deschide o postare ca postarea și comentariile ei să fie verificate.',
  storiesGap: 'Stories nu sunt verificate.',
  fbReelsGap: 'Reels nu sunt verificate aici.',
  ytWatchGap: 'Videoclipul și comentariile lui intră în registrul tău; comentariile semnalate sunt marcate, nu rescrise.',
  ytShortsGap: 'Shorts și comentariile lor nu sunt verificate.',
  ytPageGap: 'Postările de pe pagina asta sunt verificate; comentariile de aici nu.',
  ytSearchGap: 'Postările Community de aici sunt verificate; videoclipurile listate pe pagina asta nu.',
  ytStandDownGap: 'Nimic de pe pagina asta nu este înregistrat. Este una dintre paginile de care înregistrarea se ține deoparte.',
};


const COVERAGE_ES: CoverageStrings = {
  postReplies: 'una publicación + respuestas',
  photo: 'una foto',
  searchResults: 'resultados de búsqueda',
  homeFeed: 'el feed principal',
  thisFeed: 'este feed',
  reels: 'Reels',
  stories: 'Stories',
  exploreGrid: 'la cuadrícula de Explorar',
  post: 'una publicación',
  profileGrid: 'la cuadrícula de un perfil',
  thisPage: 'esta página',
  videoComments: 'un video + comentarios',
  mainFeed: 'el feed principal',
  thumbnailGrid: 'una cuadrícula de miniaturas',
  theFeed: 'el feed',
  video: 'un video',
  shorts: 'Shorts',
  tileGap: 'En una cuadrícula de miniaturas no se revisa nada. Abre una publicación para que se revisen la publicación y sus comentarios.',
  storiesGap: 'Las Stories no se revisan.',
  fbReelsGap: 'Aquí no se revisan los Reels.',
  ytWatchGap: 'El video y sus comentarios entran en tu registro; los comentarios señalados se marcan, no se reescriben.',
  ytShortsGap: 'Los Shorts y sus comentarios no se revisan.',
  ytPageGap: 'Las publicaciones de esta página se revisan; los comentarios de aquí, no.',
  ytSearchGap: 'Las publicaciones de la Comunidad se revisan aquí; los videos listados en esta página, no.',
  ytStandDownGap: 'Nada de esta página se registra. Es una de las páginas de las que el registro se aparta.',
};

const COVERAGE_PT_BR: CoverageStrings = {
  postReplies: 'uma publicação + respostas',
  photo: 'uma foto',
  searchResults: 'resultados de busca',
  homeFeed: 'o feed principal',
  thisFeed: 'este feed',
  reels: 'Reels',
  stories: 'Stories',
  exploreGrid: 'a grade do Explorar',
  post: 'uma publicação',
  profileGrid: 'a grade de um perfil',
  thisPage: 'esta página',
  videoComments: 'um vídeo + comentários',
  mainFeed: 'o feed principal',
  thumbnailGrid: 'uma grade de miniaturas',
  theFeed: 'o feed',
  video: 'um vídeo',
  shorts: 'Shorts',
  tileGap: 'Numa grade de miniaturas nada é verificado. Abra uma publicação para que ela e os comentários dela sejam verificados.',
  storiesGap: 'Os Stories não são verificados.',
  fbReelsGap: 'Os Reels não são verificados aqui.',
  ytWatchGap: 'O vídeo e os comentários dele entram no seu registro; os comentários sinalizados são marcados, não reescritos.',
  ytShortsGap: 'Os Shorts e os comentários deles não são verificados.',
  ytPageGap: 'As publicações desta página são verificadas; os comentários daqui, não.',
  ytSearchGap: 'As publicações da Comunidade são verificadas aqui; os vídeos listados nesta página, não.',
  ytStandDownGap: 'Nada desta página é registrado. É uma das páginas de que o registro se afasta.',
};

const COVERAGE_STRINGS: Record<ResolvedUiLanguage, CoverageStrings> = {
  en: COVERAGE_EN,
  ro: COVERAGE_RO,
  es: COVERAGE_ES,
  'pt-BR': COVERAGE_PT_BR,
};

/** Detect platform from hostname, through the one matcher (platforms/host-platform.ts). */
export function detectCoveragePlatform(hostname: string): CoveragePlatform | null {
  return platformOfHost(hostname);
}

// Protection shorthands.
const FULL: PageProtections = { postScan: true, comments: true, metricsHidden: true, buttonsHidden: true, reelsBlockable: false };
const HIDE_ONLY: PageProtections = { postScan: false, comments: false, metricsHidden: true, buttonsHidden: true, reelsBlockable: false };

function cov(platform: CoveragePlatform, surfaceLabel: string, protections: PageProtections, gapNote?: string): PageCoverage {
  return {
    platform,
    platformLabel: PLATFORM_LABELS[platform],
    surfaceLabel,
    protections,
    fullyProtected: protections.postScan && protections.comments,
    gapNote,
  };
}

function twitterCoverage(path: string, s: CoverageStrings): PageCoverage {
  // /photo BEFORE /status (M98, 2026-08-04): a photo-modal URL contains both,
  // and the adapter classifies it photo-first (detectTwitterSurface), which
  // turns the reply-tree model off there. The old order made this branch
  // unreachable and told the parent "post + replies, FULL" on a surface where
  // replies are not modeled.
  if (path.includes('/photo')) return cov('twitter', s.photo, { ...FULL, comments: false });
  if (path.includes('/status/')) return cov('twitter', s.postReplies, FULL);
  if (path.startsWith('/search')) return cov('twitter', s.searchResults, FULL);
  if (path === '/' || path.startsWith('/home')) return cov('twitter', s.homeFeed, FULL);
  return cov('twitter', s.thisFeed, FULL); // profile / list / other feeds
}

function instagramCoverage(path: string, s: CoverageStrings): PageCoverage {
  if (/^\/reels?\//.test(path)) return cov('instagram', s.reels, { ...FULL, reelsBlockable: true });
  if (path.startsWith('/stories/')) return cov('instagram', s.stories, { ...HIDE_ONLY, postScan: false }, s.storiesGap);
  if (path.startsWith('/explore')) return cov('instagram', s.exploreGrid, HIDE_ONLY, s.tileGap);
  if (/^\/p\//.test(path)) return cov('instagram', s.post, FULL);
  if (path === '/') return cov('instagram', s.homeFeed, FULL);
  // A bare single segment like /username/ is a profile grid (zero post scan).
  if (/^\/[^/]+\/?$/.test(path)) return cov('instagram', s.profileGrid, HIDE_ONLY, s.tileGap);
  return cov('instagram', s.thisPage, FULL);
}

function tiktokCoverage(path: string, s: CoverageStrings): PageCoverage {
  if (/^\/@[^/]+\/video\//.test(path)) return cov('tiktok', s.videoComments, FULL);
  if (path === '/' || path.startsWith('/foryou') || path.startsWith('/for-you') || path.startsWith('/following')) {
    return cov('tiktok', s.mainFeed, FULL);
  }
  // explore / search / hashtag / profile = tile grids (short-circuit to empty).
  if (path.startsWith('/explore') || path.startsWith('/search') || path.startsWith('/tag/') || /^\/@[^/]+\/?$/.test(path)) {
    return cov('tiktok', s.thumbnailGrid, HIDE_ONLY, s.tileGap);
  }
  return cov('tiktok', s.thisPage, FULL);
}

function facebookCoverage(path: string, s: CoverageStrings): PageCoverage {
  if (/^\/reels?\//.test(path)) {
    return cov('facebook', s.reels, { postScan: false, comments: false, metricsHidden: false, buttonsHidden: false, reelsBlockable: true },
      s.fbReelsGap);
  }
  if (path.startsWith('/photo')) return cov('facebook', s.photo, FULL);
  if (path.includes('/posts/') || path.includes('/permalink')) return cov('facebook', s.post, FULL);
  return cov('facebook', s.theFeed, FULL); // home / groups / other article feeds
}

// Rewritten 2026-09-19 to ask the adapters' own table instead of describing it
// from memory.
//
// The catch-all below used to be every YouTube path that was not /watch or
// /shorts, and it said "Community posts are scanned; YouTube comments are not
// scanned yet", which names comments as the one thing missing. Two ways that
// was untrue, both found by reading src/content/post-path/surfaces.ts beside
// it:
//
//   • On search results, a channel page or a playlist, the video tiles filling
//     the screen are never extracted. _extractHomeTiles in youtube.ts runs only
//     when classifySurface says 'youtube-home', which is '/',
//     /feed/subscriptions, /feed/trending and /feed/explore and nothing else.
//     The parent was told the only gap was comments.
//   • On /playlist, /feed/history, /account, the live tab and the live chat
//     frame, the recorder stands down and does no extraction at all. The parent
//     was told community posts were being scanned there.
//
// This is the second time this file has drifted from the adapters: M98 on
// 2026-08-04, eleven lines up, told a parent "post + replies, FULL" on a
// Twitter surface where the reply model was off. A hand-written mirror drifts;
// that is what mirrors do. So the YouTube branch no longer keeps its own copy
// of which paths are which. ui sits above content in the layer order, so
// reading the table is a downward import and allowed.
//
// The other four platforms still describe themselves from memory. They are the
// same shape of risk and are not changed here.
function youtubeCoverage(path: string, s: CoverageStrings): PageCoverage {
  if (path.startsWith('/watch')) {
    // The video and every comment and reply a person opens are read and written into the record (yt-watch-comments.ts),
    // so this page is covered: it said "limited" here until 11 Oct 2026. Its note (flagged comments are marked or hidden,
    // not rewritten) stays with the page.
    return cov('youtube', s.video, { ...HIDE_ONLY, postScan: true, comments: true }, s.ytWatchGap);
  }
  if (path.startsWith('/shorts/')) {
    return cov('youtube', s.shorts, { ...HIDE_ONLY, reelsBlockable: true }, s.ytShortsGap);
  }
  const { surface } = classifySurface('youtube', path);
  if (shouldStandDown('youtube', path)) {
    // Metrics and buttons still go: the engagement controller is a separate
    // subsystem from the recorder and does not read this table.
    return cov('youtube', s.thisPage, { ...HIDE_ONLY, postScan: false }, s.ytStandDownGap);
  }
  if (surface === 'youtube-home' || surface === 'youtube-community') {
    // The grids and the community surfaces: tiles and posts are both read here,
    // so comments really are the only gap.
    return cov('youtube', surface === 'youtube-home' ? s.homeFeed : s.thisPage,
      { ...HIDE_ONLY, postScan: true }, s.ytPageGap);
  }
  // Search, a channel's other tabs, and anything modelled but not a grid:
  // community posts are still read wherever they appear, the video tiles are
  // not, and the sentence says both.
  return cov('youtube', surface === 'youtube-search' ? s.searchResults : s.thisPage,
    { ...HIDE_ONLY, postScan: true }, s.ytSearchGap);
}

/**
 * Describe what FeelingWise protects on a given page. Returns null when the URL
 * is not a platform FeelingWise runs on (the popup then shows the generic
 * "open a social site" message).
 */
export function describePageCoverage(
  hostname: string,
  pathname: string,
  lang: ResolvedUiLanguage = 'en',
): PageCoverage | null {
  const platform = detectCoveragePlatform(hostname);
  if (!platform) return null;
  const path = pathname || '/';
  const s = COVERAGE_STRINGS[lang];
  switch (platform) {
    case 'twitter': return twitterCoverage(path, s);
    case 'instagram': return instagramCoverage(path, s);
    case 'tiktok': return tiktokCoverage(path, s);
    case 'facebook': return facebookCoverage(path, s);
    case 'youtube': return youtubeCoverage(path, s);
  }
}
