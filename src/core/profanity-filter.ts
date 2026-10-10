// Word lists and a token matcher, no AI. It runs on every post before the page paints: 0.078 ms
// per 200-character post against a budget of 0.2 ms (100,000 calls over five posts in the four
// languages, node 22 on Windows 11; the timing case in tests/unit/core/profanity-run-together.test.ts
// reproduces it). Each token is folded once, in tokenFormsFor, because folding it again for each
// list cost more than the whole run-together pass.
//
// Detection runs in every mode and the caller picks the action. Slurs always reach cleanText; the
// post path hides in child mode (the starred text is never shown on posts), and the comment path
// softens when blanketProfanitySoften(mode, strictLanguage) holds.

import type { Mode } from '../types/mode';
import type { ProfanityTier } from '../types/profanity-tier';
import { regionalTermsFor } from './lexicon-regional';

export interface ProfanityResult {
  filtered: boolean;
  cleanText: string;
  matches: string[];
}

// Two tiers, and the caller picks one with `tier`. Slurs (racial, antisemitic, homophobic,
// transphobic, ableist) are filtered for child and teen whatever the teen language setting, and
// rewritten. Profanity is filtered for child by default; teen mode flags it without rewriting.

const ENGLISH_SLURS = new Set([
  // Racial. 'kike' is whole-word only: as a stem it matched 'Kikerus' and 'Kikkerdril'.
  'nigger', 'nigga', 'niggas', 'spic', 'spics', 'chink', 'kike', 'wetback', 'cracker',
  // No ordinary word starts with it. Found by the gap-finder in
  // scripts/corpus/hard-harm-recall-floor.ts.
  'jewboy',
  // 'fags' is listed because 'fag', under 4 letters, is whole-word only and its plural slipped
  // through. Accepted collision: British 'fags' are cigarettes, as the singular already accepts.
  'faggot', 'fag', 'fags', 'dyke', 'tranny',
  // Ableist. 'retard' is whole-word only: as a stem it matched Portuguese 'retardar' (to delay, 17
  // hits) and Spanish 'retardado', "delayed" as often as the insult. This tier hides the post, so
  // the English forms are listed rather than inferred. The Romanian 'retardat' is whole-word only
  // as well (see EXACT_ONLY), so 'retardatul' and 'retardati' are not caught.
  'retard', 'retarded', 'retards', 'retardat',
  'spastic', 'mongoloid', 'loony',
]);

// Romanian, stored without diacritics: the text is folded before lookup, so both spellings land on
// these forms. Left out because a word list cannot bound them:
//   • cioara: a slur only when aimed at someone; mostly it means "crow".
//   • dracu, dracului: everyday mild register ("al dracului de frig", damn cold).
//   • ma-ta, muma-ta: the hyphen splits it into pieces too short to match, and fused 'mata' is
//     also the polite archaic "you".
//   • vaca: "cow"; an insult only in "esti o vaca", which a token matcher cannot see.
//   • cocosel: a euphemism only in context; literally a little rooster, as in the children's tale
//     "Cocoșelul de aur".
//   • sperma: the stem would reach 'spermatozoid' in biology class.
//   • laba: vulgar only in phrases; mostly "paw", and the plant "laba ursului".
//   • sloboz: the stem reaches the church verb 'slobozeste' (to release).
//   • curve: the plural of 'curva' is the English noun "curve".
const ROMANIAN_SLURS = new Set([
  // 'tigan' reaches tiganca, tigani, tiganul; the place names and the epic poem are in
  // SLUR_EXCEPTIONS.
  'tigan', 'jidan', 'bozgor',
  // No ordinary word starts with 'bulangi' or 'gaozar'.
  'poponar', 'bulangi', 'bulangiu', 'bulangii', 'muist', 'gaozar',
  // Long enough not to reach English 'handicap' or 'handicapped'.
  'handicapat',
]);

const ROMANIAN_PROFANITY = new Set([
  // 'pula' is whole-word only and withdrawn for Spanish and Portuguese readers: Portuguese 'pula'
  // (jumps) folds the same, 105 hits. The city of Pula is an accepted collision. 'pulica' and
  // 'pulii' are separate words the whole-word entry cannot reach.
  'pula', 'pizd', 'muie', 'coaie', 'pulica', 'pulii',
  // 'curva' is whole-word only, since the stem reached curvar, curvado, curvatura and eight more,
  // so its Romanian derivatives are listed. Both are withdrawn for Spanish and Portuguese readers,
  // for whom 'curvar' is "to bend": the reader decides, not the sentence.
  'curva', 'curvar', 'curvasareala',
  'labagi',
  'gaoaza',
  // 'fute' and 'futu' are whole-word only: as stems they matched Portuguese 'futebol' (638 hits)
  // and 'futuro' (515 Spanish, 448 Portuguese). 'futeti' is listed for that reason. "futu-ti"
  // still matches, since the hyphen splits it and leaves 'futu'.
  'fut', 'fute', 'futeti', 'futu', 'futut', 'futai',
  // 'caca' is whole-word only ('cacahuete', 'cacau': 307 Portuguese hits) and withdrawn for
  // Portuguese readers, for whom it is 'caça' (a hunt) folded. Mild everywhere, so little is lost.
  'caca', 'cacat',
]);

