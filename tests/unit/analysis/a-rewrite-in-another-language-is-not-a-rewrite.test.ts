// A softened comment must still be the person's sentence. On one day of the
// owner's own export an English comment came back rewritten into Turkish and
// went on the page under FeelingWise's own marker, and every gate passed it.
//
// The gate that should have caught it, `validateRewriteLanguage`, is a
// two-language leakage detector: `detectLanguage` scores English function
// words against Romanian ones and answers en / ro / mixed / unknown. Turkish
// scores zero on both, comes back 'unknown', and 'unknown' is accepted,
// because it is also what a short honest rewrite looks like.
//
// `detectIntroducedLetters` asks a question that needs no detector: a rewrite
// states the same claim with the charge taken out, so it cannot introduce a
// script or a letter the person never typed. The controls matter as much as
// the catches here: a gate that rejects loanwords, or Romanian spelled
// properly, would hide real comments instead of softening them, and that is
// the same defect pointing the other way.

import { describe, it, expect } from 'vitest';
import { detectIntroducedLetters, detectMissingExpectedLanguage, validateRewrite } from '../../../src/analysis/comment-rewriter';

describe('a rewrite that changed language', () => {
  it('catches the reported case: an English comment answered in Turkish', () => {
    const original = 'You are completely useless and everyone here knows it, just stop posting.';
    const turkish = 'Buradaki herkes bunu biliyor, lütfen paylaşımı bırak, çok yararsız.';
    expect(detectIntroducedLetters(turkish, original)).not.toBeNull();
    const verdict = validateRewrite(turkish, original);
    expect(verdict.valid).toBe(false);
    expect(verdict.reason).toBe('language-drift');
  });

  it('catches a whole script by name', () => {
    const original = 'This is the worst take I have read all week and you know it.';
    for (const [rewrite, script] of [
      ['Это худшее мнение, которое я читал за неделю.', 'Cyrillic'],
      ['这是我这周读到的最糟糕的观点。', 'Han'],
      ['אני חושב שזו הדעה הגרועה ביותר השבוע.', 'Hebrew'],
      // Japanese prose mixes kanji with kana, and the check answers with the
      // first script it finds rather than every one, so this reports Han. A
      // kana-only sentence is the one that reports Hiragana.
      ['この意見は今週読んだ中で最悪だ。', 'Han'],
      ['ひどいいけんだとおもう。', 'Hiragana'],
    ] as const) {
      expect(detectIntroducedLetters(rewrite, original), rewrite).toBe(script);
    }
  });
});

describe('a rewrite that did not change language', () => {
  it('leaves an ordinary English softening alone', () => {
    const original = 'You are completely useless and everyone here knows it, just stop posting.';
    const rewrite = 'I do not think this is working, and I would rather you posted less of it.';
    expect(detectIntroducedLetters(rewrite, original)).toBeNull();
    expect(validateRewrite(rewrite, original).valid).toBe(true);
  });

  it('lets Romanian be spelled properly even when the person did not', () => {
    // Somebody typing without diacritics is the normal case in Romanian, and
    // the rewriter putting them back is not a change of language.
    const original = 'Esti un prost si nu intelegi nimic din ce se intampla aici.';
    const rewrite = 'Nu sunt de acord cu tine și cred că înțelegi altfel situația de aici.';
    expect(detectIntroducedLetters(rewrite, original)).toBeNull();
  });

  it('lets English keep the accents it borrows', () => {
    const original = 'This cafe food is garbage and the naive owner should be ashamed.';
    const rewrite = 'I did not enjoy the café food, and I think the owner is being naïve about it.';
    expect(detectIntroducedLetters(rewrite, original)).toBeNull();
  });

  it('lets a rewrite keep a foreign word the original already carried', () => {
    // The person quoted Greek; softening their sentence must not mean
    // deleting what they quoted.
    const original = 'Nobody here cares about your stupid μηδέν argument, give it up already.';
    const rewrite = 'I do not find the μηδέν argument convincing, and I would leave it there.';
    expect(detectIntroducedLetters(rewrite, original)).toBeNull();
  });

  it('is not tripped by emoji, numbers or punctuation', () => {
    const original = 'This is rubbish!!! 100% garbage 🤡🤡 and you know it.';
    const rewrite = 'I think this is weak — about 100% not for me 🤡, and I would say so.';
    expect(detectIntroducedLetters(rewrite, original)).toBeNull();
  });
});

