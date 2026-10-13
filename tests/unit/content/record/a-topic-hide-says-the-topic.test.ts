// A post hidden because the person switched a topic on says so, in their words (Topics U1, 13 Oct 2026): the record
// names the policy row R5 and the topic rule, the notice on the page says "Mentions gambling", and the generic line of
// the row stays for a topic this build has no words for. The record claims nothing about the post: no judge, no
// reading, no technique.

import { describe, expect, it } from 'vitest';
import { decisionForLegacy } from '../../../../src/content/record/decision';
import { whyFor } from '../../../../src/core/policy/why';
import { whyFragment, withWhy } from '../../../../src/content/markers/hide-why';
import { whyWords } from '../../../../src/i18n/why-words';
import { MARKER_STRINGS } from '../../../../src/i18n/marker-strings';
import { UI_LANGUAGES } from '../../../../src/i18n';
import type { Mode } from '../../../../src/types/mode';

const MODES: Mode[] = ['child', 'teen', 'adult'];

describe('the record of a topic hide', () => {
  it.each(MODES)('%s: row R5, the topic rail with no quoted word, the topic as the household rule, hide', (mode) => {
    const d = decisionForLegacy({ mode, detectionMode: 'topic:gambling', techniques: [], applied: 'hide', mask: false });
    expect(d).toMatchObject({
      row: 'R5',
      action: 'hide',
      applied: 'hide',
      judge: null,
      reading: null,
      rails: [{ name: 'topic', match: '' }],
      household: { topicRule: 'gambling' },
      note: null,
    });
  });

  it('a hide that did not land says so, as every rail does', () => {
    const d = decisionForLegacy({ mode: 'teen', detectionMode: 'topic:gambling', techniques: [], applied: 'collapse', mask: false });
    expect(d?.row).toBe('R5');
    expect(d?.note).not.toBeNull();
  });

  it('the household\'s word keeps its quoted match and no topic rule', () => {
    const d = decisionForLegacy({ mode: 'teen', detectionMode: 'blocklist:word:diet', techniques: [], applied: 'hide', mask: false });
    expect(d?.rails).toEqual([{ name: 'blocklist', match: 'diet' }]);
    expect(d?.household.topicRule).toBeNull();
  });
});

describe('the why', () => {
  it('names the row and the topic, and quotes nothing', () => {
    expect(whyFor('topic:gambling', [])).toEqual({ row: 'R5', topic: 'gambling' });
    expect(whyFor('topic:', [])).toEqual({ row: 'R5' });
  });

  it.each([
    ['en', 'Mentions gambling'],
    ['ro', 'Menționează jocuri de noroc'],
    ['es', 'Menciona los juegos de azar'],
    ['pt-BR', 'Menciona apostas'],
  ] as const)('%s: the notice says "%s"', (lang, words) => {
    const why = whyFor('topic:gambling', []);
    expect(whyFragment(lang, why!)).toBe(words);
    expect(withWhy('Post hidden', lang, why)).toBe(`Post hidden: ${words}`);
    expect(whyWords(lang, 'R5', null, 'gambling')).toBe(words);
  });

  it.each(UI_LANGUAGES)('%s: a topic with no words of its own keeps the row\'s generic line', (lang) => {
    expect(whyWords(lang, 'R5', null, 'astrology')).toBe(MARKER_STRINGS[lang].whyByRow.R5);
    expect(whyWords(lang, 'R5')).toBe(MARKER_STRINGS[lang].whyByRow.R5);
    expect(MARKER_STRINGS[lang].whyByRow.R5.length).toBeGreaterThan(8);
  });

  it.each(UI_LANGUAGES)('%s: the topic line fits one line of the notice and names no number or instrument', (lang) => {
    for (const text of Object.values(MARKER_STRINGS[lang].whyByTopic)) {
      expect(text.length).toBeLessThanOrEqual(32);
      expect(text).not.toMatch(/\d/);
      expect(text).not.toMatch(/FeelingWise|gpt|groq/i);
    }
  });

  it('a row that is not a topic is not changed by a topic word', () => {
    expect(whyWords('en', 'R1', null, 'gambling')).toBe(MARKER_STRINGS.en.whyByRow.R1);
  });
});
