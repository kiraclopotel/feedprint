// @vitest-environment jsdom
//
// After a marked video is hidden on a single-player video feed (item 4 of
// futurestate.md section 3b; owner 2026-09-13): advance to the next video the
// user can see, walk a run of hidden videos with a cap and a notice, scope the
// silence to the marked video so the next one keeps the user's own sound
// state, and put the comment panel back only when the hide closed it.
// Two-sided: every behavior has a must-act and a must-not-act fixture.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { injectHardHide, injectCollapseOrHide, injectAdHide } from '../../../../src/content/injector';
import { muteAndPauseMedia } from '../../../../src/content/hide-primitives';
import { collapseCard } from '../../../helpers/collapse-a-card';
import {
  advancePastHiddenVideo,
  afterVideoHidden,
  restoreCommentPanel,
  snapshotCommentPanel,
  silenceVideoItem,
  releaseVideoItem,
  snapshotWatched,
  videoFeedItemOf,
  VIDEO_FEED_SURFACES,
  MAX_HIDDEN_RUN,
  MAX_ADVANCES_PER_WINDOW,
  COMMENT_RESTORE_DELAY_MS,
  RUN_NOTICE_ATTR,
  SILENCED_ATTR,
  _resetAdvanceBreakerForTesting,
  _setHostForTesting,
  type AdvanceOutcome,
} from '../../../../src/content/protection/video-feed-hide';
import type { AnalysisResult, TechniqueName } from '../../../../src/types/analysis';

const TIKTOK_FEED = VIDEO_FEED_SURFACES.find((s) => s.name === 'tiktok-feed')!;

function analysisWith(technique: TechniqueName, score = 9): AnalysisResult {
  return {
    postId: 'p1',
    techniques: [{ technique, present: true, confidence: 0.9, severity: score, evidence: [] }],
    overallScore: score,
    overallConfidence: 0.9,
    isManipulative: true,
    processingTimeMs: 0,
    primaryTechnique: technique,
    explanation: 'x',
  };
}

interface TikTokItem { item: HTMLElement; desc: HTMLElement; video: HTMLVideoElement; commentIcon: HTMLElement }

/** One TikTok feed card: container > (caption, video, comment icon). */
function tiktokItem(list: HTMLElement, caption: string, muted = false): TikTokItem {
  const item = document.createElement('div');
  item.setAttribute('data-e2e', 'recommend-list-item-container');
  const desc = document.createElement('div');
  desc.setAttribute('data-e2e', 'video-desc');
  desc.textContent = caption;
  const video = document.createElement('video');
  video.muted = muted;
  const commentIcon = document.createElement('button');
  commentIcon.setAttribute('data-e2e', 'comment-icon');
  item.append(desc, video, commentIcon);
  list.appendChild(item);
  return { item, desc, video, commentIcon };
}

function feedList(): HTMLElement {
  const list = document.createElement('div');
  document.body.appendChild(list);
  return list;
}

function scrollSpy(el: HTMLElement): ReturnType<typeof vi.fn> {
  const fn = vi.fn();
  (el as unknown as { scrollIntoView: unknown }).scrollIntoView = fn;
  return fn;
}

/** jsdom lays nothing out: give `el` a full-window box whose top is `top`
 *  (0 is the card on screen, -H scrolled past, +H preloaded below). A
 *  function reads the top afresh, so a test can move the card. */
function placeAt(el: HTMLElement, top: number | (() => number)): void {
  const h = window.innerHeight;
  el.getBoundingClientRect = () => {
    const t = typeof top === 'function' ? top() : top;
    return { top: t, bottom: t + h, height: h, left: 0, right: 0, width: 0, x: 0, y: t, toJSON: () => ({}) } as DOMRect;
  };
}
const onScreen = (el: HTMLElement): void => placeAt(el, 0);

/** The player's own play(): jsdom does not implement it, so the fixture
 *  models the platform re-calling play on a paused element as the `play`
 *  event that call fires. */
function platformPlays(video: HTMLVideoElement): void {
  video.dispatchEvent(new Event('play'));
}

