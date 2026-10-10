// Encouraging someone else to harm themselves, or glorifying methods, starving or cutting. A
// person's own distress is not the target, so news, quoted attacks and first-person feelings are
// dampened. Known gaps: raw text barely separates "i want to kys" from "kys" aimed at someone;
// subtle pro-ana ("eat less today bestie") needs the AI judge; and nothing yet offers help to a
// person in crisis when this fires on their own words. Grounded in the WHO and IASP guide for
// media on suicide (Pirkis, Blood and others, 2017), CDC suicide-cluster reports, and published
// pro-ana research from Stanford and ProjectKnow.

import { ClassifierInput, ClassifierOutput, TechniqueClassifier } from './types';
import { buildContext, LinguisticContext } from './linguistic-features';
import { score, patternSignal, SignalHit } from './scoring';

// A plea uses the attack's words ("don't kill yourself, seek help"), so a match right after a
// prohibition does not count; only the few words below may stand between, since a wider gap would
// pass "don't hesitate to kill yourself", and a "why" in front ("why don't just kys") keeps the
// taunt. Spanish and Romanian change the verb under negation ('no te mates', 'nu te omori'), so only
// English and Portuguese ('voce nao vai se matar') reach a plea here.
const APOSTROPHE = "(?:['`\\u00b4]|\\s)?";
const PROHIBITIONS = [
  `don${APOSTROPHE}t\\s+you\\s+(?:ever\\s+)?dare(?:\\s+to)?`,
  `don${APOSTROPHE}t`, 'do\\s+not', 'never',
  `shouldn${APOSTROPHE}t`, 'should\\s+not', `mustn${APOSTROPHE}t`, 'must\\s+not',
  'no\\s+one\\s+should', 'nobody\\s+should',
  'n[ãa]o', 'nunca', 'jamais',
].join('|');
const BETWEEN_PROHIBITION_AND_MATCH = 'ever|even|just|go|really|actually|try\\s+to';
const TAUNT_BEFORE_PROHIBITION = '\\b(?:why|por\\s+qu[eê]|porque|pq)\\s+(?:(?:you|u|voc[eê]|vc|tu)\\s+)?';
const NOT_AFTER_PROHIBITION =
  `(?<!(?<!${TAUNT_BEFORE_PROHIBITION})\\b(?:${PROHIBITIONS})(?:\\s+(?:${BETWEEN_PROHIBITION_AND_MATCH}))*\\s+)`;

function unlessProhibited(patterns: RegExp[]): RegExp[] {
  return patterns.map((re) => new RegExp(`${NOT_AFTER_PROHIBITION}(?:${re.source})`, re.flags));
}

// In this list only the English and Portuguese orders go through unlessProhibited, since a statement
// stays an attack after those words: 'nunca nadie te va a extrañar' means "nobody will ever miss
// you", and 'não' before 'ninguém vai sentir sua falta' can only mean "No".
const KYS_DIRECT_PATTERNS = [
  ...unlessProhibited([
    /\b(kys|k\.?y\.?s|kill\s+yourself|kill\s+(your)?self|go\s+kill\s+yourself|neck\s+yourself|an\s?hero|rope\s+yourself)\b/gi,
  ]),
  /\b(no\s+one\s+would\s+miss\s+you|world\s+would\s+be\s+better\s+without\s+you|you\s+should\s+(die|kill\s+yourself))\b/gi,
  // Romanian
  /\b(omoar[aă]-te|sinucide-te|du-te\s+(s[aă]\s+)?mori|mai\s+bine\s+mori)\b/gi,
  // Spanish puts the pronoun after an order ('matate') and before a negation ('no te mates'), so
  // these forms miss both negations and first-person statements ('quiero matarme'). The
  // lookaheads drop everyday hyperbole: 'matate de risa', 'muerete de envidia'.
  /\bmata(?:te|nse)\b(?!\s+(?:de\s+(?:risa|la\s+risa|hambre|frio|calor|envidia)|a\s+estudiar|estudiando|trabajando|riendo))/gi,
  /\b(suicida(?:te|nse)|ahorca(?:te|nse)|corta(?:te|nse)\s+las\s+venas|(?:pega|da)(?:te|nse)\s+un\s+tiro)\b/gi,
  /\bmuere(?:te|nse)\b(?!\s+de\s+(?:risa|envidia|celos|amor|ganas|verguenza|vergüenza))/gi,
  /\b(ojal[aá]\s+(?:te\s+)?(?:mueras|murieras)|(?:[aá]ndate|vete|v[aá]yanse)\s+a\s+morir|nadie\s+te\s+(?:va\s+a\s+)?extra[nñ]ar[aá]?|el\s+mundo\s+estar[ií]a\s+mejor\s+sin\s+ti)\b/gi,
  // Portuguese keeps the order under negation ('nao se mate'), so 'se mate' must open its
  // clause, where an order stands; the hyphenated 'mate-se' is always an order. 'Vai te matar'
  // is left out: it means "will kill you", a threat or an idiom.
  ...unlessProhibited([
    /(?:(?<=^|[.!?;:,\n¡¿]\s{0,3})se\s+(?:mate|suicide|enforque)|\b(?:mate|suicide|enforque)-se)\b/gi,
    /(?<!\b(?:ele|ela|eles|elas|voc[eê]|algu[eé]m|ningu[eé]m|que|se)\s)\bvai\s+se\s+matar\b(?!\s+(?:de\s+tanto|trabalhando|estudando|de\s+trabalhar|de\s+rir))/gi,
    /\b(cort[ae]\s+os\s+pulsos|se\s+jog[ae]\s+d[ao]\s+(?:ponte|janela|predio|prédio|viaduto|telhado))\b/gi,
  ]),
  /\b(ningu[eé]m\s+vai\s+sentir\s+sua\s+falta|o\s+mundo\s+seria\s+melhor\s+sem\s+voc[eê])\b/gi,
];

