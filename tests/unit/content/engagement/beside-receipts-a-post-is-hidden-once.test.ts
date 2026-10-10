// @vitest-environment jsdom
//
// With both products on one page, Receipts and Off each hide a post that matches their own word rules.
// Whichever hides it first hides it alone: Off leaves a post Receipts hid, and Receipts records a post Off
// hid without hiding it again. A second hide would keep the post hidden after a click on Receipts' Show.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startWordFilter, WORD_FILTER_HIDDEN_MARKER, WORD_FILTER_STYLE_TAG_ID } from '../../../../src/content/engagement/word-filter';
import { injectAdHide, injectCollapseOrHide, injectHardHide } from '../../../../src/content/injector';
import type { AnalysisResult } from '../../../../src/types/analysis';
import type { FWSettings, FeatureToggles } from '../../../../src/storage/settings';
import { adultPreset } from '../../../../src/storage/presets';

vi.mock('../../../../src/storage/settings', async (io) => ({ ...(await io<object>()), incrementMetricsHidden: vi.fn(() => Promise.resolve()) }));

const settingsWith = (words: string[], accounts: string[] = []): FWSettings => {
  const features: FeatureToggles = adultPreset();
  features['parent-blocklist'] = { enabled: true, value: { words, phrases: [], accounts } };
  return { mode: 'adult', strictLanguage: false, features, uiLanguage: 'auto' } as unknown as FWSettings;
};
function tweet(text: string): HTMLElement {
  const cell = document.createElement('div');
  cell.setAttribute('data-testid', 'cellInnerDiv');
  cell.innerHTML = `<article data-testid="tweet"><div data-testid="User-Name"><a href="/someone">someone</a></div><div data-testid="tweetText" lang="en">${text}</div></article>`;
  document.body.appendChild(cell);
  return cell.querySelector('article') as HTMLElement;
}
const hiddenByReceipts = (el: HTMLElement): void => {
  el.setAttribute('data-fw-hard-hidden', 'true');
  el.style.display = 'none';
};

const offHid = (el: HTMLElement): boolean => el.closest(`[${WORD_FILTER_HIDDEN_MARKER}="hidden"]`) !== null;

let stop: (() => void) | null = null;
beforeEach(() => { document.body.innerHTML = ''; });
afterEach(() => { stop?.(); stop = null; document.body.innerHTML = ''; document.getElementById(WORD_FILTER_STYLE_TAG_ID)?.remove(); });