function makeXPost(): { article: HTMLElement; text: HTMLElement; video: HTMLVideoElement } {
  const article = document.createElement('article');
  article.setAttribute('role', 'article');
  const text = document.createElement('div');
  text.setAttribute('data-testid', 'tweetText');
  text.textContent = 'threat post text';
  const video = document.createElement('video');
  article.append(text, video);
  document.body.appendChild(article);
  return { article, text, video };
}

beforeEach(() => {
  document.body.innerHTML = '';
  _resetAdvanceBreakerForTesting();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  _setHostForTesting(null);
});

describe('1. advance after a hide', () => {
  it('must act: a hard hide on the TikTok card on screen scrolls the next card into view', () => {
    const list = feedList();
    const a = tiktokItem(list, 'marked caption');
    const b = tiktokItem(list, 'next caption');
    onScreen(a.item);
    const scrolled = scrollSpy(b.item);
    expect(injectHardHide(a.desc, 'tiktok')).toBe(true);
    expect(a.item.style.getPropertyValue('visibility'), 'hidden, and the card keeps its box').toBe('hidden');
    expect(a.item.style.getPropertyValue('display')).toBe('');
    expect(scrolled).toHaveBeenCalledTimes(1);
    expect(document.querySelector(`[${RUN_NOTICE_ATTR}]`)).toBeNull();
  });

  it('must not act: a hard hide on an X post scrolls nothing and shows no notice', () => {
    const { article, text } = makeXPost();
    const sibling = document.createElement('article');
    sibling.setAttribute('role', 'article');
    document.body.appendChild(sibling);
    const scrolled = scrollSpy(sibling);
    expect(injectHardHide(text, 'twitter')).toBe(true);
    expect(article.style.getPropertyValue('display')).toBe('none');
    expect(scrolled).not.toHaveBeenCalled();
    expect(document.querySelector(`[${RUN_NOTICE_ATTR}]`)).toBeNull();
  });

  it('must not act: replaying a hide the user had revealed does not move the feed', () => {
    const list = feedList();
    const a = tiktokItem(list, 'marked caption');
    const b = tiktokItem(list, 'next caption');
    const scrolled = scrollSpy(b.item);
    const opts = { noticeText: 'hid', showLabel: 'show', hideLabel: 'hide', initiallyRevealed: true };
    expect(injectHardHide(a.desc, 'tiktok', opts)).toBe(true);
    expect(scrolled).not.toHaveBeenCalled();
  });

  it('no next card loaded: the hide lands, the notice says scroll on', () => {
    const list = feedList();
    const a = tiktokItem(list, 'last loaded');
    onScreen(a.item);
    expect(injectHardHide(a.desc, 'tiktok')).toBe(true);
    const notice = document.querySelector(`[${RUN_NOTICE_ATTR}]`);
    expect(notice?.textContent).toBe('Skipped this video. Scroll on to keep going.');
  });
});

