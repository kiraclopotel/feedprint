// Most pattern classifiers and the harm floor read this context instead of the raw text, so these
// tests pin what it gives on real sentences in the four languages the rules cover. A test marked `fails` states a
// defect this file found and left for its own fix; when the fix lands, the marker comes off.
import { describe, expect, it } from 'vitest';
import { buildContext, isInsideQuote } from '../../../../src/core/techniques/linguistic-features';
import { fearAppealClassifier } from '../../../../src/core/techniques/fear-appeal';

const ctx = (text: string) => buildContext(text);
const features = (text: string) => buildContext(text).features;

describe('normalized text', () => {
  it('keeps the original text untouched beside the normalized copy', () => {
    const text = 'She said “Run” — it’s over…';
    expect(ctx(text).original).toBe(text);
  });

  it('turns typographic quotes, dashes and the ellipsis into plain characters', () => {
    expect(ctx('She said “Run” — it’s over…').normalized)
      .toBe('She said "Run" - it\'s over...');
    expect(ctx('«Hola» ‹x› „sus‟ – − ‚ ‛').normalized)
      .toBe('"Hola" \'x\' "sus" - - \' \'');
  });

  it('drops zero-width, soft-hyphen, byte-order and direction marks that split a word', () => {
    expect(ctx('k​ill ca­tastrophe ﻿now ‮yes ⁠go ᠎up ‍ok ‎no').normalized)
      .toBe('kill catastrophe now yes go up ok no');
  });

  it('collapses runs of spaces and tabs to one space and keeps line breaks', () => {
    expect(ctx('Buy  \t now\n\nor never').normalized).toBe('Buy now\n\nor never');
  });

  it('composes a decomposed accent, so café matches whichever way it was typed', () => {
    expect(ctx('café mãe').normalized).toBe('café mãe');
  });
});

describe('aggressive text for camouflaged words', () => {
  it('folds diacritics in all four languages, both Romanian comma and cedilla forms included', () => {
    expect(ctx('Ești o rușine, ăsta e adevărul').aggressive).toBe('Esti o rusine, asta e adevarul');
    expect(ctx('ş ș ţ ț î â').aggressive).toBe('s s t t i a');
    expect(ctx('Según él, você não sabe nada').aggressive).toBe('Segun el, voce nao sabe nada');
  });

  it('decodes a leetspeak symbol that sits beside a letter', () => {
    expect(ctx('I will k!ll you').aggressive).toBe('I will kill you');
    expect(ctx('h3ll0 w0rld').aggressive).toBe('hello world');
    expect(ctx('l33t sp34k').aggressive).toBe('leet speak');
  });

  it('decodes every symbol in C@t@strophic, which a replace-based decoder missed', () => {
    expect(ctx('C@t@strophic').aggressive).toBe('Catastrophic');
  });

  it('leaves digits and symbols with no letter beside them alone', () => {
    expect(ctx('Call 0721 555 123 now').aggressive).toBe('Call 0721 555 123 now');
    expect(ctx('$100 off, 50% less').aggressive).toBe('$100 off, 50% less');
  });

  it('decodes a symbol at the start of a handle, since it sits beside a letter', () => {
    expect(ctx('@maria look').aggressive).toBe('amaria look');
  });

  // Fails: a ! beside a letter is decoded even at the end of a sentence, so the phrase ends "yourselfi".
  it.fails('keeps a sentence-final exclamation mark as punctuation', () => {
    expect(ctx('k1ll yourself!').aggressive).toBe('kill yourself!');
  });

  // Fails: the 5 sits beside the letter G, so the code decodes it although its comment says "5G" stays.
  it.fails('leaves 5G intact', () => {
    expect(ctx('5G towers').aggressive).toBe('5G towers');
  });

  // Fails: ĸ and ł are letters of their own with no decomposition, so folding leaves them in place.
  it.fails('reads the camouflaged word its own comment gives as an example', () => {
    expect(ctx('ĸĩłł').aggressive).toBe('kill');
  });
});

