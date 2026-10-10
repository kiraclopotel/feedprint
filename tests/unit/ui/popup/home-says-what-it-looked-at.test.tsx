/** @vitest-environment jsdom */
// HOME-LINE (SCOPE item 14, QUALITY R6). Home says what Receipts looked at today, in what the store really holds,
// and offers the key once. The sentence on what is not counted left Home on 8 Oct 2026 (his word: no sentence that
// explains what is absent); the tests below hold that it stays gone.
//
// The key line reuses strings all four languages already have; the count lines have their own in each.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';

import { HomeTab } from '../../../../src/ui/popup/Popup';
import { I18nProvider } from '../../../../src/i18n/react';
import { POPUP_STRINGS } from '../../../../src/i18n/popup-strings';
import * as settingsModule from '../../../../src/storage/settings';
import { type FWSettings, utcDayKey } from '../../../../src/storage/settings';
import { adultPreset, childPreset, teenPreset } from '../../../../src/storage/presets';
import { type LicenseInfo } from '../../../../src/storage/license';
import { ContentInterceptor } from '../../../../src/content/post-path/dom-interceptor';
import type { PlatformAdapter } from '../../../../src/content/platforms/adapter';
import type { PostContent } from '../../../../src/types/post';
import { installCounterChrome } from '../../../helpers/fake-counter-chrome';

vi.mock('../../../../src/ai/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/ai/client')>();
  return { ...actual, probeProxy: vi.fn(async () => 'ok') };
});

type Mode = 'child' | 'teen' | 'adult';
type ReadToday = NonNullable<FWSettings['readToday']>;

const en = POPUP_STRINGS.en;
const PAID: LicenseInfo = { tier: 'family', secret: 'abc' } as unknown as LicenseInfo;
const FREE: LicenseInfo = { tier: 'free', secret: '' } as unknown as LicenseInfo;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, '&#x27;').replace(/"/g, '&quot;');
const count = (html: string, s: string) => html.split(esc(s)).length - 1;
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

function settingsWith(mode: Mode, readToday?: ReadToday): FWSettings {
  return {
    settingsSchemaVersion: '14', mode, strictLanguage: false, hideUnrewritable: false,
    parentPin: '1234', dailyCap: 2000, monthlyUsdCapOverride: null, locale: 'en',
    outputLanguage: 'auto', uiLanguage: 'auto',
    totalChecksToday: 0, totalNeutralizedToday: 0, totalTokensToday: 0,
    estimatedCostToday: 0, lastResetDate: utcDayKey(),
    totalChecksThisMonth: 0, totalTokensThisMonth: 0, lastResetMonth: '',
    totalTokensAllTime: 0, totalChecksAllTime: 0,
    totalNeutralizedAllTime: 0, estimatedCostAllTime: 0,
    metricsHiddenToday: 0, metricsHiddenAllTime: 0,
    features: mode === 'child' ? childPreset() : mode === 'teen' ? teenPreset() : adultPreset(),
    presets: { appliedAt: '', appliedPreset: mode },
    dashboardTheme: 'dark', aiAnalysisEnabled: true,
    ...(readToday ? { readToday } : {}),
  } as unknown as FWSettings;
}

const home = (s: FWSettings, license: LicenseInfo = FREE) => renderToString(createElement(I18nProvider, {
  lang: 'en',
  children: createElement(HomeTab, {
    settings: s, license, probeResult: 'unknown', onOpenDashboard: () => {}, onOpenDashboardSection: () => {},
  }),
}));

const NOT_COUNTED = 'YouTube videos you watch and Shorts are not counted.';

describe('the count line is the stored count, through the real chain', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });
  afterEach(() => {
    document.body.innerHTML = '';
  });

  function pageWith(kinds: Array<PostContent['kind']>, platform: PlatformAdapter['platform']): PlatformAdapter {
    document.body.innerHTML = kinds.map((_, i) => `<div class="item" id="${platform}-${i}">text ${i}</div>`).join('');
    return {
      platform,
      detectPlatform: () => true,
      getPostSelector: () => '.item',
      extractPosts: () =>
        [...document.querySelectorAll<HTMLElement>('.item')]
          .filter((el) => el.dataset.fwProcessed !== 'true')
          .map((el) => {
            const i = Number(el.id.split('-')[1]);
            return {
              id: `${platform}-p-${i}`, text: `text ${i}`, author: '@a', timestamp: '2026-09-30T00:00:00Z', platform,
              domRef: new WeakRef(el), kind: kinds[i],
            } as PostContent;
          }),
    };
  }

  it('says posts (feed videos folded in) and comments, summed over platforms, in the hero number format', async () => {
    const fake = installCounterChrome({ lastResetDate: utcDayKey(), lastResetMonth: settingsModule.utcMonthKey() });
    const flush = (): Promise<void> => (settingsModule as unknown as { flushItemsRead: () => Promise<void> }).flushItemsRead();
    const kinds = (n: number, kind: PostContent['kind']) => Array.from({ length: n }, () => kind);
    // twitter: 1,100 posts and 30 comments; tiktok: 40 posts, 2 feed videos, 16 comments.
    for (const [kindsList, platform] of [
      [[...kinds(1100, 'post'), ...kinds(30, 'comment')], 'twitter'],
      [[...kinds(40, 'post'), ...kinds(2, 'video'), ...kinds(16, 'top-comment')], 'tiktok'],
    ] as Array<[Array<PostContent['kind']>, PlatformAdapter['platform']]>) {
      const interceptor = new ContentInterceptor(pageWith(kindsList, platform), vi.fn());
      interceptor.start();
      await flush();
      interceptor.stop();
    }
    const stored = fake.state.readToday as ReadToday;
    const html = home(settingsWith('teen', stored));
    // 1,100 + 40 + 2 = 1,142 posts; 30 + 16 = 46 comments.
    expect(text(html)).toContain('Feedprint looked at 1,142 posts and 46 comments today.');
    expect(html).not.toContain(esc(NOT_COUNTED));
  });
});

