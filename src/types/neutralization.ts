// FeelingWise - Neutralization types

import { AnalysisResult } from './analysis';

export interface NeutralizedContent {
  postId: string;
  originalHash: string;
  rewrittenText: string;
  analysis: AnalysisResult;
  aiSource: 'local' | 'cloud' | 'rules';
  cloudProvider?: string;
  processingTimeMs: number;
  /**
   * The model whose output `rewrittenText` is, as the reply to that call named
   * it. On the adult path the rewrite is a second call after the judge, so the
   * judge's model is not the writer. Absent on a swear mask, which no model
   * wrote, and when no reply named one.
   */
  writerModel?: string;
}
