// @vitest-environment jsdom
//
// Off's two YouTube switches do what their words say (the Leader's decision of 12 Oct 2026, from the tester's finding 11 Oct).
//
// "Block comment posting" ("Disables writing comments.") took the whole comments pane with it, so a person could not read the
// comments either: now it takes the box a person types in and leaves the comments readable. "Hide action buttons" ("like /
// share / repost") took Subscribe, Join and Save with it: now those are left, because they are deliberate acts and not the
// reflex row. (The 9 Oct finding that Join stayed when Subscribe went is answered the other way: Subscribe stays, and Join with it.)

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

const hidden = (id: string): boolean => {
  const el = document.getElementById(id)!;
  return el.hasAttribute('data-fw-yt-action') || el.hasAttribute('data-fw-yt-comment-block');
};

const WATCH = `<ytd-watch-metadata>
  <div id="owner">
    <div id="sponsor-button"><ytd-button-renderer><button>Join</button></ytd-button-renderer></div>
    <ytd-subscribe-button-renderer id="subscribe"><button>Subscribe</button></ytd-subscribe-button-renderer>
  </div>
  <div id="actions">
    <ytd-menu-renderer class="ytd-watch-metadata" id="menu"><button id="save">Save</button></ytd-menu-renderer>
    <like-button-view-model id="like"></like-button-view-model>
    <dislike-button-view-model id="dislike"></dislike-button-view-model>
    <share-button-view-model id="share"></share-button-view-model>
  </div>
</ytd-watch-metadata>
<ytd-comments id="comments">
  <ytd-comments-header-renderer id="header"><span id="count">12 Comments</span>
    <ytd-comment-simplebox-renderer id="box">Add a comment</ytd-comment-simplebox-renderer>
  </ytd-comments-header-renderer>
  <ytd-comment-thread-renderer id="thread">A comment <ytd-comment-reply-dialog-renderer id="replybox"></ytd-comment-reply-dialog-renderer></ytd-comment-thread-renderer>
</ytd-comments>`;

let cleanup: (() => void) | null = null;
beforeEach(() => { vi.useFakeTimers(); history.replaceState({}, '', '/watch'); document.body.innerHTML = WATCH; });
afterEach(() => { cleanup?.(); cleanup = null; vi.useRealTimers(); document.body.innerHTML = ''; });

describe('Hide action buttons', () => {
  it('hides like, dislike and share, and leaves Subscribe, Join and Save', () => {
    cleanup = startYouTubeEngagementControl(settings('hide-action-buttons'));
    for (const id of ['like', 'dislike', 'share']) expect(hidden(id), id).toBe(true);
    for (const id of ['subscribe', 'sponsor-button', 'menu', 'save']) expect(hidden(id), id).toBe(false);
  });

  it('hides nothing when the switch is off', () => {
    cleanup = startYouTubeEngagementControl(settings());
    for (const id of ['like', 'share', 'subscribe', 'sponsor-button']) expect(hidden(id), id).toBe(false);
  });
});

describe('Block comment posting', () => {
  it('hides the box a person types in and the reply box, and leaves the comments, their count and the sort row readable', () => {
    cleanup = startYouTubeEngagementControl(settings('block-comment-posting'));
    expect(hidden('box')).toBe(true);
    expect(hidden('replybox')).toBe(true);
    for (const id of ['comments', 'header', 'count', 'thread']) expect(hidden(id), id).toBe(false);
  });

  it('hides nothing when the switch is off', () => {
    cleanup = startYouTubeEngagementControl(settings());
    expect(hidden('box')).toBe(false);
  });
});