describe('a post both products would hide', () => {
  it('Off leaves a post Receipts already hid, and still hides one Receipts let through', () => {
    const hidden = tweet('my diet starts today');
    const text = hidden.querySelector('[data-testid="tweetText"]') as HTMLElement;
    expect(injectHardHide(text, 'twitter')).toBe(true);
    expect(hidden.closest('[data-fw-hard-hidden="true"]')).not.toBeNull();
    const shown = tweet('the diet again');
    stop = startWordFilter('twitter', settingsWith(['diet']), { slurs: false });
    expect(offHid(hidden)).toBe(false);
    expect(offHid(shown)).toBe(true);
  });

  it("Off leaves a post the person showed again with Receipts' Show", () => {
    const post = tweet('my diet starts today');
    post.setAttribute('data-fw-hard-hidden', 'true');
    post.setAttribute('data-fw-user-revealed', 'true');
    stop = startWordFilter('twitter', settingsWith(['diet']), { slurs: false });
    expect(offHid(post)).toBe(false);
    expect(post.style.display).toBe('');
  });

  it("Off still hides a reused box that carries Receipts' mark but no hide", () => {
    const post = tweet('my diet starts today');
    post.setAttribute('data-fw-hard-hidden', 'true');
    stop = startWordFilter('twitter', settingsWith(['diet']), { slurs: false });
    expect(offHid(post)).toBe(true);
  });

  it('Receipts records a post Off already hid, and leaves the hide to Off', () => {
    const post = tweet('my diet starts today');
    stop = startWordFilter('twitter', settingsWith(['diet']), { slurs: false });
    const text = post.querySelector('[data-testid="tweetText"]') as HTMLElement;
    const opts = { noticeText: 'FeelingWise hid this post', showLabel: 'show', hideLabel: 'hide' };
    expect(injectHardHide(text, 'twitter', opts), 'the caller records it as hidden').toBe(true);
    expect(document.querySelector('[data-fw-hard-hidden]')).toBeNull();
    expect(document.querySelector('[data-fw-hide-notice]'), 'no Show button that could not show it').toBeNull();
  });

  it("an ad that also matches Off's list: Receipts records it and leaves the hide to Off", () => {
    const ad = tweet('buy my diet pills');
    stop = startWordFilter('twitter', settingsWith(['diet']), { slurs: false });
    expect(offHid(ad)).toBe(true);
    const text = ad.querySelector('[data-testid="tweetText"]') as HTMLElement;
    expect(injectAdHide(text, 'twitter'), 'the caller records the ad').toBe(true);
    expect(document.querySelector('[data-fw-ad-hidden]')).toBeNull();
  });

  it('the same ad the other way round: Off leaves an ad Receipts hid', () => {
    const ad = tweet('buy my diet pills');
    const text = ad.querySelector('[data-testid="tweetText"]') as HTMLElement;
    expect(injectAdHide(text, 'twitter')).toBe(true);
    stop = startWordFilter('twitter', settingsWith(['diet']), { slurs: false });
    expect(offHid(ad)).toBe(false);
  });

  it('a post Off hid is not folded by Receipts too', () => {
    const post = tweet('my diet starts today');
    stop = startWordFilter('twitter', settingsWith(['diet']), { slurs: false });
    const text = post.querySelector('[data-testid="tweetText"]') as HTMLElement;
    const analysis = { techniques: [], explanation: '', confidence: 1 } as unknown as AnalysisResult;
    const before = document.body.innerHTML;
    for (const kind of ['collapse', 'hide'] as const) {
      expect(injectCollapseOrHide(text, analysis, kind, false, 'my diet starts today'), kind).toBe(true);
    }
    expect(document.body.innerHTML, 'the page is as Off left it').toBe(before);
  });

  it('when Off lets the post go, Receipts hides it itself, so the post it recorded is not left on the page', async () => {
    const post = tweet('my diet starts today');
    stop = startWordFilter('twitter', settingsWith(['diet']), { slurs: false });
    const text = post.querySelector('[data-testid="tweetText"]') as HTMLElement;
    const opts = { noticeText: 'FeelingWise hid this post', showLabel: 'show', hideLabel: 'hide' };
    expect(injectHardHide(text, 'twitter', opts)).toBe(true);
    expect(injectHardHide(text, 'twitter', opts), 'a rescan waits once').toBe(true);
    // The person took the word off Off's list: Off stops and lets the post go.
    stop(); stop = null;
    await Promise.resolve();
    expect(offHid(post)).toBe(false);
    expect(post.closest('[data-fw-hard-hidden="true"]'), "Receipts' own hide").not.toBeNull();
    expect(document.querySelectorAll('[data-fw-hide-notice]'), 'one Show button').toHaveLength(1);
  });

  it('Off leaves a post Receipts folded first, though its list names the account', () => {
    const post = tweet('my diet starts today');
    const text = post.querySelector('[data-testid="tweetText"]') as HTMLElement;
    const analysis = { techniques: [], explanation: '', confidence: 1 } as unknown as AnalysisResult;
    expect(injectCollapseOrHide(text, analysis, 'collapse', false, 'my diet starts today')).toBe(true);
    expect(text.getAttribute('data-fw-action')).toBe('collapse');
    stop = startWordFilter('twitter', settingsWith([], ['someone']), { slurs: false });
    expect(offHid(post)).toBe(false);
  });

  it('Off alone still hides that account, so the test above turns on the fold', () => {
    const post = tweet('my diet starts today');
    stop = startWordFilter('twitter', settingsWith([], ['someone']), { slurs: false });
    expect(offHid(post)).toBe(true);
  });

  it("when Off lets an ad go, Receipts' ad hide lands then", async () => {
    const ad = tweet('buy my diet pills');
    stop = startWordFilter('twitter', settingsWith(['diet']), { slurs: false });
    const text = ad.querySelector('[data-testid="tweetText"]') as HTMLElement;
    expect(injectAdHide(text, 'twitter')).toBe(true);
    expect(document.querySelector('[data-fw-ad-hidden]')).toBeNull();
    stop(); stop = null;
    await Promise.resolve();
    expect(offHid(ad)).toBe(false);
    expect(document.querySelectorAll('[data-fw-ad-hidden="true"]')).toHaveLength(1);
  });

  it("when Off lets a post go, Receipts' fold lands then", async () => {
    const post = tweet('my diet starts today');
    stop = startWordFilter('twitter', settingsWith(['diet']), { slurs: false });
    const text = post.querySelector('[data-testid="tweetText"]') as HTMLElement;
    const analysis = { techniques: [], explanation: '', confidence: 1 } as unknown as AnalysisResult;
    expect(injectCollapseOrHide(text, analysis, 'collapse', false, 'my diet starts today')).toBe(true);
    expect(text.hasAttribute('data-fw-action')).toBe(false);
    stop(); stop = null;
    await Promise.resolve();
    expect(offHid(post)).toBe(false);
    expect(text.getAttribute('data-fw-action')).toBe('collapse');
  });

  it('Off leaves a post inside a box Receipts already hid', () => {
    const post = tweet('my diet starts today');
    hiddenByReceipts(post.parentElement as HTMLElement);
    stop = startWordFilter('twitter', settingsWith(['diet']), { slurs: false });
    expect(offHid(post)).toBe(false);
  });
});
