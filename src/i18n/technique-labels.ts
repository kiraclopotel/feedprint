// What each technique is called, in the four languages the product speaks.
//
// These maps were declared inside a dashboard component's colour module, and the export builder in
// forensics imported them from there, which is a layer reaching up (PLAN-2026-09-16 item 8.7). They
// are words, so they live with the other words; the colour module re-exports them, so every
// existing import still works.

// Keyed by the persisted TechniqueName enum (src/types/analysis.ts). The
// dashboard techniqueLabel delegate looks these up by the raw enum name, so
// every union member needs a parent-readable phrase here or the raw
// kebab-case id leaks onto the audit view.
// Plain-words pass, owner's rule 2026-08-04: a label a parent would not say out
// loud is a label that teaches nothing. These are DISPLAY strings only, keyed by
// the persisted enum, so renaming here never touches a signed record or a hash.
export const PRETTY_TECHNIQUE: Record<string, string> = {
  'fear-appeal':       'fear',
  'repeat-exposure':   'seen a lot',
  'anger-trigger':     'anger',
  'shame-attack':      'shame',
  'false-urgency':     'rushing you',
  'bandwagon':         'follow the crowd',
  'scapegoating':      'shift blame',
  'fomo':              'missing out',
  'toxic-positivity':  'forced positivity',
  'misleading-format': 'disguised post',
  // 'combined' is the fallback technique when the model's free-text concern
  // matches none of the ~14 technique enums, so it means UNCATEGORISED, not
  // "several at once" (deciding site: the fallback return of
  // mapConcernToTechnique in src/core/neutralizer.ts). It was labelled
  // "multiple techniques" until 2026-08-04, which told the reader the opposite
  // of what the field records. Since 2026-08-22 the model's own concern phrase
  // IS on the signed record, as techniques[].why, so a per-record surface can
  // show what the tool actually saw; an AGGREGATE surface still cannot, which
  // is why the narrative rows leave this bucket out.
  'combined':          'no named pattern',
  'ai-content-block':         'made by AI',
  'profanity':                'swearing',
  'body-comparison-priming':  'body comparison',
  'parasocial-coercion':      'fake closeness',
  'consumer-rapid-frame':     'pressure to buy',
  'hyperreal-trauma-bait':    'fake drama',
  'combined-stack':           'lots of hostility',
  'sexual':                   'sexual',
  'violence-graphic':         'violence',
  // "self harm" with a space, not "self-harm": the raw-kebab guard in
  // tests/unit/ui/dashboard/components/technique-color-maps.test.ts cannot tell a readable hyphenated
  // label from a leaked enum id, and it is right to be strict about that.
  'self-harm':                'self harm',
  'drug-promotion':           'drugs',
  'unsafe-health-experiment': 'risky health advice',
  'extreme-toxicity':         'extreme cruelty',
  // The benign and positive verdicts. These were missing from this map and
  // present in the export's old private one, so consolidating onto this map
  // leaked raw ids for them. genuine-opinion is the single most frequent label
  // in a real chain (2,081 of 19,259 on the 10-day sample), so it leaked the
  // most. The raw-kebab guard did not catch it: these arrive from the
  // comment-batch verdict path, not the TechniqueName union it iterates.
  'genuine-opinion':   'a real opinion',
  'supportive':        'supportive',
  'mockery':           'mockery',
  'informative':       'informative',
  'neutral':           'neutral',
  'sarcasm':           'sarcasm',
  'gratitude':         'gratitude',
  'kindness':          'kindness',
  'peer-pressure':     'peer pressure',
};

// ─── Translated display layer ───
// The KEYS above are stable internal identifiers: technique ids feed
// TECHNIQUE_COLORS + the click-filter matching, and the English blocked-
// category labels are produced by `categorizeBlockedRecord` (Dashboard.tsx)
// and matched against the hidden-category filter + BLOCKED_CATEGORY_COLORS.
// Localization therefore happens ONLY at the display point, via
// `DashboardStrings.techniqueLabel` / `.blockedCategoryLabel`
// (src/i18n/dashboard-strings.ts), which read these maps. Never key any
// matching or color lookup off the translated strings.

