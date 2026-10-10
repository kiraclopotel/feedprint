// FeelingWise — X media-only ad blocker.
//
// FEED ads WITH text are the pipeline's job: extraction collects candidates
// via [data-testid="tweetText"], extractIsXSponsored flips is_sponsored, and
// injectAdHide drops the feed cell per the Block Ads toggle (E1, a292ccd).
// Media-only promos (image/video ad with NO tweetText element) never ENTER
// that path — the adapter has no tweetText node to collect, and the D5
// re-tickle loop deliberately excludes textless articles too
// (_reExtractTweetsOnPage). Known gap reported live: Block Ads ON still
// showed image-only promos on x.com/home.
//
// This module closes the gap at the ENGAGEMENT tier — pure DOM scan, no
// classification pipeline, no tokens. A throttled sweep hides any article
// that (a) has NO [data-testid="tweetText"] descendant (media-only) AND
// (b) carries X's own sponsored signal (extractIsXSponsored — the adapter's
// no-<time> + bare "Ad"/"Promoted" leaf discriminator, reused not
// duplicated). Text ads are skipped here — any article containing a
// tweetText belongs to the pipeline path (which stamps fwProcessed /
// fwActionRow on the tweetText) — so the two paths can never double-hide or
// double-log the same article.
//
// Contract (matches a292ccd): the visual hide is gated ONLY on the
// `block-ads` toggle, in every mode. Each hide writes one BLOCKED_LOG record
// (blockReason 'ads', matchedToken 'media-only-ad-marker' → detectionMode
// 'block:ads:media-only-ad-marker'), so the ledger distinguishes this DOM
// path from the pipeline's 'block:ads:platform-ad-marker' records while the
// dashboard's ads family (startsWith('block:ads:')) counts both under the
// existing 'Ads' chip (EN/RO already in color-maps + dashboard-strings).
//
// Reliability posture (same as sidebar-ad-blocker): the worst case is a
// MISSED ad (stays visible, same as today) — never a hidden organic post,
// because organic posts always carry a <time> and extractIsXSponsored
// requires the platform's own ad label.

import type { Platform } from '../../types/post';
import { isFeatureEnabled, type FWSettings } from '../../storage/settings';
import { extractIsXSponsored } from '../platforms/twitter';
import { muteAndPauseMedia } from '../hide-primitives';
import type { BlockedEventInput } from '../../types/logger-events';
import { decisionForBlock } from '../record/decision';
import { currentPageAddress } from '../record/post-url';
import { recordBlocked } from './recorder-sink';
import { fwDebug } from '../fw-log';
import { countHiddenFor, hideElement } from './mark-hidden';

/** Platforms with a verified media-only feed-ad shape. X only for now — the
 *  other platforms' textless ads have not been live-verified; everything
 *  else is a no-op (mirrors SIDEBAR_SELECTORS gating). */
const SUPPORTED_PLATFORMS: Partial<Record<Platform, true>> = {
  twitter: true,
};

// Timeline articles. X stamps both `data-testid="tweet"` and
// `role="article"`; querying the union tolerates either attr rotating
// (querySelectorAll returns document-order unique nodes).
const ARTICLE_SELECTOR = 'article[data-testid="tweet"], article[role="article"]';

/** Hide marker on the feed cell (or article fallback) — visual + re-hide
 *  dedup. Cleared by the disposer so toggle-off restores the feed. */
const HIDDEN_ATTR = 'data-fw-media-ad-hidden';
/** Ledger stamp on the article — survives the disposer so a settings-change
 *  teardown → restart cycle re-hides WITHOUT writing a duplicate BLOCKED_LOG
 *  record (same rationale as ai-content-blocker keeping fwProcessed through
 *  resetDOM: the chain already has this event). */
const LOGGED_ATTR = 'data-fw-media-ad-logged';

const THROTTLE_MS = 600;
// Bounded work per sweep: cap how many media-only candidates get the (span/
// div-walking) extractIsXSponsored evaluation in one pass. X virtualizes the
// timeline to a few dozen articles, so the cap is headroom, not a filter —
// anything past it is picked up by the next throttled pass.
const MAX_EVALUATIONS_PER_PASS = 40;

// ─── Forensic context (best-effort, mirrors ai-content-blocker's twitter
//     extractors — media-only ads have no caption, so author + permalink are
//     the useful context) ───

function pickAuthor(article: HTMLElement): string {
  for (const sel of ['[data-testid="User-Name"] a', '[data-testid="User-Names"] a']) {
    const t = article.querySelector<HTMLElement>(sel)?.textContent?.trim();
    if (t) return t.startsWith('@') ? t : `@${t.replace(/^@/, '')}`;
  }
  return 'unknown';
}

function pickPostUrl(article: HTMLElement): string {
  const href = article.querySelector<HTMLAnchorElement>('a[href*="/status/"]')?.getAttribute('href') ?? '';
  if (href) {
    return href.startsWith('http') ? href : `${window.location.origin}${href}`;
  }
  // No permalink on the ad card — the page URL still tells the parent which
  // surface served it (same fallback shape as ai-content-blocker.pickPostUrl).
  return currentPageAddress();
}

// ─── Hide + record ───

