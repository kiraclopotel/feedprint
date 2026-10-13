/** @vitest-environment jsdom */
// Promise: cosmetic-hides-not-recorded (scripts/verify/promises.product.registry.mjs).
//
// The popup tells a user: "Counters and buttons hidden on the page today, counted one by one.
// Cosmetic hides are not saved as records." (src/i18n/popup/en.ts kpiMetricsHiddenTip). Hiding a
// like counter or a share button is a cosmetic act; hiding a post because it was judged is a
// decision, and src/content/engagement/recorder-sink.ts is the one door a judged hide (the AI
// content blocker, the ad blocker, the media timeout, the reels blocker) uses to hand its verdict
// to the recorder. A grep of src/content/engagement confirms none of the counter/button modules
// (facebook-engagement.ts, twitter-engagement.ts, instagram-engagement.ts, tiktok-engagement.ts,
// youtube-engagement.ts, section-model.ts, mark-hidden.ts) import recorder-sink at all. What that
// grep does not establish is runtime behavior: this test drives the real hiding path — real
// container discovery, real chip finder, no mocked DOM logic — over a fixture page carrying both
// primitives the promise names, and watches the two doors a hide would have to pass through to
// reach the chain:
//
//   - src/forensics/store.ts addRecord, "the" write onto the append-only chain per that file's own
//     docblock ("Append-only database. Records cannot be modified through the app.");
//   - chrome.runtime.sendMessage, the only way a content script reaches the background realm that
//     owns the chain (src/content/record/forensic-retry.ts sendHighStakesForensicLog).
//
// The popup's own counter (storage/settings incrementMetricsHidden, "counted one by one") is
// asserted to move in the same run, so a pass here is not "nothing happened" — it is "the hide
// happened, the counter moved, and the chain did not."
//
// Extended 2026-09-18 to close the promise's own named gap (its `stillOpen` text): the original
// test above drove Twitter only and left the other four platforms grepped, not driven, and left
// the "a future hide site calls addRecord or sendMessage directly" half entirely unchecked. Both
// close here, in the SAME file, because the promise's `check` command is a fixed path to this one
// file — a sibling file would not run under it. Facebook, Instagram, TikTok and YouTube each get a
// real-module drive below (structural-finder + section-model for the two Meta platforms,
// container-discovery for TikTok, plain element/class selectors for YouTube — whatever that
// platform's own engagement file actually uses, same standard as the Twitter test above). The
// bypass half is a static check over every file in src/content/engagement/, described where it
// lives further down.

import { readdirSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readSource } from '../../../helpers/read-source';
import { repoPath } from '../../../helpers/repo-root';

vi.mock('../../../../src/storage/settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/storage/settings')>();
  return { ...actual, incrementMetricsHidden: vi.fn(() => Promise.resolve()) };
});

// The chain's one write door, mocked rather than exercised for real — the same convention as
// tests/unit/forensics/logger-flagged-hidden.test.ts ("Mocks the forensic store ... so the test
// exercises ... without IDB"). Mocking it here makes a call to it unambiguous: nothing in this test
// file's own setup produces one, so any call recorded came from the hiding path under test.
vi.mock('../../../../src/forensics/store', () => ({
  addRecord: vi.fn(async () => undefined),
  getChainState: vi.fn(async () => ({ nextPosition: 0, prevRecordHash: 'genesis' })),
}));

import { startTwitterEngagementControl } from '../../../../src/content/engagement/twitter-engagement';
import { startFacebookEngagementControl } from '../../../../src/content/engagement/facebook-engagement';
import { startInstagramEngagementControl } from '../../../../src/content/engagement/instagram-engagement';
import { startTikTokEngagementControl } from '../../../../src/content/engagement/tiktok-engagement';
import { startYouTubeEngagementControl } from '../../../../src/content/engagement/youtube-engagement';
import {
  incrementMetricsHidden,
  CURRENT_SETTINGS_SCHEMA_VERSION,
  type FWSettings,
  type FeatureToggles,
} from '../../../../src/storage/settings';
import { childPreset } from '../../../../src/storage/presets';
import { addRecord } from '../../../../src/forensics/store';
import { __flushHiddenCountForTest } from '../../../../src/content/engagement/mark-hidden';

