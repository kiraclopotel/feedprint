// Drug glorification ("this molly hits different"), vape marketing aimed at minors, pressure to
// try, dealer language ("hmu for"), and dosage sharing. News, formal writing and quoted speech
// are dampened. Known gap: Romanian street slang is regional and
// changes fast; the list holds only common words (iarbă, praf, cocaină) and will miss current
// city slang. Vocabulary drawn from SAMHSA's underage drug use research, the UK Home Office's
// "Drug Strategy 2021-2031", and Pew Research Center on teens and vaping content.

import { ClassifierInput, ClassifierOutput, TechniqueClassifier } from './types';
import { buildContext, LinguisticContext } from './linguistic-features';
import { score, patternSignal, SignalHit } from './scoring';

const ILLICIT_GLORIFICATION_PATTERNS = [
  /\b(this\s+(molly|mdma|x|coke|coca[ie]ne|acid|lsd|shrooms|ket|ketamine|fent\w*|xan\w*)\s+(hits\s+different|is\s+(fire|elite|godly|insane)|slaps|goes\s+brrr))\b/gi,
  /\b(best\s+high\s+(ever|of\s+my\s+life)|lit\s+af\s+on\s+(molly|coke|acid)|buzzin\s+off\s+the\s+(molly|coke|acid|x))\b/gi,
  /\b(high\s+as\s+fuck|zooted|geeked|cracked\s+out)\s+(rn|right\s+now|tonight)\b/gi,
];

const VAPE_MINOR_MARKET_PATTERNS = [
  /\b(elf\s?bar\s+(flavors?|haul|review)|puff\s?bar\s+(flavors?|haul|review)|geek\s?bar|breeze\s+(?:pro|plus|prime|smart|vape|bar)|hyde\s+(?:edge|color|rebel|retro|iq|original|curve|n-?bar|vape|bar)|esco\s?bar)\b/gi,
  /\b(best\s+(disposable|fruity|dessert)\s+vape|favorite\s+(disposable|fruity|dessert)\s+vape|new\s+flavor\s+(drop|haul))\b/gi,
  /\b(vape\s+(haul|stash|collection)|nic\s+(buzz|head|sick)|pod\s+stash)\b/gi,
];

