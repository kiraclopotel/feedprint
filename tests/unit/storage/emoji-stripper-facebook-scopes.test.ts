// @vitest-environment jsdom
//
// The emoji stripper's Facebook scopes reach the current home feed (owner's
// live tab, 2026-09-03): posts are [aria-posinset] units whose role=article
// is an empty shell, the body is [data-ad-rendering-role="story_message"], and
// the right column carries ad text with emoji of its own.

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/storage/settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/storage/settings')>();
  return { ...actual, incrementMetricsHidden: vi.fn(() => Promise.resolve()) };
});

import { startEmojiStripper } from '../../../src/content/engagement/emoji-stripper';
import { adultPreset } from '../../../src/storage/presets';
import { CURRENT_SETTINGS_SCHEMA_VERSION, type FWSettings } from '../../../src/storage/settings';

function settings(): FWSettings {
  const features = adultPreset();
  features['strip-emojis'] = { enabled: true };
  return {
    settingsSchemaVersion: CURRENT_SETTINGS_SCHEMA_VERSION, mode: 'adult', strictLanguage: false,
    hideUnrewritable: false, aiAnalysisEnabled: false, parentPin: '', dailyCap: 0, monthlyUsdCapOverride: null,
    locale: 'en', outputLanguage: 'auto', uiLanguage: 'auto',
    totalChecksToday: 0, totalNeutralizedToday: 0, totalTokensToday: 0, estimatedCostToday: 0, lastResetDate: '',
    totalChecksThisMonth: 0, totalTokensThisMonth: 0, lastResetMonth: '', totalTokensAllTime: 0, totalChecksAllTime: 0,
    totalNeutralizedAllTime: 0, estimatedCostAllTime: 0, features, presets: { appliedAt: '', appliedPreset: 'adult' },
    dashboardTheme: 'dark',
  } as FWSettings;
}

let cleanup: (() => void) | null = null;
afterEach(() => { cleanup?.(); cleanup = null; document.body.innerHTML = ''; });

describe('emoji stripper: Facebook scopes on the current feed', () => {
  it('strips the story body inside an [aria-posinset] unit and the right column\'s ad text', () => {
    document.body.innerHTML = `
      <div aria-posinset="2"><div role="article" aria-label=""></div>
        <div data-ad-rendering-role="story_message"><div dir="auto">Great weekend 🎉🎉</div></div>
        <div dir="auto">See more 👇</div>
      </div>
      <div role="complementary"><div><h3><span>Sponsored</span></h3>
        <a href="https://l.facebook.com/x"><span dir="auto">🚨 OFERTĂ LIMITATĂ 🚨</span></a>
        <a href="https://l.facebook.com/y"><span>Terenuri Noi! 🎾</span></a></div></div>`;
    cleanup = startEmojiStripper('facebook', settings());
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/[🎉👇🚨🎾]/u);
    expect(text).toContain('Great weekend');
    expect(text).toContain('OFERTĂ LIMITATĂ');
    expect(text).toContain('Terenuri Noi!');
  });

  it('leaves the Messenger chat dock alone while stripping the feed beside it (owner, 2026-09-13)', () => {
    // The dock lives on the feed URL as a [role="dialog"] whose aria-label
    // names the conversation, in the interface language. Its rows carry the
    // same [dir="auto"] spans the feed scopes match, and X-style emoji images.
    document.body.innerHTML = `
      <div aria-posinset="1"><div role="article"></div>
        <div data-ad-rendering-role="story_message"><div dir="auto">Feed post 🎉</div></div>
      </div>
      <div role="complementary"><span dir="auto">Sponsored 🚨</span>
        <div role="dialog" aria-label="Conversație cu Ana Pop">
          <div role="article"><div dir="auto">chat one 😀</div></div>
          <div role="log"><div dir="auto">chat two 😂</div></div>
          <span dir="auto">chat three 🥲 <img alt="🔥" src="https://static.xx.fbcdn.net/images/emoji.php/v9/abs-1/fire.png" draggable="false"></span>
        </div>
      </div>`;
    cleanup = startEmojiStripper('facebook', settings());
    const dock = document.querySelector('[role="dialog"]')!;
    expect(dock.textContent).toContain('😀');
    expect(dock.textContent).toContain('😂');
    expect(dock.textContent).toContain('🥲');
    expect(dock.querySelector('img')!.hasAttribute('data-fw-emoji-hidden')).toBe(false);
    const feed = document.querySelector('[aria-posinset]')!.textContent ?? '';
    expect(feed).not.toContain('🎉');
    expect(document.querySelector('[role="complementary"] > span')!.textContent).not.toContain('🚨');
  });
});
