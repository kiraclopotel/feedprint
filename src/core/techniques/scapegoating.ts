// Group blame, othering, and conspiracy attribution. Group blame is a construction, a group noun
// with a blanket predicate, not a word, which is why it survives translation where the English
// conspiracy idioms do not.

import { ClassifierInput, ClassifierOutput, TechniqueClassifier } from './types';
import { PatternSet, runPatternClassifier } from './classify-helpers';

const PATTERNS: PatternSet = {
  strong: [
    /\b(they|those people|these people) (are|is) (the reason|why|responsible for|to blame|destroying|ruining)\b/i,
    /\b(all|every) (immigrants|liberals|conservatives|boomers|millennials|men|women) (are|do|want)\b/i,
    /\bblame (the|those|these)\b/i,
    /\bit'?s (all )?(their|his|her) fault\b/i,
    /\b(traitors?|enemies) in (government|congress|parliament|power)\b/i,
    /\b(CIA|FBI|deep state|Soros|they|the left|the right)\b.{0,30}\b(installed|planted|put|placed)\b/i,
    /\b(installed|planted|put|placed)\b.{0,20}\b(in power|in office|in charge|as president|as leader)\b/i,
    /\b(deep state|shadow government|new world order|cabal|puppet master|handlers?)\b/i,
    /\bthey (put|placed|installed) (him|her|them) there\b/i,
    // Romanian
    /\b(ei|ace[sș]tia|aia|[aă][sș]tia) (ne-?au|au|i-?au)\b.{0,30}\b(distrus|v[âa]ndut|f[aă]cut|pus|b[aă]gat|adus)\b/i,
    // "Put there by" needs a real agent ("de către", "la comanda", a named group). With a bare "de"
    // it matched Spanish and Portuguese wholesale: `pus` is also their stem for "put" ("puso de
    // pie"), and "de" is one of their commonest words.
    /\b(pus|pus[aă]|puse|pu[sș]i|instalat|plasat|plantat|b[aă]gat)\w{0,3}\b.{0,15}\b(?:de\s+c[aă]tre|la\s+comanda|de\s+(?:ei|ele|el|ea|americani|ru[sș]i|sistem|partid|guvern|servicii|str[aă]ini|ONG))\b/i,
    // "Toți" needs a named group. With any words in between it fired on "Toți prietenii mei sunt
    // minunați" (all my friends are wonderful), strong enough alone to clear the threshold. A
    // demonstrative ("toți ăștia") points at a group and counts; a possessive does not. "Nu toți"
    // (not all) is the opposite of group blame, as in the Spanish below.
    /(?<!\bnu\s)\b(?:to[tț]i|toate)\s+(?:[aă][sș]tia|[aă]ia|imigran[tț]ii|str[aă]inii|musulmanii|evreii|[tț]iganii|romii|ungurii|ru[sș]ii|americanii|politicienii|jurnali[sș]tii|bugetarii|s[aă]racii|boga[tț]ii)\b.{0,20}\b(sunt|fac|vor|au)\b/i,
    // Spanish
    /\b(?:ellos|esa\s+gente|esta\s+gente|los\s+de\s+afuera)\s+(?:son|es)\s+(?:el\s+problema|la\s+raz[oó]n|los\s+culpables|quienes\s+(?:arruinan|destruyen))\b/i,
    // "No todos los judios son religiosos" (not all Jews are religious) is the opposite of group
    // blame, and the benign corpus has it.
    /(?<!\bno\s)(?:todos\s+los|todas\s+las)\s+(?:inmigrantes|extranjeros|musulmanes|jud[ií]os|gitanos|pol[ií]ticos|periodistas)\s+(?:son|quieren|hacen)\b/i,
    /\bes\s+culpa\s+de\s+(?:ellos|los|las|esa\s+gente)\b/i,
    /\bpor\s+culpa\s+de\s+(?:los|las|esa\s+gente|ellos)\b/i,
    /\b(?:el\s+)?(?:estado\s+profundo|nuevo\s+orden\s+mundial|los\s+globalistas|la\s+[eé]lite\s+mundial)\b/i,
    // Portuguese
    /\b(?:eles|essa\s+gente|esse\s+povo)\s+(?:s[aã]o|[eé])\s+(?:o\s+problema|a\s+raz[aã]o|os\s+culpados|quem\s+(?:arruina|destr[oó]i))\b/i,
    /(?<!\bn[aã]o\s)tod[oa]s\s+os?\s+(?:imigrantes|estrangeiros|mu[cç]ulmanos|judeus|ciganos|pol[ií]ticos|jornalistas)\s+(?:s[aã]o|querem|fazem)\b/i,
    /\b[eé]\s+culpa\s+(?:deles|delas|dessa\s+gente)\b/i,
    /\bpor\s+causa\s+d(?:eles|elas|essa\s+gente)\b/i,
    /\b(?:o\s+)?(?:estado\s+profundo|nova\s+ordem\s+mundial|os\s+globalistas|a\s+elite\s+mundial)\b/i,
  ],
  moderate: [
    /\b(globalist|elitist|the establishment|ruling class|oligarch)\w*\b/i,
    /\bbecause of (the|those|these|all the)\b/i,
    // Romanian
    /\b(din cauza|din vina|pe (capul|spatele|seama))\b.{0,15}\b(lor|acestora|[aă]stora)\b/i,
  ],
  exceptions: [
    /\b(policy|legislation|decision|action) (led to|caused|resulted)\b/i,
  ],
};

export const scapegoatingClassifier: TechniqueClassifier = {
  classify(input: ClassifierInput): ClassifierOutput {
    return runPatternClassifier(input.text, 'scapegoating', PATTERNS);
  },
};