const RECREATIONAL_COERCION_PATTERNS = [
  /\b(you\s+have\s+to\s+try\s+(this|it|the\s+(molly|coke|acid|x|shrooms|weed)))\b/gi,
  /\b(everyone'?s\s+(on|doing)\s+(it|this|the\s+stuff|molly|x|coke)|don'?t\s+be\s+(lame|a\s+pussy|boring)\s+(do\s+it|try\s+it|take\s+one))\b/gi,
  /\b(just\s+one\s+(hit|line|tab|bump|bar)\s+won'?t\s+(hurt|kill\s+you))\b/gi,
];

const DEALER_ACQUISITION_PATTERNS = [
  /\b(got\s+(that|the)\s+pack|i'?ve\s+got\s+(the\s+)?plug|hmu\s+for\s+(zaza|gas|loud|tree|that|some)|dm\s+for\s+(prices|menu|that|some)|menu\s+is\s+(up|live)|fresh\s+(pack|drop|batch))\b/gi,
  /\b(plug\s+is\s+up|drops?\s+(today|tonight)|dm\s+to\s+cop|hit\s+my\s+line\s+for|cashapp\s+for)\b/gi,
];

const DOSAGE_SHARING_PATTERNS = [
  /\b\d+\s*mg\s+of\s+(molly|mdma|xan|adderall|coke|fent|ket)\b/gi,
  /\b(\d+\s*tabs?\s+of\s+acid|\d+\s+bumps?\s+of\s+(coke|ket)|\d+\s+bars?\s+of\s+xan)\b/gi,
];

// Spanish and Portuguese: the substance with a praising or buying word, never alone. "La coca" is
// also a plant and a soft drink, and "la marihuana medicinal" is a policy topic.
const ES_PT_STREET_SLANG_PATTERNS = [
  /\b(?:la\s+|el\s+|esta\s+|este\s+)?(coca|cocaina|coca[ií]na|merca|perico|tuti|marihuana|mota|hierba|[aá]cido|tacha|tachas|cristal|ket\w*)\s+(?:est[aá]\s+)?(?:buen[ií]sima|buena|brutal|de\s+la\s+buena|pura|fina|te\s+deja\s+loc[oa])\b/gi,
  /\b(?:tengo|consigo|vendo|manejo|reparto)\s+(?:la\s+)?(coca|merca|perico|marihuana|mota|hierba|tacha|tachas|cristal|pastillas)\b/gi,
  /\b(?:a\s+|essa\s+|esse\s+)?(coca[ií]na|p[oó]|maconha|erva|beck|bala|bolinha|lan[cç]a|cristal)\s+(?:[eé]\s+)?(?:muito\s+)?(?:boa|bom|foda|braba|top|pura|forte)\b/gi,
  /\b(?:tenho|vendo|consigo|trago)\s+(?:a\s+)?(coca[ií]na|p[oó]|maconha|erva|beck|bala|bolinha|lan[cç]a)\b/gi,
  // The pressure forms need the substance too: without it "experimenta uma" fired on "o sujeito
  // experimenta uma perda" (experiences a loss).
  /\b(?:tienes?\s+que\s+probar|prueba|no\s+seas\s+aburrid[oa]\s+y?\s*prueba)\s+(?:un[ao]\s+|una\s+|la\s+|el\s+|esta\s+|este\s+)?(coca|merca|perico|marihuana|mota|hierba|tacha|tachas|cristal|[aá]cido|pastilla|pastillas)\b/gi,
  /\b(?:tem\s+que\s+experimentar|experimenta|n[aã]o\s+seja\s+careta\s+e?\s*experimenta)\s+(?:um[a]?\s+|a\s+|o\s+|essa\s+|esse\s+)?(coca[ií]na|p[oó]|maconha|erva|beck|bala|bolinha|lan[cç]a|cristal)\b/gi,
  /\b(una\s+sola\s+no\s+(?:te\s+)?hace\s+nada|uma\s+s[oó]\s+n[aã]o\s+faz\s+mal)\b/gi,
];

const RO_STREET_SLANG_PATTERNS = [
  /\b(iarb[aă]|praf|cocain[aă]|coc[ași]|tig[aă]ri\s+(de\s+)?iarb[aă]|molly|ecstasy|ket\w*)\s+(bun[aă]|fain[aă]|tare|hits\s+different|fire)\b/gi,
  /\b(am\s+(iarb[aă]|praf|coc[ași])|caut\s+(iarb[aă]|praf|coc[ași])|hmu\s+pentru\s+(iarb[aă]|praf))\b/gi,
];

function drugStructuralHits(_ctx: LinguisticContext): SignalHit[] {
  return [];
}

export const drugPromotionClassifier: TechniqueClassifier = {
  classify(input: ClassifierInput): ClassifierOutput {
    const ctx = buildContext(input.text);
    const result = score(ctx, {
      technique: 'drug-promotion',
      signals: [
        patternSignal('illicit-glorification', 3, ILLICIT_GLORIFICATION_PATTERNS),
        patternSignal('vape-minor-market', 3, VAPE_MINOR_MARKET_PATTERNS),
        patternSignal('recreational-coercion', 3, RECREATIONAL_COERCION_PATTERNS),
        patternSignal('dealer-acquisition', 3, DEALER_ACQUISITION_PATTERNS),
        patternSignal('dosage-sharing', 2, DOSAGE_SHARING_PATTERNS),
        patternSignal('ro-street-slang', 3, RO_STREET_SLANG_PATTERNS),
        patternSignal('es-pt-street-slang', 3, ES_PT_STREET_SLANG_PATTERNS),
        patternSignal('illicit-obfuscated', 2, ILLICIT_GLORIFICATION_PATTERNS, { matchAggressive: true, maxHits: 1 }),
        patternSignal('dealer-obfuscated', 2, DEALER_ACQUISITION_PATTERNS, { matchAggressive: true, maxHits: 1 }),
      ],
      structural: drugStructuralHits,
      registerPolicy: {
        'news-report': 0.30,
        'clickbait': 1.10,
        'promotional': 1.20,
        'conversational': 1.00,
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
