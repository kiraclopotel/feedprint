// Hides a post that dehumanizes, before any AI call. A pest word ("rats") or a violent verb
// ("exterminate") alone is ambiguous, pest control or a person; together in a short span they are
// the harm. Three shapes: A, a target then an action within about 100 characters; B, the action
// first; C, a group, "to be" and a target ("they are vermin", "esos son ratas"), which needs no
// verb. It fits neither the slur list, which matches single words, nor the harm floor's score.
//
// It skips the rewriter because the rewriter kept every element: on a real chain, "Exterminat
// those rats right in there hole and throw some dirt over it" came back as "Those rats should be
// exterminated in their hole and covered with dirt." src/analysis/pipeline.ts runs it after the
// slur and profanity filters and hides a match.
//
// Seven languages, each with its own targets, actions, group words and "to be" forms. Boundaries
// are Unicode lookarounds and stems use [\p{L}]*, because JavaScript's \b and \w know only ASCII
// letters and break on 'ș', 'ß' or 'é'.

// A human target dehumanizes whenever it names people, so any violent verb fires. An ambiguous one
// also has an animal, pest, medical or figurative sense, so it fires only with a genocide-coded
// verb or a group word within 150 characters.

const HUMAN_TARGETS_EN = [
  'subhumans?', 'savages?', 'scum', 'beasts?', 'leeches?',
  'barbarians?', 'hordes?', 'swarms?', 'infrahumans?',
];
const HUMAN_TARGETS_RO = [
  'subuman[ai]?', 'sălbatic[ai]?', 'salbatic[ai]?',
  'besti[ie]', 'lichele?', 'lichea',
  'jegoș[ai]', 'jegos[ai]',
  'gunoaie', 'monștr[ui]', 'monstr[ui]', 'monștri?', 'monstri?',
  'scursur[ai]?',
];
const HUMAN_TARGETS_ES = [
  'subhumanos?', 'salvajes?', 'bestias?', 'escoria',
  'alimañas?', 'alimanas?', 'chusma', 'bárbaros?', 'barbaros?',
  'infrahumanos?',
];
const HUMAN_TARGETS_FR = [
  'sous-hommes?', 'sous\\s+hommes?', 'sauvages?', 'bêtes?', 'betes?',
  'racaille', 'ordures?', 'barbares?', 'sous-humains?',
];
const HUMAN_TARGETS_DE = [
  'untermensch(?:en)?', 'wilde', 'wilden', 'bestien?',
  'pack', 'gesindel', 'abschaum', 'barbar(?:en)?',
];
const HUMAN_TARGETS_IT = [
  'subuman[ai]', 'selvagg[ie]', 'bestie?', 'feccia',
  'barbar[ai]', 'canaglia', 'gentaglia',
];
const HUMAN_TARGETS_PT = [
  'sub-?humanos?', 'subhumanos?', 'selvagens?', 'bestas?',
  'escória', 'escoria', 'bárbaros?', 'barbaros?', 'canalhas?',
];
const HUMAN_TARGETS = [
  ...HUMAN_TARGETS_EN,
  ...HUMAN_TARGETS_RO,
  ...HUMAN_TARGETS_ES,
  ...HUMAN_TARGETS_FR,
  ...HUMAN_TARGETS_DE,
  ...HUMAN_TARGETS_IT,
  ...HUMAN_TARGETS_PT,
];

