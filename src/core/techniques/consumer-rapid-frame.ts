// Rushed shopping pressure aimed at young users: "buy now", "ends tonight", countdowns, "link in
// bio", "50% off if you act in the next minute". News about dark patterns and quoted marketing are
// dampened. Vocabulary drawn from Cialdini's scarcity principle ("Influence", 1984), the UK
// Competition and Markets Authority's "Online choice architecture", the FTC's "Bringing Dark
// Patterns to Light", and the dark-pattern recitals of the EU Digital Services Act.

import { ClassifierInput, ClassifierOutput, TechniqueClassifier } from './types';
import { buildContext, LinguisticContext } from './linguistic-features';
import { score, patternSignal, SignalHit } from './scoring';

const SCARCITY_NOW_PATTERNS = [
  /\b(buy\s+now|order\s+now|act\s+now|shop\s+now|grab\s+(this|yours)\s+now|today\s+only|ends?\s+tonight|expires?\s+(today|tonight|midnight)|last\s+(chance|day|hours?)|while\s+supplies\s+last)\b/gi,
  /\b(only\s+\d+\s+left|just\s+\d+\s+left\s+in\s+stock|hurry\s+(before|while))\b/gi,
  // Romanian
  /\b(cump[aă]r[aă]\s+acum|comand[aă]\s+acum|ofert[aă]\s+limitat[aă]|doar\s+ast[aă]zi|expir[aă]\s+(ast[aă]zi|disear[aă])|ultima\s+[sș]ans[aă]|ultima\s+zi)\b/gi,
  // Spanish
  /\b(compra\s+ya|compra\s+ahora|pide\s+ahora|ordena\s+ahora|solo\s+(?:por\s+)?hoy|termina\s+esta\s+noche|[uú]ltim[oa]s?\s+(?:d[ií]a|d[ií]as|horas|oportunidad)|hasta\s+agotar\s+existencias)\b/gi,
  /\b(?:solo\s+)?(?:quedan|queda)\s+\d+\s+(?:en\s+stock|disponibles|unidades)\b/gi,
  // Portuguese
  /\b(compre\s+j[aá]|compre\s+agora|pe[cç]a\s+agora|s[oó]\s+hoje|termina\s+hoje\s+[aà]\s+noite|[uú]ltim[oa]s?\s+(?:dia|dias|horas|chance)|at[eé]\s+durar\s+o\s+estoque)\b/gi,
  /\b(?:s[oó]\s+)?(?:restam|resta)\s+\d+\s+(?:em\s+estoque|dispon[ií]veis|unidades)\b/gi,
];

const COUNTDOWN_PURCHASE_PATTERNS = [
  /\b(in\s+(the\s+)?next\s+\d+\s*(seconds?|minutes?|hours?)|expires?\s+in\s+\d+|\d+\s*(seconds?|minutes?)\s+(left|remaining)\s+(to\s+(buy|order|act|grab|get|claim)|on\s+this\s+(deal|offer|price)))\b/gi,
  /\b(deal\s+ends\s+in\s+\d+|price\s+goes\s+up\s+in\s+\d+|sale\s+ends\s+in\s+\d+)\b/gi,
  // Romanian
  /\b([iî]n\s+urm[aă]toarele\s+\d+\s*(secunde|minute|ore)|expir[aă]\s+[iî]n\s+\d+|mai\s+sunt\s+\d+\s*(minute|ore))\b/gi,
];