describe('features: words, capitals and punctuation', () => {
  const shout = 'STOP scrolling!!! You need to see this NOW, before they delete it?!?! Share it with everyone you know.';

  it('counts an English shouting post', () => {
    const f = features(shout);
    expect(f.charCount).toBe(shout.length);
    expect(f.wordCount).toBe(18);
    expect(f.sentenceCount).toBe(3);
    expect(f.capsRatio).toBeCloseTo(9 / 76, 10);
    expect(f.allCapsWordCount).toBe(2);
    expect(f.exclamationCount).toBe(5);
    expect(f.exclamationDensity).toBeCloseTo((5 / 18) * 100, 10);
    expect(f.questionCount).toBe(2);
    expect(f.punctuationRunCount).toBe(2);
  });

  it('counts an all-caps word only at three letters or more, acronyms and hyphenated words included', () => {
    const f = features('USA and COVID-19 hit 123 OK');
    expect(f.allCapsWordCount).toBe(2);
    expect(f.capsRatio).toBeCloseTo(10 / 16, 10);
  });

  it('keeps an apostrophe or a hyphen inside a word', () => {
    expect(features("Don't panic, it's only a drill.").wordCount).toBe(6);
    expect(features('Uită-te la asta').wordCount).toBe(3);
  });

  it('splits sentences at every run of . ! or ? followed by a space, abbreviations included', () => {
    const f = features('Wait... what?! No. The price is 3.5 million, e.g. more than last year.');
    expect(f.sentenceCount).toBe(5);
    expect(f.wordCount).toBe(15);
    expect(f.punctuationRunCount).toBe(1);
  });

  it('counts one sentence for text with no end mark and zero densities for no words', () => {
    expect(features('no end mark here').sentenceCount).toBe(1);
    const empty = features('');
    expect(empty.wordCount).toBe(0);
    expect(empty.sentenceCount).toBe(1);
    expect(empty.capsRatio).toBe(0);
    expect(empty.exclamationDensity).toBe(0);
    expect(empty.secondPersonDensity).toBe(0);
  });

  it('does not count the Spanish opening marks ¡ and ¿', () => {
    const f = features('¡Compra ya! ¿Por qué esperar? Nunca habrá otra oferta igual.');
    expect(f.exclamationCount).toBe(1);
    expect(f.questionCount).toBe(1);
    expect(f.sentenceCount).toBe(3);
    expect(f.punctuationRunCount).toBe(0);
  });

  it('counts capitals in Romanian letters outside ASCII', () => {
    const f = features('ȘTIRE: ÎNCHIS AZI');
    expect(f.capsRatio).toBe(1);
  });
});

