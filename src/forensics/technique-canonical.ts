// FeelingWise — technique label canonicalisation for statistics.
//
// Moved out of store.ts on 14 Sep 2026 so the per-month summary
// (archive-summary.ts), which the service worker's archive writer imports,
// does not pull the active-store module graph into the worker bundle.
// store.ts re-exports it; every existing importer keeps working.
//
// Display-time technique canonicalization for stats aggregation.
//
// Legacy chain records can carry several variants of the same concept:
//   • the canonical English enum (`shame-attack`)
//   • Romanian-localized display strings stamped at write time before
//     the EN-only purge (`atac la ruşine`)
//   • LLM mid-translation drift forms (`genuine-opinie` — English root
//     plus Romanian "-ie" suffix)
// Without canonicalization the dashboard chart aggregates by raw label
// and splits a single concept across N buckets. This map collapses all
// known variants into the canonical English enum used by
// `BatchCommentVerdict.technique`. New records carry canonical English
// names directly and pass through as-is.
//
// Deeper fix is to store the canonical English enum in the chain record
// itself. Until then, this display-time pass keeps the chart usable.
const TECHNIQUE_CANONICAL_MAP: Record<string, string> = {
  // genuine-opinion (incl. LLM mid-translation drift)
  'genuine-opinion': 'genuine-opinion',
  'genuine opinion': 'genuine-opinion',
  'genuine-opinie': 'genuine-opinion',
  'genuine opinions': 'genuine-opinion',
  'opinie': 'genuine-opinion',
  'opinie sincera': 'genuine-opinion',
  'opinie sinceră': 'genuine-opinion',
  // informative
  'informative': 'informative',
  'informativ': 'informative',
  // neutral
  'neutral': 'neutral',
  'neutru': 'neutral',
  // sarcasm (single-form across languages)
  'sarcasm': 'sarcasm',
  // mockery
  'mockery': 'mockery',
  'batjocura': 'mockery',
  'batjocură': 'mockery',
  // shame-attack
  'shame-attack': 'shame-attack',
  'shame attack': 'shame-attack',
  'atac la rusine': 'shame-attack',
  'atac la ruşine': 'shame-attack',
  // fear-appeal
  'fear-appeal': 'fear-appeal',
  'fear appeal': 'fear-appeal',
  'apel la frica': 'fear-appeal',
  'apel la frică': 'fear-appeal',
  // toxic-positivity
  'toxic-positivity': 'toxic-positivity',
  'toxic positivity': 'toxic-positivity',
  'pozitivism toxic': 'toxic-positivity',
  // peer-pressure (legacy; not in current 21-union but historically logged)
  'peer-pressure': 'peer-pressure',
  'peer pressure': 'peer-pressure',
  'presiune de grup': 'peer-pressure',
  // bandwagon
  'bandwagon': 'bandwagon',
  'efect de turma': 'bandwagon',
  'efect de turmă': 'bandwagon',
  // gratitude
  'gratitude': 'gratitude',
  'recunostinta': 'gratitude',
  'recunoştinţă': 'gratitude',
  // kindness
  'kindness': 'kindness',
  'amabilitate': 'kindness',
  // Plain-words display labels adopted 2026-08-04 (PRETTY_TECHNIQUE and
  // PRETTY_TECHNIQUE_RO). Records carry the enum, so these are here only so a
  // label that round-trips through a display surface still aggregates into its
  // own bucket instead of passing through as a new one.
  'shame': 'shame-attack',
  'rusinare': 'shame-attack',
  'rușinare': 'shame-attack',
  'fear': 'fear-appeal',
  'frica': 'fear-appeal',
  'frică': 'fear-appeal',
  'anger': 'anger-trigger',
  'furie': 'anger-trigger',
  'shift blame': 'scapegoating',
  'arunca vina': 'scapegoating',
  'aruncă vina': 'scapegoating',
  'violence': 'violence-graphic',
  'violenta': 'violence-graphic',
  'violență': 'violence-graphic',
  'swearing': 'profanity',
  'injuraturi': 'profanity',
  'înjurături': 'profanity',
  'pressure to buy': 'consumer-rapid-frame',
  'presiune sa cumperi': 'consumer-rapid-frame',
  'presiune să cumperi': 'consumer-rapid-frame',
  'no named pattern': 'combined',
  'tipar fara nume': 'combined',
  'tipar fără nume': 'combined',
  // Pre-2026-08-24 display labels for the same enum. Kept so a saved search
  // or a bookmark written against the old wording still resolves.
  'something else': 'combined',
  'altceva': 'combined',
  'rushing you': 'false-urgency',
  'te grabeste': 'false-urgency',
  'te grăbește': 'false-urgency',
  'missing out': 'fomo',
  'follow the crowd': 'bandwagon',
  'forced positivity': 'toxic-positivity',
  'disguised post': 'misleading-format',
  'fake closeness': 'parasocial-coercion',
  'fake drama': 'hyperreal-trauma-bait',
  'lots of hostility': 'combined-stack',
  'made by ai': 'ai-content-block',
  'drugs': 'drug-promotion',
  'risky health advice': 'unsafe-health-experiment',
  'extreme cruelty': 'extreme-toxicity',
};

export function canonicalizeTechniqueForStats(name: string): string {
  if (!name) return 'unknown';
  const k = name.trim().toLowerCase();
  return TECHNIQUE_CANONICAL_MAP[k] ?? name; // unknown labels pass through
}

