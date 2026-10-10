/** @vitest-environment jsdom */
// "Something still showing? Tell us": one quiet line in Off's popup that opens an email to support,
// prefilled with the site, the kind of page, Off's version and the switches that are on. Nothing is
// sent unless the person sends the mail, and the mail never carries the page's address beyond the
// site's name: no path, no video id, no account, nothing from the page itself.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { OffBody, switchesOnFor } from '../../../../src/products/off/popup/OffPopup';
import { REPORT_ADDRESS, pageOf, reportMailto } from '../../../../src/ui/popup/report-link';
import { POPUP_STRINGS } from '../../../../src/i18n/popup-strings';
import { I18nProvider } from '../../../../src/i18n/react';
import { UI_LANGUAGES, type ResolvedUiLanguage } from '../../../../src/i18n';
import { adultPreset } from '../../../../src/storage/presets';
import type { FWSettings, FeatureId } from '../../../../src/storage/settings';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function settingsWith(...on: FeatureId[]): FWSettings {
  const features = adultPreset();
  for (const id of on) features[id] = { enabled: true };
  return {
    mode: 'adult', features, parentPin: '', strictLanguage: false, uiLanguage: 'en',
    outputLanguage: 'auto', locale: 'en', dashboardTheme: 'dark', hiddenByFeature: {},
  } as unknown as FWSettings;
}

const decode = (mailto: string) => {
  const [, query] = mailto.split('?');
  const params = new URLSearchParams(query);
  return { subject: params.get('subject') ?? '', body: params.get('body') ?? '' };
};

describe('the kind of page, read from the address and nothing else', () => {
  it.each([
    ['https://www.youtube.com/', 'youtube', 'home'],
    ['https://www.youtube.com/watch?v=abc123&list=PLsecret', 'youtube', 'watch'],
    ['https://www.youtube.com/shorts/abc123', 'youtube', 'reels'],
    ['https://m.youtube.com/results?search_query=private+words', 'youtube', 'other'],
    ['https://www.facebook.com/', 'facebook', 'feed'],
    ['https://www.facebook.com/reel/1234567890', 'facebook', 'reels'],
    ['https://www.facebook.com/watch/?v=1', 'facebook', 'watch'],
    ['https://www.facebook.com/some.person', 'facebook', 'other'],
    ['https://www.instagram.com/', 'instagram', 'feed'],
    ['https://www.instagram.com/reels/xyz/', 'instagram', 'reels'],
    ['https://x.com/home', 'twitter', 'feed'],
    ['https://twitter.com/someone/status/1', 'twitter', 'other'],
    ['https://www.tiktok.com/foryou', 'tiktok', 'feed'],
    ['https://www.tiktok.com/@someone/video/123', 'tiktok', 'watch'],
  ] as const)('%s is %s, %s', (url, site, kind) => {
    expect(pageOf(url)).toEqual({ site, kind });
  });

  it('knows no site and no kind off Off\'s sites, or when the browser gives no address', () => {
    expect(pageOf('https://example.com/watch?v=1')).toEqual({ site: null, kind: null });
    expect(pageOf('chrome://newtab/')).toEqual({ site: null, kind: null });
    expect(pageOf(undefined)).toEqual({ site: null, kind: null });
    expect(pageOf('not a url')).toEqual({ site: null, kind: null });
  });
});

