// The two YouTube switches act on YouTube only, so Off's top line names YouTube beside them and never
// claims the other four sites, in each of the four languages; with both off the line says nothing of
// them.

import { describe, expect, it } from 'vitest';
import { offStatus, SWITCH_REACH } from '../../../../src/products/off/popup/OffPopup';
import { POPUP_STRINGS } from '../../../../src/i18n/popup-strings';
import { adultPreset } from '../../../../src/storage/presets';
import type { FWSettings, FeatureId } from '../../../../src/storage/settings';

const LANGS = ['en', 'ro', 'es', 'pt-BR'] as const;

function settingsWith(...on: FeatureId[]): FWSettings {
  const features = adultPreset();
  for (const id of on) features[id] = { enabled: true };
  return { mode: 'adult', strictLanguage: false, features } as unknown as FWSettings;
}

describe('the YouTube switches reach YouTube only', () => {
  it('the reach table says so', () => {
    expect(SWITCH_REACH['hide-home-feed']).toEqual(['youtube']);
    expect(SWITCH_REACH['hide-recommended-videos']).toEqual(['youtube']);
  });

  it.each(LANGS)('%s: the top line names them on YouTube when on, and not at all when off', (lang) => {
    const t = POPUP_STRINGS[lang];
    const on = offStatus(settingsWith('hide-home-feed', 'hide-recommended-videos'), t);
    expect(on).toContain(t.offOnSites(t.offWhat['hide-home-feed'], ['YouTube']));
    expect(on).toContain(t.offWhat['hide-recommended-videos']);
    const off = offStatus(settingsWith(), t);
    expect(off).not.toContain(t.offWhat['hide-home-feed']);
    expect(off).not.toContain(t.offWhat['hide-recommended-videos']);
  });
});
