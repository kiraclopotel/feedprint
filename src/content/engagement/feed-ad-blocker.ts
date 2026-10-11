// FeelingWise — feed ad hider.
//
// In the recorder, feed ads are mostly the pipeline's job: the adapter flags
// is_sponsored, the sponsored gate hides the post and a record is written.
// Off carries no pipeline, so until 2026-09-03 its "Block ads" switch hid
// only X's sidebar modules and X's textless promos; a Facebook feed ad (an
// "Ad" post with a large picture, in the first live test) stayed. This
// module is the DOM-tier rule for every platform in Off. In the recorder it
// runs only for the ad slots a platform's rule names as beyond the
// pipeline's reach (`feedprint`; YouTube's search and side slots, 2026-10-09),
// and every hide there writes its record, so no ad is hidden without one.
//
// Reliability posture, same as the other ad modules: the worst case is a
// MISSED ad, never a hidden organic post. A container is an ad when
//   (a) the platform adapter's own deterministic detector says so
//       (extractIsXSponsored and friends: the exact leaf label, the
//       data-e2e marker, the aria-label, the /ads/about link), or
//   (b) an element inside it, outside the post body and outside every
//       comment, has as its ENTIRE text one of the platforms' ad labels
//       (engagement/ad-labels.ts, many languages), or
//   (c) on YouTube, the container IS one of the ad renderers.
// A caption or a comment that merely mentions sponsorship never qualifies:
// bodies and comment subtrees are excluded from (b), and (a) already
// anchors on the label element.

import type { Platform } from '../../types/post';
import { isFeatureEnabled, type FWSettings } from '../../storage/settings';
import { isOffProduct } from '../../product';
import { extractIsXSponsored } from '../platforms/twitter';
import { hasFacebookAdMarker } from '../platforms/facebook';
import { extractIsInstagramSponsored } from '../platforms/instagram';
import { extractIsTikTokSponsored } from '../platforms/tiktok';
import { isInPrivateChatSubtree } from '../platforms/adapter';
import { muteAndPauseMedia, noteAdSlot, removeAdSlotNote } from '../hide-primitives';
import { MARKER_STRINGS } from '../../i18n/marker-strings';
import { resolveUiLanguage, type ResolvedUiLanguage } from '../../i18n';
import {
  isAdLabelText, labelTexts, piecedLabelText, spacedText, AD_CONTROLS, SHORT_CONTROL_LABEL, LABEL_BEARERS, AD_LABEL_MAX_LENGTH,
} from './ad-labels';
import { countHiddenFor, markHidden } from './mark-hidden';
import { observeAddedRoots } from './added-roots';
import { recordBlocked } from './recorder-sink';
import { startPlayerAdCover } from './youtube-player-ad';
import { decisionForBlock } from '../record/decision';
import { currentPageAddress } from '../record/post-url';
import {
  afterFeedItemHidden, isHiddenByUs, isWatchedItem, releaseVideoItem, snapshotCommentPanel, snapshotWatched, videoFeedItemOf,
  type VideoFeedSurface,
} from '../protection/video-feed-hide';

export const FEED_AD_HIDDEN_MARKER = 'data-fw-feed-ad';
/** Stamped on every container judged once, so the judged tally counts each post once. */
const FEED_AD_JUDGED_MARKER = 'data-fw-ad-judged';

interface AdRule {
  /** Post containers to judge. */
  container: string;
  /** Hidden element: the container's closest match, else the container. */
  hideTarget?: string;
  /** Subtrees inside a container where a label leaf is never a marker. */
  exclude: string;
  /** The adapter's own detector, tried first. */
  platformSignal?: (container: Element) => boolean;
  /** Containers that are ads by element name alone. */
  alwaysAd?: string;
  /**
   * An `alwaysAd` match of `slot` inside a `host` hides that host instead: a panel whose header is the ad, a Shorts card
   * whose overlay is the ad. Any other ad slot hides alone, wherever it sits. A hidden host whose slot has gone (the box
   * reused for other content) is shown again.
   */
  alwaysAdHost?: { slot: string; host: string }[];
  /**
   * Feedprint: the rule hides and records the `alwaysAd` slots itself, except inside `leftToPipeline`, which the
   * recorder's pipeline hides and records. Absent: the rule stands down in Feedprint, where the pipeline hides and
   * records the platform's feed ads.
   */
  feedprint?: { leftToPipeline: string };
  /**
   * False where the adapter's detector is the whole rule: X's label is a
   * bare "Ad" leaf that organic posts can also carry inside a card, and the
   * adapter's no-<time> discriminator is what keeps it precise.
   */
  genericLeaf: boolean;
  /**
   * display:none closes the gap; Instagram positions its windowed feed from
   * its own height bookkeeping and removing a box truncated the feed below
   * the ad (measured live 2026-08-11, injector.ts Q87), so it gets
   * visibility:hidden and keeps the box.
   */
  hideMode: 'display' | 'visibility';
}