const mockedIncrement = vi.mocked(incrementMetricsHidden);
const mockedAddRecord = vi.mocked(addRecord);
const sendMessageSpy = vi.fn();

function settingsWith(features: FeatureToggles): FWSettings {
  return {
    settingsSchemaVersion: CURRENT_SETTINGS_SCHEMA_VERSION,
    mode: 'teen',
    strictLanguage: false, hideUnrewritable: false, aiAnalysisEnabled: true,
    parentPin: '', dailyCap: 5000, monthlyUsdCapOverride: null, locale: 'en',
    outputLanguage: 'auto', uiLanguage: 'auto',
    totalChecksToday: 0, totalNeutralizedToday: 0, totalTokensToday: 0,
    estimatedCostToday: 0, lastResetDate: '',
    totalChecksThisMonth: 0, totalTokensThisMonth: 0, lastResetMonth: '',
    totalTokensAllTime: 0, totalChecksAllTime: 0,
    totalNeutralizedAllTime: 0, estimatedCostAllTime: 0,
    features,
    presets: { appliedAt: '', appliedPreset: 'teen' },
    dashboardTheme: 'dark',
  } as FWSettings;
}

// A fixture shaped like a real tweet, carrying both engagement primitives the promise names: an
// action row (reply / retweet / like / bookmark buttons) and a like-count chip. Real selectors
// (container-discovery.ts's role="group" fast path, section-model.ts's leaf-numeric chip finder)
// find these — nothing here is a hand-picked shortcut for the test.
function fixture(): void {
  document.body.innerHTML = `
    <article data-testid="tweet">
      <div role="group">
        <button data-testid="reply">Reply</button>
        <button data-testid="retweet">Retweet</button>
        <button data-testid="like">Like</button>
        <button data-testid="bookmark">Bookmark</button>
      </div>
      <span>42 comments</span>
    </article>
  `;
}

// jsdom ships no IntersectionObserver at all (left undefined — see
// tests/unit/content/post-path/comment-batch-viewport-gate.test.ts). structural-finder.ts's
// startStructuralEngagementScan constructs one synchronously (ensureVisibilityObserver), so
// driving Facebook/Instagram with hide-action-buttons on — the only way to reach the real
// structural finder rather than mock it away, as every other test of these two starters does
// (tests/unit/storage/meta-engagement-start-gating.test.ts mocks the scanner out entirely) —
// needs the constructor to exist. This stub supplies the missing platform API only; it does not
// touch or mock any FeelingWise module. Found while extending this test, 2026-09-18.
class FakeIntersectionObserver {
  constructor(_cb: IntersectionObserverCallback, _opts?: IntersectionObserverInit) {}
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] { return []; }
}

