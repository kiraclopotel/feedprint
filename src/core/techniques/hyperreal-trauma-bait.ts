// Staged or synthetic tragedy made for a guaranteed emotional reaction: "watch what happens next",
// "this will make you cry", "watch this dad find out", POV dramatizations, AI recreations of the
// dead. Factual news, a person's own grief, and criticism of the format are not the target.
// Vocabulary drawn from Vosoughi, Roy and Aral, "The spread of true and false news online"
// (Science, 2018); Wardle and Derakhshan, "Information Disorder" (Council of Europe, 2017); and the
// Oxford Internet Institute's Computational Propaganda Project.

import { ClassifierInput, ClassifierOutput, TechniqueClassifier } from './types';
import { buildContext, LinguisticContext } from './linguistic-features';
import { score, patternSignal, SignalHit } from './scoring';

const WATCH_NEXT_PATTERNS = [
  /\b(watch\s+(what|till|until)\s+(happens?\s+next|the\s+end)|wait\s+for\s+(it|the\s+end|the\s+twist|0:\d+)|you\s+won'?t\s+believe\s+(what|how|the\s+ending))\b/gi,
  /\b(watch\s+'?til\s+the\s+end|don'?t\s+(skip|stop)\s+watching|watch\s+the\s+whole\s+thing|stay\s+'?til\s+the\s+end)\b/gi,
  // Romanian
  /\b(vezi\s+(ce|ce\s+se\s+[iî]nt[aâ]mpl[aă])\s+(la\s+sf[aâ]r[sș]it|dup[aă]|urmeaz[aă])|nu\s+o\s+s[aă]\s+([iî][tț]i\s+vin[aă]\s+s[aă])\s+crezi|a[sș]teapt[aă]\s+sf[aâ]r[sș]itul)\b/gi,
  // Spanish
  /\b(?:mira\s+(?:hasta\s+el\s+final|lo\s+que\s+pasa\s+(?:despu[eé]s|al\s+final))|espera\s+(?:el\s+final|hasta\s+el\s+final)|no\s+te\s+vas\s+a\s+creer\s+(?:lo\s+que|el\s+final)|no\s+dejes\s+de\s+ver)\b/gi,
  // Portuguese
  /\b(?:assista\s+at[eé]\s+o\s+final|espera\s+o\s+final|voc[eê]\s+n[aã]o\s+vai\s+acreditar\s+(?:no\s+que|no\s+final)|n[aã]o\s+pare\s+de\s+assistir|v[eê]\s+at[eé]\s+o\s+fim)\b/gi,
];

const CRY_BAIT_PATTERNS = [
  /\b(this\s+will\s+(make|have)\s+you\s+(cry|sob|broken|destroyed|crying)|guaranteed\s+to\s+(cry|break|destroy|tear\s+up)|try\s+not\s+to\s+cry|tearjerker\s+(of\s+the|warning))\b/gi,
  /\b(prepare\s+to\s+(cry|sob|break)|grab\s+(your\s+)?tissues|emotional\s+rollercoaster|guaranteed\s+tears)\b/gi,
  // Romanian
  /\b(asta\s+te\s+va\s+face\s+s[aă]\s+pl[aâ]ngi|garantat\s+pl[aâ]ngi|[iî]ncearc[aă]\s+s[aă]\s+nu\s+pl[aâ]ngi|preg[aă]te[sș]te-?[tț]i\s+[sș]erve[tț]ele)\b/gi,
  // Spanish
  /\b(?:esto\s+te\s+va\s+a\s+hacer\s+llorar|te\s+har[aá]\s+llorar|intenta\s+no\s+llorar|prep[aá]rate\s+para\s+llorar|(?:ten|prepara)\s+(?:los\s+)?pa[nñ]uelos|l[aá]grimas\s+garantizadas)\b/gi,
  // Portuguese
  /\b(?:isso\s+vai\s+te\s+fazer\s+chorar|vai\s+te\s+fazer\s+chorar|tente\s+n[aã]o\s+chorar|prepare\s+(?:os\s+)?len[cç]os|l[aá]grimas\s+garantidas)\b/gi,
];

const TRAGEDY_EXPLOIT_PATTERNS = [
  /\b(watch\s+(this|him|her|the)\s+(dad|mom|kid|child|baby|widow|orphan|daughter|son|grandma|grandpa)\s+(cry|sob|break|collapse|find\s+out))\b/gi,
  /\b(real\s+story\s+you\s+(have\s+to|need\s+to|must)\s+(see|watch|hear)|based\s+on\s+(a\s+)?true\s+events?\s+[^.!?]{0,40}(cry|tears|broken|emotional|destroy))\b/gi,
  /\b(her\s+last\s+(words?|moments?|breath)|his\s+last\s+(words?|moments?|breath))\s+(will|going\s+to|gonna)\s+(break|destroy|haunt)\s+you\b/gi,
  // Romanian
  /\b(vezi\s+(cum|c[aâ]nd)\s+(tata|mama|copilul|fata|b[aă]iatul)\s+(pl[aâ]nge|afl[aă]|cedeaz[aă]))\b/gi,
];

const STAGED_DRAMA_PATTERNS = [
  /\b(POV\s*:|imagine\s+(if|that)\s+you|what\s+would\s+you\s+do\s+if\s+your|imagine\s+losing\s+(your|the))\b/gi,
  /\b(scripted|reenactment|recreation|dramatization)\s+of\s+(real|true|actual|the)\s+(story|event|tragedy)\b/gi,
];

const AI_TRAUMA_PATTERNS = [
  /\b(AI\s+(re-?creation|generated|recreated)|deepfake)\s+[^.!?]{0,40}(tragedy|funeral|death|accident|crash|shooting|cry|tears|broken)\b/gi,
  /\b(ai\s+brought\s+(her|him|them|my)\s+(mom|dad|son|daughter|sister|brother)\s+back)\b/gi,
];

function hyperrealStructuralHits(ctx: LinguisticContext): SignalHit[] {
  const hits: SignalHit[] = [];
  const f = ctx.features;
  if (f.emojiCount >= 3 && f.wordCount < 60) {
    hits.push({
      signalId: 'tear-emoji-density',
      weight: 0.6,
      evidence: `${f.emojiCount} emoji on short post`,
      reason: 'structural: emoji emotional-payload density',
    });
  }
  return hits;
}

export const hyperrealTraumaBaitClassifier: TechniqueClassifier = {
  classify(input: ClassifierInput): ClassifierOutput {
    const ctx = buildContext(input.text);
    const result = score(ctx, {
      technique: 'hyperreal-trauma-bait',
      signals: [
        patternSignal('watch-next', 3, WATCH_NEXT_PATTERNS),
        patternSignal('cry-bait', 3, CRY_BAIT_PATTERNS),
        patternSignal('tragedy-exploit', 3, TRAGEDY_EXPLOIT_PATTERNS),
        patternSignal('staged-drama', 2, STAGED_DRAMA_PATTERNS),
        patternSignal('ai-trauma', 2, AI_TRAUMA_PATTERNS),
        patternSignal('watch-next-obfuscated', 2, WATCH_NEXT_PATTERNS, { matchAggressive: true, maxHits: 1 }),
        patternSignal('cry-bait-obfuscated', 2, CRY_BAIT_PATTERNS, { matchAggressive: true, maxHits: 1 }),
      ],
      structural: hyperrealStructuralHits,
      registerPolicy: {
        'news-report': 0.30,
        'clickbait': 1.30,
        'promotional': 1.10,
        'formal': 0.50,
      },
      dampenOnFirstPersonVulnerability: true,
      quoteDampener: 0.30,
      presentThreshold: 3,
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
