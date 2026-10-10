// @vitest-environment jsdom
//
// The guard that refuses a recycled frame did not run for a post with no text.
//
// mediaFrame compares the post's own first forty characters against what the
// frame says now, and refuses the frame when they disagree, because a
// virtualized feed reuses containers and an address read from a reused one
// "would name someone else's picture", in the file's own words. The comparison
// was written `if (want && ...)`, so a post whose text is empty skipped it and
// the frame came back unchecked.
//
// That is the ordinary path for a whole class of record, not a corner.
// tiktok.ts emits text:'' for every music-only video and says in its own
// comment that the path "is the ONLY place such a video can be recorded". It
// hands over a WeakRef to the container, and mediaUrlsNow re-reads that live
// container at chain-write time, after the queue and after a model round trip,
// which is precisely the window a feed recycles in. isConnected does not see
// it: the node stays connected and holds a different video. So the addresses
// written into a signed record could be another post's, and the counter said
// mediaUrls.found.
//
// With no text, the id the adapter already resolved is the anchor. Where there
// is no id either, the frame is refused and the detection-time stamp stands.

import { describe, it, expect, beforeEach } from 'vitest';
import { mediaFrame, mediaUrlsNow, stampMediaUrls } from '../../../../src/content/record/media-urls';
import type { PostContent } from '../../../../src/types/post';
import {
  _resetDiagnosticsForTesting,
  _getDiagnosticCountersForTesting,
} from '../../../../src/diagnostics/diagnostics';

/** jsdom reports no layout, so the size gate is answered directly. */
function sized(el: Element, w: number, h: number): void {
  Object.defineProperty(el, 'getBoundingClientRect', {
    value: () => ({ width: w, height: h, top: 0, left: 0, right: w, bottom: h, x: 0, y: 0, toJSON: () => ({}) }),
    configurable: true,
  });
  Object.defineProperty(el, 'naturalWidth', { value: w, configurable: true });
  Object.defineProperty(el, 'naturalHeight', { value: h, configurable: true });
}

/** A TikTok feed container for one video, the way the adapter meets it. */
function container(videoId: string, imageUrl: string): HTMLElement {
  document.body.innerHTML = `
    <div data-e2e="recommend-list-item-container" id="frame">
      <a href="https://www.tiktok.com/@someone/video/${videoId}">open</a>
      <img id="pic" src="${imageUrl}">
    </div>`;
  const frame = document.getElementById('frame') as HTMLElement;
  sized(document.getElementById('pic')!, 600, 800);
  return frame;
}

/** The caption-less video record tiktok.ts writes for a music-only video. */
function musicOnlyVideo(frame: HTMLElement, videoId: string): PostContent {
  return {
    id: `tk-vid-${videoId}`,
    platform: 'tiktok',
    text: '',
    author: '@someone',
    kind: 'video',
    parentVideoId: videoId,
    domRef: new WeakRef(frame),
  } as unknown as PostContent;
}

beforeEach(() => { document.body.innerHTML = ''; });

