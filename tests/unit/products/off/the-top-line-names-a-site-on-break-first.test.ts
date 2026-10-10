/** @vitest-environment jsdom */
// A site on break has its whole tab covered, whatever the switches say, and Off's top line used to list the switches
// only. A person who put Facebook on break and forgot read "On Facebook, ... Off is hiding slurs" and nothing about the
// covered tab. The line now names the sites on break first, in four languages, and says nothing of a break when none is on.

import { describe, it, expect } from 'vitest';
import { installChromeStorageStub } from '../../../helpers/chrome-storage';
import { getSettings, type FWSettings } from '../../../../src/storage/settings';
import { offStatus } from '../../../../src/products/off/popup/OffPopup';
import { POPUP_STRINGS } from '../../../../src/i18n/popup-strings';

const LANGS = ['en', 'ro', 'es', 'pt-BR'] as const;
const BREAK_WORD = { en: 'On break', ro: 'În pauză', es: 'En pausa', 'pt-BR': 'Em pausa' } as const;

async function settingsWithBreak(sites: string[]): Promise<FWSettings> {
  installChromeStorageStub({ initial: {} });
  const s = await getSettings();
  const perPlatform = Object.fromEntries(sites.map((p) => [p, { enabled: true }]));
  const current = (s.features ?? {})['media-timeout' as keyof NonNullable<FWSettings['features']>] ?? {};
  return {
    ...s,
    features: { ...(s.features ?? {}), 'media-timeout': { ...current, perPlatform } },
  } as FWSettings;
}

describe.each(LANGS)('%s: Off\'s top line and a break', (lang) => {
  const t = POPUP_STRINGS[lang];

  it('names the sites on break first', async () => {
    const line = offStatus(await settingsWithBreak(['facebook', 'tiktok']), t);
    expect(line.startsWith(BREAK_WORD[lang])).toBe(true);
    expect(line).toContain('Facebook');
    expect(line).toContain('TikTok');
    expect(line).toContain(t.offStatusBreak(['Facebook', 'TikTok']));
  });

  it('says nothing of a break when none is on', async () => {
    const line = offStatus(await settingsWithBreak([]), t);
    expect(line).not.toContain(BREAK_WORD[lang]);
  });
});
