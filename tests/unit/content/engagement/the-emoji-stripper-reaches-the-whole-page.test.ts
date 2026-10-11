// @vitest-environment jsdom
//
// "Strip emojis" reaches the whole page, not a list of places (11 Oct 2026, from the owner's report that emojis still
// showed with the switch on).
//
// The stripper worked inside a fixed list of selectors per site: a story body, a comment body, a right column. Any
// emoji drawn outside those places stayed: a name, a notification, a page title, a card, a label, a reply box that a
// site moved or renamed. Every time a site redraws its page the list is a little more wrong, and the switch then does
// nothing visible. The switch means "no emoji on my screen", so the rule is turned around: every text on the page is
// cleaned except the places that must never be touched (what the person types, a private conversation, FeelingWise's
// own words, code and styles). An emoji drawn as a picture is recognised by what it is, a small image whose alt text
// is an emoji, not by where its file comes from.

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/storage/settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/storage/settings')>();
  return { ...actual, incrementMetricsHidden: vi.fn(() => Promise.resolve()) };
});

import { startEmojiStripper } from '../../../../src/content/engagement/emoji-stripper';
import { adultPreset } from '../../../../src/storage/presets';
import { CURRENT_SETTINGS_SCHEMA_VERSION, type FWSettings } from '../../../../src/storage/settings';
import type { Platform } from '../../../../src/types/post';

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

const start = (platform: Platform): void => { cleanup = startEmojiStripper(platform, settings()); };
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

describe('text anywhere on the page is cleaned', () => {
  it('in places no list of selectors names, on each of the five sites', () => {
    for (const platform of ['facebook', 'instagram', 'youtube', 'tiktok', 'twitter'] as Platform[]) {
      document.body.innerHTML = `
        <header><h1>Home 🏠</h1></header>
        <div class="notification"><span>Jane liked your photo ❤️</span></div>
        <section><div><p>A card 🎉 with no role and no dir</p></div></section>
        <ul><li>Menu entry 🔔</li></ul>`;
      start(platform);
      const text = document.body.textContent ?? '';
      expect(text, platform).not.toMatch(EMOJI);
      expect(text).toContain('Home');
      expect(text).toContain('Jane liked your photo');
      expect(text).toContain('A card');
      expect(text).toContain('Menu entry');
      cleanup?.();
      cleanup = null;
    }
  });

  it('in text that arrives after the start', async () => {
    document.body.innerHTML = '<main id="m"></main>';
    start('facebook');
    const late = document.createElement('div');
    late.textContent = 'Arrived late 🚀';
    document.getElementById('m')!.appendChild(late);
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 30));
    expect(late.textContent).not.toMatch(EMOJI);
    expect(late.textContent).toContain('Arrived late');
  });
});

describe('an emoji drawn as a picture is recognised by what it is', () => {
  it('hides a small image whose alt is an emoji, whatever its file name', () => {
    document.body.innerHTML = `
      <div><span>Great <img id="a" alt="😂" src="https://static.example.net/images/x1.png" width="16" height="16"> day</span></div>
      <div><span>And <img id="b" alt="🔥" src="https://cdn.example.net/e/42.svg"> this</span></div>`;
    start('facebook');
    for (const id of ['a', 'b']) {
      const img = document.getElementById(id)!;
      expect(img.hasAttribute('data-fw-emoji-hidden'), id).toBe(true);
    }
  });

  it('leaves a picture that is not an emoji: an avatar with a name, a photo with no alt', () => {
    document.body.innerHTML = `
      <div><img id="avatar" alt="Jane Doe" src="https://cdn.example.net/a.jpg" width="16" height="16">
      <img id="photo" alt="" src="https://cdn.example.net/p.jpg" width="640" height="480">
      <img id="noalt" src="https://cdn.example.net/n.jpg" width="16" height="16"></div>`;
    start('facebook');
    for (const id of ['avatar', 'photo', 'noalt']) {
      expect(document.getElementById(id)!.hasAttribute('data-fw-emoji-hidden'), id).toBe(false);
    }
  });
});

describe('what must never be touched', () => {
  it('what the person types: a text box, a text area, an editable region', () => {
    document.body.innerHTML = `
      <div id="ce" contenteditable="true">typing 🙂</div>
      <div id="tb" role="textbox">typing 🙂</div>
      <textarea id="ta">typing 🙂</textarea>
      <input id="in" value="typing 🙂">
      <div>feed 🙂</div>`;
    start('facebook');
    expect(document.getElementById('ce')!.textContent).toContain('🙂');
    expect(document.getElementById('tb')!.textContent).toContain('🙂');
    expect(document.getElementById('ta')!.textContent).toContain('🙂');
    expect((document.getElementById('in') as HTMLInputElement).value).toContain('🙂');
    expect(document.body.textContent).toContain('feed');
  });

  it('a private conversation: the chat log and the chat dock', () => {
    document.body.innerHTML = `
      <div role="log"><div id="m1">hello 🙂</div></div>
      <div role="dialog" aria-label="Chat with Jane"><div id="m2">see you 🙂</div></div>
      <div id="feed">feed 🙂</div>`;
    start('facebook');
    expect(document.getElementById('m1')!.textContent).toContain('🙂');
    expect(document.getElementById('m2')!.textContent).toContain('🙂');
    expect(document.getElementById('feed')!.textContent).not.toMatch(EMOJI);
  });

  it('FeelingWise\'s own words, code and styles', () => {
    document.body.innerHTML = `
      <div data-fw-essential="true"><span id="own">Rewritten 🙂</span></div>
      <pre id="pre">const smile = "🙂";</pre>
      <style id="st">.x::before { content: "🙂"; }</style>
      <script id="sc" type="application/json">{"e":"🙂"}</script>`;
    start('facebook');
    expect(document.getElementById('own')!.textContent).toContain('🙂');
    expect(document.getElementById('pre')!.textContent).toContain('🙂');
    expect(document.getElementById('st')!.textContent).toContain('🙂');
    expect(document.getElementById('sc')!.textContent).toContain('🙂');
  });
});
