/** @vitest-environment jsdom */
// F47 site C: a blocked TikTok card that is on screen must not leave the person on a black screen.
//
// The AI-content blocker hides a blocked card with visibility:hidden (never display:none: that made TikTok's own observer
// auto-advance in a loop) and, until now, never moved the feed. A person sitting on the blocked card saw a black screen with
// the feed stuck. The ad hide and the hard hide already move to the next card the person can see (video-feed-hide.ts); the
// blocker now takes the same step, once per hide, only when the blocked card was the one on screen.
//
// The real blocker is driven end to end over a TikTok feed (real container discovery, the real caption reader, the real hide
// door). Only the places the blocker reports to are stubbed.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/storage/settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/storage/settings')>();
  return { ...actual, incrementMetricsHidden: vi.fn(() => Promise.resolve()) };
});
vi.mock('../../../../src/content/engagement/recorder-sink', () => ({ recordBlocked: vi.fn() }));

import { startAiContentBlocker } from '../../../../src/content/engagement/ai-content-blocker';
import { CURRENT_SETTINGS_SCHEMA_VERSION, type FWSettings } from '../../../../src/storage/settings';
import { childPreset } from '../../../../src/storage/presets';
import { _resetAdvanceBreakerForTesting, RUN_NOTICE_ATTR } from '../../../../src/content/protection/video-feed-hide';

function settingsForChild(): FWSettings {
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
    features: childPreset(),
    presets: { appliedAt: '', appliedPreset: 'child' },
    dashboardTheme: 'dark',
  } as FWSettings;
}

const BLOCKED_CAPTION = 'so cute #aiart';
const CLEAN_CAPTION = 'a walk in the park';

/** One TikTok feed card: container > (caption, video, comment icon), as the platform renders it. */
function card(list: HTMLElement, caption: string): HTMLElement {
  const item = document.createElement('div');
  item.setAttribute('data-e2e', 'recommend-list-item-container');
  const desc = document.createElement('div');
  desc.setAttribute('data-e2e', 'video-desc');
  desc.textContent = caption;
  const video = document.createElement('video');
  const commentIcon = document.createElement('button');
  commentIcon.setAttribute('data-e2e', 'comment-icon');
  item.append(desc, video, commentIcon);
  list.appendChild(item);
  return item;
}

/** jsdom lays nothing out: a full-window box whose top is `top` (0 on screen, -H scrolled past, +H preloaded below). */
function placeAt(el: HTMLElement, top: number): void {
  const h = window.innerHeight;
  el.getBoundingClientRect = () =>
    ({ top, bottom: top + h, height: h, left: 0, right: 0, width: 0, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
}

function scrollSpy(el: HTMLElement): ReturnType<typeof vi.fn> {
  const fn = vi.fn();
  (el as unknown as { scrollIntoView: unknown }).scrollIntoView = fn;
  return fn;
}

let stop: () => void = () => {};

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '';
  _resetAdvanceBreakerForTesting();
});

afterEach(() => {
  stop();
  stop = () => {};
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('a blocked card on screen moves the feed on', () => {
  it('scrolls the next card into view, once, when the blocked card is the one on screen', () => {
    const list = document.createElement('div');
    document.body.appendChild(list);
    const blocked = card(list, BLOCKED_CAPTION);
    const next = card(list, CLEAN_CAPTION);
    placeAt(blocked, 0);
    placeAt(next, window.innerHeight);
    const scrolled = scrollSpy(next);

    stop = startAiContentBlocker('tiktok', settingsForChild());

    // The card is still hidden the way it was (kept box, no pointer events), and the person is moved off it.
    expect(blocked.getAttribute('data-fw-blocked')).toBe('ai-content');
    expect(blocked.style.getPropertyValue('visibility')).toBe('hidden');
    expect(blocked.style.getPropertyValue('display')).toBe('');
    expect(scrolled).toHaveBeenCalledTimes(1);
    expect(next.style.getPropertyValue('visibility')).toBe('');
  });

  it('does not scroll when the blocked card is one the person already scrolled past', () => {
    const list = document.createElement('div');
    document.body.appendChild(list);
    const past = card(list, BLOCKED_CAPTION);
    const watching = card(list, CLEAN_CAPTION);
    const below = card(list, CLEAN_CAPTION);
    placeAt(past, -window.innerHeight);
    placeAt(watching, 0);
    placeAt(below, window.innerHeight);
    const scrolledWatching = scrollSpy(watching);
    const scrolledBelow = scrollSpy(below);

    stop = startAiContentBlocker('tiktok', settingsForChild());

    expect(past.getAttribute('data-fw-blocked')).toBe('ai-content');
    expect(scrolledWatching).not.toHaveBeenCalled();
    expect(scrolledBelow).not.toHaveBeenCalled();
  });

  it('does not scroll when the blocked card is one the feed preloaded below the screen', () => {
    const list = document.createElement('div');
    document.body.appendChild(list);
    const watching = card(list, CLEAN_CAPTION);
    const preloaded = card(list, BLOCKED_CAPTION);
    const after = card(list, CLEAN_CAPTION);
    placeAt(watching, 0);
    placeAt(preloaded, window.innerHeight);
    placeAt(after, 2 * window.innerHeight);
    const scrolledAfter = scrollSpy(after);
    const scrolledPreloaded = scrollSpy(preloaded);

    stop = startAiContentBlocker('tiktok', settingsForChild());

    expect(preloaded.getAttribute('data-fw-blocked')).toBe('ai-content');
    expect(scrolledAfter).not.toHaveBeenCalled();
    expect(scrolledPreloaded).not.toHaveBeenCalled();
  });

  it('lands on the first card the filter did not block when two blocked cards come in a row', () => {
    const list = document.createElement('div');
    document.body.appendChild(list);
    const first = card(list, BLOCKED_CAPTION);
    const second = card(list, BLOCKED_CAPTION);
    const third = card(list, CLEAN_CAPTION);
    placeAt(first, 0);
    placeAt(second, window.innerHeight);
    placeAt(third, 2 * window.innerHeight);
    const scrolledSecond = scrollSpy(second);
    const scrolledThird = scrollSpy(third);

    stop = startAiContentBlocker('tiktok', settingsForChild());

    expect(first.getAttribute('data-fw-blocked')).toBe('ai-content');
    expect(second.getAttribute('data-fw-blocked')).toBe('ai-content');
    expect(scrolledSecond).not.toHaveBeenCalled();
    expect(scrolledThird).toHaveBeenCalledTimes(1);
  });

  it('says so, and scrolls nothing, when the blocked card on screen is the last one loaded', () => {
    const list = document.createElement('div');
    document.body.appendChild(list);
    const only = card(list, BLOCKED_CAPTION);
    placeAt(only, 0);

    stop = startAiContentBlocker('tiktok', settingsForChild());

    expect(only.getAttribute('data-fw-blocked')).toBe('ai-content');
    expect(document.querySelector(`[${RUN_NOTICE_ATTR}]`)).not.toBeNull();
  });

  it('does not scroll for a card the filter lets through', () => {
    const list = document.createElement('div');
    document.body.appendChild(list);
    const clean = card(list, CLEAN_CAPTION);
    const next = card(list, CLEAN_CAPTION);
    placeAt(clean, 0);
    placeAt(next, window.innerHeight);
    const scrolled = scrollSpy(next);

    stop = startAiContentBlocker('tiktok', settingsForChild());

    expect(clean.hasAttribute('data-fw-blocked')).toBe(false);
    expect(scrolled).not.toHaveBeenCalled();
  });
});