const RULES: Record<Platform, AdRule> = {
  twitter: {
    container: 'article[data-testid="tweet"], article[role="article"]',
    hideTarget: '[data-testid="cellInnerDiv"]',
    exclude: '[data-testid="tweetText"], [data-testid="card.layoutLarge.media"], [data-testid="card.layoutSmall.media"]',
    platformSignal: extractIsXSponsored,
    genericLeaf: false,
    hideMode: 'display',
  },
  facebook: {
    // Feed units are `[aria-posinset]` on the home feed (the role=article
    // inside one is an empty shell; the recorder's adapter reads the same
    // boundary), `div[role="article"]` elsewhere (permalinks, the photo
    // viewer). Comments are role=article too, nested inside the post; a
    // nested container is never judged on its own (see scan) and is excluded
    // from the label walk of its post, as is the post body.
    container: '[aria-posinset], div[role="article"]',
    exclude: '[aria-posinset] [role="article"], [role="article"] [role="article"], [data-ad-rendering-role="story_message"], [data-ad-comet-preview], [data-ad-preview], [role="log"]',
    // The cheap markers only; the label walk below is the one walk per post.
    platformSignal: (c) => hasFacebookAdMarker(c) || hasAdsAboutLink(c),
    genericLeaf: true,
    hideMode: 'display',
  },
  instagram: {
    container: 'article',
    exclude: 'ul, li, h1, [data-testid*="caption"]',
    platformSignal: extractIsInstagramSponsored,
    genericLeaf: true,
    hideMode: 'visibility',
  },
  tiktok: {
    container: '[data-e2e="recommend-list-item-container"]',
    exclude: '[data-e2e^="comment"], [data-e2e="video-desc"], [data-e2e="browse-video-desc"]',
    platformSignal: extractIsTikTokSponsored,
    genericLeaf: true,
    hideMode: 'display',
  },
  youtube: {
    container: 'ytd-rich-item-renderer, ytd-video-renderer, ytd-compact-video-renderer',
    exclude: '#description, #description-inline-expander, #content-text, ytd-comment-renderer, ytd-comment-view-model, ytd-comment-thread-renderer',
    // The last three are the watch page's right column, read logged out
    // 2026-10-09 on three watch pages, in a fresh profile signed in
    // nowhere, where Off 1.0.13 left them drawn: the companion slot above the related
    // videos, and the ads engagement panel, whose header is the ad lockup.
    // The ad inside the player (#movie_player) is never touched.
    // Last, a channel's shop shelf under the video: product cards with prices and outbound links, headed "Shop" (read
    // signed out 2026-10-09 on a Fox News watch page, 4 of 4 reads; the tester's finding 5). It was Off's alone at
    // first; with both installed Off leaves ads to Feedprint, and the shelf stayed (the two-product finding of
    // 9 Oct 2026), so it is an ad slot to both.
    alwaysAd: 'ytd-ad-slot-renderer, ytd-promoted-video-renderer, ytd-in-feed-ad-layout-renderer, ytd-promoted-sparkles-web-renderer, ytd-display-ad-renderer, ytd-banner-promo-renderer, '
      + 'ytd-player-legacy-desktop-watch-ads-renderer, ytd-companion-slot-renderer, panel-ad-header-image-lockup-view-model, ytd-merch-shelf-renderer',
    // A Shorts ad is a card of the Shorts player whose overlay is an ad slot,
    // and the card holds the ad's video (read signed out 2026-10-09: 6 of 21
    // screens, the video inside ytd-reel-video-renderer every time). The card
    // goes and the feed moves on, as for any hidden Shorts card.
    alwaysAdHost: [
      { slot: 'panel-ad-header-image-lockup-view-model', host: 'ytd-engagement-panel-section-list-renderer' },
      { slot: 'ytd-ad-slot-renderer', host: 'ytd-reel-video-renderer' },
    ],
    hideTarget: 'ytd-rich-item-renderer',
    // Feedprint's pipeline knows YouTube's ad shapes on home tiles only
    // (injector.ts AD_CONTAINER_SELECTORS); the search page's slots and the
    // right column are this rule's in Feedprint too (tester 2026-10-09: 8 ad
    // slots on search, 0 hidden, at every level).
    feedprint: { leftToPipeline: 'ytd-rich-item-renderer' },
    genericLeaf: true,
    hideMode: 'display',
  },
};

function hasAdsAboutLink(container: Element): boolean {
  for (const a of container.querySelectorAll<HTMLAnchorElement>('a[href*="/ads/about"]')) {
    if (!a.closest('[role="article"] [role="article"]')) return true;
  }
  return false;
}

/** (b): a label element outside the body and the comments. */
function hasAdLabelLeaf(container: Element, rule: AdRule): boolean {
  // The label test is cheap and fails for almost every element; the
  // exclusion walk (closest over a descendant selector) runs only for the
  // rare element whose text, aria-label, title, alt, SVG word or generated
  // content is a label (ad-labels.ts labelTexts, the general measure).
  for (const el of container.querySelectorAll<HTMLElement>(LABEL_BEARERS)) {
    let labelled = labelTexts(el).some((t) => isAdLabelText(t.trim()));
    if (!labelled && el.childElementCount > 0) labelled = isAdLabelText(piecedLabelText(el));
    if (!labelled) continue;
    const excluded = el.closest(rule.exclude);
    if (excluded && container.contains(excluded)) continue;
    if (isInPrivateChatSubtree(el)) continue;
    return true;
  }
  return false;
}