describe('features: pronouns, orders and absolutes', () => {
  it('English: second person, third person plural, orders and absolutes', () => {
    const f = features('STOP scrolling!!! You need to see this NOW, before they delete it?!?! Share it with everyone you know.');
    expect(f.secondPersonCount).toBe(2);
    expect(f.secondPersonDensity).toBeCloseTo((2 / 18) * 100, 10);
    expect(f.firstPersonCount).toBe(0);
    expect(f.thirdPersonPluralCount).toBe(1);
    expect(f.imperativeHintCount).toBe(2);
    expect(f.superlativeCount).toBe(1);
  });

  it('English: never counts as both an order and an absolute', () => {
    const f = features('Never trust them');
    expect(f.imperativeHintCount).toBe(1);
    expect(f.superlativeCount).toBe(1);
    expect(f.thirdPersonPluralCount).toBe(1);
  });

  it('Spanish: object pronouns and usted count as second person', () => {
    const f = features('Quedan 3 días, 20% de descuento para ti y para usted');
    expect(f.secondPersonCount).toBe(2);
    expect(f.percentageMentionCount).toBe(1);
  });

  it('Spanish: first and third person plural, orders and absolutes', () => {
    expect(features('Ellos no quieren que sepas la verdad, nosotros sí')).toMatchObject({
      firstPersonCount: 1,
      thirdPersonPluralCount: 1,
    });
    expect(features('¡Compra ya! ¿Por qué esperar? Nunca habrá otra oferta igual.')).toMatchObject({
      imperativeHintCount: 2,
      superlativeCount: 1,
    });
  });

  it('Portuguese: teus, minha, eles, compre and melhor', () => {
    expect(features('Faltam 3 dias! Compre agora, e os teus amigos merecem o melhor.')).toMatchObject({
      secondPersonCount: 1,
      imperativeHintCount: 1,
      superlativeCount: 1,
      exclamationCount: 1,
    });
    expect(features('Eu acho que minha irmã tem razão, e eles também')).toMatchObject({
      firstPersonCount: 2,
      thirdPersonPluralCount: 1,
    });
  });

  it('Romanian: tu, tăi, a hyphenated order and mai', () => {
    expect(features('Tu cu prietenii tăi meritați tot ce e mai bun')).toMatchObject({
      secondPersonCount: 2,
      firstPersonCount: 0,
      superlativeCount: 1,
    });
    expect(features('Uită-te la asta! Distribuie acum')).toMatchObject({ imperativeHintCount: 2 });
  });

  it('Romanian: eu, and ei, le and lor as third person plural', () => {
    expect(features('Eu cred că ei vor să le ia banii lor')).toMatchObject({
      firstPersonCount: 1,
      thirdPersonPluralCount: 3,
    });
  });

  // Fails: the word pattern keeps the apostrophe, so you're and you'll are words the pronoun list lacks.
  it.fails('English: counts you in its contractions', () => {
    expect(features("You're a loser and you'll regret it").secondPersonCount).toBe(2);
  });

  // Fails: você is cut to "voc" at the ASCII word boundary, and the list spells it voce anyway.
  it.fails('Portuguese: counts você as second person', () => {
    expect(features('Eles não querem que você saiba').secondPersonCount).toBe(1);
  });

  // Fails: the Spanish list is spelled without accents while the features read accented text.
  it.fails('Spanish: counts único, más and jamás as absolutes', () => {
    expect(features('Es el único y el más perfecto, jamás visto').superlativeCount).toBe(4);
  });

  // Fails: the Spanish list writes más as "mas", which is the Portuguese word for but.
  it.fails('Portuguese: does not count mas (but) as an absolute', () => {
    expect(features('Ele tentou, mas não conseguiu').superlativeCount).toBe(0);
  });

  // An ASCII word boundary would cut a word that begins or ends in ă, â, î, ș or ț before the lookup.
  it('Romanian: counts vă and ție as second person', () => {
    expect(features('Vă spun ție adevărul').secondPersonCount).toBe(2);
  });

  // Cut at an ASCII word boundary, și (and) would become "i" and count as the English I.
  it('Romanian: does not count și (and) as first person', () => {
    expect(features('Politicienii fură și mint').firstPersonCount).toBe(0);
  });
});

