// FeelingWise — export methodology block ("under what criteria was this
// identified?", 2026-07-02). A court, school, or opposing counsel reading
// an export can ask HOW items were classified; the honest answer is the
// verbatim instructions the AI models were given, the model pins, and the
// decision thresholds. This module renders that, for embedding at the top of
// evidence exports.
//
// Provenance rules:
//   • Prompt TEXTS are rendered from the live builders — never copied prose —
//     so the export always matches the shipping code.
//   • The user-content parts of prompts are per-post data and are NOT included
//     (records carry the post text separately); only SYSTEM instructions are.
//   • Numbers that live in other modules are restated here as data and locked
//     by unit tests importing both sides (bundle-weight reasons: pulling the
//     whole content pipeline into the dashboard bundle for one constant is
//     not worth it; the test is the drift guard).

import { buildBatchPromptV3, buildRoomPrompt } from '../ai/prompts-v2';
import { encounterFromLegacyBatchInput, TOPIC_LABELS } from '../analysis/comment-batch-scorer';
import {
  buildJudgeDetectNeutralizeSystem,
  JUDGE_V1_ADULT_SYSTEM,
  JUDGE_V1_FIRE_SEVERITY,
  JUDGE_V1_HIDE_SEVERITY,
  JUDGE_V1_MODEL,
  JUDGE_V1_SECOND_MODEL,
  NEUTRALIZATION_SYSTEM,
} from '../ai/prompts';
import { ADULT_READER_FIXED_CONFIDENCE } from '../core/calibration';

/**
 * The per-technique x per-mode severity floor, restated as export data.
 *
 * Restated rather than imported: this block renders inside the dashboard
 * bundle, and importing it from neutralizer.ts would drag the whole content
 * pipeline in for one table. Drift is caught by
 * tests/unit/core/methodology-severity-floors.test.ts, which imports both sides and
 * compares them cell for cell.
 *
 * Lower = more aggressive intervention.
 *
 * CHILD AND TEEN ONLY. This table gated adult posts until 2026-09-03, and
 * this comment still said "adult mode reads the teen column" until
 * 2026-09-18. It does not: neutralizer.ts sends every adult post to the
 * measured reader (JUDGE-V1) before any of these cells is consulted, and that
 * reader applies no per-technique floor at all. `severityFloorFor` still maps
 * adult onto the teen column, but the only way to reach it in adult mode is
 * the `legacyJudge` option, which nothing in src/ sets. The cuts that really
 * gated an adult record are ADULT_READER_CUTS below.
 */
const METHODOLOGY_SEVERITY_FLOORS: Readonly<Record<string, Readonly<{ child: number; teen: number }>>> = {
  'fear-appeal': { child: 6, teen: 6 },
  'repeat-exposure': { child: 6, teen: 6 },
  'anger-trigger': { child: 6, teen: 6 },
  'shame-attack': { child: 6, teen: 7 },
  'false-urgency': { child: 7, teen: 6 },
  'bandwagon': { child: 8, teen: 5 },
  'scapegoating': { child: 8, teen: 5 },
  'fomo': { child: 7, teen: 5 },
  'toxic-positivity': { child: 7, teen: 7 },
  'misleading-format': { child: 6, teen: 7 },
  'combined': { child: 5, teen: 4 },
  'profanity': { child: 1, teen: 1 },
  'body-comparison-priming': { child: 6, teen: 4 },
  'parasocial-coercion': { child: 5, teen: 6 },
  'consumer-rapid-frame': { child: 5, teen: 7 },
  'hyperreal-trauma-bait': { child: 4, teen: 7 },
  'combined-stack': { child: 5, teen: 5 },
  'sexual': { child: 4, teen: 5 },
  'violence-graphic': { child: 4, teen: 5 },
  'self-harm': { child: 4, teen: 4 },
  'drug-promotion': { child: 5, teen: 5 },
  'unsafe-health-experiment': { child: 4, teen: 5 },
  'extreme-toxicity': { child: 5, teen: 5 },
};