/**
 * The slots a product hides by their element's name alone, with no label read: Off's in its judge and scan, Feedprint's
 * in its scan. Feedprint's must hold every one of Off's on a platform where it runs this rule, because with both
 * installed Off leaves ads to Feedprint there (recorder-runs.ts), and a slot only Off named would then show with
 * "Block ads" on in both (the shop shelf, 9 Oct 2026). A test compares the two lists.
 */
export function namedAdSlots(platform: Platform, product: 'off' | 'feedprint'): string {
  const rule = RULES[platform];
  if (product === 'feedprint' && !rule.feedprint) return '';
  return rule.alwaysAd ?? '';
}

export function isFeedAd(container: Element, platform: Platform): boolean {
  const rule = RULES[platform];
  const named = namedAdSlots(platform, 'off');
  if (named && (container.matches(named) || container.querySelector(named))) return true;
  return isLabelledAd(container, rule);
}

/** An ad by what it shows (the platform's own signal, or an ad label), not by an element's name. */
function isLabelledAd(container: Element, rule: AdRule): boolean {
  if (rule.platformSignal && rule.platformSignal(container)) return true;
  return rule.genericLeaf && hasAdLabelLeaf(container, rule);
}

/** The element a hide takes away, and whether it is a rule's host (a panel, a Shorts card) rather than the ad itself. */
function hideTargetFor(container: HTMLElement, rule: AdRule): { target: HTMLElement; hosted: boolean } {
  for (const { slot, host } of rule.alwaysAdHost ?? []) {
    if (!container.matches(slot)) continue;
    const el = container.closest<HTMLElement>(host);
    if (el) return { target: el, hosted: true };
  }
  return { target: (rule.hideTarget ? container.closest<HTMLElement>(rule.hideTarget) : null) ?? container, hosted: false };
}

/** The feature this rule's hides are counted under (markHidden's tally, the popup's "ads hidden"). */
const FEED_AD_FEATURE = 'block-ads';

/** Hide the ad; true when the hide landed now. `counted` false leaves the hidden-ad tally to adSlotShown. */
function hideAd(container: HTMLElement, rule: AdRule, lang: ResolvedUiLanguage, counted = true): boolean {
  const { target, hosted } = hideTargetFor(container, rule);
  // A host that is a card of a single-player video feed (a YouTube Shorts ad
  // card; no other rule names one): read, while it still holds its box, which
  // card is on screen and whether comments are open, so the feed can move on
  // after the hide (video-feed-hide.ts, as the AI-label and the recorder's ad
  // hides do). An ad container that is itself a feed item (TikTok For-You,
  // Instagram) keeps its own hide, as before.
  const feed = hosted ? videoFeedItemOf(target) : null;
  const card = feed && feed.item === target ? feed : null;
  const comments = card ? snapshotCommentPanel(card.surface) : null;
  const watch = card ? snapshotWatched(target, card.surface) : null;
  if (!markHidden(target, {
    marker: FEED_AD_HIDDEN_MARKER, value: 'true', reason: 'block-ads:feed-ad', feature: FEED_AD_FEATURE, count: counted ? 1 : 0,
  })) return false;
  // A Shorts card keeps its box (display:none made a video feed's own
  // observer skip in a loop, ai-content-blocker.ts BLOCKED_CSS).
  if (card || rule.hideMode === 'visibility') {
    target.style.setProperty('visibility', 'hidden', 'important');
  } else {
    target.style.setProperty('display', 'none', 'important');
  }
  // display:none alone does not reliably stop a playing video ad's audio.
  muteAndPauseMedia(target);
  if (card && comments && watch) {
    target.style.setProperty('pointer-events', 'none', 'important');
    // A move that happened (or ended for good: no further card, the run cap,
    // the breaker) is not made again on landing; a move only held while the
    // person scrolls, which may give up, leaves landing to make it later.
    const outcome = afterFeedItemHidden(target, card.surface, comments, watch, lang);
    if (watch.watched === target && outcome !== null) target.setAttribute(LANDED_ATTR, 'true');
  } else if (rule.hideMode === 'visibility') {
    // The kept box gets one line saying why it is blank (hide-primitives.ts noteAdSlot).
    noteAdSlot(target, MARKER_STRINGS[lang].adSlotNote);
  }
  return true;
}

/** Feedprint's side of a scan: the record each hide writes. */
interface FeedAdRecording {
  mode: FWSettings['mode'];
}

/** The marker Feedprint's pipeline stamps on an ad it hid (and recorded) itself. */
const PIPELINE_AD_HIDDEN = '[data-fw-ad-hidden]';

