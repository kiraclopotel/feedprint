// Most pattern classifiers reach their verdict through this scorer, so these tests pin its arithmetic
// on real sentences: the weights, the quote, register, vulnerability and news dampeners, severity,
// the present threshold, confidence, and which evidence is shown. A test marked `fails` states a
// defect found here and left for its own fix; when the fix lands, the marker comes off.
import { describe, expect, it } from 'vitest';
import { buildContext } from '../../../../src/core/techniques/linguistic-features';
import { booleanSignal, patternSignal, score } from '../../../../src/core/techniques/scoring';
import type { ScoringOptions, SignalSpec } from '../../../../src/core/techniques/scoring';

const always = (weight: number): SignalSpec => booleanSignal('always', weight, () => true);
const run = (text: string, signals: SignalSpec[], extra: Partial<ScoringOptions> = {}) =>
  score(buildContext(text), { technique: 'fear-appeal', signals, ...extra });
const confidenceAt = (raw: number) => 0.45 + (1 - Math.exp(-raw * 0.22)) * 0.5;

describe('patternSignal', () => {
  it('gives one hit per distinct match, with its weight, the matched text and its position', () => {
    const signal = patternSignal('act-now', 2, [/\bact now\b/gi]);
    const { hits } = signal.detect(buildContext('Act now: the offer ends tonight, act NOW or miss it'));
    expect(hits).toEqual([
      { signalId: 'act-now', weight: 2, evidence: 'Act now', matchStart: 0, inQuote: false },
    ]);
  });

  it('keeps accents in the evidence, which comes from the normalized text', () => {
    const signal = patternSignal('act-now', 2, [/\bactúa ya\b/gi, /\baja agora\b/gi, /\bacționează acum\b/gi]);
    expect(signal.detect(buildContext('¡Actúa ya o lo perderás todo!')).hits.map((h) => h.evidence)).toEqual(['Actúa ya']);
    expect(signal.detect(buildContext('Aja agora, antes que seja tarde')).hits.map((h) => h.evidence)).toEqual(['Aja agora']);
    expect(signal.detect(buildContext('Acționează acum sau pierzi tot')).hits.map((h) => h.evidence)).toEqual(['Acționează acum']);
  });

  it('stops at 3 hits unless told otherwise, across all its patterns', () => {
    const text = 'Buy now, order today, click here, limited time, free shipping';
    const promo = /\b(buy now|order today|click here|limited time|free shipping)\b/gi;
    expect(patternSignal('promo', 1, [promo]).detect(buildContext(text)).hits.map((h) => h.evidence))
      .toEqual(['Buy now', 'order today', 'click here']);
    const two = patternSignal('promo', 1, [/\bbuy now\b/gi, /\bfree shipping\b/gi], { maxHits: 1 });
    expect(two.detect(buildContext(text)).hits.map((h) => h.evidence)).toEqual(['Buy now']);
  });

  it('takes one match from a pattern without the g flag, and every distinct one from a global pattern', () => {
    const ctx = buildContext('Comandă acum sau azi');
    expect(patternSignal('now', 1, [/\b(acum|azi)\b/i]).detect(ctx).hits.map((h) => h.evidence)).toEqual(['acum']);
    expect(patternSignal('now', 1, [/\b(acum|azi)\b/gi]).detect(ctx).hits.map((h) => h.evidence)).toEqual(['acum', 'azi']);
  });

  it('counts the same text once across patterns, whatever its case', () => {
    const signal = patternSignal('promo', 1, [/\bpromo code\b/gi, /\bPROMO CODE\b/g]);
    expect(signal.detect(buildContext('Use PROMO CODE now, promo code inside')).hits).toHaveLength(1);
  });

  it('starts a shared global pattern from the beginning every time', () => {
    const pattern = /\bpromo\b/gi;
    pattern.lastIndex = 999;
    expect(patternSignal('promo', 1, [pattern]).detect(buildContext('promo inside')).hits).toHaveLength(1);
    expect(patternSignal('promo', 1, [pattern]).detect(buildContext('promo inside')).hits).toHaveLength(1);
  });

  it('reads the decoded text only when asked, and then shows the decoded words', () => {
    const ctx = buildContext('C@t@strophic news for your family');
    expect(patternSignal('doom', 2, [/\bcatastrophic\b/gi]).detect(ctx).hits).toEqual([]);
    const decoded = patternSignal('doom', 2, [/\bcatastrophic\b/gi], { matchAggressive: true }).detect(ctx);
    expect(decoded.hits.map((h) => h.evidence)).toEqual(['Catastrophic']);
  });

  it('marks a match inside quoted speech', () => {
    const { hits } = patternSignal('regret', 3, [/\byou will regret this\b/gi])
      .detect(buildContext('She told me "you will regret this" and left'));
    expect(hits).toEqual([
      { signalId: 'regret', weight: 3, evidence: 'you will regret this', matchStart: 13, inQuote: true },
    ]);
  });
});

