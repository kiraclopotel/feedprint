// @vitest-environment jsdom
//
// F65 (the owner, 3 Oct 2026, three screenshots): on YouTube, after switching
// videos without a reload, the watch page's title kept the mark and the words
// of an earlier video ("MAGNUS vs HIKARU ..." with the red dot, then "FeelingWise
// Feedback: Seen this a lot ...") while another video played. A reload fixed it.
// YouTube reuses the same title element across videos, and the mark drawn on
// it (its dot, its state stamp, the words its states put back) stayed.
// Promise: when the video changes, the old mark leaves the title element; the
// new video's own record marks it again if it must.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { PostContent } from '../../../../src/types/post';
import type { AnalysisResult } from '../../../../src/types/analysis';

const flagState = { ytWatchComments: true };
vi.mock('../../../../src/storage/feature-flags', () => ({
  isFeatureEnabled: vi.fn(async (flag: string) =>
    flag === 'ytWatchComments' ? flagState.ytWatchComments : false),
}));

import { initYtWatchComments } from '../../../../src/content/platforms/yt-watch-comments';
import { renderTeenMarker } from '../../../../src/content/markers/teen-marker';
import { markOnlyElement } from '../../../../src/content/injector';

function analysis(): AnalysisResult {
  return {
    techniques: [{ name: 'repeat-exposure', severity: 6, confidence: 0.9 }],
    overallScore: 6,
    overallConfidence: 0.9,
    isManipulative: true,
    processingTimeMs: 1,
    primaryTechnique: 'repeat-exposure',
    explanation: 'source seen on 13 separate days',
  } as unknown as AnalysisResult;
}

function buildWatchPage(videoId: string, title: string): HTMLElement {
  window.history.replaceState({}, '', `/watch?v=${videoId}`);
  document.body.innerHTML = `
    <h1 class="ytd-watch-metadata"><yt-formatted-string>${title}</yt-formatted-string></h1>
    <div id="owner"><ytd-channel-name id="channel-name"><a href="/@c">Channel</a></ytd-channel-name></div>
    <ytd-comments id="comments"></ytd-comments>`;
  return document.querySelector<HTMLElement>('h1.ytd-watch-metadata yt-formatted-string')!;
}

/** What YouTube does on a video switch: same element, new words, then its navigate event. */
function youtubeSwitchesTo(videoId: string, title: string): void {
  window.history.replaceState({}, '', `/watch?v=${videoId}`);
  const titleEl = document.querySelector<HTMLElement>('h1.ytd-watch-metadata yt-formatted-string')!;
  titleEl.textContent = title;
  document.dispatchEvent(new Event('yt-navigate-finish'));
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 4; i++) await Promise.resolve();
}

let cleanup: (() => void) | null = null;
const emitted: PostContent[] = [];

beforeEach(async () => {
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  window.history.replaceState({}, '', '/'); // the extension starts before any video is open
  emitted.length = 0;
  cleanup = initYtWatchComments({ emitPost: (p) => emitted.push(p) });
  await flushMicrotasks();
});
afterEach(() => { cleanup?.(); cleanup = null; document.body.innerHTML = ''; });

const OLD = 'MAGNUS vs HIKARU: BRILLIANT CHESS!!!!!';
const NEW = 'Anchetă inventată: Este Exempleni parte dintr-o rețea de exemplu? [INTEGRAL]';

describe('F65: a new video drops the old title mark', () => {
  it('the dot and the state stamp leave the title element when the video changes (explanation shown)', () => {
    const titleEl = buildWatchPage('old1', OLD);
    const marker = renderTeenMarker({ el: titleEl, analysis: analysis(), originalText: OLD, kind: 'collapse' })!;
    expect(titleEl.querySelector('.fw-teen-marker')).toBe(marker);
    marker.click(); // the owner pressed the dot: our explanation is shown
    expect(titleEl.dataset.fwMarkerState).toBe('yellow');

    youtubeSwitchesTo('new2', NEW);

    expect(titleEl.querySelector('.fw-teen-marker')).toBeNull();
    expect(titleEl.dataset.fwMarkerState).toBeUndefined();
    expect(titleEl.textContent).toBe(NEW);
  });

  it('the mark the live page draws on a video title (mark only: a dot whose press shows our line) leaves too', () => {
    const titleEl = buildWatchPage('old1', OLD);
    markOnlyElement(titleEl, analysis(), true, OLD, 'en');
    const marker = titleEl.querySelector<HTMLButtonElement>('.fw-teen-marker')!;
    expect(marker).not.toBeNull();
    marker.click(); // the dot pressed: our "FeelingWise Feedback" line replaces the title words
    expect(titleEl.dataset.fwMarkerState).toBe('yellow');
    expect(titleEl.textContent).toContain('FeelingWise Feedback');

    youtubeSwitchesTo('new2', NEW);

    expect(titleEl.querySelector('.fw-teen-marker')).toBeNull();
    expect(titleEl.dataset.fwMarkerState).toBeUndefined();
    expect(titleEl.getAttribute('data-fw-neutralized')).toBeNull();
    expect(titleEl.getAttribute('data-fw-action')).toBeNull();
    expect(titleEl.textContent).toBe(NEW);
  });

  it('a video that was never marked is left alone', () => {
    const titleEl = buildWatchPage('old1', OLD);
    youtubeSwitchesTo('new2', NEW);
    expect(titleEl.textContent).toBe(NEW);
    expect(titleEl.dataset.fwMarkerState).toBeUndefined();
    expect(titleEl.querySelector('.fw-teen-marker')).toBeNull();
  });
});

describe('F65: the mark of the video on screen is kept', () => {
  it('the first page keeps its mark through the navigate event YouTube fires for it', async () => {
    cleanup?.(); cleanup = null;
    // The extension starts on the watch page itself (a reload, or a direct link).
    const titleEl = buildWatchPage('first1', OLD);
    cleanup = initYtWatchComments({ emitPost: (p) => emitted.push(p) });
    await flushMicrotasks();
    const marker = renderTeenMarker({ el: titleEl, analysis: analysis(), originalText: OLD, kind: 'collapse' })!;

    document.dispatchEvent(new Event('yt-navigate-finish')); // the same video, YouTube's first-page event

    expect(titleEl.querySelector('.fw-teen-marker')).toBe(marker);
    expect(titleEl.dataset.fwMarkerState).toBe('base');
  });

  it('a navigate event for the same video id releases nothing', () => {
    const titleEl = buildWatchPage('old1', OLD);
    youtubeSwitchesTo('old1', OLD); // now marked as the current video
    const marker = renderTeenMarker({ el: titleEl, analysis: analysis(), originalText: OLD, kind: 'collapse' })!;

    // A comment-tab change, a seek: the same id, the same words (writing the words anew would itself drop the dot).
    document.dispatchEvent(new Event('yt-navigate-finish'));

    expect(titleEl.querySelector('.fw-teen-marker')).toBe(marker);
  });

  it('the colour pinned by a pressed dot leaves with the mark', () => {
    const titleEl = buildWatchPage('old1', OLD);
    const marker = renderTeenMarker({ el: titleEl, analysis: analysis(), originalText: OLD, kind: 'collapse' })!;
    marker.click();
    titleEl.style.setProperty('color', 'rgb(1, 2, 3)', 'important'); // what writeHolderText pins on an element holder

    youtubeSwitchesTo('new2', NEW);

    expect(titleEl.style.getPropertyValue('color')).toBe('');
  });
});
