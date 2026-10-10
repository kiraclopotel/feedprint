// A 0 to 100 score for harm-shaped content, with no AI call, so it holds even when the AI or the
// rewrite fails. It reuses the six harm classifiers' results (already run on every post) and adds
// its own keyword and structure signals for the post where everything stacks but no single
// classifier fires: profanity, insults, tribe labels, capitals, pile-on phrases. When no
// classifier is present and the score reaches 70, the pipeline records a synthetic marker so the
// parent still sees something; when one is present, the score is only extra detail.

import { TechniqueResult } from '../types/analysis';
import { buildContext } from './techniques/linguistic-features';
import { detectLanguage } from './lang-detect';

export interface HarmFloorSignal {
  /** Stable id, such as 'profanity-density'. */
  id: string;
  category:
    | 'profanity'
    | 'ad-hominem'
    | 'ideology-slur'
    | 'sustained-caps'
    | 'crowd-coordination'
    | 'l1-harm-present'
    | 'l1-harm-subthreshold'
    | 'l1-manipulation'
    | 'punctuation-rage'
    | 'emoji-pile'
    | 'repetition';
  /** Points added to the score. */
  weight: number;
  /** Up to 80 characters of the matching text. */
  evidence: string;
}

export interface HarmFloorResult {
  /** 0 to 100, capped. */
  score: number;
  signals: HarmFloorSignal[];
  triggers: boolean;
  language: 'en' | 'ro' | 'mixed' | 'unknown';
  /** 1.0 when nothing was dampened. */
  dampener: number;
}

/** At or above this the pipeline records a `harm-floor-trigger`. */
export const HARM_FLOOR_TRIGGER_THRESHOLD = 70;

// A: profanity, 5 a word up to 20. It counts words; extreme-toxicity is the one that looks for
// coordinated harassment.
const PROFANITY_PATTERNS_EN = [
  /\b(fuck\w*|fucking|shit\w*|bullshit\w*|asshole\w*|motherfucker\w*|cunt|bitch\w*|dipshit\w*|jackass\w*|piss(?:ed|ing)?)\b/gi,
];

// Spanish and Portuguese, same weight and cap. Every stem passed the probe
// (scripts/corpus/multilang-fp-probe.ts); the ones that failed are out for the reasons in
// lexicon-regional.ts ('porra', 'curva', 'pula', 'caca' are ordinary words in one of the four
// languages), and words that depend on region (concha, polla) cannot be judged without the
// reader. 'coño' keeps its diacritic: folded to 'cono' it would count every 'conocer'. 'culo' and
// 'bosta' are whole words only, as in the word lists (Romanian 'culoare', 'Bostanica').
const PROFANITY_PATTERNS_ES = [
  /\b(put[ao]s?|putada|mierdas?|joder|jodid[ao]s?|jodiendo|cabron(?:es|a|azo)?|gilipollas|cojones|carajo|chinga(?:da|do|r|s)?|mamon(?:es)?|culo|culos)\b/gi,
  /\bcoñ[oa]s?\b/gi,
];
const PROFANITY_PATTERNS_PT = [
  /\b(caralho|merdas?|fode|foder|fodid[ao]s?|foda|buceta|piroca|punheta|xoxota|bosta|bostas)\b/gi,
];

// B: insults, 5 each up to 15.
export const AD_HOMINEM_PATTERNS_EN = [
  // Endings are listed, not open. A sweep of the four languages' dictionaries found open stems
  // reaching 'idiotalamo' (Portuguese anatomy), 'retardatario' (a latecomer) and 'psychotherapy',
  // the words a person uses to talk about getting help, each five points towards hiding a post no
  // model had read. The endings here are the English, Romanian, Spanish and Portuguese forms that
  // are the insult; 'retardado' stays out because it means "delayed" as often as anything.
  /\b(psychos?|psychopath(s|ic|y)?|morons?|idiot(s|ic|ically|a|as|i|ii|ul|ule|ilor|o)?|retard(s|ed|at|ata|ati|ate|atul|atule)?|imbecile?\w*|dumbass\w*|loser\w*|cretin(s|i|ul|ule|ilor|a|o|os|as|ism|ismul)?|deranged|insane|stupid\w*|dumb\b)\b/gi,
];