function hideMediaOnlyAd(article: HTMLElement, mode: FWSettings['mode']): void {
  // Same container walk as injector.ts AD_CONTAINER_SELECTORS.twitter: hide
  // the feed-cell wrapper (the article itself is the fallback off-feed).
  // X caveat (measured 2026-08-04, see injector.ts M96 note): the virtualizer
  // never reflows around a foreign display change, so the vacated space may
  // stay blank until X's own re-render — the ad is gone from view either
  // way, matching the pipeline ad-hide posture.
  const target = (article.closest('[data-testid="cellInnerDiv"]') as HTMLElement | null) ?? article;
  if (target.getAttribute(HIDDEN_ATTR) === 'true') return;

  // Capture forensic context BEFORE the hide (display:none keeps the subtree
  // queryable, but stay defensive against a same-tick virtualizer removal).
  const author = pickAuthor(article);
  const postUrl = pickPostUrl(article);

  // Through the door (2026-09-20): it refuses inside a private conversation,
  // and the mute below is skipped with it, because muting somebody's call is
  // not a smaller thing to do to them than hiding it.
  if (!hideElement(target, {
    marker: HIDDEN_ATTR, value: 'true',
    reason: 'block-ads:media-only-ad',
    // Counter ticks below under the once-per-page LOGGED_ATTR guard, not
    // here: a toggle-off/on cycle re-hides but must not inflate the count.
    count: 0,
  })) return;
  // display:none alone does not reliably stop a playing video ad's audio.
  muteAndPauseMedia(target);
  fwDebug(`[FW media-only-ad-blocker] hid media-only ad by ${author}`);

  // One ledger record AND one metrics tick per article per page life — a
  // toggle-off/on cycle re-hides via the branch above but must not duplicate
  // the chain event or inflate the parent-facing hidden counter.
  if (article.getAttribute(LOGGED_ATTR) === 'true') return;
  article.setAttribute(LOGGED_ATTR, 'true');
  countHiddenFor('block-ads');

  const payload: BlockedEventInput = {
    platform: 'twitter',
    mode,
    author,
    postUrl,
    blockReason: 'ads',
    matchedToken: 'media-only-ad-marker',
    // A promoted tweet with media only is a post (the X article), not a video.
    kind: 'post',
    decision: decisionForBlock({ mode, blockReason: 'ads', matchedToken: 'media-only-ad-marker', applied: 'hide', mask: false }),
    // Media-only: there is no caption text. logBlockedEvent substitutes the
    // '[blocked: ads]' placeholder as the audit originalText.
    caption: '',
  };
  // Fire-and-forget through the high-stakes retry buffer; the SW handler
  // serializes the chain write under the shared lock (same route as the
  // ai-content / reels blockers).
  recordBlocked(payload);
}

/**
 * One sweep over the visible timeline articles. Exported for tests.
 * Media-only + sponsored → hide + log; anything with a tweetText descendant
 * (text ad OR organic text post) is the pipeline's territory and skipped;
 * organic media-only posts fail extractIsXSponsored (they carry a <time>).
 */
export function scanMediaOnlyAds(mode: FWSettings['mode']): void {
  let evaluated = 0;
  for (const article of document.querySelectorAll<HTMLElement>(ARTICLE_SELECTOR)) {
    if (evaluated >= MAX_EVALUATIONS_PER_PASS) break;
    // Already handled (article hidden directly, or inside a hidden cell).
    if (article.closest(`[${HIDDEN_ATTR}="true"]`)) continue;
    // Has text → pipeline's job (avoid double-hide/double-log with the
    // sponsored-ad verdict path). Also skips a media-only ad QUOTING a text
    // tweet — conservative: a missed ad, never a wrongly hidden post.
    if (article.querySelector('[data-testid="tweetText"]')) continue;
    evaluated++;
    if (!extractIsXSponsored(article)) continue;
    hideMediaOnlyAd(article, mode);
  }
}

/**
 * Start the media-only ad blocker for `platform`. No-op unless block-ads is
 * ON for the platform AND the platform has a verified media-only ad shape.
 * Returns a disposer that stops the observer and restores hidden cells.
 */
export function startMediaOnlyAdBlocker(platform: Platform, settings: FWSettings): () => void {
  if (!isFeatureEnabled(settings, 'block-ads', platform)) return () => {};
  if (!SUPPORTED_PLATFORMS[platform]) return () => {};
  const mode = settings.mode;

  // Throttled sweep on DOM churn — same scheduler shape as
  // sidebar-ad-blocker: at most one scan per THROTTLE_MS, driven by a body
  // MutationObserver (X's SPA timeline mutates constantly while scrolling).
  let timer: ReturnType<typeof setTimeout> | 0 = 0;
  let lastRun = 0;
  const run = () => {
    timer = 0;
    lastRun = Date.now();
    scanMediaOnlyAds(mode);
  };
  const schedule = () => {
    if (timer) return;
    const wait = Math.max(0, THROTTLE_MS - (Date.now() - lastRun));
    timer = setTimeout(run, wait);
  };

  run();
  const mo = new MutationObserver(schedule);
  mo.observe(document.body, { childList: true, subtree: true });

  return () => {
    mo.disconnect();
    if (timer) clearTimeout(timer);
    document.querySelectorAll<HTMLElement>(`[${HIDDEN_ATTR}="true"]`).forEach((el) => {
      el.removeAttribute(HIDDEN_ATTR);
      el.style.removeProperty('display');
      // Media stays muted after a reveal — same deliberate posture as the
      // hard-hide reveal path (a revealed ad comes back silent; the next
      // user interaction or remount restores platform-owned audio state).
    });
    // LOGGED_ATTR is intentionally NOT cleared — the chain already has the
    // record; clearing would double-log on the next toggle-on.
  };
}

// Exported for the engagement controller / tests.
export const MEDIA_ONLY_AD_HIDDEN_ATTR = HIDDEN_ATTR;
export const MEDIA_ONLY_AD_LOGGED_ATTR = LOGGED_ATTR;
