// @vitest-environment jsdom
//
// Off's word filter hides a TikTok For-You card that a word of the household's list matches. The card keeps its box
// (video-feed-hide.ts keepsItemBox; the owner's report of 13 Oct 2026, and the model in
// protection/a-hidden-tiktok-card-keeps-its-place-in-the-column.test.ts): hidden by visibility, display untouched, so the
// column that snaps card by card keeps the height it had.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startWordFilter, WORD_FILTER_HIDDEN_MARKER, WORD_FILTER_STYLE_TAG_ID } from '../../../../src/content/engagement/word-filter';
import { adultPreset } from '../../../../src/storage/presets';
import type { FWSettings, FeatureToggles } from '../../../../src/storage/settings';

vi.mock('../../../../src/storage/settings', async (io) => ({ ...(await io<object>()), incrementMetricsHidden: vi.fn(() => Promise.resolve()) }));

const settingsWith = (words: string[]): FWSettings => {
  const features: FeatureToggles = adultPreset();
  features['parent-blocklist'] = { enabled: true, value: { words, phrases: [], accounts: [] } };
  return { mode: 'adult', strictLanguage: false, features, uiLanguage: 'auto' } as unknown as FWSettings;
};

function card(caption: string): HTMLElement {
  const item = document.createElement('div');
  item.setAttribute('data-e2e', 'recommend-list-item-container');
  const desc = document.createElement('div');
  desc.setAttribute('data-e2e', 'video-desc');
  desc.textContent = caption;
  item.append(desc, document.createElement('video'));
  return item;
}

let stop: (() => void) | null = null;
beforeEach(() => { document.body.innerHTML = ''; });
afterEach(() => {
  stop?.();
  stop = null;
  document.body.innerHTML = '';
  document.getElementById(WORD_FILTER_STYLE_TAG_ID)?.remove();
});

describe("Off's word filter on TikTok's For-You column", () => {
  it('a card a word of the list hides keeps its box; its neighbours are untouched', () => {
    const column = document.createElement('div');
    const before = card('a calm video');
    const hit = card('my diet starts today');
    const after = card('another calm video');
    column.append(before, hit, after);
    document.body.appendChild(column);
    stop = startWordFilter('tiktok', settingsWith(['diet']), { slurs: false });
    expect(hit.getAttribute(WORD_FILTER_HIDDEN_MARKER)).toBe('hidden');
    expect(hit.getAttribute('data-fw-hide-mode')).toBe('visibility');
    expect(hit.style.getPropertyValue('visibility')).toBe('hidden');
    expect(hit.style.getPropertyValue('display'), 'the card keeps its box').toBe('');
    expect(before.hasAttribute(WORD_FILTER_HIDDEN_MARKER)).toBe(false);
    expect(after.hasAttribute(WORD_FILTER_HIDDEN_MARKER)).toBe(false);
  });
});