/**
 * A slot named for ads is counted and recorded at one place, adSlotShown, once it is known to have shown an ad: words
 * of its own, or a picture, a video, a frame inside it. Off writes no record and comes through the same place with the
 * same decision, so the popup's "ads hidden" equals the records by construction (the head's check of a336a043). The
 * decision reads the slot's own content only, never the card or panel hosting it, which hold other things (a Shorts
 * card's video element, a panel's own pictures).
 *
 * Why it waits: the tester's wordless "[blocked: ads]" records beside YouTube videos (9 Oct 2026, three loads with no
 * ad served) came from the ad holders every watch page carries; read signed out the same day (two reads of one watch
 * page with no ad served), ytd-player-legacy-desktop-watch-ads-renderer and ytd-companion-slot-renderer were on the
 * page and not drawn. A slot is hidden at once, which is harmless when it is empty. One that holds its words then is
 * decided at once; any other waits for what fills it, as the ad before a video waits for its words
 * (youtube-player-ad.ts). It is counted the moment it shows an ad (words, a picture, a video), so a tab closed during
 * the wait loses no more than any other hide (mark-hidden.ts, one second), and recorded once, SLOT_WORDS_WAIT_MS after
 * its content last changed, with the last words it held: a slot counted is always recorded (10 Oct 2026, the head's
 * follow-up 4). The wait has no limit of its own, since a holder can fill when an ad starts in the middle of the video;
 * it ends when the slot leaves the page, the page goes or moves on, or the rule stops, and a slot still empty then
 * showed nothing: no count, no record.
 *
 * Known limits, read in the code and not built (10 Oct 2026, the head's and the owner's precision rule: no case is
 * built until a live page shows it). Each needs YouTube to move or reuse an ad holder in a way no live read has shown:
 * - Two posts built around one waiting slot, or the slot moved into a second post: only the last post is hidden when
 *   the slot fills. Opened by a live trace that shows one ytd-companion-slot-renderer element inside two list cards in
 *   turn while it waits.
 * - A slot that showed an ad and emptied, then a post built around it while its wait is open: the post is hidden at
 *   once, around a slot that is empty by then. Opened by a live trace of a slot emptied and then wrapped in a card.
 * - A slot taken off the page and put back within one 2 s pass, or a slot element reused for a second ad after its
 *   count: the second showing is recorded but not counted again. Opened by a live trace of the same element filling
 *   twice.
 * - A slot that fills before the post holding it is judged at all: the post is judged with the ad already in it and
 *   hidden and counted once; this order is not tested. Opened by any live trace of that order, which would get its
 *   test then.
 * - After YouTube moves to another page, every wait is ended; a hidden empty slot it keeps and fills later is never
 *   counted. Opened by a live trace that shows the same holder element across a page move.
 */
const SLOT_WORDS_WAIT_MS = 2000;

/** What an ad with no words still shows: a picture with its source, a video, a frame. */
const SLOT_MEDIA = 'img[src]:not([src=""]), video, iframe';

interface WaitingSlot {
  platform: Platform;
  /** Feedprint's: the mode and the page the slot was hidden on, kept for a record written after the page moved on. */
  record: { mode: FWSettings['mode']; postUrl: string } | null;
  /** The last words the slot held, kept for a slot emptied before its decision. */
  caption: string;
  watch: MutationObserver;
  settle: ReturnType<typeof setTimeout> | null;
  /** A post that holds this slot and is left shown while the slot is empty: hidden the moment the slot shows an ad. */
  onAd?: () => void;
}

const waitingSlots = new Map<HTMLElement, WaitingSlot>();

function writeSlotRecord(platform: Platform, mode: FWSettings['mode'], postUrl: string, caption: string): void {
  recordBlocked({
    platform,
    mode,
    // An ad slot names no account the way a post does; its words say who placed it.
    author: '',
    postUrl,
    blockReason: 'ads',
    matchedToken: 'ad-slot',
    decision: decisionForBlock({ mode, blockReason: 'ads', matchedToken: 'ad-slot', applied: 'hide', mask: false }),
    caption,
  });
}

/** The slot's own content shows an ad: words of its own (`words` when already read), or a picture, a video, a frame. */
function holdsAd(slot: HTMLElement, words?: string): boolean {
  return !!(words ?? spacedText(slot, AD_CONTROLS, SHORT_CONTROL_LABEL)) || slot.querySelector(SLOT_MEDIA) !== null;
}

/**
 * Set on what was counted as an ad (a slot that showed one, a post judged by its label), so a container hidden around it
 * later is not counted again: one ad, one count, whatever order the page builds its pieces in.
 */
const AD_COUNTED_ATTR = 'data-fw-ad-counted';

/** A slot that shows an ad is counted the moment it does (ads found, ads hidden), once, at this one place. */
function countSlotAd(slot: HTMLElement, platform: Platform): void {
  if (slot.hasAttribute(AD_COUNTED_ATTR)) return;
  slot.setAttribute(AD_COUNTED_ATTR, 'true');
  countHiddenFor(`ads-found:${platform}`, 1, false);
  countHiddenFor(FEED_AD_FEATURE, 1);
}

