
import type { ProfanityTier } from '../types/profanity-tier';

// English and Romanian words are obscene wherever those languages are spoken, so they can be flat
// lists. Spanish and Portuguese words are not: `concha` is a seashell in Spain and Mexico and
// obscene in Peru and Argentina; `polla` is a hen in Latin America and obscene in Spain; `rapariga`
// is a girl in Portugal and a prostitute in Brazil. The store's figures when these lists were
// built showed 37% of users writing Spanish, 11% Brazilian Portuguese and 28% in Peru, on the
// wrong side of several of these, so a flat list would star or hide ordinary posts for them.
//
// What matters is whether the reader hears an obscenity, not where the post came from, and that
// is known exactly and for free from `navigator.language` ('es-PE'): no guessing, no network, and
// nothing recorded (resolveReaderLocale in profanity-filter.ts). Reading the region from the post
// is not built: the telling words are rare, so a short post would almost always come back unknown.
// With the region unknown nothing here fires, which errs towards showing a post.
//
// Every entry was checked against 441,690 Spanish and 444,028 Portuguese sentences (Tatoeba), 2.1M
// characters of Don Quijote and our own 56,919-post corpus, with
// `scripts/corpus/multilang-fp-probe.ts`; each `note` says what it found. Words whose ordinary
// sense could not be bounded are listed with their counts at the bottom, so nobody has to find
// them again.

/** ISO 3166-1 alpha-2, uppercase. */
type RegionCode = string;

export interface RegionalTerm {
  /** Stored diacritic-free and lowercase, like every other dictionary entry. */
  term: string;
  lang: 'es' | 'pt';
  /** 'slurs' hides the post; 'profanity' stars the word. Different bars. */
  tier: Exclude<ProfanityTier, 'both'>;
  /** Reader regions where this term is heard as offensive. */
  offensiveIn: readonly RegionCode[];
  /** Whole word only, where the probe found ordinary words sharing the stem. */
  exact?: boolean;
  note: string;
}

// Named once, so the entries read as decisions rather than lists of country codes.
const RIOPLATENSE_ANDEAN = ['PE', 'AR', 'UY', 'CL', 'PY', 'BO'] as const;
const PT_SPEAKING = ['BR', 'PT', 'AO', 'MZ', 'CV', 'GW', 'ST', 'TL'] as const;
const ES_MOST = [
  'ES', 'MX', 'PE', 'AR', 'CL', 'EC', 'BO', 'PY', 'UY', 'CR', 'GT',
  'HN', 'SV', 'NI', 'PA', 'DO', 'CU', 'PR',
] as const;

