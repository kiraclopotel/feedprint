// @vitest-environment jsdom
//
// With both products installed, Off's "No swearing" and Receipts' swear mask both run (Off keeps swearing because
// Receipts' pipeline passes short texts before its mask). Both star with the same filter, so whichever reaches a post
// first, the person sees each word starred once and in the same way. When Off stars first, as it does before the
// page paints, Receipts reads text that is already starred: it finds nothing to mask, and its record holds no mask
// line for that post.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startWordFilter, WORD_FILTER_STYLE_TAG_ID } from '../../../../src/content/engagement/word-filter';
import { maskProfanity } from '../../../../src/core/profanity-filter';
import type { FWSettings, FeatureToggles } from '../../../../src/storage/settings';
import { adultPreset } from '../../../../src/storage/presets';

vi.mock('../../../../src/storage/settings', async (io) => ({ ...(await io<object>()), incrementMetricsHidden: vi.fn(() => Promise.resolve()) }));

const SWEARING = 'this is fucking great, what a shit day';
const offWithNoSwearing = (): FWSettings => {
  const features: FeatureToggles = adultPreset();
  features['parent-blocklist'] = { enabled: true, value: { words: [], phrases: [], accounts: [] } };
  return { mode: 'adult', strictLanguage: true, features, uiLanguage: 'auto' } as unknown as FWSettings;
};
function tweet(text: string): HTMLElement {
  const article = document.createElement('article');
  article.setAttribute('data-testid', 'tweet');
  article.innerHTML = `<div data-testid="User-Name"><a href="/someone">someone</a></div><div data-testid="tweetText" lang="en">${text}</div>`;
  document.body.appendChild(article);
  return article.querySelector('[data-testid="tweetText"]') as HTMLElement;
}
/** What Receipts' swear mask does with a post's text (analysis/pipeline.ts): the words it finds, and the text it shows. */
const receiptsOn = (text: string) => { const m = maskProfanity(text); return { found: m.matches.length > 0, masked: m.masked }; };

let stop: (() => void) | null = null;
beforeEach(() => { document.body.innerHTML = ''; });
afterEach(() => { stop?.(); stop = null; document.body.innerHTML = ''; document.getElementById(WORD_FILTER_STYLE_TAG_ID)?.remove(); });

describe('a swear word with both products installed', () => {
  it('Receipts alone would mask it', () => {
    const r = receiptsOn(SWEARING);
    expect(r.found).toBe(true);
    expect(r.masked).not.toBe(SWEARING);
  });

  it('Off first: starred once; Receipts finds nothing left to mask, so its record holds no mask line', () => {
    const text = tweet(SWEARING);
    stop = startWordFilter('twitter', offWithNoSwearing(), { slurs: true });
    const seen = text.textContent ?? '';
    expect(seen).not.toBe(SWEARING);
    expect(seen).not.toMatch(/fuck|shit/i);
    const r = receiptsOn(seen);
    expect(r.found).toBe(false);
    expect(r.masked, 'no second mask').toBe(seen);
  });

  it('Receipts first: Off stars nothing more, and the person sees what Off alone would show', () => {
    const offAlone = tweet(SWEARING);
    stop = startWordFilter('twitter', offWithNoSwearing(), { slurs: true });
    const offShows = offAlone.textContent ?? '';
    stop(); stop = null;
    document.body.innerHTML = '';

    const text = tweet(receiptsOn(SWEARING).masked);
    const receiptsShows = text.textContent ?? '';
    stop = startWordFilter('twitter', offWithNoSwearing(), { slurs: true });
    expect(text.textContent, 'no second star').toBe(receiptsShows);
    expect(receiptsShows, 'the same stars from either product').toBe(offShows);
  });
});