const ENGLISH_PROFANITY = new Set([
  'fuck', 'shit', 'ass', 'bitch', 'dick', 'cock', 'pussy', 'cunt',
  'tits', 'boobs', 'dildo', 'orgasm', 'blowjob', 'handjob', 'cumshot',
  // 'milf' is whole-word only: as a stem it matched 'milflores' (hydrangeas). So is 'porn': the
  // stem reaches the Romanian verb 'a porni' (to start, to turn on), and with eighteen of its
  // forms excepted by hand seven more still fired, 'pornesti' (you turn it on) among them. A verb
  // never runs out of forms, so the pornographic words are listed instead.
  'porn', 'porno', 'pornos', 'pornografie', 'pornografic', 'pornografica',
  'pornografia', 'pornografica', 'pornhub', 'pornstar', 'pornstars',
  'pornsite', 'pornsites', 'porntube', 'hentai', 'milf', 'milfs', 'jizz', 'whore',
  // Listed because the stems are whole-word only: they reached 'slutesc' (Romanian, to
  // disfigure), 'pussycat' and 'niggard'.
  'slut', 'sluts', 'slutty', 'pussies',
  'hooker', 'prostitute', 'masturbat', 'erection', 'penis', 'vagina',
  'clitoris', 'butthole', 'asshole', 'arsehole',
  // A stem matches only as the start of a word, so 'motherfucker' and 'bullshit' never reach
  // 'fuck' and 'shit' and are listed; speech transcripts produce them as clean single words. The
  // exceptions keep Wankel, arsenal, Arsène and Pissarro out. Not 'prick' ("prick your finger"),
  // and not 'damn', 'hell' or 'crap', which are mild and everywhere ("hell of a game").
  'motherfuck', 'bullshit', 'dumbass', 'jackass', 'goddam', 'bastard',
  'piss', 'pissed', 'pissing', 'pisses', 'twat', 'wank', 'bollock', 'arse',
  'bastards',
  // Compounds a stem cannot reach; bare 'ass', 3 letters, is whole-word only.
  'dumbfuck', 'clusterfuck', 'batshit', 'apeshit', 'horseshit', 'dipshit',
  'asshat', 'asswipe', 'assclown', 'sonofabitch', 'douchebag', 'jerkoff',
  'bellend', 'shite', 'shyt',
  // Typed and phonetic spellings: "dafuq" slipped past a live test. Three-letter forms are
  // whole-word only, so their longer forms are stems of their own. Effingham is excepted. Not
  // 'mf' or 'bs' (MF DOOM, a BS degree); 'screw' and 'frick' are ordinary words.
  'dafuq', 'dafuk', 'dafuck',
  'fk', 'fkn', 'fkin', 'fkng', 'fked', 'fker',
  'fck', 'fckn', 'fckin', 'fckng', 'fcked', 'fcker',
  'fuk', 'fukin', 'fuked', 'fuker', 'fuq', 'fuqin', 'fux', 'phuck',
  'effin', 'effed', 'wtf', 'stfu', 'mofo', 'mfer',
  'biatch', 'biotch', 'beyotch', 'azz', 'azzhole', 'kunt', 'bullsht',
  // 'molest' and 'rape' are whole-word only, their English forms listed: as stems they matched
  // Spanish 'molestar' (to bother, 614 hits) and 'rapero' (rapper). Either can hide a whole
  // video, so over-matching was costly. 'rape' is also monkfish in Spanish, see
  // LANGUAGE_EXCLUSIONS.
  'rape', 'raped', 'raping', 'rapist', 'rapists',
  'molest', 'molested', 'molesting', 'molester', 'molesters', 'molestation',
  'pedophile', 'paedophile', 'necrophilia',
  // 'gore' is whole-word only: as a stem it matched the surname 'Gorelick'.
  'bestiality', 'gore', 'dismember', 'decapitat', 'mutilat',
  // No drug names. A match hides a whole video in every mode, and a drug name is a topic, not
  // profanity: "crack two eggs", ecstasy the feeling, 'heroin' reaching "heroine", "meth destroyed
  // my uncle's life". Glorifying drugs is for the AI judge.
]);

// Spanish and Portuguese. Only words obscene in every region of the language; the ones that
// change by country are in lexicon-regional.ts and fire only for readers where they offend.
// Stored without diacritics, like the Romanian. Each was checked with
// scripts/corpus/multilang-fp-probe.ts against 441,690 Spanish and 444,028 Portuguese Tatoeba
// sentences, Don Quijote and our own 56,919-post corpus; the failures are listed with their counts
// at the bottom of lexicon-regional.ts. The public LDNOOBW lists were candidates only, never
// imported (docs/research/MULTILANG-FILTER-DESIGN-2026-09-04.md).

const SPANISH_SLURS = new Set([
  // 'marica' is not here: it is a given name and a Colombian filler, so it sits in the profanity
  // tier of lexicon-regional.ts.
  'maricon',
  // No ordinary sense, and no hit in any benign corpus. Not 'gitano', the ordinary name for Roma.
  'negrata', 'sudaca',
  // Full forms, since a 'mongolic' stem would match the Mongolic languages. 'mongoloide' comes
  // through the English 'mongoloid'.
  'mongolico', 'mongolica',
]);

const SPANISH_PROFANITY = new Set([
  // 'putativo' and 'Putonghua' are excepted.
  'puta', 'puto',
  'mierda',
  // 'jodi' carries jodido and jodiendo; Jodie is excepted.
  'jode', 'jodi',
  'cabron', 'gilipolla', 'gilipich', 'soplapolla', 'chupapolla',
  // 'chingon' (Mexican slang for excellent) is out of this stem's reach on purpose.
  'chinga',
  'cojon',
  // 'follaje' (foliage), which the probe found, is excepted.
  'folla',
  'carajo',
  // 'cagoule' (a raincoat) is excepted.
  'caga', 'cago',
  // Whole word only: the stem matched 33 posts in our own corpus, every one the Romanian
  // 'culoare' (colour) or 'culoar' (aisle).
  'culo', 'culos', 'culito',
]);

const PORTUGUESE_SLURS = new Set([
  // 'viado' is the slur spelling; 'veado' is a deer (35 ordinary hits). 'bicha' is gated to
  // Brazil in lexicon-regional.ts, since in Portugal it is a queue.
  'viado', 'viadinho', 'baitola', 'traveco', 'paneleiro',
  // No racial slurs: 'macaco' (a monkey, 146 hits), 'preto' (a colour) and 'crioulo' are slurs
  // only when aimed at someone, which this layer cannot see. Same call as Romanian 'cioara'.
]);

const PORTUGUESE_PROFANITY = new Set([
  'caralho', 'merda', 'buceta', 'piroca', 'xoxota', 'xereca', 'punheta',
  'fode', 'foda', 'fodi',
  // Whole word only: the stem matched 6 posts in our own corpus on 'Bostanica', a Romanian surname.
  'bosta', 'bostas',
]);

// Whole words only, never stems: for each, an ordinary word in one of the languages starts the
// same way. Some offensive forms are listed as entries of their own ('retards', 'spics'). The rest
// are missed, among them 'kikes', 'cocks', 'dicks', 'arses', 'mofos' and Romanian 'retardatul':
// the run-together pass below refuses one listed word plus an ending, which is this same stem case.
const EXACT_ONLY = new Set([
  'culo', 'culos', 'culito', 'bosta', 'bostas',
  // Their stems fired on ordinary Spanish and Portuguese (scripts/corpus/multilang-fp-probe.ts).
  'molest', 'rape', 'retard', 'kike', 'milf', 'gore', 'mofo',
  'fute', 'futu', 'caca', 'pula',
  // Romanian 'a porni' (to start): the stem starred 'pornesti' in four sentences of the Romanian
  // site and six more forms the exception list had missed.
  'porn',
  // A sweep of every stem of four letters or more against 436,389 words (this repository's own
  // writing and the Hunspell dictionaries of the four languages, read from a cache outside the
  // tree) found these reaching words that are not offensive at all:
  //
  //   arse    -> 110 words: the arsenic and arsenate family in Spanish,
  //              Portuguese and Romanian, and Romanian 'arsei' (I burned).
  //   spic    -> 19 Romanian words about ears of wheat and gleaning: spicul,
  //              spice, spicuiesc, spicuire, spicuitor.
  //   muie    -> 13: muieresc, muierime, muieros, muierit.
  //   cacat   -> 12 in Spanish and Portuguese, among them cacatua, a cockatoo.
  //   curva   -> curvar, curvado, curvatura, curvavel and seven more.
  //   piss    -> 14 Portuguese words: pissasfalto, pisseta, pissoir.
  //   cock    -> cockade, cockatiel, cockatrice, cockcrow, cockle, cocksure.
  //   dick    -> the surnames Dickerson and Dickson, and dicker, dickey.
  //   retardat-> the Spanish and Portuguese for "delayed": retardatario.
  //   slut    -> Romanian slutesc, slutire (to disfigure).
  //   nigga   -> niggard, niggardliness, which is the case every filter fails.
  //   pussy   -> pussycat, pussyfoot.
  //   cracker -> crackerjack.
  //   vagina  -> vaginal, vaginalmente, vaginalite: medicine, not profanity.
  //   penis   -> penisla, peniscar.  rapist -> rapistro, a white mustard.
  //   bastard -> bastardilha (a typeface), bastardocarpia (botany).
  //
  // Glued forms still resolve through the run-together segmenter below, the way 'assfuck' and
  // 'retardface' do.
  'arse', 'spic', 'muie', 'cacat', 'curva', 'piss', 'cock', 'dick',
  'retardat', 'slut', 'nigga', 'pussy', 'cracker', 'vagina', 'penis',
  'rapist', 'bastard', 'clitoris', 'orgasm',
  // Not 'bulangi': its only collision is 'bulangismo', a rare Portuguese noun, and the stem carries
  // bulangiu and bulangii, the forms a Romanian reader meets. A rare word in one language does not
  // buy the loss of a live insult in another.
]);

