/** @vitest-environment jsdom */
// The Off popup body: one tally line per switch from settings.hiddenByFeature,
// the rules line, and the interface-language row that writes uiLanguage.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';


import { OffBody, OFF_SITES, SWITCH_REACH, offSwitchIds } from '../../../src/products/off/popup/OffPopup';
import { POPUP_STRINGS } from '../../../src/i18n/popup-strings';
import { sharedSurfaceDetector } from '../../../src/content/post-path/surface-detector';
import '../../../src/content/engagement/reels-blocker';
import { TEXT_SCOPE_SELECTORS } from '../../../src/content/engagement/emoji-stripper';
import { readSource } from '../../helpers/read-source';
import { I18nProvider } from '../../../src/i18n/react';
import { UI_LANGUAGES, type ResolvedUiLanguage } from '../../../src/i18n';
import { adultPreset } from '../../../src/storage/presets';
import { surfaceRulesFor } from '../../../src/content/engagement/surface-switches';
import { YOUTUBE_FEED_FEATURES } from '../../../src/content/engagement/youtube-feeds';
import { CURRENT_SETTINGS_SCHEMA_VERSION, offStartSettings, utcDayKey, utcMonthKey } from '../../../src/storage/settings';
import type { FWSettings } from '../../../src/storage/settings';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let state: Record<string, unknown> = {};

function installStorageStub(): void {
  state = {
    settingsSchemaVersion: CURRENT_SETTINGS_SCHEMA_VERSION,
    lastResetDate: utcDayKey(),
    lastResetMonth: utcMonthKey(),
  };
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get: (keys: string | string[] | null) => {
          if (keys === null || keys === undefined) return Promise.resolve({ ...state });
          const arr = Array.isArray(keys) ? keys : [keys];
          const out: Record<string, unknown> = {};
          for (const k of arr) if (k in state) out[k] = state[k];
          return Promise.resolve(out);
        },
        set: (obj: Record<string, unknown>) => { Object.assign(state, obj); return Promise.resolve(); },
        remove: (keys: string | string[]) => {
          for (const k of Array.isArray(keys) ? keys : [keys]) delete state[k];
          return Promise.resolve();
        },
      },
      session: { set: () => Promise.resolve(), get: () => Promise.resolve({}) },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    runtime: { sendMessage: vi.fn(async () => undefined), getManifest: () => ({ version: '1.0.0' }) },
  };
}

function settings(hiddenByFeature: Record<string, number>, uiLanguage: 'auto' | 'en' | 'ro' = 'en'): FWSettings {
  return {
    mode: 'adult', features: adultPreset(), parentPin: '', strictLanguage: true,
    uiLanguage, outputLanguage: 'auto', locale: 'en', dashboardTheme: 'dark',
    hiddenByFeature,
  } as unknown as FWSettings;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  installStorageStub();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
});

async function render(s: FWSettings, reload = vi.fn(async () => {}), lang: ResolvedUiLanguage = 'en'): Promise<void> {
  await act(async () => {
    root.render(createElement(I18nProvider, { lang, children: createElement(OffBody, { settings: s, reload }) }));
  });
}

describe('OffBody: the per-switch tally', () => {
  it('shows a line for a switch that fired, and none for one that never did', async () => {
    // A count is shown while its switch is on: the emoji switch is on for this profile.
    const withEmoji = settings({ 'block-ads': 12, 'no-swearing': 3, 'strip-emojis': 1, 'word-filter': 2, slurs: 1 });
    (withEmoji.features as Record<string, { enabled: boolean }>)['strip-emojis'] = { enabled: true };
    await render(withEmoji);
    const text = container.textContent ?? '';
    expect(text).toContain('Hidden 12 times so far.');
    expect(text).toContain('3 words starred so far.');
    expect(text).toContain('1 text cleaned so far.');
    expect(text).toContain('Your rules hid 2 posts or comments. Posts or comments hidden for slurs: 1.');
    // Reels never fired on this profile: a zero is not worth a line (QUALITY.md O2).
    expect(text).not.toContain('Hidden 0 times so far.');
  });

  it('says when the ad rule judged many posts on a platform and found none', async () => {
    await render(settings({ 'block-ads': 3, 'ads-judged:facebook': 120, 'ads-found:facebook': 0, 'ads-judged:twitter': 200, 'ads-found:twitter': 9, 'ads-judged:tiktok': 12 }));
    const text = container.textContent ?? '';
    expect(text).toContain('Facebook: no ad found in 120 posts.');
    expect(text).not.toContain('X: no ad found');
    expect(text).not.toContain('TikTok: no ad found');
  });

  it('reads Romanian with the numeral agreement', async () => {
    await render(settings({ 'block-ads': 21, 'no-swearing': 1 }, 'ro'), undefined, 'ro');
    const text = container.textContent ?? '';
    expect(text).toContain('Ascuns de 21 de ori până acum.');
    expect(text).toContain('1 cuvânt acoperit cu steluțe până acum.');
  });
});

