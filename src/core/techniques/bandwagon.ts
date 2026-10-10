// False consensus, social-proof pressure, and "you're the only one who disagrees".

import { ClassifierInput, ClassifierOutput, TechniqueClassifier } from './types';
import { PatternSet, runPatternClassifier } from './classify-helpers';

const PATTERNS: PatternSet = {
  strong: [
    /\beveryone (knows|agrees|understands|can see|else)\b/i,
    /\ball (reasonable|smart|educated|good) people\b/i,
    /\bnobody (disagrees|denies|questions)\b/i,
    /if you (still )?(disagree|think|believe).{0,20}you'?re (the only|just|alone)/i,
    /\beveryone (else )?(cares?|is doing|supports?|sees?)\b/i,
    // Romanian
    /\btoat[aă] lumea ([sș]tie|vede|[îi]n[tț]elege|e de acord)\b/i,
    /\bnimeni nu (mai )?(crede|neag[aă]|contest[aă])\b/i,
    // Spanish
    /\btod[oa]\s+el\s+mundo\s+(?:sabe|ve|entiende|est[aá]\s+de\s+acuerdo|lo\s+sabe)\b/i,
    /\btodas?\s+las\s+personas\s+(?:razonables|inteligentes|educadas|decentes)\b/i,
    /\bnadie\s+(?:lo\s+)?(?:niega|discute|cuestiona|duda)\b/i,
    /\bsi\s+(?:todav[ií]a\s+)?(?:no\s+lo\s+ves|piensas\s+lo\s+contrario)\b.{0,20}\beres\s+el\s+[uú]nico\b/i,
    // Portuguese
    /\btodo\s+mundo\s+(?:sabe|v[eê]|entende|concorda)\b/i,
    /\btodas?\s+as\s+pessoas\s+(?:razo[aá]veis|inteligentes|educadas|decentes)\b/i,
    /\bningu[eé]m\s+(?:nega|discute|questiona|duvida)\b/i,
    /\bse\s+voc[eê]\s+(?:ainda\s+)?(?:n[aã]o\s+v[eê]|discorda)\b.{0,20}\b[eé]\s+o\s+[uú]nico\b/i,
  ],
  moderate: [
    /\b(millions|thousands|everyone) (is|are) (saying|doing|switching)\b/i,
    // Romanian
    /\b(milioane|mii) de (oameni|rom[âa]ni) (spun|cred|vor|au)\b/i,
    // Spanish and Portuguese
    /\b(millones|miles)\s+de\s+(?:personas|usuarios|mujeres|hombres)\s+(?:ya\s+)?(?:est[aá]n|dicen|usan|se\s+cambiaron)\b/i,
    /\b(milh[oõ]es|milhares)\s+de\s+(?:pessoas|usu[aá]rios|mulheres|homens)\s+(?:j[aá]\s+)?(?:est[aã]o|dizem|usam|mudaram)\b/i,
  ],
  exceptions: [
    /\b(survey|poll|study|research|data) (shows|indicates|found)\b/i,
    /\b\d+% (of|say|agree)\b/i,
  ],
};

export const bandwagonClassifier: TechniqueClassifier = {
  classify(input: ClassifierInput): ClassifierOutput {
    return runPatternClassifier(input.text, 'bandwagon', PATTERNS);
  },
};
