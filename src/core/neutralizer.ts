// FeelingWise - Neutralization Engine
// Now supports combined detect+neutralize in a single AI call for speed.

import { TechniqueResult, AnalysisResult, TechniqueName } from '../types/analysis';
import { NeutralizedContent } from '../types/neutralization';
import type { Mode } from '../types/mode';
// ARCHITECTURE-1 layering violation, seeded 2026-08-23 (Proposal C); do not add new markers, route new imports through the correct layer.
// eslint-disable-next-line @typescript-eslint/no-restricted-imports
import {
  buildJudgeDetectNeutralizeSystem,
  buildJudgeDetectOnlySystem,
  JUDGE_DETECT_NEUTRALIZE_USER_TEMPLATE,
  JUDGE_DETECT_NEUTRALIZE_USER_TEMPLATE_NOFLAG,
  buildContextBlock,
  TRIAGE_STAGE1_SYSTEM,
  TRIAGE_STAGE1_USER_TEMPLATE,
  JUDGE_V1_ADULT_SYSTEM,
  JUDGE_V1_MODEL,
  JUDGE_V1_SECOND_MODEL,
  judgeIdentity,
  needsSecondOpinion,
  pairFires,
  JUDGE_V1_HASH,
  JUDGE_V1_SCHEMA,
  JUDGE_V1_FIRE_SEVERITY,
  JUDGE_V1_HIDE_SEVERITY,
  JUDGE_V1_MAX_TOKENS,
  buildJudgeV1UserPrompt,
  parseJudgeV1,
  type JudgeV1Family,
  type JudgeV1Verdict,
  parseTriageVerdict,
  TriageVerdict,
  fillTemplate,
} from '../ai/prompts';
// ARCHITECTURE-1 layering violation, seeded 2026-08-23 (Proposal C); do not add new markers, route new imports through the correct layer.
// eslint-disable-next-line @typescript-eslint/no-restricted-imports
import { callAI } from '../ai/client';
// ARCHITECTURE-1 layering violation, seeded 2026-08-23 (Proposal C); do not add new markers, route new imports through the correct layer.
// eslint-disable-next-line @typescript-eslint/no-restricted-imports
import { unwrapOrEmpty } from '../ai/ai-error';
// ARCHITECTURE-1 layering violation, seeded 2026-08-23 (Proposal C); do not add new markers, route new imports through the correct layer.
// eslint-disable-next-line @typescript-eslint/no-restricted-imports
import { sha256 } from '../forensics/hasher';
// ARCHITECTURE-1 layering violation, seeded 2026-08-23 (Proposal C); do not add new markers, route new imports through the correct layer.
// eslint-disable-next-line @typescript-eslint/no-restricted-imports
import { recordNeutralizerEvent } from '../forensics/neutralizer-diagnostics';
import { aggregateSeverity } from './severity';
import { detectUnsafeVisibleLanguage } from './visible-output-safety';
import { detectHarmLaundering } from './harm-laundering';
import { stripEmojis } from './text-sanitize';
// ARCHITECTURE-1 layering violation, seeded 2026-08-23 (Proposal C); do not add new markers, route new imports through the correct layer.
// eslint-disable-next-line @typescript-eslint/no-restricted-imports
import { isFeatureEnabled } from '../storage/feature-flags';
// ARCHITECTURE-1 layering violation, seeded 2026-08-23 (Proposal C); do not add new markers, route new imports through the correct layer.
// eslint-disable-next-line @typescript-eslint/no-restricted-imports
import type { CapturedTuple } from '../forensics/capture-prompt-io';

// Capture-routing: send capture messages to the SW instead of writing
// IDB directly from this content-script context. Content scripts run at
// the host page's origin, so direct IDB writes would land in the wrong
// origin (tiktok.com etc.) and be unreadable from the extension's
// dashboard / popup / dev-console. SW handler in
// service-worker.ts:CAPTURE_PROMPT_IO performs the actual write at the
// extension origin.
function sendCapturePromptIO(payload: Omit<CapturedTuple, 'id'>): void {
  try {
    void chrome.runtime.sendMessage({ type: 'CAPTURE_PROMPT_IO', payload });
  } catch { /* extension context invalidated; capture failures must never break the cascade */ }
}
// Prompt-injection input fence. Wraps user-supplied post text + author
// handle in <user-content> tags so the system prompt can mark the inner
// content as "data, not instructions". Strips control chars + bidi
// overrides + zero-width joiners + literal fence tokens so an attacker
// cannot break out of the wrap mid-content.
import { fencePostText, fenceAuthorHandle } from './prompt-fence';

/** All technique names recognised by the downstream injector / UI. */
const VALID_TECHNIQUES: Set<string> = new Set<string>([
  'fear-appeal', 'anger-trigger', 'shame-attack', 'false-urgency',
  'bandwagon', 'scapegoating', 'fomo', 'toxic-positivity',
  'misleading-format', 'combined',
  // Youth-specific techniques. The COMBINED prompt emits these directly;
  // gate them through the AI-discovered-extras loop below (no L1 input
  // row exists for them).
  'body-comparison-priming', 'parasocial-coercion',
  'consumer-rapid-frame', 'hyperreal-trauma-bait',
  // Direct-harm categories. The judge names these as its primary concern;
  // without them here a self-harm or sexual verdict fell to 'combined', met
  // the combined floor (5 in Child) instead of its own (4), and passed raw
  // at severity 4 while the record misnamed the harm.
  'sexual', 'violence-graphic', 'self-harm', 'drug-promotion',
  'unsafe-health-experiment',
] satisfies TechniqueName[]);

/**
 * Severity floor. Code-side enforcement of the gate; the production Groq
 * model (openai/gpt-oss-20b) occasionally emits sev=3..5 entries even
 * though the judge prompt defaults benign for those. Pipeline-side
 * enforcement is authoritative (schema / code > prompt).
 *
 * Per-technique × per-mode matrix grounded in developmental-psychology
 * evidence ("FeelingWise Severity Matrix").
 *
 * The flat floor was developmentally implausible: vulnerability is not a
 * scalar that drops linearly with age. Different techniques exploit
 * different cognitive systems that mature at different ages:
 *   • Pre-formal-operations (8-11) are MORE vulnerable to:
 *     authority deference, dark patterns / misleading-format, fear-appeal,
 *     shame-attack, gaslighting, isolation → lower floor in child mode.
 *   • Pubertal social-reorientation (12-17) makes teens MORE vulnerable to:
 *     bandwagon (peer-conformity peak), scapegoating (in-group identity),
 *     fomo (reward-prediction circuitry), social-comparison → lower floor
 *     in teen mode.
 *
 * The matrix below uses the SAME total intervention budget as the prior
 * flat floor (mean child ≈ 6.6, mean teen ≈ 5.8 — close to the previous
 * 7.0 / 6.0 means) but reallocates it onto the techniques that actually
 * land hardest at each age. Net effect: protection moves to where the
 * developmental evidence says it's needed.
 *
 * SEVERITY FLOOR CROSS-REF. The judge prompt
 * (`src/ai/prompts.ts:buildJudgeDetectNeutralizeSystem`) emits severity 0-10
 * but does not enforce a floor; this matrix is the authoritative gate.
 * The prompt produces a wider funnel; the matrix narrows it per-technique
 * per-mode.
 */
export const SEVERITY_FLOOR = 6;

/** Per-technique × per-mode floor. Lower = more aggressive intervention.
 *  Source: Report 6 (developmental-psychology-grounded) inverted into
 *  FW's "floor above which we act" semantic. See the docblock above for
 *  per-technique justification. */
export const SEVERITY_FLOOR_BY_TECHNIQUE_AND_MODE: Readonly<
  Record<TechniqueName, Readonly<Record<'child' | 'teen', number>>>
> = {
  // Fear & threat — child more vulnerable (emotional regulation immature, less likely to reach a trusted adult).
  'fear-appeal':       { child: 6, teen: 6 },
  // Repetition, not content. Floor 6 in both modes: the counters already
  // encode the rarity (both thresholds sit above the 95th percentile), so a
  // second per-mode filter would only hide what crossing the line means.
  'repeat-exposure':   { child: 6, teen: 6 },
  // Anger-bait — both vulnerable; identity-tribalism peak for teens, but kids react to family-shoulder political content too.
  'anger-trigger':     { child: 6, teen: 6 },
  // Shame at named recipients — child more vulnerable (weaker faux-pas / second-order ToM).
  'shame-attack':      { child: 6, teen: 7 },
  // Manufactured deadlines — teen more vulnerable (FOMO / scarcity peak per dual-systems model).
  'false-urgency':     { child: 7, teen: 6 },
  // Manufactured consensus — teen significantly more vulnerable (peer-conformity peak per Albert/Chein/Steinberg).
  'bandwagon':         { child: 8, teen: 5 },
  // Group blame — teen significantly more vulnerable (identity-formation makes in-group framings load-bearing).
  'scapegoating':      { child: 8, teen: 5 },
  // Manufactured exclusivity — teen peak.
  'fomo':              { child: 7, teen: 5 },
  // Forced-optimism dismissal of distress — both modes uniform; not strongly age-mediated in literature.
  'toxic-positivity':  { child: 7, teen: 7 },
  // Surface deception — child more vulnerable to dark-pattern recognition.
  'misleading-format': { child: 6, teen: 7 },
  // Compound — always intervene more on multi-technique stacks.
  'combined':          { child: 5, teen: 4 },
  // Profanity — handled by `profanity-filter.ts` not the LLM detector path,
  // so this floor is unused at runtime. Present for type-completeness only;
  // any change to the profanity-filter path should not look here for thresholds.
  'profanity':         { child: 1, teen: 1 },
  // ─── Youth-specific techniques ─────────────────────────────────────
  // The asymmetries below mirror the report's `severity floor`
  // recommendations cell-for-cell. "Lower = more aggressive intervention"
  // semantic kept identical to the rest of the matrix.
  // Body-image priming — TEEN-aggressive (child 6 / teen 4). Adolescent
  // body image shifts within ~10 min of pro-thin TikTok exposure
  // (Blackburn & Hogg 2024) at the developmentally peak demographic;
  // pre-pubertal children encounter the content less often and the harm
  // pathway is slower (Common Sense Media 2023, Choukas-Bradley 2022).
  'body-comparison-priming': { child: 6, teen: 4 },
  // Parasocial coercion — CHILD-aggressive (child 5 / teen 6). FTC 2022
  // dark-patterns staff report flags that under-12s cannot reliably
  // distinguish a beloved cartoon character's persuasive intent from
  // genuine friendship; teens have more developed parasocial-criticism
  // but Diaz et al. 2024 places parasocial intensity peak in early-to-mid
  // adolescence, so the teen floor is still well below 7.
  'parasocial-coercion':     { child: 5, teen: 6 },
  // Consumer rapid-frame — CHILD-aggressive (child 5 / teen 7). FTC 2022
  // and the Epic Games / Fortnite 2022 settlement establish children's
  // underdeveloped time-pressure resistance + unauthorised-charge risk;
  // teen retail engagement is high-volume and false-positives degrade
  // trust quickly (Black Friday, drops, ticketed events) so the teen
  // floor is conservative and only fires on clear urgency-fabrication.
  'consumer-rapid-frame':    { child: 5, teen: 7 },
  // Hyperreal trauma-bait — STRONGEST child asymmetry (child 4 / teen 7).
  // Pre-adolescent anthropomorphic affect-attribution + still-developing
  // AI-detection literacy + IWF 2026 indistinguishability finding combine
  // for high harm and low recognition at the youngest ages. Teen AI
  // literacy is materially higher and much consumption is in the
  // self-aware "AI slop" hate-watching register (Lupinacci 2026), so the
  // teen floor biases toward PASS on ambiguous cases.
  'hyperreal-trauma-bait':   { child: 4, teen: 7 },
  // ─── Combined-stack + 5 harm categories ────────────────────────────
  // L1 expansion. Floors below mirror the matrix's "lower = more
  // aggressive intervention" semantic.
  // Combined-stack — single-poster intensity stacking. Aggressive on both
  // modes; the stack is hostile environment regardless of which axis.
  'combined-stack':          { child: 5, teen: 5 },
  // Sexual — child safety paramount; child floor most aggressive. Teen
  // floor slightly higher to allow developmentally-normal puberty
  // discussion without false-flag.
  'sexual':                  { child: 4, teen: 5 },
  // Violence-graphic — child more aggressive (limited reality/fiction
  // discrimination). Teen floor accommodates gaming-context borderlines.
  'violence-graphic':        { child: 4, teen: 5 },
  // Self-harm — most aggressive on both modes; child + teen-old floors
  // identical because crisis-encouragement risk is universal across the
  // adolescent age window.
  'self-harm':               { child: 4, teen: 4 },
  // Drug-promotion — uniform across modes; both child and teen vulnerable
  // (substance-naive vs peak peer-pressure window).
  'drug-promotion':          { child: 5, teen: 5 },
  // Unsafe-health-experiment — child more aggressive (imitability risk);
  // teen slightly higher to allow health-discussion without false-flag.
  'unsafe-health-experiment': { child: 4, teen: 5 },
  // Extreme-toxicity — coordinated harassment signal; uniform across
  // modes since pile-on dynamics are age-invariant.
  'extreme-toxicity':        { child: 5, teen: 5 },
};