// A bare "go die" is gaming talk as often as not ("go die in the lava level, it respawns you"), and
// at weight 4 over a threshold of 3 it hid such sentences. Said to a person it still counts, so it
// adds weight 2, under the threshold. It has its own list because KYS_DIRECT_PATTERNS is read again
// at weight 3 by the obfuscated signal, which would clear the threshold alone.
const GO_DIE_AMBIGUOUS_PATTERNS = unlessProhibited([
  /\bgo\s+die\b/gi,
]);

const METHOD_GLORIFICATION_PATTERNS = [
  /\b(rope|ledge|train|pills|bleach|bullet|jumping|hanging)\s+is\s+(the\s+)?(best|easiest|fastest|painless|safest|quickest)\s+(way|method|option)\b/gi,
  /\b(easiest\s+way\s+to\s+go|painless\s+exit|quickest\s+way\s+out)\b/gi,
];

const METHOD_GLORIFICATION_ES_PT_PATTERNS = [
  /\b(?:la\s+)?(cuerda|soga|pastillas|lej[ií]a|bala|saltar|ahorcarse)\s+es\s+(?:la\s+|el\s+)?(?:mejor|m[aá]s\s+f[aá]cil|m[aá]s\s+r[aá]pid[oa]|menos\s+dolorosa?)\s+(?:forma|manera|opci[oó]n|m[eé]todo)\b/gi,
  /\b(?:a\s+)?(corda|pastilhas|rem[eé]dios|bala|pular|se\s+enforcar)\s+[eé]\s+(?:o\s+|a\s+)?(?:melhor|mais\s+f[aá]cil|mais\s+r[aá]pid[oa]|menos\s+dolorosa?)\s+(?:jeito|forma|maneira|op[cç][aã]o|m[eé]todo)\b/gi,
  /\b(la\s+salida\s+sin\s+dolor|la\s+forma\s+m[aá]s\s+f[aá]cil\s+de\s+irse|a\s+sa[ií]da\s+sem\s+dor|o\s+jeito\s+mais\s+f[aá]cil\s+de\s+ir)\b/gi,
];

const PRO_ANA_MIA_PATTERNS = [
  /\b(pro\s*-?\s*ana|pro\s*-?\s*mia|thinspo|bonespo|meanspo|prosp|ana\s+coach|mia\s+tips|ana\s+buddy)\b/gi,
  /\b(only\s+ate\s+\d+\s*(cal|kcal|calories)\s+today|made\s+it\s+to\s+\d+\s*(cal|kcal|calories)\s+today|skipped\s+(breakfast|lunch|dinner)\s+again)\b/gi,
  /\b(see\s+how\s+little\s+i\s+ate|lowest\s+weight\s+ever|finally\s+under\s+\d+\s*(lbs|pounds|kg))\b/gi,
];

const CUTTING_GLORIFICATION_PATTERNS = [
  /\b(fresh\s+cuts?|new\s+blade|new\s+scars?|felt\s+good\s+to\s+(bleed|cut)|love\s+the\s+(blade|cut|pain)|deeper\s+this\s+time)\b/gi,
  /\b(cutting\s+(again|tonight|today)|relapsed\s+(again|tonight)|first\s+cut\s+in\s+\d+\s+(days|weeks|months))\b/gi,
];

const ENCOURAGEMENT_COMPOUND_PATTERNS = unlessProhibited([
  /\b(do\s+it|just\s+do\s+it|nobody\s+(would\s+care|will\s+miss\s+you))\b[^.!?]{0,30}\b(end\s+it|kill\s+yourself|die)\b/gi,
  /\bend\s+it\s+already\b/gi,
]);

function selfHarmStructuralHits(_ctx: LinguisticContext): SignalHit[] {
  return [];
}

export const selfHarmClassifier: TechniqueClassifier = {
  classify(input: ClassifierInput): ClassifierOutput {
    const ctx = buildContext(input.text);
    const result = score(ctx, {
      technique: 'self-harm',
      signals: [
        patternSignal('kys-direct', 4, KYS_DIRECT_PATTERNS),
        patternSignal('go-die-ambiguous', 2, GO_DIE_AMBIGUOUS_PATTERNS),
        patternSignal('method-glorification', 4, METHOD_GLORIFICATION_PATTERNS),
        patternSignal('method-glorification-es-pt', 4, METHOD_GLORIFICATION_ES_PT_PATTERNS),
        patternSignal('pro-ana-mia', 3, PRO_ANA_MIA_PATTERNS),
        patternSignal('cutting-glorification', 3, CUTTING_GLORIFICATION_PATTERNS),
        patternSignal('encouragement-compound', 3, ENCOURAGEMENT_COMPOUND_PATTERNS),
        patternSignal('kys-obfuscated', 3, KYS_DIRECT_PATTERNS, { matchAggressive: true, maxHits: 1 }),
        patternSignal('method-obfuscated', 2, METHOD_GLORIFICATION_PATTERNS, { matchAggressive: true, maxHits: 1 }),
      ],
      structural: selfHarmStructuralHits,
      registerPolicy: {
        'news-report': 0.30,
        'clickbait': 1.00,
        'conversational': 1.00,
        'formal': 0.50,
      },
      // "I feel broken" is distress, not manipulation. Known gap: the detector reads "i'm / i feel /
      // i was" plus a feeling, and does not yet recognise "i want to die".
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
