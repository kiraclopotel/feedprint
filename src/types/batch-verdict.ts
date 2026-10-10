// BatchCommentVerdict: the shape, with no behavior attached.
//
// It was declared in src/analysis/comment-batch-scorer.ts, and src/types/messages.ts imported it from there, which made the
// types layer depend on a layer above it (PLAN-2026-09-16 item 8.6). The module keeps its logic and
// re-exports this name, so nothing that imports it had to change.

/** Per-comment verdict inside a batch. */
export interface BatchCommentVerdict {
  /** 1-based index into the input batch (matches the LLM's numbering). */
  index: number;
  /** Most-prominent technique observed. 'none' when neutral / supportive / off-topic. */
  technique:
    | 'fear-appeal'
    | 'shame-attack'
    | 'anger-trigger'
    | 'false-urgency'
    | 'bandwagon'
    | 'fomo'
    | 'scapegoating'
    | 'toxic-positivity'
    | 'misleading-format'
    | 'body-comparison-priming'
    | 'parasocial-coercion'
    | 'consumer-rapid-frame'
    | 'hyperreal-trauma-bait'
    | 'pile-on'
    | 'mockery'
    | 'sarcasm'
    | 'genuine-opinion'
    | 'supportive'
    | 'neutral'
    | 'off-topic'
    | 'combined'
    | 'self-harm'
    | 'sexual'
    | 'violence-graphic'
    | 'profanity'
    | 'none';
  /** Sentiment polarity. */
  sentiment: 'negative' | 'positive' | 'neutral';
  /** Severity 0–10. Used by the threshold gate before flagging. */
  severity: number;
  /** Model-provided confidence 0.0–1.0, independent of severity. Fallback 0.5 when missing. */
  confidence: number;
  /** Free-form 1-line reason in the comment's language. Empty when sentiment=neutral. */
  reason: string;
  /**
   * Intervention tier per VISION §1.2 (block / hide / mark / log / escalate).
   * Defaults to 'rewrite' when omitted (back-compat with pre-callers and
   * cached records). The verdict-override gate writes 'hide' for
   * identity-slur sev≥8 content — DOM-hide instead of attempting a small-model
   * rewrite of slur-laden text that would either return empty (safety-filter
   * refusal) or produce a synonym-swap. Forensic chain still receives a
   * record; the kid does not see the comment.
   */
  action?: 'rewrite' | 'hide' | 'pass';
  /**
   * Inline rewrite produced by the BATCH classifier in the same call as
   * the verdict (Phase 2B, 2026-05-15). When present, `flushBatch`
   * uses this directly and skips the per-comment `neutralizeText` round-
   * trip. When undefined or null, caller falls back to `neutralizeText`
   * for backwards compatibility (V2 prompt didn't emit rewrites, and the
   * model occasionally omits the field on shape drift).
   *
   * Inline rewrites carry the detection context in the model's working
   * memory (the classification was just made), which closes the encoded-
   * manipulation laundering pattern observed with the rewrite-only
   * NEUTRALIZATION_SYSTEM prompt: Rule 1 + Rule 6 ("preserve factual
   * claims exactly") conflicted with strip-manipulation goals on small models,
   * resolving toward preservation when the manipulation was encoded as
   * factual claims (conspiracy framing, antisemitic tropes, Orwellian
   * inversion).
   */
  neutralizedText?: string | null;
  /**
   * Honest evidence provenance: which deterministic override gate produced /
   * mutated this verdict, or undefined when the verdict is the LLM's own
   * judgment. Set where the post-LLM override fires. The forensic record carries
   * it (`src/types/forensic.ts` ForensicRecord.overrideOrigin) so the chain never
   * implies "the AI diagnosed shame-attack" when a regex match actually set the
   * label. Does NOT change which comments flag, the marker, or `isManipulative`.
   */
  overrideOrigin?: 'identity-slur' | 'profanity-tier' | 'coded-harm' | 'ad-hominem' | 'harm-floor' | 'rage-format';
}