beforeEach(() => {
  vi.useFakeTimers();
  mockedIncrement.mockClear();
  mockedAddRecord.mockClear();
  sendMessageSpy.mockClear();
  document.body.innerHTML = '';
  // jsdom lays out nothing; container-discovery's size guard needs a real-looking rect (mirrors
  // tests/unit/content/engagement/picker.test.ts's own override for the same reason).
  Element.prototype.getBoundingClientRect = () => ({
    width: 300, height: 50, left: 0, top: 0, right: 300, bottom: 50, x: 0, y: 0, toJSON: () => ({}),
  });
  (globalThis as { chrome?: unknown }).chrome = {
    runtime: { sendMessage: sendMessageSpy, id: 'test', getManifest: () => ({ version: '1.0' }) },
    storage: { local: { get: vi.fn(async () => ({})), set: vi.fn(async () => undefined) } },
  };
  (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = FakeIntersectionObserver;
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  delete (globalThis as { chrome?: unknown }).chrome;
  delete (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
});

describe('cosmetic-hides-not-recorded', () => {
  it('hides the action row and the count chip, moves the popup counter, and never touches the chain', () => {
    fixture();
    const settings = settingsWith(childPreset());

    const stop = startTwitterEngagementControl(settings);
    try {
      // The action row hides synchronously on start (trailingThrottle runs immediately the first
      // time). The chip scan's first pass is section-model.ts's setTimeout(scan, 50).
      vi.advanceTimersByTime(50);
      __flushHiddenCountForTest();

      const group = document.querySelector('[role="group"]') as HTMLElement;
      const chip = document.querySelector('span') as HTMLElement;

      // The cosmetic hide actually happened — this is not a test of a no-op.
      expect(group.dataset.fwActionRow).toBe('hidden');
      expect(chip.dataset.fwCountChip).toBe('true');

      // The popup's counter moved, tallied under both switches.
      expect(mockedIncrement).toHaveBeenCalledTimes(1);
      expect(mockedIncrement).toHaveBeenCalledWith(2, {
        'hide-action-buttons': 1,
        'hide-engagement-metrics': 1,
      });

      // The chain did not grow: no record was appended, and no message left this realm toward the
      // background realm that owns the chain.
      expect(mockedAddRecord).not.toHaveBeenCalled();
      expect(sendMessageSpy).not.toHaveBeenCalled();
    } finally {
      stop();
    }
  });
});

// ─── Facebook / Instagram ───────────────────────────────────────────────────
//
// Both platforms route hide-action-buttons through structural-finder.ts's tier-fusion scorer and
// hide-engagement-metrics through section-model.ts's chip finder (see facebook-engagement.ts /
// instagram-engagement.ts applyEngagementStyles + main entry). A button carrying an aria-label
// stem (Tier 1) plus its platform's own icon d-path prefix (Tier 2) clears the >=2-tier threshold
// on two real, independent signals — the same shape structural-finder.test.ts uses to prove a
// genuine engagement button gets tagged, not a hand-picked shortcut for this file.

function facebookFixture(): { button: HTMLElement; chip: HTMLElement } {
  const article = document.createElement('div');
  article.setAttribute('role', 'article');
  article.innerHTML = `
    <button aria-label="Like"><svg><path d="M6.235 21H3v-9h3.235V21z"></path></svg></button>
    <span>194 comentarii</span>
  `;
  document.body.appendChild(article);
  return {
    button: article.querySelector('button') as HTMLElement,
    chip: article.querySelector('span') as HTMLElement,
  };
}

function instagramFixture(): { button: HTMLElement; chip: HTMLElement } {
  const article = document.createElement('article');
  article.innerHTML = `
    <button aria-label="Like"><svg><path d="M16.792 3.904A4.989 4.989 0 0 1 21.5 9.122"></path></svg></button>
    <span>108</span>
  `;
  document.body.appendChild(article);
  return {
    button: article.querySelector('button') as HTMLElement,
    chip: article.querySelector('span') as HTMLElement,
  };
}

describe('cosmetic-hides-not-recorded — facebook', () => {
  it('hides the like button and the count chip, moves the popup counter, and never touches the chain', () => {
    const { button, chip } = facebookFixture();
    const stop = startFacebookEngagementControl(settingsWith(childPreset()));
    try {
      // structural-finder's and section-model's first passes are each a setTimeout(fn, 50)
      // (startStructuralEngagementScan / startCountChipScan).
      vi.advanceTimersByTime(50);
      __flushHiddenCountForTest();

      expect(button.dataset.fwEngagementBar).toBe('true');
      expect(button.style.getPropertyValue('display')).toBe('none');
      expect(chip.dataset.fwCountChip).toBe('true');

      expect(mockedIncrement).toHaveBeenCalled();
      expect(mockedAddRecord).not.toHaveBeenCalled();
      expect(sendMessageSpy).not.toHaveBeenCalled();
    } finally {
      stop();
    }
  });
});

describe('cosmetic-hides-not-recorded — instagram', () => {
  it('hides the like button and the count chip, moves the popup counter, and never touches the chain', () => {
    const { button, chip } = instagramFixture();
    const stop = startInstagramEngagementControl(settingsWith(childPreset()));
    try {
      vi.advanceTimersByTime(50);
      __flushHiddenCountForTest();

      expect(button.dataset.fwEngagementBar).toBe('true');
      expect(button.style.getPropertyValue('display')).toBe('none');
      expect(chip.dataset.fwCountChip).toBe('true');

      expect(mockedIncrement).toHaveBeenCalled();
      expect(mockedAddRecord).not.toHaveBeenCalled();
      expect(sendMessageSpy).not.toHaveBeenCalled();
    } finally {
      stop();
    }
  });
});

// ─── TikTok ──────────────────────────────────────────────────────────────────
//
// TikTok's action rail routes through container-discovery.ts, the same finder Twitter's action row
// uses, but the rail is a narrow vertical strip (width 30-120, height 100-600 —
// ACTION_RAIL_CONSTRAINTS in tiktok-engagement.ts) rather than Twitter's wide horizontal row, so
// the file-level 300x50 rect override does not satisfy it. The count chip is exercised separately
// via section-model, off the rail, mirroring an explore-tile view count.

function tiktokFixture(): { rail: HTMLElement; chip: HTMLElement } {
  const rail = document.createElement('div');
  rail.innerHTML = `
    <button data-e2e="like-icon">Like</button>
    <button data-e2e="comment-icon">Comment</button>
    <button data-e2e="share-icon">Share</button>
  `;
  rail.getBoundingClientRect = () => ({
    width: 80, height: 300, left: 0, top: 0, right: 80, bottom: 300, x: 0, y: 0, toJSON: () => ({}),
  });
  document.body.appendChild(rail);

  const chip = document.createElement('span');
  chip.textContent = '1.5M';
  document.body.appendChild(chip);

  return { rail, chip };
}

describe('cosmetic-hides-not-recorded — tiktok', () => {
  it('hides the action rail and the count chip, moves the popup counter, and never touches the chain', () => {
    const { rail, chip } = tiktokFixture();
    const stop = startTikTokEngagementControl(settingsWith(childPreset()));
    try {
      // controlActionRail runs synchronously on start (trailingThrottle's first call). The
      // section-model chip scan's first pass is its own setTimeout(scan, 50).
      vi.advanceTimersByTime(50);
      __flushHiddenCountForTest();

      expect(rail.dataset.fwActionRail).toBe('hidden');
      expect(chip.dataset.fwCountChip).toBe('true');

      expect(mockedIncrement).toHaveBeenCalled();
      expect(mockedAddRecord).not.toHaveBeenCalled();
      expect(sendMessageSpy).not.toHaveBeenCalled();
    } finally {
      stop();
    }
  });
});

// ─── YouTube ─────────────────────────────────────────────────────────────────
//
// YouTube's three controls (metrics / actions / comment-posting) walk plain element-name and id
// selectors (COUNT_SELECTORS / ACTION_SELECTORS / COMMENT_BLOCK_SELECTORS in
// youtube-engagement.ts) — no container-discovery, no structural-finder, so no rect or
// IntersectionObserver stand-in is needed.

function youtubeFixture(): { action: HTMLElement; metric: HTMLElement; commentBlock: HTMLElement } {
  document.body.innerHTML = `
    <like-button-view-model>
      <span class="ytSpecButtonShapeNextButtonTextContent">1.2K</span>
    </like-button-view-model>
    <ytd-video-view-count-renderer>1.2K views</ytd-video-view-count-renderer>
    <ytd-comment-simplebox-renderer>Add a comment</ytd-comment-simplebox-renderer>
  `;
  return {
    action: document.querySelector('like-button-view-model') as HTMLElement,
    metric: document.querySelector('ytd-video-view-count-renderer') as HTMLElement,
    commentBlock: document.querySelector('ytd-comment-simplebox-renderer') as HTMLElement,
  };
}

describe('cosmetic-hides-not-recorded — youtube', () => {
  it('hides the action button, the view-count metric and the comment box, moves the popup counter, and never touches the chain', () => {
    const { action, metric, commentBlock } = youtubeFixture();
    const stop = startYouTubeEngagementControl(settingsWith(childPreset()));
    try {
      // runAll() fires synchronously on start (trailingThrottle's first call runs immediately).
      __flushHiddenCountForTest();

      expect(action.dataset.fwYtAction).toBe('hidden');
      expect(metric.dataset.fwYtMetric).toBe('hidden');
      expect(commentBlock.dataset.fwYtCommentBlock).toBe('hidden');

      expect(mockedIncrement).toHaveBeenCalled();
      expect(mockedAddRecord).not.toHaveBeenCalled();
      expect(sendMessageSpy).not.toHaveBeenCalled();
    } finally {
      stop();
    }
  });
});

// ─── The bypass half ─────────────────────────────────────────────────────────
//
// The promise's own stillOpen text named the second gap: "A future hide site that calls addRecord
// or sendMessage directly, bypassing both, is outside what this test would catch." The five driven
// tests above prove today's five platform modules stay clean; none of them would notice a NEW
// module added to src/content/engagement/ that reached for the chain directly instead of going
// through markHidden (which never touches the chain at all — see mark-hidden.ts) or recorder-sink
// (the judged-hide door).
//
// This is a static, source-text check rather than a runtime drive: it reads every .ts file in
// src/content/engagement/ (enumerated from the directory, not a maintained list, so a file added
// later is picked up automatically) and asserts that only the judged sinks import
// recorder-sink, and that NOTHING in the directory imports forensics/store or calls
// sendMessage(...) directly. Written 2026-09-18.
//
// What this does NOT cover: a cosmetic hide added outside src/content/engagement/ (a new top-level
// module, a platform adapter file, a background-realm helper) is never read by this scan. It also
// only catches the textual shapes below — an import path built at runtime, a re-exported alias for
// sendMessage, or a call reached through another function's indirection would pass this check
// silently, the same limit docs/history's "a grep of the string tables misses strings assembled at
// run time" names for any source-text check.

const JUDGED_SINK_FILES = new Set([
  // The hides the promise does not cover: a decision (block/mute/timeout), not a cosmetic act.
  // Each hands its verdict to the recorder through recorder-sink.ts's recordBlocked/setBlockedRecorder.
  'ai-content-blocker.ts',
  'media-only-ad-blocker.ts',
  'media-timeout.ts',
  'reels-blocker.ts',
  // The right column's ad modules: Receipts records every ad it hides (order of 7 Oct 2026).
  'sidebar-ad-blocker.ts',
  // YouTube's ad slots the pipeline does not reach (search, the watch page's right column): Receipts hides and
  // records each one (tester 9 Oct 2026: 8 search ad slots, 0 hidden, at every level).
  'feed-ad-blocker.ts',
]);

describe('a cosmetic-hide module reaches the recorder only through recorder-sink', () => {
  it('no file in src/content/engagement/, outside the judged sinks, imports recorder-sink, imports forensics/store, or calls sendMessage(...) directly', () => {
    const dir = repoPath('src', 'content', 'engagement');
    const files = readdirSync(dir).filter((f) => f.endsWith('.ts'));
    expect(files.length).toBeGreaterThan(10); // sanity: the directory listing itself did something

    const offenders: string[] = [];
    for (const file of files) {
      const text = readSource(`src/content/engagement/${file}`);
      const isJudgedSink = JUDGED_SINK_FILES.has(file);

      const importsRecorderSink =
        !isJudgedSink && file !== 'recorder-sink.ts' && /from\s+['"][^'"]*recorder-sink['"]/.test(text);
      const importsForensicsStore = /from\s+['"][^'"]*forensics\/store['"]/.test(text);
      const callsSendMessage = /\bsendMessage\s*\(/.test(text);

      if (importsRecorderSink) offenders.push(`${file}: imports recorder-sink`);
      if (importsForensicsStore) offenders.push(`${file}: imports forensics/store`);
      if (callsSendMessage) offenders.push(`${file}: calls sendMessage(...) directly`);
    }

    expect(offenders).toEqual([]);
  });
});
