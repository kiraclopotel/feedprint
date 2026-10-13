// @vitest-environment jsdom
//
// "Hide like, comment and share counts" hides the counts and only the counts (the Tester's recheck, 12 Oct 2026). It hid the whole
// comments header, so the sort menu and, on layouts that put the comment box in the header, the box went with the count, on 2 of 3
// fresh loads; and after "Block comment posting" was turned off the box stayed hidden, because the count's `visibility: hidden` on
// the header reaches every child. The count is hidden by its own element now; the box belongs to Block comment posting alone.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/content/engagement/selector-family-miss', () => ({ noteSelectorFamilySweep: vi.fn() }));
vi.mock('../../../../src/content/post-path/raf-observer', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../src/content/post-path/raf-observer')>()),
  createRafBodyObserver: vi.fn(() => ({ cleanup: () => {} })),
}));

import { startYouTubeEngagementControl } from '../../../../src/content/engagement/youtube-engagement';
import type { FWSettings } from '../../../../src/storage/settings';

const settings = (...on: string[]): FWSettings => ({
  features: Object.fromEntries(on.map((id) => [id, { enabled: true }])),
} as unknown as FWSettings);

/** Hidden by any of Off's YouTube markers, on the element itself. */
const marked = (id: string): boolean => {
  const el = document.getElementById(id)!;
  return el.hasAttribute('data-fw-yt-metric') || el.hasAttribute('data-fw-yt-comment-block') || el.hasAttribute('data-fw-yt-action');
};
/** What the person sees: an inline hide on the element or on an ancestor (jsdom has no stylesheet engine for the page's rules). */
const looksHidden = (id: string): boolean => {
  for (let el: HTMLElement | null = document.getElementById(id); el; el = el.parentElement) {
    if (el.style.visibility === 'hidden' || el.style.display === 'none') return true;
  }
  return false;
};

const WATCH = `<ytd-comments id="comments">
  <ytd-comments-header-renderer id="header">
    <div id="title">
      <h2 id="count" class="count-text"><yt-formatted-string id="counttext">12 Comments</yt-formatted-string></h2>
      <span id="sort-menu">Sort by</span>
    </div>
    <ytd-comment-simplebox-renderer id="box">Add a comment</ytd-comment-simplebox-renderer>
  </ytd-comments-header-renderer>
  <ytd-comment-thread-renderer id="thread">A comment <span id="likes">3</span></ytd-comment-thread-renderer>
</ytd-comments>`;

let cleanup: (() => void) | null = null;
beforeEach(() => { vi.useFakeTimers(); history.replaceState({}, '', '/watch'); document.body.innerHTML = WATCH; });
afterEach(() => { cleanup?.(); cleanup = null; vi.useRealTimers(); document.body.innerHTML = ''; });

describe('Hide counts on the comments', () => {
  it('hides the comment count and leaves the header, the sort menu and the box', () => {
    cleanup = startYouTubeEngagementControl(settings('hide-engagement-metrics'));
    expect(looksHidden('count')).toBe(true);
    for (const id of ['header', 'title', 'sort-menu', 'box', 'thread']) {
      expect(marked(id), id + ' marked').toBe(false);
      expect(looksHidden(id), id + ' hidden').toBe(false);
    }
  });

  it('does not touch the comment box while Block comment posting is off, however many times it sweeps', () => {
    cleanup = startYouTubeEngagementControl(settings('hide-engagement-metrics'));
    vi.advanceTimersByTime(5000);
    expect(looksHidden('box')).toBe(false);
  });
});

describe('Block comment posting alone owns the box', () => {
  it('both on: the box goes by Block comment posting, the count by Hide counts, the sort menu stays', () => {
    cleanup = startYouTubeEngagementControl(settings('hide-engagement-metrics', 'block-comment-posting'));
    expect(looksHidden('box')).toBe(true);
    expect(looksHidden('count')).toBe(true);
    expect(looksHidden('sort-menu')).toBe(false);
  });

  it('turning Block comment posting off brings the box back while the count stays hidden', () => {
    cleanup = startYouTubeEngagementControl(settings('hide-engagement-metrics', 'block-comment-posting'));
    expect(looksHidden('box')).toBe(true);
    // Off restarts the control with the new switches: the old one cleans up, the new one sweeps.
    cleanup();
    cleanup = startYouTubeEngagementControl(settings('hide-engagement-metrics'));
    expect(looksHidden('box')).toBe(false);
    expect(looksHidden('count')).toBe(true);
  });

  it('turning Hide counts off brings the count back while the box stays blocked', () => {
    cleanup = startYouTubeEngagementControl(settings('hide-engagement-metrics', 'block-comment-posting'));
    cleanup();
    cleanup = startYouTubeEngagementControl(settings('block-comment-posting'));
    expect(looksHidden('count')).toBe(false);
    expect(looksHidden('box')).toBe(true);
  });
});