// The first screen says what Off is doing, and it must be true site by site: a switch never
// claims a site its code does not act on, and swearing is masked, not hidden.
describe('OffBody: the status on the first screen', () => {
  // The whole sentence is the line's title; the line itself is the one-line form (the-status-is-one-line.test.ts).
  const status = () => container.querySelector('.off-status')?.getAttribute('title') ?? '';
  const start = (): FWSettings => ({ ...settings({}), ...offStartSettings() } as FWSettings);

  it('reads the listing promise on a fresh install, with Reels and Shorts only where they exist', async () => {
    await render(start());
    expect(status()).toBe(
      'On Facebook, Instagram, X, TikTok and YouTube, Off is masking swearing and hiding like counts, ads and slurs. '
      + 'It also hides Reels and Shorts on Facebook, Instagram and YouTube.');
  });

  it('names slurs even with every switch off, and does not claim swearing', async () => {
    const none = Object.fromEntries(Object.entries(adultPreset()).map(([k, v]) => [k, { ...v, enabled: false }]));
    await render({ ...settings({}), features: none, strictLanguage: false } as unknown as FWSettings);
    expect(status()).toBe('On Facebook, Instagram, X, TikTok and YouTube, Off is hiding slurs.');
  });

  it('gives each partial switch its own sites', async () => {
    const f = { ...adultPreset(), 'hide-marketplace': { enabled: true }, 'hide-stories': { enabled: true }, 'block-ads': { enabled: false } };
    await render({ ...settings({}), features: f, strictLanguage: false } as unknown as FWSettings);
    expect(status()).toBe('On Facebook, Instagram, X, TikTok and YouTube, Off is hiding slurs. '
      + 'It also hides Stories on Facebook and Instagram; Marketplace on Facebook.');
  });

  it.each([
    ['es', 'En Facebook, Instagram, X, TikTok y YouTube, Off tapa las palabrotas con asteriscos y oculta los contadores de Me gusta, los anuncios y los insultos discriminatorios. También oculta los Reels y Shorts en Facebook, Instagram y YouTube.'],
    ['pt-BR', 'O Off tapa os palavrões com asteriscos e oculta os contadores de curtidas, os anúncios e as ofensas discriminatórias no Facebook, Instagram, X, TikTok e YouTube. Também oculta os Reels e Shorts no Facebook, Instagram e YouTube.'],
    ['ro', 'Pe Facebook, Instagram, X, TikTok și YouTube, Off acoperă înjurăturile cu steluțe și ascunde numărul de aprecieri, reclamele și insultele discriminatorii. Mai ascunde Reels și Shorts pe Facebook, Instagram și YouTube.'],
  ] as const)('reads in %s', async (lang, line) => {
    await render(start(), undefined, lang);
    expect(status()).toBe(line);
  });

  it('puts the setup guide right under it, in the reader\'s language where the site has one', async () => {
    await render(start());
    expect(container.querySelector<HTMLAnchorElement>('.off-help a')?.href).toBe('https://feelingwise.org/off-setup');
    await render(start(), undefined, 'ro');
    expect(container.querySelector<HTMLAnchorElement>('.off-help a')?.href).toBe('https://feelingwise.org/off-setup-ro');
  });

  it('counts what was taken off the page, not the words starred or the emoji cleaned', async () => {
    await render(start());
    expect(container.querySelector('.off-hidden')?.textContent).toBe('Nothing hidden yet. Open a feed and this count starts.');
    await render({ ...start(), hiddenByFeature: {
      'block-ads': 3, 'block-reels': 1, picker: 2, 'word-filter': 1, slurs: 1,
      'no-swearing': 40, 'strip-emojis': 50, 'ads-judged:facebook': 90, 'ads-found:facebook': 3,
    } } as FWSettings);
    expect(container.querySelector('.off-hidden')?.textContent).toBe('Off has hidden things 8 times so far.');
  });

  it('says how to pin the icon, and sends privacy to the Off box in the reader\'s language', async () => {
    await render(start());
    expect(container.querySelector('.off-status-card')?.textContent).toContain('click the puzzle piece');
    const privacy = () => Array.from(container.querySelectorAll<HTMLAnchorElement>('.foot a')).map(a => a.href);
    expect(privacy()).toEqual(['https://feelingwise.org/privacy#off']);
    expect(container.querySelector('.foot')?.textContent).toContain('Privacy');
    // The guide is linked once, under the status, not again in the footer.
    expect(container.querySelectorAll('a[href*="off-setup"]')).toHaveLength(1);
    await render(start(), undefined, 'ro');
    expect(privacy()).toEqual(['https://feelingwise.org/privacy-ro#off']);
  });

  it('the No swearing note follows the switch', async () => {
    await render(start());
    const note = () => container.querySelector('[role="switch"][aria-label="No swearing"]')?.closest('.feat-row')?.textContent ?? '';
    expect(note()).toContain('On: swear words are starred. Slurs are always hidden.');
    await render({ ...start(), strictLanguage: false } as FWSettings);
    expect(note()).toContain('Off: other swear words show. Slurs are always hidden.');
  });

  it('asks nothing about who uses the browser, and folds every section', async () => {
    await render(start());
    const text = container.textContent ?? '';
    expect(text).not.toMatch(/who is this browser for/i);
    expect(container.querySelector('.mode-seg-btn')).toBeNull();
    const folds = Array.from(container.querySelectorAll('details.off-fold'));
    expect(folds.map(d => d.querySelector('summary')?.textContent)).toEqual([
      'What Off hides4 of 15 switches on', 'My own rules', 'Block this', 'Put on break', 'Lock with a PIN', 'Interface language',
    ]);
    expect(folds.every(d => !(d as HTMLDetailsElement).open)).toBe(true);
    // Every switch is still there, in its old order, inside the first fold.
    const names = Array.from(folds[0].querySelectorAll('[role="switch"]')).map(b => b.getAttribute('aria-label'));
    expect(names).toEqual([
      'No swearing', 'Block Reels and Shorts', 'Hide Stories', 'Hide suggestions', 'Hide the right column',
      'Hide Marketplace', 'Hide Groups', 'Hide the YouTube home feed', 'Hide recommended videos',
      'Hide like, comment and share counts', 'Hide action buttons',
      'Block comment posting', 'Strip emojis', 'Hide posts by hashtag or AI label', 'Block ads',
    ]);
  });
});

