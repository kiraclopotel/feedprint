// FeelingWise — fear-appeal fixtures
//
// Labeled test cases for the rebuilt fear-appeal classifier.
// Each case has an expected outcome and a category so the dev-harness
// can report pass/fail grouped by type (positive / negative / adversarial / etc.).
//
// Categories:
//   positive             — should be detected (present=true, severity>=3)
//   positive-adversarial — obfuscated; should still be detected
//   negative-news        — factual news/report; should NOT be detected
//   negative-quoted      — fear vocab inside quotes; should be dampened
//   negative-vulnerability — first-person emotional expression; NOT detected
//   negative-benign      — unrelated content; NOT detected
//   borderline           — genuinely ambiguous; outcome documented not strictly asserted
//
// These fixtures are used by:
//   • unit tests (tests/unit/core/techniques/fear-appeal.test.ts)
//   • a local dev harness that printed comparative scores (never committed)

type FixtureCategory =
  | 'positive'
  | 'positive-adversarial'
  | 'negative-news'
  | 'negative-quoted'
  | 'negative-vulnerability'
  | 'negative-benign'
  | 'borderline';

export interface FearAppealCase {
  id: string;
  category: FixtureCategory;
  text: string;
  expectPresent: boolean;
  expectMinSeverity?: number;
  expectMaxSeverity?: number;
  note?: string;
}

