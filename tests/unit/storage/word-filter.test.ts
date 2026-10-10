// @vitest-environment jsdom
//
// The Off word filter: the user's list, slurs and swearing applied straight
// to the page. Rule order and the hide boundary are the contract.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  decideHide,
  startWordFilter,
  wordFilterPolicy,
  WORD_FILTER_HIDDEN_MARKER,
} from '../../../src/content/engagement/word-filter';
import {
  FWSettings,
  FeatureToggles,
  CURRENT_SETTINGS_SCHEMA_VERSION,
  incrementMetricsHidden,
} from '../../../src/storage/settings';
import { __flushHiddenCountForTest } from '../../../src/content/engagement/mark-hidden';
import { adultPreset, childPreset } from '../../../src/storage/presets';

vi.mock('../../../src/storage/settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/storage/settings')>();
  return { ...actual, incrementMetricsHidden: vi.fn(() => Promise.resolve()) };
});

function makeSettings(mode: 'child' | 'teen' | 'adult', features: FeatureToggles, strictLanguage = false): FWSettings {
  return {
    settingsSchemaVersion: CURRENT_SETTINGS_SCHEMA_VERSION,
    mode,
    strictLanguage, hideUnrewritable: false, aiAnalysisEnabled: true,
    parentPin: '', dailyCap: 5000, monthlyUsdCapOverride: null, locale: 'en',
    outputLanguage: 'auto', uiLanguage: 'auto',
    totalChecksToday: 0, totalNeutralizedToday: 0, totalTokensToday: 0,
    estimatedCostToday: 0, lastResetDate: '',
    totalChecksThisMonth: 0, totalTokensThisMonth: 0, lastResetMonth: '',
    totalTokensAllTime: 0, totalChecksAllTime: 0,
    totalNeutralizedAllTime: 0, estimatedCostAllTime: 0,
    features,
    presets: { appliedAt: '', appliedPreset: mode },
    dashboardTheme: 'dark',
  };
}

function withList(features: FeatureToggles, words: string[], accounts: string[] = []): FeatureToggles {
  features['parent-blocklist'] = { enabled: true, value: { words, phrases: [], accounts } };
  return features;
}

function tweet(text: string, handle = 'someone'): HTMLElement {
  const article = document.createElement('article');
  article.setAttribute('data-testid', 'tweet');
  article.innerHTML =
    `<div data-testid="User-Name"><a href="/${handle}">${handle}</a></div>` +
    `<div data-testid="tweetText" lang="en">${text}</div>` +
    `<video></video>`;
  document.body.appendChild(article);
  return article;
}

describe('decideHide — rule order', () => {
  const policy = wordFilterPolicy(makeSettings('adult', withList(adultPreset(), ['diet'], ['troll'])));

  it('the user account rule wins before anything else', () => {
    expect(decideHide('a kind message', 'troll', policy)).toBe('account');
  });
  it('a listed word hides, whole words only', () => {
    expect(decideHide('my diet starts tomorrow', undefined, policy)).toBe('word');
    expect(decideHide('dietary advice', undefined, policy)).toBeNull();
  });
  it('a slur hides in adult mode with no list at all', () => {
    const empty = wordFilterPolicy(makeSettings('adult', adultPreset()));
    expect(decideHide('you absolute retard', undefined, empty)).toBe('slur');
  });
  it('ordinary swearing does not hide', () => {
    expect(decideHide('this is fucking great', undefined, policy)).toBeNull();
  });
});