// Plain-words pass 2026-08-04, in step with PRETTY_TECHNIQUE above. Same rule:
// the word a parent would actually use, not the one a researcher would.
export const PRETTY_TECHNIQUE_RO: Record<string, string> = {
  'fear-appeal':       'frică',
  'repeat-exposure':   'văzut des',
  'anger-trigger':     'furie',
  'shame-attack':      'rușinare',
  'false-urgency':     'te grăbește',
  'bandwagon':         'fă ca toți',
  'scapegoating':      'aruncă vina',
  'fomo':              'teama că pierzi',
  'toxic-positivity':  'pozitivitate forțată',
  'misleading-format': 'postare deghizată',
  'combined':          'tipar fără nume',
  'ai-content-block':         'făcut de AI',
  'profanity':                'înjurături',
  'body-comparison-priming':  'comparație cu corpul',
  'parasocial-coercion':      'apropiere falsă',
  'consumer-rapid-frame':     'presiune să cumperi',
  'hyperreal-trauma-bait':    'dramă falsă',
  'combined-stack':           'multă ostilitate',
  'sexual':                   'sexual',
  'violence-graphic':         'violență',
  'self-harm':                'autovătămare',
  'drug-promotion':           'droguri',
  'unsafe-health-experiment': 'sfat medical riscant',
  'extreme-toxicity':         'cruzime extremă',
  'genuine-opinion':   'o opinie reală',
  'supportive':        'de sprijin',
  'mockery':           'batjocură',
  'informative':       'informativ',
  'neutral':           'neutru',
  'sarcasm':           'sarcasm',
  'gratitude':         'recunoștință',
  'kindness':          'amabilitate',
  'peer-pressure':     'presiune de grup',
};

export const PRETTY_TECHNIQUE_ES: Record<string, string> = {
  'fear-appeal':       'miedo',
  'repeat-exposure':   'visto mucho',
  'anger-trigger':     'rabia',
  'shame-attack':      'vergüenza',
  'false-urgency':     'te apura',
  'bandwagon':         'haz como todos',
  'scapegoating':      'echa la culpa',
  'fomo':              'miedo a perderte algo',
  'toxic-positivity':  'positividad forzada',
  'misleading-format': 'publicación disfrazada',
  'combined':          'patrón sin nombre',
  'ai-content-block':         'hecho por IA',
  'profanity':                'palabrotas',
  'body-comparison-priming':  'comparación de cuerpos',
  'parasocial-coercion':      'cercanía falsa',
  'consumer-rapid-frame':     'presión para comprar',
  'hyperreal-trauma-bait':    'drama falso',
  'combined-stack':           'mucha hostilidad',
  'sexual':                   'sexual',
  'violence-graphic':         'violencia',
  'self-harm':                'autolesión',
  'drug-promotion':           'drogas',
  'unsafe-health-experiment': 'consejo de salud arriesgado',
  'extreme-toxicity':         'crueldad extrema',
  'genuine-opinion':   'una opinión real',
  'supportive':        'de apoyo',
  'mockery':           'burla',
  'informative':       'informativo',
  'neutral':           'neutro',
  'sarcasm':           'sarcasmo',
  'gratitude':         'agradecimiento',
  'kindness':          'amabilidad',
  'peer-pressure':     'presión del grupo',
};

export const PRETTY_TECHNIQUE_PT_BR: Record<string, string> = {
  'fear-appeal':       'medo',
  'repeat-exposure':   'visto muito',
  'anger-trigger':     'raiva',
  'shame-attack':      'vergonha',
  'false-urgency':     'te apressa',
  'bandwagon':         'faça como todos',
  'scapegoating':      'joga a culpa',
  'fomo':              'medo de perder algo',
  'toxic-positivity':  'positividade forçada',
  'misleading-format': 'publicação disfarçada',
  'combined':          'padrão sem nome',
  'ai-content-block':         'feito por IA',
  'profanity':                'palavrão',
  'body-comparison-priming':  'comparação de corpos',
  'parasocial-coercion':      'proximidade falsa',
  'consumer-rapid-frame':     'pressão para comprar',
  'hyperreal-trauma-bait':    'drama falso',
  'combined-stack':           'muita hostilidade',
  'sexual':                   'sexual',
  'violence-graphic':         'violência',
  'self-harm':                'automutilação',
  'drug-promotion':           'drogas',
  'unsafe-health-experiment': 'conselho de saúde arriscado',
  'extreme-toxicity':         'crueldade extrema',
  'genuine-opinion':   'uma opinião real',
  'supportive':        'de apoio',
  'mockery':           'deboche',
  'informative':       'informativo',
  'neutral':           'neutro',
  'sarcasm':           'sarcasmo',
  'gratitude':         'agradecimento',
  'kindness':          'gentileza',
  'peer-pressure':     'pressão do grupo',
};
