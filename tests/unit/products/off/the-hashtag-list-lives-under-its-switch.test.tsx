/** @vitest-environment jsdom */
// "Hide posts by hashtag or AI label" is Off's switch, and it hides by a list the person can edit. The list's
// editor sits under the switch in Off's popup while the switch is on; with the switch off it is not shown, and
// the stored list is kept either way.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { installStorage } from '../../../helpers/popup-walk';
import { OffBody } from '../../../../src/products/off/popup/OffPopup';
import { I18nProvider } from '../../../../src/i18n/react';
import { POPUP_STRINGS } from '../../../../src/i18n/popup-strings';
import { _setProductForTesting } from '../../../../src/product';
import { adultPreset } from '../../../../src/storage/presets';
import type { FWSettings } from '../../../../src/storage/settings';

function settingsWithAiSwitch(on: boolean): FWSettings {
  const features = adultPreset();
  features['block-ai-content'] = { enabled: on, value: { hashtags: ['fruitdrama'] } };
  return {
    mode: 'adult', features, parentPin: '', strictLanguage: false,
    uiLanguage: 'en', outputLanguage: 'auto', locale: 'en', dashboardTheme: 'dark', hiddenByFeature: {},
  } as unknown as FWSettings;
}

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  _setProductForTesting('off');
  installStorage();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  _setProductForTesting(null);
});

async function render(s: FWSettings): Promise<void> {
  await act(async () => {
    root.render(createElement(I18nProvider, {
      lang: 'en',
      children: createElement(OffBody, { settings: s, reload: vi.fn(async (): Promise<void> => {}) }),
    }));
  });
}

describe("Off's hashtag list", () => {
  const t = POPUP_STRINGS.en;

  it('is editable under its switch while the switch is on', async () => {
    await render(settingsWithAiSwitch(true));
    expect(container.querySelector(`[aria-label="${t.addHashtagAria}"]`)).not.toBeNull();
  });

  it('is not shown while the switch is off', async () => {
    await render(settingsWithAiSwitch(false));
    expect(container.querySelector(`[aria-label="${t.addHashtagAria}"]`)).toBeNull();
  });
});
