// One post stacking profanity, insults, tribe labels and shouting ("NO FUCKING WAY!!!! ... COMMUNIST
// PSYCHOTIC BULLSHIT"), which no single technique catches cleanly. It needs two of the categories
// to fire. Someone reporting that they were attacked this way is dampened, so they are not read
// as the attacker. The caps and punctuation weights follow VADER (Hutto and Gilbert, 2014);
// stacking as severity follows Detoxify; tribe labels follow the ADL's harassment survey.

import { ClassifierInput, ClassifierOutput, TechniqueClassifier } from './types';
import { buildContext, LinguisticContext } from './linguistic-features';
import { score, patternSignal, SignalHit } from './scoring';
import {
  AD_HOMINEM_PATTERNS_EN,
  AD_HOMINEM_PATTERNS_RO,
  AD_HOMINEM_PATTERNS_ES_PT,
} from '../harm-floor';

const PROFANITY_PATTERNS = [
  /\b(fuck\w*|fucking|shit\w*|bullshit\w*|asshole\w*|motherfucker\w*|cunt|piss(?:ed|ing)?|bitch\w*|dipshit\w*|jackass\w*)\b/gi,
  // Romanian. 'pula' only in the phrase: alone it is also the Portuguese for "jumps", and a near
  // miss here adds points to the harm floor.
  /\b(pizda\w*|c[aă]cat\w*|fute\w*|futut\w*|m[aâ]rl[aă]nesc\w*|dracu\w*|bag(?:a|i)?\s+pula)\b/gi,
  // Spanish and Portuguese. Open stems are safer here than in the word lists, since one category
  // cannot fire alone, but the known collisions stay out: no 'porra' (a churro in Spain), no
  // 'curva', no 'pula', no bare 'caca' ('caça' is a hunt). See src/core/lexicon-regional.ts.
  /\b(put[ao]s?|puta\w+|mierda\w*|joder|jodid[ao]\w*|cabron\w*|cabr[oó]n\w*|gilipollas|cojones|carajo|chinga\w*|co[nñ]o|culo|culos)\b/gi,
  /\b(caralho|merda\w*|foder|fodid[ao]|foda-se|buceta|piroca|punheta|bosta)\b/gi,
];

// The harm floor's own list, imported so the two cannot drift. A separate copy kept open stems
// the floor had closed: `psycho\w*` reached 'psychotherapy' and Romanian `prost\w*` reached
// 'prostata', so "my psychologist referred me for psychotherapy" fired at severity 4 and went
// into the person's record as hostility. src/core/harm-floor.ts explains each ending.
const AD_HOMINEM_PATTERNS = [
  ...AD_HOMINEM_PATTERNS_EN,
  ...AD_HOMINEM_PATTERNS_RO,
  ...AD_HOMINEM_PATTERNS_ES_PT,
];

const GROUP_BLAME_PATTERNS = [
  /\b(communist\w*|fascist\w*|nazi\w*|leftist\w*|rightist\w*|libtard\w*|magat\w*|woke(?:s|y|ys|ism|ist|ists|ness|oids?|rati)?(?!\s+(?:up|me|him|her|them|us|you)\b)|incel\w*|simp(?:s|ing|in|ed|y)?|tradcuck\w*|coomer\w*|elites?|globalists?|deep\s+state)\b/gi,
  // Romanian
  /\b(comunist\w*|fascist\w*|nazi\w*|liberal\w*\s+(woke|nebun\w*)|elite|globali[sș]ti\w*|stat\s+paralel)\b/gi,
];

function combinedStackStructuralHits(ctx: LinguisticContext): SignalHit[] {
  const hits: SignalHit[] = [];
  const f = ctx.features;
  if (f.wordCount >= 6 && f.capsRatio > 0.4) {
    hits.push({
      signalId: 'caps-scream',
      weight: 1.5,
      evidence: `${Math.round(f.capsRatio * 100)}% caps`,
      reason: 'structural: high uppercase ratio',
    });
  }
  if (f.allCapsWordCount >= 3) {
    hits.push({
      signalId: 'caps-cluster',
      weight: 0.8,
      evidence: `${f.allCapsWordCount} ALL-CAPS words`,
      reason: 'structural: multiple all-caps tokens',
    });
  }
  if (f.punctuationRunCount >= 2) {
    hits.push({
      signalId: 'punct-runs',
      weight: 0.8,
      evidence: `${f.punctuationRunCount} !!/?? runs`,
      reason: 'structural: repeated punctuation',
    });
  }
  return hits;
}

export const combinedStackClassifier: TechniqueClassifier = {
  classify(input: ClassifierInput): ClassifierOutput {
    const ctx = buildContext(input.text);
    const result = score(ctx, {
      technique: 'combined-stack',
      signals: [
        // Two hits per category, so one category tops out at 3, under the threshold of 4.
        patternSignal('profanity-burst', 1.5, PROFANITY_PATTERNS, { maxHits: 2 }),
        patternSignal('ad-hominem-burst', 1.5, AD_HOMINEM_PATTERNS, { maxHits: 2 }),
        patternSignal('group-blame-burst', 1.5, GROUP_BLAME_PATTERNS, { maxHits: 2 }),
        // Camouflaged spellings. These re-run the same patterns, so a word the plain pass caught
        // counts twice: at weight 1.0 one category reached 1.5 x 2 + 1.0 = 4.0 and fired alone. At
        // 0.5 it tops out at 3.5.
        patternSignal('profanity-obfuscated', 0.5, PROFANITY_PATTERNS, { matchAggressive: true, maxHits: 1 }),
        patternSignal('ad-hominem-obfuscated', 0.5, AD_HOMINEM_PATTERNS, { matchAggressive: true, maxHits: 1 }),
      ],
      structural: combinedStackStructuralHits,
      registerPolicy: {
        'news-report': 0.40,
        'clickbait': 1.10,
        'conversational': 1.00,
        'formal': 0.50,
      },
      dampenOnFirstPersonVulnerability: true,
      quoteDampener: 0.30,
      presentThreshold: 4,
    });
    return {
      technique: result.technique,
      present: result.present,
      confidence: result.confidence,
      severity: result.severity,
      evidence: result.evidence,
    };
  },
};