describe('the prefilled email', () => {
  it('is addressed to support and carries the site, the page kind, the version and the switches on there', () => {
    const s = settingsWith('hide-recommended-videos', 'hide-engagement-metrics');
    const href = reportMailto({ site: 'youtube', kind: 'watch', version: '1.0.11', switchesOn: switchesOnFor(s, 'youtube') }, POPUP_STRINGS.en);
    expect(href.startsWith(`mailto:${REPORT_ADDRESS}?`)).toBe(true);
    const { subject, body } = decode(href);
    expect(subject).toBe('Off: something still showing on YouTube');
    expect(body).toContain('Site: YouTube');
    expect(body).toContain('Page: watch');
    expect(body).toContain('Off version: 1.0.11');
    expect(body).toContain('hide-recommended-videos');
    expect(body).toContain('hide-engagement-metrics');
    expect(body).toContain('block-ads');
    expect(body).not.toContain('hide-home-feed');
    expect(body).toContain('Nothing here is sent unless you send this email.');
  });

  it('counts a switch only where it is on: a switch turned off for this site is left out', () => {
    const s = settingsWith('hide-engagement-metrics');
    s.features['hide-engagement-metrics'] = { enabled: true, perPlatform: { youtube: { enabled: false } } };
    expect(switchesOnFor(s, 'youtube')).not.toContain('hide-engagement-metrics');
    expect(switchesOnFor(s, 'facebook')).toContain('hide-engagement-metrics');
  });

  it('leaves out a switch that does not act on the site, however it is set', () => {
    const s = settingsWith('hide-stories');
    expect(switchesOnFor(s, 'youtube')).not.toContain('hide-stories');
    expect(switchesOnFor(s, 'instagram')).toContain('hide-stories');
    expect(switchesOnFor(s, null)).toContain('hide-stories');
  });

  it('names "no swearing" when swearing is starred, since it is a switch in the popup too', () => {
    const s = settingsWith();
    s.strictLanguage = true;
    expect(switchesOnFor(s, 'youtube')).toContain('no-swearing');
  });

  it('says no site when the page is not one of Off\'s, and lists the switches on anywhere', () => {
    const s = settingsWith('hide-home-feed');
    const { subject, body } = decode(reportMailto({ site: null, kind: null, version: '1.0.11', switchesOn: switchesOnFor(s, null) }, POPUP_STRINGS.en));
    expect(subject).toBe('Off: something still showing');
    expect(body).toContain('Site: not one of Off\'s sites');
    expect(body).not.toContain('Page:');
    expect(body).toContain('hide-home-feed');
  });

  it.each(UI_LANGUAGES)('%s: has its own words, and the same facts', (lang) => {
    const t = POPUP_STRINGS[lang as ResolvedUiLanguage];
    const { subject, body } = decode(reportMailto({ site: 'youtube', kind: 'home', version: '1.0.11', switchesOn: ['hide-home-feed'] }, t));
    expect(subject).toContain('YouTube');
    expect(body).toContain('YouTube');
    expect(body).toContain('home');
    expect(body).toContain('1.0.11');
    expect(body).toContain('hide-home-feed');
    expect(t.offReportLead.length).toBeGreaterThan(0);
    expect(t.offReportLink.length).toBeGreaterThan(0);
    if (lang !== 'en') expect(t.offReportLead).not.toBe(POPUP_STRINGS.en.offReportLead);
  });
});

describe('the line in the popup', () => {
  let container: HTMLDivElement;
  let root: Root;
  let tabUrl: string | undefined;

  beforeEach(() => {
    tabUrl = 'https://www.youtube.com/watch?v=SECRETVIDEO&t=42';
    (globalThis as unknown as { chrome: unknown }).chrome = {
      storage: {
        local: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}), remove: vi.fn(async () => {}) },
        session: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}) },
        onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
      },
      tabs: { query: vi.fn(async () => [{ id: 7, url: tabUrl }]) },
      runtime: { sendMessage: vi.fn(async () => undefined), getManifest: () => ({ version: '1.0.11' }) },
    };
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => { root.unmount(); });
    container.remove();
  });

  async function render(s: FWSettings): Promise<void> {
    await act(async () => {
      root.render(createElement(I18nProvider, { lang: 'en', children: createElement(OffBody, { settings: s, reload: vi.fn(async () => {}) }) }));
    });
    await act(async () => { await Promise.resolve(); });
  }

  it('shows one quiet line whose link opens the prefilled email for the page in front', async () => {
    await render(settingsWith('hide-recommended-videos'));
    const link = Array.from(container.querySelectorAll('a')).find(a => a.textContent === 'Tell us') as HTMLAnchorElement;
    expect(link).toBeDefined();
    expect(link.closest('p')?.textContent).toBe('Something still showing? Tell us');
    const { body } = decode(link.getAttribute('href') ?? '');
    expect(body).toContain('Site: YouTube');
    expect(body).toContain('Page: watch');
    expect(body).toContain('Off version: 1.0.11');
    expect(body).toContain('hide-recommended-videos');
    // Nothing from the page's address beyond the site's name.
    expect(link.getAttribute('href')).not.toMatch(/SECRETVIDEO|t=42|watch%3Fv|youtube\.com/);
  });

  it('still offers the line when the browser gives no address, naming no site', async () => {
    tabUrl = undefined;
    await render(settingsWith());
    const link = Array.from(container.querySelectorAll('a')).find(a => a.textContent === 'Tell us') as HTMLAnchorElement;
    expect(decode(link.getAttribute('href') ?? '').body).toContain('Site: not one of Off\'s sites');
  });
});