// Romanian, written without diacritics: the text is folded before matching, so 'proastă' counts.
// 'prost' has its endings listed, since the open stem reaches 'prostata' and 'prostituata'.
// idiot, cretin, imbecil and retardat need no entry here, the English list carries their Romanian
// endings. The feminine 'idioată' does, because its stem is spelled 'idioat', not 'idiot'.
// 'imbecile?\w*' also matches 'imbecilitate', accepted: one hit is 5 points against a floor of 70.
// 'bou' only bare or as 'boule'; not 'vaca', which means cow first.
export const AD_HOMINEM_PATTERNS_RO = [
  /\b(prost|prosti|prostule|prostilor|prostovan\w*|proasta|proaste|proasto|idioat(a|e|o|ei|ele|elor)|tampit\w*|nesimtit\w*|jegos\w*|jegoas\w*|bou|boule)\b/gi,
];

// Spanish and Portuguese. 'idiota', 'imbecil' and 'cretino' come from the English list. Left out:
// 'burro', 'besta', 'bobo', 'tonto' (donkey, beast, mild); 'boludo' and 'huevon' (filler between
// friends in Argentina and Chile); 'pendejo' (crafty, often admiring, in Peru, and this signal
// cannot see the reader's region); 'retrasado' and 'retardado' ("delayed" as often as the insult:
// 42 and 17 ordinary uses measured).
export const AD_HOMINEM_PATTERNS_ES_PT = [
  /\b(estupid[ao]s?|tarad[ao]s?|babac[ao]s?|otari[ao]s?|panaca|escrot[ao]s?|pelotud[ao]s?|subnormal\w*|mongolic[ao]s?|energumen[ao]s?|desequilibrad[ao]s?)\b/gi,
];

// C: tribe labels used as slurs, 7 each up to 15; rarer than profanity, so each weighs more.
const IDEOLOGY_SLUR_PATTERNS_EN = [
  /\b(communist\w*|fascist\w*|nazi\w*|leftist\w*|rightist\w*|libtard\w*|magat\w*|woke(?:s|y|ys|ism|ist|ists|ness|oids?|rati)?(?!\s+(?:up|me|him|her|them|us|you)\b)|incel\w*|simp(?:s|ing|in|ed|y)?|tradcuck\w*|coomer\w*|globalists?|deep\s+state)\b/gi,
];

// E: pile-on and watching phrases ("we are watching", "everyone tag"), 5 each up to 10.
const CROWD_COORD_PATTERNS_EN = [
  /\b(we\s+are\s+watching|we\s+see\s+you|everyone\s+(reply|comment|tag|drag)|let'?s\s+(pile\s+on|swarm|brigade|ratio)|don'?t\s+let\s+(this|her|him|them)\s+(go|breathe))\b/gi,
];

function countInHaystack(haystack: string, patterns: RegExp[], seen: Set<string>): { added: number; firstEvidence: string } {
  let added = 0;
  let firstEvidence = '';
  for (const pat of patterns) {
    pat.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pat.exec(haystack)) !== null) {
      const key = m[0].toLowerCase();
      if (seen.has(key)) {
        if (m.index === pat.lastIndex) pat.lastIndex++;
        continue;
      }
      seen.add(key);
      added++;
      if (firstEvidence === '') firstEvidence = m[0];
      if (m.index === pat.lastIndex) pat.lastIndex++;
    }
  }
  return { added, firstEvidence };
}

/**
 * The patterns have no diacritics, so folding them out of the text loses nothing. It removes a
 * false match: JavaScript's `\b` counts an accented letter as a non-letter, so in 'prostático' it
 * found a boundary mid-word and Romanian 'prost' matched inside it. Checked on the four
 * languages' dictionaries, that fired on 'prostático', 'oxímoron' (which holds 'moron') and their
 * neighbours. Folding can only remove matches: a folded hit is also an aggressive-pass hit.
 */