// One lookup for all four languages, with no gate on the post's language. lang-detect.ts knows
// only English and Romanian, readily says 'mixed', and is weakest on short posts, which is most
// of a feed, so a gate would switch protection off more often than it prevented a false alarm.
// The probe found the collisions few and nameable (culoare, bostan, Pollard, conac), and each has
// an exception or a whole-word entry. The reader's region is gated, from their own locale.
const ALL_SLURS = new Set([
  ...ENGLISH_SLURS, ...ROMANIAN_SLURS, ...SPANISH_SLURS, ...PORTUGUESE_SLURS,
]);
const ALL_PROFANITY = new Set([
  ...ENGLISH_PROFANITY, ...ROMANIAN_PROFANITY, ...SPANISH_PROFANITY, ...PORTUGUESE_PROFANITY,
]);

// Cyrillic letters that look Latin are a known way round word filters: a Cyrillic `і` (U+0456) in
// place of `i`. Mapped to the Latin letter they imitate.
const CYRILLIC_TO_LATIN: Record<string, string> = {
  'а': 'a',   // U+0430 → U+0061
  'е': 'e',   // U+0435
  'о': 'o',   // U+043E
  'р': 'p',   // U+0440
  'с': 'c',   // U+0441
  'у': 'y',   // U+0443
  'х': 'x',   // U+0445
  'і': 'i',   // U+0456 (Cyrillic-Ukrainian)
  'ј': 'j',   // U+0458
  'ѕ': 's',   // U+0455
  'А': 'a',   // Capital variants
  'Е': 'e',
  'О': 'o',
  'Р': 'p',
  'С': 'c',
  'У': 'y',
  'Х': 'x',
};

/**
 * The fold of stripCyrillicAndZeroWidth, keeping for each folded character the [start, end) range
 * of the original that produced it. Matching runs on the folded text and the stars go on the
 * original, so text outside a match comes back byte for byte and cleanText is as long as the
 * input, which SafetyCategoriesPanel's first-letter unmasking relies on. Built from the folded text
 * instead, one match stripped every accent in the post ("Qué mierda, mañana" came back as "Que
 * ****** manana"), and Off's word filter (src/content/engagement/word-filter.ts) writes cleanText
 * straight into the page.
 */
interface FoldedText {
  folded: string;
  /** starts[i] and ends[i]: the original range that produced folded[i]. */
  starts: number[];
  ends: number[];
}

function foldWithMap(s: string): FoldedText {
  const starts: number[] = [];
  const ends: number[] = [];
  let folded = '';
  let i = 0;
  for (const ch of s) {
    const start = i;
    const end = i + ch.length;
    i = end;
    // Zero-width characters (U+200B, U+200C, U+200D, U+FEFF, U+2060) only split a slur invisibly.
    if (ch === '​' || ch === '‌' || ch === '‍' ||
        ch === '﻿' || ch === '⁠') {
      continue;
    }
    // One character at a time gives the same fold as the whole string, and keeps the alignment a
    // string-level normalize() loses.
    const decomposed = ch.normalize('NFKD').replace(/[̀-ͯ]/g, '');
    for (const d of decomposed) {
      folded += CYRILLIC_TO_LATIN[d] ?? d;
      starts.push(start);
      ends.push(end);
    }
  }
  return { folded, starts, ends };
}

function stripCyrillicAndZeroWidth(s: string): string {
  // Diacritics first: the entries are stored without them, and \b counts 'ă' as a non-letter, so
  // unfolded 'pulă' would split into 'pul' and 'ă'. Cyrillic does not fold to Latin this way; the
  // map handles it.
  const folded = s.normalize('NFKD').replace(/[̀-ͯ]/g, '');
  let out = '';
  for (const ch of folded) {
    if (ch === '​' || ch === '‌' || ch === '‍' ||
        ch === '﻿' || ch === '⁠') {
      continue;
    }
    if (CYRILLIC_TO_LATIN[ch]) {
      out += CYRILLIC_TO_LATIN[ch];
      continue;
    }
    out += ch;
  }
  return out;
}

/**
 * Leetspeak without collapsing doubled letters, so 'f4ggot' still reaches 'faggot' and the
 * entries with 'gg' or 'ss' match.
 */
function normalizeLeet(word: string): string {
  return stripCyrillicAndZeroWidth(word)
    .toLowerCase()
    .replace(/[*]/g, '')       // f*ck → fck
    .replace(/0/g, 'o')       // pr0n → pron
    .replace(/1/g, 'i')       // sh1t → shit
    .replace(/3/g, 'e')       // r3tard → retard
    .replace(/4/g, 'a')       // 4ss → ass
    .replace(/5/g, 's')       // 5hit → shit
    .replace(/\$/g, 's')      // $hit → shit
    .replace(/@/g, 'a');      // @ss → ass
}

/**
 * Also collapses repeated letters ("fuuuuck"), which breaks entries with a double letter, so
 * matchesWordList tries this, the leetspeak form and the raw form.
 */
function normalizeFromLeet(leet: string): string {
  return leet
    .replace(/(.)\1{2,}/g, '$1$1')
    .replace(/(.)\1/g, '$1');
}

// Ordinary words a slur stem reached, seen as false positives on the OpenAI moderation set: spica
// is a splint, retardant a fire retardant. Checked against the slur list only, so the real
// inflections ("retarded") still match.
const SLUR_EXCEPTIONS = new Set([
  'spicy', 'spice', 'spicey', 'spices', 'spiced', 'spicier', 'spiciest', 'spica',
  'retardant', 'retardants', 'retardation',
  // Romanian place names (several communes) and the epic poem Tiganiada.
  'tiganesti', 'tiganiada',
]);

