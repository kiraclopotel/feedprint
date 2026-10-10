// @vitest-environment jsdom
//
// Receipts hides slurs in every mode, and names them in its stamp. Off's word filter then leaves the slur
// rule to it, so a slur is hidden by one product; Off's own list keeps working on the same page. With no
// list, no starring and no slurs left to it, the filter has nothing to do and does not watch the page.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  decideHide, startWordFilter, wordFilterPolicy, WORD_FILTER_HIDDEN_MARKER, WORD_FILTER_STYLE_TAG_ID,
} from '../../../../src/content/engagement/word-filter';
import type { FWSettings, FeatureToggles } from '../../../../src/storage/settings';
import { adultPreset } from '../../../../src/storage/presets';

vi.mock('../../../../src/storage/settings', async (io) => ({ ...(await io<object>()), incrementMetricsHidden: vi.fn(() => Promise.resolve()) }));

const SLUR = 'you absolute retard';
const settingsWith = (words: string[] = []): FWSettings => {
  const features: FeatureToggles = adultPreset();
  features['parent-blocklist'] = { enabled: true, value: { words, phrases: [], accounts: [] } };
  return { mode: 'adult', strictLanguage: false, features, uiLanguage: 'auto' } as unknown as FWSettings;
};
function tweet(text: string): HTMLElement {
  const article = document.createElement('article');
  article.setAttribute('data-testid', 'tweet');
  article.innerHTML = `<div data-testid="User-Name"><a href="/someone">someone</a></div><div data-testid="tweetText" lang="en">${text}</div>`;
  document.body.appendChild(article);
  return article;
}

let stop: (() => void) | null = null;
beforeEach(() => { document.body.innerHTML = ''; });
afterEach(() => { stop?.(); stop = null; document.body.innerHTML = ''; document.getElementById(WORD_FILTER_STYLE_TAG_ID)?.remove(); });

describe('the slur rule beside Receipts', () => {
  it('alone, Off hides a slur', () => {
    expect(decideHide(SLUR, undefined, wordFilterPolicy(settingsWith()))).toBe('slur');
  });

  it('left to Receipts, Off does not hide it, and its own list still hides what it names', () => {
    const policy = wordFilterPolicy(settingsWith(['diet']), { slurs: false });
    expect(decideHide(SLUR, undefined, policy)).toBeNull();
    expect(decideHide('my diet starts today', undefined, policy)).toBe('word');
    const slur = tweet(SLUR);
    const listed = tweet('my diet starts today');
    stop = startWordFilter('twitter', settingsWith(['diet']), { slurs: false });
    expect(slur.hasAttribute(WORD_FILTER_HIDDEN_MARKER)).toBe(false);
    expect(listed.getAttribute(WORD_FILTER_HIDDEN_MARKER)).toBe('hidden');
  });

  it('with nothing left to do, it does not start', () => {
    tweet(SLUR);
    stop = startWordFilter('twitter', settingsWith(), { slurs: false });
    expect(document.getElementById(WORD_FILTER_STYLE_TAG_ID)).toBeNull();
  });
});
