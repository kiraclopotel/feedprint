// Catastrophizing, "they don't want you to know", countdowns to disaster, and "your family will
// suffer". News reports, quoted speech and a person's own fears ("i'm scared of heights") are
// dampened.

import { ClassifierInput, ClassifierOutput, TechniqueClassifier } from './types';
import { buildContext, LinguisticContext } from './linguistic-features';
import { score, patternSignal, booleanSignal, SignalHit } from './scoring';

const CATASTROPHE_PATTERNS = [
  /\b(catastroph\w*|doomsday|apocalyp\w*|armageddon|extinction|total collapse|end of (the world|times|civilization)|end[- ]times)\b/gi,
  // Romanian
  /\b(catastrof\w+|dezastru\w*|apocalips\w+|pr[aă]bu[sș]ire|sf[âa]r[sș]it\w*|cataclism)\b/gi,
  // Spanish and Portuguese. Not 'desastre', which is casual there ("foi um desastre"); the
  // Romanian stems above already match catastrofe and cataclismo. Not 'fin del mundo' or 'fim do
  // mundo', which also mean the middle of nowhere: they were the largest single source of false
  // positives in the Portuguese corpus.
  /\b(apocalipsis|colapso total|extinci[oó]n (?:humana|masiva|total))\b/gi,
  /\b(apocalipse|colapso total|extin[cç][aã]o (?:humana|em massa|total))\b/gi,
];