const AMBIGUOUS_TARGETS_EN = [
  'rats', 'rodents?', 'mice', 'vermin',
  'cockroaches?', 'roaches?', 'maggots?', 'parasites?',
  'apes?', 'pigs?', 'dogs?', 'infestation',
  'plague', 'cancer', 'fleas?', 'lice', 'ticks?',
  'bugs?', 'weeds?', 'filth', 'garbage', 'trash',
  'sludge', 'viruses?', 'worms?', 'slime', 'mold',
];
const AMBIGUOUS_TARGETS_RO = [
  'șobolan[ai]?', 'sobolan[ai]?',
  'șoarec[ei]', 'soarec[ei]',
  'gândac[ai]?', 'gandac[ai]?',
  'viermi?',
  'parazi[țt][ai]?',
  'păduch[ei]', 'paduch[ei]',
  'căpuș[ăei]', 'capus[ăei]', 'capuse',
  'mol[ii]a?',
  'larve?', 'microbi?',
  'ciumă', 'ciuma', 'cancer',
  'mizeri[ei]', 'gunoi',
];
const AMBIGUOUS_TARGETS_ES = [
  'ratas?', 'ratones?', 'cucarachas?', 'gusanos?',
  'parásitos?', 'parasitos?',
  'piojos?', 'pulgas?',
  'plagas?', 'virus(?:es)?', 'basura', 'mugre',
  'cáncer', 'cancer', 'larvas?',
];
const AMBIGUOUS_TARGETS_FR = [
  'rats', 'souris', 'cafards?', 'parasites?',
  'poux', 'vers', 'vermine', 'sangsues?',
  'puces?', 'peste', 'cancer', 'virus',
  'larves?',
];
const AMBIGUOUS_TARGETS_DE = [
  'ratten', 'mäuse', 'mause',
  'schaben', 'läuse', 'lause',
  'würmer', 'wurmer',
  'parasiten', 'ungeziefer',
  'viren', 'virus',
  'seuche', 'krebs', 'dreck', 'flöhe', 'flohe',
];
const AMBIGUOUS_TARGETS_IT = [
  'ratti', 'topi', 'scarafaggi', 'parassiti',
  'pidocchi', 'vermi', 'pulci',
  'piaga', 'virus', 'cancro',
  'spazzatura', 'monnezza', 'larve',
];
const AMBIGUOUS_TARGETS_PT = [
  'ratos?', 'ratazanas?', 'baratas?', 'parasitas?',
  'piolhos?', 'vermes?', 'pulgas?',
  'pragas?', 'virus', 'câncer', 'cancer',
  'lixo', 'larvas?',
];
const AMBIGUOUS_TARGETS = [
  ...AMBIGUOUS_TARGETS_EN,
  ...AMBIGUOUS_TARGETS_RO,
  ...AMBIGUOUS_TARGETS_ES,
  ...AMBIGUOUS_TARGETS_FR,
  ...AMBIGUOUS_TARGETS_DE,
  ...AMBIGUOUS_TARGETS_IT,
  ...AMBIGUOUS_TARGETS_PT,
];
const DEHUMANIZATION_TARGETS = [...HUMAN_TARGETS, ...AMBIGUOUS_TARGETS];

// Genocide-coded verbs carry the register of mass violence, so they fire on an ambiguous target
// alone; other violent verbs need a group word nearby.

const GENOCIDE_CODED_EN = [
  'exterminat[\\p{L}]*', 'eradicat[\\p{L}]*', 'genocid[\\p{L}]*',
  'lynch[\\p{L}]*', 'gas(?:sed|sing|ses)?',
];
const GENOCIDE_CODED_RO = [
  'exterminat[\\p{L}]*', 'eradicat[\\p{L}]*', 'lichidat[\\p{L}]*',
  'genocid[\\p{L}]*', 'gaza[\\p{L}]*',
];
const GENOCIDE_CODED_ES = [
  'extermin[\\p{L}]*', 'erradica?[\\p{L}]*', 'lincha[\\p{L}]*',
  'gasear[\\p{L}]*', 'genocid[\\p{L}]*',
];
const GENOCIDE_CODED_FR = [
  'extermin[\\p{L}]*', 'éradiqu[\\p{L}]*', 'eradiqu[\\p{L}]*',
  'lynch[\\p{L}]*', 'gaz(?:er|és|ées|aient|ait|er)?',
  'génocid[\\p{L}]*', 'genocid[\\p{L}]*',
];
const GENOCIDE_CODED_DE = [
  'ausrott[\\p{L}]*', 'vernicht[\\p{L}]*', 'lync[\\p{L}]*',
  'vergas[\\p{L}]*', 'genozid[\\p{L}]*',
];
const GENOCIDE_CODED_IT = [
  'stermin[\\p{L}]*', 'eradica[\\p{L}]*', 'linciar[\\p{L}]*',
  'gasar[\\p{L}]*', 'genocid[\\p{L}]*',
];
const GENOCIDE_CODED_PT = [
  'extermin[\\p{L}]*', 'erradica?[\\p{L}]*', 'lincha[\\p{L}]*',
  'gasear[\\p{L}]*', 'genocíd[\\p{L}]*', 'genocid[\\p{L}]*',
];
const GENOCIDE_CODED_ACTIONS = [
  ...GENOCIDE_CODED_EN,
  ...GENOCIDE_CODED_RO,
  ...GENOCIDE_CODED_ES,
  ...GENOCIDE_CODED_FR,
  ...GENOCIDE_CODED_DE,
  ...GENOCIDE_CODED_IT,
  ...GENOCIDE_CODED_PT,
];