describe('the limit, held to on purpose', () => {
  it('does not catch a language whose letters the original already has', () => {
    // Turkish written with no ı, ğ or ş is plain ASCII, so nothing was
    // introduced and this check cannot see it. Written down as a case rather
    // than left to be discovered: a later reader who makes this pass has
    // built the second opinion the docblock asks for, not fixed a bug.
    const original = 'You are useless and everyone here knows it.';
    const asciiTurkish = 'Herkes bunu biliyor, bence burada bir sorun var.';
    expect(detectIntroducedLetters(asciiTurkish, original)).toBeNull();
  });
});

describe('a long rewrite with no trace of the language it should be in', () => {
  // The seven that the letter check cannot see, because their alphabet is one
  // English already borrows. Measured together with the controls below: this
  // pair of lists is the evidence for the 48-character bar.
  const ORIGINAL = 'You are completely useless and everyone here knows it, just stop posting.';
  const DRIFT: ReadonlyArray<readonly [string, string]> = [
    ['Turkish, no Romanian diacritics', 'Herkes bunu biliyor, lütfen paylasimi birak, cok yararsiz.'],
    ['Turkish, plain ASCII', 'Herkes bunu biliyor, bence burada bir sorun var.'],
    ['French', 'Je ne suis pas d accord avec toi et je prefererais que tu postes moins.'],
    ['German', 'Ich finde das nicht gut und wuerde mir weniger davon wuenschen.'],
    ['Spanish', 'No estoy de acuerdo contigo y preferiria que publicaras menos.'],
    ['Portuguese', 'Nao concordo com isso e preferia que publicasse menos.'],
    ['Italian', 'Non sono d accordo e preferirei che pubblicassi di meno.'],
  ];

  it('rejects every drift sample', () => {
    for (const [name, rewrite] of DRIFT) {
      expect(detectMissingExpectedLanguage(rewrite, ORIGINAL), name).not.toBeNull();
    }
  });

  it('accepts every genuine English softening, including the two with no function words', () => {
    const GENUINE = [
      'I do not think this is working, and I would rather you posted less of it.',
      'Overpriced plastic junk.',
      'Not for me.',
      'I disagree with this take.',
      'This looks badly made to me.',
      'I think the seller is exaggerating here.',
      'Cheap build, poor finish, disappointing.',
      'I would not buy it again.',
      'Honestly, quite underwhelming for the price.',
      'My experience was different.',
      'That claim needs a source.',
      'Strong words for a small problem.',
    ];
    for (const rewrite of GENUINE) {
      expect(detectMissingExpectedLanguage(rewrite, ORIGINAL), rewrite).toBeNull();
    }
  });

  it('says nothing about an original it cannot read', () => {
    // A Spanish original detects as neither English nor Romanian, so there is
    // no expected language to be missing and this check must stand aside
    // rather than reject everything.
    const spanish = 'No estoy de acuerdo contigo y preferiria que publicaras mucho menos que esto.';
    expect(detectMissingExpectedLanguage('Cualquier cosa escrita aqui en un texto bastante largo.', spanish)).toBeNull();
  });

  it('holds the same line for Romanian', () => {
    const original = 'Esti un prost si nu intelegi nimic din ce se intampla aici, chiar deloc.';
    const english = 'I do not agree with you, and I would put it very differently myself.';
    expect(detectMissingExpectedLanguage(english, original)).not.toBeNull();
    const romanian = 'Nu sunt de acord cu tine si cred ca situatia de aici este cu totul alta.';
    expect(detectMissingExpectedLanguage(romanian, original)).toBeNull();
  });
});
