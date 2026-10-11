// FeelingWise — Comment-rewrite validators.
//
// Public surface:
//   • `validateRewrite` — umbrella validator running the full voice-rule
//     stack (min-length / meta-talk / false-self-admission /
//     advisory-injection / length-blowup / register-flatten /
//     forbidden-meta / language-drift). Called from BOTH the per-comment
//     fallback `ai/neutralize-only.ts` AND the BATCH V3 inline-rewrite
//     path in `content/index.ts`. Closes the validator-parity gap noted
//     in `docs/history/archive/audits-2026-05-22/detection-audit.md` §3.
//   • `validateRewriteLanguage` — language-only gate (kept exported for
//     the per-post pipeline at `core/pipeline.ts:766-775` and teen-marker
//     explanation copy guard at `content/teen-marker.ts:177`).

import { detectLanguage } from '../core/lang-detect';
import {
  detectMetaTalk,
  detectFalseSelfAdmission,
  detectInjectedAdvisory,
  detectLengthRatioBlowup,
  detectRegisterFlattening,
  FORBIDDEN_META_PATTERNS,
} from '../core/neutralizer';
import { detectUnsafeVisibleLanguage } from '../core/visible-output-safety';
import { rewriteKeepsTheAttack } from './rewrite-keeps-attack';

/**
 * Post-LLM language validator.
 *
 * Strategy:
 *   • Tier 1 (full validator) — `expected` ∈ {ro, en}. Use `detectLanguage()`
 *     and require positive match on the expected language (no RO leakage on
 *     EN expected; no EN leakage on RO expected).
 *   • Tier 2 (heuristic validator) — `expected` is any other language code
 *     OR a human-readable language name. We check whether the rewrite is
 *     suspiciously English-like: if the rewrite scores >0 EN AND 0 RO
 *     diacritics AND `expected` is NOT 'en', reject. This catches the
 *     dominant LLM failure mode (drift to English) without needing a full
 *     detector for every world language. Other drift directions (e.g., LLM
 *     emits Spanish on a Polish prompt) are NOT caught — accepted limit.
 *
 * Returns false (reject) when the rewrite's language doesn't match expected;
 * true (accept) otherwise. Caller treats false as "rewrite failed — caller
 * hides the row, safety-gap behavior."
 */
export function validateRewriteLanguage(rewritten: string, expected: string): boolean {
  const exp = expected.toLowerCase();
  const det = detectLanguage(rewritten);

  // Full validator for EN / RO. Symmetric leniency: both branches accept
  // a detector verdict of `mixed` because short rewrites often lack enough
  // signal for a confident single-language call. The asymmetric strict-RO
  // path killed innocent short RO rewrites with empty-overlay UX; mirror
  // the EN branch's tolerance and only reject on positive cross-leakage.
  if (exp === 'ro') {
    if (det.language === 'ro') return true;
    if (det.en_score > 0 && det.ro_score === 0) return false;
    return det.language !== 'en';
  }
  if (exp === 'en') {
    if (det.language === 'en') return true;
    if (det.ro_score > 0 && det.en_score === 0) return false;
    return det.language !== 'ro';
  }

  // Heuristic for other languages. Catch the dominant failure mode: LLM
  // drifts to English on a non-English prompt.
  if (det.language === 'en' && det.en_score > det.ro_score) {
    return false;
  }

  return true;
}

// --- Umbrella rewrite validator -----------------------------------------

type RewriteRejectionReason =
  | 'too-short'
  | 'meta-talk'
  | 'false-self-admission'
  | 'advisory-injection'
  | 'length-blowup'
  | 'register-flatten'
  | 'forbidden-meta'
  | 'language-drift'
  | 'profanity-preserved'
  | 'near-identical'
  | 'attack-kept'
  | 'refusal';

export interface RewriteValidationResult {
  valid: boolean;
  /** Set iff `valid === false`. */
  reason?: RewriteRejectionReason;
  /**
   * Diagnostic string for logging — the matched hit string from
   * `detectMetaTalk` / `detectInjectedAdvisory`, the failing pattern
   * source from `FORBIDDEN_META_PATTERNS`, or the expected language code
   * from the language-drift branch. Undefined for boolean-only checks.
   */
  detail?: string;
}

