// "Block this" is one card shown in two products: Off's popup and Receipts' settings. Its sentences
// named Off, so Receipts told its own users that Off keeps the picked box hidden. The card says
// what happens and leaves the product unnamed, so it reads true in either.

import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { createElement } from 'react';

import { PickCard } from '../../../../src/ui/popup/PickCard';
import { I18nProvider } from '../../../../src/i18n/react';
import { UI_LANGUAGES } from '../../../../src/i18n';
import type { FWSettings } from '../../../../src/storage/settings';

function card(lang: (typeof UI_LANGUAGES)[number]): string {
  const settings = { pickedBlocks: [], hiddenByFeature: {} } as unknown as FWSettings;
  return renderToString(createElement(I18nProvider, {
    lang,
    children: createElement(PickCard, { settings, reload: async () => {} }),
  }));
}

describe('the Block this card names no product', () => {
  it.each(UI_LANGUAGES)('%s', (lang) => {
    const html = card(lang);
    expect(html).toContain('pick-card');
    expect(html).not.toMatch(/\bOff\b/);
    expect(html).not.toMatch(/\bReceipts\b/);
  });
});