/**
 * The adult post path's own cuts, restated as export data.
 *
 * Same restatement rule as the floor table: the two severity cuts are read
 * straight from the frozen prompts file (they live there, next to the prompt
 * they belong to), but the fixed confidence and the family-to-technique map
 * live in neutralizer.ts and are copied here rather than imported, for the
 * same bundle-weight reason. The drift guard is
 * tests/unit/analysis/methodology.test.ts, which imports both sides.
 *
 * A reader holding an adult record needs these to answer two questions the
 * rest of the block cannot: why this item was acted on at all (fire), why it
 * was hidden instead of rewritten (hide), and where a technique name like
 * "anger-trigger" came from when the model was never asked for techniques
 * (the family map).
 */
const ADULT_READER_FAMILY_TECHNIQUE: Readonly<Record<string, string>> = {
  hostile: 'anger-trigger',
  threat: 'fear-appeal',
  commercial: 'consumer-rapid-frame',
  body: 'body-comparison-priming',
  profanity: 'profanity',
  none: 'combined',
};


export interface MethodologyBlock {
  /** What this block is, for a cold reader. */
  note: string;
  generatedAt: string;
  extensionVersion: string;
  models: {
    textJudge: string;
    /**
     * The adult on-demand reader, which is a DIFFERENT model from the feed
     * judge and was missing from this block until 2026-09-18. `startReadThis`
     * is live in the content script and stamps its records with this model, so
     * an adult export was answering "under what criteria was this identified"
     * with a model that had not run and a framing that was not used.
     *
     * Names both readers, not one: JUDGE-V1-PAIR (judge-pair.ts) asks a second
     * model, JUDGE_V1_SECOND_MODEL, whenever the first fires, and only acts
     * where both agree. A block naming one model for a two-model process was
     * itself a defect of the same shape this comment already describes.
     */
    adultReader: string;
    /**
     * The paid reading's third reader (src/ai/claude-reader.ts, 11 Oct 2026): asked beside the second
     * model on the items the first fires on, for a key that holds the reading and its own consent to
     * this company. Its own entry, not a rewording of adultReader, because the sentences above are
     * carried in records that predate it.
     */
    paidReader: string;
    roomSensor: string;
    modelProvenanceNote: string;
  };
  thresholds: {
    /**
     * COMMENT path gate: flat minimum severity a manipulation verdict must
     * reach (comment-batch-scorer.ts:MANIPULATION_SEVERITY_THRESHOLD). A
     * comment whose verdict carries action 'hide' flags regardless of
     * severity.
     */
    severityFlagGate: number;
    /**
     * POST path gate for CHILD AND TEEN: per-technique x per-mode minimum
     * severity, NOT the flat number above. Floors range 4 to 8, so a flagged
     * post record at severity 4 or 5 is the gate working. Restated from
     * neutralizer.ts:SEVERITY_FLOOR_BY_TECHNIQUE_AND_MODE and locked against
     * it by tests/unit/core/methodology-severity-floors.test.ts. Adult posts
     * do not pass through this table at all; see the adultReader* fields.
     */
    postSeverityFloorByTechniqueAndMode: Readonly<Record<string, Readonly<{ child: number; teen: number }>>>;
    /** Post-path fallback floor, used only for techniques absent from the matrix. */
    defaultPostSeverityFloor: number;
    /**
     * ADULT post gate, the whole of it: the reader fires when it calls the
     * item charged AND severity reaches this cut. Below it the reading is
     * still kept on the record as a pass, with no technique and no action.
     * (prompts.ts:JUDGE_V1_FIRE_SEVERITY.)
     */
    adultReaderFireSeverity: number;
    /**
     * At or above this severity an adult item is HIDDEN rather than rewritten;
     * below it, a fired item is rewritten in place.
     * (prompts.ts:JUDGE_V1_HIDE_SEVERITY.)
     */
    adultReaderHideSeverity: number;
    /**
     * The adult reader writes one fixed confidence on every record it fires
     * on: the measured rule has no confidence term, and this value sits above
     * every mode threshold so nothing downstream re-cuts what the measurement
     * already cut. An adult record's confidence is therefore not a measure of
     * how sure the model was.
     */
    adultReaderFixedConfidence: number;
    /**
     * The adult reader is never asked for a technique. It answers with one
     * family, and this map turns that family into the technique name the
     * record carries.
     */
    adultReaderFamilyToTechnique: Readonly<Record<string, string>>;
    /** How an adult record was gated, in full. */
    adultReaderNote: string;
    /**
     * Severity written by the deterministic profanity-FILTER path (no LLM,
     * rewrite in place). Distinct from the slur path, which routes through the
     * harm floor and stamps severity 9 with detectionMode 'slur:N'.
     */
    profanityFilterSeverity: number;
    /** Deterministic harm-floor trigger score (0-100 scale). */
    harmFloorTrigger: number;
    thresholdsNote: string;
    /**
     * How this export's own summary sections define "flagged", and how to
     * read a record whose intended action never reached the page.
     */
    flagAccountingNote: string;
  };
  /** Closed content-topic vocabulary used for topicLabels on room records. */
  topicLabelVocabulary: readonly string[];
  prompts: {
    commentJudgeChildMode: string;
    commentJudgeTeenMode: string;
    roomSensor: string;
    postJudgeChildMode: string;
    postJudgeTeenMode: string;
    /** The adult reader's own system text, verbatim. See models.adultReader. */
    adultReader: string;
    rewriter: string;
    promptsNote: string;
  };
}