describe('startWordFilter — on the page', () => {
  let cleanup: (() => void) | null = null;
  beforeEach(() => { document.body.innerHTML = ''; });
  afterEach(() => { cleanup?.(); cleanup = null; document.body.innerHTML = ''; });

  it('hides the tweet that matches the list and mutes its video', () => {
    const hit = tweet('my diet starts tomorrow');
    const miss = tweet('good morning everyone');
    cleanup = startWordFilter('twitter', makeSettings('adult', withList(adultPreset(), ['diet'])));
    expect(hit.getAttribute(WORD_FILTER_HIDDEN_MARKER)).toBe('hidden');
    expect(hit.style.display).toBe('none');
    expect(hit.querySelector('video')!.muted).toBe(true);
    expect(miss.hasAttribute(WORD_FILTER_HIDDEN_MARKER)).toBe(false);
  });

  it('on Instagram a hidden post keeps its box: visibility, never display, or the windowed feed stops loading (M135)', () => {
    document.body.innerHTML =
      '<main><article id="hit"><span dir="auto">my diet starts tomorrow</span></article>' +
      '<article id="miss"><span dir="auto">good morning everyone</span></article></main>';
    cleanup = startWordFilter('instagram', makeSettings('adult', withList(adultPreset(), ['diet'])));
    const hit = document.getElementById('hit')!;
    expect(hit.getAttribute(WORD_FILTER_HIDDEN_MARKER)).toBe('hidden');
    expect(hit.getAttribute('data-fw-hide-mode')).toBe('visibility');
    expect(hit.style.visibility).toBe('hidden');
    expect(hit.style.display).toBe('');
    expect(document.getElementById('miss')!.hasAttribute(WORD_FILTER_HIDDEN_MARKER)).toBe(false);
    cleanup();
    cleanup = null;
    expect(hit.style.visibility).toBe('');
    expect(hit.hasAttribute('data-fw-hide-mode')).toBe(false);
  });

  it('hides by account handle read from the profile link', () => {
    const hit = tweet('a kind message', 'troll');
    cleanup = startWordFilter('twitter', makeSettings('adult', withList(adultPreset(), [], ['@troll'])));
    expect(hit.getAttribute('data-fw-block-reason')).toBe('word-filter:account');
  });

  it('stars swearing in child mode and leaves it alone in adult mode', () => {
    const el = tweet('this is fucking great');
    cleanup = startWordFilter('twitter', makeSettings('adult', adultPreset()));
    expect(el.querySelector('[data-testid="tweetText"]')!.textContent).toBe('this is fucking great');
    cleanup();
    cleanup = startWordFilter('twitter', makeSettings('child', childPreset()));
    expect(el.querySelector('[data-testid="tweetText"]')!.textContent).not.toContain('fucking');
    expect(el.hasAttribute(WORD_FILTER_HIDDEN_MARKER)).toBe(false);
  });

  it('"no swearing" stars in adult mode too', () => {
    const el = tweet('what the hell is this shit');
    cleanup = startWordFilter('twitter', makeSettings('adult', adultPreset(), true));
    expect(el.querySelector('[data-testid="tweetText"]')!.textContent).not.toContain('shit');
  });

  it('stars the typed evasions the owner saw slip (dafuq, fkn)', () => {
    const el = tweet('dafuq is this fkn nonsense');
    cleanup = startWordFilter('twitter', makeSettings('adult', adultPreset(), true));
    expect(el.querySelector('[data-testid="tweetText"]')!.textContent).toBe('***** is this *** nonsense');
  });

  it('tallies starred words under no-swearing without moving the hidden total, and slurs on their own line', () => {
    vi.mocked(incrementMetricsHidden).mockClear();
    __flushHiddenCountForTest();
    tweet('this shit is fucking loud');
    tweet('you retard');
    cleanup = startWordFilter('twitter', makeSettings('adult', adultPreset(), true));
    __flushHiddenCountForTest();
    expect(incrementMetricsHidden).toHaveBeenCalledWith(1, { 'no-swearing': 2, slurs: 1 });
  });

  it('on X a hidden post takes its timeline cell with it, so no empty stripe is left', () => {
    const cell = document.createElement('div');
    cell.setAttribute('data-testid', 'cellInnerDiv');
    document.body.appendChild(cell);
    cell.appendChild(tweet('my diet starts tomorrow'));
    cleanup = startWordFilter('twitter', makeSettings('adult', withList(adultPreset(), ['diet'])));
    expect(cell.style.display).toBe('none');
    expect(cell.getAttribute('data-fw-word-filter')).toBe('hidden');
  });

  it('a TikTok comment hides as one box, name and picture included, and its account rule reads the username beside the text', () => {
    document.body.innerHTML =
      '<div class="item"><a data-e2e="comment-avatar-1"><img></a><div><a data-e2e="comment-username-1" href="/@troll">troll</a>' +
      '<p data-e2e="comment-level-1">nice weather</p></div></div>' +
      '<div class="item"><a data-e2e="comment-avatar-1"><img></a><div><a data-e2e="comment-username-1" href="/@friend">friend</a>' +
      '<p data-e2e="comment-level-1">hello</p></div></div>';
    cleanup = startWordFilter('tiktok', makeSettings('adult', withList(adultPreset(), [], ['troll'])));
    const items = document.querySelectorAll<HTMLElement>('.item');
    expect(items[0].style.display).toBe('none');
    expect(items[0].getAttribute('data-fw-word-filter')).toBe('hidden');
    expect(items[1].style.display).toBe('');
  });

  it('reads a YouTube home-grid title through the lockup shape (owner\'s live tab, 2026-09-03)', () => {
    // The 2026 home grid: yt-lockup-view-model tiles, the title h3 > a > span
    // inside yt-lockup-metadata-view-model; #video-title matches nothing.
    document.body.innerHTML =
      '<ytd-rich-item-renderer><yt-lockup-view-model><yt-lockup-metadata-view-model>' +
      '<h3 title="My diet week"><a href="/watch?v=1"><span dir="auto" role="text">My diet week</span></a></h3>' +
      '<yt-content-metadata-view-model><span>70K views</span></yt-content-metadata-view-model>' +
      '</yt-lockup-metadata-view-model></yt-lockup-view-model></ytd-rich-item-renderer>' +
      '<ytd-rich-item-renderer><yt-lockup-view-model><yt-lockup-metadata-view-model>' +
      '<h3><a href="/watch?v=2"><span>Sourdough basics</span></a></h3>' +
      '</yt-lockup-metadata-view-model></yt-lockup-view-model></ytd-rich-item-renderer>';
    cleanup = startWordFilter('youtube', makeSettings('adult', withList(adultPreset(), ['diet'])));
    const tiles = document.querySelectorAll('ytd-rich-item-renderer');
    expect(tiles[0].getAttribute('data-fw-word-filter')).toBe('hidden');
    expect(tiles[1].getAttribute('data-fw-word-filter')).toBeNull();
  });

  it('cleanup restores hidden posts', () => {
    const hit = tweet('my diet starts tomorrow');
    cleanup = startWordFilter('twitter', makeSettings('adult', withList(adultPreset(), ['diet'])));
    expect(hit.style.display).toBe('none');
    cleanup();
    cleanup = null;
    expect(hit.hasAttribute(WORD_FILTER_HIDDEN_MARKER)).toBe(false);
    expect(hit.style.display).toBe('');
  });

  it('never touches a chat log', () => {
    const log = document.createElement('div');
    log.setAttribute('role', 'log');
    log.innerHTML = '<article data-testid="tweet"><div data-testid="tweetText">my diet</div></article>';
    document.body.appendChild(log);
    cleanup = startWordFilter('twitter', makeSettings('adult', withList(adultPreset(), ['diet'])));
    expect(log.querySelector('article')!.hasAttribute(WORD_FILTER_HIDDEN_MARKER)).toBe(false);
  });
});


