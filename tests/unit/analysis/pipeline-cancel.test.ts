/** @vitest-environment jsdom */
// Day 4 Tier 2.1+2.2 — pipeline.ts cancel-branch contract.
//
// Validates the PipelineResult shape returned by `process(post, signal)` when
// the queue's per-item AbortController fires. Two distinct branches:
//   • Pre-flight gate (signal aborted at process() entry)        → cancelStale()
//   • Post-cascade gate (signal aborted after combinedDetectAndNeutralize) →
//     cancelMidFlight(analysis) — verdict payload preserved per VISION §1.1
//     forensic invariant.
//
// The pre-flight gate runs BEFORE any I/O (settings/license/cache/etc) so it
// needs zero mocks. The post-cascade gate runs after a full pipeline cycle
// which is heavily I/O-coupled — covered by the integration test in
// queue.test.ts (stale-drop dispatches no processFn) + the logCancelEvent
// chain-stamp tests in logger-cancel.test.ts. Together these pin the cancel
// contract end-to-end without re-mocking the entire pipeline graph.

import { describe, it, expect } from 'vitest';
import { process } from '../../../src/analysis/pipeline';
import type { PostContent } from '../../../src/types/post';

function makePost(text: string): PostContent {
  return {
    id: 'p1',
    text,
    author: '@u',
    timestamp: new Date().toISOString(),
    platform: 'twitter',
    domRef: new WeakRef(document.createElement('div')),
  };
}

describe('pipeline.process — Tier 2.1 pre-flight cancel-stale gate', () => {
  it('returns action=cancelled, cancelKind=stale on already-aborted signal', async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await process(makePost('any post text long enough'), controller.signal);
    expect(result.action).toBe('cancelled');
    expect(result.cancelKind).toBe('stale');
    // No analysis on stale (pre-API cancel — the cascade never ran).
    expect(result.analysis).toBeUndefined();
  });

  it('pre-flight gate fires BEFORE the too-short / non-substantive gates', async () => {
    // A pre-aborted signal short-circuits even when the text would otherwise
    // route to a different PASS branch. The cancel-stale chain record is
    // forensically distinct from a pre-llm-too-short pass.
    const controller = new AbortController();
    controller.abort();
    const result = await process(makePost('a'), controller.signal);
    expect(result.action).toBe('cancelled');
    expect(result.cancelKind).toBe('stale');
    expect(result.passContext).toBeUndefined();
  });

  it('non-aborted signal does not trip the pre-flight gate', async () => {
    // Sanity: a normal (non-aborted) signal hands the post off to the rest
    // of the pipeline. The text is too short, so we expect a pass — but the
    // KEY assertion is that we DO NOT see action='cancelled'.
    const controller = new AbortController();
    const result = await process(makePost('a'), controller.signal);
    expect(result.action).not.toBe('cancelled');
    expect(result.cancelKind).toBeUndefined();
  });

  it('omitted signal preserves pre-Tier-2 behavior (legacy callers unaffected)', async () => {
    // Tests that omit the signal arg should see exactly the pre-Tier-2.1
    // behavior. This guards against accidentally breaking the optional
    // signal contract.
    const result = await process(makePost('a'));
    expect(result.action).not.toBe('cancelled');
  });
});
