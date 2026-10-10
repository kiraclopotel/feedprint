// Risky health behaviour a viewer could copy, framed as a reward: "overdosed on zinc and got
// superpowers", "try taking huge amounts of X". Warnings, prescribed use, accidents and news
// about the risk are not flagged.

import { ClassifierInput, ClassifierOutput, TechniqueClassifier } from './types';
import { buildContext, LinguisticContext } from './linguistic-features';
import { score, patternSignal, SignalHit } from './scoring';

const OVERDOSE_GLAMORIZATION_PATTERNS = [
  /\b(overdos\w*\s+on\s+\w+\s+and\s+(got|unlocked|gained|discovered|found|activated))\b/gi,
  /\b(overdos\w*\s+on\s+(zinc|vitamin\w*|iron|magnesium|melatonin|caffeine|creatine|biotin|b12|turmeric|collagen)\b)/gi,
  /\b(megados\w*\s+(of|on|with)\s+\w+)/gi,
  // Romanian
  /\b(supradoz[aă]\w*\s+de\s+\w+\s+[șş]i\s+(am\s+)?(primit|c[aă]p[aă]tat|sim[tț]it|dob[âa]ndit|deblocat|activat))\b/gi,
  /\b(m-?am\s+supradozat\s+(cu|de)\s+\w+\s+[șş]i)\b/gi,
  /\b(supradoz[aă]\w*\s+de\s+(zinc|vitamin[ae]\w*|fier|magneziu|melatonin[aă]?|cofein[aă]|creatin[aă]|biotin[aă]?|b12|turmeric|colagen))\b/gi,
  /\b(megadoz[aă]\w*\s+(de|cu)\s+\w+)/gi,
  // Spanish and Portuguese. The reward is required, as above: without it "Dalida morreu de uma
  // sobredose de sonificos", a news report in the benign corpus, reads as glamorization.
  /\b(?:sobredosis|megadosis)\s+de\s+\w+\s+(?:y\s+)?(?:me\s+)?(?:desbloqu|activ|gan|consegu|sent|descubr)\w*\b/gi,
  /\bme\s+(?:tom[eé]|met[ií])\s+(?:una\s+)?(?:sobredosis|megadosis)\s+de\s+\w+\s+y\b/gi,
  /\b(?:overdose|superdose|megadose)\s+de\s+\w+\s+e\s+(?:me\s+)?(?:desbloque|ativ|ganh|consegu|senti|descobr)\w*\b/gi,
  /\btomei\s+(?:uma\s+)?(?:overdose|superdose|megadose)\s+de\s+\w+\s+e\b/gi,
];

const BENEFIT_REWARD_FRAMING_PATTERNS = [
  /\b(unlock\w*\s+a?\s*(super\s*power|ability|sense|skill|hack))\b/gi,
  /\b(super\s*power|super\s*human|heightened\s+sense|secret\s+(power|ability|hack))\b/gi,
  /\b(life\s*hack|body\s*hack|health\s*hack|bio\s*hack)\s*.{0,30}(overdos|megados|huge\s+amount|massive\s+dose)/gi,
  /\b(huge|massive|insane|crazy)\s+(amount|dose|quantity)s?\s+(of|for)\s+(power|focus|beauty|energy|gains|glow)/gi,
  /\bfor\s+(insane|crazy|superhuman|incredible|amazing)\s+(focus|energy|power|beauty|gains|glow|strength|sleep)/gi,
  // Romanian
  /\b(superputeri|super\s*puteri|suprauman[aă]?|putere\s+secret[aă])\b/gi,
  /\b(deblocat|activat|c[aă]p[aă]tat)\s+.{0,20}(superputeri|puteri|abilit[aă][tț]i|energie)\b/gi,
  /\b([îi][tț]i\s+d[aă]\s+(puteri|energie|focus|superputeri))\b/gi,
  /\b(ca\s+s[aă]\s+ai\s+(energie|puteri|focus|superputeri|for[tț][aă]))\b/gi,
  /\b(pentru\s+(energie|puteri|focus|superputeri|for[tț][aă])\s+(incredibil[aă]|nebun[aă]|suprauman[aă]|maxim[aă]))\b/gi,
];

const CHALLENGE_EXPERIMENTATION_PATTERNS = [
  /\b(try\s+(taking|eating|drinking|consuming)\s+(huge|massive|insane|crazy)\s+(amount|dose|quantity)s?)\b/gi,
  /\b(try\s+(taking|eating|drinking|consuming)\s+(huge|massive|insane|crazy)\s+amounts?\s+of)\b/gi,
  /\b(i\s+(took|ate|consumed|drank)\s+(\d+\s*x|\d+\s*times?)\s+(the\s+)?(recommended|normal|daily)\s+(dose|amount))\b/gi,
  /\b(what\s+happens\s+(if|when)\s+(you|i)\s+(take|eat|drink|consume)\s+(too\s+much|way\s+too|a\s+ton|massive|\d+))\b/gi,
  /\b(supplement\s+challenge|vitamin\s+challenge|megadose\s+challenge)\b/gi,
  // Romanian
  /\b(ia\s+(mult|foarte\s+mult|doze\s+mari\s+de)\s+\w+\s+(ca\s+s[aă]|pentru))\b/gi,
  /\b(supradoz[aă]\s+de\s+\w+\s+ca\s+experiment)\b/gi,
  /\b(provoc(are|area)\s+(cu\s+)?(suplimente|vitamine|megadoz[aă]))\b/gi,
];