export const REGIONAL_TERMS: readonly RegionalTerm[] = [
  // Spanish
  {
    term: 'concha', lang: 'es', tier: 'profanity', offensiveIn: RIOPLATENSE_ANDEAN, exact: true,
    note: 'Seashell in ES/MX, obscene in the Southern Cone and Peru. exact: the probe '
      + 'found `conchabado`/`conchabada` (ordinary River Plate "hired hand") sharing the '
      + 'prefix. 34 ES + 47 PT ordinary hits, so this must never fire outside its regions. '
      + 'The unambiguous construction is caught globally by PHRASE_PROFANITY instead.',
  },
  {
    term: 'conchas', lang: 'es', tier: 'profanity', offensiveIn: RIOPLATENSE_ANDEAN, exact: true,
    note: 'Plural of the above; listed separately because the entry is exact-only.',
  },
  {
    term: 'polla', lang: 'es', tier: 'profanity', offensiveIn: ['ES'],
    note: 'Penis in Spain; a hen, and the national betting pool, across Latin America. '
      + 'ACCEPTED COLLISION for ES readers: 13 ordinary ES hits. Probe also found the '
      + 'English surname/verb `Pollard` in our own corpus, hence PROFANITY_EXCEPTIONS.',
  },
  {
    term: 'verga', lang: 'es', tier: 'profanity',
    offensiveIn: ['MX', 'PE', 'VE', 'CO', 'EC', 'GT', 'HN', 'SV', 'NI'], exact: true,
    note: 'Vulgar for penis across most of Latin America; a yardarm (nautical) in Spain. '
      + 'exact: PT `vergar` (to bend), `vergalhao` (rebar) and ES `vergajazo` share the prefix.',
  },
  {
    term: 'vergas', lang: 'es', tier: 'profanity',
    offensiveIn: ['MX', 'PE', 'VE', 'CO', 'EC', 'GT', 'HN', 'SV', 'NI'], exact: true,
    note: 'Plural of the above.',
  },
  {
    term: 'pendej', lang: 'es', tier: 'profanity', offensiveIn: ['MX'],
    note: 'A strong insult in Mexico; in Peru and Argentina `pendejo` means crafty or '
      + 'streetwise and is frequently admiring. Peru is 28% of our users, so this is '
      + 'gated to MX only. The remaining regions are unmeasured, not judged benign.',
  },
  {
    term: 'marica', lang: 'es', tier: 'profanity', offensiveIn: ES_MOST, exact: true,
    note: 'Homophobic. DELIBERATELY IN THE PROFANITY TIER, NOT SLURS: (a) `Marica` is a '
      + 'given name (diminutive of Maria) in Spanish and Romanian — the probe found it in '
      + 'Don Quijote — and (b) in Colombia and Venezuela it is an all-purpose filler '
      + 'between friends, so CO/VE are excluded. Starring a word we are unsure about is '
      + 'recoverable; hiding the post is not. `maricon` has no such ambiguity and is a '
      + 'global slur.',
  },
  {
    term: 'maricas', lang: 'es', tier: 'profanity', offensiveIn: ES_MOST, exact: true,
    note: 'Plural of the above.',
  },
  // Typed short forms, gated so an English "CSM" acronym is never starred for a reader who does
  // not speak Spanish. The matcher takes three-letter words whole only.
  {
    term: 'ctm', lang: 'es', tier: 'profanity', offensiveIn: ['PE', 'CL', 'EC', 'BO'],
    note: 'conchatumadre. Extremely common typed form in Peru and Chile. Zero hits in any '
      + 'benign corpus.',
  },
  {
    term: 'csm', lang: 'es', tier: 'profanity', offensiveIn: ['PE', 'CL', 'EC', 'BO'],
    note: 'concha su madre. One hit in our own EN/RO corpus (an acronym), which is why it '
      + 'is gated rather than global.',
  },
  {
    term: 'ptm', lang: 'es', tier: 'profanity', offensiveIn: ['PE', 'CL', 'EC', 'BO'],
    note: 'puta madre. Zero hits in any benign corpus.',
  },

  // Portuguese
  {
    term: 'rapariga', lang: 'pt', tier: 'profanity', offensiveIn: ['BR'],
    note: 'An ordinary word for a girl in Portugal; prostitute in Brazil. 86 ordinary hits '
      + 'in the Portuguese corpus, all of them European usage — that is 86 sentences this '
      + 'entry would have starred for a Portuguese reader if it were not gated.',
  },
  {
    term: 'porra', lang: 'pt', tier: 'profanity', offensiveIn: PT_SPEAKING,
    note: 'Obscene in Brazil and Portugal; in Spain a truncheon, a churro and a betting '
      + 'sweepstake (8 ordinary ES hits, plus `porrazos` in Don Quijote). Covers `porrada`.',
  },
  {
    term: 'boquete', lang: 'pt', tier: 'profanity', offensiveIn: PT_SPEAKING,
    note: 'Vulgar in Brazilian Portuguese; in Spanish an ordinary word for a gap or breach '
      + '(3 hits). Gated so Spanish readers never see it fire.',
  },
  {
    term: 'krl', lang: 'pt', tier: 'profanity', offensiveIn: PT_SPEAKING,
    note: 'Typed evasion for caralho. Zero hits in any benign corpus.',
  },
  {
    term: 'pqp', lang: 'pt', tier: 'profanity', offensiveIn: PT_SPEAKING,
    note: 'puta que pariu. One hit in our own corpus, so gated rather than global.',
  },
  {
    term: 'vtnc', lang: 'pt', tier: 'profanity', offensiveIn: PT_SPEAKING,
    note: 'vai tomar no cu. Zero hits in any benign corpus.',
  },
  {
    term: 'vsf', lang: 'pt', tier: 'profanity', offensiveIn: PT_SPEAKING,
    note: 'vai se foder. Zero hits in any benign corpus.',
  },
  {
    term: 'bicha', lang: 'pt', tier: 'slurs', offensiveIn: ['BR'], exact: true,
    note: 'Homophobic slur in Brazil. ACCEPTED COLLISION, documented rather than silently '
      + 'taken: in European Portuguese `bicha` is a queue. A Brazilian reader looking at a '
      + 'European post about a queue can have it hidden — the same homograph class as the '
      + 'British `fag` entry in the English list. exact: `bichano` (a cat) shares the prefix.',
  },
  {
    term: 'bichas', lang: 'pt', tier: 'slurs', offensiveIn: ['BR'], exact: true,
    note: 'Plural of the above.',
  },
];

