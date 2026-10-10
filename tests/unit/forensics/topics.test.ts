// Sequence analysis slice 1 — topic fingerprints + theme clustering
// (src/forensics/topics.ts). Locks: diacritic folding, hashtag/handle
// atomicity, the mid-sentence entity heuristic, determinism across input
// order, the MIN_THEME_SIZE floor, pass-record inclusion, and tolerance of
// text-less / cancelled records.

import { describe, it, expect } from 'vitest';
import type { ForensicRecord } from '../../../src/types/forensic';
import {
  foldTerm,
  tokenizeText,
  detectFingerprintLang,
  recordAnalysisText,
  buildFingerprints,
  buildThemes,
  MIN_THEME_SIZE,
} from '../../../src/forensics/topics';

let seq = 0;
function rec(text: string, opts: Partial<ForensicRecord> = {}): ForensicRecord {
  seq++;
  return {
    id: opts.id ?? `r${seq}`,
    timestamp: opts.timestamp ?? new Date(Date.UTC(2026, 5, 1, 10, seq)).toISOString(),
    platform: (opts.platform ?? 'tiktok') as ForensicRecord['platform'],
    originalText: text,
    author: opts.author ?? 'someone',
    ...opts,
  } as ForensicRecord;
}

describe('foldTerm + tokenizeText', () => {
  it('folds Romanian diacritics so spellings collapse to one term', () => {
    expect(foldTerm('Alegeri')).toBe('alegeri');
    expect(foldTerm('ALEGERI')).toBe('alegeri');
    expect(foldTerm('ședință')).toBe('sedinta');
  });

  it('keeps hashtags and handles atomic', () => {
    const tokens = tokenizeText('check #DietChallenge from @fit_guru now');
    expect(tokens.find((t) => t.folded === '#dietchallenge')?.kind).toBe('hashtag');
    expect(tokens.find((t) => t.folded === '@fit_guru')?.kind).toBe('handle');
  });

  it('tags mid-sentence capitalized words as entities, not sentence-initial ones', () => {
    const tokens = tokenizeText('Astazi am vazut un clip despre Popescu. Maine vad altul.');
    expect(tokens.find((t) => t.folded === 'popescu')?.kind).toBe('entity');
    // 'Astazi' and 'Maine' are sentence-initial — ordinary words.
    expect(tokens.find((t) => t.folded === 'astazi')?.kind).toBe('word');
  });

  it('drops stopwords, URLs, and short tokens', () => {
    const tokens = tokenizeText('the and pentru care https://example.com/x ab');
    expect(tokens).toHaveLength(0);
  });
});

describe('detectFingerprintLang', () => {
  it('tags clear Romanian and clear English', () => {
    expect(
      detectFingerprintLang('acesta este un clip despre care vorbeste toata lumea pentru ca este interesant'),
    ).toBe('ro');
    expect(
      detectFingerprintLang('this is the video that everyone is talking about because it is interesting'),
    ).toBe('en');
  });
});

describe('recordAnalysisText', () => {
  it('joins post text, caption, and video evidence; tolerates absences', () => {
    const r = rec('caption text', {
      roomCaption: 'room',
      videoContext: {
        overlayText: 'overlay',
        scene: 's',
        contentType: 'other',
        techniques: [],
        severity: 0,
        model: 'm',
        frameCount: 1,
        description: 'desc',
        transcript: 'spoken words',
        audioModel: 'w',
      },
    });
    const text = recordAnalysisText(r);
    expect(text).toContain('caption text');
    expect(text).toContain('overlay');
    expect(text).toContain('spoken words');
    expect(recordAnalysisText(rec(''))).toBe('');
  });
});