// The Scunthorpe guard for profanity: a stem of 4 letters or more matches as a prefix, so 'meth'
// reached method, 'cock' cockpit and 'dick' Dickens, and these softened or hid ordinary child and
// teen comments. Listed as whole ordinary words, so the real inflections still match.
const PROFANITY_EXCEPTIONS = new Set([
  'method', 'methods', 'methodology', 'methodologies', 'methodical',
  'methane', 'methodist', 'methodists',
  'cracked', 'cracker', 'crackers', 'crackle', 'crackling', 'crackdown', 'wisecrack',
  'cockpit', 'cocktail', 'cocktails', 'cockney', 'cockerel', 'cockroach', 'cockroaches', 'cockatoo',
  'dickens', 'dickinson',
  // Romanian entries: muiere (archaic "woman"), English future, cacao, Pulaski.
  'muiere', 'muierea', 'muieri', 'muierile',
  'future', 'futures', 'futurist', 'futurists', 'futurism', 'futuristic', 'futurology',
  'cacao',
  'pulaski',
  // curvature, curvaceous and its common misspelling, Spanish 'curvas' (reggaeton lyrics reach
  // Romanian feeds), and Pulicaria, a plant.
  'curvature', 'curvatures', 'curvaceous', 'curvacious', 'curvas',
  'pulicaria',
  // Arsenal the football club, arsenic, Arsène ('arson' does not share the stem), the Wankel
  // engine, Pissarro, and "a bastardized version".
  'arsenal', 'arsenals', 'arsenic', 'arsene',
  'wankel',
  'pissarro',
  // Shiitake reaches 'shit' because collapsing doubled letters makes it 'shitake'; the one-i
  // spelling is listed too.
  'arsenical', 'arsenicals',
  'shiitake', 'shiitakes', 'shitake', 'shitakes',
  'bastardize', 'bastardized', 'bastardizes', 'bastardizing', 'bastardization',
  // Found by checking the typed spellings against 57,000 real posts
  // (scripts/corpus/profanity-fp-probe.ts). 'phuk' was dropped there: it matched Phuket.
  'effingham',
  // Spanish and Portuguese entries, each found by the multilingual probe: 'putativo' (in Don
  // Quijote) and Putonghua; the name Jodie, which the corpora could not show, holding few names;
  // follaje (foliage, 3 hits); Pollard (2 hits in our own corpus); cagoule.
  'putativo', 'putativa', 'putativos', 'putativas', 'putativ', 'putativa',
  'putonghua',
  'jodie', 'jodi',
  'follaje', 'follajes',
  'pollard', 'pollards',
  'cagoule', 'cagoules',
  // Spanish and Portuguese arsenic and arsenal, Peniscola (a town in Valencia, 6 hits), Cockburn,
  // Portuguese 'cuntatorio' (dilatory), and 'curvatura' for the readers 'curva' is not withdrawn
  // for.
  'arsenico', 'arsenicos', 'arsenio', 'arsenales', 'arsenais', 'arsenamina',
  'peniscola',
  'cockneys', 'cockburn',
  'cuntatorio', 'cuntatoria',
  'curvatura', 'curvaturas',
  // The Romanian verb 'a porni' (to start), 48 hits in our own corpus. A second lock only: 'porn'
  // is whole-word only now, so the stem reaches none of these. Should that change back, this list
  // is incomplete, which is why listing a verb's forms is not the fix.
  'porni', 'pornit', 'pornita', 'pornite', 'porniti', 'pornire', 'pornirea',
  'porniri', 'pornirile', 'porneste', 'pornesc', 'pornim', 'pornind',
  'pornea', 'porneau', 'pornise', 'pornita', 'pornirii',
]);

