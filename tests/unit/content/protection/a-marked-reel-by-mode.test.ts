// @vitest-environment jsdom
//
// Instagram Reels: the silence of a marked reel belongs to that reel, not to the box it is drawn in.
// The record's anchor on a reel is its caption span inside the reel's box (the direct child of <main>
// holding the video, instagram.ts _extractReelSurface). The extractor and the 2026-08-24 identity
// audit say the box is reused as the address rotates on scroll; these pages model both shapes, a
// reused box and one box per reel, since the live page has not been read.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { injectCollapseOrHide, injectHardHide } from '../../../../src/content/injector';
import { SILENCED_ATTR, SILENCED_FOR_ATTR, _setHostForTesting } from '../../../../src/content/protection/video-feed-hide';
import type { AnalysisResult } from '../../../../src/types/analysis';

function analysis(): AnalysisResult {
  return {
    postId: 'r1',
    techniques: [{ technique: 'extreme-toxicity', present: true, confidence: 0.9, severity: 9, evidence: [] }],
    overallScore: 9, overallConfidence: 0.9, isManipulative: true, processingTimeMs: 0,
    primaryTechnique: 'extreme-toxicity', explanation: 'x',
  };
}

function reel(main: HTMLElement, caption: string): { box: HTMLElement; video: HTMLVideoElement; captionEl: HTMLElement } {
  const box = document.createElement('div');
  const video = document.createElement('video');
  const captionEl = document.createElement('span');
  captionEl.setAttribute('dir', 'auto');
  captionEl.textContent = caption;
  box.append(video, captionEl);
  main.appendChild(box);
  return { box, video, captionEl };
}

function page(): HTMLElement {
  const main = document.createElement('main');
  document.body.appendChild(main);
  return main;
}

const goTo = (id: string): void => { history.pushState({}, '', `/reels/${id}/`); };

beforeEach(() => { document.body.innerHTML = ''; _setHostForTesting('www.instagram.com'); goTo('AAA'); });
afterEach(() => { _setHostForTesting(null); history.pushState({}, '', '/'); });

describe('a marked Instagram reel', () => {
  it('the hard hide finds no box for a reel, so a reel is never hidden whole', () => {
    const { captionEl } = reel(page(), 'a marked reel caption here');
    expect(injectHardHide(captionEl, 'instagram')).toBe(false);
  });

  it('the silence is tied to the reel the address names', () => {
    const { box, video, captionEl } = reel(page(), 'a marked reel caption here');
    vi.spyOn(video, 'pause').mockImplementation(() => undefined);
    injectCollapseOrHide(captionEl, analysis(), 'hide', false, '', 'en', 'child');
    expect(box.getAttribute(SILENCED_ATTR)).toBe('true');
    expect(box.getAttribute(SILENCED_FOR_ATTR)).toBe('AAA');
  });

  it('must act: while the marked reel is on screen, its video is paused again on play', () => {
    const { video, captionEl } = reel(page(), 'a marked reel caption here');
    vi.spyOn(video, 'pause').mockImplementation(() => undefined);
    injectCollapseOrHide(captionEl, analysis(), 'hide', false, '', 'en', 'child');
    const pause = vi.spyOn(video, 'pause').mockImplementation(() => undefined);
    // Spying again returns the same spy; clear the silence's own call so only the play counts.
    pause.mockClear();
    video.dispatchEvent(new Event('play'));
    expect(pause).toHaveBeenCalled();
  });

  it('must not act: the next reel drawn into the same box plays, and the box is released', () => {
    const { box, video, captionEl } = reel(page(), 'a marked reel caption here');
    vi.spyOn(video, 'pause').mockImplementation(() => undefined);
    injectCollapseOrHide(captionEl, analysis(), 'hide', false, '', 'en', 'child');
    goTo('BBB');
    captionEl.textContent = 'the next reel, nothing marked in it';
    const pause = vi.spyOn(video, 'pause').mockImplementation(() => undefined);
    // Spying again returns the same spy; clear the silence's own call so only the play counts.
    pause.mockClear();
    video.dispatchEvent(new Event('play'));
    expect(pause).not.toHaveBeenCalled();
    expect(box.hasAttribute(SILENCED_ATTR)).toBe(false);
    expect(box.hasAttribute(SILENCED_FOR_ATTR)).toBe(false);
  });

  it('must not act: with one box per reel, the next reel was never silenced', () => {
    const main = page();
    const first = reel(main, 'a marked reel caption here');
    const second = reel(main, 'the next reel, nothing marked in it');
    vi.spyOn(first.video, 'pause').mockImplementation(() => undefined);
    injectCollapseOrHide(first.captionEl, analysis(), 'hide', false, '', 'en', 'child');
    goTo('BBB');
    const pause = vi.spyOn(second.video, 'pause').mockImplementation(() => undefined);
    second.video.dispatchEvent(new Event('play'));
    expect(pause).not.toHaveBeenCalled();
    expect(second.box.hasAttribute(SILENCED_ATTR)).toBe(false);
  });

  it('must not act: off Instagram the silence carries no reel id (X, TikTok keep their scope)', () => {
    _setHostForTesting('x.com');
    const main = page();
    const { box, captionEl } = reel(main, 'a post caption with a video under main');
    injectCollapseOrHide(captionEl, analysis(), 'hide', false, '', 'en', 'child');
    expect(box.hasAttribute(SILENCED_FOR_ATTR)).toBe(false);
  });
});