// On TikTok the automatic scroll after a mark sometimes turned back to an earlier post.
// A mark that lands on a card the user already scrolled past used to scroll
// to that card's next sibling, which is behind the user.
describe('1a. only the card on screen moves the feed', () => {
  it('must not act: a card the user scrolled past is hidden; the feed does not turn back', () => {
    const list = feedList();
    const past = tiktokItem(list, 'marked late, already scrolled past');
    const between = tiktokItem(list, 'seen after it');
    const watching = tiktokItem(list, 'the one on screen');
    placeAt(past.item, -2 * window.innerHeight);
    placeAt(between.item, -window.innerHeight);
    onScreen(watching.item);
    const spies = [past, between, watching].map((c) => scrollSpy(c.item));
    expect(injectHardHide(past.desc, 'tiktok')).toBe(true);
    expect(past.item.style.getPropertyValue('visibility')).toBe('hidden');
    for (const s of spies) expect(s).not.toHaveBeenCalled();
    expect(document.querySelector(`[${RUN_NOTICE_ATTR}]`)).toBeNull();
  });

  it('must not act: a card the feed preloaded below is hidden; the one on screen stays', () => {
    const list = feedList();
    const watching = tiktokItem(list, 'the one on screen');
    const below = tiktokItem(list, 'preloaded, marked');
    const after = tiktokItem(list, 'after it');
    onScreen(watching.item);
    placeAt(below.item, window.innerHeight);
    placeAt(after.item, 2 * window.innerHeight);
    const spies = [watching, below, after].map((c) => scrollSpy(c.item));
    expect(injectHardHide(below.desc, 'tiktok')).toBe(true);
    for (const s of spies) expect(s).not.toHaveBeenCalled();
  });

  it('must act: when the hidden card above moved the one on screen, it is put back, once', () => {
    const list = feedList();
    const past = tiktokItem(list, 'marked late');
    const watching = tiktokItem(list, 'the one on screen');
    placeAt(past.item, -window.innerHeight);
    // A feed that does not hold its place: the collapse above pulls the watched card up a screen.
    placeAt(watching.item, () => (past.item.style.getPropertyValue('display') === 'none' ? -window.innerHeight : 0));
    const back = scrollSpy(watching.item);
    collapseCard(past.item);
    expect(back).toHaveBeenCalledTimes(1);
  });

  it('must not act: a hard hide of a TikTok card keeps its box, so the one on screen does not move and is not scrolled', () => {
    const list = feedList();
    const past = tiktokItem(list, 'marked late');
    const watching = tiktokItem(list, 'the one on screen');
    placeAt(past.item, -window.innerHeight);
    placeAt(watching.item, () => (past.item.style.getPropertyValue('display') === 'none' ? -window.innerHeight : 0));
    const back = scrollSpy(watching.item);
    injectHardHide(past.desc, 'tiktok');
    expect(past.item.style.getPropertyValue('display')).toBe('');
    expect(back).not.toHaveBeenCalled();
  });

  it('must not act: an ad scrolled past is hidden; the feed does not turn back', () => {
    const list = feedList();
    const ad = tiktokItem(list, 'Sponsored');
    const watching = tiktokItem(list, 'the one on screen');
    const next = tiktokItem(list, 'after it');
    placeAt(ad.item, -window.innerHeight);
    onScreen(watching.item);
    const spies = [ad, watching, next].map((c) => scrollSpy(c.item));
    injectAdHide(ad.desc, 'tiktok');
    for (const s of spies) expect(s).not.toHaveBeenCalled();
  });

  it('the snapshot names the card that holds the middle of the window, or none', () => {
    const list = feedList();
    const a = tiktokItem(list, 'a');
    const b = tiktokItem(list, 'b');
    placeAt(a.item, -window.innerHeight);
    onScreen(b.item);
    expect(snapshotWatched(a.item, TIKTOK_FEED).watched).toBe(b.item);
    placeAt(b.item, window.innerHeight);
    expect(snapshotWatched(a.item, TIKTOK_FEED).watched).toBeNull();
  });
});