const SUPPRESSION_WARNING_PATTERNS = [
  /\b(do\s+not|don'?t|never|warning|danger\w*|risk\w*|harmful|toxic\w*|poison\w*|overdose\s+is|can\s+(kill|harm|damage|hurt))\b/gi,
  /\b(as\s+directed|prescribed|recommended\s+dose|daily\s+allowance|rda|consult\s+(a\s+)?(doctor|physician|healthcare))\b/gi,
  /\b(accidentally|by\s+accident|got\s+sick|went\s+to\s+(the\s+)?(hospital|er|emergency))\b/gi,
  // Romanian
  /\b(nu\s+f(a|ă)\s+supradoz[aă]|supradoza\s+.{0,10}(periculoas[aă]|toxic[aă]|d[aă]un[aă]toare))\b/gi,
  /\b(prescris\s+de\s+medic|doza\s+recomandat[aă]|conform\s+prospectului|efecte\s+adverse)\b/gi,
  /\b(nu\s+lu(a|ați)\s+(prea\s+mult|supradoz)|aten[tț]ie\s+la\s+doz[aă])\b/gi,
  // Spanish and Portuguese, generous on purpose: this list is how a warning stops the classifier,
  // so a gap here is a false alarm.
  /\b(no\s+(?:tomes|tome|hagas)|nunca|advertencia|peligro\w*|riesgo\w*|t[oó]xic\w*|venenos\w*|puede\s+(?:matar|da[nñ]ar|hacerte\s+da[nñ]o))\b/gi,
  /\b(dosis\s+(?:recomendada|diaria)|seg[uú]n\s+(?:el\s+)?prospecto|consulta\s+(?:a\s+)?(?:tu\s+)?m[eé]dico|efectos\s+(?:adversos|secundarios)|receta\s+m[eé]dica)\b/gi,
  /\b(sin\s+querer|por\s+accidente|me\s+puse\s+mal|termin[eé]\s+en\s+(?:el\s+)?(?:hospital|urgencias))\b/gi,
  /\b(n[aã]o\s+(?:tome|fa[cç]a)|nunca|advert[eê]ncia|perigo\w*|risco\w*|t[oó]xic\w*|venenos\w*|pode\s+(?:matar|causar\s+dano|te\s+machucar))\b/gi,
  /\b(dose\s+(?:recomendada|di[aá]ria)|conforme\s+a\s+bula|consulte\s+(?:o\s+)?(?:seu\s+)?m[eé]dico|efeitos\s+(?:adversos|colaterais)|receita\s+m[eé]dica)\b/gi,
  /\b(sem\s+querer|por\s+acidente|passei\s+mal|fui\s+parar\s+(?:no\s+)?(?:hospital|pronto-socorro))\b/gi,
];

function healthExperimentStructuralHits(_ctx: LinguisticContext): SignalHit[] {
  return [];
}

export const unsafeHealthExperimentClassifier: TechniqueClassifier = {
  classify(input: ClassifierInput): ClassifierOutput {
    const ctx = buildContext(input.text);

    const suppressionMatches = SUPPRESSION_WARNING_PATTERNS.reduce(
      (count, pat) => count + (input.text.match(pat)?.length ?? 0), 0,
    );
    const isSuppressed = suppressionMatches >= 2;

    const result = score(ctx, {
      technique: 'unsafe-health-experiment',
      signals: [
        patternSignal('overdose-glamorization', 3, OVERDOSE_GLAMORIZATION_PATTERNS),
        patternSignal('benefit-reward-framing', 3, BENEFIT_REWARD_FRAMING_PATTERNS),
        patternSignal('challenge-experimentation', 2, CHALLENGE_EXPERIMENTATION_PATTERNS),
      ],
      structural: healthExperimentStructuralHits,
      registerPolicy: {
        'news-report': 0.20,
        'clickbait': 1.20,
        'promotional': 1.20,
        'conversational': 1.00,
        'formal': 0.30,
      },
      dampenOnFirstPersonVulnerability: false,
      quoteDampener: 0.30,
      presentThreshold: 3,
    });

    if (isSuppressed && result.severity < 7) {
      return {
        technique: 'unsafe-health-experiment',
        present: false,
        confidence: result.confidence,
        severity: Math.max(result.severity - 2, 1),
        evidence: result.evidence,
      };
    }

    return {
      technique: result.technique,
      present: result.present,
      confidence: result.confidence,
      severity: result.severity,
      evidence: result.evidence,
    };
  },
};