const OTHER_ACTIONS_EN = [
  'eliminat[\\p{L}]*', 'kill[\\p{L}]*', 'slaughter[\\p{L}]*',
  'massacr[\\p{L}]*', 'hang(?:ed|ing|s)?', 'burn(?:ed|ing|s)?',
  'execut[\\p{L}]*', 'purge[\\p{L}]*', 'wipe\\s+(?:them|us|out)',
  'get\\s+rid\\s+of', 'cleanse[\\p{L}]*',
  'remove(?:d|s)?\\s+from\\s+(?:society|the|our)',
];
const OTHER_ACTIONS_RO = [
  'omor[\\p{L}]*', 'ucid[\\p{L}]*', 'ucis[\\p{L}]*',
  'distrug[\\p{L}]*', 'elimin[\\p{L}]*',
  'spânzur[\\p{L}]*', 'spanzur[\\p{L}]*',
  'ard[\\p{L}]*', 'nimici[\\p{L}]*',
  'masacr[\\p{L}]*',
  'scoate?\\s+din\\s+societate', 'sca?p[ăa]\\s+de',
];
const OTHER_ACTIONS_ES = [
  'mata[\\p{L}]*', 'asesin[\\p{L}]*', 'elimina[\\p{L}]*',
  'destruir', 'destru[\\p{L}]*', 'masacr[\\p{L}]*',
  'ahorc[\\p{L}]*', 'quemar', 'quem[\\p{L}]*',
  'ejecuta[\\p{L}]*', 'aniquil[\\p{L}]*',
  'sacar\\s+de\\s+(?:la\\s+)?sociedad',
];
const OTHER_ACTIONS_FR = [
  'tuer', 'tu[ae][\\p{L}]*', 'tué[s]?', 'tuait', 'tuent',
  'assassin[\\p{L}]*', 'éliminer?', 'élimin[\\p{L}]*',
  'eliminer?', 'elimin[\\p{L}]*',
  'massacr[\\p{L}]*', 'détruir[\\p{L}]*', 'detruir[\\p{L}]*',
  'pendr[\\p{L}]*', 'pendu[s]?', 'brûler', 'brûl[\\p{L}]*',
  'bruler', 'brul[\\p{L}]*',
  'anéantir[\\p{L}]*', 'aneantir[\\p{L}]*',
];
const OTHER_ACTIONS_DE = [
  'töten', 'töte[\\p{L}]*', 'toten', 'tote[\\p{L}]*',
  'ermord[\\p{L}]*', 'elimini[\\p{L}]*', 'beseitig[\\p{L}]*',
  'hänge[\\p{L}]*', 'häng[\\p{L}]*', 'hange[\\p{L}]*',
  'verbrenn[\\p{L}]*', 'verbrannt[\\p{L}]*',
];
const OTHER_ACTIONS_IT = [
  'uccid[\\p{L}]*', 'ucciso[\\p{L}]*', 'ammazz[\\p{L}]*',
  'elimina[\\p{L}]*', 'assassi[\\p{L}]*',
  'distrugg[\\p{L}]*', 'distrutt[\\p{L}]*',
  'massacr[\\p{L}]*', 'impicca[\\p{L}]*',
  'bruciar[\\p{L}]*', 'brucia[\\p{L}]*', 'annient[\\p{L}]*',
];
const OTHER_ACTIONS_PT = [
  'mata[\\p{L}]*', 'matou', 'assassin[\\p{L}]*',
  'elimina[\\p{L}]*', 'destru[\\p{L}]*',
  'massacr[\\p{L}]*', 'enforc[\\p{L}]*',
  'queim[\\p{L}]*', 'aniquilar[\\p{L}]*',
];
const OTHER_ACTIONS = [
  ...OTHER_ACTIONS_EN,
  ...OTHER_ACTIONS_RO,
  ...OTHER_ACTIONS_ES,
  ...OTHER_ACTIONS_FR,
  ...OTHER_ACTIONS_DE,
  ...OTHER_ACTIONS_IT,
  ...OTHER_ACTIONS_PT,
];
const DEHUMANIZATION_ACTIONS = [...GENOCIDE_CODED_ACTIONS, ...OTHER_ACTIONS];