// The status names sites from a table in the popup; the surface switches' real reach lives in the
// content code. This holds the two together, so a site added or dropped there shows here.
describe('OffBody: the reach table matches the content code', () => {
  it('names exactly the sites each surface switch has a rule for', () => {
    const allOn = { features: Object.fromEntries(Object.keys(adultPreset()).map(k => [k, { enabled: true }])) } as unknown as FWSettings;
    const seen = new Map<string, Set<string>>();
    for (const p of OFF_SITES) {
      const { rules, pages } = surfaceRulesFor(p, allOn);
      for (const r of [...rules, ...pages]) {
        if (!seen.has(r.feature)) seen.set(r.feature, new Set());
        seen.get(r.feature)!.add(p);
      }
    }
    // The two YouTube feed switches have a module of their own, which runs on YouTube only.
    for (const feature of YOUTUBE_FEED_FEATURES) seen.set(feature, new Set(['youtube']));
    for (const [feature, sites] of seen) {
      expect([...(SWITCH_REACH as Record<string, readonly string[]>)[feature] ?? []].sort(), feature).toEqual([...sites].sort());
    }
    expect([...seen.keys()].sort()).toEqual(Object.keys(SWITCH_REACH).sort());
  });
});

describe('OffBody: the "block this" card', () => {
  it('offers the picker and folds the picks by platform, merged by name, a few rows at a time', async () => {
    const s = settings({ picker: 4 });
    const pick = (id: string, platform: 'facebook' | 'instagram', label: string) =>
      ({ id, platform, createdAt: '2026-09-03T10:00:00.000Z', chain: ['div'], children: 'h4,a', label });
    s.pickedBlocks = [
      pick('a', 'instagram', 'Suggested for you'),
      pick('b', 'facebook', 'People you may know'), pick('c', 'facebook', 'People you may know'), pick('d', 'facebook', 'People you may know'),
      pick('e', 'facebook', 'Reels'), pick('f', 'facebook', 'Sponsored'), pick('g', 'facebook', 'Marketplace'), pick('h', 'facebook', 'Video player'),
      pick('i', 'facebook', ''),
    ];
    await render(s);
    const text = container.textContent ?? '';
    expect(text).toContain('Pick it on the page');
    expect(text).toContain('Pick several (Esc when done)');
    expect(text).toContain('Hidden 4 times so far.');
    expect(text).not.toContain('Nothing picked yet');
    const groups = Array.from(container.querySelectorAll('.pick-group'));
    expect(groups.map(g => g.querySelector('.pick-group-hdr')?.textContent)).toEqual(['Instagram1Clear', 'Facebook8Clear']);
    const fbRows = Array.from(groups[1].querySelectorAll('.pick-row')).map(r => r.textContent);
    // the most-picked first with its count, four rows shown, the rest folded
    expect(fbRows[0]).toBe('People you may know×3×');
    expect(fbRows).toHaveLength(4);
    expect(groups[1].querySelector('.pick-more')?.textContent).toBe('Show 2 more');
    expect(text).not.toContain('2026-09-03');
    await act(async () => { (groups[1].querySelector('.pick-more') as HTMLButtonElement).click(); });
    const opened = Array.from(container.querySelectorAll('.pick-group')[1].querySelectorAll('.pick-row')).map(r => r.textContent);
    expect(opened).toHaveLength(6);
    expect(opened).toContain('A box picked on Sep 3×');
    expect(container.textContent).not.toMatch(/unnamed/i);
  });

  it('names every pick, and a search box narrows the picks across platforms with every match shown', async () => {
    const s = settings({});
    const pick = (id: string, platform: 'facebook' | 'instagram', label: string, createdAt = '2026-09-03T10:00:00.000Z') =>
      ({ id, platform, createdAt, chain: ['div'], children: 'h4,a', label });
    s.pickedBlocks = [
      pick('a', 'instagram', 'Suggested for you'),
      pick('b', 'facebook', 'People you may know'), pick('c', 'facebook', 'Reels'), pick('d', 'facebook', 'Sponsored'),
      pick('e', 'facebook', 'Marketplace'), pick('f', 'facebook', 'Suggested groups'),
      pick('g', 'facebook', '', '2026-09-03T10:00:00.000Z'), pick('h', 'facebook', '', '2026-10-01T10:00:00.000Z'),
    ];
    await render(s);
    const t = POPUP_STRINGS.en;
    const search = container.querySelector(`input[type="search"][aria-label="${t.offPickSearch}"]`) as HTMLInputElement;
    expect(search).not.toBeNull();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(search, 'suggest');
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const rows = Array.from(container.querySelectorAll('.pick-row')).map(r => r.querySelector('.pick-label')?.textContent);
    expect(rows).toEqual(['Suggested for you', 'Suggested groups']);
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(search, 'box picked');
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const named = Array.from(container.querySelectorAll('.pick-row')).map(r => r.querySelector('.pick-label')?.textContent);
    expect(named).toEqual(['A box picked on Oct 1', 'A box picked on Sep 3']);
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(search, 'zzz');
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(container.querySelectorAll('.pick-row')).toHaveLength(0);
    expect(container.textContent).toContain(t.searchNoMatch);
  });
});

