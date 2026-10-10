// Weapon glorification, praise of shooters, gore, calls to hurt someone, and death threats. News
// and a victim's own account are dampened. Known gap: games and fiction share the words, so a
// pattern cannot tell "I killed the boss in Elden Ring" from "I'll kill you"; aiming at "you" only
// narrows it, and the AI judge has to separate the rest. Vocabulary drawn from the Anti-Defamation
// League's Center on Extremism reports, Tech Against Terrorism's "Trends in Terrorist Online
// Content", and the GIFCT hash-sharing taxonomy.

import { ClassifierInput, ClassifierOutput, TechniqueClassifier } from './types';
import { buildContext, LinguisticContext } from './linguistic-features';
import { score, patternSignal, SignalHit } from './scoring';

const WEAPON_GLORIFICATION_PATTERNS = [
  /\b(got\s+my\s+new\s+(ar(?:-?15)?|ak(?:-?47)?|glock|9mm|45|357|sig|rifle|pistol|firearm|shotty|beretta)|love\s+(this|my)\s+(gun|rifle|piece|strap)|gun\s+goes\s+brrr)\b/gi,
  /\b(strap\s+up|locked\s+and\s+loaded|round\s+chambered|gat\s+ready|burner\s+(loaded|ready))\b/gi,
  // Romanian
  /\b(am\s+luat\s+(un\s+)?(pistol|pu[sș]c[aă]|arm[aă])|iubesc\s+arma\s+mea)\b/gi,
];

