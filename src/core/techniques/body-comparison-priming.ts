// Body pressure aimed at teenagers: "real bodies don't look like this", #thinspo-style tags,
// weight-loss claims, proportion shaming, and "look like me or stay weak". News, a person's own
// feelings about their body, and quoted pressure are dampened. The tags come from the Center for
// Countering Digital Hate's "Deadly by Design"; the phrasing from Common Sense Media's teen body
// image research and the Royal Society for Public Health's "#StatusOfMind". Known gap: the
// Romanian patterns are adapted from the English and have not been checked on real Romanian posts.

import { ClassifierInput, ClassifierOutput, TechniqueClassifier } from './types';
import { buildContext, LinguisticContext } from './linguistic-features';
import { score, patternSignal, SignalHit } from './scoring';

const DIRECTIVE_COMPARISON_PATTERNS = [
  /\b(real|true|natural)\s+(women|men|girls|boys|bodies|people)\s+don'?t\s+(look|have|appear)\s+like\s+(this|that)\b/gi,
  /\bif\s+you\s+don'?t\s+look\s+like\s+(this|her|him|me|us|them)\b/gi,
  /\bthis\s+is\s+what\s+(real|true|natural|a\s+real)\s+(body|bodies|woman|man|girl|boy)\s+looks?\s+like\b/gi,
  /\byour\s+body\s+(should|needs?\s+to|must|has\s+to|ought\s+to)\s+(look|be|become)\s+(like|slim|skinny|thin|leaner|smaller|tighter|harder)\b/gi,
  // Romanian
  /\ba[sș]a\s+arat[aă]\s+un\s+(corp|trup)\s+(adev[aă]rat|real|natural|normal)\b/gi,
  /\bcorpul\s+t[aă]u\s+(trebuie\s+s[aă]|ar\s+trebui\s+s[aă])\s+(arate|fie|devin[aă])\s+(ca|sl[aă]b|mai)\b/gi,
  // Spanish
  /\b(?:las\s+)?(?:mujeres|chicas|hombres|chicos)\s+(?:de\s+verdad|reales)\s+no\s+(?:se\s+ven|son)\s+as[ií]\b/gi,
  /\bsi\s+no\s+te\s+ves\s+(?:as[ií]|como\s+(?:ella|[eé]l|yo))\b/gi,
  /\bas[ií]\s+se\s+ve\s+un\s+cuerpo\s+(?:de\s+verdad|real|natural)\b/gi,
  /\btu\s+cuerpo\s+(?:tiene\s+que|deber[ií]a|debe)\s+(?:verse|ser|estar)\b/gi,
  // Portuguese
  /\b(?:as\s+)?(?:mulheres|garotas|homens|meninos)\s+de\s+verdade\s+n[aã]o\s+(?:s[aã]o|se\s+parecem)\s+assim\b/gi,
  /\bse\s+voc[eê]\s+n[aã]o\s+(?:se\s+parece|[eé])\s+(?:assim|como\s+(?:ela|ele|eu))\b/gi,
  /\b[eé]\s+assim\s+que\s+um\s+corpo\s+(?:de\s+verdade|real|natural)\s+(?:[eé]|se\s+parece)\b/gi,
  /\bseu\s+corpo\s+(?:tem\s+que|deveria|deve)\s+(?:ser|ficar|parecer)\b/gi,
];

const AESTHETIC_PRESSURE_PATTERNS = [
  /#?\b(skinny\s?tok|thinspo|fitspo|bonespo|meanspo|prosp|thigh\s?gap|hip\s?dips|skinny\s+is\s+in|size\s+(zero|0)|size\s+double\s+zero)\b/gi,
  /\b(thigh\s+gap\s+(challenge|goals|check)|collarbone\s+(challenge|goals|check)|hip\s?bone\s+(check|reveal)|ab\s+crack\s+goals)\b/gi,
  // Romanian
  /#?\b(slab[aă]\s+e\s+frumos|talie\s+de\s+viespe|f[aă]r[aă]\s+celulit[aă]|f[aă]r[aă]\s+burt[aă]|coapse\s+sub[tț]iri)\b/gi,
];

