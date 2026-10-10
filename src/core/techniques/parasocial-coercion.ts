// One-sided relationship pressure between fans and creators, worst when a creator sends it back at
// young fans: "you're my world", "plsss reply", "you saved my life", "your videos got me through my
// dad's death". News about the pattern is dampened. Known gap: it can be pure subtext ("you matter
// to me more than my own family"), which only the AI judge can read. Grounded in Hartmann and
// Goldhoorn on parasocial interaction (Journal of Communication, 2011), Cohen on parasocial
// break-ups (2004), and Twenge and Spitzberg on declining offline contact (2020).

import { ClassifierInput, ClassifierOutput, TechniqueClassifier } from './types';
import { buildContext, LinguisticContext } from './linguistic-features';
import { score, patternSignal, SignalHit } from './scoring';

const DEVOTIONAL_PATTERNS = [
  /\byou'?re\s+(my\s+)?(world|everything|life|hero|reason|sunshine|favorite\s+person|literal\s+god|literal\s+queen|literal\s+king)\b/gi,
  /\b(i\s+love\s+you\s+(so\s+much|literally|to\s+death|forever)|i'?d\s+die\s+for\s+you|i\s+can'?t\s+(live|breathe)\s+without\s+(you|your\s+(videos|content|posts)))\b/gi,
  /\b(you'?re\s+my\s+(only\s+)?(comfort|safety|escape|reason\s+to\s+(live|wake\s+up)))\b/gi,
  // Romanian
  /\b(e[sș]ti\s+totul\s+pentru\s+mine|e[sș]ti\s+via[tț]a\s+mea|e[sș]ti\s+tot|f[aă]r[aă]\s+tine\s+nu\s+(pot|sunt|exist))\b/gi,
  /\bte\s+iubesc\s+(enorm|mult\s+de\s+tot|p[aâ]n[aă]\s+la\s+moarte|pentru\s+totdeauna)\b/gi,
  // Spanish
  /\beres\s+(?:mi\s+)?(?:todo|mi\s+vida|mi\s+mundo|mi\s+h[eé]roe|mi\s+raz[oó]n\s+(?:de\s+vivir|para\s+vivir)|mi\s+[uú]nico\s+consuelo)\b/gi,
  /\b(?:te\s+amo\s+(?:much[ií]simo|para\s+siempre|hasta\s+la\s+muerte)|morir[ií]a\s+por\s+ti|sin\s+ti\s+no\s+(?:puedo|soy\s+nada|existo))\b/gi,
  // Portuguese
  /\bvoc[eê]\s+[eé]\s+(?:tudo\s+(?:pra|para)\s+mim|minha\s+vida|meu\s+mundo|meu\s+her[oó]i|minha\s+raz[aã]o\s+de\s+viver|meu\s+[uú]nico\s+conforto)\b/gi,
  /\b(?:te\s+amo\s+(?:demais|pra\s+sempre|at[eé]\s+a\s+morte)|morreria\s+por\s+voc[eê]|sem\s+voc[eê]\s+(?:eu\s+)?n[aã]o\s+(?:consigo|sou\s+nada|existo))\b/gi,
];

const OBLIGATE_REPLY_PATTERNS = [
  /\b(pls{2,}|plz{1,}|pleeease|please\s+(reply|respond|answer|notice|see\s+this|read\s+this)|notice\s+me|respond\s+pls|pin\s+me|reply\s+pls)\b/gi,
  /\b(senpai\s+notice\s+me|❤️\s*if\s+you\s+see\s+this|🥺\s*reply|reply\s+if\s+you\s+love\s+(me|us))\b/gi,
  // Romanian
  /\b(te\s+rog\s+(r[aă]spunde|raspunde|spune|d[aă]-mi)|baga\s+in\s+seama|d[aă]-mi\s+aten[tț]ie|observ[aă]-m[aă])\b/gi,
  // Spanish and Portuguese. Anchored to the ask: "por favor" alone is ordinary politeness.
  /\b(?:resp[oó]ndeme|contest[aá]me|not[aá]me|f[ií]jate\s+en\s+m[ií])\s*,?\s*(?:por\s+fa+vor|porfa+|porfis|plis)\b/gi,
  /\b(?:porfa+|porfis|plis)\s+(?:resp[oó]nde|cont[eé]sta|not[aá]me)\b/gi,
  // The plea is required, as in English: a bare "me responde" is ordinary ("cuando un filosofo me
  // responde").
  /\bme\s+(?:responde|nota|percebe)\s*,?\s*(?:por\s+favor|pfv|pf|plmds)\b/gi,
  /\b(?:por\s+favor|pfv)\s+me\s+(?:responde|nota|percebe)\b/gi,
];

const CREATOR_AS_SAVIOR_PATTERNS = [
  /\bi\s+was\s+(suicidal|depressed|broken|dying|alone|nothing|empty)\s+until\s+(you|your\s+(videos|content|stream|posts))\b/gi,
  /\byou\s+(saved\s+my\s+life|got\s+me\s+through\s+(everything|so\s+much|the\s+worst|my\s+darkest))\b/gi,
  /\byou'?re\s+the\s+only\s+one\s+who\s+(gets|understands?|sees|cares\s+about)\s+me\b/gi,
  /\b(without\s+you\s+i\s+(would'?ve\s+|wouldn'?t\s+have\s+)?(died|made\s+it|survived))\b/gi,
  // Romanian
  /\beram\s+(deprimat[aă]?|trist[aă]?|singur[aă]?|stricat[aă]?)\s+p[aâ]n[aă]\s+(te-am|v-am)\s+(descoperit|v[aă]zut|g[aă]sit)\b/gi,
  /\b(m-ai\s+salvat|m-ai\s+ajutat\s+s[aă]\s+trec\s+peste|f[aă]r[aă]\s+tine\s+nu\s+a[sș]\s+(fi|mai\s+fi))\b/gi,
  // Spanish
  /\bestaba\s+(?:deprimid[oa]|rot[oa]|sol[oa]|vac[ií][oa]|muri[eé]ndome)\s+hasta\s+que\s+(?:te\s+(?:encontr[eé]|vi)|(?:vi|encontr[eé])\s+tus\s+videos)\b/gi,
  /\b(?:me\s+salvaste\s+la\s+vida|me\s+ayudaste\s+a\s+salir|eres\s+el?\s+[uú]nic[oa]\s+que\s+me\s+(?:entiende|ve|escucha))\b/gi,
  /\bsin\s+ti\s+(?:no\s+lo\s+habr[ií]a\s+logrado|habr[ií]a\s+muerto|no\s+estar[ií]a\s+aqu[ií])\b/gi,
  // Portuguese
  /\b(?:eu\s+)?estava\s+(?:deprimid[oa]|destru[ií]d[oa]|sozinh[oa]|vazi[oa]|morrendo)\s+at[eé]\s+(?:te\s+(?:achar|ver|conhecer)|ver\s+seus\s+v[ií]deos)\b/gi,
  /\b(?:voc[eê]\s+salvou\s+minha\s+vida|voc[eê]\s+me\s+ajudou\s+a\s+superar|voc[eê]\s+[eé]\s+[oa]\s+[uú]nic[oa]\s+que\s+me\s+(?:entende|v[eê]|escuta))\b/gi,
  /\bsem\s+voc[eê]\s+(?:eu\s+)?(?:n[aã]o\s+teria\s+conseguido|teria\s+morrido|n[aã]o\s+estaria\s+aqui)\b/gi,
];

const LIFE_EVENT_ATTRIBUTION_PATTERNS = [
  /\byour\s+(videos?|content|streams?|posts?)\s+(got|carried|helped|saved)\s+me\s+through\s+(my\s+|the\s+)?(divorce|death|breakup|cancer|surgery|funeral|loss|chemo|hospitalization)\b/gi,
  /\bwhen\s+(my\s+(mom|dad|sister|brother|friend|grandma|grandpa)\s+(died|passed|left)|i\s+lost|i\s+was\s+diagnosed)[^.!?]{0,40}you\s+(made|helped|saved|carried)\b/gi,
  // Romanian
  /\b(videourile|con[tț]inutul|postur[ai]le)\s+t[aă]le?\s+m-(au|ai)\s+(ajutat|salvat|c[aă]rat|trecut)\s+peste\b/gi,
];

const PARASOCIAL_BAIT_PATTERNS = [
  /\b(notice\s+me\s+(senpai|daddy|mommy|king|queen)|sliding\s+in|❤️➡️|🥺➡️|simping\s+(for|hard))\b/gi,
];

function parasocialStructuralHits(ctx: LinguisticContext): SignalHit[] {
  const hits: SignalHit[] = [];
  const f = ctx.features;
  if (f.emojiCount >= 4 && f.wordCount < 40) {
    hits.push({
      signalId: 'emoji-saturation',
      weight: 0.8,
      evidence: `${f.emojiCount} emoji on short post`,
      reason: 'structural: high emoji density on short fan-style post',
    });
  }
  if (f.mentionCount >= 1 && f.secondPersonCount >= 3) {
    hits.push({
      signalId: 'creator-direct',
      weight: 0.7,
      evidence: 'mention + you-cluster',
      reason: 'structural: directly addressing tagged creator',
    });
  }
  return hits;
}

export const parasocialCoercionClassifier: TechniqueClassifier = {
  classify(input: ClassifierInput): ClassifierOutput {
    const ctx = buildContext(input.text);
    const result = score(ctx, {
      technique: 'parasocial-coercion',
      signals: [
        patternSignal('devotional', 3, DEVOTIONAL_PATTERNS),
        patternSignal('obligate-reply', 3, OBLIGATE_REPLY_PATTERNS),
        patternSignal('creator-savior', 3, CREATOR_AS_SAVIOR_PATTERNS),
        patternSignal('life-event-attribution', 3, LIFE_EVENT_ATTRIBUTION_PATTERNS),
        patternSignal('parasocial-bait', 2, PARASOCIAL_BAIT_PATTERNS),
        patternSignal('devotional-obfuscated', 2, DEVOTIONAL_PATTERNS, { matchAggressive: true, maxHits: 1 }),
        patternSignal('savior-obfuscated', 2, CREATOR_AS_SAVIOR_PATTERNS, { matchAggressive: true, maxHits: 1 }),
      ],
      structural: parasocialStructuralHits,
      registerPolicy: {
        'news-report': 0.30,
        'clickbait': 1.10,
        'conversational': 1.10,
        'formal': 0.50,
      },
      // Parasocial pressure is spoken in the first person, so dampening it would remove the signal.
      dampenOnFirstPersonVulnerability: false,
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