describe('buildFingerprints', () => {
  it('skips cancelled / text-less records, includes pass records', () => {
    const records = [
      rec('elections candidate rally speech tonight', { verdict: 'pass' }),
      rec('', { verdict: 'flagged' }),
      rec('elections candidate rally', { verdict: 'cancelled-stale' }),
    ];
    const { fingerprints } = buildFingerprints(records);
    expect(fingerprints).toHaveLength(1);
    expect(fingerprints[0].flagged).toBe(false); // pass record included, marked unflagged
  });

  it('records the most frequent original spelling as the surface form', () => {
    const records = [
      rec('Popescu spoke about Popescu again', { verdict: 'pass' }),
      rec('vote popescu', { verdict: 'pass' }),
    ];
    const { surfaceForms } = buildFingerprints(records);
    expect(surfaceForms.get('popescu')).toBe('Popescu');
  });
});

describe('buildThemes', () => {
  const politician = (i: number, day: number) =>
    rec(`Un clip despre Popescu si alegeri, campanie electorala video ${i}`, {
      verdict: 'pass',
      timestamp: new Date(Date.UTC(2026, 5, day, 12, i)).toISOString(),
    });
  const cooking = (i: number, day: number) =>
    rec(`O reteta delicioasa de ciorba cu legume proaspete numarul ${i}`, {
      verdict: 'pass',
      timestamp: new Date(Date.UTC(2026, 5, day, 13, i)).toISOString(),
    });

  it('clusters same-entity records into one theme with provenance + day counts', async () => {
    const records = [
      politician(1, 1), politician(2, 1), politician(3, 2), politician(4, 3),
      cooking(1, 1), cooking(2, 2), cooking(3, 2),
      rec('completely unrelated solitary gardening post about tulips', { verdict: 'pass' }),
    ];
    const { themes, assignment } = await buildThemes(records);
    expect(themes.length).toBe(2); // singleton never reaches MIN_THEME_SIZE
    const pol = themes.find((t) => t.label.toLowerCase().includes('popescu'));
    expect(pol).toBeDefined();
    expect(pol!.recordCount).toBe(4);
    expect(pol!.daysActive).toBe(3);
    expect(pol!.memberRecordIds).toHaveLength(4);
    expect(pol!.topEntities.join(' ')).toContain('Popescu');
    for (const rid of pol!.memberRecordIds) {
      expect(assignment.get(rid)).toBe(pol!.id);
    }
  });

  it(`drops clusters smaller than MIN_THEME_SIZE (${MIN_THEME_SIZE})`, async () => {
    const records = [
      rec('quantum physics lecture notes university', { verdict: 'pass' }),
      rec('quantum physics homework university notes', { verdict: 'pass' }),
    ];
    const { themes } = await buildThemes(records);
    expect(themes).toHaveLength(0);
  });

  it('is deterministic across input order (same themes, same ids)', async () => {
    const records = [
      politician(1, 1), politician(2, 1), politician(3, 2),
      cooking(1, 1), cooking(2, 2), cooking(3, 2),
    ];
    const a = await buildThemes(records);
    const b = await buildThemes([...records].reverse());
    expect(b.themes.map((t) => t.id)).toEqual(a.themes.map((t) => t.id));
    expect(b.themes.map((t) => t.memberRecordIds)).toEqual(a.themes.map((t) => t.memberRecordIds));
  });

  it('folds diacritic variants of the same word into one theme', async () => {
    const records = [
      rec('Discuție despre alegeri și candidați importanți', { verdict: 'pass' }),
      rec('discutie despre ALEGERI si candidati la primarie', { verdict: 'pass' }),
      rec('alta discutie despre alegeri, candidati, primarie azi', { verdict: 'pass' }),
    ];
    const { themes } = await buildThemes(records);
    expect(themes).toHaveLength(1);
    expect(themes[0].recordCount).toBe(3);
  });

  it('counts flagged members and severity from the records', async () => {
    const records = [
      rec('miracle diet pill burns fat instantly buy', {
        verdict: 'flagged',
        techniques: [{ name: 'misleading-format', severity: 7 }] as unknown as ForensicRecord['techniques'],
      }),
      rec('miracle diet pill instantly results buy now', { verdict: 'pass' }),
      rec('this miracle diet pill really burns fat', { verdict: 'pass' }),
    ];
    const { themes } = await buildThemes(records);
    expect(themes).toHaveLength(1);
    expect(themes[0].flaggedCount).toBe(1);
    expect(themes[0].severitySum).toBe(7);
  });
});