describe('features: emoji, tags, links, countdowns and percentages', () => {
  it('counts hashtags, mentions, links and percentages', () => {
    const f = features('Only 3 days left! Get 50% off at https://shop.example.com/deal #sale #deal @maria');
    expect(f.hashtagCount).toBe(2);
    expect(f.mentionCount).toBe(1);
    expect(f.urlCount).toBe(1);
    expect(f.percentageMentionCount).toBe(1);
  });

  it('counts each pictograph, so a family joined by zero-width joiners counts as its three people', () => {
    // The joiners are stripped with the other invisible marks, which leaves three separate pictographs.
    expect(features('Heart ❤️ thumbs 👍🏽 family 👨‍👩‍👧 fire 🔥').emojiCount).toBe(6);
  });

  it('counts an English or Romanian countdown written with a singular or short unit', () => {
    expect(features('1 day left').countdownTokenCount).toBe(1);
    expect(features('24h left to order').countdownTokenCount).toBe(1);
    expect(features('10 min until the doors close').countdownTokenCount).toBe(1);
    expect(features('Oferta expira in 2 zile ramas').countdownTokenCount).toBe(1);
    expect(features('doar 3 ore rămas!').countdownTokenCount).toBe(1);
  });

  it('does not count a Spanish or Portuguese countdown: the pattern knows English and Romanian units only', () => {
    expect(features('Quedan 3 días').countdownTokenCount).toBe(0);
    expect(features('Faltam 3 dias!').countdownTokenCount).toBe(0);
  });

  // Fails: the unit list has singular words only, so "days" and "hours" never match.
  it.fails('English: counts "3 days left"', () => {
    expect(features('Only 3 days left!').countdownTokenCount).toBe(1);
  });

  // Fails: rămas must end at a word boundary, so the plural rămase does not match.
  it.fails('Romanian: counts "3 zile rămase"', () => {
    expect(features('Mai sunt 3 zile rămase').countdownTokenCount).toBe(1);
  });
});

describe('register', () => {
  it('reads news attribution in all four languages', () => {
    for (const text of [
      'According to the CDC, 3,000 people died last year.',
      'Potrivit ministerului, 3.000 de oameni au murit anul trecut.',
      'Según el ministerio, 3.000 personas murieron el año pasado.',
      'Segundo o ministério, 3.000 pessoas morreram no ano passado.',
    ]) {
      expect(ctx(text).register, text).toBe('news-report');
      expect(ctx(text).hasNewsAttribution, text).toBe(true);
    }
  });

  it('reads clickbait in all four languages', () => {
    for (const text of [
      "You won't believe what happened next!",
      'No vas a creer lo que pasó después',
      'Você não vai acreditar no que aconteceu depois',
      'N-o să crezi ce a urmat',
      'Incredibil ce a făcut vecinul',
    ]) {
      expect(ctx(text).register, text).toBe('clickbait');
    }
  });

  it('reads promotion in all four languages', () => {
    for (const text of [
      'Use promo code SAVE20 for free shipping',
      'Envío gratis y 20% de descuento, compra ahora',
      'Frete grátis, compre agora com cupom',
      'Reducere 50% și transport gratuit',
    ]) {
      expect(ctx(text).register, text).toBe('promotional');
    }
  });

  it('reads a short post with two first-person words and at most two exclamations as conversational', () => {
    for (const text of [
      'I think we should go, my friends and I loved it',
      'Yo creo que mi hermana tiene razón',
      'Eu acho que minha irmã tem razão',
      'Eu și prietenii mei am mers la mare',
      'I loved it! We went! My day was great',
    ]) {
      expect(ctx(text).register, text).toBe('conversational');
    }
    expect(ctx('I loved it! We went! My day! Great').register).toBe('unknown');
  });

  it('reads 40 or more calm words with few capitals as formal', () => {
    const words = ('The committee reviewed the proposal in detail and concluded that the budget for the coming year '
      + 'should remain at the current level, with a modest increase for the maintenance of public buildings and a '
      + 'review of transport costs, to be completed before the end of the spring session').split(' ');
    expect(ctx(words.slice(0, 40).join(' ') + '.').register).toBe('formal');
    expect(ctx(words.slice(0, 39).join(' ') + '.').register).toBe('unknown');
    expect(ctx(words.join(' ') + '!').register).toBe('unknown');
  });

  it('reads anything else as unknown', () => {
    expect(ctx('The weather is nice today').register).toBe('unknown');
  });

  it('puts news before clickbait, and clickbait before promotion', () => {
    expect(ctx('According to the report, this shocking discount is real').register).toBe('news-report');
    expect(ctx('This shocking discount ends soon').register).toBe('clickbait');
  });

  // If și counted as the English I, a Romanian post with two of them would read as conversational.
  it('Romanian: an angry post joined by și is not conversational', () => {
    expect(ctx('Politicienii fură și mint și ne distrug țara').register).toBe('unknown');
  });

  // Fails: the Romanian pattern needs an ASCII word boundary before ș, so the correct spelling never matches.
  it.fails('Romanian: reads Șocant as clickbait', () => {
    expect(ctx('Șocant: ce a făcut vecinul').register).toBe('clickbait');
  });

  // Fails: cumpără and limitată end in ă, where no ASCII word boundary falls, and "oferta?" cannot match ofertă.
  it.fails('Romanian: reads "Cumpără acum, ofertă limitată" as promotion', () => {
    expect(ctx('Cumpără acum, ofertă limitată').register).toBe('promotional');
  });

  // Fails: bare "segundo" also means second, so a Portuguese ordinal reads as news attribution.
  it.fails('Portuguese: second place is not news attribution', () => {
    expect(ctx('Ele ficou em segundo lugar na corrida').register).not.toBe('news-report');
  });
});

