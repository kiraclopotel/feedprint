// The popup's account of what is protected, checked against the adapters.
//
// coverage-map.ts is what a parent reads to learn whether the page in front of
// them is covered. It was written by hand as a description of what the content
// scripts do, and a hand-written mirror drifts. It had drifted twice by the
// time this file was written: M98 on 2026-08-04 told a parent "post + replies,
// FULL" on a Twitter surface where the reply model was off, and on 2026-09-19
// the YouTube catch-all was found saying "Community posts are scanned; YouTube
// comments are not scanned yet" on every YouTube page that was not /watch or
// /shorts.
//
// Two ways that sentence was untrue:
//
//   • On search results, a channel page or a playlist, the video tiles filling
//     the screen are never extracted. _extractHomeTiles in youtube.ts runs only
//     when classifySurface says 'youtube-home', which is '/',
//     /feed/subscriptions, /feed/trending and /feed/explore. The parent was
//     told the only gap was comments.
//   • On /playlist, /feed/history, /account, the live tab and the live chat
//     frame, the recorder stands down entirely. The parent was told community
//     posts were being scanned there.
//
// The YouTube branch reads the adapters' table now instead of keeping a copy.
// This file holds that, and holds the sentences apart from each other, because
// three branches that all say the same thing is the same defect wearing a
// tidier coat.

import { describe, it, expect } from 'vitest';
import { describePageCoverage } from '../../../../src/ui/popup/coverage-map';
import { classifySurface, shouldStandDown } from '../../../../src/content/post-path/surfaces';

const at = (path: string) => describePageCoverage('www.youtube.com', path)!;

describe('the popup does not claim a scan the recorder stands down from', () => {
  // Every path the surface table calls stand-down. If a new one is added there,
  // add it here: that is the point of the list.
  const STAND_DOWN = ['/playlist?list=PL1', '/feed/history', '/account', '/live_chat', '/live', '/embed/abc', '/premium'];

  it.each(STAND_DOWN)('%s: the table says stand down', (path) => {
    expect(shouldStandDown('youtube', path.split('?')[0])).toBe(true);
  });

  it.each(STAND_DOWN)('%s: so the popup claims no post scan', (path) => {
    const c = at(path.split('?')[0]);
    expect(c.protections.postScan, 'nothing is read here').toBe(false);
    expect(c.fullyProtected).toBe(false);
  });
});

describe('the popup names the videos when the videos are not read', () => {
  it('search results: the tiles are not extracted, and the sentence says so', () => {
    expect(classifySurface('youtube', '/results').surface).toBe('youtube-search');
    const c = at('/results');
    // The old sentence named comments as the only gap. The new one names the
    // videos on the page as well, which is the thing the parent is looking at.
    expect(c.gapNote).toMatch(/video/i);
    expect(c.fullyProtected).toBe(false);
  });

  it('a channel page says the same, because it is read the same way', () => {
    const c = at('/@someone');
    expect(c.gapNote).toMatch(/video/i);
  });

  it('the home grid does not, because there the tiles really are read', () => {
    expect(classifySurface('youtube', '/').surface).toBe('youtube-home');
    const c = at('/');
    expect(c.protections.postScan).toBe(true);
    expect(c.gapNote, 'comments are the only gap here').not.toMatch(/video/i);
  });

  it.each(['/feed/subscriptions', '/feed/trending', '/feed/explore'])(
    '%s is a grid too, and gets the grid sentence',
    (path) => {
      expect(classifySurface('youtube', path).surface).toBe('youtube-home');
      expect(at(path).gapNote).not.toMatch(/video/i);
    },
  );

  it('the three sentences are three different sentences', () => {
    const grid = at('/').gapNote;
    const search = at('/results').gapNote;
    const standDown = at('/playlist').gapNote;
    expect(new Set([grid, search, standDown]).size, 'one page, one true sentence').toBe(3);
  });
});

describe('the pages that were already right stay right', () => {
  it('watch and shorts are untouched', () => {
    expect(at('/watch').protections.postScan).toBe(false);
    expect(at('/shorts/abc').protections.reelsBlockable).toBe(true);
  });

  it('metrics and buttons still go, even where the recorder stands down', () => {
    // The engagement controller is a separate subsystem and does not read the
    // surface table, so a stand-down page still has its counts hidden.
    const c = at('/playlist');
    expect(c.protections.metricsHidden).toBe(true);
    expect(c.protections.buttonsHidden).toBe(true);
  });
});