describe('the zero states', () => {
  const yesterday = '2000-01-01';
  const cases: Array<[string, ReadToday | undefined]> = [
    ['no key', undefined],
    ['a key holding only a date', { date: utcDayKey() }],
    ['yesterday\'s date', { date: yesterday, twitter: { posts: 9, comments: 9, videos: 9 } }],
    ['all-zero entries', { date: utcDayKey(), twitter: { posts: 0, comments: 0, videos: 0 } }],
  ];
  it.each(cases)('%s: "Nothing counted today." and nothing under it', (_name, rt) => {
    const html = home(settingsWith('teen', rt));
    expect(html).toContain(esc(en.homeReadNothing));
    expect(html).not.toContain(esc(NOT_COUNTED));
    expect(html).not.toMatch(/\b0 posts\b/);
    expect(html).not.toContain('looked at');
  });

  // One site (stage 3, 10 Oct 2026): the sentence names the site, from that site's own numbers, and stands alone.
  it('a single post and a single comment are singular; a kind at 0 is left out', () => {
    const one = home(settingsWith('teen', { date: utcDayKey(), twitter: { posts: 1, comments: 1, videos: 0 } }));
    expect(text(one)).toContain('Feedprint looked at 1 post and 1 comment today on X.');
    const onlyComments = home(settingsWith('teen', { date: utcDayKey(), twitter: { posts: 0, comments: 46, videos: 0 } }));
    expect(text(onlyComments)).toContain('Feedprint looked at 46 comments today on X.');
    expect(onlyComments).not.toMatch(/\b0 posts\b/);
  });
});

describe('the not-counted sentence and the words that are never used here', () => {
  it('is gone from Home in every state, and nothing says "not counted yet"', () => {
    for (const rt of [undefined, { date: utcDayKey(), twitter: { posts: 3, comments: 2, videos: 1 } }] as Array<ReadToday | undefined>) {
      for (const mode of ['child', 'teen', 'adult'] as Mode[]) {
        for (const license of [FREE, PAID]) {
          const html = home(settingsWith(mode, rt), license);
          expect(html, `${mode}`).not.toContain(esc(NOT_COUNTED));
          expect(html).not.toMatch(/not counted yet/i);
        }
      }
    }
  });

  it('never says "videos read", "videos watched" or "videos checked", and no digit stands beside "video"', () => {
    const html = text(home(settingsWith('teen', { date: utcDayKey(), twitter: { posts: 3, comments: 2, videos: 7 } })));
    expect(html).not.toMatch(/videos? (read|watched|checked)/i);
    expect(html).not.toMatch(/\d\s*videos?/i);
  });
});

describe('the key line: Home sells nothing', () => {
  it('a free install at Moderate and at Relaxed names no price, no plans page and no checkout', () => {
    for (const mode of ['teen', 'adult'] as Mode[]) {
      const html = home(settingsWith(mode));
      expect(html, mode).not.toContain('€');
      expect(html, mode).not.toContain('/pricing');
      expect(html).not.toContain('checkout');
      expect(html).not.toContain('lemonsqueezy');
    }
  });

  // Since 9 Oct 2026 (his word: a clean Home) a free install's Home says nothing about the key at all; the License
  // tab says the reading is optional.
  it('at Moderate and at Relaxed a free Home points nowhere about the key', () => {
    expect(home(settingsWith('teen'))).not.toContain('A license key in the License tab turns it on.');
    expect(home(settingsWith('adult'))).not.toMatch(/\bAI\b/);
  });
});

describe('the header is untouched', () => {
  it('the no-key status line is the same words', () => {
    // Since 9 Oct 2026 a free install shows no AI word, so the tooltip says only that there is no key.
    expect(en.statusFree).toBe('No key');
  });
});