/**
 * Run the full voice-rule validator stack against a candidate rewrite.
 *
 * Strict superset of the inline block that used to live in
 * `ai/neutralize-only.ts:183-238`. Wiring this from both the per-comment
 * fallback AND the BATCH V3 inline-rewrite path (in `content/index.ts`)
 * closes the validator-parity gap surfaced in the 2026-05-22 audit:
 * before this, only `validateRewriteLanguage` ran on inline rewrites,
 * so generic-platitude register-flattenings (e.g. "I think this
 * behavior is unacceptable" emitted by the BATCH V3 model on three
 * distinct comments in one batch) landed in DOM unchallenged.
 *
 * Order is sensitive: cheap structural checks first, language detection
 * (which scans the entire string for diacritic/function-word evidence)
 * last. Each guard short-circuits — the first failure wins.
 *
 * Returns `{valid: true}` on accept; `{valid: false, reason, detail?}`
 * on reject. Caller treats reject as "rewrite failed — fall through to
 * the existing empty-rewrite branch" (which routes to HIDE on high-sev
 * manipulation or mark-only otherwise).
 */
/**
 * The provider declining the job, told apart from somebody disagreeing.
 *
 * Found on a live feed 2026-09-19: a flagged comment was replaced on the page
 * with "I'm sorry, but I can't help with that." That is the model answering
 * "rewrite this" with "no", and every existing gate let it through, because a
 * refusal is short, fluent, first-person and contains no forbidden pattern. The
 * reader saw a mild sentence where an attack had been, and the record kept it.
 *
 * The line between a refusal and a rewrite is WHAT the speaker says they cannot
 * do. Refusing the TASK ("I can't help with that", "I cannot fulfil this
 * request") is the model talking about itself. Refusing the CONTENT ("I cannot
 * agree with this", "I'm sorry you feel that way, but...") is an ordinary
 * softened reply and has to keep passing, or flagged comments stop being
 * rewritten at all, which is the failure this product exists to prevent.
 *
 * So the match needs three things at once: first person, an inability, and a
 * task word rather than a topic. It is anchored at the start and capped in
 * length, because a genuine rewrite that happens to contain one of these
 * phrases mid-sentence is somebody's actual point, not a refusal.
 */