describe('1b. a run of hidden cards', () => {
  it('must act: walks past cards FeelingWise already hid and lands on the first visible one', () => {
    const list = feedList();
    const a = tiktokItem(list, 'a');
    const b = tiktokItem(list, 'b');
    const c = tiktokItem(list, 'c');
    const d = tiktokItem(list, 'd');
    b.item.setAttribute('data-fw-hard-hidden', 'true');
    c.item.setAttribute('data-fw-ad-hidden', 'true');
    const scrolledB = scrollSpy(b.item);
    const scrolledC = scrollSpy(c.item);
    const scrolledD = scrollSpy(d.item);
    const out = advancePastHiddenVideo(a.item, TIKTOK_FEED, 1_000);
    expect(out).toMatchObject({ advanced: true, skipped: 2 });
    expect(scrolledB).not.toHaveBeenCalled();
    expect(scrolledC).not.toHaveBeenCalled();
    expect(scrolledD).toHaveBeenCalledTimes(1);
  });

  it('must act: walks past cards the AI-content and Reels filters hid, which stay in the feed', () => {
    const list = feedList();
    const a = tiktokItem(list, 'a');
    const b = tiktokItem(list, 'b');
    const c = tiktokItem(list, 'c');
    const d = tiktokItem(list, 'd');
    b.item.setAttribute('data-fw-blocked', 'ai-content');
    c.item.setAttribute('data-fw-blocked', 'reel-surface');
    const scrolledB = scrollSpy(b.item);
    const scrolledC = scrollSpy(c.item);
    const scrolledD = scrollSpy(d.item);
    const out = advancePastHiddenVideo(a.item, TIKTOK_FEED, 1_000);
    expect(out).toMatchObject({ advanced: true, skipped: 2 });
    expect(scrolledB).not.toHaveBeenCalled();
    expect(scrolledC).not.toHaveBeenCalled();
    expect(scrolledD).toHaveBeenCalledTimes(1);
  });

  it('must not act: a card whose filter mark was taken off is landed on', () => {
    const list = feedList();
    const a = tiktokItem(list, 'a');
    const b = tiktokItem(list, 'b');
    b.item.setAttribute('data-fw-blocked', 'ai-content');
    b.item.removeAttribute('data-fw-blocked');
    const scrolledB = scrollSpy(b.item);
    const out = advancePastHiddenVideo(a.item, TIKTOK_FEED, 1_000);
    expect(out).toMatchObject({ advanced: true, skipped: 0 });
    expect(scrolledB).toHaveBeenCalledTimes(1);
  });

  it('stops at the cap with a visible notice instead of walking forever', () => {
    const list = feedList();
    const a = tiktokItem(list, 'a');
    const rest: TikTokItem[] = [];
    for (let i = 0; i < MAX_HIDDEN_RUN + 3; i++) {
      const it = tiktokItem(list, `hidden ${i}`);
      it.item.setAttribute('data-fw-hard-hidden', 'true');
      rest.push(it);
    }
    const visible = tiktokItem(list, 'visible at the end');
    const scrolled = scrollSpy(visible.item);
    const out = afterVideoHidden(a.item, TIKTOK_FEED, { open: false }, 'en');
    expect(out).toMatchObject({ advanced: false, reason: 'run-cap', skipped: MAX_HIDDEN_RUN });
    expect(scrolled).not.toHaveBeenCalled();
    const notice = document.querySelector(`[${RUN_NOTICE_ATTR}]`)!;
    expect(notice.textContent).toBe(`Skipped ${MAX_HIDDEN_RUN + 1} videos in a row. Scroll on to keep going.`);
    vi.advanceTimersByTime(7_000);
    expect(document.querySelector(`[${RUN_NOTICE_ATTR}]`)).toBeNull();
  });

  it('the breaker stops a feed that keeps re-hiding inside one window', () => {
    const list = feedList();
    let out: AdvanceOutcome | undefined;
    for (let i = 0; i <= MAX_ADVANCES_PER_WINDOW; i++) {
      const a = tiktokItem(list, `a${i}`);
      const b = tiktokItem(list, `b${i}`);
      scrollSpy(b.item);
      out = advancePastHiddenVideo(a.item, TIKTOK_FEED, 5_000 + i);
    }
    expect(out).toMatchObject({ advanced: false, reason: 'breaker' });
    // A new window starts clean.
    const a = tiktokItem(list, 'later');
    const b = tiktokItem(list, 'later next');
    scrollSpy(b.item);
    expect(advancePastHiddenVideo(a.item, TIKTOK_FEED, 5_000 + 20_000).advanced).toBe(true);
  });

  it('the notice text carries the count in every language the file has', () => {
    const list = feedList();
    const a = tiktokItem(list, 'a');
    for (let i = 0; i < MAX_HIDDEN_RUN; i++) {
      tiktokItem(list, `h${i}`).item.setAttribute('data-fw-hard-hidden', 'true');
    }
    for (const lang of ['ro', 'es', 'pt-BR'] as const) {
      _resetAdvanceBreakerForTesting();
      afterVideoHidden(a.item, TIKTOK_FEED, { open: false }, lang);
      const text = document.querySelector(`[${RUN_NOTICE_ATTR}]`)!.textContent!;
      expect(text).toContain(String(MAX_HIDDEN_RUN + 1));
      expect(text).not.toContain('—');
    }
  });
});

