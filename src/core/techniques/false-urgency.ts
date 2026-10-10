// Artificial deadlines, pressure and scarcity.

import { ClassifierInput, ClassifierOutput, TechniqueClassifier } from './types';
import { PatternSet, runPatternClassifier } from './classify-helpers';

const PATTERNS: PatternSet = {
  strong: [
    /\b(LAST CHANCE|NOW OR NEVER|LIMITED TIME|ACT NOW|HURRY)\b/,
    /\bMUST[- ]?(WATCH|SEE|READ|SHARE|KNOW)\b/,
    /only \d+ (left|remaining|spots|seats|available)/i,
    /\b(expires?|ending) (today|tonight|midnight|in \d+)/i,
    // Needs its object. The bare "don't think" ("I don't think so") fired on 0.65% of 2,035,404
    // benign English sentences from Tatoeba, more than every other classifier's false positives
    // combined. "Don't hesitate to ask" is politeness, not pressure.
    /don'?t (?:wait\b|delay\b|think (?:twice|about it)\b|hesitate\b(?!\s+to\s+(?:ask|contact|reach|call|e-?mail|get\s+in\s+touch)))/i,
    /\bshare this NOW\b/i,
    /(in|for) the next \d+ (minutes?|hours?|days?)/i,
    /\bclock is ticking\b/i,
    /\bbefore it'?s too late\b/i,
    /\bWATCH\b.{0,30}\bNOW\b/,
    /»\s*WATCH\b/i,
    // Romanian
    /\b(ULTIMA [SȘ]ANS[AĂ]|URGENT|GR[AĂ]BI[TȚ]I-V[AĂ]|AC[TȚ]IONA[TȚ]I ACUM)\b/,
    /\btrebuie s[aă] (vezi|[sș]tii|cite[sș]ti|distribui|afli)\b/i,
    // Romanian gambling ads
    /\b(bonus gratis|rotiri gratuite|f[aă]r[aă] depunere|casino online|joac[aă] acum|pune pauz[aă] la scroll)\b/i,
    // Spanish. Sales urgency is formulaic enough to survive translation. Precision was measured on
    // the benign corpora; recall was not.
    /\b(ULTIMA OPORTUNIDAD|AHORA O NUNCA|TIEMPO LIMITADO|ACTUA YA|DATE PRISA|URGENTE)\b/,
    /\b(?:solo\s+)?quedan\s+\d+\s+(?:unidades|plazas|lugares|cupos|entradas|d[ií]as)\b/i,
    // Needs a sales word: "el mes de enero termina hoy" is a calendar fact, and it fired on the
    // benign corpus.
    /\b(?:la\s+)?(?:oferta|promoci[oó]n|venta|rebaja|descuento|inscripci[oó]n|preventa)\s+(?:termina|caduca|vence|expira)\s+(?:hoy|esta\s+noche|ma[nñ]ana|a\s+medianoche|en\s+\d+)\b/i,
    // Not 'no lo dudes': it means "no doubt about it", reassurance rather than pressure.
    /\bno\s+(?:esperes\s+m[aá]s|lo\s+pienses\s+(?:m[aá]s|dos\s+veces)|tardes\s+m[aá]s)\b/i,
    /\bantes\s+de\s+que\s+(?:sea\s+demasiado\s+tarde|se\s+acabe|lo\s+borren)\b/i,
    /\btienes\s+que\s+(?:ver|saber|leer|compartir)\s+esto\b/i,
    // Portuguese
    /\b(ULTIMA CHANCE|AGORA OU NUNCA|TEMPO LIMITADO|AJA AGORA|CORRA|URGENTE)\b/,
    /\b(?:s[oó]\s+)?(?:restam|sobraram)\s+\d+\s+(?:unidades|vagas|lugares|ingressos|dias)\b/i,
    /\b(?:a\s+)?(?:oferta|promo[cç][aã]o|venda|liquida[cç][aã]o|desconto|inscri[cç][aã]o|pr[eé]-venda)\s+(?:termina|acaba|expira|vence)\s+(?:hoje|hoje\s+[aà]\s+noite|amanh[aã]|[aà]\s+meia-noite|em\s+\d+)\b/i,
    /\bn[aã]o\s+(?:espere\s+mais|pense\s+duas\s+vezes|demore\s+mais)\b/i,
    /\bantes\s+que\s+(?:seja\s+tarde\s+demais|acabe|tirem\s+do\s+ar)\b/i,
    /\bvoc[eê]\s+precisa\s+(?:ver|saber|ler|compartilhar)\s+isso\b/i,
  ],
  moderate: [
    /\b(urgent|immediately|right now)\b/i,
    // "A beach body by summer". Real scheduling ("deadline", "due date") is in the exceptions.
    /\b(have|need|must|got to|gotta|better)\b.{0,30}\bby (summer|winter|spring|fall|next (week|month|year)|tomorrow|tonight|the end of)\b/i,
    /\b(imediat|acum|repede|f[aă]r[aă] [îi]nt[âa]rziere|nu a[sș]tepta)\b/i, // Romanian
    /\b(going viral|spreading fast|blowing up|before (this|it) gets? taken down)\b/i,
    // Spanish and Portuguese. Not 'ahora' or 'agora': they are ordinary adverbs, where "right now"
    // is a phrase.
    /\b(inmediatamente|de\s+inmediato|cuanto\s+antes|sin\s+demora|no\s+esperes\s+m[aá]s)\b/i,
    /\b(imediatamente|o\s+quanto\s+antes|sem\s+demora|n[aã]o\s+espere\s+mais)\b/i,
    /\b(se\s+est[aá]\s+volviendo\s+viral|se\s+viraliza|antes\s+de\s+que\s+lo\s+(?:borren|quiten|bajen))\b/i,
    /\b(est[aá]\s+viralizando|viralizou|antes\s+que\s+tirem\s+do\s+ar|antes\s+que\s+apaguem)\b/i,
  ],
  exceptions: [
    /\b(deadline|due date|submission|filing|registration closes)\b/i,
  ],
};

export const falseUrgencyClassifier: TechniqueClassifier = {
  classify(input: ClassifierInput): ClassifierOutput {
    return runPatternClassifier(input.text, 'false-urgency', PATTERNS);
  },
};
