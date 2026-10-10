// FeelingWise (Off) — the video ad YouTube plays before or inside a video.
//
// The Brand seat's signed-out store-shot runs of Off 1.0.13 (9 Oct 2026): the
// ad before the video played on 6 of 8 watch pages (9 of 11 and 7 of 8 in
// earlier runs), with "Block ads" on. It is drawn inside the player
// (#movie_player carries the class ad-showing while it runs, read signed out
// the same night on 3 of 3 watch pages), so no feed rule reaches it.
//
// What Off does, and what it never does. While the player shows an ad, the
// ad's picture is made transparent and its sound is muted once, as the ad
// begins; when the ad ends, the sound goes back to what the person wants. A
// person who unmutes during the ad hears it and stays unmuted after; a person
// who mutes during the ad stays muted after (the head's check of 3c97f5bb).
// YouTube's own "Sponsored" badge, countdown and Skip button stay where they
// are and keep working, because only the video element is made transparent.
// Off never skips, seeks, speeds up or clicks anything in the player: the ad
// runs its course, unseen and unheard.

import { spacedText, AD_CONTROLS } from './ad-labels';
import { countHiddenFor } from './mark-hidden';
import { ensureStyleTag, removeStyleTag } from './style-tag';

/** The style tag's id; the engagement controller removes it on a reset too. */
export const PLAYER_AD_STYLE_ID = 'fw-yt-player-ad';
/** Set on the player while Off covers an ad in it, for the popup's checks and for a reset. */
export const PLAYER_AD_ATTR = 'data-fw-player-ad';
const PLAYER = '#movie_player';
/** How often the player is looked for: YouTube draws it after the content script, and changes pages without a load. */
const FIND_MS = 1000;

const CSS = `${PLAYER}.ad-showing video { opacity: 0 !important; }`;
/**
 * A sound change this soon after the person's own press inside the player (the mute button, the volume slider, a key
 * while the player has focus) or the M key anywhere is theirs. Any other change during the ad is the page's own, as the
 * player applying its saved volume when the ad loads; a click on a thumbnail or a key typed elsewhere just before it
 * does not make it the person's (the checker's finding on 53ce1aa1).
 */
const PERSON_MS = 1000;
const PERSON_INPUTS = ['pointerdown', 'keydown'] as const;
/** YouTube's own mute key. */
const MUTE_KEY = 'm';

/**
 * The M key as YouTube's mute: a letter typed into search or a comment, or M held with Ctrl, Meta or Alt, is not a
 * mute (the head's check of 48e9d653).
 */