const HIDDEN_THREAT_PATTERNS = [
  /\b(they|doctors?|experts?|the (media|government|establishment)|big ?(pharma|tech)) (are |is )?(hiding|don'?t want|won'?t tell|suppressing|censoring)\b/gi,
  /\b(what .{0,30} (doesn'?t|don'?t|won'?t) want you to (see|know|hear|find out|discover))\b/gi,
  /\b(they don'?t want you to (see|know|find out|watch|read))\b/gi,
  /\b(the truth (about|they'?re hiding))\b/gi,
  /\b(banned|censored|silenced|suppressed|forbidden) (video|truth|information|post|footage|knowledge|content)\b/gi,
  /\b(before (they|it|this) (delete|deletes|remove|removes|take\s?down|censor|censors))\b/gi,
  // Romanian
  /\bnu vor\b[^.!?]{0,25}\b(s[aă] [sș]ti[ie]|s[aă] vez|s[aă] afli|s[aă] descoperi|s[aă] vad[aă])\b/gi,
  /\b(adev[aă]rul despre|ce (nu|ascund|se ascunde))\b/gi,
  /\b(cenzurat[iăaț]*|interzis[iăaț]*|[sș]ters[iăaț]*) (video|filmare|adev[aă]r|informa[tț]ie)\b/gi,
  // Spanish
  /\b(?:ellos|los m[eé]dicos|los expertos|la prensa|el gobierno|las farmac[eé]uticas)\s+(?:no quieren que|te ocultan|no te (?:dicen|cuentan)|est[aá]n ocultando|censuran)\b/gi,
  /\bno quieren que (?:lo )?(?:sepas|veas|te enteres|descubras)\b/gi,
  // Not a bare "la verdad sobre": "necesito saber la verdad sobre Tom" is ordinary.
  /\b(?:la verdad que (?:te )?(?:ocultan|esconden|no quieren)|lo que no te (?:dicen|cuentan)|lo que (?:ocultan|esconden))\b/gi,
  /\b(?:video|informaci[oó]n|verdad|documento)\s+(?:censurad[oa]|prohibid[oa]|eliminad[oa]|silenciad[oa])\b/gi,
  /\bantes de que (?:lo|la|esto)\s+(?:borren|eliminen|censuren|quiten|bajen)\b/gi,
  // Portuguese
  /\b(?:eles|os m[eé]dicos|os especialistas|a imprensa|o governo|as farmac[eê]uticas)\s+(?:n[aã]o querem que|escondem de voc[eê]|n[aã]o (?:dizem|contam)|est[aã]o escondendo|censuram)\b/gi,
  /\bn[aã]o querem que voc[eê]\s+(?:saiba|veja|descubra)\b/gi,
  /\b(?:a verdade que (?:te )?(?:escondem|ocultam|n[aã]o querem)|o que n[aã]o (?:te )?(?:dizem|contam)|o que (?:escondem|ocultam))\b/gi,
  /\b(?:v[ií]deo|informa[cç][aã]o|verdade|documento)\s+(?:censurad[oa]|proibid[oa]|deletad[oa]|silenciad[oa])\b/gi,
  /\bantes que (?:apaguem|deletem|censurem|tirem do ar)\b/gi,
];

const DIRECT_THREAT_PATTERNS = [
  /\b(terrif\w+|horrif\w+|nightmare|devastating|deadly|lethal|fatal)\b[^.!?]{0,60}\b(you|your|children|family|kids|loved ones|baby|son|daughter)\b/gi,
  /\b(you|your|children|family)[^.!?]{0,30}\b(will|'?ll|are going to|gonna)\b[^.!?]{0,30}\b(suffer|regret|die|lose|pay|be destroyed|face|end up)\b/gi,
  // Romanian
  /\b(terifiant|[iî]ngrozitor|co[sș]mar|devastator|mortal|letal)\w*\b[^.!?]{0,60}\b(tu|tine|t[aă]u|ta|copii|familia|copil|fiu|fiic[aă])\w*\b/gi,
  // Spanish and Portuguese usually drop the subject, so the target is a possessive or a family noun.
  /\b(aterrador|espantoso|pesadilla|devastador|mortal|letal|escalofriante)\w*\b[^.!?]{0,60}\b(tu|tus|ti|tuyo|hijos?|hijas?|familia|beb[eé]|ni[nñ]os?)\b/gi,
  /\b(aterrorizante|assustador|pesadelo|devastador|mortal|letal|arrepiante)\w*\b[^.!?]{0,60}\b(seu|sua|seus|suas|voc[eê]|filh[oa]s?|fam[ií]lia|beb[eê]|crian[cç]as?)\b/gi,
  /\b(?:tu|tus|su|sus)\s+(?:hijos?|hijas?|familia|ni[nñ]os?)\b[^.!?]{0,30}\b(?:van? a|ir[aá]n? a)\s+(?:sufrir|morir|perder|pagar|arrepentirse)\b/gi,
  /\b(?:seu|sua|seus|suas)\s+(?:filh[oa]s?|fam[ií]lia|crian[cç]as?)\b[^.!?]{0,30}\b(?:vai|v[aã]o)\s+(?:sofrer|morrer|perder|pagar|se arrepender)\b/gi,
];

const IRRECOVERABLE_PATTERNS = [
  /\bif you don'?t\b[^.!?]{0,40}\b(it'?ll be too late|you'?ll regret|you will regret|you lose everything|there'?s no going back|no second chance)\b/gi,
  // Romanian
  /\bdac[aă] nu\b[^.!?]{0,40}\b(o s[aă]? fie prea t[aâ]rziu|vei regreta|pierzi tot|nu mai (po[tț]i|e)|nu mai e cale)\b/gi,
  // Spanish and Portuguese
  /\bsi no\b[^.!?]{0,40}\b(?:ser[aá] demasiado tarde|te vas a arrepentir|te arrepentir[aá]s|lo pierdes todo|no hay vuelta atr[aá]s|no habr[aá] otra oportunidad)\b/gi,
  /\bse (?:voc[eê] )?n[aã]o\b[^.!?]{0,40}\b(?:vai ser tarde demais|vai se arrepender|perde tudo|n[aã]o tem volta|n[aã]o vai ter outra chance)\b/gi,
];

const COUNTDOWN_FEAR_PATTERNS = [
  /\b(only |just |we )?(have|got)?\s?(less than )?\d+\s*(years?|months?|weeks?|days?|hours?|minutes?)\s*(left|before|until|remaining|to (save|act|survive|prepare))\b/gi,
  // Romanian
  /\b(doar|mai|avem)?\s?\d+\s*(ani|luni|zile|ore|minute|s[aă]pt[aă]m[aâ]ni)\s*(r[aă]mas\w*|p[aâ]n[aă]|mai|s[aă])\b/gi,
];

const MODERATE_FEAR_PATTERNS = [
  /\b(danger|dangerous|threat|crisis|emergency|alarming|warn|warning|alert|beware)\b/gi,
  /\b(share (this )?before|spread (this )?before)\b/gi,
  // Romanian
  /\b(pericol\w*|amenin[tț]are|criz[aă]|alarm[aă]|aten[tț]ie)\b/gi,
  /\b(distribuie (asta |acest mesaj )?(p[aâ]n[aă]|[iî]nainte))\b/gi,
  // Spanish and Portuguese. Not 'cuidado' or 'atención': everyday words there, unlike 'beware'.
  /\b(peligro\w*|amenaza\w*|crisis|emergencia|alarmante|advertencia|alerta)\b/gi,
  /\b(perigo\w*|amea[cç]a\w*|crise|emerg[eê]ncia|alarmante|advert[eê]ncia|alerta)\b/gi,
  /\b(?:comparte|comparta|compartilhe|compartilha)\s+(?:esto\s+|isso\s+)?antes\s+(?:de\s+que|que)\b/gi,
];

/**
 * Shouting, "!!!" runs and "they" against "you" push a borderline keyword hit over the line. The
 * weights stay low so that shouting alone ("CONGRATULATIONS!!!") cannot: the keyword hits are not
 * known yet when these are computed.
 */
function fearStructuralHits(ctx: LinguisticContext): SignalHit[] {
  const hits: SignalHit[] = [];
  const f = ctx.features;

  if (f.wordCount >= 10 && f.capsRatio > 0.4) {
    hits.push({
      signalId: 'caps-scream',
      weight: 1.5,
      evidence: `${Math.round(f.capsRatio * 100)}% caps`,
      reason: 'structural: high uppercase ratio',
    });
  } else if (f.allCapsWordCount >= 3) {
    hits.push({
      signalId: 'caps-clusters',
      weight: 1.0,
      evidence: `${f.allCapsWordCount} ALL-CAPS words`,
      reason: 'structural: multiple all-caps tokens',
    });
  }

  if (f.punctuationRunCount >= 2) {
    hits.push({
      signalId: 'punct-runs',
      weight: 0.8,
      evidence: `${f.punctuationRunCount} !!/?? runs`,
      reason: 'structural: repeated punctuation',
    });
  }

  // "THEY are coming for YOU"
  if (f.thirdPersonPluralCount >= 1 && f.secondPersonCount >= 2) {
    hits.push({
      signalId: 'they-vs-you',
      weight: 1.0,
      evidence: 'they-vs-you framing',
      reason: 'structural: third-person threat + second-person targeting',
    });
  }

  // Looser than the countdown patterns, so it adds only a little.
  if (f.countdownTokenCount >= 1) {
    hits.push({
      signalId: 'countdown-struct',
      weight: 0.5,
      evidence: `${f.countdownTokenCount} countdown token(s)`,
      reason: 'structural: time-pressure phrase',
    });
  }

  return hits;
}

export const fearAppealClassifier: TechniqueClassifier = {
  classify(input: ClassifierInput): ClassifierOutput {
    const ctx = buildContext(input.text);

    const result = score(ctx, {
      technique: 'fear-appeal',
      signals: [
        patternSignal('catastrophe', 3, CATASTROPHE_PATTERNS),
        patternSignal('hidden-threat', 3, HIDDEN_THREAT_PATTERNS),
        patternSignal('direct-threat', 3, DIRECT_THREAT_PATTERNS),
        patternSignal('irrecoverable', 3, IRRECOVERABLE_PATTERNS),
        patternSignal('countdown-fear', 2, COUNTDOWN_FEAR_PATTERNS),
        patternSignal('moderate-fear', 1, MODERATE_FEAR_PATTERNS),
        // Camouflaged spellings ("c@t@stroph3"). One lower than the plain pattern, since decoding
        // leetspeak adds false alarms, and below the threshold of 3: one camouflaged match adds to
        // other evidence but cannot flag a post alone.
        patternSignal('catastrophe-obfuscated', 2, CATASTROPHE_PATTERNS, { matchAggressive: true, maxHits: 1 }),
        patternSignal('hidden-threat-obfuscated', 2, HIDDEN_THREAT_PATTERNS, { matchAggressive: true, maxHits: 1 }),
        patternSignal('direct-threat-obfuscated', 2, DIRECT_THREAT_PATTERNS, { matchAggressive: true, maxHits: 1 }),
        // The register dampens news already; this makes the reason show in the explanation.
        booleanSignal('news-attribution-suppressor', -2, (c) => c.hasNewsAttribution, () => 'news attribution present'),
      ],
      structural: fearStructuralHits,
      registerPolicy: {
        // News usually reports fear rather than creating it; clickbait often is the fear appeal.
        'news-report': 0.35,
        'clickbait': 1.25,
        'formal': 0.65,
      },
      dampenOnFirstPersonVulnerability: true,
      quoteDampener: 0.25,
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
