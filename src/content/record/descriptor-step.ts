// FeelingWise — the DESCRIPTOR-V1 step, between the pipeline and the record.
//
// PLAN-2026-09-15 item 1. When the measured judge fired on an item, one more
// call names what the item does to a person and, for group hostility, which
// group (src/ai/descriptor-v1.ts). It lives here, in the content layer, because
// the pipeline may not import the ai layer (ARCHITECTURE-1).
//
// Two rules keep it from costing the reader anything:
//   • the verdict is handed on at once; the call runs beside the page's hide,
//     mark or rewrite, never in front of it;
//   • only the record waits for the reading, and for at most
//     DESCRIPTOR_WAIT_MS. A failed, cancelled, malformed or slow call leaves
//     the record exactly as it would have been without the step.
// It never changes the action, the technique, the severity or the rewrite.

import { judgeKindFor, type PipelineResult } from '../../analysis/pipeline';
import type { AnalysisResult } from '../../types/analysis';
import type { PostContent } from '../../types/post';
import { askDescriptorV1, DESCRIPTOR_V1_HASH, DESCRIPTOR_V1_MODEL } from '../../ai/descriptor-v1';

type Process = (post: PostContent, signal?: AbortSignal) => Promise<PipelineResult>;
type Ask = typeof askDescriptorV1;

/** How long a record write waits for the reading before it goes without it. */
const DESCRIPTOR_WAIT_MS = 4000;

const pending = new WeakMap<AnalysisResult, Promise<void>>();

/** The analysis the judge fired on, wherever the result carries it; null on every other result. */
function firedJudgeAnalysis(result: PipelineResult): AnalysisResult | null {
  if (result.action === 'pass' || result.action === 'cancelled') return null;
  const analysis = result.neutralized?.analysis ?? result.analysis;
  if (!analysis?.judge || !analysis.isManipulative) return null;
  return analysis;
}

/** Wrap the pipeline so a fired judge result starts DESCRIPTOR-V1 beside it. */
export function withDescriptorV1(process: Process, ask: Ask = askDescriptorV1): Process {
  return async (post, signal) => {
    const result = await process(post, signal);
    const analysis = firedJudgeAnalysis(result);
    if (!analysis || analysis.descriptorV1 || pending.has(analysis) || signal?.aborted) return result;
    pending.set(analysis, ask({
      text: post.text,
      platform: post.platform,
      kind: judgeKindFor(post.kind),
      parentText: post.parentText,
    }).then(
      (reading) => {
        if (reading) analysis.descriptorV1 = { id: 'descriptor-v1', hash: DESCRIPTOR_V1_HASH, model: DESCRIPTOR_V1_MODEL, ...reading };
      },
      () => undefined, // the verdict stands without the reading
    ));
    return result;
  };
}

/** Wait, for at most `ms`, for the reading the step started for this analysis. Resolves at once when none was started. */
export async function descriptorV1Settled(analysis: AnalysisResult | undefined, ms: number = DESCRIPTOR_WAIT_MS): Promise<void> {
  const p = analysis ? pending.get(analysis) : undefined;
  if (!p) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([p, new Promise<void>((resolve) => { timer = setTimeout(resolve, ms); })]);
  if (timer !== undefined) clearTimeout(timer);
}