describe('2. the mute is scoped to the marked video', () => {
  it('must act: after a hard hide the marked video is paused and its muted flag is the user\'s own (false)', () => {
    const list = feedList();
    const a = tiktokItem(list, 'marked', false);
    const b = tiktokItem(list, 'next', false);
    scrollSpy(b.item);
    const pause = vi.spyOn(a.video, 'pause').mockImplementation(() => undefined);
    injectHardHide(a.desc, 'tiktok');
    expect(pause).toHaveBeenCalled();
    expect(a.video.muted).toBe(false);
    expect(a.item.getAttribute(SILENCED_ATTR)).toBe('true');
    // The next video was never touched: its own state, not ours.
    expect(b.video.muted).toBe(false);
    expect(b.item.hasAttribute(SILENCED_ATTR)).toBe(false);
  });

  it('must act: the platform re-calling play on the hidden video is answered with pause', () => {
    const list = feedList();
    const a = tiktokItem(list, 'marked');
    tiktokItem(list, 'next');
    const pause = vi.spyOn(a.video, 'pause').mockImplementation(() => undefined);
    injectHardHide(a.desc, 'tiktok');
    pause.mockClear();
    platformPlays(a.video);
    expect(pause).toHaveBeenCalledTimes(1);
  });

  it('must not act: a video the user had muted stays muted', () => {
    const list = feedList();
    const a = tiktokItem(list, 'marked', true);
    tiktokItem(list, 'next', true);
    vi.spyOn(a.video, 'pause').mockImplementation(() => undefined);
    injectHardHide(a.desc, 'tiktok');
    expect(a.video.muted).toBe(true);
  });

  it('must not act: on X the old posture stays, muted and paused', () => {
    const { text, video } = makeXPost();
    vi.spyOn(video, 'pause').mockImplementation(() => undefined);
    injectHardHide(text, 'twitter');
    expect(video.muted).toBe(true);
  });

  it('the collapse backstop on TikTok scopes the same way', () => {
    const list = feedList();
    const a = tiktokItem(list, 'folded caption', false);
    const b = tiktokItem(list, 'next', false);
    const pause = vi.spyOn(a.video, 'pause').mockImplementation(() => undefined);
    injectCollapseOrHide(a.desc, analysisWith('consumer-rapid-frame', 6), 'collapse');
    expect(pause).toHaveBeenCalled();
    expect(a.video.muted).toBe(false);
    expect(a.item.style.display).not.toBe('none');
    expect(b.video.muted).toBe(false);
  });

  it('Instagram Reels: folding one reel silences that reel only, never the whole main', () => {
    _setHostForTesting('www.instagram.com');
    const main = document.createElement('main');
    document.body.appendChild(main);
    const mkReel = (caption: string): { reel: HTMLElement; span: HTMLElement; video: HTMLVideoElement } => {
      const reel = document.createElement('div');
      const video = document.createElement('video');
      const span = document.createElement('span');
      span.setAttribute('dir', 'auto');
      span.textContent = caption;
      reel.append(video, span);
      main.appendChild(reel);
      return { reel, span, video };
    };
    const r1 = mkReel('the folded reel caption');
    const r2 = mkReel('the next reel caption');
    const p1 = vi.spyOn(r1.video, 'pause').mockImplementation(() => undefined);
    const p2 = vi.spyOn(r2.video, 'pause').mockImplementation(() => undefined);
    injectCollapseOrHide(r1.span, analysisWith('consumer-rapid-frame', 6), 'collapse');
    expect(p1).toHaveBeenCalled();
    expect(r1.reel.getAttribute(SILENCED_ATTR)).toBe('true');
    expect(p2).not.toHaveBeenCalled();
    expect(r2.video.muted).toBe(false);
    expect(r2.reel.hasAttribute(SILENCED_ATTR)).toBe(false);
  });

  it('muteAndPauseMedia on a Shorts item is scoped; on a plain div it is the old mute', () => {
    const short = document.createElement('ytd-reel-video-renderer');
    const sv = document.createElement('video');
    short.appendChild(sv);
    const plain = document.createElement('div');
    const pv = document.createElement('video');
    plain.appendChild(pv);
    document.body.append(short, plain);
    vi.spyOn(sv, 'pause').mockImplementation(() => undefined);
    vi.spyOn(pv, 'pause').mockImplementation(() => undefined);
    muteAndPauseMedia(short);
    muteAndPauseMedia(plain);
    expect(sv.muted).toBe(false);
    expect(short.getAttribute(SILENCED_ATTR)).toBe('true');
    expect(pv.muted).toBe(true);
  });

  it('a reveal ends the re-pause scope so the user can play the video', () => {
    const list = feedList();
    const a = tiktokItem(list, 'marked');
    tiktokItem(list, 'next');
    const pause = vi.spyOn(a.video, 'pause').mockImplementation(() => undefined);
    injectHardHide(a.desc, 'tiktok', { noticeText: 'hid', showLabel: 'show', hideLabel: 'hide' });
    // The notice of a kept TikTok card stands inside it (a sibling would add a block to the snapping column).
    const notice = a.item.querySelector('[data-fw-hide-notice]') as HTMLElement;
    notice.querySelector('button')!.click();
    expect(a.item.hasAttribute(SILENCED_ATTR)).toBe(false);
    pause.mockClear();
    platformPlays(a.video);
    expect(pause).not.toHaveBeenCalled();
  });
});

