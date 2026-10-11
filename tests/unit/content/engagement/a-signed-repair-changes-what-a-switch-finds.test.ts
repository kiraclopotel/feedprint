// @vitest-environment jsdom
//
// A signed repair changes what a real switch finds (11 Oct 2026).
//
// The families are only worth having if the finders read them. These tests drive the real modules: YouTube's counts and
// comment-block lists, Facebook's comment-block sheet and the words that mark an ad, with a repair put in force the way
// store.ts does it, and check the page changes (or does not change) as the repair says.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/storage/settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/storage/settings')>();
  return { ...actual, incrementMetricsHidden: vi.fn(() => Promise.resolve()) };
});

import type { RepairEntry } from '../../../../src/core/repairs/format';
import { __resetRepairsForTest, applyRepairFile } from '../../../../src/core/repairs/families';
import { startYouTubeEngagementControl } from '../../../../src/content/engagement/youtube-engagement';
import { blockCommentInputCSS } from '../../../../src/content/engagement/facebook-engagement';
import { isAdLabelText } from '../../../../src/content/engagement/ad-labels';
import { ensureStyleTag, removeStyleTag } from '../../../../src/content/engagement/style-tag';
import { adultPreset } from '../../../../src/storage/presets';
import type { FWSettings, FeatureId } from '../../../../src/storage/settings';

function repair(version: number, ...entries: Partial<RepairEntry>[]): void {
  applyRepairFile({
    version, issuedAt: '2026-10-11T16:00:00Z', expiresAt: null,
    entries: entries.map((e) => ({ family: 'x.y', add: [], remove: [], off: false, ...e })),
  });
}

function settingsWith(...on: FeatureId[]): FWSettings {
  const features = adultPreset();
  for (const id of on) features[id] = { enabled: true };
  return { features } as unknown as FWSettings;
}

const shown = (id: string): boolean => {
  const style = getComputedStyle(document.getElementById(id) as Element);
  return style.display !== 'none' && style.visibility !== 'hidden';
};
let stop: (() => void) | null = null;

beforeEach(() => {
  document.body.innerHTML = '';
  window.history.pushState({}, '', '/watch?v=x');
  __resetRepairsForTest();
});

afterEach(() => {
  stop?.();
  stop = null;
  removeStyleTag('fw-test-sheet');
  __resetRepairsForTest();
});

describe('YouTube counts: a renamed count is found once a repair names it', () => {
  const PAGE = '<ytd-watch-metadata><span id="renamed" class="ytRenamedLikeCount">19M</span><span id="title">A title</span></ytd-watch-metadata>';

  it('without the repair the renamed count stays on screen', () => {
    document.body.innerHTML = PAGE;
    stop = startYouTubeEngagementControl(settingsWith('hide-engagement-metrics'));
    expect(shown('renamed')).toBe(true);
  });

  it('with the repair it goes, and the title stays', () => {
    document.body.innerHTML = PAGE;
    repair(1, { family: 'finder.youtube.counts', add: ['ytd-watch-metadata .ytRenamedLikeCount'] });
    stop = startYouTubeEngagementControl(settingsWith('hide-engagement-metrics'));
    expect(shown('renamed')).toBe(false);
    expect(shown('title')).toBe(true);
  });
});

describe('YouTube comment block: a family can be switched off', () => {
  const PAGE = '<ytd-comments id="comments"><div id="inside">comments</div></ytd-comments>';

  it('blocks the comments by default', () => {
    document.body.innerHTML = PAGE;
    stop = startYouTubeEngagementControl(settingsWith('block-comment-posting'));
    expect(shown('comments')).toBe(false);
  });

  it('leaves them when a repair switches the family off (a selector that began hiding too much)', () => {
    document.body.innerHTML = PAGE;
    repair(2, { family: 'finder.youtube.comment-block', off: true });
    stop = startYouTubeEngagementControl(settingsWith('block-comment-posting'));
    expect(shown('comments')).toBe(true);
  });
});

describe('Facebook comment block: a new label is added to the sheet, with the gate on it', () => {
  it('carries the added selector and the private-chat and popup gates', () => {
    repair(3, { family: 'finder.facebook.comment-block', add: ['[aria-label*="Kommentarfeld" i]'] });
    const css = blockCommentInputCSS();
    expect(css).toContain('[aria-label*="Kommentarfeld" i]:not(:is(');
    ensureStyleTag('fw-test-sheet', css);
    document.body.innerHTML = '<div id="a" aria-label="Kommentarfeld"></div><div role="menu"><div id="b" aria-label="Kommentarfeld"></div></div>';
    expect(shown('a')).toBe(false);
    expect(shown('b')).toBe(true);
  });

  it('does not carry a selector that is too broad', () => {
    repair(3, { family: 'finder.facebook.comment-block', add: ['div', '*', '.x'] });
    const css = blockCommentInputCSS();
    expect(css).not.toMatch(/(^|,\s*)div:not/);
    expect(css).not.toMatch(/(^|,\s*)\*:not\(:is/);
  });
});

describe('ad labels: a language the list lacked', () => {
  it('is an ad label once a repair adds it, and only whole-label matches', () => {
    expect(isAdLabelText('Reklame')).toBe(false);
    repair(4, { family: 'finder.ads.label-words', add: ['Reklame'] });
    expect(isAdLabelText('Reklame')).toBe(true);
    expect(isAdLabelText('Reklame ·')).toBe(true);
    expect(isAdLabelText('this is not Reklame at all')).toBe(false);
    expect(isAdLabelText('Sponsored')).toBe(true);
  });

  it('is gone again when the repair is cleared', () => {
    repair(4, { family: 'finder.ads.label-words', add: ['Reklame'] });
    expect(isAdLabelText('Reklame')).toBe(true);
    applyRepairFile(null);
    expect(isAdLabelText('Reklame')).toBe(false);
  });
});
