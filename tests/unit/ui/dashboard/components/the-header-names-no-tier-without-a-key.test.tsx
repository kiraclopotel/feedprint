// @vitest-environment jsdom
//
// The dashboard header printed the licence tier in a pill, so every install without a key read
// "FREE" in English, whatever its language, as if there were a level above it to buy. Receipts
// sells nothing; the pill is there only to show which key is held, so it shows only when one is.

import { describe, expect, it } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DashHeader } from '../../../../../src/ui/dashboard/components/DashHeader';
import { I18nProvider } from '../../../../../src/i18n/react';
import { UI_LANGUAGES } from '../../../../../src/i18n';
import type { LicenseInfo } from '../../../../../src/storage/license';

type Lang = (typeof UI_LANGUAGES)[number];

function header(license: LicenseInfo, lang: Lang): Document {
  const html = renderToStaticMarkup(React.createElement(I18nProvider, {
    lang,
    children: React.createElement(DashHeader, {
      records: [], integrity: null, license, theme: 'dark', setTheme: () => {},
    } as unknown as React.ComponentProps<typeof DashHeader>),
  }));
  return new DOMParser().parseFromString(html, 'text/html');
}

describe.each(UI_LANGUAGES)('%s', (lang) => {
  it('without a key the header names no tier and never says free', () => {
    const doc = header({ tier: 'free', secret: '' }, lang);
    expect(doc.querySelector('.dash-tier-pill')).toBeNull();
    expect(doc.body.textContent ?? '').not.toMatch(/free/i);
  });

  it('with a key held the header still shows which key it is', () => {
    const doc = header({ tier: 'family', secret: 'abc' }, lang);
    expect(doc.querySelector('.dash-tier-pill')?.textContent).toBe('family');
  });
});