describe('3. the comment panel is left as the user had it', () => {
  function openPanel(inside: HTMLElement): HTMLElement {
    const panel = document.createElement('div');
    panel.className = 'css-abc-DivCommentListContainer';
    inside.appendChild(panel);
    return panel;
  }

  it('must act: a panel that was open and the hide closed comes back on the landed card, once', () => {
    const list = feedList();
    const a = tiktokItem(list, 'marked');
    const b = tiktokItem(list, 'next');
    openPanel(a.item); // the panel lives inside the card the hide removes
    onScreen(a.item);
    scrollSpy(b.item);
    const clickB = vi.spyOn(b.commentIcon, 'click');
    const clickA = vi.spyOn(a.commentIcon, 'click');
    injectHardHide(a.desc, 'tiktok');
    expect(clickB).not.toHaveBeenCalled();
    vi.advanceTimersByTime(COMMENT_RESTORE_DELAY_MS);
    expect(clickB).toHaveBeenCalledTimes(1);
    expect(clickA).not.toHaveBeenCalled();
    vi.advanceTimersByTime(5_000);
    expect(clickB).toHaveBeenCalledTimes(1);
  });

  it('must not act: a panel the user never opened is not opened by us', () => {
    const list = feedList();
    const a = tiktokItem(list, 'marked');
    const b = tiktokItem(list, 'next');
    onScreen(a.item);
    scrollSpy(b.item);
    const clickB = vi.spyOn(b.commentIcon, 'click');
    injectHardHide(a.desc, 'tiktok');
    vi.advanceTimersByTime(COMMENT_RESTORE_DELAY_MS + 1);
    expect(clickB).not.toHaveBeenCalled();
  });

  it('must not act: a page-level panel that stays open is not toggled (that would close it)', () => {
    const list = feedList();
    const a = tiktokItem(list, 'marked');
    const b = tiktokItem(list, 'next');
    openPanel(document.body); // outside every card; survives the hide
    onScreen(a.item);
    scrollSpy(b.item);
    const clickB = vi.spyOn(b.commentIcon, 'click');
    injectHardHide(a.desc, 'tiktok');
    vi.advanceTimersByTime(COMMENT_RESTORE_DELAY_MS + 1);
    expect(clickB).not.toHaveBeenCalled();
  });

  it('restoreCommentPanel reports what it did', () => {
    const list = feedList();
    const a = tiktokItem(list, 'a');
    const b = tiktokItem(list, 'b');
    const panel = openPanel(a.item);
    const before = snapshotCommentPanel(TIKTOK_FEED);
    expect(before.open).toBe(true);
    a.item.style.display = 'none';
    expect(restoreCommentPanel(TIKTOK_FEED, before, b.item)).toBe(true);
    panel.remove();
    expect(restoreCommentPanel(TIKTOK_FEED, { open: false }, b.item)).toBe(false);
  });
});

describe('the surface table', () => {
  it('names the item for each single-player feed and nothing else', () => {
    const tt = document.createElement('div');
    tt.setAttribute('data-e2e', 'recommend-list-item-container');
    const inner = document.createElement('span');
    tt.appendChild(inner);
    const x = document.createElement('article');
    document.body.append(tt, x);
    expect(videoFeedItemOf(inner)?.surface.name).toBe('tiktok-feed');
    expect(videoFeedItemOf(x)).toBeNull();
    _setHostForTesting('www.instagram.com');
    const main = document.createElement('main');
    const reel = document.createElement('div');
    reel.appendChild(document.createElement('video'));
    const noVideo = document.createElement('div');
    main.append(reel, noVideo);
    document.body.appendChild(main);
    expect(videoFeedItemOf(reel)?.surface.name).toBe('instagram-reels');
    expect(videoFeedItemOf(noVideo)).toBeNull();
  });

  it('silenceVideoItem is idempotent and keeps the first baseline', () => {
    const item = document.createElement('div');
    item.setAttribute('data-e2e', 'recommend-list-item-container');
    const v = document.createElement('video');
    v.muted = false;
    item.appendChild(v);
    document.body.appendChild(item);
    const pause = vi.spyOn(v, 'pause').mockImplementation(() => undefined);
    silenceVideoItem(item);
    v.muted = true; // the platform's own write inside the scope
    silenceVideoItem(item);
    expect(v.muted).toBe(false);
    expect(pause).toHaveBeenCalledTimes(2);
    // A new scope reads the user's state afresh: muted by them, stays muted.
    releaseVideoItem(item);
    v.muted = true;
    silenceVideoItem(item);
    expect(v.muted).toBe(true);
  });
});