/**
 * Resolve the severity floor for a given technique × mode pair. Returns
 * the universal `SEVERITY_FLOOR` when either parameter is undefined or
 * unknown (legacy callers + tests that don't carry full context).
 *
 * The per-technique × per-mode matrix lives in
 * `SEVERITY_FLOOR_BY_TECHNIQUE_AND_MODE`; see its docblock above for the
 * developmental-psychology rationale per cell.
 */
export function severityFloorFor(
  technique?: TechniqueName | string,
  mode?: Mode,
): number {
  if (!mode) return SEVERITY_FLOOR;
  if (!technique) return SEVERITY_FLOOR;
  const techFloor = SEVERITY_FLOOR_BY_TECHNIQUE_AND_MODE[technique as TechniqueName];
  if (!techFloor) return SEVERITY_FLOOR;
  // The matrix is keyed child|teen for hash/config stability. Adult mode reads
  // the teen floor (adult is the lightest family member; per-technique adult
  // floors aren't separately calibrated — calibration.ts caps adult more
  // permissively at the threshold level instead).
  const key = mode === 'adult' ? 'teen' : mode;
  return techFloor[key] ?? SEVERITY_FLOOR;
}

// Relaxed forbidden words: only reject if the rewrite contains meta-commentary
// about manipulation techniques (the AI explaining itself instead of rewriting).
// Single-word matches like "rhetoric" in normal prose are fine — we check for
// phrases that indicate the AI broke character and started editorializing.
export const FORBIDDEN_META_PATTERNS = [
  /\bthis (?:post |text |content )?(?:uses?|contains?|employs?|exhibits?|demonstrates?) .{0,30}(?:manipulat|propaganda|technique|fallacy)/i,
  /\bmanipulation technique/i,
  /\bpropaganda (?:technique|tactic|method)/i,
  // A label, not the word: "the storm warning" and "I want to note" are ordinary prose.
  /\bnote\s*:/i,
  /\bwarning\s*:/i,
  /\beditor'?s note/i,
  /\b\[.*manipulat.*\]/i,
];

/**
 * META-TALK GUARD.
 *
 * Context: the `NEUTRALIZATION_SYSTEM` prompt and the COMBINED prompt's
 * NEUTRALIZATION clause both forbid third-party-summary phrasing ("This
 * post says", "The post expresses", "The author argues", etc.). Live
 * forensic exports showed ~20% of rewrites still started with exactly
 * those patterns.
 *
 * Prompt-side rules are advisory; pipeline-side gates are authoritative.
 * This detector rejects any rewrite that opens with a meta-reference to
 * the post itself, the author, or the speaker. A rejected rewrite causes
 * `validateNeutralization` to return false, which cascades to
 * `neutralized = null` and `pipeline.ts` PASSing the flag entirely — we
 * lose the detection but guarantee zero meta-talk in the legal forensic
 * export. That tradeoff is aligned with the 99%-precision ship rule
 * (VISION prime directive).
 *
 * Patterns cover:
 *   • Sentence-start meta-references to the post itself ("This/The post",
 *     "tweet", "message", "comment", "video", "content", "account", "text").
 *   • Sentence-start meta-references to the author ("The author", "writer",
 *     "poster", "speaker", "user", "commenter", "person").
 *   • Sentence-start passive voice ("Expressed <noun>", "Shared to express").
 *   • Mid-sentence "this/the <post-thing> <meta-verb>" — catches leaks where
 *     a first clause is clean but a second clause slips back into summary.
 *   • "the post in question", "according to the post/author" dead giveaways.
 *
 * RO equivalents live below the EN block. Romanian content is first-
 * class; without RO patterns the validator silently let through
 * "Această postare descrie...", "Autorul susține...", etc. Coverage
 * parity with EN, same structure (sentence-start, mid-text,
 * dead-giveaway). Patterns are case-insensitive and tolerate ASCII-fold
 * variants (no diacritics) since LLM output sometimes drops them.
 */
const META_TALK_PATTERNS: RegExp[] = [
  // ─── EN ───
  // Sentence-start references to the post itself.
  /^\s*(?:This|The)\s+(?:post|tweet|message|comment|video|content|account|text|thread)\b/i,
  // Sentence-start references to the author/voice. The optional `\w+\s+`
  // slot tolerates an adjective ("The original poster", "The unfortunate
  // commenter") between the determiner and the noun.
  /^\s*(?:This|The)\s+(?:\w+\s+)?(?:author|writer|poster|speaker|user|commenter|person|individual)\b/i,
  // Sentence-start passive meta ("Expressed X by doing Y").
  /^\s*Expressed\s+(?:frustration|anger|concern|disagreement|opinion|support|distaste|displeasure)\b/i,
  // Sentence-start "Shared to express / to respond / as a response".
  /^\s*(?:Shared|Posted)\s+to\s+(?:express|respond|show|convey)\b/i,
  // Mid-text meta-verbs on the post itself.
  /\b(?:this|the)\s+(?:post|tweet|message|comment|video|content|author|writer|poster|speaker)\s+(?:expresses|expressed|suggests|suggested|contains|contained|describes|described|states|stated|claims|claimed|implies|implied|argues|argued|criticizes|criticized|conveys|conveyed|says|said|shows|showed|reveals|revealed|mentions|mentioned|is\s+a\s+form\s+of|is\s+a\s+personal)\b/i,
  // Dead-giveaway constructions.
  /\bthe\s+post\s+in\s+question\b/i,
  /\baccording\s+to\s+(?:the\s+)?(?:post|author|writer|poster|speaker)\b/i,
  /\bin\s+this\s+context\b/i,  // "This video has been shared by the poster in this context..."

  // ─── RO ─────────────────────────────────────────────────────────────
  // ASCII-fold parity rule: every diacritic-bearing canonical form lists its
  // unaccented twin (and vice versa). The /i flag handles letter case, NOT
  // diacritic equivalence — a≠ă, s≠ș, t≠ț even with case-insensitive match.
  // Missing twins let the LLM slip past the validator with the canonical
  // RO form ("postări", "Persoană") OR the colloquial fold ("postari",
  // "Persoana"), depending on which side of the pair was omitted.
  // Sentence-start references to the post itself ("Această postare", "Acest mesaj"…).
  /^\s*(?:Această|Aceasta|Acest|Acel)\s+(?:postare|postări|postari|mesaj|mesaje|comentariu|comentarii|video|conținut|continut|text|fir|cont)\b/i,
  // Sentence-start references to the author/voice ("Autorul susține", "Vorbitorul…").
  // Boundary: `(?=\W|$)` instead of `\b`. JS `\b` requires a word↔non-word
  // transition; for a name ending in a diacritic like `Persoană` the last char
  // `ă` is non-word, so `\b` would NOT fire between `ă` and a following space
  // (both non-word). The lookahead works for both diacritic and ASCII forms.
  // Meta-verb proximity requirement: the noun alone is not enough — innocent
  // RO rewrites paraphrasing a quoted attack ("Autorul a făcut o greșeală")
  // were rejected before this gate. Require a meta-talk verb within ~60 chars
  // of the noun, mirroring the EN mid-text pattern shape.
  /^\s*(?:Autorul|Autoarea|Scriitorul|Postaculul|Posterul|Vorbitorul|Vorbitoarea|Utilizatorul|Utilizatoarea|Comentatorul|Persoana|Persoană|Individul)(?=\W|$)[^.!?]{0,60}(?:^|\W)(?:spune|spus|afirmă|afirma|afirmat|susține|sustine|susținut|sustinut|consideră|considera|considerat|menționează|mentioneaza|menționat|mentionat|critică|critica|criticat|atacă|ataca|atacat|defăimează|defaimeaza|defăimat|defaimat|laudă|lauda|lăudat|laudat|exprimă|exprima|exprimat|sugerează|sugereaza|sugerat|descrie|descris|pretinde|pretins|implică|implica|implicat|argumentează|argumenteaza|argumentat|transmite|transmis|comunică|comunica|comunicat|arată|arata|arătat|aratat|relevă|releva|relevat|declară|declara|declarat)(?=\W|$)/i,
  // Determiner-prefixed RO author/voice ("Acea persoană", "Acea distinsă
  // persoană"). The optional `\S+\s+` slot tolerates an adjective between
  // the determiner and the noun. `\S+` (not `\w+`) — `\w` excludes
  // diacritics like `ă` so adjectives like "distinsă" wouldn't match.
  // Same meta-verb proximity requirement as the sister pattern above.
  /^\s*(?:Această|Aceasta|Acel|Acea|Acest)\s+(?:\S+\s+)?(?:autor|autoare|scriitor|scriitoare|poster|posterul|vorbitor|vorbitoare|utilizator|utilizatoare|comentator|comentatoare|persoană|persoana|individ)(?=\W|$)[^.!?]{0,60}(?:^|\W)(?:spune|spus|afirmă|afirma|afirmat|susține|sustine|susținut|sustinut|consideră|considera|considerat|menționează|mentioneaza|menționat|mentionat|critică|critica|criticat|atacă|ataca|atacat|defăimează|defaimeaza|defăimat|defaimat|laudă|lauda|lăudat|laudat|exprimă|exprima|exprimat|sugerează|sugereaza|sugerat|descrie|descris|pretinde|pretins|implică|implica|implicat|argumentează|argumenteaza|argumentat|transmite|transmis|comunică|comunica|comunicat|arată|arata|arătat|aratat|relevă|releva|relevat|declară|declara|declarat)(?=\W|$)/i,
  // Sentence-start passive meta in RO ("Și-a exprimat frustrarea", "S-a exprimat…").
  /^\s*(?:Și-a|S-a|Si-a|Sa)\s+(?:exprimat|spus|declarat|afirmat|criticat)\b/i,
  // Sentence-start "Postat pentru a / Distribuit pentru a".
  /^\s*(?:Postat|Distribuit|Publicat)\s+pentru\s+a\s+(?:exprima|răspunde|raspunde|arăta|arata|transmite|comunica)\b/i,
  // Mid-text meta-verbs on the post itself in RO.
  /\b(?:această|aceasta|acest|acel)\s+(?:postare|postări|postari|mesaj|comentariu|video|conținut|continut|autor|autoare|scriitor|vorbitor|utilizator|individ|persoana|persoană)\s+(?:exprimă|exprima|sugerează|sugereaza|conține|contine|descrie|afirmă|afirma|susține|sustine|pretinde|implică|implica|argumentează|argumenteaza|critică|critica|transmite|comunică|comunica|spune|arată|arata|relevă|releva|menționează|mentioneaza|este\s+o\s+formă|este\s+o\s+forma)\b/i,
  // Dead-giveaway RO constructions.
  /\bpostarea\s+în\s+(?:cauză|cauza|chestiune|chestiunea)\b/i,
  /\bpostarea\s+in\s+(?:cauza|cauză|chestiune|chestiunea)\b/i,
  /\bconform\s+(?:cu\s+)?(?:postarea|postări|postari|autorul|autoarea|scriitorul|vorbitorul)\b/i,
  /\bîn\s+acest\s+context\b/i,
  /\bin\s+acest\s+context\b/i,
];

/**
 * VOICE INVERSION GUARD.
 *
 * Forensic exports surfaced rewrites that INVERT subject — the original
 * described someone ELSE ("bro rage-quit reality") and the rewrite
 * introduced "I" where the original had none. For an Evidence-MVP
 * product this is catastrophic: the reframe becomes a false admission
 * that could be misattributed to the poster in a legal export.
 *
 * Strategy: if the original post has ZERO first-person pronouns ("I", "my",
 * "me", "we", "our", "us" — case-insensitive, word-boundary) but the rewrite
 * introduces one, reject the rewrite. Cheap heuristic; false-reject rate
 * tolerable because the alternative (false admission) is worse.
 *
 * Edge case: posts that ARE first-person (e.g., "I am very frustrated")
 * legitimately keep "I" — the guard only fires when the SOURCE text was
 * third-person but the rewrite flipped to first-person. Works for EN +
 * RO. The Romanian observation: "Sunteți o mare dezamăgire" (2nd-person
 * plural attack) being rewritten to "Sunt o dezamăgire" (1st-person
 * singular admission) turned a political accusation into a self-
 * confession — exactly the false-admission class this guard rejects.
 * Pro-drop language detection requires verb-form matching beyond
 * pronouns; the supplementary sentence-initial check is gated on
 * original-2nd-person presence to avoid 3rd-plural-ambiguous
 * "Sunt mulți..." false positives.
 */
