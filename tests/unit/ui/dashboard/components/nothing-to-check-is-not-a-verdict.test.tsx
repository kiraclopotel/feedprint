// @vitest-environment jsdom
//
// "Record verified" is the strongest word this product prints. On a fresh
// install it was printed over a chain with nothing in it, together with "Every
// inspected signature verified under the current key" over zero inspections.
//
// Nothing lied on the way there. chain-integrity.ts answers valid: true for an
// empty chain because nothing failed, which is the right answer to the question
// it was asked; integrity-summary.ts falls through an empty Map to 'verified';
// the banner renders the verdict it was handed. The overclaim is assembled from
// three correct steps, which is why no check saw it and a stranger did, in
// about a minute, on their first install.
//
// ChainBanner.tsx states the rule sixty lines above its own render: a walk that
// comes back verified while part of the record was never looked at is "the
// overclaim this product exists not to make". It had guarded the
// rows-that-did-not-decode case. It had also, one function further down,
// already disabled Verify and Export at zero records because an enabled button
// "would produce a green check or an empty file". The buttons knew. The words
// above them did not. (2026-09-18)

import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import { createElement } from 'react';
import { ChainBanner } from '../../../../../src/ui/dashboard/components/ChainBanner';
import { I18nProvider } from '../../../../../src/i18n/react';
import { DASHBOARD_STRINGS } from '../../../../../src/i18n/dashboard-strings';
import { UI_LANGUAGES } from '../../../../../src/i18n';
import type { ForensicRecord } from '../../../../../src/types/forensic';
import type { IntegrityResult } from '../../../../../src/forensics/chain-integrity';

function record(i: number): ForensicRecord {
  return {
    id: `r-${i}`, timestamp: '2026-09-18T10:00:00Z', platform: 'facebook',
    originalText: 'a post', originalHash: 'h', originalLength: 6, neutralizedText: '',
    author: '@a', postUrl: 'https://facebook.com/p/1', techniques: [], overallScore: 0,
    userAgeCategory: 'adult', aiSource: 'cloud', feedSource: 'for-you',
    integrityHash: `hash-${i}`, signature: 'sig', publicKeyFingerprint: 'fp',
    chainPosition: i, kind: 'post', verdict: 'pass',
  } as unknown as ForensicRecord;
}

/** What chain-integrity.ts really returns for an empty chain: valid, length 0. */
const EMPTY_BUT_VALID = {
  valid: true, chainLength: 0, preChainCount: 0, preRekeyCount: 0,
  perRecord: new Map<string, string>(),
} as unknown as IntegrityResult;

const ONE_GOOD_RECORD = {
  valid: true, chainLength: 1, preChainCount: 0, preRekeyCount: 0,
  perRecord: new Map<string, string>([['r-0', 'verified']]),
} as unknown as IntegrityResult;

function render(
  records: ForensicRecord[],
  integrity: IntegrityResult | null,
  lang: (typeof UI_LANGUAGES)[number] = 'en',
): string {
  return renderToString(createElement(I18nProvider, {
    lang,
    children: createElement(ChainBanner, {
      records, integrity, archivedMonthCount: 0, archivesVerified: false,
    } as never),
  }));
}

describe('nothing to check is not a verdict', () => {
  it('prints no green word over a chain with nothing in it', () => {
    const html = render([], EMPTY_BUT_VALID);
    const t = DASHBOARD_STRINGS.en;
    expect(html, 'the strongest word the product has is not spent on zero records')
      .not.toContain(t.chainTitleOk);
    expect(html).toContain(t.chainTitleNothingYet);
    // And the claim underneath it, which was the worse half: "Every inspected
    // signature verified under the current key", over nothing inspected.
    expect(html).toContain(t.chainDescNothingYet);
    expect(html, 'the banner is not styled as a pass').not.toContain('chain-banner ok');
  });

  // The control. A guard that reached its verdict by never saying "verified"
  // would be worthless, so a real record must still earn the real word.
  it('still says it plainly when there is something that checked out', () => {
    const html = render([record(0)], ONE_GOOD_RECORD);
    expect(html).toContain(DASHBOARD_STRINGS.en.chainTitleOk);
    expect(html).not.toContain(DASHBOARD_STRINGS.en.chainTitleNothingYet);
    expect(html).toContain('chain-banner ok');
  });

  // The same fresh install, in the other three languages a parent may be
  // reading it in.
  it('holds in every interface language', () => {
    for (const lang of UI_LANGUAGES) {
      const html = render([], EMPTY_BUT_VALID, lang);
      const t = DASHBOARD_STRINGS[lang];
      expect(html, `${lang} prints no verdict`).not.toContain(t.chainTitleOk);
      expect(html, `${lang} says what is actually true`).toContain(t.chainTitleNothingYet);
    }
  });
});