/** Placeholder encounter so the prompt BUILDERS render their system text.
 *  Only `.system` is kept; the user-content half is per-post data. */
function placeholderEncounter() {
  return encounterFromLegacyBatchInput(
    {
      comments: [{ author: 'commenter', text: '(comment text)' }],
      videoCaption: '(post text)',
      // A placeholder, like the two lines above it, not a real instruction: the
      // live prompt is given the item's own detected language, or "the same
      // language as the original input" when none was detected (prompts-v2.ts).
      // 'English' here made every rendered export read as though the model was
      // always told to answer in English (gem 81, recount 8).
      language: '(detected per item)',
    },
    'tiktok',
  );
}

export function buildMethodologyBlock(extensionVersion: string): MethodologyBlock {
  const enc = placeholderEncounter();
  return {
    note:
      'How FeelingWise classified the items in this export: the verbatim system ' +
      'instructions given to each AI model, the model identifiers, and the decision ' +
      'thresholds. Classifications are AI Safety Interpretations — uncertainty-aware ' +
      'signals that can be challenged on their merits, never established facts. ' +
      'Severity (how strong a pattern reads) and confidence are separate values ' +
      'on every record. Confidence is how sure the model was, except on records ' +
      'written by the Relaxed reader, where it is one fixed value and measures ' +
      'nothing; the thresholds below say which value.',
    generatedAt: new Date().toISOString(),
    extensionVersion,
    models: {
      textJudge: 'openai/gpt-oss-20b (DeepInfra)',
      adultReader: `${JUDGE_V1_MODEL} (DeepInfra); a second model, ${JUDGE_V1_SECOND_MODEL} ` +
        '(DeepInfra), is asked whenever the first fires, and the record is only ' +
        'acted on where both agree',
      paidReader: 'claude-haiku-5-5 (Anthropic) is asked beside the second model on the items the first ' +
        'fires on, only for a key that holds the paid reading and a consent naming this company; the ' +
        'record is acted on where the first fires and either the second or Claude agrees, and each such ' +
        'record carries, under decision.claude, who was asked and what came of it: Claude\'s reading, or ' +
        'the reason there is none',
      roomSensor: 'openai/gpt-oss-20b (DeepInfra)',
      modelProvenanceNote:
        'These are the pins at export time. Every individual record carries the ' +
        'model that actually judged it in its aiModel/aiProvider fields. The ' +
        'per-record aiProvider stamp is authoritative on every record: the same ' +
        'open-weight models were served by Groq until 23 September 2026 and by ' +
        'DeepInfra from 22 September 2026, both on the 22nd and 23rd while ' +
        'installs moved over, so a record naming Groq in its aiProvider field is ' +
        'correct whatever this block says. The per-record aiModel stamp is NOT ' +
        'authoritative on a record written between 19 and 24 September 2026: a ' +
        'defect in the builds that shipped in that window named the wrong model ' +
        'there. Records from 2.5.15 onward are unaffected.',
    },
    thresholds: {
      severityFlagGate: 6,
      postSeverityFloorByTechniqueAndMode: METHODOLOGY_SEVERITY_FLOORS,
      defaultPostSeverityFloor: 6,
      adultReaderFireSeverity: JUDGE_V1_FIRE_SEVERITY,
      adultReaderHideSeverity: JUDGE_V1_HIDE_SEVERITY,
      adultReaderFixedConfidence: ADULT_READER_FIXED_CONFIDENCE,
      adultReaderFamilyToTechnique: ADULT_READER_FAMILY_TECHNIQUE,
      adultReaderNote:
        'A Relaxed post record was gated by neither of the two rules above. ' +
        'Since 2026-09-03 every post at Relaxed (recorded under an earlier name ' +
        'before the levels were named) goes to the measured ' +
        'reader named under Models, which is asked one question about the ' +
        'item and answers five fields: charged, family, severity, effect and ' +
        'intent. When the item is charged AND severity reaches ' +
        `${JUDGE_V1_FIRE_SEVERITY}, a second model is asked the same question ` +
        '(named under Models); the item only acts if both agree. ' +
        'A charged, high-severity record that still reads as a plain pass can ' +
        'be exactly that: the two models disagreed, so nothing acted, and the ' +
        'record is not an unexplained one. Where it does act, at severity ' +
        `${JUDGE_V1_HIDE_SEVERITY} or ` +
        'above the item is hidden, below that it is rewritten in place. ' +
        'Nothing else gates it: no triage before, and none of the ' +
        'per-technique floors in the table above after, because the rule that ' +
        'was measured is the rule that ships. Two consequences a reader ' +
        'should know. A Relaxed record carries a technique name the model was ' +
        'never asked for, mapped from the one family it did answer (map ' +
        'above), so a record reading "anger-trigger" means the reader called ' +
        `the item hostile. And its confidence is always ${ADULT_READER_FIXED_CONFIDENCE}, ` +
        'a fixed value rather than a measure of how sure the model was: on ' +
        'a Relaxed record, severity carries the judgement and confidence ' +
        'carries nothing. Items the reader read and passed are kept as ' +
        'records too, with no technique and no action.',
      profanityFilterSeverity: 4,
      harmFloorTrigger: 70,
      thresholdsNote:
        'One severity number does not separate flagged from clean, because the ' +
        'two text paths gate differently, and Relaxed posts gate differently ' +
        'again. COMMENTS use the flat gate above, at every level: a ' +
        'manipulation verdict at severity >= 6 flags, below it passes, and a ' +
        'verdict carrying action "hide" flags at any severity. STRICT AND ' +
        'MODERATE POSTS use the per-technique x per-level floor table instead; a ' +
        'flagged post record at severity 4 or 5 is that table working, not a ' +
        'leak. The range is the one printed with the table and read off its ' +
        'own cells, not restated here: this sentence said "4 to 8" until ' +
        '2026-09-18, after profanity was set to 1, and disagreed with the ' +
        'computed range one line above it. RELAXED POSTS use neither, and are ' +
        'gated by the two cuts above the table instead; the Relaxed reader note says ' +
        'how. Two further rules move severity after a floor is ' +
        'cleared: a detection whose confidence lands within 0.10 of the ' +
        'confidence threshold has every technique severity reduced by 1 ' +
        '(borderline damping), and the deterministic profanity-filter path never ' +
        'calls a model at all, writing a fixed severity 4 (the separate slur ' +
        'path routes through the harm floor and stamps severity 9). The ' +
        'deterministic harm floor (slur/profanity/ad-hominem lexicons, no AI) ' +
        'escalates independently of the model at score >= 70 and is stamped ' +
        'per record in the harmFloor field.',
      flagAccountingNote:
        'The summary counts in this export treat a record as flagged when its ' +
        'verdict is flagged or flagged-hidden, or when a technique on it ' +
        'reaches severity 5 without a verdict having been written. Records ' +
        'with verdict "blocked" are excluded from every flag count: those come ' +
        'from the rule-based blocker (ad markers, blocklist hashtags, ' +
        'AI-generated-content markers, reel surfaces, media timeouts). One ' +
        'written before 13 September 2026 carries a synthetic technique ' +
        '"ai-content-block" at severity 10, and that 10 records "the rule ' +
        'matched exactly", not a harm judgement; one written since carries no ' +
        'technique and no severity. ' +
        'Records with a cancelled verdict were never judged and are excluded ' +
        'from both sides of every rate. Since this version, advertising is ' +
        'counted as paid placement only: an item carrying the platform\'s ad ' +
        'marker is in no flag count, no severity and no technique tally, and ' +
        'any severity an older ad record carries is ignored when counting and ' +
        'displaying it. A record whose intended action could not reach the ' +
        'page (a rewrite the page rejected as empty or invalid) keeps the ' +
        'action the page actually showed, allow, and its own note field ' +
        'reads "the page could not apply the action; the item stayed as the ' +
        'record says under applied". A record written by an earlier build ' +
        'can show a plain allow with no note even though the same thing ' +
        'happened to it; the applied field is honest either way, only the ' +
        'explanation can be missing.',
    },
    topicLabelVocabulary: TOPIC_LABELS,
    prompts: {
      commentJudgeChildMode: buildBatchPromptV3(enc, undefined, 'child').system,
      commentJudgeTeenMode: buildBatchPromptV3(enc, undefined, 'teen').system,
      roomSensor: buildRoomPrompt(enc, 'teen').system,
      postJudgeChildMode: buildJudgeDetectNeutralizeSystem('child'),
      postJudgeTeenMode: buildJudgeDetectNeutralizeSystem('teen'),
      adultReader: JUDGE_V1_ADULT_SYSTEM,
      rewriter: NEUTRALIZATION_SYSTEM,
      promptsNote:
        'Rendered from the live prompt builders at export time. The comment judge above runs in ' +
        'its Strict and Moderate framing, and Relaxed uses the Moderate framing. The post judge is different: ' +
        'its Strict and Moderate texts are printed above, but a Relaxed post is not asked either of them. ' +
        'Relaxed has a reader of its own, with its own model, its own text and its own two ' +
        'severity cuts, all printed here, and it is the only thing that reads a Relaxed post; the ' +
        'same reader also answers the read-this-item button. Until 2026-09-18 this block named none ' +
        'of it, so a Relaxed export answered this question with a model that had not judged its ' +
        'records, a framing that had not been used and thresholds that had not been applied. ' +
        'Placeholders like "(post text)" mark where each analyzed ' +
        'item\'s own content is inserted; the record\'s originalText field carries ' +
        'what was actually analyzed.',
    },
  };
}

/** The extension version, robust to non-extension (test) contexts. */
export function currentExtensionVersion(): string {
  try {
    return chrome.runtime.getManifest().version;
  } catch {
    return 'unknown';
  }
}