// Group words for pattern C and for the 150-character scan around an ambiguous target. Broad, not
// complete: the aim is the shape, an out-group plus a slur, not a list of every group.

// "They are vermin" dehumanizes whoever they are, so these are C subjects. They are not scan cues:
// in pest talk the pronoun is the animal ("these mice keep chewing the wires, we need to kill
// them"). Other languages keep their pronouns as cues, since the false positives seen were English
// only and Romanian written without diacritics relies on 'ei'.
const ANAPHORIC_PRONOUNS_EN = ['they', 'them'];

const IDENTITY_GROUPS_EN = [
  'those\\s+people', 'those\\s+[\\p{L}]+s',
  'communists?', 'fascists?', 'liberals?', 'conservatives?',
  'socialists?', 'progressives?', 'leftists?', 'rightists?',
  'marxists?', 'anarchists?',
  'immigrants?', 'refugees?', 'illegals?', 'aliens?',
  'jews?', 'muslims?', 'christians?', 'hindus?', 'sikhs?',
  'buddhists?', 'atheists?',
  'blacks?', 'whites?', 'asians?', 'arabs?', 'latinos?',
  'gays?', 'lesbians?', 'queers?', 'trans(?:gender)?s?',
  'women', 'men', '\\w+ists?',
];
const IDENTITY_GROUPS_RO = [
  'ei', 'ele', 'lor', 'ăștia', 'astia', 'ăia', 'aia',
  'ăștia\\s+[\\p{L}]+i', 'astia\\s+[\\p{L}]+i',
  'ăia\\s+[\\p{L}]+i', 'aia\\s+[\\p{L}]+i',
  'oamenii?',
  'comuniști?i?', 'comunisti?i?',
  'legionar(?:i|ii)',
  'fasciști?i?', 'fascisti?i?',
  'pesedist(?:i|ii)?', 'liberali?i?',
  'conservatori?i?',
  'imigranți?i?', 'imigranti?i?',
  'refugiați?i?', 'refugiati?i?',
  'evrei?i?', 'musulmani?i?',
  'creștini?i?', 'crestini?i?',
  'țigani?i?', 'tigani?i?',
  'români?i?', 'romani?i?',
  'maghiari?i?', 'unguri?i?', 'bulgari?i?',
  'ucraineni?i?', 'ruși?i?', 'rusi?i?',
  'negri?i?', 'albi?i?',
  'asiatici?i?', 'arabi?i?',
  'femei?',
];
const IDENTITY_GROUPS_ES = [
  'ellos', 'ellas',
  'esos\\s+[\\p{L}]+s', 'aquellos\\s+[\\p{L}]+s',
  'esa\\s+gente',
  'comunistas?', 'fascistas?', 'liberales?', 'conservadores?',
  'socialistas?', 'progresistas?',
  'inmigrantes?', 'refugiados?', 'ilegales?',
  'judíos?', 'judios?', 'musulmanes?', 'cristianos?',
  'negros?', 'blancos?', 'asiáticos?', 'asiaticos?',
  'árabes?', 'arabes?', 'latinos?',
  'gay[s]?', 'lesbianas?',
  'mujeres?', 'hombres?',
];
const IDENTITY_GROUPS_FR = [
  'eux', 'ils', 'ceux',
  'ces\\s+[\\p{L}]+s', 'ces\\s+gens',
  'communistes?', 'fascistes?', 'libéraux', 'liberaux',
  'conservateurs?', 'socialistes?', 'gauchistes?', 'droitistes?',
  'immigrés?', 'immigres?', 'réfugiés?', 'refugies?',
  'clandestins?',
  'juifs?', 'musulmans?', 'chrétiens?', 'chretiens?',
  'noirs?', 'blancs?', 'asiatiques?', 'arabes?',
  'gays?', 'lesbiennes?',
  'femmes?', 'hommes?',
];
const IDENTITY_GROUPS_DE = [
  'sie', 'ihnen', 'ihre',
  'diese\\s+[\\p{L}]+(?:en|er|e)?', 'jene\\s+[\\p{L}]+(?:en|er|e)?',
  'diese\\s+leute',
  'kommunisten?', 'faschisten?', 'liberale[rn]?',
  'konservativen?', 'sozialisten?',
  'immigranten?', 'flüchtlinge?', 'fluchtlinge?',
  'juden?', 'muslime?', 'christen?',
  'schwarze[rn]?', 'weiße[rn]?', 'weisse[rn]?',
  'asiat(?:en)?', 'araber',
  'schwule', 'lesben', 'frauen', 'männer', 'manner',
];
const IDENTITY_GROUPS_IT = [
  'loro', 'essi', 'esse',
  'quei\\s+[\\p{L}]+i', 'questi\\s+[\\p{L}]+i',
  'quella\\s+gente', 'questa\\s+gente',
  'comunisti', 'fascisti', 'liberali', 'conservatori',
  'socialisti', 'progressisti',
  'immigrati', 'rifugiati', 'clandestini',
  'ebrei', 'musulmani', 'cristiani',
  'neri', 'bianchi', 'asiatici', 'arabi',
  'gay', 'lesbiche',
  'donne', 'uomini', 'zingari', 'rom',
];
const IDENTITY_GROUPS_PT = [
  'eles', 'elas',
  'esses\\s+[\\p{L}]+s', 'aqueles\\s+[\\p{L}]+s',
  'essa\\s+gente', 'aquela\\s+gente',
  'comunistas?', 'fascistas?', 'liberais?', 'conservadores?',
  'socialistas?',
  'imigrantes?', 'refugiados?', 'ilegais?',
  'judeus?', 'muçulmanos?', 'muculmanos?',
  'cristãos?', 'cristaos?',
  'negros?', 'brancos?', 'asiáticos?', 'asiaticos?',
  'árabes?', 'arabes?',
  'gays?', 'lésbicas?', 'lesbicas?',
  'mulheres?', 'homens?',
];
const IDENTITY_GROUPS = [
  ...IDENTITY_GROUPS_EN,
  ...IDENTITY_GROUPS_RO,
  ...IDENTITY_GROUPS_ES,
  ...IDENTITY_GROUPS_FR,
  ...IDENTITY_GROUPS_DE,
  ...IDENTITY_GROUPS_IT,
  ...IDENTITY_GROUPS_PT,
];