function foldDiacritics(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// The folded text, then the leetspeak-decoded one; a word found in both counts once.
function countMatches(
  normalized: string,
  patterns: RegExp[],
  aggressive?: string,
): { count: number; firstEvidence: string } {
  const seen = new Set<string>();
  const primary = countInHaystack(foldDiacritics(normalized), patterns, seen);
  let count = primary.added;
  let firstEvidence = primary.firstEvidence;
  if (aggressive && aggressive !== normalized) {
    const secondary = countInHaystack(aggressive, patterns, seen);
    count += secondary.added;
    if (firstEvidence === '') firstEvidence = secondary.firstEvidence;
  }
  return { count, firstEvidence };
}

function clipEvidence(s: string, max = 80): string {
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
}

// Read by F and G; the manipulation techniques feed H.
const L1_HARM_CATEGORIES = new Set<TechniqueResult['technique']>([
  'combined-stack',
  'sexual',
  'violence-graphic',
  'self-harm',
  'drug-promotion',
  'extreme-toxicity',
]);

// 'profanity' is the slur filter's own label and 'combined' scores the others, so neither is a
// technique for H.
const L1_MANIP_TECHNIQUES_EXCLUDED = new Set<TechniqueResult['technique']>([
  ...L1_HARM_CATEGORIES,
  'profanity',
  'combined',
]);

/**
 * The display guard runs this on the model's rewrites: one that keeps the insult ("Un.idiot"
 * became "Cred că persoana este un idiot.", read on a real chain) kept the technique, and the
 * words that flagged the input may not come back in the output.
 */
export function detectAdHominemToken(text: string): string | null {
  const ctx = buildContext(text);
  const hits = countMatches(
    ctx.normalized,
    [...AD_HOMINEM_PATTERNS_EN, ...AD_HOMINEM_PATTERNS_RO, ...AD_HOMINEM_PATTERNS_ES_PT],
    ctx.aggressive,
  );
  return hits.count > 0 ? hits.firstEvidence : null;
}

/**
 * @param techniques The pattern classifiers' results, read by F, G and H. The comment path passes
 *                   `[]`, and then only the keyword and structure signals count.
 */
export function computeHarmFloor(
  text: string,
  techniques: TechniqueResult[] = [],
): HarmFloorResult {
  const ctx = buildContext(text);
  const haystack = ctx.normalized;
  // The keyword signals also read the decoded text, so "c0mmunist" counts like "communist". The
  // capitals signal reads the plain text only: decoding leetspeak changes the capitals.
  const aggressive = ctx.aggressive;
  const signals: HarmFloorSignal[] = [];
  let score = 0;

  const profanityHits = countMatches(
    haystack,
    [...PROFANITY_PATTERNS_EN, ...PROFANITY_PATTERNS_ES, ...PROFANITY_PATTERNS_PT],
    aggressive,
  );
  if (profanityHits.count > 0) {
    const w = Math.min(20, profanityHits.count * 5);
    score += w;
    signals.push({
      id: 'profanity-density',
      category: 'profanity',
      weight: w,
      evidence: clipEvidence(`${profanityHits.count} profanity tokens (${profanityHits.firstEvidence})`),
    });
  }

  const adHominemHits = countMatches(
    haystack,
    [...AD_HOMINEM_PATTERNS_EN, ...AD_HOMINEM_PATTERNS_RO, ...AD_HOMINEM_PATTERNS_ES_PT],
    aggressive,
  );
  if (adHominemHits.count > 0) {
    const w = Math.min(15, adHominemHits.count * 5);
    score += w;
    signals.push({
      id: 'ad-hominem-density',
      category: 'ad-hominem',
      weight: w,
      evidence: clipEvidence(`${adHominemHits.count} ad-hominem tokens (${adHominemHits.firstEvidence})`),
    });
  }

  const ideologyHits = countMatches(haystack, IDEOLOGY_SLUR_PATTERNS_EN, aggressive);
  if (ideologyHits.count > 0) {
    const w = Math.min(15, ideologyHits.count * 7);
    score += w;
    signals.push({
      id: 'ideology-slur',
      category: 'ideology-slur',
      weight: w,
      evidence: clipEvidence(`${ideologyHits.count} ideology stems (${ideologyHits.firstEvidence})`),
    });
  }

  // D: shouting.
  const capsBase = ctx.features.wordCount >= 6 && ctx.features.capsRatio > 0.5 ? 10 : 0;
  const capsCluster = ctx.features.allCapsWordCount >= 3 ? 5 : 0;
  if (capsBase + capsCluster > 0) {
    const w = capsBase + capsCluster;
    score += w;
    signals.push({
      id: 'sustained-caps',
      category: 'sustained-caps',
      weight: w,
      evidence: clipEvidence(
        `${Math.round(ctx.features.capsRatio * 100)}% caps, ${ctx.features.allCapsWordCount} ALL-CAPS words`,
      ),
    });
  }

  const crowdHits = countMatches(haystack, CROWD_COORD_PATTERNS_EN, aggressive);
  if (crowdHits.count > 0) {
    const w = Math.min(10, crowdHits.count * 5);
    score += w;
    signals.push({
      id: 'crowd-coordination',
      category: 'crowd-coordination',
      weight: w,
      evidence: clipEvidence(`${crowdHits.count} coord markers (${crowdHits.firstEvidence})`),
    });
  }

  // F: harm classifiers that fired, by severity, up to 35, so one strong category anchors the
  // score without deciding it and two fill it.
  let l1HarmPresent = 0;
  for (const t of techniques) {
    if (!t.present || !L1_HARM_CATEGORIES.has(t.technique)) continue;
    const w = t.severity >= 7 ? 30 : t.severity >= 5 ? 22 : t.severity >= 3 ? 14 : 6;
    l1HarmPresent += w;
    signals.push({
      id: `l1-harm-${t.technique}`,
      category: 'l1-harm-present',
      weight: w,
      evidence: clipEvidence(`${t.technique} present sev=${t.severity}`),
    });
  }
  if (l1HarmPresent > 0) {
    const capped = Math.min(35, l1HarmPresent);
    score += capped;
    // A negative entry, so the explanation shows the cap.
    if (capped < l1HarmPresent && signals.length > 0) {
      signals.push({
        id: 'l1-harm-cap',
        category: 'l1-harm-present',
        weight: capped - l1HarmPresent,
        evidence: `cap applied: ${l1HarmPresent} → 35`,
      });
    }
  }

  // G: near misses, 5 each up to 15. The evidence check matters: the scorer's confidence never
  // falls below 0.45, so without it a classifier with no hit looked like a near miss, every post
  // got 15, and the post path triggered at 55 while the comment path stayed at 70.
  let l1HarmSub = 0;
  for (const t of techniques) {
    if (t.present || !L1_HARM_CATEGORIES.has(t.technique)) continue;
    if (t.confidence > 0.30 && t.evidence.length > 0) {
      l1HarmSub += 5;
      signals.push({
        id: `l1-harm-sub-${t.technique}`,
        category: 'l1-harm-subthreshold',
        weight: 5,
        evidence: clipEvidence(`${t.technique} sub-threshold conf=${t.confidence.toFixed(2)}`),
      });
    }
  }
  if (l1HarmSub > 0) {
    score += Math.min(15, l1HarmSub);
  }

  // H: manipulation techniques at severity 5 or more, 5 each up to 10.
  let l1Manip = 0;
  for (const t of techniques) {
    if (!t.present || L1_MANIP_TECHNIQUES_EXCLUDED.has(t.technique)) continue;
    if (t.severity >= 5) {
      l1Manip += 5;
      signals.push({
        id: `l1-manip-${t.technique}`,
        category: 'l1-manipulation',
        weight: 5,
        evidence: clipEvidence(`${t.technique} present sev=${t.severity}`),
      });
    }
  }
  if (l1Manip > 0) {
    score += Math.min(10, l1Manip);
  }

  if (ctx.features.punctuationRunCount >= 1) {
    score += 5;
    signals.push({
      id: 'punctuation-rage',
      category: 'punctuation-rage',
      weight: 5,
      evidence: `${ctx.features.punctuationRunCount} !!/?? runs`,
    });
  }

  // A child reporting harm done to them should still reach the parent, so this halves the total
  // rather than cutting it to 0.2 as the classifiers do; halving keeps victims' own reports from
  // setting it off.
  let dampener = 1.0;
  if (ctx.hasFirstPersonVulnerability) {
    dampener *= 0.5;
  }

  const finalScore = Math.min(100, Math.round(score * dampener));
  const language = detectLanguage(ctx.normalized).language;

  return {
    score: finalScore,
    signals,
    triggers: finalScore >= HARM_FLOOR_TRIGGER_THRESHOLD,
    language,
    dampener,
  };
}