describe('first-person vulnerability', () => {
  it('reads a person voicing their own fear or sadness in all four languages', () => {
    for (const text of [
      "I'm scared of what happens next",
      'I’ve been depressed for months',
      'Im terrified',
      'Estoy muy triste y sola',
      'Me siento deprimida',
      'Estou muito triste',
      'Me sinto sozinha',
      'Sunt foarte tristă',
      'Mă simt singură',
      'M-am simțit rănit',
    ]) {
      expect(ctx(text).hasFirstPersonVulnerability, text).toBe(true);
    }
  });

  it('does not read fear aimed at someone else', () => {
    expect(ctx('You should be scared').hasFirstPersonVulnerability).toBe(false);
    expect(ctx('They are sad and alone').hasFirstPersonVulnerability).toBe(false);
  });

  // Fails: the English pattern has no slot for an intensifier, the gap the Romanian one already closed.
  it.fails("English: reads I'm so scared", () => {
    expect(ctx("I'm so scared").hasFirstPersonVulnerability).toBe(true);
  });

  // Fails: the Romanian adjectives have no end boundary, so singurul (the only one) matches singur (alone).
  it.fails('Romanian: "the only one who tells you the truth" is not vulnerability', () => {
    expect(ctx('Sunt singurul care îți spune adevărul').hasFirstPersonVulnerability).toBe(false);
  });
});

describe('quoted speech', () => {
  it('finds a double-quoted span with its position in the normalized text', () => {
    expect(ctx('She told me "YOU WILL REGRET THIS" and left').quotedSpans)
      .toEqual([{ start: 12, end: 34, text: 'YOU WILL REGRET THIS' }]);
  });

  it('finds a single-quoted span', () => {
    expect(ctx("He wrote 'buy now or lose it' in the chat").quotedSpans)
      .toEqual([{ start: 9, end: 29, text: 'buy now or lose it' }]);
  });

  it('finds Romanian and Spanish quotation marks once they are made plain', () => {
    expect(ctx('Ea a spus „nu mai pot” azi').quotedSpans)
      .toEqual([{ start: 10, end: 22, text: 'nu mai pot' }]);
    expect(ctx('El dijo «compra ya» otra vez').quotedSpans)
      .toEqual([{ start: 8, end: 19, text: 'compra ya' }]);
  });

  it('counts positions in the normalized text, where an ellipsis is three characters', () => {
    expect(ctx('Wait… "run now"').quotedSpans).toEqual([{ start: 8, end: 17, text: 'run now' }]);
  });

  it('finds each of two quotes, and a single quote nested in a double one as part of it', () => {
    expect(ctx('"one" and "two"').quotedSpans.map((s) => s.text)).toEqual(['one', 'two']);
    expect(ctx('He said "she wrote \'go away\' twice"').quotedSpans)
      .toEqual([{ start: 8, end: 35, text: "she wrote 'go away' twice" }]);
  });

  it('needs 3 to 300 characters between the marks, and a closing mark', () => {
    expect(ctx('He said "ok" and left').quotedSpans).toEqual([]);
    expect(ctx('an "unclosed quote here').quotedSpans).toEqual([]);
    const body = 'you will regret this, '.repeat(20);
    expect(ctx(`"${body.slice(0, 300)}"`).quotedSpans).toHaveLength(1);
    expect(ctx(`"${body.slice(0, 301)}"`).quotedSpans).toEqual([]);
  });

  // Paired as quote marks, the apostrophes of two contractions would make one quoted span.
  it('does not read the text between two contractions as a quote', () => {
    expect(ctx("Don't panic, it's only a drill.").quotedSpans).toEqual([]);
  });

  // Fails: a quote too short to count leaves its closing mark to pair with the next opening one.
  it.fails('a short quote does not shift the pairing onto the words between two quotes', () => {
    expect(ctx('say "no" or "yes"').quotedSpans).toEqual([{ start: 12, end: 17, text: 'yes' }]);
  });
});