const SHOOTER_PRAISE_PATTERNS = [
  /\b(klebold|harris|cho|cruz|lanza|tarrant|breivik)\s+(was|did|got\s+it|had\s+a\s+point|was\s+right|hero)\b/gi,
  /\b(next\s+(school\s+shooter|columbine|sandy\s+hook|parkland)|i'?ll\s+(do|pull)\s+a\s+(columbine|sandy\s+hook|parkland|virginia\s+tech))\b/gi,
  /\b(martyrdom\s+manifesto|saint\s+(tarrant|breivik|harris)|kebab\s+removal)\b/gi,
];

const GORE_DESCRIPTION_PATTERNS = [
  /\b(blood\s+(everywhere|all\s+over|spraying|gushing|fountain)|head\s+(exploded|blown\s+off|caved\s+in)|brains?\s+(splattered|everywhere|all\s+over))\b/gi,
  /\b(torn\s+(apart|to\s+pieces|to\s+shreds)|chopped\s+(up|to\s+bits)|guts?\s+(spilling|hanging|out))\b/gi,
  // Romanian
  /\b(s[aâ]nge\s+peste\s+tot|capul\s+(zburat|explodat)|sf[aâ]rtecat|m[aă]runt\s+ca\s+nimic)\b/gi,
];

const COORDINATION_HARM_PATTERNS = [
  /\b(let'?s\s+(hurt|beat|attack|jump|pile\s+on)\s+(this|that|him|her|them|@\w+)|we\s+should\s+(hurt|beat|jump|attack)\s+(this|that|him|her|them))\b/gi,
  /\b(find\s+out\s+where\s+(she|he|they)\s+(lives?|works?|goes\s+to\s+school)|dox\s+(her|him|them))\b/gi,
  /\b(let'?s\s+swarm|everyone\s+(attack|jump|beat)\s+@?\w+|mass\s+(attack|swarm|beating))\b/gi,
  // Romanian
  /\b(hai\s+s[aă]\s+(b[aă]t|atac[aă]m|s[aă]rim\s+pe)\s+(el|ea|@\w+)|afl[aă]m\s+unde\s+(locuie[sș]te|st[aă]|merge))\b/gi,
];

const DEATH_THREAT_PATTERNS = [
  /\b(i'?ll\s+(kill|murder|end|finish|cap)\s+(you|@\w+)|you\s+should\s+die|i'?ll\s+find\s+you\s+and\s+(kill|hurt|end))\b/gi,
  /\b(you'?re\s+(gonna|going\s+to)\s+(die|get\s+killed|catch\s+a\s+bullet)|i'?ll\s+(slit\s+your\s+throat|put\s+(a|one)\s+in\s+you))\b/gi,
  // Romanian
  /\b(te\s+omor|o\s+s[aă]\s+te\s+omor|te\s+termin|te\s+g[aă]sesc\s+[sș]i\s+te\s+omor)\b/gi,
  // Spanish drops the subject, so these anchor on the verb and its object: 'te mato' is the whole
  // threat. "Te voy a matar de risa" (I'll make you die laughing) is everyday hyperbole, excluded.
  /\b(?:te\s+(?:mato|voy\s+a\s+matar|matar[eé]|reviento|parto\s+la\s+cara)|voy\s+a\s+matarte|te\s+voy\s+a\s+(?:reventar|romper\s+la\s+cara))\b(?!\s+de\s+risa)/gi,
  /\b(te\s+encuentro\s+y\s+te\s+mato|te\s+voy\s+a\s+encontrar|vas\s+a\s+morir|te\s+corto\s+el\s+cuello|te\s+meto\s+un\s+tiro)\b/gi,
  // Portuguese
  /\b(?:te\s+mato|vou\s+te\s+matar|vou\s+matar\s+voc[eê]|te\s+quebro|vou\s+te\s+quebrar|vou\s+te\s+arrebentar)\b(?!\s+de\s+rir)/gi,
  /\b(te\s+acho\s+e\s+te\s+mato|vou\s+te\s+encontrar|voc[eê]\s+vai\s+morrer|corto\s+sua\s+garganta|meto\s+uma\s+bala\s+em\s+voc[eê])\b/gi,
];

const GORE_DESCRIPTION_ES_PT_PATTERNS = [
  /\b(sangre\s+por\s+todas\s+partes|la\s+cabeza\s+(?:explot[oó]|reventada)|sesos\s+(?:por\s+todas\s+partes|desparramados)|destrozad[oa]\s+en\s+pedazos|las\s+tripas\s+(?:fuera|colgando))\b/gi,
  /\b(sangue\s+por\s+(?:todo\s+lado|toda\s+parte)|a\s+cabe[cç]a\s+(?:explodiu|estourou)|miolos\s+(?:espalhados|para\s+todo\s+lado)|despeda[cç]ad[oa]|as\s+tripas\s+(?:para\s+fora|penduradas))\b/gi,
];

const COORDINATION_HARM_ES_PT_PATTERNS = [
  /\b(vamos\s+a\s+(?:pegarle|golpearlo|golpearla|caerle\s+encima)|hay\s+que\s+(?:pegarle|darle\s+una\s+paliza)|entre\s+todos\s+le\s+(?:pegamos|caemos))\b/gi,
  /\b(vamos\s+(?:bater|pegar)\s+n(?:ele|ela)|bora\s+(?:bater|pegar)\s+n(?:ele|ela)|vamos\s+dar\s+uma\s+surra\s+n(?:ele|ela))\b/gi,
  /\b(averig[uü]en\s+d[oó]nde\s+(?:vive|trabaja|estudia)|descubran\s+d[oó]nde\s+(?:vive|trabaja)|descubram\s+onde\s+(?:ele|ela)\s+(?:mora|trabalha|estuda))\b/gi,
];

function violenceStructuralHits(_ctx: LinguisticContext): SignalHit[] {
  return [];
}

export const violenceGraphicClassifier: TechniqueClassifier = {
  classify(input: ClassifierInput): ClassifierOutput {
    const ctx = buildContext(input.text);
    const result = score(ctx, {
      technique: 'violence-graphic',
      signals: [
        patternSignal('weapon-glorification', 3, WEAPON_GLORIFICATION_PATTERNS),
        patternSignal('shooter-praise', 4, SHOOTER_PRAISE_PATTERNS),
        patternSignal('gore-description', 3, GORE_DESCRIPTION_PATTERNS),
        patternSignal('coordination-harm', 4, COORDINATION_HARM_PATTERNS),
        patternSignal('death-threat', 4, DEATH_THREAT_PATTERNS),
        patternSignal('gore-description-es-pt', 3, GORE_DESCRIPTION_ES_PT_PATTERNS),
        patternSignal('coordination-harm-es-pt', 4, COORDINATION_HARM_ES_PT_PATTERNS),
        patternSignal('weapon-obfuscated', 2, WEAPON_GLORIFICATION_PATTERNS, { matchAggressive: true, maxHits: 1 }),
        patternSignal('death-threat-obfuscated', 2, DEATH_THREAT_PATTERNS, { matchAggressive: true, maxHits: 1 }),
      ],
      structural: violenceStructuralHits,
      registerPolicy: {
        'news-report': 0.30,
        'clickbait': 1.00,
        'conversational': 1.05,
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