describe('a post with no caption is still checked (2026-09-19)', () => {
  it('reads the frame while it is still this video', () => {
    const frame = container('7412345678901234567', 'https://cdn.example/mine.jpg');
    const post = musicOnlyVideo(frame, '7412345678901234567');

    expect(mediaFrame(post)).toBe(frame);
    expect(mediaUrlsNow(post)).toEqual(['https://cdn.example/mine.jpg']);
  });

  it('refuses the frame once the feed has recycled it for another video', () => {
    const frame = container('7412345678901234567', 'https://cdn.example/mine.jpg');
    const post = musicOnlyVideo(frame, '7412345678901234567');
    stampMediaUrls(post);
    expect(post.mediaUrls, 'read once, off the right container').toEqual(['https://cdn.example/mine.jpg']);

    // The container stays in the document and stays connected. Only its
    // contents change, which is exactly what a virtualizer does.
    frame.querySelector('a')!.setAttribute('href', 'https://www.tiktok.com/@other/video/7499999999999999999');
    frame.querySelector('img')!.setAttribute('src', 'https://cdn.example/someone-elses.jpg');

    expect(frame.isConnected, 'still connected, which is why isConnected cannot catch this').toBe(true);
    expect(mediaFrame(post), 'refused').toBeNull();
    expect(
      mediaUrlsNow(post),
      'the stamp taken off the right container stands, never the new address',
    ).toEqual(['https://cdn.example/mine.jpg']);
  });

  it('refuses rather than guesses when there is no id to anchor on', () => {
    const frame = container('7412345678901234567', 'https://cdn.example/mine.jpg');
    const post = { ...musicOnlyVideo(frame, '7412345678901234567'), parentVideoId: undefined } as PostContent;

    expect(mediaFrame(post)).toBeNull();
    // A late-loading picture is missed this way. The file's own header settles
    // which way to be wrong: "Absent means 'not read', never 'no media'."
    expect(mediaUrlsNow(post)).toBeUndefined();
  });

  it('takes the id out of the permalink when the record carries no video id', () => {
    const frame = container('7412345678901234567', 'https://cdn.example/mine.jpg');
    const post = {
      ...musicOnlyVideo(frame, '7412345678901234567'),
      parentVideoId: undefined,
      sourceUrl: 'https://www.tiktok.com/@someone/video/7412345678901234567',
    } as PostContent;

    expect(mediaFrame(post)).toBe(frame);
    expect(mediaUrlsNow(post)).toEqual(['https://cdn.example/mine.jpg']);
  });

  it('says which it saw: a container that moved on, against one that has not spoken yet', () => {
    // The standing platform rule: on a virtualized feed a missing identity
    // during hydration is not a conflicting one. Both refuse, because both fall
    // back to a stamp read off the right container and neither loses anything.
    // They are counted apart because only one of them is the feed recycling,
    // and the other is what a redesign looks like on the day it lands.
    _resetDiagnosticsForTesting();

    const recycled = container('7412345678901234567', 'https://cdn.example/mine.jpg');
    const a = musicOnlyVideo(recycled, '7412345678901234567');
    recycled.querySelector('a')!.setAttribute('href', 'https://www.tiktok.com/@other/video/7499999999999999999');
    expect(mediaFrame(a)).toBeNull();
    expect(_getDiagnosticCountersForTesting()['mediaUrls.recycled'], 'a permalink for somebody else').toBe(1);

    // Same frame, no link rendered at all. Nothing has said whose it is.
    document.body.innerHTML = '<div data-e2e="recommend-list-item-container" id="frame"></div>';
    const quiet = document.getElementById('frame') as HTMLElement;
    const b = musicOnlyVideo(quiet, '7412345678901234567');
    expect(mediaFrame(b)).toBeNull();
    expect(_getDiagnosticCountersForTesting()['mediaUrls.noIdentity'], 'not the same event').toBe(1);
    expect(_getDiagnosticCountersForTesting()['mediaUrls.recycled'], 'and not counted as one').toBe(1);
  });

  it('leaves a post that has text on the path it always took', () => {
    document.body.innerHTML = `
      <div data-e2e="recommend-list-item-container" id="frame">
        <img id="pic" src="https://cdn.example/captioned.jpg">
        <div id="cap">a caption long enough to compare against</div>
      </div>`;
    sized(document.getElementById('pic')!, 600, 800);
    const frame = document.getElementById('frame') as HTMLElement;
    const post = {
      id: 'p1', platform: 'tiktok', text: 'a caption long enough to compare against',
      author: '@someone', kind: 'video', domRef: new WeakRef(frame),
    } as unknown as PostContent;

    expect(mediaFrame(post), 'text matches, no id needed').toBe(frame);
    document.getElementById('cap')!.textContent = 'a completely different caption now';
    expect(mediaFrame(post), 'text disagrees, refused as before').toBeNull();
  });
});