// Leading position guard: require the pronoun be preceded by start-of-string
// or a non-word-non-period character. This excludes "A.I.", "I.D.", "D.I.Y."
// whose internal "I" would otherwise match. Word-boundary `\b` alone fails
// here because `.` is non-word — `\bI\b` fires between dots.
const FIRST_PERSON_PRONOUN_RE = /(?:^|[^.\w])(?:I|I'm|I've|I'll|I'd|my|mine|me|we|we're|we've|we'll|we'd|our|ours|us)\b/i;

// RO 1st-person markers (UNAMBIGUOUS — pronouns + possessives only).
// Sentence-initial verb-only forms ("Sunt") are NOT here because "Sunt"
// also conjugates 3rd-plural ("Sunt mulți oameni" = there are many people).
// Verb-initial check is supplementary; see RO_FIRST_PERSON_VERB_INITIAL_RE.
// Unicode letter boundaries, not \b: JavaScript's \b is ASCII-only, so a pronoun that starts or
// ends in ă or ț ("noastră", "ție") never matched when the diacritics were typed.
const RO_FIRST_PERSON_PRONOUN_RE = /(?<![\p{L}\p{N}])(?:eu|mie|mine|noi|nouă|noua|nostru|noastră|noștri|noastre)(?![\p{L}\p{N}])/iu;
// The exemption for an original already in the first person keeps the ASCII \b pattern, so a typed
// "nouă" or "noastră" in an accusation ("țara noastră") does not let "we destroyed it" through.
const RO_FIRST_PERSON_IN_ORIGINAL_RE = /\b(?:eu|mie|mine|noi|nouă|noua|nostru|noastră|noștri|noastre)\b/i;

// RO 2nd-person markers (you-singular informal, you-plural, formal-you).
// Pronouns + verb conjugations. Excludes "voi" because it is ambiguous —
// can be 2nd-person-plural pronoun OR 1st-singular auxiliary "I will".
const RO_SECOND_PERSON_RE = /(?<![\p{L}\p{N}])(?:tu|tine|ție|tie|vouă|voua|vostru|voastră|sunteți|sunteti|aveți|aveti|veți|veti|vei|fii|ești|esti|fiți|fiti|dumneavoastră|dumneavoastra)(?![\p{L}\p{N}])/iu;

// Sentence-initial 1st-person verb forms. ONLY consulted when the original
// shows 2nd-person markers; without that gate, "Sunt mulți" 3rd-plural
// rewrites would falsely flag.
const RO_FIRST_PERSON_VERB_INITIAL_RE = /^\s*(?:Sunt|Am|Eram|Aș|Asi|M-am|Mi-am)\b/;

function hasFirstPersonVoice(text: string): boolean {
  return FIRST_PERSON_PRONOUN_RE.test(text);
}

function hasRoFirstPersonPronoun(text: string): boolean {
  return RO_FIRST_PERSON_PRONOUN_RE.test(text);
}

function hasRoSecondPerson(text: string): boolean {
  return RO_SECOND_PERSON_RE.test(text);
}

/**
 * Returns the first META_TALK_PATTERNS hit, or null if the rewrite is clean.
 * Exposed for tests.
 *
 * When `original` is provided, a hit only counts if the pattern matches the
 * rewrite but NOT the original — innocent originals like "this post is about
 * my friend's birthday" should not flag a paraphrased rewrite that mirrors
 * the same sentence-start framing. Mirrors the diff-against-original pattern
 * already used by detectInjectedAdvisory.
 */
export function detectMetaTalk(rewritten: string, original?: string): string | null {
  for (const re of META_TALK_PATTERNS) {
    const m = rewritten.match(re);
    if (!m) continue;
    if (original && original.match(re)) continue;
    return m[0];
  }
  return null;
}

/**
 * INJECTED-ADVISORY GUARD.
 *
 * Live testing surfaced a class of bad rewrites that escape the
 * meta-talk regex above. Example:
 *   Original: "Nice devils advocate I guess Iran is really doomed it's worse than we know"
 *   Rewrite : "Iran's situation is complex and concerning, but it's essential
 *             to rely on credible sources for accurate information."
 *
 * The rewrite doesn't begin with "This post says" / "The author argues" so
 * it slips past META_TALK_PATTERNS. But it bails on the rewrite task entirely
 * and substitutes a generic ChatGPT-coach instruction to consult sources —
 * advisory text that wasn't in the original. The post-LLM safety net for
 * this class is a regex on injected-advisory phrases (consult sources,
 * essential to verify, etc.) that fires only when the phrase appears in
 * the rewrite but NOT in the original.
 *
 * Strategy: maintain a small phrase library of "the LLM gave up and gave
 * advice" markers. Check each in the rewrite; reject if matched AND not
 * present in the original (rare for these phrases to be organic to a
 * typical scrolling post).
 */