// Left out on purpose. Each is on the public profanity lists and failed the probe; the counts are
// ordinary uses in the benign corpora above. Do not add them back without a rule that reads the
// sentence, which is the AI judge's job, not this layer's.
//
//   coger: 261 Spanish, 11 in Don Quijote. Vulgar in much of Latin America, ordinary in Spain
//     and in written Spanish ("coger un taxi"); the vulgar sense needs an object and context.
//   retrasado: 42 Spanish, 6 Portuguese. An insult, or just "late".
//   idiota: 248 Spanish, 268 Portuguese. Mild, like English 'damn' and 'hell', also not listed.
//   imbecil: 52 Spanish, 16 Portuguese, 6 in our own corpus (Romanian).
//   macaco: 146 Portuguese. A monkey; a slur only when aimed at someone, as with Romanian
//     'cioara' (crow).
//   corno: 10 Portuguese. A horn.
//   veado: 35 Portuguese. A deer; the slur is spelled 'viado', which is listed.
//   zorra: 20 Spanish. A vixen.
//   pinche: 12 Spanish, and English 'pinched' starts the same.
//   pinga: 33 Portuguese hits are 'pingar' (to drip), and in Brazil it is cachaça.
//   vagabundo: 24 Spanish, 15 Portuguese. A tramp.
//   cona: collides with Conan, Conakry and Spanish 'conac'.
//   cu: two letters, also copper's symbol; the phrase rules catch "vai tomar no cu".
//   gitano: the ordinary Spanish word for Roma people; listing it would hide posts by and about
//     the people it is meant to protect.
//   subnormal: an insult in Spain, but ordinary English ("subnormal temperature"), and the lists
//     are matched whatever the language.
//   hostia: mild in Spain, and the Eucharistic host.

// Words withdrawn for readers of a language. Each is in a global list and is an ordinary word in
// another language the lists also match, spelled the same once diacritics are folded, so no
// token rule can tell them apart. Keyed on the reader's language, not region: a Brazilian in
// Miami has locale pt-US. The counts are ordinary uses the multilingual probe found.
export interface LanguageExclusion {
  term: string;
  excludedFor: readonly string[];
  note: string;
}

export const LANGUAGE_EXCLUSIONS: readonly LanguageExclusion[] = [
  {
    term: 'pula', excludedFor: ['pt', 'es'],
    note: 'Romanian vulgar for penis; PT `pula`/`pular` is "jumps"/"to jump" (105 hits) and '
      + 'ES `púlalo` is "polish it". A perfect homograph after the fold: 12 of the '
      + 'Portuguese hits are the bare token.',
  },
  {
    term: 'caca', excludedFor: ['pt'],
    note: 'PT `caça` (a hunt, a fighter jet) and `caçar` fold to caca/cacar — 307 hits, of '
      + 'which 101 are the bare token. Mild register in every language involved, so '
      + 'withdrawing it costs little.',
  },
  {
    term: 'curvar', excludedFor: ['es', 'pt'],
    note: 'Romanian whoremonger; ES/PT `curvar` is the ordinary verb "to bend", and the '
      + 'stem sweep of 2026-09-17 found curvar, curvado, curvatura, curvavel and seven '
      + 'more behind the `curva` stem. Listed as its own entry now that `curva` is '
      + 'exact-only, and withdrawn for the readers who hear it as ordinary.',
  },
  {
    term: 'curva', excludedFor: ['es', 'pt'],
    note: 'Romanian for whore; ES/PT `curva` is a bend in the road (40 ES + 56 PT hits, '
      + '"la carretera se curva"). Identical spelling, no possible token-level fix.',
  },
  {
    term: 'mofo', excludedFor: ['pt'],
    note: 'English typed evasion for motherfucker; PT `mofo` is mould (7 hits, "cheira a '
      + 'mofo"). ES `mofongo` is a dish, handled by the exact-only rule instead.',
  },
  {
    term: 'rape', excludedFor: ['es'],
    note: 'ES `rape` is monkfish, and Don Quijote uses `rapes` for shaving. Only 4 + 2 '
      + 'hits, but this term can hide a whole video on the post pipeline, so it is '
      + 'withdrawn for Spanish readers; English "rape" in a Spanish reader\'s feed is '
      + 'still caught by the AI path, which is not a word list.',
  },
];

const cache = new Map<string, { slurs: Set<string>; profanity: Set<string>; exact: Set<string>; withdrawn: Set<string> }>();

/**
 * The words a reader's region adds and their language withdraws. Cached, because this runs on
 * every post before the page paints. An unknown region adds nothing and an unknown language
 * withdraws nothing.
 */
export function regionalTermsFor(locale: { lang?: string; region?: string }): {
  slurs: Set<string>;
  profanity: Set<string>;
  exact: Set<string>;
  withdrawn: Set<string>;
} {
  const lang = locale.lang;
  const region = locale.region;
  const key = `${lang ?? ''}|${region ?? ''}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const slurs = new Set<string>();
  const profanity = new Set<string>();
  const exact = new Set<string>();
  const withdrawn = new Set<string>();
  if (region) {
    for (const entry of REGIONAL_TERMS) {
      if (!entry.offensiveIn.includes(region)) continue;
      (entry.tier === 'slurs' ? slurs : profanity).add(entry.term);
      if (entry.exact) exact.add(entry.term);
    }
  }
  if (lang) {
    for (const entry of LANGUAGE_EXCLUSIONS) {
      if (entry.excludedFor.includes(lang)) withdrawn.add(entry.term);
    }
  }
  const built = { slurs, profanity, exact, withdrawn };
  cache.set(key, built);
  return built;
}