describe('booleanSignal', () => {
  const shouting = booleanSignal(
    'shouting', 1.5,
    (ctx) => ctx.features.allCapsWordCount >= 2,
    (ctx) => `${ctx.features.allCapsWordCount} all-caps words`,
  );

  it('gives one hit when its test passes, with the evidence the extractor writes', () => {
    expect(shouting.detect(buildContext('STOP scrolling and look NOW')).hits)
      .toEqual([{ signalId: 'shouting', weight: 1.5, evidence: '2 all-caps words' }]);
  });

  it('gives no hit when its test fails, and its own id as evidence when it has no extractor', () => {
    expect(shouting.detect(buildContext('Stop scrolling and look now')).hits).toEqual([]);
    expect(always(1).detect(buildContext('anything')).hits[0].evidence).toBe('always');
  });
});

describe('score: weights and threshold', () => {
  const threat = [
    patternSignal('act-now', 2, [/\bact now\b/gi]),
    patternSignal('family', 1.5, [/\byour family\b/gi]),
  ];

  it('adds the weights of every hit and rounds the sum for severity', () => {
    const result = run('Act now or your family will suffer tonight', threat);
    expect(result.register).toBe('unknown');
    expect(result.rawScore).toBe(3.5);
    expect(result.severity).toBe(4);
    expect(result.present).toBe(true);
    expect(result.technique).toBe('fear-appeal');
    expect(result.evidence).toEqual(['Act now', 'your family']);
    expect(result.explain).toEqual(['matched 2 signal(s): act-now, family']);
  });

  it('adds structural hits as they come, without the quote dampener', () => {
    const result = run('She told me "act now" and left', [], {
      structural: () => [{ signalId: 'caps', weight: 2, evidence: 'caps', inQuote: true }],
    });
    expect(result.rawScore).toBe(2);
    expect(result.signals[0].dampened).toBeUndefined();
  });

  it('is present from a score of exactly 3, or from the threshold given', () => {
    expect(run('Act now', [always(3)]).present).toBe(true);
    expect(run('Act now', [always(2.9)]).present).toBe(false);
    expect(run('Act now', [always(4)], { presentThreshold: 5 }).present).toBe(false);
  });

  it('rounds and clamps severity to 0 through 10, or uses the map given', () => {
    expect(run('Act now', [always(2.5)]).severity).toBe(3);
    expect(run('Act now', [always(0.4)]).severity).toBe(0);
    expect(run('Act now', [always(14)]).severity).toBe(10);
    expect(run('Act now', [always(4)], { severityMap: (raw) => raw * 2 }).severity).toBe(8);
  });

  it('gives no hits a score of 0, a severity of 0 and a confidence of 0.45', () => {
    const result = run('The weather is nice today', threat);
    expect(result).toMatchObject({ rawScore: 0, severity: 0, present: false, evidence: [], signals: [], explain: [] });
    expect(result.confidence).toBeCloseTo(0.45, 10);
  });
});