const REFUSAL_OPENERS = [
  // "I'm sorry, but I can't help with that" and its polite variants.
  /^(?:i(?:'m| am)\s+sorry|sorry|unfortunately)[,.!]?\s*(?:but\s+)?i\s*(?:'m|\s+am)?\s*(?:can(?:'|’)?t|cannot|can not|won(?:'|’)?t|will not|am unable to|unable to)\s+(?:be able to\s+)?(?:help|assist|comply|complete|fulfil|fulfill|provide|generate|produce|rewrite|do|create|write)\b/i,
  // The same without the apology. "be able to" is optional because the model
  // says both "I can't help" and "I won't be able to help", and only the first
  // was caught when this was written.
  /^i\s*(?:'m|\s+am)?\s*(?:can(?:'|’)?t|cannot|can not|won(?:'|’)?t|will not|am unable to|unable to)\s+(?:be able to\s+)?(?:help|assist|comply|complete|fulfil|fulfill|provide|generate|produce|rewrite|create)\b/i,
  // Model self-reference. Never a person's words about another person's post.
  /\bas an?\s+(?:ai|a\.i\.|language model|assistant)\b/i,
];

/** Long enough to be a real reply is long enough not to be one of these. */
const REFUSAL_MAX_CHARS = 160;

function detectRefusal(rewrite: string): string | null {
  const text = rewrite.trim();
  if (text.length > REFUSAL_MAX_CHARS) return null;
  for (const re of REFUSAL_OPENERS) {
    const hit = re.exec(text);
    if (hit) return hit[0];
  }
  return null;
}

/**
 * Letters the rewrite introduced that the original never had.
 *
 * WHY THIS IS NOT `validateRewriteLanguage`. That function is a two-language
 * leakage detector: `detectLanguage` in src/core/lang-detect.ts scores English
 * function words against Romanian function words and diacritics, and answers
 * en / ro / mixed / unknown. Text in a third language scores zero on both and
 * comes back 'unknown', which the EN branch accepts, because 'unknown' is also
 * what a short honest rewrite looks like. So an English comment rewritten into
 * Turkish passed every gate and went on the page, which is what happened
 * (reported 2026-09-20 from a day of the owner's own export).
 *
 * Rather than teach a hand-written detector more languages, this asks a
 * question that needs no detector: a rewrite states the same claim without the
 * charge, so it has no business introducing a script or a letter the person
 * never typed. A Turkish translation of an English sentence brings ı, ğ or ş
 * with it; a Russian one brings Cyrillic. Both are letters the original did
 * not contain, and that is the whole test.
 *
 * Tolerated on purpose: the accented letters English and Romanian borrow
 * without changing language (café, naïve, Zoë, jalapeño), because rejecting
 * those would hide comments over a loanword. A rewrite may also keep any
 * foreign letter the ORIGINAL already carried, so a comment quoting Greek can
 * be softened and keep its quote.
 *
 * The limit, named: Turkish written without ı, ğ or ş, or any other language
 * whose letters are a subset of the original's, is not caught here. Chrome's
 * own LanguageDetector would catch it, and on 2026-09-20 it answered
 * `availability(): "downloadable"` on this machine, meaning a model download
 * before it can say anything, which is not something to wait for while a
 * comment sits on screen. When it reports "available" it is worth adding as a
 * second opinion; it cannot replace this one.
 *
 * Returns the offending characters, or null.
 */
const LOANWORD_MARKS = 'áàâäãåéèêëíìîïóòôöõúùûüñçøœæÁÀÂÄÃÅÉÈÊËÍÌÎÏÓÒÔÖÕÚÙÛÜÑÇØŒÆ';

const NON_LATIN_SCRIPTS: ReadonlyArray<readonly [string, RegExp]> = [
  ['Cyrillic', /\p{Script=Cyrillic}/u],
  ['Greek', /\p{Script=Greek}/u],
  ['Arabic', /\p{Script=Arabic}/u],
  ['Hebrew', /\p{Script=Hebrew}/u],
  ['Han', /\p{Script=Han}/u],
  ['Hiragana', /\p{Script=Hiragana}/u],
  ['Katakana', /\p{Script=Katakana}/u],
  ['Hangul', /\p{Script=Hangul}/u],
  ['Thai', /\p{Script=Thai}/u],
  ['Devanagari', /\p{Script=Devanagari}/u],
  ['Armenian', /\p{Script=Armenian}/u],
  ['Georgian', /\p{Script=Georgian}/u],
];

export function detectIntroducedLetters(rewrite: string, originalText: string): string | null {
  // A whole script the original never used. Reported by name, because
  // "introduced Cyrillic" reads better in a log than a list of characters.
  for (const [name, re] of NON_LATIN_SCRIPTS) {
    if (re.test(rewrite) && !re.test(originalText)) return name;
  }

  // Latin letters outside ASCII that neither the original nor the two
  // languages this product writes in would produce. Romanian's own set is
  // tolerated whatever the original looked like: the rewriter is allowed to
  // spell Romanian correctly when the person did not.
  const tolerated = new Set([...LOANWORD_MARKS, ...'ăâîșțşţĂÂÎȘȚŞŢ', ...originalText]);
  const introduced = new Set<string>();
  for (const ch of rewrite) {
    if (ch.charCodeAt(0) < 128) continue;
    if (!/\p{Letter}/u.test(ch)) continue;
    if (tolerated.has(ch)) continue;
    introduced.add(ch);
  }
  return introduced.size > 0 ? [...introduced].join('') : null;
}

/**
 * A long rewrite that carries no trace of the language it should be in.
 *
 * `detectIntroducedLetters` above catches a change of script and a change of
 * alphabet. It cannot catch French, German, Italian, Portuguese or Turkish
 * written with the accents English already borrows, and those are the drifts
 * this product's own audience is most likely to see. This catches them with
 * the signal the detector already computes and the existing branch throws
 * away: an English sentence long enough to say anything contains English
 * function words.
 *
 * MEASURED, 2026-09-20, against an English original. Seven drift samples
 * (Turkish twice, French, German, Spanish, Portuguese, Italian) were 48 to 71
 * characters and scored zero English. Twelve genuine English softenings of the
 * kind the rewriter produces scored zero only twice, at 24 and 40 characters
 * ("Overpriced plastic junk.", "Cheap build, poor finish, disappointing."):
 * every genuine rewrite of 44 characters or more scored two or more. The bar
 * is set at 48 characters, eight above the longest genuine zero, on a sample
 * of twelve. That is a thin margin on a small sample and it is written here so
 * the next reader can widen it with a bigger one rather than a feeling.
 *
 * WHAT A FALSE REJECT COSTS, which is why the bar sits where it does: a
 * rejected rewrite routes to the empty-rewrite branch, so the comment is
 * marked or hidden rather than replaced. The person's own words stay on the
 * page. A false ACCEPT puts a sentence nobody wrote in place of what they
 * said, under this product's marker, and the record keeps it. The two costs
 * are not the same size.
 */
const FOREIGN_LENGTH_FLOOR = 48;

export function detectMissingExpectedLanguage(rewrite: string, originalText: string): string | null {
  const original = detectLanguage(originalText);
  if (original.language !== 'en' && original.language !== 'ro') return null;
  if (rewrite.trim().length < FOREIGN_LENGTH_FLOOR) return null;
  const det = detectLanguage(rewrite);
  if (original.language === 'en' && det.en_score === 0) return 'no English in a long rewrite';
  if (original.language === 'ro' && det.ro_score === 0) return 'no Romanian in a long rewrite';
  return null;
}

export function validateRewrite(
  rewrite: string,
  originalText: string,
): RewriteValidationResult {
  if (rewrite.length < 5) {
    return { valid: false, reason: 'too-short' };
  }
  // Before the voice rules: those ask whether the sentence is written well, and
  // this asks whether it is a sentence about the comment at all.
  const refusalHit = detectRefusal(rewrite);
  if (refusalHit) {
    return { valid: false, reason: 'refusal', detail: refusalHit };
  }
  const metaHit = detectMetaTalk(rewrite, originalText);
  if (metaHit) {
    return { valid: false, reason: 'meta-talk', detail: metaHit };
  }
  if (detectFalseSelfAdmission(originalText, rewrite)) {
    return { valid: false, reason: 'false-self-admission' };
  }
  const advisoryHit = detectInjectedAdvisory(originalText, rewrite);
  if (advisoryHit) {
    return { valid: false, reason: 'advisory-injection', detail: advisoryHit };
  }
  if (detectLengthRatioBlowup(originalText, rewrite)) {
    return { valid: false, reason: 'length-blowup' };
  }
  if (detectRegisterFlattening(originalText, rewrite)) {
    return { valid: false, reason: 'register-flatten' };
  }
  for (const pattern of FORBIDDEN_META_PATTERNS) {
    if (pattern.test(rewrite)) {
      return { valid: false, reason: 'forbidden-meta', detail: pattern.source };
    }
  }

  const profanityCheck = detectProfanityPreserved(originalText, rewrite);
  if (profanityCheck) {
    return { valid: false, reason: 'profanity-preserved', detail: profanityCheck };
  }

  if (isNearIdentical(originalText, rewrite)) {
    return { valid: false, reason: 'near-identical' };
  }

  // The insult behind an "I think", or the call it ended on (share this, disappear), carried into the rewrite
  // (analysis/rewrite-keeps-attack.ts, 11 Oct 2026). Rejected like any invalid rewrite: the comment is marked or hidden.
  const kept = rewriteKeepsTheAttack(originalText, rewrite);
  if (kept !== null) {
    return { valid: false, reason: 'attack-kept', detail: kept };
  }

  const det = detectLanguage(originalText);
  if (
    (det.language === 'ro' || det.language === 'en')
    && !validateRewriteLanguage(rewrite, det.language)
  ) {
    return { valid: false, reason: 'language-drift', detail: det.language };
  }

  // Runs after that one and not instead of it: the branch above catches
  // English leaking into Romanian and back, which share an alphabet and so
  // introduce no letter at all. This one catches every language the detector
  // cannot see, which is all of them but two.
  const introduced = detectIntroducedLetters(rewrite, originalText);
  if (introduced !== null) {
    return { valid: false, reason: 'language-drift', detail: `introduced ${introduced}` };
  }

  const missing = detectMissingExpectedLanguage(rewrite, originalText);
  if (missing !== null) {
    return { valid: false, reason: 'language-drift', detail: missing };
  }
  return { valid: true };
}

/**
 * Reject a rewrite that still contains profanity/slurs from the original.
 * Runs the profanity filter in teen mode (flag-only, no asterisks) on the
 * rewrite text. If ANY match survives, the rewrite failed its contract.
 * Returns the first matched term (for logging) or null if clean.
 */
function detectProfanityPreserved(
  _original: string,
  rewrite: string,
): string | null {
  return detectUnsafeVisibleLanguage(rewrite);
}

/**
 * Reject a rewrite that is essentially identical to the original.
 * Normalizes whitespace + case + trailing punctuation, then checks
 * Levenshtein-like similarity. A rewrite within 10% edit distance
 * of the original (for texts ≥ 20 chars) is near-identical.
 */
function isNearIdentical(original: string, rewrite: string): boolean {
  const normA = original.trim().toLowerCase().replace(/\s+/g, ' ');
  const normB = rewrite.trim().toLowerCase().replace(/\s+/g, ' ');
  if (normA === normB) return true;
  if (normA.length < 20) return false;
  const maxLen = Math.max(normA.length, normB.length);
  const dist = quickEditDistance(normA, normB, Math.ceil(maxLen * 0.1));
  return dist <= Math.ceil(maxLen * 0.1);
}

function quickEditDistance(a: string, b: string, threshold: number): number {
  if (Math.abs(a.length - b.length) > threshold) return threshold + 1;
  const prev = new Uint16Array(b.length + 1);
  const curr = new Uint16Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    if (rowMin > threshold) return threshold + 1;
    prev.set(curr);
  }
  return prev[b.length];
}