// Pre-censored forms ("f***", "sh*t"), which speech transcripts produce. The tokenizer splits
// 'f***' into 'f' and '***', and the leetspeak pass drops '*', so the word would vanish. Only the
// exact shapes listed below count (lowercased, a run of '*' collapsed to one), never a first
// letter and a length, so "the A* algorithm", footnote marks and "**bold**" are safe. Hand-typed
// '#' and '-' count too ("f#ck", "sh-t"), and "co-op" and "e-mail" pass because they are not in
// the list.
const CENSORED_TOKEN_RE = /(?<![A-Za-z0-9*#-])[A-Za-z]{1,8}[*#-]+[A-Za-z*#-]{0,6}(?![A-Za-z0-9*#-])/g;

// A word spelled with '$' or '@' for a letter, bounded by non-alphanumerics
// so "US$5" and "email@host" never qualify.
const SYMBOL_TOKEN_RE = /(?<![A-Za-z0-9$@])[A-Za-z]*[$@][A-Za-z$@]*(?![A-Za-z0-9$@])/g;

const CENSORED_PROFANITY: Record<string, string> = {
  'f*': 'fuck', 'f*k': 'fuck', 'f*ck': 'fuck', 'fu*k': 'fuck', 'fu*': 'fuck',
  'f*cking': 'fuck', 'f*king': 'fuck', 'f*ckin': 'fuck', 'f*kin': 'fuck',
  'f*cked': 'fuck', 'f*ked': 'fuck', 'f*cker': 'fuck', 'f*ker': 'fuck',
  'fu*king': 'fuck', 'fu*kin': 'fuck', 'fu*ked': 'fuck', 'fu*ker': 'fuck',
  'motherf*er': 'motherfuck', 'motherf*': 'motherfuck',
  'motherf*cker': 'motherfuck', 'motherf*cking': 'motherfuck',
  'sh*t': 'shit', 's*t': 'shit', 'sh*': 'shit', 'sh*tty': 'shit', 'sh*ts': 'shit',
  'bullsh*t': 'bullshit',
  'b*tch': 'bitch', 'b*ch': 'bitch', 'b*tches': 'bitch',
  'c*nt': 'cunt',
  'd*ck': 'dick',
  'c*ck': 'cock',
  'p*ssy': 'pussy', 'pu*sy': 'pussy',
  'p*ss': 'piss', 'p*ssed': 'piss',
  'a*hole': 'asshole', 'as*hole': 'asshole',
  'wh*re': 'whore',
  'sl*t': 'slut',
  'tw*t': 'twat',
  'b*stard': 'bastard',
};

const CENSORED_SLURS: Record<string, string> = {
  'n*gga': 'nigga', 'n*a': 'nigga', 'n*gger': 'nigger',
  'f*ggot': 'faggot', 'f*g': 'fag',
};

// For when the whole is obscene and the parts are not. 'concha' alone is a seashell outside the
// Southern Cone and is gated by region, but every Spanish speaker hears "la concha de tu madre",
// so the phrase is global. Run on the folded text, so written without diacritics, and \b is safe.
// Literal phrases only: a rule that tried to catch cruelty phrased politely would be an
// unmeasured judge, not a filter.
const PHRASE_PROFANITY: Array<{ re: RegExp; term: string }> = [
  { re: /\bgod[ \t-]+damn(?:ed)?\b/gi, term: 'goddam' },
  // Spanish. Bounded repetition only: this runs before the page paints.
  { re: /\bconch[ae][ \t]+(?:de[ \t]+)?(?:tu|su)[ \t]+madre\b/gi, term: 'concha de tu madre' },
  { re: /\bconch[ae](?:tu|su|esu)madre\b/gi, term: 'concha de tu madre' },
  { re: /\bconcha[ \t]+de[ \t]+la[ \t]+lora\b/gi, term: 'concha de tu madre' },
  // Portuguese. 'cu' alone is in no list (it is also copper's symbol); in these phrases it is
  // unambiguous.
  { re: /\bva[ei][ \t]+(?:tomar|toma)[ \t]+no[ \t]+cu\b/gi, term: 'tomar no cu' },
  { re: /\bto(?:ma|mar)[ \t]+no[ \t]+cu\b/gi, term: 'tomar no cu' },
  { re: /\bvai[ \t]+se[ \t]+fode?r\b/gi, term: 'vai se foder' },
];

// Matched on the original text, before folding. Folded, 'coño' becomes 'cono', a cone, and the
// probe counted 3,949 ordinary Spanish words and 530 Portuguese starting 'cono' (conocer). A word
// whose meaning lives in its diacritic is matched as written, with Unicode boundaries, since \b
// would split 'coño' into 'co' and 'o'.
const DIACRITIC_LITERAL: Array<{ re: RegExp; term: string; tier: Exclude<ProfanityTier, 'both'> }> = [
  { re: /(?<![\p{L}\p{N}])coñ[oa]s?(?![\p{L}\p{N}])/giu, term: 'coño', tier: 'profanity' },
];

// A listed inflection reports its stem. `matches` feeds the per-rule counts on the switches and
// the signed record, and one rule must not split into four because its forms are listed.
const CANONICAL_TERM: Record<string, string> = {
  retarded: 'retard', retards: 'retard', retardat: 'retard',
  molested: 'molest', molesting: 'molest', molester: 'molest',
  molesters: 'molest', molestation: 'molest',
  raped: 'rape', raping: 'rape',
  futeti: 'fute',
  milfs: 'milf',
  culos: 'culo', culito: 'culo',
  bostas: 'bosta',
  conchas: 'concha',
  maricas: 'marica',
  vergas: 'verga',
  bichas: 'bicha',
};

// Stems grouped by their first four letters, so a lookup costs one Map access per token form
// instead of a scan of every list, on a path that runs before the page paints. Every stem is at
// least 4 letters, so the four make an exact key.
const stemIndexCache = new WeakMap<Set<string>, Map<string, string[]>>();

function stemIndexFor(wordSet: Set<string>, exactOnly: Set<string>): Map<string, string[]> {
  const cached = stemIndexCache.get(wordSet);
  if (cached) return cached;
  const index = new Map<string, string[]>();
  for (const term of wordSet) {
    if (term.length < 4 || exactOnly.has(term)) continue;
    const key = term.slice(0, 4);
    const bucket = index.get(key);
    if (bucket) bucket.push(term);
    else index.set(key, [term]);
  }
  stemIndexCache.set(wordSet, index);
  return index;
}

// Words glued together. A list matched at word boundaries cannot see a term stuck to another word
// ("dickheadmotherfucker"), and the glue costs one keystroke; "assfuck" and "retardface" do the
// same to terms that had to become whole-word only. A published method before an invented one:
//
//   1. Undo the disguise, then look up. Rojas-Galeano, "On Obstructing Obscenity Obfuscation"
//      (ACM Transactions on the Web 11(2), 2017, doi:10.1145/3032963), names the two evasions,
//      symbol swaps ($h1t) and bogus splits (s.h.i.t). We take its order (normalizeLeet and
//      foldWithMap already normalize first) but not its fuzzy match: a fuzzy matcher before the
//      page paints would buy back every Scunthorpe false positive this file has fixed.
//   2. Gluing is a word-segmentation problem, and the standard method is dictionary maximum
//      matching (Liu, Tan and Shen, COLING-96, aclanthology.org/C96-1035; Norvig, "Natural
//      Language Corpus Data", Beautiful Data, 2009, for the memoised form). It runs over the
//      profanity list only, right to left, which is the memoised form without the backtracking.
//   3. Completeness is the Scunthorpe guard for a word with no boundaries left: every character
//      must belong to a listed term, a compound piece or one short ending. 'assistant' leaves
//      'istant', 'futebol' leaves 'bol', 'molestar' leaves 'ar', 'culoare' leaves 'are', so none
//      of them match.
//
// Three more guards, each against a named collision. The first piece must be a listed term or a
// joiner, which keeps the pass off ordinary long words ('therapist' is never considered: no term
// starts 'the'). At least one listed term and two pieces: one term plus an ending is the stem
// case EXACT_ONLY gates, and 'pula' + 's' (Portuguese "you jump") must stay unmatched. English and
// Romanian endings only: the Spanish and Portuguese ones (-ar, -er, -ir, -es, -o, -a, -ado) are
// what turned 'molest' into molestar and 'fute' into futebol.

/** Two 3-letter terms and one more letter. */
const RUNON_MIN_LENGTH = 7;
/** Longer than this is an id or a hash. */
const RUNON_MAX_LENGTH = 40;
/** Two-letter entries ('fk') are not pieces. */
const RUNON_MIN_SEGMENT = 3;

// One ending may follow one piece.
const RUNON_SUFFIXES: readonly string[] = [
  's', 'ed', 'ing', 'er', 'ers',
  'ul', 'ului', 'ilor', 'elor', 'ele', 'uri', 'urile', 'lui',
];

// Second halves of English insult compounds, so 'dickhead' + 'motherfucker' resolves. Never enough
// alone: a match needs a listed term too. 'licker' but not bare 'lick': with 'lick' the surname
// 'Gorelick' splits into 'gore' + 'lick', the very false positive that made 'gore' whole-word
// only. It was the one collision in a sweep of this repository's 86,004 distinct words in the
// four languages.
const RUNON_JOINERS: readonly string[] = [
  'head', 'face', 'hole', 'hat', 'wipe', 'bag', 'clown', 'wit', 'munch',
  'muncher', 'sucker', 'licker', 'mouth', 'brain', 'monger', 'rag',
  'stain', 'breath', 'nugget', 'goblin', 'waffle', 'boy', 'wad',
];

/** Pieces bucketed by their first three characters, longest first. */
function bucketByHead(words: Iterable<string>): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const w of words) {
    if (w.length < RUNON_MIN_SEGMENT) continue;
    const key = w.slice(0, RUNON_MIN_SEGMENT);
    const bucket = index.get(key);
    if (bucket) bucket.push(w);
    else index.set(key, [w]);
  }
  for (const bucket of index.values()) bucket.sort((a, b) => b.length - a.length);
  return index;
}

const RUNON_JOINER_INDEX = bucketByHead(RUNON_JOINERS);
const EMPTY_BUCKET: readonly string[] = [];

// EXACT_ONLY entries are included: what made them whole-word only was a stem reaching into an
// unlisted remainder, and a segmentation leaves none.
const runOnIndexCache = new WeakMap<Set<string>, Map<string, string[]>>();