/** A hidden slot that showed an ad: counted, if it was not yet, and, in Feedprint, recorded. */
function adSlotShown(slot: HTMLElement, platform: Platform, record: WaitingSlot['record'], caption: string): void {
  countSlotAd(slot, platform);
  if (record) writeSlotRecord(platform, record.mode, record.postUrl, caption);
}

/** The wait on a slot ends: a slot that showed an ad (counted when it did) is recorded now, with its last words. */
function writeWaitingSlot(slot: HTMLElement): void {
  const w = waitingSlots.get(slot);
  if (!w) return;
  waitingSlots.delete(slot);
  w.watch.disconnect();
  if (w.settle) clearTimeout(w.settle);
  const caption = spacedText(slot, AD_CONTROLS, SHORT_CONTROL_LABEL) || w.caption;
  if (!slot.hasAttribute(AD_COUNTED_ATTR) && !holdsAd(slot, caption)) return;
  w.onAd?.();
  adSlotShown(slot, w.platform, w.record, caption);
}

/**
 * A container hidden around a waiting slot takes the slot's wait over. A slot already counted is recorded now, with
 * what it held (the container is then neither counted nor recorded); one not yet counted ends its wait without a
 * count, and the container decides for the whole.
 */
function dropWaitingSlot(slot: HTMLElement): void {
  if (slot.hasAttribute(AD_COUNTED_ATTR)) { writeWaitingSlot(slot); return; }
  const w = waitingSlots.get(slot);
  if (!w) return;
  waitingSlots.delete(slot);
  w.watch.disconnect();
  if (w.settle) clearTimeout(w.settle);
}

/** Every slot still waiting ends its wait: the page goes or moves on, or the rule stops. */
function writeWaitingSlots(): void {
  for (const slot of Array.from(waitingSlots.keys())) writeWaitingSlot(slot);
}

/** A waiting slot the site took off the page ends its wait with what it held. */
function writeGoneSlots(): void {
  for (const slot of Array.from(waitingSlots.keys())) if (!slot.isConnected) writeWaitingSlot(slot);
}

/**
 * A hidden slot is decided at once when it holds its words; any other waits for what fills it. `onAd` hides the post
 * holding the slot when that post was left shown while the slot was empty.
 */
function decideSlot(slot: HTMLElement, platform: Platform, record: FeedAdRecording | undefined, onAd?: () => void): void {
  const waiting = waitingSlots.get(slot);
  if (waiting) {
    // A post built around a slot that was already waiting: the wait hides the post when the slot fills (the head's
    // follow-up 1, 10 Oct 2026).
    if (onAd) waiting.onAd = onAd;
    return;
  }
  const rec = record ? { mode: record.mode, postUrl: currentPageAddress() } : null;
  const words = spacedText(slot, AD_CONTROLS, SHORT_CONTROL_LABEL);
  if (words) {
    onAd?.();
    adSlotShown(slot, platform, rec, words);
    return;
  }
  const w: WaitingSlot = {
    platform,
    record: rec,
    caption: '',
    settle: null,
    onAd,
    watch: new MutationObserver(() => {
      const now = spacedText(slot, AD_CONTROLS, SHORT_CONTROL_LABEL);
      if (now) w.caption = now;
      if (!holdsAd(slot, now)) return;
      // The moment the ad shows: the post holding it goes, and the ad is counted; the record waits for the words.
      w.onAd?.();
      w.onAd = undefined;
      countSlotAd(slot, platform);
      if (w.settle) clearTimeout(w.settle);
      w.settle = setTimeout(() => writeWaitingSlot(slot), SLOT_WORDS_WAIT_MS);
    }),
  };
  // A picture's source set after it was drawn (an <img src=""> filled in) is a fill too.
  w.watch.observe(slot, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['src'] });
  waitingSlots.set(slot, w);
  if (holdsAd(slot, words)) {
    w.onAd?.();
    w.onAd = undefined;
    countSlotAd(slot, platform);
    w.settle = setTimeout(() => writeWaitingSlot(slot), SLOT_WORDS_WAIT_MS);
  }
}

/** Set on a hidden Shorts ad card once the feed was moved on from it on landing, so it moves on once. */
const LANDED_ATTR = 'data-fw-feed-ad-landed';

/** Most hidden cards walked backwards past, as video-feed-hide.ts walks forwards (MAX_HIDDEN_RUN). */
const MAX_BACK_WALK = 5;

/**
 * The card that held the screen at the last full pass. A person who lands on a hidden ad card coming from below
 * is going back up the feed: the move goes back past it, never forward against their scroll.
 */
let lastWatched: HTMLElement | null = null;

/** Scroll to the nearest card above `el` that is not hidden. True when it scrolled. */
function moveBackPast(el: HTMLElement, surface: VideoFeedSurface): boolean {
  let node = el.previousElementSibling;
  let walked = 0;
  while (node && walked < MAX_BACK_WALK) {
    if (node instanceof HTMLElement && surface.isItem(node)) {
      if (!isHiddenByUs(node)) {
        if (typeof node.scrollIntoView === 'function') {
          try { node.scrollIntoView({ block: 'start' }); } catch { return false; }
        }
        return true;
      }
      walked += 1;
    }
    node = node.previousElementSibling;
  }
  return false;
}

