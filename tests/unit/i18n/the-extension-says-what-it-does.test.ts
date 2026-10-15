// The sentences the extension shows say what it does (the open board read against master, 14 Oct 2026,
// crew/BOARD-2026-10-14.md rows R106, R103, R049, R063, R073). Each test names the code that makes the sentence true.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EN as DASH_EN } from '../../../src/i18n/dashboard/en';
import { RO as DASH_RO } from '../../../src/i18n/dashboard/ro';
import { ES as DASH_ES } from '../../../src/i18n/dashboard/es';
import { PT_BR as DASH_PT } from '../../../src/i18n/dashboard/pt-br';
import { EN as POP_EN } from '../../../src/i18n/popup/en';
import { RO as POP_RO } from '../../../src/i18n/popup/ro';
import { ES as POP_ES } from '../../../src/i18n/popup/es';
import { PT_BR as POP_PT } from '../../../src/i18n/popup/pt-br';
import { I18N as EXPORT } from '../../../src/i18n/export-strings';

const DASH = { en: DASH_EN, ro: DASH_RO, es: DASH_ES, 'pt-BR': DASH_PT } as const;
const POP = { en: POP_EN, ro: POP_RO, es: POP_ES, 'pt-BR': POP_PT } as const;
const LOCALES = ['en', 'ro', 'es', 'pt-BR'] as const;

describe('the Record tab says what the export does with the accounts not recorded', () => {
  // The export lists them by name under its own heading (forensics/exporter.ts excludedAccountsForExport, his word of
  // 12 Oct 2026); the sentence above the list used to say "never a name".
  it.each(LOCALES)('%s names the export section that lists them', (locale) => {
    const sentence = DASH[locale].exclusionsSub;
    expect(sentence).toContain(EXPORT[locale].exclHeader);
  });
  it('the English sentence no longer says "never a name"', () => {
    expect(DASH_EN.exclusionsSub).not.toMatch(/never a name/i);
  });
});

describe('the paid feature has one name on every screen and in the export', () => {
  const englishValues = (table: Record<string, unknown>): string[] =>
    Object.values(table).filter((v): v is string => typeof v === 'string');
  it('no English dashboard string calls it "the AI reading"', () => {
    expect(englishValues(DASH_EN as unknown as Record<string, unknown>).filter(v => /AI reading/i.test(v))).toEqual([]);
  });
  it('no English export string calls it "the AI reading"', () => {
    expect(englishValues(EXPORT.en as unknown as Record<string, unknown>).filter(v => /AI reading/i.test(v))).toEqual([]);
  });
  it.each(LOCALES)('%s: the two Issues card titles name Live Rephrase', (locale) => {
    expect(DASH[locale].opsCardReadingPausedTitle).toContain('Live Rephrase');
    expect(DASH[locale].opsCardReadingTroubleTitle).toContain('Live Rephrase');
  });
});

describe('Calm says the post shows as written first', () => {
  // At Calm a flagged post is shown as the page drew it until the reading answers (only Silent covers it,
  // content/protection/child-first-protection.ts), so neither Calm line may say it arrives rephrased.
  it('neither English Calm line says a post arrives rephrased', () => {
    expect(POP_EN.setupLevelTeenLine).not.toMatch(/arrives? rephrased/i);
    expect(POP_EN.levelSentenceTeen).not.toMatch(/arrives? rephrased/i);
    expect(POP_EN.setupLevelTeenLine).toMatch(/as written/);
    expect(POP_EN.levelSentenceTeen).toMatch(/as written/);
  });
});

describe('Silent says YouTube search results are not checked', () => {
  // Feedprint runs only the ad modules on the page (content/engagement/controller.ts) and no YouTube adapter reads a
  // search result's tile, so the level a parent picks says so.
  const NOT_CHECKED = { en: /are not checked/, ro: /nu sunt verificate/, es: /no se revisan/, 'pt-BR': /não são verificados/ } as const;
  it.each(LOCALES)('%s names YouTube search in the Silent sentence and says its videos are not checked', (locale) => {
    expect(POP[locale].levelSentenceChild).toMatch(/YouTube/);
    expect(POP[locale].levelSentenceChild).toMatch(NOT_CHECKED[locale]);
  });
});

describe('no screen promises a video transcript', () => {
  it.each(LOCALES)('%s: the record limits paragraph names no transcript', (locale) => {
    expect(DASH[locale].recordLimit3).not.toMatch(/transcri/i);
  });
});

describe('the export note on a platform-sent text allows for a cut text', () => {
  // textCapture 'platform' covers no text on the page or only a fragment cut at "See more" (types/text-capture.ts).
  it('the English note does not say the page carried no text', () => {
    const src = readFileSync(new URL('../../../src/forensics/exporter.ts', import.meta.url), 'utf8');
    const line = /textCapturePlatform: '((?:[^'\\]|\\.)*)'/.exec(src)?.[1] ?? '';
    expect(line).toMatch(/only part of it/);
    expect(line).not.toMatch(/carried no text/);
  });
});