function runOnIndexFor(wordSet: Set<string>): Map<string, string[]> {
  const cached = runOnIndexCache.get(wordSet);
  if (cached) return cached;
  const index = bucketByHead(wordSet);
  runOnIndexCache.set(wordSet, index);
  return index;
}

function runOnMatch(form: string, wordSet: Set<string>): string | null {
  return segmentMatch(form, runOnIndexFor(wordSet), RUNON_JOINER_INDEX, true);
}

/**
 * `terms` must be present (the built-in list, or a user's words); `fillers` may complete a token
 * but never match alone (the joiners, plus the built-in list for a user's words). Right to left:
 * `bestListed[pos]` is the most listed terms in any complete split of form[pos..], or -1 when none
 * exists, and `bestJoined[pos]` the joiners on that path.
 */
function segmentMatch(
  form: string,
  terms: Map<string, string[]>,
  fillers: Map<string, string[]>,
  canonical: boolean,
): string | null {
  const n = form.length;
  if (n < RUNON_MIN_LENGTH || n > RUNON_MAX_LENGTH) return null;

  const head = form.slice(0, RUNON_MIN_SEGMENT);
  // Nothing can start this token, so nothing can consume it.
  if (!terms.has(head) && !fillers.has(head)) return null;

  const bestListed = new Array<number>(n + 1).fill(-1);
  const bestJoined = new Array<number>(n + 1).fill(-1);
  const pieceTerm = new Array<string | null>(n + 1).fill(null);
  const pieceNext = new Array<number>(n + 1).fill(-1);
  bestListed[n] = 0;
  bestJoined[n] = 0;

  for (let pos = n - 1; pos >= 0; pos--) {
    if (n - pos < RUNON_MIN_SEGMENT) continue;
    const key = form.slice(pos, pos + RUNON_MIN_SEGMENT);
    let topListed = -1;
    let topJoined = -1;
    let topTerm: string | null = null;
    let topNext = -1;

    const consider = (next: number, addListed: number, addJoined: number, term: string | null): void => {
      if (next > n || bestListed[next] < 0) return;
      const listed = bestListed[next] + addListed;
      const joined = bestJoined[next] + addJoined;
      // Prefer more listed terms; joiners only break a tie.
      if (listed > topListed || (listed === topListed && joined > topJoined)) {
        topListed = listed;
        topJoined = joined;
        topTerm = term;
        topNext = next;
      }
    };

    const walkPieces = (pieces: readonly string[], addListed: number, addJoined: number): void => {
      for (const piece of pieces) {
        if (!form.startsWith(piece, pos)) continue;
        const after = pos + piece.length;
        consider(after, addListed, addJoined, addListed > 0 ? piece : null);
        for (const suffix of RUNON_SUFFIXES) {
          if (form.startsWith(suffix, after)) {
            consider(after + suffix.length, addListed, addJoined, addListed > 0 ? piece : null);
          }
        }
      }
    };

    walkPieces(terms.get(key) ?? EMPTY_BUCKET, 1, 0);
    walkPieces(fillers.get(key) ?? EMPTY_BUCKET, 0, 1);

    bestListed[pos] = topListed;
    bestJoined[pos] = topJoined;
    pieceTerm[pos] = topTerm;
    pieceNext[pos] = topNext;
  }

  if (bestListed[0] < 1) return null;
  if (bestListed[0] + bestJoined[0] < 2) return null;

  // The first listed term on the path: the one a reader sees first.
  for (let pos = 0; pos >= 0 && pos < n; pos = pieceNext[pos]) {
    const term = pieceTerm[pos];
    if (term) return canonical ? (CANONICAL_TERM[term] ?? term) : term;
    if (pieceNext[pos] <= pos) break;
  }
  return null;
}

// A word the user blocks gets the built-in list's reach under the same guard; whole words only, it
// missed "fucking" for "fuck" and "dickheadmotherfucker" for "motherfucker". One ending when the
// word has four letters or more and is not on EXACT_ONLY (three-letter 'man' + 'ele' is Romanian
// 'manele'), and run-together forms by the same complete split, with at least one piece the
// user's: 'dietary' leaves 'ary' and 'class' leaves 'cl', so neither matches. The fillers are the
// global lists, not the reader's region: they only complete a token that already holds the user's
// word, so the smaller set costs little and keeps the rule the same everywhere.

const USER_MIN_INFLECTED = 4;
const userIndexCache = new WeakMap<readonly string[], { index: Map<string, string[]>; set: Set<string> }>();
let userFillerIndex: Map<string, string[]> | null = null;

function userFillers(): Map<string, string[]> {
  if (!userFillerIndex) userFillerIndex = bucketByHead([...GLOBAL_LEXICON.strong, ...RUNON_JOINERS]);
  return userFillerIndex;
}

/**
 * The user's one-word rule that `token` carries with an ending or glued to other words, or null.
 * `words` come already folded; the caller has already checked the exact token.
 */
export function matchUserWordInToken(token: string, words: readonly string[]): string | null {
  if (words.length === 0) return null;
  const forms = tokenFormsFor(token);
  if (!forms) return null;

  let cached = userIndexCache.get(words);
  if (!cached) {
    cached = { index: bucketByHead(words.filter(w => !w.includes(' '))), set: new Set(words) };
    userIndexCache.set(words, cached);
  }
  const { index, set: wordSet } = cached;
  if (index.size === 0) return null;

  for (const form of [forms.raw, forms.leet, forms.normalized]) {
    if (wordSet.has(form)) return form;
    for (const suffix of RUNON_SUFFIXES) {
      if (form.length - suffix.length < USER_MIN_INFLECTED || !form.endsWith(suffix)) continue;
      const base = form.slice(0, -suffix.length);
      // A word the built-in list keeps whole-word only was unsafe with an ending ('pula' + 's' is
      // Portuguese "you jump"), and the user's copy inherits that.
      if (wordSet.has(base) && !EXACT_ONLY.has(base)) return base;
    }
  }
  if (forms.raw.length < RUNON_MIN_LENGTH) return null;
  for (const form of [forms.raw, forms.leet, forms.normalized]) {
    const hit = segmentMatch(form, index, userFillers(), false);
    if (hit) return hit;
  }
  return null;
}

/**
 * Three forms, computed once per token because the fold is the costly part and each token is
 * looked up three times (slurs, profanity, run-together). raw is only lowercased, for entries with
 * double letters ('faggot'); leet also undoes Cyrillic, zero-width and leetspeak ('f4ggot') but
 * keeps double letters; normalized collapses them too ('fuuuuck'). Keeping leet and normalized
 * apart is what lets 'f4ggot' keep its 'gg'.
 *
 * `null` when the token has no letters. Otherwise leetspeak turns digits into letters: '455'
 * became 'ass' and fired on every post with that number, in every language. No entry is digits
 * only, so nothing is lost.
 */
interface TokenForms {
  raw: string;
  leet: string;
  normalized: string;
}