// X keeps its whole layout in the one div under <main>, the same shape the Reels row reads as a
// reel. These fixtures carry that layout, which the X posts above (bare articles) did not.
describe('X: a hidden post never silences the page', () => {
  interface XVideoPost { article: HTMLElement; text: HTMLElement; video: HTMLVideoElement }
  function xTimeline(n: number): { layout: HTMLElement; posts: XVideoPost[] } {
    _setHostForTesting('x.com');
    const main = document.createElement('main');
    main.setAttribute('role', 'main');
    const layout = document.createElement('div');
    const timeline = document.createElement('section');
    layout.appendChild(timeline);
    main.appendChild(layout);
    document.body.appendChild(main);
    const posts: XVideoPost[] = [];
    for (let i = 0; i < n; i++) {
      const cell = document.createElement('div');
      cell.setAttribute('data-testid', 'cellInnerDiv');
      const article = document.createElement('article');
      article.setAttribute('role', 'article');
      const text = document.createElement('div');
      text.setAttribute('data-testid', 'tweetText');
      text.textContent = `post ${i} with a clip`;
      const video = document.createElement('video');
      article.append(text, video);
      cell.appendChild(article);
      timeline.appendChild(cell);
      posts.push({ article, text, video });
    }
    return { layout, posts };
  }

  it('the layout under <main> is not a video feed item on X', () => {
    const { layout, posts } = xTimeline(2);
    expect(videoFeedItemOf(posts[0].video)).toBeNull();
    expect(videoFeedItemOf(layout)).toBeNull();
  });

  it('muting a hidden post leaves every other video and the layout alone', () => {
    const { layout, posts } = xTimeline(3);
    const others = posts.slice(1).map((p) => vi.spyOn(p.video, 'pause').mockImplementation(() => undefined));
    vi.spyOn(posts[0].video, 'pause').mockImplementation(() => undefined);
    muteAndPauseMedia(posts[0].article);
    expect(posts[0].video.muted).toBe(true);
    expect(layout.hasAttribute(SILENCED_ATTR)).toBe(false);
    for (const pause of others) expect(pause).not.toHaveBeenCalled();
  });

  it('folding a post keeps the old posture on that post only', () => {
    const { layout, posts } = xTimeline(2);
    const other = vi.spyOn(posts[1].video, 'pause').mockImplementation(() => undefined);
    vi.spyOn(posts[0].video, 'pause').mockImplementation(() => undefined);
    injectCollapseOrHide(posts[0].text, analysisWith('consumer-rapid-frame', 6), 'collapse');
    expect(layout.hasAttribute(SILENCED_ATTR)).toBe(false);
    expect(other).not.toHaveBeenCalled();
  });

  // A player that plays again whenever something else pauses it: each play is answered by a pause
  // from the silence scope, each pause by a play, on the main thread until a cap.
  it('a player that resumes after an outside pause is not pulled into a play and pause loop', () => {
    const { posts } = xTimeline(2);
    const [hidden, watched] = posts;
    vi.spyOn(hidden.video, 'pause').mockImplementation(() => undefined);
    muteAndPauseMedia(hidden.article);
    let pauses = 0;
    vi.spyOn(watched.video, 'pause').mockImplementation(() => {
      pauses++;
      if (pauses < 1000) watched.video.dispatchEvent(new Event('play'));
    });
    watched.video.dispatchEvent(new Event('play'));
    expect(pauses).toBe(0);
  });
});