const TO_BE_VERBS = [
  // English
  'are', 'is', 'were', 'been', 'become(?:s|d|n)?', 'equals?',
  // Romanian
  'sunt', 'este', 'era', 'erau', 'fost', 'devin', 'devine',
  // Spanish
  'son', 'es', 'eran', 'fueron', 'sido', 'sea',
  // French
  'sont', 'est', 'étaient', 'etaient', 'devenir', 'deviennent',
  // German
  'sind', 'ist', 'war', 'waren', 'gewesen', 'werden',
  // Italian
  'sono', 'è', 'erano', 'stati', 'stato',
  // Portuguese
  'são', 'sao', 'eram', 'foram', 'sido',
];
const TO_BE_RE = TO_BE_VERBS.join('|');

// Optional: the Romance languages want an article here ("sont des rats") and English, Romanian and
// German often do not ("sind Ratten"). Italian 'i' and Spanish 'el' are left out as too likely to
// match by accident.
const ARTICLES_RE =
  '(?:un[ae]?s?|um[ae]?s?|a|an|the|o|niște|niste|los|las|des|les|une|dei|delle|degli|gli|os|as)';

const LB = '(?<![\\p{L}\\p{N}])';
const RB = '(?![\\p{L}\\p{N}])';

const TARGET_RE = DEHUMANIZATION_TARGETS.join('|');
const ACTION_RE = DEHUMANIZATION_ACTIONS.join('|');
// The English pronouns are C subjects but not scan cues; see ANAPHORIC_PRONOUNS_EN.
const GROUP_RE = [...ANAPHORIC_PRONOUNS_EN, ...IDENTITY_GROUPS].join('|');
const CONTEXT_GROUP_RE = IDENTITY_GROUPS.join('|');