function tokenFormsFor(word: string): TokenForms | null {
  const raw = word.toLowerCase();
  const leet = normalizeLeet(word);
  const normalized = normalizeFromLeet(leet);
  if (raw.length < 2 && leet.length < 2 && normalized.length < 2) return null;
  if (!/[a-z]/i.test(raw)) return null;
  return { raw, leet, normalized };
}

function matchesWordList(
  forms: TokenForms,
  wordSet: Set<string>,
  exceptions?: Set<string>,
  exactOnly: Set<string> = EXACT_ONLY,
): string | null {
  const { raw, leet, normalized } = forms;
  if (exceptions && exceptions.has(raw)) return null;

  if (raw.length >= 2 && wordSet.has(raw)) return CANONICAL_TERM[raw] ?? raw;
  if (leet.length >= 2 && wordSet.has(leet)) return CANONICAL_TERM[leet] ?? leet;
  if (normalized.length >= 2 && wordSet.has(normalized)) return CANONICAL_TERM[normalized] ?? normalized;

  // A listed stem as the start of the word, never the word as the start of an entry: that way
  // "hand" matched 'handicapat'.
  const index = stemIndexFor(wordSet, exactOnly);
  for (const form of [raw, leet, normalized]) {
    if (form.length < 4) continue;
    const bucket = index.get(form.slice(0, 4));
    if (!bucket) continue;
    for (const term of bucket) {
      if (form.startsWith(term)) return CANONICAL_TERM[term] ?? term;
    }
  }

  return null;
}

/**
 * Run once per token against the tier's whole vocabulary, not per list: a compound can cross the
 * two lists ("kikefucker"). The same forms and digit guard as matchesWordList, so 'a55fuck'
 * resolves and a bare number still cannot.
 */
function matchesRunOn(forms: TokenForms, wordSet: Set<string>, exceptions: Set<string>): string | null {
  const { raw, leet, normalized } = forms;
  if (raw.length < RUNON_MIN_LENGTH) return null;
  if (exceptions.has(raw)) return null;
  for (const form of [raw, leet, normalized]) {
    const runOn = runOnMatch(form, wordSet);
    if (runOn) return runOn;
  }
  return null;
}

export interface FilterProfanityOptions {
  tier?: ProfanityTier;
  /**
   * The reader's region ('PE') or a locale to take it from ('es-PE'), for the words in
   * lexicon-regional.ts only. Omitted: the reader's own locale (resolveReaderLocale). null: unknown,
   * global lists only.
   */
  region?: string | null;
}

// The region is the reader's, not the writer's: whether `concha` is starred depends on whether
// the reader hears an obscenity. The browser says exactly, for free. It is a device setting the
// user can see and change, and nothing here reaches the record, the worker or the network.

let localeOverride: { lang?: string; region?: string } | null | undefined;
let cachedNavigatorLocale: { lang?: string; region?: string } | null | undefined;

/**
 * A bare language ('es') gives no region on purpose: `new Intl.Locale('es').maximize()` would
 * guess Spain, which is on the other side of `concha` and `polla` from most of our Spanish-speaking
 * users.
 */
export function parseLocale(locale: string | null | undefined): { lang?: string; region?: string } {
  if (!locale) return {};
  const parts = locale.replace(/_/g, '-').split('-').filter(Boolean);
  if (parts.length === 0) return {};
  const out: { lang?: string; region?: string } = {};
  if (/^[A-Za-z]{2,3}$/.test(parts[0])) out.lang = parts[0].toLowerCase();
  for (const part of parts.slice(1)) {
    if (/^[A-Za-z]{2}$/.test(part)) { out.region = part.toUpperCase(); break; }
  }
  return out;
}

/**
 * A tag ('pt-BR') or a region ('BR'); `null` means known to be unknown, `undefined` returns to the
 * browser's locale. An interface language the user chose beats the browser default and belongs
 * here.
 */
export function setReaderRegion(value: string | null | undefined): void {
  if (value === undefined || value === null) {
    localeOverride = value === null ? null : undefined;
    return;
  }
  localeOverride = /^[A-Z]{2}$/.test(value) ? { region: value } : parseLocale(value);
}

export function resolveReaderLocale(): { lang?: string; region?: string } {
  if (localeOverride !== undefined) return localeOverride ?? {};
  if (cachedNavigatorLocale === undefined) {
    cachedNavigatorLocale =
      typeof navigator !== 'undefined' ? parseLocale(navigator.language) : null;
  }
  return cachedNavigatorLocale ?? {};
}

interface RegionLexicon {
  slurs: Set<string>;
  profanity: Set<string>;
  /** Both lists in one set, for matchesRunOn. */
  strong: Set<string>;
  exactOnly: Set<string>;
}

const GLOBAL_LEXICON: RegionLexicon = {
  slurs: ALL_SLURS,
  profanity: ALL_PROFANITY,
  strong: new Set([...ALL_SLURS, ...ALL_PROFANITY]),
  exactOnly: EXACT_ONLY,
};

/** The run-together pass crosses both lists, so it honours both lists' exceptions. */
const ALL_EXCEPTIONS = new Set([...SLUR_EXCEPTIONS, ...PROFANITY_EXCEPTIONS]);

const lexiconCache = new Map<string, RegionLexicon>();

/** Cached per locale: this runs on every post before the page paints. */
function lexiconFor(locale: { lang?: string; region?: string }): RegionLexicon {
  if (!locale.lang && !locale.region) return GLOBAL_LEXICON;
  const key = `${locale.lang ?? ''}|${locale.region ?? ''}`;
  const cached = lexiconCache.get(key);
  if (cached) return cached;

  const extra = regionalTermsFor(locale);
  const changed = extra.slurs.size > 0 || extra.profanity.size > 0 || extra.withdrawn.size > 0;
  let built: RegionLexicon;
  if (!changed) {
    built = GLOBAL_LEXICON;
  } else {
    const slurs = buildSet(ALL_SLURS, extra.slurs, extra.withdrawn);
    const profanity = buildSet(ALL_PROFANITY, extra.profanity, extra.withdrawn);
    built = {
      slurs,
      profanity,
      strong: new Set([...slurs, ...profanity]),
      exactOnly: extra.exact.size ? new Set([...EXACT_ONLY, ...extra.exact]) : EXACT_ONLY,
    };
  }
  lexiconCache.set(key, built);
  return built;
}

function buildSet(base: Set<string>, added: Set<string>, withdrawn: Set<string>): Set<string> {
  const removes = [...withdrawn].filter(t => base.has(t));
  if (added.size === 0 && removes.length === 0) return base;
  const out = new Set([...base, ...added]);
  for (const term of removes) out.delete(term);
  return out;
}

/**
 * Five passes, each skipping ranges an earlier one claimed: diacritic literals ('coño'), censored
 * forms ('f***'), phrases, symbol spellings ('a$$'), then words, tried whole, as a stem, then
 * split into glued pieces.
 */