describe('score: quoted speech', () => {
  const threat = [
    patternSignal('act-now', 2, [/\bact now\b/gi]),
    patternSignal('family', 1.5, [/\byour family\b/gi]),
  ];

  it('counts a quoted match at 30% and marks it, and shows it only when nothing else matched', () => {
    const result = run('She told me "act now or your family will suffer" and walked away', threat);
    expect(result.rawScore).toBeCloseTo(2 * 0.3 + 1.5 * 0.3, 10);
    expect(result.present).toBe(false);
    expect(result.signals.every((h) => h.dampened && h.reason === 'inside-quote')).toBe(true);
    expect(result.evidence).toEqual(['act now', 'your family']);
    expect(result.explain).toContain('2 match(es) inside quoted speech → each ×0.3');
  });

  it('uses the dampener given', () => {
    const result = run('She told me "act now" and left', threat, { quoteDampener: 0.5 });
    expect(result.rawScore).toBe(1);
  });

  it('hides a quoted match from the evidence when an unquoted one exists', () => {
    const result = run('Act now, or as he said "your family will pay"', threat);
    expect(result.rawScore).toBeCloseTo(2 + 1.5 * 0.3, 10);
    expect(result.evidence).toEqual(['Act now']);
    expect(result.signals).toHaveLength(2);
  });

  it('keeps the four heaviest hits as evidence, heaviest first', () => {
    const result = run('Act now', [always(1), booleanSignal('b', 4, () => true), booleanSignal('c', 2, () => true),
      booleanSignal('d', 3, () => true), booleanSignal('e', 0.5, () => true)]);
    expect(result.evidence).toEqual(['b', 'd', 'c', 'always']);
  });

  it('scores a threat without contractions in full', () => {
    const result = run('Do not ignore this: they will hurt your family, it is coming', [
      patternSignal('harm', 3, [/\bhurt your family\b/gi]),
    ]);
    expect(result.rawScore).toBe(3);
    expect(result.present).toBe(true);
  });

  // Paired as quote marks, the apostrophes of don't and it's would put the threat inside a quote,
  // where it counts at 30%.
  it('scores the same threat written with contractions in full', () => {
    const result = run("Don't ignore this: they will hurt your family, it's coming", [
      patternSignal('harm', 3, [/\bhurt your family\b/gi]),
    ]);
    expect(result.rawScore).toBe(3);
    expect(result.present).toBe(true);
  });
});

describe('score: register', () => {
  const cases: Array<[string, string, number]> = [
    ['According to the CDC, 3,000 people died last year.', 'news-report', 0.4],
    ['Potrivit ministerului, 3.000 de oameni au murit anul trecut.', 'news-report', 0.4],
    ['Según el ministerio, 3.000 personas murieron el año pasado.', 'news-report', 0.4],
    ['Segundo o ministério, 3.000 pessoas morreram no ano passado.', 'news-report', 0.4],
    ["You won't believe what happened next!", 'clickbait', 1.2],
    ['No vas a creer lo que pasó después', 'clickbait', 1.2],
    ['Frete grátis, compre agora com cupom', 'promotional', 1.0],
    ['Yo creo que mi hermana tiene razón', 'conversational', 0.9],
    ['Eu și prietenii mei am mers la mare', 'conversational', 0.9],
    ['The weather is nice today', 'unknown', 1.0],
  ];

  it('multiplies the score by the default factor of each register', () => {
    for (const [text, register, factor] of cases) {
      const result = run(text, [always(5)]);
      expect(result.register, text).toBe(register);
      expect(result.rawScore, text).toBeCloseTo(5 * factor, 10);
    }
  });

  it('multiplies formal text by 0.7', () => {
    const text = 'The committee reviewed the proposal in detail and concluded that the budget for the coming year '
      + 'should remain at the current level, with a modest increase for the maintenance of public buildings and a '
      + 'review of transport costs, to be completed before the end of the spring session.';
    const result = run(text, [always(5)]);
    expect(result.register).toBe('formal');
    expect(result.rawScore).toBeCloseTo(3.5, 10);
    expect(result.explain).toContain('register=formal → ×0.70');
  });

  it('explains a register factor other than 1, and uses a policy that overrides it', () => {
    const news = 'According to the CDC, 3,000 people died last year.';
    expect(run(news, [always(5)]).explain).toContain('register=news-report → ×0.40');
    expect(run('The weather is nice today', [always(5)]).explain.some((l) => l.startsWith('register='))).toBe(false);
    expect(run(news, [always(5)], { registerPolicy: { 'news-report': 1 } }).rawScore).toBe(5);
  });
});

