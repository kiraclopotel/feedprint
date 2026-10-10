// Off's first screen opens on one line of status, in each of the four languages: what it masks, as many of the
// things it hides on every site as fit by name, and the rest counted, so no switch claims a site it does not
// reach. The whole sentence stays as the line's title. A site on break outweighs everything else.

import { describe, expect, it } from 'vitest';
import { offStatus, offStatusLine, offSwitchIds, STATUS_LINE_CHARS } from '../../../../src/products/off/popup/OffPopup';
import { POPUP_STRINGS } from '../../../../src/i18n/popup-strings';
import { adultPreset } from '../../../../src/storage/presets';
import { offStartSettings, type FWSettings, type FeatureToggles } from '../../../../src/storage/settings';

const LANGS = ['en', 'ro', 'es', 'pt-BR'] as const;
const start = (): FWSettings => offStartSettings() as unknown as FWSettings;
const withFeatures = (features: FeatureToggles, strictLanguage = false): FWSettings =>
  ({ mode: 'adult', strictLanguage, features }) as unknown as FWSettings;
const everyOn = (): FeatureToggles => {
  const f = adultPreset();
  for (const id of Object.keys(f) as (keyof FeatureToggles)[]) f[id] = { ...f[id], enabled: true };
  return f;
};
const allOff = (): FeatureToggles =>
  Object.fromEntries(Object.entries(adultPreset()).map(([k, v]) => [k, { ...v, enabled: false }])) as unknown as FeatureToggles;

describe('the line on a fresh install', () => {
  it.each([
    ['en', 'Masking swearing, hiding like counts and 2 more.'],
    ['es', 'Tapa las palabrotas y oculta 3 cosas.'],
    ['pt-BR', 'Tapa os palavrões e oculta 3 coisas.'],
    ['ro', 'Acoperă înjurăturile și ascunde 3 lucruri.'],
  ] as const)('%s', (lang, line) => {
    expect(offStatusLine(start(), POPUP_STRINGS[lang])).toBe(line);
  });
});

describe.each(LANGS)('%s: the line', (lang) => {
  const t = POPUP_STRINGS[lang];

  it('fits one line with every switch on, and with the start set', () => {
    const noBreak = { ...everyOn(), 'media-timeout': { enabled: false } } as FeatureToggles;
    for (const s of [start(), withFeatures(everyOn(), true), withFeatures(noBreak, true), withFeatures(allOff())]) {
      expect(offStatusLine(s, t).length).toBeLessThanOrEqual(STATUS_LINE_CHARS);
    }
  });

  it('never names a switch that reaches only some sites', () => {
    const f = { ...allOff(), 'hide-home-feed': { enabled: true }, 'hide-marketplace': { enabled: true } } as FeatureToggles;
    const line = offStatusLine(withFeatures(f), t);
    expect(line).not.toContain(t.offWhat['hide-home-feed']);
    expect(line).not.toContain(t.offWhat['hide-marketplace']);
    expect(offStatus(withFeatures(f), t), 'the title still names them with their sites').toContain(t.offWhat['hide-home-feed']);
  });

  it('fits one line and names something with any one switch on, masking or not', () => {
    for (const id of offSwitchIds()) {
      for (const strictLanguage of [false, true]) {
        const f = { ...allOff(), [id]: { enabled: true } } as FeatureToggles;
        const line = offStatusLine(withFeatures(f, strictLanguage), t);
        expect(line.length, `${id}: ${line}`).toBeLessThanOrEqual(STATUS_LINE_CHARS);
        expect(line, `${id}: ${line}`).not.toMatch(/\s\.$/);
      }
    }
  });

  it('counts a lone switch that reaches only some sites', () => {
    const f = { ...allOff(), 'hide-home-feed': { enabled: true } } as FeatureToggles;
    expect(offStatusLine(withFeatures(f), t)).toBe(t.offStatusLine(false, [], 1));
    expect(offStatusLine(withFeatures(f, true), t)).toBe(t.offStatusLine(true, [], 1));
  });

  it('names the slurs when they are all it hides', () => {
    expect(offStatusLine(withFeatures(allOff()), t)).toBe(t.offStatusLine(false, [t.offWhat.slurs], 0));
  });

  it('says only the break while a site is on break', () => {
    const f = { ...adultPreset(), 'media-timeout': { enabled: false, perPlatform: { tiktok: { enabled: true } } } } as FeatureToggles;
    expect(offStatusLine(withFeatures(f), t)).toBe(t.offStatusBreakLine(['TikTok']));
    expect(offStatusLine(withFeatures(everyOn()), t), 'every site on break').toBe(t.offStatusBreakAll);
    const four = { ...adultPreset(), 'media-timeout': { enabled: false, perPlatform: { facebook: { enabled: true }, instagram: { enabled: true }, tiktok: { enabled: true }, youtube: { enabled: true } } } } as FeatureToggles;
    expect(offStatusLine(withFeatures(four), t).length, 'four sites on break').toBeLessThanOrEqual(STATUS_LINE_CHARS);
    const two = { ...adultPreset(), 'media-timeout': { enabled: false, perPlatform: { facebook: { enabled: true }, instagram: { enabled: true } } } } as FeatureToggles;
    expect(offStatusLine(withFeatures(two), t)).toBe(t.offStatusBreakLine(['Facebook', 'Instagram']));
  });

  it('fits one line whichever sites are on break', () => {
    const sites = ['twitter', 'facebook', 'instagram', 'tiktok', 'youtube'] as const;
    for (let pick = 1; pick < 1 << sites.length; pick++) {
      const perPlatform = Object.fromEntries(sites.filter((_, i) => pick & (1 << i)).map((p) => [p, { enabled: true }]));
      const f = { ...adultPreset(), 'media-timeout': { enabled: false, perPlatform } } as FeatureToggles;
      const line = offStatusLine(withFeatures(f), t);
      expect(line.length, line).toBeLessThanOrEqual(STATUS_LINE_CHARS);
    }
  });

  it('has no dash', () => {
    expect(offStatusLine(start(), t)).not.toMatch(/[—–]/);
  });
});

describe('the line agrees with the fold', () => {
  it('counts what the fold counts: masking swearing, one name and two more are the 4 switches on', () => {
    expect(offStatusLine(start(), POPUP_STRINGS.en)).toBe(POPUP_STRINGS.en.offStatusLine(true, [POPUP_STRINGS.en.offWhat['hide-engagement-metrics']], 2));
  });
});
