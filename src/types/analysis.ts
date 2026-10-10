// FeelingWise - Analysis result types

export type TechniqueName =
  | 'fear-appeal' | 'anger-trigger' | 'shame-attack' | 'false-urgency'
  | 'bandwagon' | 'scapegoating' | 'fomo' | 'toxic-positivity'
  | 'misleading-format' | 'combined' | 'profanity'
  // Code-side only: never emitted by the detector prompt or by an L1
  // classifier, because it is not a property of the post's words. It fires
  // when one source, or one exact piece of copy, has reached the reader
  // often enough to be worth naming (core/pipeline exposure gate; counters
  // in forensics/author-store). Measured rationale:
  // docs/audits/2026-08-25-true-judgement/NARRATOR.md.
  | 'repeat-exposure'
  // Youth-specific techniques. Emitted by the COMBINED prompt AND by
  // registered L1 rule-based classifiers with bilingual EN+RO regex
  // coverage (see core/techniques/index.ts). (2026-08-04: comment
  // previously called this an LLM-only path with no L1 classifier;
  // all four L1 classifiers have since landed.)
  | 'body-comparison-priming'
  | 'parasocial-coercion'
  | 'consumer-rapid-frame'
  | 'hyperreal-trauma-bait'
  // 'combined-stack' is distinct from 'combined': single-poster intensity
  // stacking (profanity + ad-hominem + group-blame + caps), versus the
  // existing 'combined', which is the uncategorised residual the judge's
  // free-text concern falls to when it matches no enum here (deciding site:
  // mapConcernToTechnique in src/core/neutralizer.ts). The persisted
  // 'combined' never carries components; the L1 meta-rule in
  // core/techniques/combined.ts does fire on 3+ co-occurring techniques, but
  // its verdict is overwritten by the AI verification loop and never reaches
  // a record on its own.
  // The five harm categories are orthogonal to the 14-technique taxonomy:
  // they fire when a post crosses a HARM FLOOR regardless of which
  // manipulation technique applies. The harm-floor scoring is layered
  // on top of these L1 classifiers.
  | 'combined-stack'
  | 'sexual'
  | 'violence-graphic'
  | 'self-harm'
  | 'drug-promotion'
  | 'unsafe-health-experiment'
  | 'extreme-toxicity';

export interface TechniqueResult {
  technique: TechniqueName;
  present: boolean;
  confidence: number;   // 0-1
  severity: number;     // 1-10
  evidence: string[];
}

export interface AnalysisResult {
  postId: string;
  techniques: TechniqueResult[];
  overallScore: number;
  overallConfidence: number;
  isManipulative: boolean;
  processingTimeMs: number;
  /**
   * Carries the model's per-post grounded explanation (1-2 sentences
   * referencing this post's specific content, not a template). Optional:
   * legacy callers and cache hits from before this field landed will not
   * have it.
   */
  explanation?: string;
  /**
   * Model-chosen single dominant technique for this post. The teen panel
   * uses this in the headline. Optional: downstream code falls back to
   * highest-severity confirmed technique.
   */
  primaryTechnique?: TechniqueName;
  /**
   * The measured judge's own reading when JUDGE-V1 produced this analysis
   * (src/core/neutralizer.ts judgeV1Adult; 2026-09-07). The five fields as
   * returned, plus the instrument's id, prompt hash and model, so the record's
   * decision block can name the instrument and carry its reading verbatim.
   * Absent on every other path (legacy judges, rules, cache replays).
   */
  judge?: {
    /**
     * Which instrument decided.
     *
     * `judge-v1` is one model's reading, and is what a record carries when only the
     * first judge ran, which is every item it did not fire on.
     *
     * `judge-v1-pair` is the instrument added 2026-09-21: the same frozen question asked
     * of a second model, with a rewrite happening only where both fire. A record carries
     * it whenever two models actually read the item, whether or not they agreed, because
     * a record that names one reader when two read is as wrong as one that names the
     * wrong company. The rule and its measurement are in src/ai/judge-pair.ts.
     */
    id: 'judge-v1' | 'judge-v1-pair';
    hash: string;
    /** The model, or both models joined by `+` when the pair ran. */
    model: string;
    charged: boolean;
    family: string;
    severity: number;
    effect: string;
    intent: string;
  };
  /**
   * DESCRIPTOR-V1's reading when the measured judge fired (src/ai/descriptor-v1.ts,
   * PLAN-2026-09-15 item 1): what the item does to a person and, for group
   * hostility, which group. Never a severity, never an action. Absent when the
   * judge did not fire, when the call failed, and on every other path.
   */
  descriptorV1?: {
    id: 'descriptor-v1';
    hash: string;
    model: string;
    effect: string;
    target: string;
    group: string;
  };
  /**
   * What the injector should do with this post.
   *   'rewrite'  - calm rewrite replaces original (default; preserves voice
   *                + claim, removes emotional weapon).
   *   'collapse' - post body folded under a placeholder; original preserved
   *                in the forensic chain. Required for generic-group claims
   *                (scapegoating with named ethnic / national / religious /
   *                sexual-orientation target) because softening them
   *                launders propaganda into more-persuasive mainstream form.
   *                Also required for hyperreal-trauma-bait (the artifact IS
   *                the manipulation; nothing to neutralize).
   *   'hide'     - removed from feed entirely; chain still records. Reserved
   *                for direct threats / doxxing / coordinated harassment.
   *
   * Optional: undefined for legacy AnalysisResults (cache hit, legacy
   * chain record, test fixture). Downstream injector treats undefined as
   * 'rewrite' to preserve legacy behavior.
   *
   * The classification of which technique gets which action lives in the
   * detector prompt at src/ai/prompts.ts, not in code - the LLM has the
   * post context to decide whether a scapegoating call names an ethnic
   * group (-> collapse) versus a public official (-> rewrite as
   * political_opinion).
   */
  action?: 'rewrite' | 'collapse' | 'hide';
}