describe('score: vulnerability and news dampeners', () => {
  it('multiplies by 0.2 when the writer voices their own feelings, in all four languages', () => {
    for (const text of ["I'm scared of what happens next", 'Estoy muy triste y sola', 'Estou muito triste', 'Sunt foarte tristă']) {
      const result = run(text, [always(5)]);
      expect(result.register, text).toBe('unknown');
      expect(result.rawScore, text).toBeCloseTo(1, 10);
      expect(result.explain, text)
        .toContain('first-person-vulnerability detected → ×0.2 (someone EXPRESSING feelings, not manipulating)');
    }
  });

  it('leaves the score alone when the classifier turns that dampener off', () => {
    const result = run("I'm scared of what happens next", [always(5)], { dampenOnFirstPersonVulnerability: false });
    expect(result.rawScore).toBe(5);
    expect(result.explain.some((l) => l.startsWith('first-person'))).toBe(false);
  });

  it('dampens news once, by its register, and explains the attribution', () => {
    const result = run('According to the CDC, 3,000 people died last year.', [always(5)]);
    expect(result.rawScore).toBeCloseTo(2, 10);
    expect(result.explain).toContain('news-attribution detected (e.g. "according to") → dampened');
  });

  it('multiplies by a further 0.6 when attribution is present outside a news register', () => {
    // The same four patterns decide both fields, so buildContext never yields this pair; only a
    // context put together by hand reaches the extra factor.
    const handBuilt = { ...buildContext('Act now'), hasNewsAttribution: true };
    const result = score(handBuilt, { technique: 'fear-appeal', signals: [always(5)] });
    expect(result.rawScore).toBeCloseTo(3, 10);
  });

  it('a context from buildContext has news attribution only in the news register', () => {
    for (const text of [
      'According to the report, this shocking discount is real',
      'Conform datelor, prețurile cresc',
      'De acuerdo con la policía, nadie resultó herido',
      'De acordo com a polícia, ninguém ficou ferido',
    ]) {
      const c = buildContext(text);
      expect(c.hasNewsAttribution, text).toBe(true);
      expect(c.register, text).toBe('news-report');
    }
  });
});

describe('score: confidence', () => {
  it('rises with the score and stops at 0.92', () => {
    expect(run('Act now', [always(3)]).confidence).toBeCloseTo(confidenceAt(3), 10);
    expect(run('Act now', [always(8)]).confidence).toBeCloseTo(confidenceAt(8), 10);
    expect(run('Act now', [always(20)]).confidence).toBe(0.92);
  });

  it('is cut by a quarter for news and a tenth for formal text', () => {
    const news = run('According to the CDC, 3,000 people died last year.', [always(5)]);
    expect(news.confidence).toBeCloseTo(confidenceAt(2) * 0.75, 10);
    const formal = run('The committee reviewed the proposal in detail and concluded that the budget for the coming '
      + 'year should remain at the current level, with a modest increase for the maintenance of public buildings '
      + 'and a review of transport costs, to be completed before the end of the spring session.', [always(5)]);
    expect(formal.confidence).toBeCloseTo(confidenceAt(3.5) * 0.9, 10);
  });

  it('uses the map given, which receives the score, the severity and the context', () => {
    const result = run('Act now', [always(4)], {
      confidenceMap: (raw, severity, ctx) => (ctx.register === 'unknown' ? raw / 10 + severity / 100 : 0),
    });
    expect(result.confidence).toBeCloseTo(0.44, 10);
  });
});