function revealHost(el: HTMLElement): void {
  el.removeAttribute(FEED_AD_HIDDEN_MARKER);
  el.removeAttribute('data-fw-block-reason');
  el.removeAttribute(LANDED_ATTR);
  el.style.removeProperty('display');
  el.style.removeProperty('visibility');
  el.style.removeProperty('pointer-events');
  releaseVideoItem(el);
}

/**
 * The hidden hosts under `root` (and above it): one whose ad slot has gone is
 * shown again and released (a box the site reuses for a real Short must not
 * stay blank and paused); on the full pass, a hidden Shorts ad card the person
 * has landed on (it was hidden off screen, so nothing moved on then) moves
 * the feed on, once.
 */
function tendHiddenHosts(root: ParentNode, rule: AdRule, lang: ResolvedUiLanguage): void {
  let seenNow: HTMLElement | null = null;
  for (const { slot, host } of rule.alwaysAdHost ?? []) {
    const sel = `${host}[${FEED_AD_HIDDEN_MARKER}="true"]`;
    const hosts = new Set<HTMLElement>(root.querySelectorAll<HTMLElement>(sel));
    if (root instanceof HTMLElement) {
      const above = root.closest<HTMLElement>(sel);
      if (above) hosts.add(above);
    }
    for (const el of hosts) {
      if (!el.querySelector(slot)) { revealHost(el); continue; }
      if (root !== document || el.hasAttribute(LANDED_ATTR)) continue;
      const feed = videoFeedItemOf(el);
      if (!feed || feed.item !== el || !isWatchedItem(el)) continue;
      const cameFromBelow = lastWatched !== null && lastWatched !== el && lastWatched.isConnected
        && lastWatched.parentElement === el.parentElement
        && (el.compareDocumentPosition(lastWatched) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
      // Going back up: move back past it; at the top of the feed, nothing above, so forward as before.
      if (cameFromBelow && moveBackPast(el, feed.surface)) {
        el.setAttribute(LANDED_ATTR, 'true');
        continue;
      }
      const outcome = afterFeedItemHidden(el, feed.surface, snapshotCommentPanel(feed.surface), snapshotWatched(el, feed.surface), lang);
      if (outcome !== null) el.setAttribute(LANDED_ATTR, 'true');
    }
    // Which card holds the screen now, for the next pass's direction: read on a video-feed surface only.
    if (root === document && !seenNow) {
      const any = document.querySelector<HTMLElement>(host);
      const feed = any ? videoFeedItemOf(any) : null;
      if (any && feed && feed.item === any) seenNow = snapshotWatched(any, feed.surface).watched;
    }
  }
  if (root === document) lastWatched = seenNow;
}

/**
 * Judge every container under `root` (and `root` itself, and the container above it). With `record` (Feedprint),
 * only the rule's `alwaysAd` slots outside the pipeline's reach are judged, and each hide is also a record.
 */
export function scanFeedAds(
  root: ParentNode, platform: Platform, lang: ResolvedUiLanguage = 'en', record?: FeedAdRecording,
): number {
  const rule = RULES[platform];
  tendHiddenHosts(root, rule, lang);
  const candidates = new Set<HTMLElement>();
  if (record) {
    const named = namedAdSlots(platform, 'feedprint');
    if (!named || !rule.feedprint) return 0;
    if (root instanceof HTMLElement) {
      const above = root.closest<HTMLElement>(named);
      if (above) candidates.add(above);
    }
    root.querySelectorAll<HTMLElement>(named).forEach((c) => candidates.add(c));
    const left = rule.feedprint.leftToPipeline;
    for (const c of candidates) {
      if (c.closest(left) || c.closest(PIPELINE_AD_HIDDEN)) candidates.delete(c);
    }
  } else {
    if (root instanceof HTMLElement) {
      if (root.matches(rule.container)) candidates.add(root);
      const above = root.parentElement?.closest<HTMLElement>(rule.container);
      if (above) candidates.add(above);
      const named = namedAdSlots(platform, 'off');
      if (named && root.matches(named)) candidates.add(root);
    }
    root.querySelectorAll<HTMLElement>(rule.container).forEach((c) => candidates.add(c));
    const named = namedAdSlots(platform, 'off');
    if (named) root.querySelectorAll<HTMLElement>(named).forEach((c) => candidates.add(c));
  }

  let hidden = 0;
  for (const container of candidates) {
    if (judgeContainer(container, rule, platform, lang, record)) hidden++;
  }
  return hidden;
}

/** The container shows something of its own outside the slot it holds: words, or a picture, a video, a frame. */
function showsOwnContent(container: HTMLElement, slot: HTMLElement): boolean {
  for (const el of container.querySelectorAll(SLOT_MEDIA)) if (!slot.contains(el)) return true;
  return (container.textContent ?? '').replace(slot.textContent ?? '', '').trim().length > 0;
}

/** Judge one container; true when it was hidden now. */
function judgeContainer(
  container: HTMLElement, rule: AdRule, platform: Platform, lang: ResolvedUiLanguage, record?: FeedAdRecording,
): boolean {
  // Outermost only: a comment (nested container) is judged as part of its post.
  if (container.parentElement?.closest(rule.container)) return false;
  if (container.closest(`[${FEED_AD_HIDDEN_MARKER}="true"]`)) return false;
  if (isInPrivateChatSubtree(container)) return false;
  // The blindness measure: posts judged and ads found, per platform, in
  // the popup's tally. A platform with many posts judged and no ad found
  // is a platform where the label moved again; the popup says so. The
  // marker carries the element count at judgement: the 2 s pass re-walks
  // a post only when something was added to it (a label filled in
  // later), which took the pass from 100 ms to nothing on a 28k-node page
  // (scripts/verify/engagement-latency.mjs, 2026-09-03). A label changed
  // in place leaves the count as it was; the label watch below marks such
  // a post STALE so it is judged again.
  const shape = String(container.getElementsByTagName('*').length);
  const judged = container.getAttribute(FEED_AD_JUDGED_MARKER);
  if (judged === shape) return false;
  if (judged === null) countHiddenFor(`ads-judged:${platform}`, 1, false);
  container.setAttribute(FEED_AD_JUDGED_MARKER, shape);
  if (!isFeedAd(container, platform)) return false;
  // The slot that decides whether an ad showed (adSlotShown): the container when it is a slot named for ads, or the
  // named slot it holds when no label made it an ad. A post judged by its label is counted at once, as before.
  const named = namedAdSlots(platform, 'off');
  let slot: HTMLElement | null = null;
  if (named) {
    if (container.matches(named)) slot = container;
    else if (!isLabelledAd(container, rule)) slot = container.querySelector<HTMLElement>(named);
  }
  // An ad hidden before its container arrived around it (an in-feed layout delivered ahead of its ad-slot renderer, a
  // slot the page moved into a card) is counted once either way: counted already, the container is neither counted nor
  // recorded again; still waiting for what fills it, its wait ends and the container decides for the whole (the fresh
  // read of cd3602d4, 10 Oct 2026: in Off a card judged by its label around an empty slot counted twice).
  const countedInside = container.querySelector(`[${AD_COUNTED_ATTR}]`) !== null;
  // A post of its own (words or a picture outside the slot) that holds an empty slot is a post until the slot shows an
  // ad: left shown and not counted; the slot's wait hides it then (the head's bound, 10 Oct 2026). A card that is only
  // the empty slot's holder is hidden at once, as before: a blank tile.
  if (slot && slot !== container && !countedInside && !holdsAd(slot) && showsOwnContent(container, slot)) {
    decideSlot(slot, platform, record, () => { hideAd(container, rule, lang, false); });
    return false;
  }
  const countNow = !slot && !countedInside;
  if (countNow) countHiddenFor(`ads-found:${platform}`, 1, false);
  if (!hideAd(container, rule, lang, countNow)) return false;
  for (const waiting of Array.from(waitingSlots.keys())) {
    if (waiting !== container && container.contains(waiting)) dropWaitingSlot(waiting);
  }
  if (countNow) container.setAttribute(AD_COUNTED_ATTR, 'true');
  if (slot && !countedInside) decideSlot(slot, platform, record);
  return true;
}

function resetFeedAdDOM(): void {
  document.querySelectorAll<HTMLElement>(`[${FEED_AD_JUDGED_MARKER}]`).forEach((el) => {
    el.removeAttribute(FEED_AD_JUDGED_MARKER);
  });
  document.querySelectorAll<HTMLElement>(`[${AD_COUNTED_ATTR}]`).forEach((el) => {
    el.removeAttribute(AD_COUNTED_ATTR);
  });
  document.querySelectorAll<HTMLElement>(`[${FEED_AD_HIDDEN_MARKER}="true"]`).forEach((el) => {
    el.removeAttribute(FEED_AD_HIDDEN_MARKER);
    el.removeAttribute('data-fw-block-reason');
    el.style.removeProperty('display');
    el.style.removeProperty('visibility');
    el.style.removeProperty('pointer-events');
    el.removeAttribute(LANDED_ATTR);
    removeAdSlotNote(el);
    // Media stays muted after a reveal, same posture as the other ad hiders.
  });
}

/** Judged-marker value of a post whose label changed since it was judged. */
const STALE = 'stale';

/** The attributes a label or a letter piece can change in place. */
const LABEL_ATTRIBUTES = ['style', 'class', 'hidden', 'aria-hidden', 'aria-label', 'title', 'alt'];
const LABEL_WORDS = new Set(['aria-label', 'title', 'alt']);

/** Longest text a changed node may carry and still be a label or a piece of one. */
const LABEL_CHANGE_MAX = AD_LABEL_MAX_LENGTH + 4;

function labelSized(text: string | null): boolean {
  const n = (text ?? '').trim().length;
  return n > 0 && n <= LABEL_CHANGE_MAX;
}

/**
 * The element whose change may have drawn or moved a label, or null. Facebook
 * fills a header word after the post is drawn and moves letter pieces in and
 * out of the row by style (ledger ADS-RESILIENCE-2026-10-08.md); neither adds
 * an element. Only a leaf carrying a label-sized text, or a label-sized word
 * attribute, counts, so a progress bar's style or a body edit is ignored at
 * the cost of one property read.
 */
function changedLabelBearer(r: MutationRecord): Element | null {
  const n = r.target;
  if (r.type === 'characterData') return labelSized(n.textContent) ? n.parentElement : null;
  if (!(n instanceof Element)) return null;
  if (r.type === 'attributes' && LABEL_WORDS.has(r.attributeName ?? '')) {
    return labelSized(n.getAttribute(r.attributeName!)) ? n : null;
  }
  // A text node swapped inside a leaf (childList), or a piece's style.
  return n.childElementCount === 0 && labelSized(n.textContent) ? n : null;
}

/**
 * Watch judged posts for a label changed in place and judge each such post
 * again at once, before paint. Inserted elements stay the added-roots
 * observer's; the 2 s pass is unchanged.
 */
function watchLabels(platform: Platform, lang: ResolvedUiLanguage): () => void {
  if (typeof document === 'undefined' || !document.body) return () => {};
  const rule = RULES[platform];
  const observer = new MutationObserver((records) => {
    let touched: Set<HTMLElement> | null = null;
    for (const r of records) {
      const el = changedLabelBearer(r);
      const post = el?.closest<HTMLElement>(`[${FEED_AD_JUDGED_MARKER}]`);
      if (post) (touched ??= new Set()).add(post);
    }
    if (!touched) return;
    for (const post of touched) {
      if (post.closest(`[${FEED_AD_HIDDEN_MARKER}="true"]`)) continue;
      post.setAttribute(FEED_AD_JUDGED_MARKER, STALE);
      judgeContainer(post, rule, platform, lang);
    }
  });
  observer.observe(document.body, {
    subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: LABEL_ATTRIBUTES,
  });
  return () => observer.disconnect();
}

/** Feedprint's record of a video ad covered in YouTube's player, with the words the player shows about it. */
function recordPlayerAd(words: string, platform: Platform, record: FeedAdRecording): void {
  recordBlocked({
    platform,
    mode: record.mode,
    author: '',
    postUrl: currentPageAddress(),
    blockReason: 'ads',
    matchedToken: 'player-ad',
    decision: decisionForBlock({ mode: record.mode, blockReason: 'ads', matchedToken: 'player-ad', applied: 'hide', mask: false }),
    caption: words,
  });
}

/**
 * Start the feed ad hider. In Feedprint it runs only where the rule names the
 * ad slots the pipeline does not reach (`feedprint`), and each hide there is a
 * record; elsewhere in Feedprint the pipeline hides and records feed ads. No-op
 * when block-ads is off for the platform.
 */
export function startFeedAdBlocker(platform: Platform, settings: FWSettings): () => void {
  const record: FeedAdRecording | undefined = isOffProduct() ? undefined : { mode: settings.mode };
  if (record && !RULES[platform].feedprint) return () => {};
  if (!isFeatureEnabled(settings, 'block-ads', platform)) return () => {};

  const lang = resolveUiLanguage(settings.uiLanguage);
  scanFeedAds(document, platform, lang, record);
  // Inserted subtrees before paint; the 2 s pass catches a label filled into
  // an existing post later.
  const stopAdded = observeAddedRoots((roots) => {
    for (const root of roots) scanFeedAds(root, platform, lang, record);
  });
  // Off only: in Feedprint this rule judges ad slots by element name, never
  // by a label, so a label changed in place has nothing to re-judge here; the
  // recorder's pipeline reads labelled posts there.
  const stopLabels = record ? () => {} : watchLabels(platform, lang);
  const interval = setInterval(() => {
    scanFeedAds(document, platform, lang, record);
    writeGoneSlots();
  }, 2000);
  // A slot still waiting for its words is written when the page goes (pagehide) or YouTube moves to another page
  // without a load (yt-navigate-start), with the page it was hidden on.
  if (record) {
    window.addEventListener('pagehide', writeWaitingSlots);
    document.addEventListener('yt-navigate-start', writeWaitingSlots);
  }
  // The video ad inside YouTube's player: unseen and unheard while it runs (youtube-player-ad.ts). In Feedprint too,
  // whose level screen says "Hides ads" at every level, and each ad is recorded as a feed ad slot is, so the record
  // still says what the page served. With both installed one product acts: when Feedprint's Block ads is on, it names
  // the ads family in its stamp (recorder-runs.ts) and Off's controller does not start this rule at all.
  const stopPlayerAds = platform !== 'youtube' ? () => {}
    : startPlayerAdCover(record ? (_player, words) => recordPlayerAd(words, platform, record) : undefined);

  return () => {
    stopAdded();
    stopLabels();
    stopPlayerAds();
    clearInterval(interval);
    window.removeEventListener('pagehide', writeWaitingSlots);
    document.removeEventListener('yt-navigate-start', writeWaitingSlots);
    writeWaitingSlots();
    resetFeedAdDOM();
  };
}
