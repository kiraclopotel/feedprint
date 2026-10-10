// The one line on page one that says which rules fired, in words.
//
// It printed the split's own keys, so the public demo's rule row read
// "profanity-mask 17" and a real Child-mode file would read
// "coded-harm 1, dehumanization 1, profanity 1". Those are the strings the code
// groups by, not names for a reader, and this row exists precisely for the
// reader who wants to know whether a judge or a word list decided each flag.
//
// The export already has reader-facing names for these lists, used on the cards
// two screens down ("the slur list", "the swearing list", "the coded-harm
// list"), so the row now uses them. A key with no name is printed as it is:
// inventing a name for a rule this version does not know would be worse than
// showing its key.

import { describe, expect, it } from 'vitest';
import { buildForensicHtmlExport, I18N, type ExportMetadata } from '../../../src/forensics/html-export';
import type { ForensicRecord } from '../../../src/types/forensic';

let seq = 0;
function rec(overrides: Partial<ForensicRecord> = {}): ForensicRecord {
  seq++;
  return {
    id: `r-${seq}`,
    timestamp: new Date(Date.parse('2026-09-17T10:00:00Z') + seq * 60_000).toISOString(),
    platform: 'twitter',
    originalText: 'recorded post',
    originalHash: 'h',
    originalLength: 13,
    neutralizedText: '',
    author: '@someone',
    postUrl: '',
    techniques: [],
    overallScore: 0,
    userAgeCategory: 'child',
    aiSource: 'cloud',
    feedSource: 'for-you',
    integrityHash: 'deadbeef',
    signature: 'sig',
    publicKeyFingerprint: 'fp',
    chainPosition: seq,
    kind: 'post',
    verdict: 'pass',
    ...overrides,
  } as ForensicRecord;
}

const ruleHide = (mode: string) => rec({
  verdict: 'flagged-hidden',
  aiSource: 'rules',
  detectionMode: mode,
  overallScore: 9,
  techniques: [{ name: 'extreme-toxicity', severity: 9, confidence: 0.98 }],
});

const META: ExportMetadata = {
  fwVersion: 'V1.0.0-test',
  publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'AAA', y: 'BBB' },
  publicKeyFingerprint: 'fp16',
  locale: 'en',
};

/** The rule row's text, as page one prints it. */
function ruleRow(records: ForensicRecord[]): string {
  const html = buildForensicHtmlExport(records, META);
  const m = html.match(/data-fw-prov="flaggedRule">([\s\S]*?)<\/dd>/);
  return m ? m[1] : '';
}

describe('the rule row names the list, not the key', () => {
  it('calls the swearing list by its name', () => {
    const row = ruleRow([ruleHide('profanity-mask:1'), rec()]);
    expect(row).toContain(I18N.en.ruleKindFmt.replace('{n}', '1').replace('{label}', I18N.en.feedGateProfanityTier));
    expect(row).not.toContain('profanity-mask');
  });

  it('names the slur list and the coded-harm list', () => {
    const row = ruleRow([ruleHide('slur:2'), ruleHide('coded-harm:self-harm-encouragement'), rec()]);
    expect(row).toContain(I18N.en.ruleKindFmt.replace('{n}', '1').replace('{label}', I18N.en.feedGateIdentitySlur));
    expect(row).toContain(I18N.en.ruleKindFmt.replace('{n}', '1').replace('{label}', I18N.en.feedGateCodedHarm));
  });

  it('adds up two ways of reaching one rule instead of printing it twice', () => {
    // A hide from the comment path carries overrideOrigin; one from the post
    // path carries the mode. Same list, one line.
    const row = ruleRow([
      ruleHide('profanity-mask:1'),
      rec({ verdict: 'flagged-hidden', aiSource: 'cloud', overrideOrigin: 'profanity-tier', techniques: [{ name: 'profanity', severity: 8, confidence: 1 }] }),
      rec(),
    ]);
    expect(row).toContain(I18N.en.ruleKindFmt.replace('{n}', '2').replace('{label}', I18N.en.feedGateProfanityTier));
  });

  it('prints an unknown key as it is, rather than inventing a name', () => {
    const row = ruleRow([ruleHide('dehumanization:1'), rec()]);
    expect(row).toContain(I18N.en.ruleKindFmt.replace('{n}', '1').replace('{label}', 'dehumanization'));
  });

  it('puts the commonest first', () => {
    const row = ruleRow([
      ruleHide('slur:1'), ruleHide('slur:1'), ruleHide('coded-harm:x'), rec(),
    ]);
    const slur = row.indexOf(I18N.en.feedGateIdentitySlur);
    const coded = row.indexOf(I18N.en.feedGateCodedHarm);
    expect(slur).toBeGreaterThanOrEqual(0);
    expect(coded).toBeGreaterThan(slur);
  });

  it('says the same in every language the export ships', () => {
    for (const locale of ['ro', 'es', 'pt-BR'] as const) {
      const html = buildForensicHtmlExport([ruleHide('slur:2'), rec()], { ...META, locale });
      const m = html.match(/data-fw-prov="flaggedRule">([\s\S]*?)<\/dd>/);
      const table = I18N[locale === 'pt-BR' ? 'pt-BR' : locale];
      expect(m?.[1], locale).toContain(table.ruleKindFmt.replace('{n}', '1').replace('{label}', table.feedGateIdentitySlur));
    }
  });
});
