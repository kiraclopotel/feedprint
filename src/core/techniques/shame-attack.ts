// Identity attacks, conditional worth, and "no real man would" gatekeeping.

import { ClassifierInput, ClassifierOutput, TechniqueClassifier } from './types';
import { PatternSet, runPatternClassifier } from './classify-helpers';

const PATTERNS: PatternSet = {
  strong: [
    /you'?re (disgusting|pathetic|worthless|trash|a joke|embarrassing|terrible|horrible|awful) if/i,
    /you'?re .{0,10}(disgusting|pathetic|worthless|terrible|horrible) (person|human)/i,
    /\b(real|true|good) (men|women|parents|people) (would|don'?t|always)/i,
    /no (real |true )?(man|woman|parent|person) would/i,
    /what'?s wrong with you/i,
    /you should be (ashamed|embarrassed)/i,
    /you'?re just (uneducated|ignorant|stupid|dumb|blind|clueless)/i,
    /\bNO EXCUSES\b/,
    /\b(fake (person|human|people)|fakeness|phon(y|ey|ie)|fraud|charlatan|impostor)\b/i,
    // Character assassination by comparison: "X is the Hitler of ...", "a version of Stalin".
    /\bis (the|a|another|our|basically) .{0,20}(hitler|stalin|devil|satan|judas|antichrist|cancer|plague|disease)\b/i,
    /\b(version|clone|copy|reincarnation) of\b.{0,20}\b(hitler|stalin|devil|satan|ceausescu|mao|mussolini)\b/i,
    // Romanian
    /\b(ru[sș]ine|ru[sș]inos|s[aă]-[tț]i fie ru[sș]ine|n-ai pic de)\b/i,
    /\be[sș]ti (doar |numai )?(un |o )?(prost|proast[aă]|idiot|analfabet|incult|needucat|ignorant)\w*\b/i,
    // Spanish
    /\beres\s+(?:un[ao]?\s+)?(?:asqueros[oa]|pat[eé]tic[oa]|in[uú]til|basura|una\s+verg[uü]enza)\s+si\b/i,
    /\bning[uú]n\s+(?:hombre|mujer|padre|madre|persona)\s+de\s+verdad\s+(?:har[ií]a|dir[ií]a|permitir[ií]a)\b/i,
    /\b(?:qu[eé]\s+te\s+pasa|qu[eé]\s+problema\s+tienes)\b/i,
    /\bdeber[ií]as\s+(?:darte\s+verg[uü]enza|avergonzarte)\b/i,
    /\beres\s+(?:solo\s+|nada\s+m[aá]s\s+que\s+)?un[ao]?\s+(?:ignorante|incult[oa]|analfabet[oa]|est[uú]pid[oa])\b/i,
    // Portuguese
    /\bvoc[eê]\s+[eé]\s+(?:um[a]?\s+)?(?:nojent[oa]|pat[eé]tic[oa]|in[uú]til|lixo|uma\s+vergonha)\s+se\b/i,
    /\bnenhum[a]?\s+(?:homem|mulher|pai|m[aã]e|pessoa)\s+de\s+verdade\s+(?:faria|diria|permitiria)\b/i,
    /\b(?:qual\s+[eé]\s+o\s+seu\s+problema|o\s+que\s+h[aá]\s+de\s+errado\s+com\s+voc[eê])\b/i,
    /\bvoc[eê]\s+deveria\s+(?:ter\s+vergonha|se\s+envergonhar)\b/i,
    // The dismissive "just" is required, as in English. Without it "Ninguem acha que voce e
    // estupido" (nobody thinks you are stupid) fires, and the benign corpus has it.
    /\bvoc[eê]\s+[eé]\s+(?:s[oó]|apenas|nada\s+al[eé]m\s+de)\s+(?:um[a]?\s+)?(?:ignorante|analfabet[oa]|burr[oa]|est[uú]pid[oa])\b/i,
  ],
  moderate: [
    /\b(loser|failure|weak|coward|snowflake)\b/i,
    /imagine (being|thinking|believing)/i,
    /\b(clown|joke|embarrassment|disgrace|laughingstock|sellout)\b/i,
    // Romanian
    /\b(penibil|jalnic|ridicol|lamentabil|mediocru|nesim[tț]it)\w*\b/i,
    // Spanish and Portuguese. 'payaso' and 'palhaco' are left out, unlike 'clown': there the
    // circus sense dominates, and the insult needs the "you are" the strong list already requires.
    /\b(perdedor(?:es|a|as)?|fracasad[oa]s?|cobarde|pat[eé]tic[oa])\b/i,
    /\b(fracassad[oa]s?|covarde|vergonha\s+alheia)\b/i,
    /\bimagina(?:r)?\s+(?:ser|pensar|creer|acreditar|achar)\b/i,
  ],
  exceptions: [
    /\b(self-reflection|accountability)\b/i,
    /\b(i feel ashamed|i'?m embarrassed)\b/i,
  ],
};

export const shameAttackClassifier: TechniqueClassifier = {
  classify(input: ClassifierInput): ClassifierOutput {
    return runPatternClassifier(input.text, 'shame-attack', PATTERNS);
  },
};