const PATTERN_A = new RegExp(
  `${LB}(${TARGET_RE})${RB}[\\s\\S]{0,100}?${LB}(${ACTION_RE})${RB}`,
  'giu',
);

const PATTERN_B = new RegExp(
  `${LB}(${ACTION_RE})${RB}[\\s\\S]{0,100}?${LB}(${TARGET_RE})${RB}`,
  'giu',
);

const PATTERN_C = new RegExp(
  `${LB}(${GROUP_RE})${RB}\\s+(?:${TO_BE_RE})\\s+(?:${ARTICLES_RE}\\s+)?${LB}(${TARGET_RE})${RB}`,
  'giu',
);

// Anchored at both ends, so the captured word is tested whole.
const AMBIGUOUS_TARGET_TEST = new RegExp(
  `^(?:${AMBIGUOUS_TARGETS.join('|')})$`,
  'iu',
);
const GENOCIDE_ACTION_TEST = new RegExp(
  `^(?:${GENOCIDE_CODED_ACTIONS.join('|')})$`,
  'iu',
);
// "Exterminator" is a pest-control job, though the verb stem reaches it. It counts as an ordinary
// action, so "The exterminator got rid of the rats in our basement" passes while a group word
// nearby still hides; "exterminate" and "extermination" stay genocide-coded.
const PEST_PROFESSION_TEST = /^exterminators?$/iu;

function isGenocideCodedAction(action: string): boolean {
  return GENOCIDE_ACTION_TEST.test(action) && !PEST_PROFESSION_TEST.test(action);
}
// A generic subject (they, men, women) with an everyday noun (pigs, trash) is a casual insult or
// literal ("they are pigs" on a farm post, "men are trash"), and both were writing severity 9
// records. A named group ("immigrants are pigs") or a stronger target ("they are vermin") still
// fires, and so does a real out-group cue nearby: "Those immigrants moved in next door. They are
// pigs." The rescue scan leaves out the match itself and the words men and women, so "Men are
// trash. Women are trash too." cannot rescue itself.
const WEAK_C_SUBJECT_TEST = /^(?:they|them|men|women)$/iu;
const WEAK_C_TARGET_TEST = /^(?:pigs?|dogs?|mice|trash|garbage)$/iu;
const WEAK_C_COHORT_NOUNS_EN = ['women', 'men'];
const WEAK_C_RESCUE_TEST = new RegExp(
  `${LB}(?:${IDENTITY_GROUPS.filter((g) => !WEAK_C_COHORT_NOUNS_EN.includes(g)).join('|')})${RB}`,
  'iu',
);

const IDENTITY_GROUP_TEST = new RegExp(
  `${LB}(?:${CONTEXT_GROUP_RE})${RB}`,
  'iu',
);

function hasIdentityContext(
  text: string,
  matchStart: number,
  matchEnd: number,
  window = 150,
): boolean {
  const start = Math.max(0, matchStart - window);
  const end = Math.min(text.length, matchEnd + window);
  return IDENTITY_GROUP_TEST.test(text.slice(start, end));
}

/** Like hasIdentityContext, without the match itself or the weak cohort nouns. */
function hasRescuingIdentityContext(
  text: string,
  matchStart: number,
  matchEnd: number,
  window = 150,
): boolean {
  const start = Math.max(0, matchStart - window);
  const end = Math.min(text.length, matchEnd + window);
  return (
    WEAK_C_RESCUE_TEST.test(text.slice(start, matchStart)) ||
    WEAK_C_RESCUE_TEST.test(text.slice(matchEnd, end))
  );
}