export const FEAR_APPEAL_CASES: FearAppealCase[] = [
  // ── POSITIVE: catastrophizing ──────────────────────────────────────────
  {
    id: 'pos-catastrophe-01',
    category: 'positive',
    text: 'This is a doomsday scenario for your family. TOTAL COLLAPSE is coming.',
    expectPresent: true,
    expectMinSeverity: 5,
    note: 'catastrophe + direct-threat + caps-scream',
  },
  {
    id: 'pos-catastrophe-02',
    category: 'positive',
    text: 'Armageddon is approaching. Your children will not survive what comes next.',
    expectPresent: true,
    expectMinSeverity: 5,
  },
  {
    id: 'pos-catastrophe-ro-01',
    category: 'positive',
    text: 'Vine apocalipsa! Copiii tăi vor suferi. Nu mai e mult.',
    expectPresent: true,
    expectMinSeverity: 4,
    note: 'Romanian catastrophe + direct threat',
  },

  // ── POSITIVE: hidden-threat / forbidden knowledge ─────────────────────
  {
    id: 'pos-hidden-01',
    category: 'positive',
    text: "They don't want you to know the real truth about what's in your food.",
    expectPresent: true,
    expectMinSeverity: 3,
  },
  {
    id: 'pos-hidden-02',
    category: 'positive',
    text: 'Doctors are hiding this deadly fact from you. Share before they delete it!',
    expectPresent: true,
    expectMinSeverity: 5,
  },
  {
    id: 'pos-hidden-03',
    category: 'positive',
    text: 'BANNED VIDEO: watch this before they take it down forever.',
    expectPresent: true,
    expectMinSeverity: 3,
  },
  {
    id: 'pos-hidden-ro-01',
    category: 'positive',
    text: 'Nu vor să știi adevărul. Distribuie înainte să fie cenzurat.',
    expectPresent: true,
    expectMinSeverity: 3,
  },

  // ── POSITIVE: direct consequence threats ──────────────────────────────
  {
    id: 'pos-consequence-01',
    category: 'positive',
    text: "If you don't act now, your children will suffer the consequences.",
    expectPresent: true,
    expectMinSeverity: 3,
  },
  {
    id: 'pos-consequence-02',
    category: 'positive',
    text: "Ignore this and your family will regret it forever. It will be too late.",
    expectPresent: true,
    expectMinSeverity: 3,
  },

  // ── POSITIVE: countdown fear ──────────────────────────────────────────
  {
    id: 'pos-countdown-01',
    category: 'positive',
    text: 'We only have 5 years before total collapse. Scientists are warning us.',
    expectPresent: true,
    expectMinSeverity: 3,
  },
  {
    id: 'pos-countdown-02',
    category: 'positive',
    text: 'Less than 72 hours left until the catastrophe. Prepare NOW.',
    expectPresent: true,
    expectMinSeverity: 3,
  },

  // ── POSITIVE: clickbait register boost ────────────────────────────────
  {
    id: 'pos-clickbait-01',
    category: 'positive',
    text: "You won't believe what they're hiding about this deadly threat to your family!!!",
    expectPresent: true,
    expectMinSeverity: 4,
    note: 'clickbait register × direct-threat',
  },

  // ── POSITIVE ADVERSARIAL: obfuscation bypasses ────────────────────────
  {
    id: 'adv-smart-quotes-01',
    category: 'positive-adversarial',
    text: 'They don\u2019t want you to know the truth about this deadly threat to your family.',
    expectPresent: true,
    expectMinSeverity: 3,
    note: 'smart apostrophe should normalize to ASCII',
  },
  {
    id: 'adv-zwsp-01',
    category: 'positive-adversarial',
    text: 'They don\u200Bt want you\u200B to know the real truth about catastroph\u200Be coming.',
    expectPresent: true,
    expectMinSeverity: 3,
    note: 'zero-width spaces injected into keywords',
  },
  {
    id: 'adv-leetspeak-01',
    category: 'positive-adversarial',
    text: 'C@t@strophic d3@dly thr3@t to your family. Doctors are h1d1ng it.',
    expectPresent: true,
    expectMinSeverity: 3,
    note: 'leetspeak substitutions',
  },
  {
    id: 'adv-caps-01',
    category: 'positive-adversarial',
    text: 'THE GOVERNMENT IS HIDING DEADLY INFORMATION FROM YOU AND YOUR CHILDREN WILL SUFFER',
    expectPresent: true,
    expectMinSeverity: 5,
    note: 'all-caps screaming + hidden-threat + direct-threat',
  },

  // ── NEGATIVE: news reports (attribution should dampen) ────────────────
  {
    id: 'neg-news-01',
    category: 'negative-news',
    text: 'According to the CDC, flu deaths rose this year. Officials say more caution is warranted.',
    expectPresent: false,
    note: 'news attribution should heavily dampen fear vocab',
  },
  {
    id: 'neg-news-02',
    category: 'negative-news',
    text: 'The study found that the risk of the disease is elevated in certain populations, researchers reported.',
    expectPresent: false,
  },
  {
    id: 'neg-news-03',
    category: 'negative-news',
    text: 'A new report published yesterday describes the threat as serious but manageable, according to data from the agency.',
    expectPresent: false,
    expectMaxSeverity: 3,
  },
  {
    id: 'neg-news-ro-01',
    category: 'negative-news',
    text: 'Potrivit datelor oficiale, pericolul este mai ridicat la persoanele vulnerabile. Surse spun că autoritățile monitorizează situația.',
    expectPresent: false,
    note: 'Romanian news attribution',
  },

  // ── NEGATIVE: quoted speech (fear vocab inside quotes) ────────────────
  {
    id: 'neg-quoted-01',
    category: 'negative-quoted',
    text: 'She told me "your whole family will suffer if you leave" and I was terrified to go.',
    expectPresent: false,
    expectMaxSeverity: 3,
    note: 'someone REPORTING fear-appeal they received, not doing it',
  },
  {
    id: 'neg-quoted-02',
    category: 'negative-quoted',
    text: 'The note said "doctors don\'t want you to know the truth" — I threw it away.',
    expectPresent: false,
    expectMaxSeverity: 3,
  },

  // ── NEGATIVE: first-person emotional vulnerability ────────────────────
  {
    id: 'neg-vulnerable-01',
    category: 'negative-vulnerability',
    text: "I'm scared about the danger ahead. Not sure how to handle the crisis.",
    expectPresent: false,
    expectMaxSeverity: 2,
    note: 'first-person expression should strongly dampen',
  },
  {
    id: 'neg-vulnerable-02',
    category: 'negative-vulnerability',
    text: "I've been terrified of the future since my diagnosis. Every warning feels huge.",
    expectPresent: false,
    expectMaxSeverity: 2,
  },
  {
    id: 'neg-vulnerable-ro-01',
    category: 'negative-vulnerability',
    text: 'Sunt speriată de tot ce văd la știri. Mi-e teamă de pericol.',
    expectPresent: false,
    expectMaxSeverity: 2,
  },

  // ── NEGATIVE: benign ──────────────────────────────────────────────────
  {
    id: 'neg-benign-01',
    category: 'negative-benign',
    text: 'The weather is nice today and I feel great. Going for a walk.',
    expectPresent: false,
    expectMaxSeverity: 0,
  },
  {
    id: 'neg-benign-02',
    category: 'negative-benign',
    text: 'Beautiful sunset. Made coffee. Watched a movie with the kids.',
    expectPresent: false,
    expectMaxSeverity: 0,
  },
  {
    id: 'neg-benign-03',
    category: 'negative-benign',
    text: 'New study shows moderate exercise improves sleep quality. Interesting read.',
    expectPresent: false,
    expectMaxSeverity: 2,
  },
  {
    id: 'neg-benign-04',
    category: 'negative-benign',
    text: 'Warning: stove is hot. Be careful.',
    expectPresent: false,
    expectMaxSeverity: 2,
    note: 'contains "warning" and "danger-adjacent" but is literal safety info',
  },
  {
    id: 'neg-benign-05',
    category: 'negative-benign',
    text: 'The concert was AMAZING!!! Best night EVER!',
    expectPresent: false,
    expectMaxSeverity: 2,
    note: 'caps + exclamation runs but positive content — structural alone must not flag',
  },

  // ── BORDERLINE: genuine ambiguity — document, do not strictly assert ──
  {
    id: 'borderline-01',
    category: 'borderline',
    text: 'Climate change is a real threat. We have limited time to act before irreversible damage.',
    expectPresent: false,
    note: 'legitimate advocacy uses fear-adjacent framing; should score low, not high',
  },
  {
    id: 'borderline-02',
    category: 'borderline',
    text: 'Parents: please be alert to what your kids are watching online. Real dangers exist.',
    expectPresent: false,
    note: 'parent advice — uses alert/danger/your-kids but is informational',
  },
];

