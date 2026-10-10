// Dismissing feelings, forced gratitude, and "others have it worse".

import { ClassifierInput, ClassifierOutput, TechniqueClassifier } from './types';
import { PatternSet, runPatternClassifier } from './classify-helpers';

const PATTERNS: PatternSet = {
  strong: [
    /\bjust (think positive|be happy|smile|stay positive|look on the bright side)\b/i,
    /\b(good vibes only|no negativity|stop complaining|be grateful)\b/i,
    /\beverything happens for a reason\b/i,
    /\b(other people have it worse|at least you)\b/i,
    // Romanian
    /\b(g[âa]nde[sș]te pozitiv|nu te (mai )?pl[âa]nge|fii recunosc[aă]tor|z[âa]mbe[sș]te)\b/i,
    /\b(al[tț]ii o duc mai r[aă]u|m[aă]car (tu|voi))\b/i,
    // Spanish
    /\bsolo\s+(?:piensa\s+en\s+positivo|s[eé]\s+feliz|sonr[ií]e|mira\s+el\s+lado\s+bueno)\b/i,
    /\b(?:buenas\s+vibras|nada\s+de\s+negatividad|deja\s+de\s+quejarte|s[eé]\s+agradecid[oa])\b/i,
    /\btodo\s+pasa\s+por\s+(?:algo|una\s+raz[oó]n)\b/i,
    /\b(?:otros\s+est[aá]n\s+peor|hay\s+gente\s+peor|al\s+menos\s+t[uú]\s+(?:tienes|puedes))\b/i,
    // Portuguese. The dismissive "just" is required, as in English: without it "que voce seja
    // feliz" is an ordinary good wish, and the benign corpus has it. Bare 'sorria' is out because
    // "Maria apenas sorria" (Maria only smiled) is narration, not an order.
    /\b(?:s[oó]|apenas|simplesmente)\s+(?:pensa\s+positivo|seja\s+feliz|olha\s+o\s+lado\s+bom)\b/i,
    /\b(?:boas\s+vibra[cç][oõ]es|nada\s+de\s+negatividade|para\s+de\s+reclamar|seja\s+grat[oa])\b/i,
    /\btudo\s+acontece\s+por\s+(?:um\s+)?(?:motivo|uma\s+raz[aã]o)\b/i,
    /\b(?:tem\s+gente\s+pior|os\s+outros\s+est[aã]o\s+pior|pelo\s+menos\s+voc[eê]\s+(?:tem|pode))\b/i,
  ],
  moderate: [
    // Romanian
    /\b(las[aă] negativismul|doar energie pozitiv[aă]|totul se [îi]nt[âa]mpl[aă] cu un scop)\b/i,
  ],
  exceptions: [
    /\b(cognitive (behavioral|reframing)|therapy|counseling)\b/i,
    /\b(I try to|it helps me to|personally I)\b/i,
  ],
};

export const toxicPositivityClassifier: TechniqueClassifier = {
  classify(input: ClassifierInput): ClassifierOutput {
    return runPatternClassifier(input.text, 'toxic-positivity', PATTERNS);
  },
};
