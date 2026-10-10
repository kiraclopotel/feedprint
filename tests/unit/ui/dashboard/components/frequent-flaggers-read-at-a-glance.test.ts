// @vitest-environment jsdom
//
// A Frequent flaggers row printed its facts as one grey 10px line: "seen a lot · fear / 85 recorded · 64 passed ·
// 70 on For You · 0 sought · 8 days · 8 bursts". It was read on a 1914px window and needed a telescope.
//
// What a row has to show now, each checked here:
// - the techniques as chips in the colour the Technique frequency card gives the same technique, so a colour
//   means one thing on the screen;
// - the facts as separate pieces in two rows, recorded and passed first, a zero marked rather than dropped;
// - the facts at the dashboard's body size in the theme's text colour, not a caption.

import { describe, it, expect } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RecidivistAuthorsPanel } from '../../../../../src/ui/dashboard/components/RecidivistAuthorsPanel';
import { TECHNIQUE_COLORS, PRETTY_TECHNIQUE } from '../../../../../src/ui/dashboard/components/color-maps';
import { I18nProvider } from '../../../../../src/i18n/react';
import { DASHBOARD_STRINGS } from '../../../../../src/i18n/dashboard-strings';
import { readSource } from '../../../../helpers/read-source';
import type { ForensicRecord } from '../../../../../src/types/forensic';

let seq = 0;
function rec(over: Partial<ForensicRecord>): ForensicRecord {
  seq += 1;
  return {
    id: `r-${seq}`,
    timestamp: new Date(Date.parse('2026-09-20T10:00:00Z') + seq * 3_600_000).toISOString(),
    platform: 'tiktok',
    originalText: `item ${seq}`,
    originalHash: 'h',
    originalLength: 6,
    neutralizedText: '',
    author: '@loud',
    postUrl: '',
    techniques: [],
    overallScore: 6,
    userAgeCategory: 'teen',
    aiSource: 'cloud',
    feedSource: 'for-you',
    integrityHash: 'ih',
    chainPosition: seq,
    kind: 'post',
    verdict: 'flagged',
    ...over,
  } as unknown as ForensicRecord;
}

const tech = (name: string) => ({ name, severity: 6, confidence: 1 });

// Three flags (two fear, one anger) and one pass, all served on For You, none sought.
const records = [
  rec({ techniques: [tech('fear-appeal')] as never }),
  rec({ techniques: [tech('fear-appeal')] as never }),
  rec({ techniques: [tech('anger-trigger')] as never }),
  rec({ verdict: 'pass', overallScore: 0 }),
];

type Lang = 'en' | 'ro' | 'es' | 'pt-BR';

function render(lang: Lang = 'en'): HTMLElement {
  const html = renderToStaticMarkup(
    React.createElement(I18nProvider, {
      lang,
      children: React.createElement(RecidivistAuthorsPanel, { records, onPickAuthor: () => {} }),
    }),
  );
  const host = document.createElement('div');
  host.innerHTML = html;
  return host;
}

describe('a Frequent flaggers row reads at a glance', () => {
  it('shows each technique as a chip in the Technique frequency colour', () => {
    const chips = [...render().querySelectorAll<HTMLElement>('.recid-chip')];
    expect(chips.map((c) => c.textContent)).toEqual([PRETTY_TECHNIQUE['fear-appeal'], PRETTY_TECHNIQUE['anger-trigger']]);
    expect(chips[0].getAttribute('style')).toContain(TECHNIQUE_COLORS['fear-appeal']);
    expect(chips[1].getAttribute('style')).toContain(TECHNIQUE_COLORS['anger-trigger']);
  });

  it('splits the facts into two rows, recorded and passed first, with the number apart from its word', () => {
    const rows = [...render().querySelectorAll<HTMLElement>('.recid-facts')];
    expect(rows).toHaveLength(2);
    const facts = (row: HTMLElement) => [...row.querySelectorAll<HTMLElement>('[data-fact]')].map((f) => f.dataset.fact);
    expect(facts(rows[0])).toEqual(['recorded', 'passed']);
    expect(facts(rows[1])).toEqual(['forYou', 'sought', 'days']);
    const recorded = rows[0].querySelector<HTMLElement>('[data-fact="recorded"]')!;
    expect(recorded.querySelector('b')?.textContent).toBe('4');
    expect(recorded.textContent).toBe('4 items seen');
  });

  it('dims a zero instead of dropping it', () => {
    const host = render();
    const sought = host.querySelector<HTMLElement>('[data-fact="sought"]')!;
    expect(sought).not.toBeNull();
    expect(sought.textContent).toBe('0 sought');
    expect(sought.classList.contains('zero')).toBe(true);
    expect(host.querySelector('[data-fact="recorded"]')!.classList.contains('zero')).toBe(false);
  });

  // The first fact counts the account's items seen, so it carries that set's noun in every language.
  it('says the facts in each of the four languages', () => {
    const want: Record<Lang, string[]> = {
      en: ['4 items seen', '1 passed', '4 on For You', '0 sought', '1 day'],
      ro: ['4 elemente văzute', '1 trecute', '4 în For You', '0 căutate', '1 zi'],
      es: ['4 elementos vistos', '1 aprobados', '4 en Para ti', '0 buscados', '1 día'],
      'pt-BR': ['4 itens vistos', '1 aprovados', '4 no Para você', '0 buscados', '1 dia'],
    };
    for (const lang of Object.keys(want) as Lang[]) {
      const said = [...render(lang).querySelectorAll('[data-fact]')].map((f) => f.textContent);
      expect(said, lang).toEqual(want[lang]);
    }
  });

  it('keeps one word table per language, none of them missing', () => {
    for (const lang of ['en', 'ro', 'es', 'pt-BR'] as const) {
      const words = DASHBOARD_STRINGS[lang].recidFactWords;
      expect(words, lang).toBeTruthy();
      for (const key of ['recorded', 'passed', 'forYou', 'sought', 'days', 'bursts'] as const) {
        expect(typeof words[key], `${lang}.${key}`).toBe('function');
        expect(words[key](2).length, `${lang}.${key}`).toBeGreaterThan(0);
      }
    }
  });

  it('sets the facts at body size in the text colour, in the one stylesheet both themes share', () => {
    const css = readSource('src/ui/dashboard/dashboard-design.css').replace(/\/\*[\s\S]*?\*\//g, '');
    const rule = css.match(/\.recid-facts\s*\{[^}]*\}/);
    expect(rule, 'a .recid-facts rule exists').not.toBeNull();
    const size = Number(rule![0].match(/font-size:\s*([\d.]+)px/)?.[1] ?? 0);
    expect(size).toBeGreaterThanOrEqual(12);
    expect(rule![0]).toMatch(/color:\s*var\(--fw-text(-secondary)?\)/);
  });
});
