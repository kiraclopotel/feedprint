// The sponsored row (R4) asks for a fold and Block ads hides, so until 9 Oct 2026 every hidden ad was signed "the legacy
// path acted before the table was wired", and the timeline's "Why" told a new user an older path of the product acted
// on almost every row of a YouTube record (the head, through the Brand and Dashboard seats). A hidden ad now carries
// its own sentence, shown in the reader's language; the legacy sentence stays for paths that were never wired, and an
// old record keeps its signed sentence and still reads in plain words.

import { describe, expect, it } from 'vitest';
import {
  NOTE_AD_HIDDEN, NOTE_LEGACY_ACTED, decisionForBlock, decisionForJudge, decisionForLegacy,
} from '../../../../src/content/record/decision';
import { decisionNoteWords } from '../../../../src/i18n/decision-notes';
import { I18N } from '../../../../src/i18n/export-strings';
import { UI_LANGUAGES } from '../../../../src/i18n';
import type { Mode } from '../../../../src/types/mode';

const MODES: Mode[] = ['child', 'teen', 'adult'];

describe('a hidden advertisement', () => {
  it.each(MODES)('%s: an ad slot, a player ad, a sidebar ad or a media-only ad hidden by Block ads says so', (mode) => {
    for (const matchedToken of ['ad-slot', 'player-ad', 'sidebar-ad-label', 'media-only-ad-marker']) {
      const d = decisionForBlock({ mode, blockReason: 'ads', matchedToken, applied: 'hide', mask: false });
      expect(d?.rails).toEqual([{ name: 'sponsored', match: '' }]);
      expect(d?.note, matchedToken).toBe(NOTE_AD_HIDDEN);
    }
  });

  it('a sponsored post the post path hid says so too', () => {
    const d = decisionForLegacy({ mode: 'teen', detectionMode: 'sponsored-ad', techniques: [], applied: 'hide', mask: false });
    expect(d?.note).toBe(NOTE_AD_HIDDEN);
  });

  it('an ad folded as the row asks carries no note, and one that did not land says it was not applied', () => {
    expect(decisionForLegacy({ mode: 'teen', detectionMode: 'sponsored-ad', techniques: [], applied: 'collapse', mask: false })?.note).toBeNull();
    const failed = decisionForBlock({ mode: 'teen', blockReason: 'ads', matchedToken: 'ad-slot', applied: 'mark', mask: false });
    expect(failed?.note).not.toBe(NOTE_AD_HIDDEN);
  });

  it('a late ad keeps the late sentence, and Block ads switched off keeps its own', () => {
    const late = decisionForBlock({ mode: 'teen', blockReason: 'ads', matchedToken: 'ad-slot', applied: 'hide', mask: false, late: true, landed: true });
    expect(late?.note).not.toBe(NOTE_AD_HIDDEN);
    expect(decisionForLegacy({ mode: 'teen', detectionMode: 'sponsored-ad', techniques: [], applied: 'allow', mask: false, settingOff: true })?.note).not.toBe(NOTE_AD_HIDDEN);
  });

  it.each(UI_LANGUAGES)('%s: reads in the reader\'s words, naming Block ads, and not as an older path', (lang) => {
    const words = decisionNoteWords(lang, NOTE_AD_HIDDEN, undefined);
    expect(words).toBe(I18N[lang].feedNoteAdHidden);
    expect(words).not.toBe(I18N[lang].feedNoteLegacyActed);
  });
});

describe('the legacy sentence', () => {
  it('stays for a path that was never wired: a judged hide that did more than its row', () => {
    const d = decisionForJudge({
      mode: 'adult',
      judge: { id: 'judge-v1' as const, hash: '4f32b70b07b7', model: 'openai/gpt-oss-120b', charged: true, family: 'hostile', severity: 8, effect: 'recruit', intent: 'react' },
      provider: 'groq', applied: 'hide', landed: true, mask: false, rewrite: { attempted: false, outcome: 'off' },
    });
    expect(d.note).toBe(NOTE_LEGACY_ACTED);
  });

  it.each(UI_LANGUAGES)('%s: an old record\'s signed legacy sentence still reads, in plain words', (lang) => {
    const words = decisionNoteWords(lang, NOTE_LEGACY_ACTED, undefined) ?? '';
    expect(words).toBe(I18N[lang].feedNoteLegacyActed);
    expect(words).not.toMatch(/wired|legat|conectada|ligada/);
  });
});
