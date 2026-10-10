// FeelingWise — lang-detect unit tests
//
// Locks the contract for the heuristic RO/EN detector used by the TikTok
// bundle extractor to set ThreadSnapshot.locale_hint. The pipeline then
// propagates locale_hint → L1 language_preference → L1.locale → L2 templates,
// so a regression here silently mislanguage-izes every rendered overlay.

import { describe, it, expect } from 'vitest';
import { detectLanguage, detectThreadLanguage } from '../../../src/core/lang-detect';

describe('detectLanguage — base contract', () => {
  it('returns unknown for empty / whitespace input', () => {
    expect(detectLanguage('').language).toBe('unknown');
    expect(detectLanguage('   \n\t  ').language).toBe('unknown');
  });

  it('returns unknown when neither signal crosses MIN_SIGNAL', () => {
    // Two Romanian words score 2, one under the minimum of 3, so this reaches the 'unknown' branch.
    const r = detectLanguage('nu pe');
    expect(r.language).toBe('unknown');
  });
});

describe('detectLanguage — Romanian', () => {
  it('locks onto RO when diacritics are present', () => {
    // 3 diacritic hits × weight 2 = 6 → way over MIN_SIGNAL
    const r = detectLanguage('Ești foarte bun și puternic.');
    expect(r.language).toBe('ro');
    expect(r.ro_score).toBeGreaterThan(r.en_score * 3);
  });

  it('locks onto RO from function words alone (diacritic-stripped text)', () => {
    // Sloppy typing with no diacritics — common on older TikTok comments.
    // Needs enough RO function words to cross MIN_SIGNAL.
    const r = detectLanguage('si nu este asa cum sunt ei care cu de pe la');
    expect(r.language).toBe('ro');
  });

  it('handles cedilla variants (older RO typography)', () => {
    // Ş / Ţ cedilla form instead of Ș / Ț comma form
    const r = detectLanguage('Aşa este şi aşa trebuie');
    expect(r.language).toBe('ro');
  });
});

describe('detectLanguage — Spanish and Portuguese are not Romanian', () => {
  // A Romanian verdict switches the Teen marker into Romanian and holds the rewrite to Romanian,
  // so a Spanish or Portuguese reader must never get one from the words the languages share.
  it('does not call a Spanish sentence Romanian', () => {
    const r = detectLanguage(
      'El contenido presenta a un grupo de personas como culpables de la crisis de la vivienda.',
    );
    expect(r.language).not.toBe('ro');
  });

  it('does not call a Spanish comment Romanian', () => {
    const r = detectLanguage(
      'No me gusta nada lo que dice este video, la gente se cree todo lo que ve en la red.',
    );
    expect(r.language).not.toBe('ro');
  });

  it('does not call a Portuguese sentence Romanian', () => {
    const r = detectLanguage('Eu quero dar um presente para ela, mas não sei se ela vai gostar de flores.');
    expect(r.language).not.toBe('ro');
  });

  it('does not call a Spanish comment that writes hasta as asta Romanian', () => {
    const r = detectLanguage('asta la vista, se acabo la fiesta de este año');
    expect(r.language).not.toBe('ro');
  });

  it('still counts the shared words in a Romanian comment with a single diacritic', () => {
    const r = detectLanguage('MARS PSD-AUR SOBOLANII violatori de minore politicieni corupți de la putere');
    expect(r.language).toBe('ro');
  });

  it('counts the shared words in a Romanian comment with no diacritic but a word only Romanian has', () => {
    const r = detectLanguage('Iar au furat de la noi, se vede clar');
    expect(r.language).toBe('ro');
  });

  // Nothing in it is Romanian only, and "de la" is as Spanish as it is Romanian, so a rewrite of it
  // skips the Romanian language check; calling it Romanian would call the Spanish sentences above so too.
  it('leaves a Romanian comment with no diacritic and no Romanian-only word unknown', () => {
    const r = detectLanguage('MARS PSD-AUR SOBOLANII violatori de minore politicieni corupti de la putere');
    expect(r.language).toBe('unknown');
  });
});

describe('detectLanguage — English', () => {
  it('locks onto EN on a sentence with multiple function words', () => {
    const r = detectLanguage('This is the thing that you should not do in this case');
    expect(r.language).toBe('en');
    expect(r.en_score).toBeGreaterThan(r.ro_score * 3);
  });

  it('does not false-positive RO on EN text that contains "nu" as part of another word', () => {
    // Word-boundary check: "nuclear" should NOT hit the RO word "nu".
    const r = detectLanguage('The nuclear reactor is in the building and they are not worried');
    expect(r.language).toBe('en');
  });
});

describe('detectLanguage — mixed', () => {
  it('returns mixed when both languages present comparably', () => {
    // Multiple hits each side, neither dominates 3×
    const r = detectLanguage(
      'Este foarte bun și interesant but the author is not really honest with you',
    );
    expect(r.language).toBe('mixed');
    expect(r.ro_score).toBeGreaterThanOrEqual(3);
    expect(r.en_score).toBeGreaterThanOrEqual(3);
  });
});

describe('detectThreadLanguage — post + comments blend', () => {
  it('takes the dominant language across post + comments', () => {
    const post = '#fyp #foryou';  // Short / ambiguous
    const comments = [
      'This is absolutely the best take I have seen on this',
      'You are right, they should not do that',
      'I think this is the kind of thing that goes viral',
    ];
    const r = detectThreadLanguage(post, comments);
    expect(r.language).toBe('en');
  });

  it('picks RO when comments are RO even if post is hashtags', () => {
    const post = '#pentruvoi';
    const comments = [
      'Asta este foarte adevărat și trebuie spus',
      'Nu știu ce să mai zic, dar sunt de acord',
      'Când am văzut asta mi-am dat seama că e bine',
    ];
    const r = detectThreadLanguage(post, comments);
    expect(r.language).toBe('ro');
  });

  it('gracefully handles empty comment list', () => {
    const r = detectThreadLanguage('Bună ziua și bine ai venit aici prieteni', []);
    expect(r.language).toBe('ro');
  });

  it('only blends first 10 comments (perf bound)', () => {
    // 10 RO comments + many EN comments after — RO should still win because
    // we cap at first 10 per docstring.
    const post = '';
    const comments = [
      ...Array(10).fill('Este foarte bun și frumos'),
      ...Array(50).fill('This is the thing that you should do now'),
    ];
    const r = detectThreadLanguage(post, comments);
    expect(r.language).toBe('ro');
  });
});

describe('detectLanguage — purity', () => {
  it('is deterministic (same input → same output)', () => {
    const text = 'Ești foarte bun și puternic.';
    const a = detectLanguage(text);
    const b = detectLanguage(text);
    expect(a).toEqual(b);
  });
});