function isMuteKey(event: KeyboardEvent): boolean {
  if ((event.key ?? '').toLowerCase() !== MUTE_KEY) return false;
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  const target = event.target;
  if (target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea, [contenteditable]:not([contenteditable="false"])'))) return false;
  return true;
}
/**
 * Off's own change fires one volumechange, queued after the change in a real browser; a change the page makes before it
 * arrives queues its own after it. Off's events are taken by count, in order, never by the value read when they arrive,
 * and a count not taken within this long is dropped so it can never swallow a later change of the person's.
 */
const OWN_EVENT_MS = 1000;

/** YouTube's own mute button in the player's controls. */
const MUTE_BUTTON = '.ytp-mute-button';
/** Where the player writes about the ad it is showing (the advertiser, "Sponsored"). */
const AD_MODULE = '.ytp-ad-module';
/**
 * How long an ad's words must stay unchanged before the ad is reported with them: the module fills in pieces after the
 * ad starts ("Sponsored" first, the advertiser later), and the last words are the ones kept. With no words at all no
 * wait is armed: the ad is reported at its end. Its end, or the next ad, reports it at once.
 */
const WORDS_WAIT_MS = 2000;
/**
 * How long the player may leave its ad state and come back to it while the same ad is still on. The tester's live run
 * on ddf472b9 had one ad written twice with no words (load 2: one ad seen, two records): the ad state left and came
 * back before the player drew the ad's words. Within this time it is one ad; the cover itself still lets go at once.
 */
const CLOSE_GRACE_MS = 1000;
/** The countdown and the time left ("0:15"), taken out of the words: they change every second and name nothing. */
const CLOCK = /\b\d{1,2}:\d{2}\b/g;
/**
 * The player's own mark of an ad's place in a pair ("1 of 2"), beside its "Sponsored" badge: the only place that place
 * is read from, never the advertiser's copy, where "buy 1 get 2" or "2 of 3 colours" would read as one (the head's
 * check of c2933356). Read signed out on live watch pages, 9 Oct 2026: "1 of 2" in a div under .ytp-ad-pod-index on
 * 18 of 19 ad reads, "Sponsored" in .ytp-ad-badge__text--clean-player.
 */
const BADGE = '.ytp-ad-pod-index';
/** The ad's place in a pair or more ("1 of 2", "1 din 2", "1/2"), read in the badge only. */
const POSITION = /\b(\d{1,2})\s*(?:\/|[^\d\s:.,·]{1,4})\s*(\d{1,2})\b/;

/**
 * The player's own parts inside the ad module, whose words are the player's, not the ad's (the tester's live run on
 * ddf472b9 kept "Learn more", "Visit site", "Download", "My Ad Center" and "Skip" in captions): its buttons (the call
 * to action, the ad-info button, Skip), its "Sponsored" badge and its place in a pair, and the time left. Picked by
 * role and by the player's class names, read signed out on live watch pages on 9 Oct 2026, never by their words: the
 * player is in the person's language ("Vino și tu" on a Romanian profile).
 */
const PLAYER_CONTROLS = [
  AD_CONTROLS,
  '.ytp-ad-button-vm', '.ytp-skip-ad-button', '.ytp-ad-hover-text-button', '.ytp-ad-info-hover-text-button',
  '[class*="ytp-ad-info"]', '[class*="ytp-ad-badge"]', BADGE, '.ytp-ad-preview-container', '.ytp-ad-duration-remaining',
].join(', ');

/** The ad's own words in the player, in one line, without the player's controls and the clock; empty while none show. */
function adWords(player: Element): string {
  return spacedText(player.querySelector(AD_MODULE), PLAYER_CONTROLS).replace(CLOCK, ' ').replace(/\s+/g, ' ').trim();
}

/** A video's source as the page set it: the stream it plays, or its src attribute before that loads. */
function sourceOf(v: HTMLVideoElement): string {
  return v.currentSrc || v.getAttribute('src') || '';
}

/**
 * A video's source under an ad, and whether it is the ad's own yet: a video that still holds the source it had before
 * the ad (the video the person came for) gets the ad's source as the ad fills in, which is not a next ad.
 */
interface AdSource {
  src: string;
  filled: boolean;
}

/** What tells one ad from the next while the player stays in its ad state: its place in the pair, and each video's source. */
interface AdMark {
  position: string;
  sources: Map<HTMLVideoElement, AdSource>;
}

function adMark(player: Element, before: WeakMap<HTMLVideoElement, string>): AdMark {
  const m = POSITION.exec(spacedText(player.querySelector(BADGE)));
  const sources = new Map<HTMLVideoElement, AdSource>();
  for (const v of player.querySelectorAll<HTMLVideoElement>('video')) {
    const src = sourceOf(v);
    if (src) sources.set(v, { src, filled: before.get(v) !== src });
  }
  // A place is "a of b" with 1 <= a <= b <= 10: an advertiser's "buy 2 get 1" is not one.
  const a = m ? Number(m[1]) : 0;
  const b = m ? Number(m[2]) : 0;
  return { position: a >= 1 && a <= b && b <= 10 ? `${a}/${b}` : '', sources };
}

/** The video the page is on: a watch page's v=, or the path (a Short's /shorts/<id>). */
function pageVideo(): string {
  const url = new URL(location.href);
  return url.searchParams.get('v') ?? url.pathname;
}

/**
 * True when `now` may be another ad than `was`: its place in the pair changed ("1 of 2" to "2 of 2"), or a video already
 * playing this ad's source got another. A place or a source appearing where there was none, or a video leaving the
 * source it had before the ad, is the same ad filling in. A new source alone is not sure: see AdRun.after.
 */
function isAnotherAd(was: AdMark, now: AdMark): boolean {
  if (was.position && now.position && was.position !== now.position) return true;
  for (const [v, s] of was.sources) {
    const next = now.sources.get(v);
    if (s.filled && next && next.src !== s.src) return true;
  }
  return false;
}

/** The video an ad is playing in, and the sound the person wants once it ends. */
interface Covered {
  video: HTMLVideoElement;
  /** Muted after the ad: the state before it, changed by any mute or unmute the person makes during it. */
  mutedAfter: boolean;
  /** Off's own mutes whose volumechange has not arrived yet, and when the last one was made. */
  ownEvents: number;
  ownMuteAt: number;
  /** The person turned the sound on during this ad: the page's own changes no longer mute it. */
  personUnmuted: boolean;
  /**
   * Off's mute holds: Off muted the video and the person has not touched the sound since. YouTube's player does not
   * know of it (it still counts itself unmuted), so the person's mute press is Off's to answer then.
   */
  offHolds: boolean;
  onVolume: () => void;
}

/**
 * One ad: from the player's ad-showing on to off, or to the next ad of a pair while ad-showing holds (the head's check
 * of 16c655a5). A video element or a player YouTube swaps in while it plays is the same ad, so it is counted and
 * reported once.
 */
interface AdRun {
  player: Element;
  reported: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  /** The last words read for this ad, kept so the next ad's words, read as it begins, do not take their place. */
  words: string;
  mark: AdMark;
  /**
   * The ad state left and came back within the grace. In a pair, the next ad's words can be drawn before its place
   * ("2 of 2"), so once this ad's place is known and it has words, new words are not taken after such a return (the
   * head's check of d7028ffb). It lasts until the place goes blank and reads this ad's place again (the head's check of
   * 599f1ca1): an ad still wordless at the return takes its words when they come.
   */
  resumed: boolean;
  /** The place went blank after this ad's place was known. */
  blank: boolean;
  /**
   * Set when this run was opened by a video's source changing under the ad before it, with nothing yet that says another
   * ad plays: the person's video coming back while the ad state lingers looks the same, on the old source or a new one
   * (the tester's run on the 82799f35 zips: a pair wrote a third, wordless record after its last ad, a single ad two).
   * It holds the place and words of the ad before. The run becomes an ad, counted and reported, once it shows a place or
   * words other than those; ended without them, it was the video coming back, and is dropped.
   */
  after: { position: string; words: string } | null;
  /** The ad before's place, still shown when this ad was known by its words: never taken as this ad's own. */
  notOwnPlace: string;
}

/**
 * Start covering the player's ads. `onAd` is called once for each ad, with the player and the last words it showed
 * about that ad (Feedprint records it there). Returns the stop, which gives every sound back.
 */
export function startPlayerAdCover(onAd?: (player: Element, words: string) => void): () => void {
  ensureStyleTag(PLAYER_AD_STYLE_ID, CSS);
  let player: Element | null = null;
  // Every video element in the player while it shows an ad, not only the first: the second ad of a pair can play in
  // another element beside the first, which the picture rule already took (it reaches every video in the player) and
  // the mute did not (the tester's live run on dc76c9eb, "Sponsored 2 of 2", sound on, 1 of 6 loads).
  const covered = new Map<HTMLVideoElement, Covered>();
  let run: AdRun | null = null;
  /** Each video's source while no ad shows: the one it holds before an ad, which the ad then replaces. */
  const sourceBefore = new WeakMap<HTMLVideoElement, string>();
  const noteSources = (): void => {
    if (!player || player.classList.contains('ad-showing')) return;
    for (const v of player.querySelectorAll<HTMLVideoElement>('video')) sourceBefore.set(v, sourceOf(v));
  };
  const watches: MutationObserver[] = [];

  /** Report an ad once, with its last words; a run that never showed another ad (AdRun.after) is not one. */
  const report = (r: AdRun): void => {
    if (r.timer) { clearTimeout(r.timer); r.timer = null; }
    if (r.reported) return;
    r.reported = true;
    if (r.after) return;
    onAd?.(r.player, r.words);
  };
  /** (Re)start the wait for the words to settle. */
  const arm = (r: AdRun): void => {
    if (r.reported) return;
    if (r.timer) clearTimeout(r.timer);
    r.timer = setTimeout(() => report(r), WORDS_WAIT_MS);
  };
  const startAd = (on: Element, after: AdRun['after'] = null): void => {
    run = {
      player: on, reported: false, timer: null, words: after ? '' : adWords(on), mark: adMark(on, sourceBefore), resumed: false,
      blank: false, after, notOwnPlace: '',
    };
    if (after) { tendRun(); return; }
    countHiddenFor('block-ads', 1);
    // An ad with no words yet waits for them, or for its end: the player draws them after the ad starts, and a record
    // written before that carries nothing (load 2 of the tester's run on ddf472b9).
    if (run.words) arm(run);
  };
  /** Read the ad's words and marks again: a change of words restarts the wait; another ad reports this one and starts it. */
  const tendRun = (): void => {
    if (!run) return;
    const words = adWords(run.player);
    const mark = adMark(run.player, sourceBefore);
    if (run.after) {
      const another = (!!mark.position && mark.position !== run.after.position) || (!!words && words !== run.after.words);
      if (!another) return;
      // Another ad plays: from here it is one, counted, with its own place and words. Known by its words while the place
      // still reads the ad before's, that place is not its own: the next place to show is.
      const stale = mark.position === run.after.position;
      run.mark = { ...mark, position: stale ? '' : mark.position };
      if (stale) run.notOwnPlace = mark.position;
      run.after = null;
      countHiddenFor('block-ads', 1);
    } else if (isAnotherAd(run.mark, mark)) {
      // A new place is another ad for sure; a new source alone may be the person's video coming back.
      const byPlace = !!run.mark.position && !!mark.position && run.mark.position !== mark.position;
      const after = byPlace ? null : { position: run.mark.position || mark.position, words: run.words };
      report(run);
      startAd(run.player, after);
      return;
    }
    if (!run.mark.position && mark.position !== run.notOwnPlace) run.mark.position = mark.position;
    // A source appearing, or replacing the one the video had before the ad, is this ad's own from now on.
    for (const [v, s] of mark.sources) {
      const was = run.mark.sources.get(v);
      if (!was || (!was.filled && was.src !== s.src)) run.mark.sources.set(v, { src: s.src, filled: true });
    }
    // The last words that were there: a module emptied as the ad ends does not wipe them. In a pair whose place is
    // known, words drawn while the place is blank, or after the ad state left and came back, may be the next ad's:
    // they are not taken, and the next ad takes them when its place shows.
    if (run.mark.position) {
      if (!mark.position) run.blank = true;
      else if (run.blank && mark.position === run.mark.position) { run.blank = false; run.resumed = false; }
    }
    const held = !!run.mark.position && (!mark.position || (run.resumed && !!run.words));
    if (words && words !== run.words && !held) {
      run.words = words;
      arm(run);
    }
  };
  let closing: ReturnType<typeof setTimeout> | null = null;
  /**
   * The mark of an ad written early because the page went away or YouTube moved to another video while it played, and
   * the video the page was on then: while the same ad is still on screen it is not written again; the ad state leaving,
   * another ad, or the page reaching another video ends this.
   */
  let flushed: (AdMark & { video: string }) | null = null;
  const openRun = (on: Element): void => {
    if (closing) {
      clearTimeout(closing);
      closing = null;
      if (run) run.resumed = true;
    }
    if (!run) {
      if (flushed && !isAnotherAd(flushed, adMark(on, sourceBefore))) return;
      flushed = null;
      startAd(on);
      return;
    }
    if (run.player !== on) {
      run.player = on;
      run.mark = adMark(on, sourceBefore);
    }
    tendRun();
  };
  const closeRun = (): void => {
    if (closing) { clearTimeout(closing); closing = null; }
    if (run) report(run);
    run = null;
  };
  /** The ad state has left: the ad ends, unless the state comes back within CLOSE_GRACE_MS. */
  const closeSoon = (): void => {
    if (!run || closing) return;
    closing = setTimeout(() => { closing = null; closeRun(); }, CLOSE_GRACE_MS);
  };
  /**
   * Write the open ad now, with what it has: the tab is closing or reloading (pagehide), or YouTube is moving to
   * another video without a page load (yt-navigate-start). A wordless ad waits for its end, which then never comes.
   */
  const flushRun = (): void => {
    if (!run) return;
    flushed = { ...run.mark, video: pageVideo() };
    closeRun();
  };
  /**
   * YouTube has finished moving. On another video, an ad it shows now is that video's own. On the same video (a
   * navigation that kept it, the ad still showing through), it is the ad already written (the head's check of
   * 930010d2).
   */
  const onNavigated = (): void => {
    if (flushed && flushed.video !== pageVideo()) flushed = null;
    sync();
  };
  window.addEventListener('pagehide', flushRun);
  document.addEventListener('yt-navigate-start', flushRun);
  document.addEventListener('yt-navigate-finish', onNavigated);
  let lastInputAt = Number.NEGATIVE_INFINITY;
  const noteInput = (event: Event): void => {
    const target = event.target;
    const inPlayer = target instanceof Element && !!player && player.contains(target);
    const muteKey = event.type === 'keydown' && isMuteKey(event as KeyboardEvent);
    if (inPlayer || muteKey) lastInputAt = Date.now();
  };
  for (const type of PERSON_INPUTS) document.addEventListener(type, noteInput, { capture: true, passive: true });

  const mute = (c: Covered): void => {
    c.ownEvents += 1;
    c.ownMuteAt = Date.now();
    c.offHolds = true;
    c.video.muted = true;
  };

  // The person's mute press (the M key or the player's mute button) while Off's mute holds: Off had muted the video
  // behind the player's back, so the player would answer the press by muting what is already silent, and only a
  // second press would bring sound (the tester's live run on 91ef0a8c, 2 of 2 loads). Off answers it instead: the
  // sound comes on at the first press, and the player, which still counts itself unmuted, agrees with the video.
  // Off acts on the person's own press only; it never presses anything itself.
  const onMutePress = (event: Event): void => {
    const held = [...covered.values()].filter((c) => c.offHolds && c.video.muted);
    if (held.length === 0) return;
    const isPress = event.type === 'keydown'
      ? isMuteKey(event as KeyboardEvent)
      : event.target instanceof Element && !!player && player.contains(event.target) && !!event.target.closest(MUTE_BUTTON);
    if (!isPress) return;
    event.stopImmediatePropagation();
    event.preventDefault();
    lastInputAt = Date.now();
    for (const c of held) {
      c.offHolds = false;
      c.personUnmuted = true;
      c.mutedAfter = false;
      c.video.muted = false;
    }
  };
  // On the window, in the capture phase: before the player's own handlers see the press.
  for (const type of ['keydown', 'click'] as const) window.addEventListener(type, onMutePress, { capture: true });

  const begin = (video: HTMLVideoElement): Covered => {
    const c: Covered = {
      video, mutedAfter: video.muted, ownEvents: 0, ownMuteAt: 0, personUnmuted: false, offHolds: false, onVolume: () => {},
    };
    c.onVolume = () => {
      if (c.ownEvents > 0 && Date.now() - c.ownMuteAt < OWN_EVENT_MS) { c.ownEvents -= 1; return; }
      c.ownEvents = 0;
      if (Date.now() - lastInputAt <= PERSON_MS) {
        c.mutedAfter = video.muted;
        c.personUnmuted = !video.muted;
        c.offHolds = false;
        return;
      }
      if (!video.muted && !c.personUnmuted) mute(c);
    };
    video.addEventListener('volumechange', c.onVolume);
    if (!video.muted) mute(c);
    return c;
  };

  const end = (c: Covered): void => {
    c.video.removeEventListener('volumechange', c.onVolume);
    if (c.video.muted !== c.mutedAfter) c.video.muted = c.mutedAfter;
  };

  const endAll = (): void => {
    for (const c of covered.values()) end(c);
    covered.clear();
  };

  /**
   * Bring the cover in line with the player: an ad starting or ending, or YouTube adding, swapping or taking away a
   * video element while it shows one.
   */
  const sync = (): void => {
    const showing = !!player && player.classList.contains('ad-showing');
    const videos = showing && player ? Array.from(player.querySelectorAll<HTMLVideoElement>('video')) : [];
    for (const [video, c] of covered) {
      if (!videos.includes(video)) { end(c); covered.delete(video); }
    }
    for (const video of videos) if (!covered.has(video)) covered.set(video, begin(video));
    if (!player) return;
    noteSources();
    if (videos.length) openRun(player);
    else if (!showing) { flushed = null; closeSoon(); }
    if (covered.size) player.setAttribute(PLAYER_AD_ATTR, 'true');
    else player.removeAttribute(PLAYER_AD_ATTR);
  };

  /** True when the player's video elements are not the ones covered (or an ad's end has not been taken yet). */
  const videosChanged = (): boolean => {
    if (!player?.classList.contains('ad-showing')) return covered.size > 0;
    const videos = player.querySelectorAll<HTMLVideoElement>('video');
    return videos.length !== covered.size || Array.from(videos).some((v) => !covered.has(v));
  };

  const bind = (): void => {
    const now = document.querySelector(PLAYER);
    if (now === player) { sync(); return; }
    for (const w of watches.splice(0)) w.disconnect();
    endAll();
    player?.removeAttribute(PLAYER_AD_ATTR);
    player = now;
    // A written ad's mark names the old player's videos, which a new player's ad never shares: it would be taken for the
    // same ad and get no record (the head's check of 599f1ca1). A new player starts clean. An ad still open goes on in
    // the new player as the same ad, as a swap mid-ad always has.
    flushed = null;
    // A player taken away with nothing in its place: its ad, if one was open, has ended.
    if (!player) { closeRun(); return; }
    // The player's own class names the ad's start and end; a video element added or taken away inside it is a swap.
    const onClass = new MutationObserver(sync);
    onClass.observe(player, { attributes: true, attributeFilter: ['class'] });
    // Also every text written or rewritten inside the player (the ad's words, its place in a pair) and a video's new
    // source (the next ad loaded into the same element).
    const onChildren = new MutationObserver(() => {
      if (videosChanged()) sync();
      else if (run) tendRun();
      else noteSources();
    });
    onChildren.observe(player, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['src'] });
    watches.push(onClass, onChildren);
    sync();
  };

  bind();
  const tick = setInterval(bind, FIND_MS);
  return () => {
    clearInterval(tick);
    window.removeEventListener('pagehide', flushRun);
    document.removeEventListener('yt-navigate-start', flushRun);
    document.removeEventListener('yt-navigate-finish', onNavigated);
    for (const type of PERSON_INPUTS) document.removeEventListener(type, noteInput, { capture: true });
    for (const type of ['keydown', 'click'] as const) window.removeEventListener(type, onMutePress, { capture: true });
    for (const w of watches.splice(0)) w.disconnect();
    endAll();
    closeRun();
    player?.removeAttribute(PLAYER_AD_ATTR);
    removeStyleTag(PLAYER_AD_STYLE_ID);
  };
}