describe('isInsideQuote', () => {
  const spans = ctx('She told me "YOU WILL REGRET THIS" and left').quotedSpans;

  it('includes the opening mark and excludes the position after the closing one', () => {
    expect(isInsideQuote(spans, 11)).toBe(false);
    expect(isInsideQuote(spans, 12)).toBe(true);
    expect(isInsideQuote(spans, 33)).toBe(true);
    expect(isInsideQuote(spans, 34)).toBe(false);
  });

  it('is false with no spans and checks every span when there are several', () => {
    expect(isInsideQuote([], 0)).toBe(false);
    const two = ctx('"one" and "two"').quotedSpans;
    expect(isInsideQuote(two, 11)).toBe(true);
    expect(isInsideQuote(two, 7)).toBe(false);
  });
});

describe('the one-entry cache', () => {
  it('returns the same context for the same text, and a fresh equal one once other text came between', () => {
    const text = 'Act now before it is too late';
    const first = buildContext(text);
    expect(buildContext(text)).toBe(first);
    buildContext('something else');
    const again = buildContext(text);
    expect(again).not.toBe(first);
    expect(again).toEqual(first);
  });
});

describe('quoted speech: an apostrophe inside a word is not a quote mark', () => {
  // Every match inside a quoted span is weighed at a quarter or less, so reading "Don't ... it's"
  // as a quotation hid the whole fear appeal between the two contractions.
  it('finds no quotation in a post whose only apostrophes are contractions', () => {
    const post = "Don't let them fool you, the apocalypse is coming and it's too late";
    expect(buildContext(post).quotedSpans).toEqual([]);
    expect(fearAppealClassifier.classify({ text: post }).present).toBe(true);
  });

  it('still finds a quotation that holds a contraction', () => {
    const post = "She wrote 'you won't survive what's coming' under my photo";
    expect(buildContext(post).quotedSpans.map(s => s.text)).toEqual([
      "you won't survive what's coming",
    ]);
  });
});

describe('word splitting: an accented letter is part of the word', () => {
  // JavaScript's \b counts 'î' and 'ț' as non-letters, so 'Îți' was cut to the English 'i' and
  // 'ție' to 'ie', and a Romanian post read as first person.
  it('counts the Romanian pronouns that begin with a diacritic', () => {
    const features = buildContext('Îți spun ție, voi sunteți de vină').features;
    expect(features.firstPersonCount).toBe(0);
    expect(features.secondPersonCount).toBe(3);
  });

  // Read whole, 'Îmi' is no longer cut to the Spanish 'mi', so the Romanian list must hold it.
  it('counts îmi as first person, with or without its diacritic', () => {
    const context = buildContext('Îmi e frică și îmi pare rău');
    expect(context.features.firstPersonCount).toBe(2);
    expect(context.register).toBe('conversational');
    expect(buildContext('Imi e frica si imi pare rau, iti spun').features).toMatchObject({
      firstPersonCount: 2,
      secondPersonCount: 1,
    });
  });
});