describe('OffBody: the interface-language row', () => {
  it('writes uiLanguage and reloads', async () => {
    const reload = vi.fn(async () => {});
    await render(settings({}, 'auto'), reload);
    const select = container.querySelector<HTMLSelectElement>('select[aria-label="Interface language"]');
    expect(select).not.toBeNull();
    expect(select!.value).toBe('auto');
    expect([...select!.options].map(o => o.value)).toEqual(['auto', 'en', 'es', 'pt-BR', 'ro']);
    await act(async () => {
      select!.value = 'ro';
      select!.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(state.uiLanguage).toBe('ro');
    expect(reload).toHaveBeenCalled();
  });

  it('puts the picker under the row name, not beside it', async () => {
    // A row is a flex line and a select keeps the width of its longest
    // option, so in Spanish and Brazilian Portuguese this one left the name
    // 39 pixels of a 322 pixel row and "Idioma de la interfaz" was cut off
    // (scripts/verify/ui-overflow.mjs, 2026-09-17; jsdom cannot see that, a
    // real layout engine can). Stacking is the fix, and this is the lock on
    // it: the row is a column and the picker fills it.
    await render(settings({}, 'auto'), vi.fn(async () => {}));
    const select = container.querySelector<HTMLSelectElement>('select[aria-label="Interface language"]')!;
    const row = select.closest('.feat-row') as HTMLElement;
    expect(row.style.flexDirection).toBe('column');
    expect(row.style.alignItems).toBe('stretch');
    expect(select.style.width).toBe('100%');
    // And the name is still in the same row, above it.
    expect(row.querySelector('.fr-name')?.textContent).toContain('Interface language');
  });
});

// An install saved as Child had its swearing switch locked on and no level buttons left to leave
// Child by. The switch is now the way out: off writes Adult with swearing off and nothing else,
// behind the PIN when one is set, as leaving Child always has been.
describe('OffBody: a Child install is not stuck', () => {
  const child = (parentPin = ''): FWSettings =>
    ({ ...settings({}), mode: 'child', strictLanguage: false, parentPin } as FWSettings);
  const swearing = () => container.querySelector<HTMLButtonElement>('[role="switch"][aria-label="No swearing"]')!;

  it('shows swearing on, without a word about age, and turning it off writes Adult with swearing off', async () => {
    const before = { ...state };
    await render(child());
    expect(swearing().getAttribute('aria-checked')).toBe('true');
    expect(container.textContent ?? '').not.toMatch(/child|teen|copil|niño|criança/i);
    await act(async () => { swearing().click(); });
    expect(state.mode).toBe('adult');
    expect(state.strictLanguage).toBe(false);
    const written = Object.keys(state).filter(k => JSON.stringify(state[k]) !== JSON.stringify((before as Record<string, unknown>)[k]));
    expect(written.sort(), 'the switch grid is left alone').toEqual(['mode', 'strictLanguage']);
  });

  it('asks for the PIN first when one is set, and writes nothing until it is given', async () => {
    await render(child('03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4'));
    await act(async () => { swearing().click(); });
    expect(document.querySelector('.pin-overlay')).not.toBeNull();
    expect(state.mode).toBeUndefined();
    expect(state.strictLanguage).toBeUndefined();
  });
});

describe('the hidden total counts times, in every language', () => {
  it.each([
    ['en', 'Nothing hidden yet. Open a feed and this count starts.', 'Off has hidden things once so far.', 'Off has hidden things 5 times so far.', 'Off has hidden things 1,200 times so far.'],
    ['es', 'Todavía no se ha ocultado nada. Abre un feed y empezará el recuento.', 'Off ha ocultado cosas una vez hasta ahora.', 'Off ha ocultado cosas 5 veces hasta ahora.', 'Off ha ocultado cosas 1200 veces hasta ahora.'],
    ['pt-BR', 'Nada foi ocultado ainda. Abra um feed e a contagem começa.', 'O Off ocultou coisas uma vez até agora.', 'O Off ocultou coisas 5 vezes até agora.', 'O Off ocultou coisas 1.200 vezes até agora.'],
    ['ro', 'Nimic ascuns încă. Deschide un feed și numărătoarea începe.', 'Off a ascuns lucruri o dată până acum.', 'Off a ascuns lucruri de 5 ori până acum.', 'Off a ascuns lucruri de 1.200 de ori până acum.'],
  ] as const)('%s at 0, 1, a few and many', (lang, zero, one, few, many) => {
    const f = POPUP_STRINGS[lang].offStatusHidden;
    expect([f(0), f(1), f(5), f(1200)]).toEqual([zero, one, few, many]);
  });
});

// The status sentence names a site for a switch only where the content code acts on it.
describe('OffBody: every switch the status puts on all five sites runs on all five', () => {
  const FIVE = [...OFF_SITES].sort();
  const everywhere = () => offSwitchIds().filter(id => !(id in SWITCH_REACH));

  it('the Reels and Shorts pages the blocker gates are on the sites the table names', () => {
    const pages = sharedSurfaceDetector.list().filter(d => d.id.startsWith('reels-blocker:')).map(d => d.platform);
    expect(pages.length).toBeGreaterThan(0);
    for (const p of pages) expect(SWITCH_REACH['block-reels'], p).toContain(p);
  });

  it('the all-five switches are exactly these, and each is wired on all five sites', () => {
    expect(everywhere().sort()).toEqual(['block-ads', 'block-ai-content', 'block-comment-posting',
      'hide-action-buttons', 'hide-engagement-metrics', 'strip-emojis']);
    // Counts, buttons and the comment box: each site's own engagement file reads the switch.
    for (const site of ['facebook', 'instagram', 'tiktok', 'twitter', 'youtube']) {
      const src = readSource(`src/content/engagement/${site}-engagement.ts`);
      for (const id of ['hide-engagement-metrics', 'hide-action-buttons', 'block-comment-posting']) {
        expect(src, `${id} on ${site}`).toContain(`'${id}'`);
      }
    }
    // Emoji, swearing and slurs: the text scopes the stripper and the word filter walk.
    expect(Object.keys(TEXT_SCOPE_SELECTORS).sort()).toEqual(expect.arrayContaining(FIVE));
    // Ads: one rule per site in the feed ad table.
    const ads = readSource('src/content/engagement/feed-ad-blocker.ts');
    for (const p of FIVE) expect(ads, `ad rule for ${p}`).toMatch(new RegExp(`^  ${p}: \{`, 'm'));
    // Hashtags and AI labels: an always-on surface per site.
    const ai = readSource('src/content/engagement/ai-content-blocker.ts');
    for (const p of FIVE) expect(ai, `AI-label surface for ${p}`).toContain(`platform: '${p}'`);
  });
});

// The popup's privacy link goes to the short "If you use Off" summary at the top of the privacy page,
// in the reader's language where the site has one (Romanian), else English. The page it opens used
// to begin with the recorder's proxy and a paid AI that Off does not have.
describe('OffBody: the privacy link', () => {
  const footerLink = () => container.querySelector<HTMLAnchorElement>('.foot a')!;
  const expected: Record<ResolvedUiLanguage, string> = {
    en: 'https://feelingwise.org/privacy#off',
    es: 'https://feelingwise.org/privacy#off',
    'pt-BR': 'https://feelingwise.org/privacy#off',
    ro: 'https://feelingwise.org/privacy-ro#off',
  };

  it.each(UI_LANGUAGES)('opens the Off summary in %s, under its own word for privacy', async lang => {
    await render(settings({}, lang === 'ro' ? 'ro' : 'en'), undefined, lang);
    expect(footerLink().getAttribute('href')).toBe(expected[lang]);
    expect(footerLink().textContent).toBe(POPUP_STRINGS[lang].offPrivacy);
  });

  // That the two pages carry the summary first is checked where the site lives, in
  // tests/private/site/off-privacy-summary-first.test.ts: the site folder is not in the public copy
  // of this repository (scripts/public-snapshot.mjs), and a test the copy carries reads only what
  // the copy carries (tests/repo/a-public-test-reads-no-private-path.test.ts).
});