// A single quote between two letters is an apostrophe (it's, John's), not a quote mark. Counted
// as one, an odd number of contractions made a real assertion look quoted and switched the gate
// off.
const QUOTE_DELIM_RE = /["“”]|(?<![\p{L}\p{N}])['‘’]|['‘’](?![\p{L}\p{N}])/gu;

function countQuoteDelims(s: string): number {
  return (s.match(QUOTE_DELIM_RE) ?? []).length;
}

/**
 * A match inside quotes is someone reporting what was said, news or commentary, so the gate
 * stays off. An odd number of quote marks before the match and one after it.
 */
function isQuotedSpan(text: string, matchStart: number, matchEnd: number): boolean {
  const openQuotes = countQuoteDelims(text.slice(0, matchStart));
  return openQuotes % 2 === 1 && countQuoteDelims(text.slice(matchEnd)) >= 1;
}

export interface DehumanizationMatch {
  pattern: 'A' | 'B' | 'C';
  target: string;
  action_or_group: string;
  evidence: string;
}

export interface DehumanizationResult {
  triggered: boolean;
  matches: DehumanizationMatch[];
  primaryEvidence: string;
}

export function detectDehumanization(text: string): DehumanizationResult {
  const matches: DehumanizationMatch[] = [];

  const patternA = [...text.matchAll(PATTERN_A)];
  for (const m of patternA) {
    if (m.index === undefined) continue;
    const matchEnd = m.index + m[0].length;
    if (isQuotedSpan(text, m.index, matchEnd)) continue;
    const target = (m[1] || '').toLowerCase();
    const action = (m[2] || '').toLowerCase();
    // Without it a post about rabid raccoons matched rats and eliminate with no group in sight.
    if (
      AMBIGUOUS_TARGET_TEST.test(target) &&
      !isGenocideCodedAction(action) &&
      !hasIdentityContext(text, m.index, matchEnd)
    ) continue;
    matches.push({
      pattern: 'A',
      target,
      action_or_group: action,
      evidence: clipEvidence(m[0]),
    });
  }

  const patternB = [...text.matchAll(PATTERN_B)];
  for (const m of patternB) {
    if (m.index === undefined) continue;
    const matchEnd = m.index + m[0].length;
    if (isQuotedSpan(text, m.index, matchEnd)) continue;
    // Not twice for a span A already matched.
    if (matches.some((mm) => mm.pattern === 'A' && evidenceOverlaps(mm.evidence, m[0]))) continue;
    const action = (m[1] || '').toLowerCase();
    const target = (m[2] || '').toLowerCase();
    if (
      AMBIGUOUS_TARGET_TEST.test(target) &&
      !isGenocideCodedAction(action) &&
      !hasIdentityContext(text, m.index, matchEnd)
    ) continue;
    matches.push({
      pattern: 'B',
      target,
      action_or_group: action,
      evidence: clipEvidence(m[0]),
    });
  }

  const patternC = [...text.matchAll(PATTERN_C)];
  for (const m of patternC) {
    if (m.index === undefined) continue;
    const matchEnd = m.index + m[0].length;
    if (isQuotedSpan(text, m.index, matchEnd)) continue;
    const group = m[1].toLowerCase();
    const target = m[2].toLowerCase();
    // See WEAK_C_SUBJECT_TEST.
    if (
      WEAK_C_SUBJECT_TEST.test(group) &&
      WEAK_C_TARGET_TEST.test(target) &&
      !hasRescuingIdentityContext(text, m.index, matchEnd)
    ) continue;
    matches.push({
      pattern: 'C',
      target,
      action_or_group: group,
      evidence: clipEvidence(m[0]),
    });
  }

  return {
    triggered: matches.length > 0,
    matches,
    primaryEvidence: matches[0]?.evidence ?? '',
  };
}

function clipEvidence(s: string, max = 120): string {
  const trimmed = s.replace(/\s+/g, ' ').trim();
  return trimmed.length <= max ? trimmed : trimmed.slice(0, max - 1) + '…';
}

function evidenceOverlaps(a: string, b: string): boolean {
  const A = a.toLowerCase().replace(/\s+/g, ' ');
  const B = b.toLowerCase().replace(/\s+/g, ' ');
  return A.includes(B) || B.includes(A);
}
