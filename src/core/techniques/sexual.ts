// Grooming: secrecy ("our little secret"), asking a child for pictures or their age, "so mature
// for your age", and cutting a child off from parents. Known gaps: grooming happens across a
// conversation, and one post rarely holds all of it, so these catch only the plainest phrasing.
// Talk about puberty is easy to misread, so the patterns are narrow and the bar to fire is 4,
// not 3: a miss is preferred to a false alarm here. Explicit vocabulary is kept out of the source
// on purpose. Grounded in the Stanford Internet Observatory's "Cross-Platform Dynamics of
// Self-Generated CSAM" (2023), NCMEC's CyberTipline reports, the NSPCC's study of groomers'
// messages (2018), and the OpenAI moderation categories.
import { ClassifierInput, ClassifierOutput, TechniqueClassifier } from './types';
import { buildContext, LinguisticContext } from './linguistic-features';
import { score, patternSignal, SignalHit } from './scoring';
const GROOMING_SECRECY_PATTERNS = [
  /\b(our\s+little\s+secret|just\s+between\s+us|don'?t\s+tell\s+(your\s+)?(mom|dad|mum|mother|father|parents|teacher|sister|brother)|keep\s+this\s+(between\s+us|secret))\b/gi,
  /\b(if\s+you\s+tell\s+anyone|nobody\s+(needs\s+to|has\s+to|should)\s+know|delete\s+(this|these)\s+(messages|texts|chats)\s+(after|when))\b/gi,
  // Romanian
  /\b(secretul\s+nostru|doar\s+[iî]ntre\s+noi|nu\s+spune\s+(mamei|tatei|p[aă]rin[tț]ilor|profesoarei|profesorului)|p[aă]streaz[aă]\s+secret\w*)\b/gi,
  // Spanish. Not a bare "no le digas a nadie" (don't tell anyone), which English leaves out too:
  // it fired at severity 6 on a benign-corpus sentence that could as well be a surprise party.
  // Naming the adult not to tell is what makes it grooming.
  /\b(nuestro\s+secretito|nuestro\s+peque[nñ]o\s+secreto|(?:esto\s+)?queda\s+entre\s+(?:los\s+)?(?:t[uú]\s+y\s+yo|nosotros)|no\s+le\s+digas\s+a\s+(?:tu\s+)?(?:mam[aá]|pap[aá]|tus\s+padres|tu\s+profe(?:sora?)?)|borra\s+(?:estos\s+)?mensajes)\b/gi,
  // Portuguese
  /\b(nosso\s+segredinho|nosso\s+pequeno\s+segredo|(?:isso\s+)?fica\s+(?:s[oó]\s+)?entre\s+(?:n[oó]s|eu\s+e\s+voc[eê])|n[aã]o\s+conta\s+(?:pra|para)\s+(?:sua\s+)?(?:m[aã]e|pai|seus\s+pais|professora)|apaga\s+(?:essas\s+)?mensagens)\b/gi,
];
const DM_PROBE_PATTERNS = [
  /\b(send\s+me\s+(a\s+)?(pic|picture|photo|video|selfie|snap)\s+of\s+(you|yourself|your\s+(body|self)))\b/gi,
  /\b(what\s+are\s+you\s+wearing\s+(now|right\s+now|tonight|today))\b/gi,
  /\b(show\s+me\s+(your|what)\s+(body|chest|legs|underwear))\b/gi,
  /\b(do\s+you\s+have\s+(snap|snapchat|kik|telegram|discord)\s*\??\s*(let'?s|let\s+us|wanna|want\s+to)\s+(chat|talk|message|move))\b/gi,
  // Romanian
  /\b(trimite-mi\s+o\s+(poz[aă]|fotografie|imagine|videoclip|selfie)\s+cu\s+(tine|corpul\s+t[aă]u))\b/gi,
  /\b(ce\s+por[tț]i\s+(acum|disear[aă]|ast[aă]zi))\b/gi,
  // Spanish
  /\b(m[aá]ndame\s+(?:una\s+)?(?:foto|fotico|selfie|video|v[ií]deo)\s+(?:tuya|tuyo|de\s+ti|de\s+tu\s+cuerpo)|qu[eé]\s+tienes\s+puesto\s+(?:ahora|hoy|esta\s+noche)|mu[eé]strame\s+(?:tu\s+)?(?:cuerpo|pecho|piernas|ropa\s+interior))\b/gi,
  // Portuguese
  /\b(me\s+manda\s+(?:uma\s+)?(?:foto|selfie|video|v[ií]deo)\s+(?:sua|de\s+voc[eê]|do\s+seu\s+corpo)|o\s+que\s+voc[eê]\s+est[aá]\s+vestindo\s+(?:agora|hoje|hoje\s+[aà]\s+noite)|me\s+mostra\s+(?:seu\s+)?(?:corpo|peito|pernas|roupa\s+[ií]ntima))\b/gi,
];
const AGE_PROBE_PATTERNS = [
  /\b(asl\s*\??|a\/s\/l\s*\??|age\s+sex\s+location\s*\??|how\s+old\s+(are\s+you|r\s+u)\s*\??)\b/gi,
  /\b(i'?m\s+\d{1,2}\s+are\s+you\s+\d{1,2}|i'?m\s+\d{1,2}\s+how\s+old\s+are\s+you)\b/gi,
  // Romanian
  /\b(c[aâ][tț]i\s+ani\s+ai|ce\s+v[aâ]rst[aă]\s+ai|ai\s+\d{1,2}\s+ani\s+\??)\b/gi,
  // Spanish and Portuguese. Ordinary between peers, but listed at the same weight as 'asl'.
  /\b(cu[aá]ntos\s+a[nñ]os\s+tienes|qu[eé]\s+edad\s+tienes|tengo\s+\d{1,2}\s+(?:y\s+t[uú]|tu)\s*\??)\b/gi,
  /\b(quantos\s+anos\s+voc[eê]\s+tem|qual\s+(?:a\s+)?sua\s+idade|tenho\s+\d{1,2}\s+e\s+voc[eê]\s*\??)\b/gi,
];
const MATURITY_GROOM_PATTERNS = [
  /\byou'?re\s+(so|very|really|too)\s+(mature|grown\s*up|smart|wise)\s+for\s+your\s+age\b/gi,
  /\byou\s+don'?t\s+(act|seem|look|talk)\s+like\s+a\s+(kid|teen|teenager|child)\b/gi,
  /\byou'?re\s+(more|so\s+much\s+more)\s+mature\s+than\s+(other|the\s+other|girls|boys)\s+your\s+age\b/gi,
  // Romanian
  /\be[sș]ti\s+(foarte|prea|chiar)\s+matur[aă]?\s+pentru\s+v[aâ]rsta\s+ta\b/gi,
  /\bnu\s+(pari|ar[aă][tț]i|vorbe[sș]ti)\s+ca\s+un\s+(copil|adolescent\w*)\b/gi,
  // Spanish
  /\beres\s+(?:muy|tan|demasiado)\s+madur[ao]\s+para\s+tu\s+edad\b/gi,
  /\bno\s+(?:pareces|act[uú]as\s+como|hablas\s+como)\s+(?:un[a]?\s+)?(?:ni[nñ][ao]|adolescente|cr[ií]a)\b/gi,
  // Portuguese
  /\bvoc[eê]\s+[eé]\s+(?:muito|t[aã]o|bem)\s+madur[ao]\s+para\s+(?:a\s+)?sua\s+idade\b/gi,
  /\bvoc[eê]\s+n[aã]o\s+(?:parece|age\s+como|fala\s+como)\s+(?:uma?\s+)?(?:crian[cç]a|adolescente)\b/gi,
];
const ISOLATION_GROOM_PATTERNS = [
  /\byou\s+can\s+trust\s+me\s*[,.]?\s+(i'?ll|you|we|nobody|no\s+one)\b/gi,
  /\byour\s+parents\s+(won'?t|wouldn'?t|don'?t)\s+(understand|get\s+it|know\s+what)\b/gi,
  /\b(we\s+have\s+something\s+special|what\s+we\s+have\s+is\s+special|nobody\s+understands\s+(us|you)\s+like\s+i\s+do)\b/gi,
  // Romanian
  /\bpo[tț]i\s+s[aă]\s+ai\s+[iî]ncredere\s+[iî]n\s+mine\b/gi,
  /\bp[aă]rin[tț]ii\s+(t[aă]i)?\s+(nu\s+(o\s+s[aă]\s+|vor)\s+[iî]nteleg|nu\s+[iî]n[tț]eleg)\b/gi,
];
function sexualStructuralHits(_ctx: LinguisticContext): SignalHit[] {
  // None on purpose: only the patterns count, to keep false alarms down.
  return [];
}
export const sexualClassifier: TechniqueClassifier = {
  classify(input: ClassifierInput): ClassifierOutput {
    const ctx = buildContext(input.text);
    const result = score(ctx, {
      technique: 'sexual',
      signals: [
        patternSignal('grooming-secrecy', 4, GROOMING_SECRECY_PATTERNS),
        patternSignal('dm-probe', 4, DM_PROBE_PATTERNS),
        patternSignal('age-probe', 3, AGE_PROBE_PATTERNS),
        patternSignal('maturity-groom', 3, MATURITY_GROOM_PATTERNS),
        patternSignal('isolation-groom', 3, ISOLATION_GROOM_PATTERNS),
        patternSignal('grooming-obfuscated', 2, GROOMING_SECRECY_PATTERNS, { matchAggressive: true, maxHits: 1 }),
        patternSignal('dm-probe-obfuscated', 2, DM_PROBE_PATTERNS, { matchAggressive: true, maxHits: 1 }),
      ],
      structural: sexualStructuralHits,
      registerPolicy: {
        'news-report': 0.30,
        'clickbait': 0.80,
        'conversational': 1.20,
        'formal': 0.40,
      },
      // Not dampened: a child writing "i'm scared he keeps asking me to keep our little secret"
      // should be flagged for a person to look at.
      dampenOnFirstPersonVulnerability: false,
      quoteDampener: 0.40,
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
