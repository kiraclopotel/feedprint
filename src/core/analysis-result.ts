// The record every no-cost gate emits (blocklist, slur, coded harm, sponsored, profanity,
// dehumanization, violence-narrating-video, harm floor). Keys stay in this order: the chain
// records and the shape-lock tests depend on it.

import type { AnalysisResult, TechniqueName } from '../types/analysis';

export interface RuleAnalysisInput {
  postId: string;
  /** performance.now() at pipeline entry; elapsed is measured at build time. */
  startTime: number;
  /**
   * Already-measured elapsed time. When given it replaces the startTime
   * measurement (the harm-floor gate measures once and logs the same value).
   */
  processingTimeMs?: number;
  /** Confidence of the rule; also the technique confidence when one is named. */
  confidence: number;
  action: NonNullable<AnalysisResult['action']>;
  /**
   * Naming a technique makes the record manipulative: overallScore and the
   * single technique's severity are `severity`, and primaryTechnique is set.
   * Without one the record is a non-manipulative rule action (score 0, no
   * techniques, no primaryTechnique key).
   */
  technique?: TechniqueName;
  severity?: number;
  evidence?: string[];
}

export function ruleAnalysis(input: RuleAnalysisInput): AnalysisResult {
  const processingTimeMs = input.processingTimeMs ?? performance.now() - input.startTime;
  if (input.technique === undefined) {
    return {
      postId: input.postId,
      isManipulative: false,
      overallScore: 0,
      overallConfidence: input.confidence,
      processingTimeMs,
      techniques: [],
      action: input.action,
    };
  }
  const severity = input.severity ?? 0;
  return {
    postId: input.postId,
    isManipulative: true,
    overallScore: severity,
    overallConfidence: input.confidence,
    processingTimeMs,
    techniques: [{
      technique: input.technique,
      present: true,
      confidence: input.confidence,
      severity,
      evidence: input.evidence ?? [],
    }],
    primaryTechnique: input.technique,
    action: input.action,
  };
}