const WEIGHT_LOSS_CLAIM_PATTERNS = [
  /\b(lost|dropped|shed|cut)\s+\d+\s*(lbs?|pounds?|kg|kilos?|kilograms?|stone)\s+in\s+\d+\s*(days?|weeks?|months?)\b/gi,
  /\bfrom\s+\d+\s*(lbs?|pounds?|kg|kilos?)\s+to\s+\d+\s*(lbs?|pounds?|kg|kilos?)\b/gi,
  /\bbefore\s*[\s\-\/]\s*after\s+(weight|body|transformation|photos?|pics?)\b/gi,
  // Romanian
  /\b(am\s+sl[aă]bit|am\s+pierdut)\s+\d+\s*(kg|kilograme|kile)\s+[iî]n\s+\d+\s*(zile|s[aă]pt[aă]m[aâ]ni|luni)\b/gi,
  // Spanish and Portuguese. The number, unit and timeframe together make it a claim rather than a
  // diary entry.
  /\b(?:baj[eé]|perd[ií]|adelgac[eé]|elimin[eé])\s+\d+\s*(?:kg|kilos?|kilogramos?|libras?)\s+en\s+\d+\s*(?:d[ií]as?|semanas?|meses?)\b/gi,
  /\b(?:perdi|emagreci|eliminei)\s+\d+\s*(?:kg|quilos?|quilogramas?)\s+em\s+\d+\s*(?:dias?|semanas?|meses?)\b/gi,
  /\bantes\s*(?:y|e)\s*(?:despu[eé]s|depois)\b/gi,
];

const PROPORTION_SHAMING_PATTERNS = [
  /\bif\s+your\s+(waist|hips|thighs|arms|stomach|belly|legs)\s+(look|are|isn'?t|aren'?t|don'?t)\s+(this|like|smaller|tighter|smaller\s+than)\b/gi,
  /\bno\s+(one|guy|girl|man|woman|boy)\s+wants\s+(a|someone\s+with|to\s+date)\s+(fat|chubby|skinny|saggy|flat|thick|big|small)\b/gi,
  /\b(check|look\s+at|measure)\s+your\s+(waist|hips|thighs|stomach|belly|arms|legs)\s+in\s+the\s+mirror\b/gi,
  // Romanian
  /\bdac[aă]\s+(talia|[sș]oldurile|coapsele|burta|picioarele)\s+ta(le)?\s+(arat[aă]|nu\s+arat[aă])\b/gi,
];

const GYM_IMPERATIVE_PATTERNS = [
  /\b(look\s+like\s+me|copy\s+my\s+routine|do\s+(this|my)\s+(workout|routine|program))\s+or\s+(stay|you'?re|don'?t|stop)\b/gi,
  /\bnatty\s+or\s+not\b/gi,
  /\bif\s+you\s+can'?t\s+(do|hit|reach|press|squat)\s+\d+\s*(reps?|sets?|kg|lbs|x)\s+you\s+(are|don'?t|stop|aren'?t)\b/gi,
];

function bodyStructuralHits(ctx: LinguisticContext): SignalHit[] {
  const hits: SignalHit[] = [];
  const f = ctx.features;
  if (f.hashtagCount >= 3) {
    hits.push({
      signalId: 'hashtag-pileup',
      weight: 0.8,
      evidence: `${f.hashtagCount} hashtags`,
      reason: 'structural: aesthetic-promo hashtag density',
    });
  }
  if (f.secondPersonCount >= 2 && f.superlativeCount >= 1) {
    hits.push({
      signalId: 'you-superlative',
      weight: 0.6,
      evidence: 'you-targeted superlative',
      reason: 'structural: viewer-directed comparison',
    });
  }
  return hits;
}

export const bodyComparisonPrimingClassifier: TechniqueClassifier = {
  classify(input: ClassifierInput): ClassifierOutput {
    const ctx = buildContext(input.text);
    const result = score(ctx, {
      technique: 'body-comparison-priming',
      signals: [
        patternSignal('directive-comparison', 3, DIRECTIVE_COMPARISON_PATTERNS),
        patternSignal('aesthetic-pressure', 2, AESTHETIC_PRESSURE_PATTERNS),
        patternSignal('weight-loss-claim', 2, WEIGHT_LOSS_CLAIM_PATTERNS),
        patternSignal('proportion-shaming', 2, PROPORTION_SHAMING_PATTERNS),
        patternSignal('gym-imperative', 2, GYM_IMPERATIVE_PATTERNS),
        patternSignal('directive-obfuscated', 2, DIRECTIVE_COMPARISON_PATTERNS, { matchAggressive: true, maxHits: 1 }),
        patternSignal('aesthetic-obfuscated', 1, AESTHETIC_PRESSURE_PATTERNS, { matchAggressive: true, maxHits: 1 }),
      ],
      structural: bodyStructuralHits,
      registerPolicy: {
        'news-report': 0.35,
        'clickbait': 1.20,
        'promotional': 1.15,
        'formal': 0.65,
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