describe('startWordFilter — the card around the words (2026-09-07)', () => {
  let cleanup: (() => void) | null = null;
  beforeEach(() => { document.body.innerHTML = ''; });
  afterEach(() => { cleanup?.(); cleanup = null; document.body.innerHTML = ''; });

  it('hides the whole post when the quoted post is by a blocked account', () => {
    const article = document.createElement('article');
    article.setAttribute('data-testid', 'tweet');
    article.innerHTML =
      '<div data-testid="User-Name"><a href="/someone">someone</a></div>' +
      '<div data-testid="tweetText" lang="en">cannot believe he predicted it</div>' +
      '<article role="link"><div data-testid="User-Name"><a href="/troll">troll</a></div>' +
      '<div data-testid="tweetText" lang="en">the quoted words</div></article>';
    document.body.appendChild(article);
    cleanup = startWordFilter('twitter', makeSettings('adult', withList(adultPreset(), [], ['@troll'])));
    expect(article.getAttribute(WORD_FILTER_HIDDEN_MARKER)).toBe('hidden');
    expect(article.getAttribute('data-fw-block-reason')).toBe('word-filter:account');
  });

  it('hides on a "From" attribution naming a blocked account', () => {
    const article = document.createElement('article');
    article.setAttribute('data-testid', 'tweet');
    article.innerHTML =
      '<div data-testid="User-Name"><a href="/someone">someone</a></div>' +
      '<div data-testid="tweetText" lang="en">whatever they gave him that day</div>' +
      '<div data-testid="videoPlayer"><a href="/troll">From Troll Media</a></div>';
    document.body.appendChild(article);
    cleanup = startWordFilter('twitter', makeSettings('adult', withList(adultPreset(), [], ['@troll'])));
    expect(article.getAttribute(WORD_FILTER_HIDDEN_MARKER)).toBe('hidden');
  });
});
