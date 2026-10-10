// @vitest-environment jsdom
//
// M27 — ai-content-blocker stays muted after toggle-off.
//
// Before the fix, resetDOM (the engagement controller's master DOM-reset path,
// also run on the blocker's own teardown) restored visibility + pointer-events
// on every blocked container but never unmuted the <video>/<audio> elements it
// had silenced. A video already on screen when the parent toggled the
// AI-content blocker OFF stayed muted until the platform re-attached fresh
// media on the next interaction. resetDOM now unmutes every tracked container.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  __trackBlockedContainerForTest,
  __resetDOMForTest,
} from '../../../../src/content/engagement/ai-content-blocker';

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('ai-content-blocker resetDOM — unmute on toggle-off (M27)', () => {
  it('unmutes media in a tracked blocked container on reset', () => {
    const container = document.createElement('div');
    const video = document.createElement('video');
    video.muted = true; // blocker had muted it
    container.appendChild(video);
    document.body.appendChild(container);

    __trackBlockedContainerForTest(container);
    __resetDOMForTest();

    expect(video.muted).toBe(false);
  });

  it('unmutes <audio> as well as <video>', () => {
    const container = document.createElement('div');
    const audio = document.createElement('audio');
    audio.muted = true;
    container.appendChild(audio);
    document.body.appendChild(container);

    __trackBlockedContainerForTest(container);
    __resetDOMForTest();

    expect(audio.muted).toBe(false);
  });

  it('clears the tracking set so a second reset has nothing left to unmute', () => {
    const container = document.createElement('div');
    const video = document.createElement('video');
    video.muted = true;
    container.appendChild(video);
    document.body.appendChild(container);

    __trackBlockedContainerForTest(container);
    __resetDOMForTest();
    // Re-mute and reset again: because the set was cleared, this container is
    // no longer tracked, so the second reset leaves it muted (proves clear()).
    video.muted = true;
    __resetDOMForTest();
    expect(video.muted).toBe(true);
  });

  it('is a no-op (no throw) when no container was tracked', () => {
    expect(() => __resetDOMForTest()).not.toThrow();
  });
});