const BURST_BUY_PATTERNS = [
  /\b(link\s+in\s+bio|swipe\s+up\s+to\s+(buy|shop|order)|tap\s+to\s+(shop|buy|order)|add\s+to\s+cart\s+now|click\s+the\s+link\s+(below|above|in\s+bio))\b/gi,
  /\b(use\s+(my\s+)?code\s+\w+|promo\s+code\s+\w+|coupon\s+\w+|discount\s+code\s+\w+)\b/gi,
  // Romanian
  /\b(link\s+[iî]n\s+bio|gliseaz[aă]\s+sus|apas[aă]\s+pentru\s+(comand[aă]|cump[aă]rare)|adaug[aă]\s+[iî]n\s+co[sș]\s+acum|folose[sș]te\s+codul|cod\s+promo|cupon)\b/gi,
  // Spanish and Portuguese
  /\b(link\s+en\s+(?:la\s+)?bio|desliza\s+(?:hacia\s+)?arriba|toca\s+para\s+comprar|a[nñ]ade\s+al\s+carrito\s+(?:ya|ahora)|usa\s+(?:mi\s+)?c[oó]digo\s+\w+|c[oó]digo\s+(?:promocional|de\s+descuento)\s+\w+)\b/gi,
  /\b(link\s+na\s+bio|arrasta\s+(?:pra|para)\s+cima|toque\s+para\s+comprar|adicione\s+ao\s+carrinho\s+agora|use\s+(?:o\s+)?(?:meu\s+)?c[oó]digo\s+\w+|cupom\s+\w+)\b/gi,
];

const DISCOUNT_FOMO_PATTERNS = [
  /\b\d+\s*%\s+off\s+(if\s+you|in\s+the\s+next|today|tonight|right\s+now|when\s+you\s+order)\b/gi,
  /\b(half\s+price\s+(today|tonight|now)|free\s+shipping\s+(today|tonight|right\s+now)|extra\s+\d+\s*%\s+off\s+if\s+you\s+(act|order|buy))\b/gi,
  // Romanian
  /\b(\d+\s*%\s+reducere\s+(ast[aă]zi|disear[aă]|acum|dac[aă])|transport\s+gratuit\s+(ast[aă]zi|disear[aă]))\b/gi,
];

// Promos with no urgency words, such as game skin ads ("grab discounts and free cases to build up
// your inventory", seen on a live feed). Each needs a shop or loot noun, so "grab a coffee" and
// "free time tomorrow" score nothing.
const SOFT_SOLICITATION_PATTERNS = [
  /\bfree\s+(cases?|skins?|coins?|gems?|spins?|crates?|loot|rewards?|bonus(?:es)?)\b/gi,
  /\bbuild\s+up\s+your\s+(inventory|collection|loadout|stash)\b/gi,
  /\b(grab|get|claim|score|snag)\s+(your\s+)?(discounts?|deals?|coupons?|free\s+(?:cases?|skins?|coins?|gems?|spins?|crates?|loot|rewards?))\b/gi,
];

function consumerStructuralHits(ctx: LinguisticContext): SignalHit[] {
  const hits: SignalHit[] = [];
  const f = ctx.features;
  if (f.imperativeHintCount >= 2 && f.countdownTokenCount >= 1) {
    hits.push({
      signalId: 'imperative-countdown',
      weight: 1.0,
      evidence: 'imperative + countdown',
      reason: 'structural: imperative-stack + time pressure',
    });
  }
  if (f.urlCount >= 1 && f.percentageMentionCount >= 1) {
    hits.push({
      signalId: 'url-percent',
      weight: 0.7,
      evidence: 'link + % discount',
      reason: 'structural: affiliate URL with discount',
    });
  }
  return hits;
}

export const consumerRapidFrameClassifier: TechniqueClassifier = {
  classify(input: ClassifierInput): ClassifierOutput {
    const ctx = buildContext(input.text);
    const result = score(ctx, {
      technique: 'consumer-rapid-frame',
      signals: [
        patternSignal('scarcity-now', 3, SCARCITY_NOW_PATTERNS),
        patternSignal('countdown-purchase', 3, COUNTDOWN_PURCHASE_PATTERNS),
        patternSignal('burst-buy', 2, BURST_BUY_PATTERNS),
        patternSignal('discount-fomo', 2, DISCOUNT_FOMO_PATTERNS),
        patternSignal('soft-solicitation', 3, SOFT_SOLICITATION_PATTERNS),
        patternSignal('scarcity-obfuscated', 2, SCARCITY_NOW_PATTERNS, { matchAggressive: true, maxHits: 1 }),
        patternSignal('countdown-obfuscated', 2, COUNTDOWN_PURCHASE_PATTERNS, { matchAggressive: true, maxHits: 1 }),
      ],
      structural: consumerStructuralHits,
      registerPolicy: {
        'news-report': 0.30,
        'promotional': 1.30,
        'clickbait': 1.20,
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
