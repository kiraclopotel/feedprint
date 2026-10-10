// Organized harassment: "let's pile on", doxxing ("her address is"), "everyone tag her", mass
// reporting. combined-stack measures how hot one person's post is; this looks for a crowd being
// aimed. Slurs are not here on purpose: src/core/profanity-filter.ts holds the one hardened list,
// because two lists drift apart. Categories follow Detoxify and the Perspective API; harassment
// patterns follow the ADL's "Online Hate and Harassment" survey and PEN America's "Online
// Harassment Field Manual".

import { ClassifierInput, ClassifierOutput, TechniqueClassifier } from './types';
import { buildContext, LinguisticContext } from './linguistic-features';
import { score, patternSignal, SignalHit } from './scoring';

const COORDINATION_PHRASE_PATTERNS = [
  /\b(send\s+this\s+to\s+(her|him|them|@\w+)|let'?s\s+(pile\s+on|swarm|brigade|gang\s+up\s+on)\s+(her|him|them|@?\w+)|dm\s+(her|him|them)\s+(this|the\s+truth|hard))\b/gi,
  /\b(everyone\s+(reply|comment|tag|drag)\s+(her|him|them|@?\w+)|mass\s+(report|reply|tag)\s+(her|him|them|@?\w+))\b/gi,
  /\b(let'?s\s+(make|get)\s+(her|him|them|@?\w+)\s+(cry|leave|delete\s+(her|his|their)\s+account))\b/gi,
  // Romanian
  /\b(trimite[tț]i?-i\s+asta|toat[aă]\s+lumea\s+(comenta[tț]i|tagga[tț]i|raporta[tț]i)\s+(@?\w+|pe\s+(ea|el))|hai\s+s[aă]\s+(o|[iî]l)\s+facem\s+s[aă]\s+pl[aâ]ng[aă])\b/gi,
  // Spanish. An order to an audience plus a target is a construction, so it translates.
  /\b(m[aá]ndenle\s+esto|env[ií]enle\s+esto|todos\s+a\s+(?:comentar|reportar|etiquetar)|vamos\s+a\s+(?:reportarla|reportarlo|cancelarla|cancelarlo)|entre\s+todos\s+la\s+(?:reportamos|cancelamos))\b/gi,
  /\b(hay\s+que\s+hacerla\s+llorar|hagamos\s+que\s+(?:se\s+vaya|borre\s+su\s+cuenta)|que\s+cierre\s+su\s+cuenta|repórtenl[oa]|reportenl[oa])\b/gi,
  // Portuguese
  /\b(manda\s+isso\s+pra\s+(?:ela|ele)|todo\s+mundo\s+(?:comenta|denuncia|marca)|bora\s+(?:denunciar|cancelar)\s+(?:ela|ele)|vamos\s+(?:denunciar|cancelar)\s+(?:ela|ele))\b/gi,
  /\b(faz\s+(?:ela|ele)\s+chorar|vamos\s+fazer\s+(?:ela|ele)\s+(?:chorar|sair|deletar)|denuncia\s+em\s+massa)\b/gi,
];

const DOXXING_HINT_PATTERNS = [
  // Exposure needs a locator (an address, a street number, a real name), not just a verb: "She
  // lives in Paris with her husband" is biography, and at weight 4 over a threshold of 4 it read
  // as harassment on its own. Naming the school someone attends stays, because for a child that
  // is the exposure itself.
  /\b(?:(?:her|his|their)\s+(?:address|home|workplace|real\s+name|phone\s+number)\s+is\b|(?:she|he|they)\s+goes\s+to\s+school\s+at\s+\w|(?:she|he|they)\s+lives\s+(?:at\s+\d|on\s+\w+\s+(?:street|st|road|rd|avenue|ave|lane|drive|blvd)\b))/gi,
  /\b(find\s+(her|him|them)\s+at|track\s+(her|him|them)\s+down|got\s+(her|his|their)\s+(real\s+name|ip|address|workplace))\b/gi,
  /\b(she'?s\s+a\s+\d{2,}\s*[FfMm]\s+from\s+\w+|@\w+\s+real\s+name\s+is\s+\w+)\b/gi,
  // Spanish and Portuguese, the same locator rule: without it "Ele mora na periferia de Londres"
  // fired at severity 6. The order to dox lives in coded-harm-catcher.ts, with its negation
  // guards.
  /\b(su\s+(?:direcci[oó]n|n[uú]mero|tel[eé]fono|nombre\s+real)\s+es\b|vive\s+en\s+(?:la\s+calle|el\s+n[uú]mero|el\s+barrio\s+de)\b|tengo\s+su\s+(?:direcci[oó]n|tel[eé]fono|ip|nombre\s+real)\b)/gi,
  /\b(o\s+(?:endere[cç]o|n[uú]mero|telefone|nome\s+real)\s+d(?:ele|ela)\s+[eé]\b|mora\s+na\s+rua\b|tenho\s+o\s+(?:endere[cç]o|telefone|ip|nome\s+real)\s+d(?:ele|ela)\b)/gi,
];

const PILE_ON_PATTERNS = [
  /\b(everyone\s+(should\s+)?hate\s+(her|him|them|@?\w+)|let'?s\s+(ratio|cancel|destroy)\s+(her|him|them|@?\w+))\b/gi,
  /\b(swarm\s+(her|him|them|@?\w+)\s+(account|posts?|comments?)|drag\s+(her|him|them|@?\w+)\s+in\s+(the\s+)?(comments|replies))\b/gi,
];

const MASS_REPORT_PATTERNS = [
  /\b(everyone\s+report\s+(her|his|their)\s+(account|profile|post|video|page)|mass\s+report\s+@?\w+|brigade\s+report\s+(her|him|them))\b/gi,
  /\b(let'?s\s+get\s+(her|him|them|@?\w+)\s+(banned|suspended|removed|locked))\b/gi,
];

const HARASSMENT_COORDINATION_PATTERNS = [
  /\b(let'?s\s+make\s+(her|him|them)\s+(life\s+hell|miserable|delete)|brigade\s+(her|him|them|the\s+thread))\b/gi,
  /\b(every\s+(reply|account|comment)\s+counts|amplify\s+(this|the\s+drag)|don'?t\s+let\s+(this|her|him|them)\s+(go|breathe))\b/gi,
];

function toxicityStructuralHits(ctx: LinguisticContext): SignalHit[] {
  const hits: SignalHit[] = [];
  const f = ctx.features;
  // Tagging three or more people is how a pile-on is gathered.
  if (f.mentionCount >= 3) {
    hits.push({
      signalId: 'mention-saturation',
      weight: 1.0,
      evidence: `${f.mentionCount} mentions`,
      reason: 'structural: heavy @mention coordination tagging',
    });
  }
  return hits;
}

export const extremeToxicityClassifier: TechniqueClassifier = {
  classify(input: ClassifierInput): ClassifierOutput {
    const ctx = buildContext(input.text);
    const result = score(ctx, {
      technique: 'extreme-toxicity',
      signals: [
        patternSignal('coordination-phrase', 4, COORDINATION_PHRASE_PATTERNS),
        patternSignal('doxxing-hint', 4, DOXXING_HINT_PATTERNS),
        patternSignal('pile-on', 3, PILE_ON_PATTERNS),
        patternSignal('mass-report', 3, MASS_REPORT_PATTERNS),
        patternSignal('harassment-coordination', 3, HARASSMENT_COORDINATION_PATTERNS),
        patternSignal('coord-obfuscated', 2, COORDINATION_PHRASE_PATTERNS, { matchAggressive: true, maxHits: 1 }),
        patternSignal('doxx-obfuscated', 2, DOXXING_HINT_PATTERNS, { matchAggressive: true, maxHits: 1 }),
      ],
      structural: toxicityStructuralHits,
      registerPolicy: {
        'news-report': 0.30,
        'clickbait': 1.00,
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
