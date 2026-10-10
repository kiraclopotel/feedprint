// @vitest-environment jsdom
//
// Each record card lists the switches that were on when it was written, by the name the popup gives
// each one, in the reader's language, and never by its internal id. The record itself keeps the
// ids, which are the signed values; only the card's words are checked here.

import { describe, expect, it } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FeedCard } from '../../../../../src/ui/dashboard/components/FeedCard';
import { featureLabel, FEATURE_IDS } from '../../../../../src/ui/dashboard/feature-label';
import { I18nProvider } from '../../../../../src/i18n/react';
import { POPUP_STRINGS } from '../../../../../src/i18n/popup-strings';
import { DASHBOARD_STRINGS } from '../../../../../src/i18n/dashboard-strings';
import { UI_LANGUAGES } from '../../../../../src/i18n';
import { teenPreset } from '../../../../../src/storage/presets';
import type { ForensicRecord } from '../../../../../src/types/forensic';

type Lang = (typeof UI_LANGUAGES)[number];

const ALL_ON = Object.keys(teenPreset()).sort();

function record(enabledFeatures: string[]): ForensicRecord {
  return {
    id: 'r1', timestamp: '2026-09-29T07:35:09.000Z', platform: 'twitter', originalText: 'a recipe for lentil soup',
    originalHash: 'h', originalLength: 24, neutralizedText: '', author: 'user5', postUrl: '', techniques: [],
    overallScore: 0, userAgeCategory: 'relaxed', aiSource: 'cloud', feedSource: 'for-you', integrityHash: 'ih',
    verdict: 'skipped', kind: 'post', chainPosition: 4,
    configSnapshot: { mode: 'relaxed', threshold: 0.6, dailyCap: 200, enabledFeatures },
  } as unknown as ForensicRecord;
}

function cardText(r: ForensicRecord, lang: Lang): string {
  const html = renderToStaticMarkup(React.createElement(I18nProvider, { lang, children: React.createElement(FeedCard, { record: r }) }));
  return new DOMParser().parseFromString(html, 'text/html').body.textContent ?? '';
}

describe('the switch names', () => {
  it('cover every switch a record can carry', () => {
    expect([...FEATURE_IDS].sort()).toEqual(ALL_ON);
  });

  it.each(UI_LANGUAGES)('%s: every name is a word for a reader, not an id', (lang) => {
    for (const id of FEATURE_IDS) {
      const label = featureLabel(id, POPUP_STRINGS[lang], DASHBOARD_STRINGS[lang]);
      expect(label, id).not.toBe(id);
      expect(label, id).not.toMatch(/^[a-z]+(-[a-z]+)+$/);
      expect(label.length, id).toBeGreaterThan(2);
    }
  });

  it('an id no build knows any more is shown as it was signed', () => {
    expect(featureLabel('some-old-switch', POPUP_STRINGS.en, DASHBOARD_STRINGS.en)).toBe('some-old-switch');
  });
});

describe.each(UI_LANGUAGES)('%s: the record card', (lang) => {
  it('names the protections, not their ids', () => {
    const text = cardText(record(['block-ads', 'parent-blocklist', 'soften-swearing']), lang);
    expect(text).toContain(DASHBOARD_STRINGS[lang].feedProtectionsAtCapture);
    expect(text).not.toContain('parent-blocklist');
    expect(text).not.toContain('block-ads');
    expect(text).not.toContain('soften-swearing');
    expect(text).toContain(POPUP_STRINGS[lang].rulesName);
    expect(text).toContain(POPUP_STRINGS[lang].featBlockAdsName);
    expect(text).toContain(POPUP_STRINGS[lang].softenSwearingName);
  });
});