const ADVISORY_LANGUAGE_PATTERNS: RegExp[] = [
  // ─── EN ───
  // "credible sources", "reliable sources", "trusted sources" — the most
  // common ChatGPT-coach substitute for a real rewrite.
  /\b(?:credible|reliable|trusted|verified|reputable|authoritative)\s+sources?\b/i,
  /\b(?:accurate|reliable|verified|factual|trustworthy)\s+information\b/i,
  // "It's essential / important / crucial to + (rely | consult | verify | check | seek)"
  /\b(?:it'?s|it\s+is)\s+(?:essential|important|crucial|advisable|wise|vital|necessary|critical)\s+to\s+(?:rely|consult|verify|check|seek|cross-check|fact-check)/i,
  // Direct injunctions: "Make sure to / be sure to / remember to / ensure that you ..."
  /\b(?:make\s+sure|be\s+sure|remember|ensure)\s+to\s+(?:rely|consult|verify|check|seek|cross-check|fact-check)/i,
  // "You should / must + verify / consult / rely on ..."
  /\b(?:you|we)\s+(?:should|must|need\s+to|ought\s+to)\s+(?:rely|consult|verify|check|seek|cross-check|fact-check)/i,
  // "Do your own research" — verbatim ChatGPT phrase
  /\b(?:do|please\s+do|consider\s+doing)\s+your\s+own\s+research\b/i,

  // ─── RO ───
  /\bsurse\s+(?:credibile|de\s+încredere|de\s+incredere|verificate|sigure)\b/i,
  /\binformații\s+(?:exacte|verificate|corecte|de\s+încredere|de\s+incredere)\b/i,
  /\binformatii\s+(?:exacte|verificate|corecte|de\s+încredere|de\s+incredere)\b/i,
  /\beste\s+(?:esențial|esential|important|crucial|necesar|vital)\s+s[ăa]\s+(?:te\s+bazezi|consul[țt]i|verifici)/i,
  /\b(?:asigur[ăa]-te|fii\s+sigur)\s+s[ăa]\s+(?:verifici|consul[țt]i|te\s+bazezi)/i,
];

/**
 * Returns the first ADVISORY_LANGUAGE_PATTERNS hit that appears in the rewrite
 * but NOT in the original, or null if the rewrite is clean. The "not in
 * original" check is the load-bearing part — a post that legitimately talks
 * about credible sources should pass through unchanged. Only LLM-injected
 * advisory text is caught.
 */
export function detectInjectedAdvisory(original: string, rewritten: string): string | null {
  for (const re of ADVISORY_LANGUAGE_PATTERNS) {
    const rewriteHit = rewritten.match(re);
    if (!rewriteHit) continue;
    if (re.test(original)) continue; // phrase was already in original — not injected
    return rewriteHit[0];
  }
  return null;
}

/**
 * LENGTH-RATIO GUARD.
 *
 * Catches rewrites that expand the original because the LLM substituted
 * advisory / commentary / therapy text for a real rewrite. The prompt's
 * conciseness rule ("Keep it concise but don't artificially compress")
 * is advisory; this is the code-side enforcement.
 *
 * Two-tier gate, either condition trips:
 *   • TIER A — substantive rewrite blowup. Original ≥20 chars, rewrite
 *     >50 chars, ratio >1.7×. Catches the "added editorial commentary"
 *     class on medium-length originals (e.g. 31c "overwolf app is a
 *     virus anyways" → 78c rewrite at 2.5× appending an "exaggeration"
 *     verdict; 51c "Meet the legend" → 89c rewrite injecting "known
 *     for his violent behavior").
 *   • TIER B — extreme blowup belt. Rewrite >100 chars AND ratio >2.0×.
 *     Looser gate retained for ALL-CAPS-only originals where natural
 *     expansion is legitimate ("ACT NOW!" → "Take political action
 *     quickly.").
 *
 * Originals shorter than 20c are exempt from  — pure-translation
 * cases ("Source" → "Sunt de acord că ...") legitimately expand 5-8×
 * and the gate would over-reject. Under-20c short originals are out of
 * scope for the length-ratio validator; voice-inversion + injected-
 * advisory + meta-talk validators run independently.
 */
export function detectLengthRatioBlowup(original: string, rewritten: string): boolean {
  return detectLengthRatioBlowupTier(original, rewritten) !== null;
}

/**
 * Variant that returns WHICH tier fired (for accurate diagnostic logging),
 * or `null` if neither tier trips. The 2026-05-23 audit caught that the
 * console.debug at the call site hardcoded "> 2.0 (over 100 chars)" but
 * the actual tier might be TIER A (>1.7, no 100c requirement). This
 * variant lets the caller emit a correct message.
 *
 * TIER A softened 2026-05-23 audit B2: now requires `original.length > 80`
 * (was `>= 20`). Short adversarial tweets (50-char ALL-CAPS attacks) need
 * expansion room for first-person defusion — TIER A was over-rejecting
 * them. TIER B (>100c AND >2.0×) stays as the extreme-blowup belt.
 */
function detectLengthRatioBlowupTier(
  original: string,
  rewritten: string,
): 'A' | 'B' | null {
  const ratio = rewritten.length / Math.max(original.length, 1);
  if (original.length > 80 && rewritten.length > 50 && ratio > 1.7) return 'A';
  if (rewritten.length > 100 && ratio > 2.0) return 'B';
  return null;
}

/**
 * Returns true when the rewrite is a CATASTROPHIC false self-admission —
 * the original attacked the target with a predicate ("you are X" / "you're X"),
 * and the rewrite preserved that predicate but swapped the subject to the
 * speaker ("I am X" / "I'm X"). The original asserts X about the target;
 * the rewrite asserts X about the speaker. This is the failure mode that
 * matters for forensic admissibility — the rewrite is no longer a defused
 * own-view, it's a literal admission of the trait the original was attacking.
 *
 * Replaces the old `detectVoiceInversion` per the 2026-05-15 first-person
 * reframe contract. The new contract MANDATES first-person voice — so the
 * old "no first-person in rewrite if not in original" check would reject
 * every successful rewrite. This narrower check catches only the
 * subject-predicate-swap failure mode without false-rejecting legitimate
 * first-person defusions.
 *
 * Examples:
 *   • CATCHES: "You're stupid" → "I'm stupid" (subject swap, predicate match)
 *   • CATCHES: "You're a disgrace" → "I'm a disgrace"
 *   • ALLOWS:  "You're stupid" → "I don't trust your judgment" (no I-am pattern)
 *   • ALLOWS:  "You're a liar" → "I doubt your honesty" (no predicate match)
 *
 * See `docs/research/REFRAME_CONTRACT.md` for the full contract.
 */
/**
 * Stance-phrase prefixes that mark a legitimate first-person own-view rewrite
 * (the speaker expressing a view ABOUT the target/topic), NOT a false self-
 * admission (the speaker becoming the target of the original's claim).
 *
 * Examples ALLOWED by this regex:
 *   • "I don't trust your reasoning"
 *   • "I think this is wrong"
 *   • "I doubt your honesty here"
 *   • "I'm worried about the direction"
 *   • "I find this concerning"
 *
 * Examples NOT MATCHED (and therefore reaching the agent-swap reject branch):
 *   • "I raged out in reality" — verb-action mirror
 *   • "I slapped the opponent" — action mirror
 *   • "I'm stupid" — insult predicate (handled by Path A separately)
 */
const STANCE_PHRASE_PREFIX_RE =
  /^I(?:\s+(?:don'?t|do\s+not|can'?t|cannot|won'?t|will\s+not|wouldn'?t|would\s+not|shouldn'?t|should\s+not|haven'?t|have\s+not|hadn'?t|had\s+not|think|thought|believe|believed|see|saw|notice|noticed|observe|observed|find|found|doubt|doubted|fear|feared|hope|hoped|wish|wished|want|wanted|prefer|preferred|agree|agreed|disagree|disagreed|support|supported|oppose|opposed|question|questioned|suspect|suspected|wonder|wondered|suppose|supposed|assume|assumed|expect|expected|recommend|recommended|suggest|suggested|propose|proposed|view|viewed|consider|considered|feel|felt|trust|trusted|distrust|distrusted|take|took|have|had)\b|'m(?:\s+(?:not\b|worried|concerned|skeptical|hesitant|uncertain|sure|certain|hoping|thinking|seeing|looking|going|saying|trying|telling|asking|wondering|curious|surprised|disappointed|aware|familiar|bothered|troubled|disturbed|impressed|unimpressed|convinced|unconvinced|frustrated|annoyed|happy|sad|tired|hesitant|reluctant|inclined))?)/i;

// Leading discourse-marker adverbs that legitimately precede a first-person
// stance phrase ("Honestly, I disagree" / "Personally, I don't think..."). The
// Path-B guard strips this prefix before testing STANCE_PHRASE_PREFIX_RE so a
// valid own-view defusion opening with one isn't mistaken for a false
// agent-action admission (D-6). Only the marker is stripped — the admission
// test still runs on the real clause, so "Honestly, I slapped him" still
// rejects.
const LEADING_DISCOURSE_MARKER_RE =
  /^(?:honestly|frankly|personally|truthfully|realistically|to\s+be\s+honest|in\s+my\s+(?:view|opinion)|imo|tbh)\s*,?\s+/i;

/**
 * Predicates that are legitimate first-person stance verbs/adjectives after
 * "I'm" or "I am" — these should NOT trigger Path A predicate-swap rejection
 * even if they happen to overlap with original text.
 */
const STANCE_PREDICATE_ALLOWLIST_RE =
  /^(worried|concerned|skeptical|hesitant|uncertain|sure|certain|hoping|thinking|seeing|looking|going|saying|trying|telling|asking|wondering|curious|surprised|disappointed|aware|familiar|bothered|troubled|disturbed|impressed|unimpressed|convinced|unconvinced|frustrated|annoyed|happy|sad|tired|reluctant|inclined|not\s)/i;

/**
 * Returns true when the rewrite is a CATASTROPHIC false self-admission —
 * the rewrite makes the speaker the subject of a claim/action the original
 * applied to the target. Two failure modes are detected:
 *
 *   Path A (predicate swap):  "You're X" → "I'm X" — subject swapped, predicate
 *                              preserved. The rewrite literally admits the trait
 *                              the original attacked. Caught by predicate match.
 *
 *   Path B (agent-action swap): "He V'd Y" → "I V'd Y" — third-person actor in
 *                                original becomes first-person speaker in rewrite.
 *                                The rewrite falsely admits the action. Caught by
 *                                first-person introduction WITHOUT a stance-phrase
 *                                prefix that would mark legitimate own-view.
 *
 * Replaces the old `detectVoiceInversion` per the 2026-05-15 first-person
 * reframe contract (`docs/research/REFRAME_CONTRACT.md`). The new contract
 * MANDATES first-person voice for legitimate defusions ("I don't trust your
 * judgment", "I find this concerning"). The validator distinguishes those
 * from the catastrophic agent-action / predicate-swap failure modes via the
 * stance-phrase allowlist.
 *
 * Examples:
 *   • CATCHES (Path A): "You're stupid" → "I'm stupid"
 *   • CATCHES (Path A): "You're a disgrace" → "I'm a disgrace"
 *   • CATCHES (Path B): "bro rage-quit reality" → "I raged out in reality"
 *   • CATCHES (Path B): "he slapped the opponent" → "I slapped the opponent"
 *   • ALLOWS:  "You're stupid" → "I don't trust your judgment"
 *   • ALLOWS:  "You're a liar" → "I doubt your honesty"
 *   • ALLOWS:  "He's wrong" → "I disagree with him"
 *   • ALLOWS:  "This is the END" → "I'm worried about the direction"
 */
export function detectFalseSelfAdmission(original: string, rewritten: string): boolean {
  return detectFalseSelfAdmissionPath(original, rewritten) !== null;
}

/**
 * Variant that returns WHICH path tripped ('A' | 'B' | 'RO'), or `null`
 * if the rewrite passes. Distinguishing Path A (subject-predicate swap —
 * catastrophic, well-calibrated) from Path B (agent-action swap with
 * stance-allowlist gate — historically over-strict per 2026-05-23 audit)
 * lets diagnostic logging surface live-walk evidence about which path
 * actually fires in production.
 */
export function detectFalseSelfAdmissionPath(
  original: string,
  rewritten: string,
): 'A' | 'B' | 'RO' | null {
  // Path A — predicate swap. If rewrite has "I'm X" / "I am X" where X
  // matches a predicate the original applied to "you" → reject.
  const selfMatch = rewritten.match(/\bI(?:'m|\s+am)\s+(?:a\s+|an\s+|the\s+)?([a-z]+(?:\s+[a-z]+){0,2})\b/i);
  if (selfMatch) {
    const selfPredicate = selfMatch[1].toLowerCase().trim();
    if (selfPredicate.length >= 4 && !STANCE_PREDICATE_ALLOWLIST_RE.test(selfPredicate)) {
      const escapedPredicate = selfPredicate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const youPredicateRe = new RegExp(
        `\\byou(?:'re|\\s+are)\\s+(?:a\\s+|an\\s+|the\\s+)?${escapedPredicate}\\b`,
        'i',
      );
      if (youPredicateRe.test(original)) return 'A';
    }
  }

  // Path B — agent-action swap. If original had no first-person AND
  // rewrite has first-person AND rewrite does NOT start with a recognized
  // stance phrase, suspect that the rewrite mirrors the original's action
  // with the wrong subject.
  if (!hasFirstPersonVoice(original) && hasFirstPersonVoice(rewritten)) {
    const stripped = rewritten.trim().replace(LEADING_DISCOURSE_MARKER_RE, '');
    if (!STANCE_PHRASE_PREFIX_RE.test(stripped)) return 'B';
  }

  // Romanian drops the subject pronoun, so a 2nd-person original rewritten with a 1st-person
  // pronoun or opening verb is caught here: it would turn an accusation into a self-confession.
  const origRoSecond = hasRoSecondPerson(original);
  if (origRoSecond) {
    const origRoFirst = RO_FIRST_PERSON_IN_ORIGINAL_RE.test(original);
    if (!origRoFirst) {
      if (hasRoFirstPersonPronoun(rewritten)) return 'RO';
      const rewVerbInitial = RO_FIRST_PERSON_VERB_INITIAL_RE.test(rewritten);
      const origVerbInitial = RO_FIRST_PERSON_VERB_INITIAL_RE.test(original);
      if (rewVerbInitial && !origVerbInitial) return 'RO';
    }
  }

  return null;
}

/**
 * REGISTER-FIDELITY GUARD.
 *
 * Catches the undershoot direction the other 4 validators miss: a rewrite
 * that preserves meaning but flattens emotional register to clinical-mute.
 * Symptom on FW screenshots: hostile original → rewrite reads like an after-
 * school-special, and a rewrite in that voice loses the credibility it
 * needs with the reader.
 *
 * Heuristic: the original carries register markers (sustained ALL-CAPS,
 * doubled punctuation, intensifier words) AND the rewrite has none — and
 * the rewrite is long enough (≥80 chars) that flatness is a deliberate
 * choice, not a side-effect of brevity. When both hold, reject so the
 * caller's empty-string fallback fires (marker stays YELLOW-state with
 * the F-1-corrected fallback string instead of shipping a flat rewrite).
 *
 * Symmetric to detectVoiceInversion: compares original vs rewrite for a
 * surface property, no semantic-content judgment.
 * `feedback_dont_trust_code_until_understood.md` — surface signals the
 * model can over-correct on; deeper paraphrase-quality measurement
 * is later work.
 */
// Three disjoint marker classes. Split deliberately: the ALL-CAPS class
// MUST stay case-sensitive, but the original single-regex used a global
// `/i` flag (so `\b[A-Z]{3,}\b` matched any 3+ letter word) which made
// the function effectively dead in production — every rewrite with
// normal words had `rewrittenHasRegister=true` so the
// `originalHasRegister && !rewrittenHasRegister` gate never fired.
// Bug surfaced by the umbrella validator wire-up (2026-05-22).
const REGISTER_MARKER_ALLCAPS_RE = /\b[A-Z]{3,}\b/;
const REGISTER_MARKER_DOUBLE_PUNCT_RE = /[!?]{2,}/;
const REGISTER_MARKER_INTENSIFIER_RE = /\b(really|actually|completely|literally|absolutely|honestly|seriously|extremely|totally|deeply|incredibly)\b/i;
const REGISTER_PROSE_FLAT_THRESHOLD = 80;

function hasRegisterMarkers(text: string): boolean {
  return (
    REGISTER_MARKER_ALLCAPS_RE.test(text)
    || REGISTER_MARKER_DOUBLE_PUNCT_RE.test(text)
    || REGISTER_MARKER_INTENSIFIER_RE.test(text)
  );
}

export function detectRegisterFlattening(original: string, rewritten: string): boolean {
  if (rewritten.length < REGISTER_PROSE_FLAT_THRESHOLD) return false;
  // Only intensifier WORDS count as register a faithful-but-calmer rewrite
  // should carry. ALL-CAPS and "!!!" are SHOUTING — neutralization strips them
  // by design, so a calm rewrite of a shouting original is a SUCCESS, not the
  // clinical-mute flattening this guard targets (D-8). The rewrite side still
  // counts any marker (caps/punct/intensifier) as "not flat".
  const originalHasRegister = REGISTER_MARKER_INTENSIFIER_RE.test(original);
  const rewrittenHasRegister = hasRegisterMarkers(rewritten);
  return originalHasRegister && !rewrittenHasRegister;
}

/**
 * Cross-comment duplicate-rewrite guard. The BATCH model can register-flatten
 * DISTINCT comments into ONE identical bland phrase (e.g. "I think this
 * conversation is toxic" emitted for three different toxic comments — see
 * content/index.ts:52). The per-comment `validateRewrite` stack cannot see
 * this: it judges one rewrite at a time. Given all of a batch's rewrites +
 * their originals, returns the indices whose rewrite is shared by ≥2 comments
 * with DIFFERENT original text. The caller blanks those rewrites ('') so they
 * fall through to the HIDE / mark-only path instead of shipping a generic
 * sentence that represents none of the comments.
 *
 * Same rewrite for the SAME (repeated) comment is legitimate and is NOT
 * flagged. Empty rewrites are ignored. Normalization is case- + whitespace-
 * insensitive so trivial spacing differences don't defeat the match.
 */
export function findDuplicateRewriteIndices(
  rewrites: ReadonlyArray<string>,
  originals: ReadonlyArray<string>,
): Set<number> {
  const norm = (s: string): string => (s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
  const byRewrite = new Map<string, number[]>();
  for (let i = 0; i < rewrites.length; i++) {
    const key = norm(rewrites[i]);
    if (!key) continue;
    const arr = byRewrite.get(key);
    if (arr) arr.push(i);
    else byRewrite.set(key, [i]);
  }
  const reject = new Set<number>();
  for (const indices of byRewrite.values()) {
    if (indices.length < 2) continue;
    const distinctOriginals = new Set(indices.map((i) => norm(originals[i])));
    if (distinctOriginals.size < 2) continue; // same comment repeated → legitimate
    for (const i of indices) reject.add(i);
  }
  return reject;
}

/**
 * Defensive strip. The TikTok bundle formatter packs caption + top-N
 * comments into a single `PostContent.text` with a marker:
 *   "@author: <caption>\n\n— Top reactions (context only; judge the post above) —\n• @viewer: text\n…"
 * The NEUTRALIZATION_SYSTEM prompt now instructs the LLM to rewrite ONLY the
 * caption above the marker. When the LLM slips and emits its rewrite
 * INCLUDING the scaffolding, this helper strips everything from the first
 * marker-line onward — the user should never see "— Top reactions —" or
 * "• @viewer: ..." inside the teen panel's analysis pane.
 *
 * Markers:
 *   • "— Top reactions" (EN, from the formatter)
 *   • "— Reacții" (RO, reserved for future RO-localized bundle formatter)
 *
 * Case-insensitive. Also trims trailing whitespace the strip leaves behind.
 */
export function stripBundleScaffolding(text: string): string {
  // Dash alternation covers: `—` (em-dash used by the formatter),
  // `–` (en-dash), `-{2,}` (hyphen runs from LLM mis-rendering).
  const DASH = '(?:[—–]+|-{2,})';
  const markers = [
    new RegExp(`\\n\\s*${DASH}\\s*Top reactions[^\\n]*`, 'i'),
    new RegExp(`\\n\\s*${DASH}\\s*Reacții[^\\n]*`, 'i'),
    new RegExp(`\\n\\s*${DASH}\\s*Top\\b[^\\n]*`, 'i'), // looser fallback
  ];
  let stripped = text;
  for (const re of markers) {
    const m = stripped.match(re);
    if (m && m.index !== undefined) {
      stripped = stripped.slice(0, m.index);
      break;
    }
  }
  return stripped.trim();
}

function validateNeutralization(original: string, rewritten: string): boolean {
  // Minimum length check
  if (rewritten.length < 5) {
    console.debug('[FeelingWise] Neutralization rejected: rewrite shorter than 5 characters');
    void recordNeutralizerEvent('rewrite-too-short');
    return false;
  }

  // No length ratio check — manipulative posts use dense shorthand (ALL CAPS,
  // abbreviations, no attribution) that legitimately expands when rewritten
  // neutrally. The AI prompt already instructs conciseness.

  // Meta-talk guard — catches "This post says / The author argues /
  // Expressed frustration" openings that the NEUTRALIZATION prompt
  // already forbids but the LLM emits anyway (~20% rate in live data).
  //
  // Log level: console.debug. These are routine protection outcomes
  // (LLM violated an output rule, validator rejected, pipeline PASSed
  // correctly) — not user-visible errors. Chrome's extension Errors
  // panel surfaces console.warn / console.error / uncaught errors;
  // console.debug stays in the developer DevTools console for
  // troubleshooting without polluting the user-facing Errors tab.
  // Diagnostic counter `meta-talk-leak` still fires at full severity
  // for rate-aggregation in the diagnostics store.
  const metaHit = detectMetaTalk(rewritten, original);
  if (metaHit) {
    console.debug('[FeelingWise] Neutralization rejected: meta-talk leak detected —', metaHit);
    void recordNeutralizerEvent('meta-talk-leak');
    return false;
  }

  // False-self-admission guard — catches rewrites where the subject was
  // swapped from target ("you're X") to speaker ("I'm X") while preserving
  // the predicate. Critical for forensic integrity: the rewrite must not
  // become a literal admission of the trait the original attacked.
  // (Replaces the old voice-inversion check per the 2026-05-15 first-person
  // reframe contract — see docs/research/REFRAME_CONTRACT.md.)
  const falseSelfPath = detectFalseSelfAdmissionPath(original, rewritten);
  if (falseSelfPath !== null) {
    const pathLabel = falseSelfPath === 'A'
      ? 'subject swap, predicate preserved'
      : falseSelfPath === 'B'
        ? 'agent-action swap (rewrite introduced first-person without a stance prefix)'
        : 'RO subject mirror';
    console.debug(`[FeelingWise] Neutralization rejected: false self-admission Path ${falseSelfPath} — ${pathLabel}`);
    void recordNeutralizerEvent('voice-inversion');
    return false;
  }

  // INJECTED-ADVISORY GUARD. Catches rewrites where the LLM substituted
  // a generic "rely on credible sources / consult experts" recommendation
  // for a real rewrite. Live observation: original "Iran is doomed" →
  // rewrite "rely on credible sources for accurate information". Cheap
  // regex, high-precision because the trigger phrases are rare in
  // organic posts.
  const advisoryHit = detectInjectedAdvisory(original, rewritten);
  if (advisoryHit) {
    console.debug('[FeelingWise] Neutralization rejected: injected advisory —', advisoryHit);
    void recordNeutralizerEvent('injected-advisory');
    return false;
  }

  // LENGTH-RATIO GUARD. Two-tier:
  //   TIER A — original.length>80 AND rewrite>50c AND ratio>1.7×
  //            (substantive bloat on medium-length originals)
  //   TIER B — rewrite>100c AND ratio>2.0×
  //            (extreme-blowup belt; catches ALL-CAPS-only originals)
  // 2026-05-23 audit B2 softened TIER A's lower bound from `>= 20` to
  // `> 80` so short adversarial tweets pass through.
  const lengthTier = detectLengthRatioBlowupTier(original, rewritten);
  if (lengthTier !== null) {
    const ratio = (rewritten.length / Math.max(original.length, 1)).toFixed(2);
    const threshold = lengthTier === 'A' ? '> 1.7 (TIER A, original > 80c)' : '> 2.0 (TIER B, over 100 chars)';
    console.debug(`[FeelingWise] Neutralization rejected: length ratio ${ratio} ${threshold}`);
    void recordNeutralizerEvent('length-ratio-exceeded');
    return false;
  }

  // Register-fidelity guard — reject rewrites that flatten an emotionally-
  // emphasized original to clinical-mute prose. Falls back to the empty-
  // string graceful path so the marker stays YELLOW-state on the original.
  if (detectRegisterFlattening(original, rewritten)) {
    console.debug('[FeelingWise] Neutralization rejected: register flattened — original had emphasis markers, rewrite did not');
    void recordNeutralizerEvent('register-flattened');
    return false;
  }

  // Check for meta-commentary (AI breaking character)
  for (const pattern of FORBIDDEN_META_PATTERNS) {
    if (pattern.test(rewritten)) {
      console.debug('[FeelingWise] Neutralization rejected: meta-commentary -', pattern.source);
      void recordNeutralizerEvent('meta-commentary');
      return false;
    }
  }

  const unsafeVisible = detectUnsafeVisibleLanguage(rewritten);
  if (unsafeVisible) {
    console.debug('[FeelingWise] Neutralization rejected: unsafe visible language -', unsafeVisible);
    void recordNeutralizerEvent('unsafe-visible-language');
    return false;
  }

  // A rewrite that drops every word of a lethal threat reads as a calm opinion and passes every
  // check above; the comment path already refuses it with the same guard.
  if (detectHarmLaundering(original, rewritten)) {
    console.debug('[FeelingWise] Neutralization rejected: the rewrite dropped the lethal language of the original');
    void recordNeutralizerEvent('harm-laundered');
    return false;
  }

  return true;
}

interface CombinedResponse {
  techniques: Array<{
    name: string;
    verdict: string;
    severity: number;
    reason: string;
  }>;
  /**
   * Single dominant technique chosen by the model. Optional / nullable:
   * legacy callers and older LLM responses may omit it. Downstream code
   * falls back to the highest-severity confirmed technique when this is
   * missing.
   */
  primaryTechnique?: string | null;
  /**
   * 1-2 sentence post-grounded explanation. Optional / nullable for the
   * same legacy reason. The teen panel renders this verbatim as the
   * "Why" line; falls back to the technique reason field when missing.
   */
  explanation?: string | null;
  /**
   * Model-chosen action label. 'rewrite' | 'collapse' | 'hide'. Optional
   * / nullable for cache-hit and legacy responses. The downstream
   * injector treats absence as 'rewrite' (matching legacy behavior). See
   * AnalysisResult.action docblock for semantics.
   */
  action?: 'rewrite' | 'collapse' | 'hide' | null;
  overallManipulative: boolean;
  overallConfidence: number;
  neutralizedText: string | null;
}

function stripMarkdownFences(text: string): string {
  return text.replace(/^```(?:json)?\s*/m, '').replace(/```\s*$/m, '').trim();
}

/**
 * Output shape of the JUDGE_DETECT_NEUTRALIZE prompt. The judge prompt
 * emits 5 fields; everything downstream is built for the legacy
 * 11-field `CombinedResponse`. `judgeToCombinedShape` translates.
 */
interface JudgeOutput {
  concerning?: boolean;
  acts_on_reader?: boolean;
  primary_concern?: string | null;
  severity?: number;
  confidence?: number;
  uncertainty_reason?: string | null;
  should_rewrite?: boolean;
  neutralized_text?: string | null;
}

/**
 * Map the judge prompt's free-text `primary_concern` to a canonical
 * `TechniqueName` from the 14-element enum.
 *
 * The judge prompt emits descriptions like "Identity Pressure and
 * Information Distortion: Scapegoating and conspiracy framing" rather
 * than a single canonical label. This deterministic keyword classifier
 * maps the description onto the technique enum that the downstream UI,
 * forensic record, and per-technique severity-floor matrix all key off.
 *
 * Ordered by specificity: more specific patterns first so a body-image
 * concern doesn't get caught by the generic "identity" matcher.
 *
 * Fallback is `combined`, which the downstream per-technique floor
 * matrix maps to a moderate floor (6 child / 6 teen). Same as the
 * legacy COMBINED prompt's behavior when the model emitted "combined"
 * as primary.
 */
function mapConcernToTechnique(concern: string | null | undefined): TechniqueName {
  if (!concern) return 'combined';
  const c = concern.toLowerCase();
  // Direct-harm categories first: they carry their own (lower) floors and
  // must not be absorbed by the manipulation-technique patterns below
  // (a self-harm concern often also mentions "shame" or "fear").
  if (/self[- ]?harm|suicid|cutting|"kill (him|her|them|your)self"|eating disorder|anorexi|bulimi|pro[- ]?ana|pro[- ]?mia/.test(c)) return 'self-harm';
  if (/sexual|sexualis|sexualiz|pornograph|explicit nud|grooming|solicit\w* (a )?minor|\bnsfw\b/.test(c)) return 'sexual';
  if (/graphic violence|violence[- ]graphic|gore|\bbeheading|mutilat|"graphic injur"|snuff|"real (death|killing)"/.test(c)) return 'violence-graphic';
  if (/drug[- ]?promot|glorif\w* drug|"drug use"|vaping|\bvape\b|nicotine|"get high"|\bweed\b|\bcannabis\b|\bmeth\b|\bxanax\b|\bfentanyl\b/.test(c)) return 'drug-promotion';
  if (/unsafe[- ]health|"health experiment"|dangerous challenge|"blackout challenge"|"benadryl challenge"|"extreme fast"|"water fast"|"dry scoop"|"tide pod"/.test(c)) return 'unsafe-health-experiment';
  if (/body[- ]?(compar|image|weight|priming)|skinny|thinspo|legging|calorie|"girl dinner"/.test(c)) return 'body-comparison-priming';
  if (/parasocial|"only real ones"|subscribe.*love|save me from the algorithm|"if you love(d)? me"/.test(c)) return 'parasocial-coercion';
  if (/casino|crypto pyramid|gambl|"free spin"|dropshipper|"fake countdown"|consumer.?rapid|"run.don.t.walk"|"tiktokmademebuyit"/.test(c)) return 'consumer-rapid-frame';
  if (/hyperreal|ai[- ]generat\w* drama|fruitcourt|aijudge|aicinema|"synthetic cinema"/.test(c)) return 'hyperreal-trauma-bait';
  if (/scapegoat\w*|antisemit|anti-semit|"jewish people"|"chinese people"|"black people"|"all \w+ are"|group attribution|"named.*group"|ethnic stereotype/.test(c)) return 'scapegoating';
  if (/dehumaniz|vermin|"rats? "|cockroach|reduc\w* humans/.test(c)) return 'scapegoating';
  if (/shame|disgrace|personal attack|private individual|pile.?on|"public shaming"|"attack.*named"|name.cal|insult.*individual/.test(c)) return 'shame-attack';
  if (/false.?urgency|"artificial deadline"|"act now"|"expir"|"limited time"|"share before deleted"/.test(c)) return 'false-urgency';
  if (/fear|catastroph|threat|panic|alarm|"act now or"|"share before"|"never forgive"/.test(c)) return 'fear-appeal';
  if (/fomo|"miss out"|exclusiv|"only \w+ get"|"only \d"/.test(c)) return 'fomo';
  if (/clickbait|conspiracy|misleading|"information distortion"|distort|propaganda|sensational\w*|"false[- ]binary"/.test(c)) return 'misleading-format';
  if (/anger|outrage|"provoke.*anger"|"engagement bait"|hot[- ]take|"outrage[- ]bait"/.test(c)) return 'anger-trigger';
  if (/toxic[- ]positiv|"forced optim"|"keep your chin"|"invalidat\w* distress"/.test(c)) return 'toxic-positivity';
  if (/bandwagon|"everyone (is|knows|agrees)"|"manufactured consensus"|"manufactured majority"/.test(c)) return 'bandwagon';
  return 'combined';
}

/**
 * Translate the judge prompt's 5-field response into the 11-field
 * `CombinedResponse` shape that the downstream pipeline (severity-floor
 * gating, technique mapping, action handling, neutralizedText validation)
 * was built for.
 *
 * Severity-flow:
 *   • concerning=false → empty techniques, isManipulative=false (benign).
 *   • concerning=true + should_rewrite=true → action='rewrite' + the
 *     rewrite text passes through downstream validators / emoji-strip /
 *     short-rewrite drop.
 *   • concerning=true + should_rewrite=false → action='hide' which the
 *     existing always-rewrite architecture downgrades to undefined, then
 *     the rewrite branch is skipped because neutralizedText is null.
 *     Marker still fires (isManipulative=true) — no rewrite produced.
 *
 * Shape detection: if the parsed response already has a `techniques`
 * array, it's already in the combined shape (legacy test mocks or
 * other-prompt responses) — pass through unchanged. Otherwise translate
 * from judge shape.
 */
function judgeToCombinedShape(raw: unknown): CombinedResponse {
  const obj = (raw ?? {}) as Record<string, unknown>;
  // Legacy / test-mock pass-through: if the response is already in
  // CombinedResponse shape (techniques array present), don't re-translate.
  if (Array.isArray(obj.techniques)) {
    return obj as unknown as CombinedResponse;
  }
  const judge = obj as JudgeOutput;
  let concerning = judge.concerning === true;
  const severity = typeof judge.severity === 'number' ? judge.severity : 5;
  // acts_on_reader gate (2026-06-10) — RULE 1 ("read what the post DOES TO
  // THE READER") as a schema slot. The prose rule is measured-ignored by small models:
  // 32/44 posts-path interventions on the real-feed corpus were reports /
  // opinions / jokes / education about ugly topics, not content acting on
  // the reader. Same pattern as the comments-path target_present gate: the
  // model fills a required boolean, CODE applies the rule. Severity 8+ acts
  // regardless (graphic/extreme content). Missing / non-boolean field keeps
  // the verdict unchanged (fail-open). Deterministic floors (slur /
  // profanity / dehumanization / harm-floor) run pre-LLM in pipeline.ts and
  // are upstream of this gate.
  if (concerning && judge.acts_on_reader === false && severity <= 7) {
    console.debug('[FeelingWise] judge acts_on_reader gate: non-acting concerning verdict downgraded to pass');
    concerning = false;
  }
  const primaryConcern = typeof judge.primary_concern === 'string' ? judge.primary_concern : null;
  const technique = concerning ? mapConcernToTechnique(primaryConcern) : null;
  return {
    overallManipulative: concerning,
    overallConfidence: concerning
      ? (typeof judge.confidence === 'number' && judge.confidence >= 0 && judge.confidence <= 1
        ? judge.confidence : 0.5)
      : 0,
    techniques: concerning && technique
      ? [{ name: technique, verdict: 'CONFIRMED', severity, reason: primaryConcern ?? '' }]
      : [],
    primaryTechnique: technique,
    explanation: primaryConcern,
    action: concerning ? (judge.should_rewrite === true ? 'rewrite' : 'hide') : null,
    neutralizedText: concerning && judge.should_rewrite === true && typeof judge.neutralized_text === 'string'
      ? judge.neutralized_text
      : null,
  };
}

function extractCombinedJSON(raw: string): CombinedResponse | null {
  const cleaned = stripMarkdownFences(raw);

  try {
    return JSON.parse(cleaned);
  } catch { /* continue */ }

  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]);
    } catch { /* continue */ }
  }

  // Fix single quotes
  try {
    const fixed = cleaned
      .replace(/(\{|\[|,)\s*'/g, '$1"')
      .replace(/'\s*(:|\}|\]|,)/g, '"$1');
    return JSON.parse(fixed);
  } catch {
    return null;
  }
}

/**
 * Two-stage cascade options for the `combinedDetectAndNeutralize` entry
 * point. Default behavior unchanged when caller passes no options —
 * single-stage path runs as before.
 */
export interface CombinedDetectOptions {
  /**
   * Enable the two-stage cascade: a small triage call (yes/unsure/no) runs
   * FIRST; on `no` the function short-circuits to a benign result without
   * the full COMBINED prompt. On yes/unsure/parse_fail, falls through to
   * the existing path. Empirically (8B-era): precision 8.3% → 17.9%, 100% recall,
   * 61% short-circuit rate. Default false for backward compatibility.
   */
  twoStageCascade?: boolean;
  /**
   * Optional AbortSignal that bubbles through to the AI client. When the
   * upstream queue cancels (cancel-on-stale), the in-flight triage and/or
   * classify call returns empty-string and `combinedDetectAndNeutralize`
   * resolves to null (caller treats as PASS).
   */
  signal?: AbortSignal;
  /**
   * Q2/W44 "detect always, rewrite on purpose" (spec: ai-pipeline.md).
   * When false, the classify stage uses the DETECT-ONLY judge prompt:
   * identical detection contract and JSON shape, but the model is told to
   * always return neutralized_text=null (should_rewrite stays honest — it
   * still carries the too-hostile-to-defuse signal that maps to 'hide').
   * Confirmed flags then fold to the caller's rewrite-unavailable floor.
   * Default true: full detect+neutralize, unchanged.
   */
  rewriteEnabled?: boolean;
  /** The post's platform, shown to the adult judge as the measurement showed it. */
  platform?: string;
  /** 'post' (default), 'comment', 'video', 'image': the item kind the adult judge is told. */
  kind?: string;
  /** For a comment, the post it replies to (context only). Undefined for a post. */
  parentText?: string;
  /** Force the legacy parent-frame judge in adult mode. Tests and the harness only. */
  legacyJudge?: boolean;
  /**
   * The rewrite-only path the adult judge calls for a fired item below the
   * hide line (pipeline.ts passes neutralizeText). Injected rather than
   * imported so this module adds no ai-layer import (ARCHITECTURE-1). Absent:
   * the marker fires with no rewrite.
   */
  rewrite?: (input: { text: string; technique: string; signal?: AbortSignal }) => Promise<string>;
  /**
   * The paid reading's Claude reader (src/ai/claude-reader.ts), asked only where the first judge
   * fired and the second did not agree. Injected by pipeline.ts only while that reading is on, the
   * way `rewrite` is; absent, the pair's rule is unchanged.
   */
  claudeReader?: (input: { text: string; platform?: string; kind?: string; parentText?: string; signal?: AbortSignal }) =>
    Promise<NonNullable<NonNullable<AnalysisResult['judge']>['claude']>>;
}

/** The technique each JUDGE-V1 family lands on downstream (labels, record, actions). */
export const JUDGE_V1_FAMILY_TECHNIQUE: Record<JudgeV1Family, TechniqueName> = {
  hostile: 'anger-trigger',
  threat: 'fear-appeal',
  commercial: 'consumer-rapid-frame',
  body: 'body-comparison-priming',
  profanity: 'profanity',
  none: 'combined',
};

/**
 * The one place the measured question is asked. Both callers (the automatic
 * adult path below and the on-demand reading, `readWithJudgeV1`) go through
 * here, so the prompt, model, schema, token cap and message shape cannot
 * drift between them. Null when the call failed or the reply was not the
 * five-field shape.
 */
async function askJudgeV1(
  text: string,
  locale: 'en' | 'ro',
  options: Pick<CombinedDetectOptions, 'platform' | 'kind' | 'parentText' | 'signal'> | undefined,
  model: string = JUDGE_V1_MODEL,
): Promise<JudgeV1Verdict | null> {
  const userPrompt = buildJudgeV1UserPrompt({
    text,
    platform: options?.platform,
    kind: options?.kind ?? 'post',
    parentText: options?.parentText,
  });
  const raw = unwrapOrEmpty(await callAI(JUDGE_V1_ADULT_SYSTEM, userPrompt, true, {
    jsonMode: true,
    jsonSchema: JUDGE_V1_SCHEMA as unknown as { name: string; schema: Record<string, unknown> },
    model,
    maxTokens: JUDGE_V1_MAX_TOKENS,
    signal: options?.signal,
  }));
  if (await isFeatureEnabled('capturePromptIO')) {
    sendCapturePromptIO({
      timestamp: Date.now(),
      stage: 'classify',
      sliceProse: options?.parentText ?? '',
      systemPrompt: JUDGE_V1_ADULT_SYSTEM,
      userPrompt,
      rawResponse: raw ?? '',
      locale,
      mode: 'adult',
    });
  }
  if (!raw) return null;
  const verdict = parseJudgeV1(raw);
  if (!verdict) {
    console.debug('[FeelingWise] Judge-v1 response parse failed');
    void recordNeutralizerEvent('parse-failed');
    return null;
  }
  return verdict;
}

/**
 * Adult mode's on-demand reading ("Read this for me", content/read-this.ts):
 * the same measured judge asked of the one item the reader pointed at, with
 * its five fields returned as they are. No fire cut, no rewrite, no hide:
 * nothing is acted on, so the cut that governs acting does not apply. Null
 * when the call failed.
 */
export async function readWithJudgeV1(
  text: string,
  options: { platform?: string; kind?: string; parentText?: string; signal?: AbortSignal },
): Promise<JudgeV1Verdict | null> {
  return askJudgeV1(text, 'en', options);
}

/**
 * Adult mode: the measured judge (2026-09-03). JUDGE-V1's own question, asked
 * of gpt-oss-120b under a strict schema; fire at charged and severity >=
 * JUDGE_V1_FIRE_SEVERITY; hide at JUDGE_V1_HIDE_SEVERITY, rewrite below it
 * through the rewrite-only path. No triage in front and no per-technique
 * severity floor after: the rule measured is the rule shipped
 * (docs/research/accuracy-2026-09-03/RESULTS.md). Child and Teen keep the
 * legacy judge, whose harm categories this rubric does not carry.
 */
async function judgeV1Adult(
  text: string,
  locale: 'en' | 'ro',
  options: CombinedDetectOptions | undefined,
  startTime: number,
): Promise<{ analysis: AnalysisResult; neutralized: NeutralizedContent | null } | null> {
  const verdict = await askJudgeV1(text, locale, options);
  if (!verdict) return null;
  // JUDGE-V1-PAIR: the rule and its measurement live in src/ai/judge-pair.ts, which is a
  // separate file because it is a separate instrument (.claude/rules/judge.md). Nothing
  // about JUDGE-V1 moves here: same frozen prompt, same schema, same cut. What changed on
  // 2026-09-21 is that one model's word is no longer enough to rewrite what somebody sees.
  const secondWasAsked = needsSecondOpinion(verdict, JUDGE_V1_FIRE_SEVERITY);
  // The paid reading's Claude reader is asked beside the second judge, and either may agree
  // (judge-pair.ts actFires, written here through pairFires so this file takes no new import).
  const [second, claude] = secondWasAsked
    ? await Promise.all([
      askJudgeV1(text, locale, options, JUDGE_V1_SECOND_MODEL),
      options?.claudeReader
        ? options.claudeReader({ text, platform: options.platform, kind: options.kind ?? 'post', parentText: options.parentText, signal: options.signal })
        : null,
    ])
    : [null, null];
  const identity = judgeIdentity(secondWasAsked, JUDGE_V1_MODEL, JUDGE_V1_SECOND_MODEL);
  const processingTimeMs = performance.now() - startTime;
  const fired = pairFires(verdict, second, JUDGE_V1_FIRE_SEVERITY)
    || pairFires(verdict, claude?.reading ?? null, JUDGE_V1_FIRE_SEVERITY);
  if (!fired) {
    return {
      analysis: {
        postId: '',
        techniques: [],
        overallScore: 0,
        overallConfidence: 0,
        isManipulative: false,
        processingTimeMs,
        // The reading is kept on a pass too: the sub-threshold band is what
        // the measurement analyses, and a pass the judge read is not a pass
        // nobody read (decision block, 2026-09-07).
        judge: {
          id: identity.id,
          hash: JUDGE_V1_HASH,
          model: identity.model,
          charged: verdict.charged,
          family: verdict.family,
          severity: verdict.severity,
          effect: verdict.effect,
          intent: verdict.intent,
          ...(claude ? { claude } : {}),
        },
      },
      neutralized: null,
    };
  }
  const technique = JUDGE_V1_FAMILY_TECHNIQUE[verdict.family];
  const hide = verdict.severity >= JUDGE_V1_HIDE_SEVERITY;
  const evidence = `judge-v1: ${verdict.family}, ${verdict.effect}, wants the reader to ${verdict.intent}`;
  const analysis: AnalysisResult = {
    postId: '',
    techniques: [{ technique, present: true, confidence: 0.9, severity: verdict.severity, evidence: [evidence] }],
    overallScore: verdict.severity,
    // The measured rule has no confidence term; a fixed value above every
    // mode threshold (calibration.ts) so the gate downstream does not re-cut
    // what the measurement already cut.
    overallConfidence: 0.9,
    isManipulative: true,
    processingTimeMs,
    explanation: evidence,
    primaryTechnique: technique,
    action: hide ? 'hide' : 'rewrite',
    // The instrument's own reading, verbatim, for the record's decision block.
    judge: {
      id: identity.id,
      hash: JUDGE_V1_HASH,
      model: identity.model,
      charged: verdict.charged,
      family: verdict.family,
      severity: verdict.severity,
      effect: verdict.effect,
      intent: verdict.intent,
      ...(claude ? { claude } : {}),
    },
  };
  let neutralized: NeutralizedContent | null = null;
  if (!hide && options?.rewriteEnabled !== false && options?.rewrite) {
    const rewrite = stripEmojis((await options.rewrite({ text, technique, signal: options.signal }).catch(() => '')).trim());
    if (rewrite.length >= 5 && validateNeutralization(text, rewrite)) {
      neutralized = {
        postId: '',
        originalHash: await sha256(text),
        rewrittenText: rewrite,
        analysis,
        aiSource: 'cloud',
        processingTimeMs: performance.now() - startTime,
      };
    }
  }
  if (!hide && neutralized === null) {
    // No rewrite to show. Strong hostility or threat is hidden rather than
    // passed silently (the legacy rule at severity 7); the rest keeps its
    // marker with no rewrite.
    const hostile = verdict.family === 'hostile' || verdict.family === 'threat';
    analysis.action = verdict.severity >= 7 && hostile ? 'hide' : undefined;
  }
  return { analysis, neutralized };
}

/**
 * Triage stage-1 — fast yes/unsure/no holistic classification. Pure
 * module-private wrapper around the small TRIAGE_STAGE1 prompt. Caller
 * (`combinedDetectAndNeutralize` two-stage path) handles the verdict
 * branching; this just runs the call and parses the response.
 *
 * Returns {verdict, raw, userPrompt} so the caller can write a capture
 * tuple when the flag is on. `raw` and `userPrompt` are unused by the
 * verdict branching but load-bearing for the production-shape
 * measurement corpus.
 */
async function triageStage1(
  text: string,
  context: string | undefined,
  signal: AbortSignal | undefined,
): Promise<{ verdict: TriageVerdict; raw: string; userPrompt: string }> {
  const fenced = fencePostText(text);
  const userPrompt = fillTemplate(TRIAGE_STAGE1_USER_TEMPLATE, {
    text: fenced,
    context_block: buildContextBlock(context),
  });
  // Triage uses the configured model — same as the existing classify path.
  // No JSON mode (we want a single token, not structured output).
  const raw = unwrapOrEmpty(await callAI(TRIAGE_STAGE1_SYSTEM, userPrompt, true, {
    jsonMode: false,
    signal,
  }));
  return { verdict: parseTriageVerdict(raw), raw, userPrompt };
}

/**
 * Build a benign-result short-circuit return value for the two-stage
 * cascade when triage emits `no`. All input techniques become
 * `present:false, confidence:0`, neutralizer returns null (no rewrite
 * needed), `isManipulative` is false.
 */
function buildBenignTriageResult(
  techniques: TechniqueResult[],
  processingTimeMs: number,
): { analysis: AnalysisResult; neutralized: NeutralizedContent | null } {
  return {
    analysis: {
      postId: '',
      techniques: techniques.map(t => ({ ...t, present: false, confidence: 0 })),
      overallScore: 0,
      overallConfidence: 0.95,
      isManipulative: false,
      processingTimeMs,
    },
    neutralized: null,
  };
}

/**
 * Combined detect + neutralize in a SINGLE API call.
 * Returns both the analysis result and neutralized content (if manipulative).
 * This halves latency compared to two sequential calls.
 *
 * `options.twoStageCascade` opts into the triage→classify cascade. When
 * false / omitted, legacy single-stage behavior is preserved (existing
 * tests + non-pipeline callers see no change).
 */
export async function combinedDetectAndNeutralize(
  text: string,
  techniques: TechniqueResult[],
  /**
   * Caller-supplied family mode for per-mode severity floor. When omitted
   * (legacy callers, tests), falls back to the universal SEVERITY_FLOOR
   * constant so behavior is unchanged for unspecified callers.
   */
  mode?: Mode,
  /**
   * Caller-supplied UI locale, kept only to tag the prompt capture; no prompt
   * branches on it, because the judge reads the post in its own language.
   */
  locale: 'en' | 'ro' = 'en',
  /**
   * Caller-supplied post author handle. Lets the QUOTE FRAME exception
   * identify when a post quotes the SHARER themselves (e.g., "Jane Roe
   * Responds: …" on a post by @synthetic_author). Without the author, the
   * AI would skip both quoted segments uniformly under QUOTE FRAME and
   * miss the sharer's own commentary. Defaults to 'unknown' for legacy
   * callers / tests.
   */
  author: string = 'unknown',
  /**
   * Optional surrounding-discourse context.
   *
   * When provided, embedded below the POST line in the user prompt as a
   * "SURROUNDING DISCOURSE (context only — judge POST above)" block.
   * Lets the LLM see top-N sibling comments / parent post when scoring
   * a caption or reply, so a borderline post with confirmatory or
   * refuting discourse stacks differently than the post alone.
   *
   * Caller responsibilities:
   *   • Formats the context per their own discipline (one comment per
   *     line, prefixed with `• @author: text` is the convention from
   *     `formatBundleForCombinedPrompt`).
   *   • Caps context length — `buildContextBlock` does NOT truncate;
   *     budget control is the caller's responsibility (the existing
   *     bundle formatter caps at MAX_BUNDLE_CHARS = 3500).
   *   • Omits the parameter (or passes empty/undefined) when no context
   *     is available — empty/undefined produces zero behavior change.
   *
   * Legacy / test callers that don't pass anything see no behavior
   * change: `buildContextBlock(undefined)` returns the empty string,
   * leaving the user prompt structurally identical.
   */
  context?: string,
  /**
   * Optional cascade + abort options. Defaults preserve legacy
   * single-stage behavior. The pipeline.ts production caller opts in
   * via { twoStageCascade: true }.
   */
  options?: CombinedDetectOptions,
): Promise<{ analysis: AnalysisResult; neutralized: NeutralizedContent | null } | null> {
  try {
    const startTime = performance.now();
    const detected = techniques.filter(t => t.present);

    if (mode === 'adult' && options?.legacyJudge !== true) {
      return await judgeV1Adult(text, locale, options, startTime);
    }

    // Two-stage cascade: when enabled, triage runs FIRST.
    if (options?.twoStageCascade) {
      const triageResult = await triageStage1(text, context, options.signal);
      // Capture hook. Off by default; flipped on for production-shape
      // corpus building.
      if (await isFeatureEnabled('capturePromptIO')) {
        sendCapturePromptIO({
          timestamp: Date.now(),
          stage: 'triage',
          sliceProse: context ?? '',
          systemPrompt: TRIAGE_STAGE1_SYSTEM,
          userPrompt: triageResult.userPrompt,
          rawResponse: triageResult.raw,
          locale,
          mode,
        });
      }
      const verdict = triageResult.verdict;
      void recordNeutralizerEvent(`triage-${verdict.replace('_', '-')}`);
      if (verdict === 'no') {
        // Short-circuit: clearly benign, skip the full COMBINED prompt.
        // Returns benign result so the chain still gets a record (forensic
        // completeness — VISION §1.1: every observed post produces a chain
        // record, even on triage-pass).
        return buildBenignTriageResult(techniques, performance.now() - startTime);
      }
      // yes / unsure / parse_fail → fall through to full COMBINED classification
      // (recall-safe: never emit benign on parse-fail).
    }

    // The floor is per-technique × per-mode, resolved inside the map
    // loop (each technique has its own developmental vulnerability; see
    // SEVERITY_FLOOR_BY_TECHNIQUE_AND_MODE docblock).

    // Build user prompt. Text + author are wrapped in <user-content>
    // fence tags (see src/core/prompt-fence.ts). The system prompt at
    // prompts.ts:buildJudgeDetectNeutralizeSystem has a paired clause
    // instructing the model to treat anything inside the fence as data,
    // never as instructions. `flags` is FW-controlled (built from L1
    // regex output) so it does not need fencing.
    const fencedText = fencePostText(text);
    const fencedAuthor = fenceAuthorHandle(author || 'unknown');
    // Optional surrounding-discourse context block.
    // `buildContextBlock` returns '' when context is undefined or empty,
    // leaving the rendered user prompt structurally identical (legacy
    // callers see no behavior change). When context is provided, the
    // block is embedded between AUTHOR and FLAGGED-BY-PATTERN/ANALYZE
    // marker. buildContextBlock fences it with fenceContextBlock, under a
    // header that tells the model to judge the POST and treat the discourse
    // as data, never instructions.
    const contextBlock = buildContextBlock(context);
    let userPrompt: string;
    if (detected.length > 0) {
      const flags = detected
        .map(t => `${t.technique} (confidence: ${t.confidence}, severity: ${t.severity})`)
        .join(', ');
      userPrompt = fillTemplate(JUDGE_DETECT_NEUTRALIZE_USER_TEMPLATE, {
        text: fencedText,
        flags,
        author: fencedAuthor,
        context_block: contextBlock,
      });
    } else {
      userPrompt = fillTemplate(JUDGE_DETECT_NEUTRALIZE_USER_TEMPLATE_NOFLAG, {
        text: fencedText,
        author: fencedAuthor,
        context_block: contextBlock,
      });
    }

    // Request JSON mode — the judge prompt emits the 5-field shape
    // (concerning / primary_concern / severity / should_rewrite /
    // neutralized_text); the response is translated to the legacy
    // CombinedResponse shape via judgeToCombinedShape() before the
    // downstream severity-floor + technique-mapping logic runs.
    const systemPrompt = options?.rewriteEnabled === false
      ? buildJudgeDetectOnlySystem(mode)
      : buildJudgeDetectNeutralizeSystem(mode);
    const raw = unwrapOrEmpty(await callAI(systemPrompt, userPrompt, true, {
      jsonMode: true,
      signal: options?.signal,
    }));
    // Capture hook for the classify stage. Captures regardless of `raw`
    // truthiness (empty raw is a production-shape signal worth labeling
    // — model timeout / cancel-on-stale).
    if (await isFeatureEnabled('capturePromptIO')) {
      sendCapturePromptIO({
        timestamp: Date.now(),
        stage: 'classify',
        sliceProse: context ?? '',
        systemPrompt,
        userPrompt,
        rawResponse: raw ?? '',
        locale,
        mode,
      });
    }
    if (!raw) return null;

    // The judge prompt emits a 5-field JSON shape; extractCombinedJSON does
    // pure JSON.parse with a few common-format-error recoveries (markdown
    // fences, single quotes). Cast the parsed object as JudgeOutput, then
    // translate to the legacy CombinedResponse shape so the downstream
    // severity-floor / technique-mapping / action-handling logic runs
    // unchanged. judgeToCombinedShape handles missing-field tolerance for
    // model shape drift.
    const judgeRaw = extractCombinedJSON(raw) as unknown as JudgeOutput | null;
    if (!judgeRaw) {
      // Parse failures route through the diagnostics counter; surfacing
      // each one in the Errors panel would mislead the user about
      // extension health.
      console.debug('[FeelingWise] Judge response parse failed');
      void recordNeutralizerEvent('parse-failed');
      return null;
    }
    const response = judgeToCombinedShape(judgeRaw);

    const processingTimeMs = performance.now() - startTime;

    // Defensive guards: `response.techniques` is typed as an array of
    // fully-populated objects, but it comes out of JSON.parse — in practice
    // LLMs sometimes emit `techniques: ["fear-appeal", "fomo"]` (strings),
    // `techniques: null`, or omit individual fields. Everything downstream
    // expects an array of objects with at least `.name`. Normalize once here
    // via a raw-any filter so the type predicate doesn't fight the stricter
    // declared shape.
    type LooseTechnique = {
      name: string;
      verdict?: string;
      severity?: number;
      reason?: string;
    };
    const rawTechniques: unknown = (response as { techniques?: unknown }).techniques;
    const aiTechniques: LooseTechnique[] = Array.isArray(rawTechniques)
      ? (rawTechniques as unknown[]).reduce<LooseTechnique[]>((acc, at) => {
          if (at && typeof at === 'object') {
            const obj = at as Record<string, unknown>;
            if (typeof obj.name === 'string') {
              acc.push({
                name: obj.name,
                verdict: typeof obj.verdict === 'string' ? obj.verdict : undefined,
                severity: typeof obj.severity === 'number' ? obj.severity : undefined,
                reason: typeof obj.reason === 'string' ? obj.reason : undefined,
              });
            }
          }
          return acc;
        }, [])
      : [];

    if (rawTechniques !== undefined && rawTechniques !== null && aiTechniques.length === 0) {
      // We received a truthy `techniques` payload but nothing survived the
      // shape check. That's shape drift — record it so we can see rate in the
      // dashboard without letting the pipeline throw.
      void recordNeutralizerEvent('techniques-shape-drift');
    }

    // Track how many LLM emissions we drop for severity-floor reasons so we
    // can read the rate back from the diagnostics store without logging noise.
    let severityFloorDrops = 0;

    // Build analysis result — safe: maps against existing L1 technique names only
    const verified: TechniqueResult[] = techniques.map(t => {
      const aiTechnique = aiTechniques.find(at => at.name === t.technique);
      if (!aiTechnique) return { ...t, present: false, confidence: 0 };
      if (aiTechnique.verdict === 'CONFIRMED') {
        const severity = aiTechnique.severity ?? 5;
        // Per-technique × per-mode floor.
        const floor = severityFloorFor(t.technique, mode);
        if (severity < floor) {
          severityFloorDrops++;
          return { ...t, present: false, confidence: 0 };
        }
        return {
          ...t,
          present: true,
          confidence: response.overallConfidence ?? 0.75,
          severity,
          evidence: [aiTechnique.reason ?? ''],
        };
      }
      return { ...t, present: false, confidence: 0 };
    });

    // Also add any techniques the AI found that weren't in L1
    for (const aiT of aiTechniques) {
      if (aiT.verdict !== 'CONFIRMED') continue;
      if (!VALID_TECHNIQUES.has(aiT.name)) continue;
      const severity = aiT.severity ?? 5;
      // Per-technique × per-mode floor (AI-discovered extras).
      const floor = severityFloorFor(aiT.name, mode);
      if (severity < floor) {
        severityFloorDrops++;
        continue;
      }
      const exists = verified.some(t => t.technique === aiT.name);
      if (!exists) {
        verified.push({
          technique: aiT.name as TechniqueResult['technique'],
          present: true,
          confidence: response.overallConfidence ?? 0.75,
          severity,
          evidence: [aiT.reason ?? ''],
        });
      }
    }

    if (severityFloorDrops > 0) {
      void recordNeutralizerEvent('severity-floor-drop');
    }

    const present = verified.filter(t => t.present);

    // Split the residual bucket so its emptiness is measured, not guessed.
    // 'combined' means the judge's free-text concern matched no technique enum,
    // so the model's own phrase is the only thing standing behind the verdict.
    // It reaches the signed record as techniques[].why — EXCEPT when the judge
    // returned primary_concern: null (the schema permits it), which
    // mapConcernToTechnique also maps to 'combined'. Then evidence is [''] and
    // forensics/logger.ts filters it out, leaving the residual name with nothing
    // behind it. The two are different facts and nothing downstream can tell
    // them apart, so they are counted apart here.
    const residual = present.find(t => t.technique === 'combined');
    if (residual) {
      const hasConcern = (residual.evidence ?? []).some(e => String(e).trim().length > 0);
      void recordNeutralizerEvent(hasConcern ? 'combined-with-concern' : 'combined-no-concern');
    }
    // Do NOT force-emit 'combined' when LLM is ambivalent. When the
    // model signals a general concern without naming a technique, the
    // correct behavior is to pass (no flag). The prompt is authoritative.

    // The teen panel renders explanation verbatim as the "Why" line;
    // the model is asked to ground it in the post's specific content.
    // Defensive parse: only accept non-empty strings from the LLM,
    // otherwise leave undefined and let the injector fall back to the
    // technique reason field.
    const rawExplanation = (response as { explanation?: unknown }).explanation;
    const explanation =
      typeof rawExplanation === 'string' && rawExplanation.trim().length > 0
        ? rawExplanation.trim()
        : undefined;

    // primaryTechnique: only honor it when the LLM names a known
    // technique that we also confirmed as present. Falsy / unknown /
    // not-present → coerce to the highest-severity confirmed technique.
    // Without coercion, the marker UI's getReasonFor(undefined) path
    // surfaces a diagnostic fallback in user-facing DOM ("FeelingWise
    // Feedback: Pattern detected — matched a manipulation pattern.").
    // The verdict shape must guarantee a primaryTechnique whenever
    // isManipulative is true.
    const rawPrimary = (response as { primaryTechnique?: unknown }).primaryTechnique;
    const llmNamedPrimary: TechniqueName | undefined =
      typeof rawPrimary === 'string'
        && VALID_TECHNIQUES.has(rawPrimary)
        && verified.some(t => t.present && t.technique === rawPrimary)
        ? (rawPrimary as TechniqueName)
        : undefined;
    const primaryTechnique: TechniqueName | undefined =
      llmNamedPrimary
      ?? (present.length > 0
        ? (present.slice().sort((a, b) => b.severity - a.severity)[0].technique as TechniqueName)
        : undefined);

    // Model-chosen action label. Defensive parse: accept only the three
    // documented values. Anything else → undefined; the injector treats
    // undefined as 'rewrite'.
    const rawAction = (response as { action?: unknown }).action;
    let action: 'rewrite' | 'collapse' | 'hide' | undefined =
      rawAction === 'rewrite' || rawAction === 'collapse' || rawAction === 'hide'
        ? rawAction
        : undefined;

    // Always rewrite. An earlier iteration forced action='collapse' on
    // confirmed scapegoating / hyperreal-trauma-bait so the post body
    // folded under a placeholder. Live UX showed two issues: (1)
    // collapsed posts left empty space in the reading flow that read as
    // "designed UI frame" disconnected from the platform's voice, (2)
    // the parent-dashboard "what your child saw instead" column was
    // empty for these records. With the marker + popover surfacing the
    // technique label and the original-on-tap, the standalone collapse
    // placeholder was redundant and worse UX than always-rewrite.
    //
    // The prompt instructs the model to produce a neutralized text even
    // for generic-group claims. UX preference: rewrite wins when achievable
    // (collapsed/hidden posts read as "designed UI frame" disconnected
    // from the platform's voice, a product decision from before July 2026). But when the rewrite
    // FAILS (validator rejects, length blowup, register flatten, etc.)
    // AND the LLM's original intent was hide/collapse, the architecture
    // honors that intent — refusing to silently drop protection. The
    // downgrade now happens AFTER the rewrite attempt completes, gated
    // on rewrite success.
    //
    // Capture the AI's original action so we can restore it below if
    // rewrite fails. `aiOriginalAction` is used only as a fallback
    // signal; it doesn't surface in the final analysis on the rewrite-
    // success path. Per docs/audits/2026-05-23 console-log diagnosis:
    // "AI emitted action=hide → downgrade → no rewrite produced → PASS"
    // was silently dropping protection on high-severity content.
    const aiOriginalAction: 'collapse' | 'hide' | undefined =
      action === 'collapse' || action === 'hide' ? action : undefined;
    if (aiOriginalAction !== undefined) {
      console.debug(
        `[FeelingWise] AI emitted action=${aiOriginalAction} — attempting rewrite first; will fall back to ${aiOriginalAction} if rewrite fails.`,
      );
      action = undefined;
    }

    const analysis: AnalysisResult = {
      postId: '',
      techniques: verified,
      overallScore: aggregateSeverity(verified),
      overallConfidence: response.overallConfidence ?? (present.length > 0 ? Math.max(...present.map(t => t.confidence)) : 0),
      isManipulative: present.length > 0,
      processingTimeMs,
      explanation,
      primaryTechnique,
      action,
    };

    // Build neutralization if AI provided it and post is manipulative.
    // `response.neutralizedText` is typed `string | null` but comes from
    // JSON.parse — LLMs occasionally emit numbers, objects, arrays, or
    // `true` for this field. A truthy-only check would let non-string
    // truthy values reach `.trim()` and throw. Guard with
    // `typeof === 'string'` instead.
    //
    // No skipRewrite gate. After the always-rewrite architecture above
    // (collapse / hide downgraded to undefined), no manipulative outcome
    // skips the rewrite branch. The injector branches that handle
    // collapse / hide remain as dead code for chain-record back-compat;
    // runtime never reaches them via this path now.
    let neutralized: NeutralizedContent | null = null;
    if (analysis.isManipulative) {
      if (typeof response.neutralizedText === 'string') {
        // Defensive strip: when the input was a TikTok bundle (caption
        // + "— Top reactions —" block), the LLM is instructed to
        // rewrite ONLY the caption above the marker. If it slips and
        // includes the bundle scaffolding in its output, strip
        // everything from the marker onwards before storing.
        // Belt-and-braces over the prompt rule.
        const trimmed = stripBundleScaffolding(response.neutralizedText.trim());
        if (trimmed.length > 0) {
          if (validateNeutralization(text, trimmed)) {
            // Emoji strip runs AFTER validation, not before. Validating
            // against the LLM's actual output keeps the meta-talk and
            // voice-inversion guards firing on what the LLM literally
            // wrote (post-strip text could mask issues by gluing tokens
            // together). The strip is purely a display-time safety net
            // for the prompt-side "NO EMOJI" instruction; if the strip
            // leaves < 5 chars (pure-emoji rewrite) the rewrite is
            // dropped to avoid surfacing nothing on screen.
            const finalText = stripEmojis(trimmed);
            if (finalText.length >= 5) {
              neutralized = {
                postId: '',
                originalHash: await sha256(text),
                rewrittenText: finalText,
                analysis,
                aiSource: 'cloud',
                processingTimeMs,
              };
            }
          }
          // When `validateNeutralization` rejects, the validator has already
          // logged the reason at debug level and counted it.
        }
      } else if (response.neutralizedText !== null && response.neutralizedText !== undefined) {
        // Non-string, non-nullish — LLM shape drift. Log + count + pass
        // through without neutralization. Diagnostics counter still
        // increments.
        console.debug('[FeelingWise] Combined response neutralizedText was not a string (got',
          typeof response.neutralizedText, ') — skipping rewrite.');
        void recordNeutralizerEvent('non-string-neutralized-text');
      }
    }

    // HIDE-fallback: when the LLM emitted action=hide/collapse but the
    // rewrite failed (validator rejection, empty rewrite, non-string
    // response, etc.), restore the original action so the collapse/hide
    // branch in analysis/pipeline.ts protects the child instead of passing
    // the post through unprotected, as the comment path's isUnrewritable
    // hide does (content/comment-batch/flush.ts).
    if (analysis.isManipulative && neutralized === null) {
      if (aiOriginalAction !== undefined) {
        console.debug(
          `[FeelingWise] Rewrite unavailable; restoring AI action=${aiOriginalAction} to honor severity judgment.`,
        );
        analysis.action = aiOriginalAction;
      } else {
        // The AI defaulted to 'rewrite' but the rewrite failed, so high-severity
        // hostile detections hide, as the comment path's isUnrewritable gate does
        // (content/comment-batch/flush.ts). Lower-severity manipulation keeps the
        // lighter touch: the fallback must not hide borderline content wholesale.
        const sev = analysis.overallScore ?? 0;
        const t = analysis.primaryTechnique;
        const hostile =
          t === 'shame-attack' || t === 'scapegoating' ||
          t === 'anger-trigger' || t === 'fear-appeal';
        if (sev >= 7 && hostile) {
          console.debug(
            `[FeelingWise] Rewrite failed on sev=${sev} ${t}; falling back to hide (no silent pass of detected harm).`,
          );
          analysis.action = 'hide';
        }
      }
    }

    return { analysis, neutralized };
  } catch (err) {
    console.error('[FeelingWise] Combined detect+neutralize error:', err);
    void recordNeutralizerEvent('unknown-throw');
    return null;
  }
}