export function filterProfanity(
  text: string,
  mode: Mode,
  opts?: FilterProfanityOptions,
): ProfanityResult {
  const tier: ProfanityTier = opts?.tier ?? 'both';

  // The 'slurs' tier always stars what it finds. 'profanity' and 'both' star only in child mode;
  // in teen and adult mode they flag without rewriting, and under 'both' that holds for slurs too.
  const shouldReplace = tier === 'slurs' ? true : mode === 'child';

  const matches: string[] = [];

  // An unknown region means the global lists only, which errs towards showing a post.
  const lex = lexiconFor(
    opts?.region === null
      ? {}
      : opts?.region
        ? (/^[A-Z]{2}$/.test(opts.region) ? { region: opts.region } : parseLocale(opts.region))
        : resolveReaderLocale(),
  );
  const slurList = lex.slurs;
  const profanityList = lex.profanity;
  const exactOnly = lex.exactOnly;
  // The tier's whole vocabulary in one set, so a compound crossing both lists resolves.
  const runOnList = tier === 'slurs' ? slurList : tier === 'profanity' ? profanityList : lex.strong;
  const runOnExceptions = tier === 'slurs'
    ? SLUR_EXCEPTIONS
    : tier === 'profanity' ? PROFANITY_EXCEPTIONS : ALL_EXCEPTIONS;

  // Fold before splitting into words: `\b` knows only Latin letters, so 'fuсk' with a Cyrillic 'с'
  // would split into 'fu', 'с' and 'k'. Each pass matches on `folded` and records the range in
  // `text`, and the stars go on `text` at the end, so nothing outside a match changes.
  const { folded, starts, ends } = foldWithMap(text);

  // Ranges in `text`.
  const claimed: Array<[number, number]> = [];
  const overlaps = (a: number, b: number) =>
    claimed.some(([s, e]) => a < e && s < b);
  const toOriginal = (fStart: number, fEnd: number): [number, number] => {
    if (fEnd <= fStart) return [starts[fStart] ?? text.length, starts[fStart] ?? text.length];
    return [starts[fStart] ?? 0, ends[fEnd - 1] ?? text.length];
  };
  /** False when an earlier pass already claimed the range. */
  const claim = (oStart: number, oEnd: number, term: string): boolean => {
    if (overlaps(oStart, oEnd)) return false;
    claimed.push([oStart, oEnd]);
    matches.push(term);
    return true;
  };

  // On `text` itself, so the ranges need no mapping.
  for (const rule of DIACRITIC_LITERAL) {
    if (tier !== 'both' && tier !== rule.tier) continue;
    for (const m of text.matchAll(rule.re)) {
      claim(m.index, m.index + m[0].length, rule.term);
    }
  }

  // Before the word split, which would break 'f***' apart.
  for (const m of folded.matchAll(CENSORED_TOKEN_RE)) {
    const tok = m[0];
    // A '#' or '-' mask needs three letters in the token: "f-ck" and "sh-t"
    // qualify, the F# language, an "F-" grade and an ECG "S-T" do not.
    if (!tok.includes('*') && (tok.match(/[A-Za-z]/g)?.length ?? 0) < 3) continue;
    const key = tok.toLowerCase().replace(/[*#-]+/g, '*');
    let term: string | undefined;
    if (tier === 'slurs' || tier === 'both') term = CENSORED_SLURS[key];
    if (!term && (tier === 'profanity' || tier === 'both')) {
      term = CENSORED_PROFANITY[key];
    }
    if (!term) continue;
    const [s, e] = toOriginal(m.index, m.index + tok.length);
    claim(s, e, term);
  }

  if (tier === 'profanity' || tier === 'both') {
    for (const { re, term } of PHRASE_PROFANITY) {
      for (const m of folded.matchAll(re)) {
        const [s, e] = toOriginal(m.index, m.index + m[0].length);
        claim(s, e, term);
      }
    }
  }

  // The word split cuts "a$$" at the symbol, so these are looked up whole here; "@user" and "US$"
  // stay as typed.
  for (const m of folded.matchAll(SYMBOL_TOKEN_RE)) {
    const tok = m[0];
    const symbolFolded = tok.replace(/\$/g, 's').replace(/@/g, 'a');
    const forms = tokenFormsFor(symbolFolded);
    if (!forms) continue;
    let term: string | null = null;
    if (tier === 'slurs' || tier === 'both') term = matchesWordList(forms, slurList, SLUR_EXCEPTIONS, exactOnly);
    if (!term && (tier === 'profanity' || tier === 'both')) {
      term = matchesWordList(forms, profanityList, PROFANITY_EXCEPTIONS, exactOnly);
    }
    if (!term) term = matchesRunOn(forms, runOnList, runOnExceptions);
    if (!term) continue;
    const [s, e] = toOriginal(m.index, m.index + tok.length);
    claim(s, e, term);
  }

  // `\w+` gives the same words split(/\b/) would, with their positions.
  for (const m of folded.matchAll(/\w+/g)) {
    const part = m[0];
    if (!/[a-zA-Z0-9]{2,}/i.test(part)) continue;

    const forms = tokenFormsFor(part);
    if (!forms) continue;
    let match: string | null = null;
    if (tier === 'slurs' || tier === 'both') {
      match = matchesWordList(forms, slurList, SLUR_EXCEPTIONS, exactOnly);
    }
    if (!match && (tier === 'profanity' || tier === 'both')) {
      match = matchesWordList(forms, profanityList, PROFANITY_EXCEPTIONS, exactOnly);
    }
    // Last, as the costliest and the only pass that looks inside a word; the length and first
    // three letters turn most tokens away.
    if (!match) match = matchesRunOn(forms, runOnList, runOnExceptions);
    if (!match) continue;
    const [s, e] = toOriginal(m.index, m.index + part.length);
    claim(s, e, match);
  }

  if (matches.length === 0 || !shouldReplace) {
    return { filtered: matches.length > 0, cleanText: text, matches };
  }

  // Same length in and out.
  claimed.sort((a, b) => a[0] - b[0]);
  let out = '';
  let cursor = 0;
  for (const [s, e] of claimed) {
    if (s < cursor) continue;
    out += text.slice(cursor, s) + '*'.repeat(e - s);
    cursor = e;
  }
  out += text.slice(cursor);

  return { filtered: true, cleanText: out, matches };
}

export const __TEST_ONLY = {
  ENGLISH_SLURS,
  ENGLISH_PROFANITY,
  ROMANIAN_SLURS,
  ROMANIAN_PROFANITY,
} as const;

/**
 * The swear mask (docs/design/POLICY-TABLE-2026-09-07.md, section 2): each profanity match starred
 * in place, nothing else touched, no model call, whatever the mode. The caller decides whether the
 * household wants it. `masked === text` when nothing matched.
 */
export function maskProfanity(text: string, region?: string | null): { masked: string; matches: string[] } {
  const r = filterProfanity(text, 'child', { tier: 'profanity', region });
  return { masked: r.filtered ? r.cleanText : text, matches: r.matches };
}

// Defined in src/types/profanity-tier.ts so the types layer imports nothing; re-exported for the
// modules that import it from here.
export type { ProfanityTier } from '../types/profanity-tier';