describe('every language has its own count lines', () => {
  const langs = ['ro', 'es', 'pt-BR'] as const;
  it.each(langs)('%s: its own words, no em dash, nothing counted said plainly, no digit beside a video', (lang) => {
    const t = POPUP_STRINGS[lang];
    const fmt = (n: number) => String(n);
    for (const line of [t.homeReadCount(140, 46, fmt), t.homeReadCount(1, 0, fmt), t.homeReadCount(0, 1, fmt), t.homeReadNothing]) {
      expect(line).not.toContain('—');
      expect(line).not.toMatch(/\d\s*(video|vídeo)/i);
    }
    expect(t.homeReadCount(140, 46, fmt)).not.toBe(en.homeReadCount(140, 46, fmt));
    expect(t.homeReadNothing).not.toBe(en.homeReadNothing);
    expect(t.homeReadCount(140, 46, fmt)).toContain('140');
    expect(t.homeReadCount(140, 46, fmt)).toContain('46');
    expect(t.homeReadCount(0, 46, fmt)).not.toMatch(/\b0\b/);
  });

  it('Romanian puts "de" before 20 and more', () => {
    const fmt = (n: number) => String(n);
    expect(POPUP_STRINGS.ro.homeReadCount(140, 1, fmt)).toBe('Azi, Feedprint s-a uitat la 140 de postări și 1 comentariu.');
    expect(POPUP_STRINGS.ro.homeReadCount(3, 19, fmt)).toBe('Azi, Feedprint s-a uitat la 3 postări și 19 comentarii.');
  });

  it('at Moderate no language still points at the License tab in the sentence the price replaced', () => {
    for (const lang of langs) expect(POPUP_STRINGS[lang].statusFree).not.toMatch(/Licen/);
  });
});

// Stage 3 HOLD (10 Oct 2026): the branch for two or more sites, and the one-site sentence in every language.
describe('two or more sites: the sentence, a bar in rank tints, and a legend in the same order', () => {
  it('two sites: one bar segment and one legend key per site, largest first, ranks 0 and 1', () => {
    const today = utcDayKey();
    const html = home(settingsWith('teen', { date: today, instagram: { posts: 5, comments: 1 }, facebook: { posts: 24, comments: 9 } } as unknown as ReadToday));
    // 24 + 5 = 29 posts, 9 + 1 = 10 comments, summed over the two sites.
    expect(text(html)).toContain('Feedprint looked at 29 posts and 10 comments today.');
    expect(text(html)).not.toContain('today on ');
    expect(count(html, 'site-seg rank-0')).toBe(1);
    expect(count(html, 'site-seg rank-1')).toBe(1);
    expect(count(html, 'site-seg rank-2')).toBe(0);
    // Facebook 33 is larger than Instagram 6, so it comes first, in the bar and in the legend.
    expect(html.indexOf('Facebook 33')).toBeGreaterThan(-1);
    expect(html.indexOf('Facebook 33')).toBeLessThan(html.indexOf('Instagram 6'));
    expect(html).toContain('title="Facebook 33"');
    expect(html).toContain('title="Instagram 6"');
  });

  it('six sites: the fifth and sixth share the last tint', () => {
    const today = utcDayKey();
    const sites = { twitter: 60, facebook: 50, instagram: 40, tiktok: 30, youtube: 20, reddit: 10 } as const;
    const readToday = { date: today, ...Object.fromEntries(Object.entries(sites).map(([k, n]) => [k, { posts: n, comments: 0 }])) };
    const html = home(settingsWith('teen', readToday as unknown as ReadToday));
    const segs = (html.match(/site-seg rank-\d/g) ?? []);
    // Only the sites the popup has a name for are drawn; each rank appears in the order of size.
    expect(segs.length).toBeGreaterThanOrEqual(5);
    expect(segs.slice(0, 5)).toEqual(['site-seg rank-0', 'site-seg rank-1', 'site-seg rank-2', 'site-seg rank-3', 'site-seg rank-4']);
    for (const extra of segs.slice(5)) expect(extra).toBe('site-seg rank-4');
  });
});

describe('the one-site sentence names the site in every language', () => {
  const fmt = (n: number) => String(n);
  it.each([
    ['en', 'Feedprint looked at 24 posts and 9 comments today on Facebook.'],
    ['ro', 'Azi, Feedprint s-a uitat la 24 de postări și 9 comentarii pe Facebook.'],
    ['es', 'Hoy Feedprint miró 24 publicaciones y 9 comentarios en Facebook.'],
    ['pt-BR', 'Hoje o Feedprint viu 24 publicações e 9 comentários no Facebook.'],
  ] as const)('%s', (lang, sentence) => {
    expect(POPUP_STRINGS[lang].homeReadCount(24, 9, fmt, 'Facebook')).toBe(sentence);
  });
});
