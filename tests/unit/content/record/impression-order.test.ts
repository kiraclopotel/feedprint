// @vitest-environment jsdom
//
// Pure impression-order helper contract (see IMPRESSION_LAYER_V1.md).
//
// The helper assigns a local observed/exposure order at the pre-AI chokepoint so
// the chain can distinguish "observed order" from "write order". These tests pin
// the guarantees the dashboard relies on: monotonic, stable first-seen, and
// independent of any later processing/emit order.

import { describe, it, expect } from 'vitest';
import {
  createImpressionMemo,
  stampImpressionOrder,
} from '../../../../src/content/record/impression-order';
import type { PostContent } from '../../../../src/types/post';

function post(id: string): PostContent {
  // Only post.id is read by the helper; the rest is irrelevant to ordering.
  return { id } as unknown as PostContent;
}

describe('stampImpressionOrder', () => {
  it('assigns a monotonic 1-based sequence in detection order', () => {
    const memo = createImpressionMemo();
    const a = post('a');
    const b = post('b');
    const c = post('c');
    stampImpressionOrder(a, 'ss-1', memo);
    stampImpressionOrder(b, 'ss-1', memo);
    stampImpressionOrder(c, 'ss-1', memo);
    expect(a.observedSequence).toBe(1);
    expect(b.observedSequence).toBe(2);
    expect(c.observedSequence).toBe(3);
  });

  it('stamps surfaceSessionId + an ISO viewportSeenAt', () => {
    const memo = createImpressionMemo();
    const a = post('a');
    stampImpressionOrder(a, 'ss-xyz', memo);
    expect(a.surfaceSessionId).toBe('ss-xyz');
    expect(a.viewportSeenAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
  });

  it('is first-seen stable: re-detection of the same id reuses its sequence/time', () => {
    const memo = createImpressionMemo();
    const first = post('a');
    stampImpressionOrder(first, 'ss-1', memo);
    const firstSeq = first.observedSequence;
    const firstAt = first.viewportSeenAt;

    // Same id observed again later (scroll-back) — fresh PostContent object.
    const again = post('a');
    stampImpressionOrder(again, 'ss-1', memo);
    expect(again.observedSequence).toBe(firstSeq);
    expect(again.viewportSeenAt).toBe(firstAt);
  });

  it('keeps observed order independent of later processing/emit order', () => {
    // A is detected (seen) first; B second. Even if B is "processed" first
    // downstream, A keeps the lower observedSequence — the whole point.
    const memo = createImpressionMemo();
    const a = post('slow-A');
    const b = post('fast-B');
    stampImpressionOrder(a, 'ss-1', memo);
    stampImpressionOrder(b, 'ss-1', memo);
    expect(a.observedSequence!).toBeLessThan(b.observedSequence!);
  });

  it('distinct ids get distinct sequences', () => {
    const memo = createImpressionMemo();
    const seqs = ['a', 'b', 'c', 'd'].map((id) => {
      const p = post(id);
      stampImpressionOrder(p, 'ss-1', memo);
      return p.observedSequence;
    });
    expect(new Set(seqs).size).toBe(4);
  });

  it('caps byPostId and evicts oldest-first so a long session stays bounded (leak fix)', () => {
    const memo = createImpressionMemo();
    const N = 5200; // past the 5000 cap
    for (let i = 0; i < N; i++) stampImpressionOrder(post(`p-${i}`), 'ss-1', memo);
    expect(memo.byPostId.size).toBeLessThanOrEqual(5000);
    expect(memo.byPostId.has('p-0')).toBe(false); // oldest evicted
    expect(memo.byPostId.has(`p-${N - 1}`)).toBe(true); // recent retained
    // The monotonic counter is unaffected by eviction.
    const latest = post('latest');
    stampImpressionOrder(latest, 'ss-1', memo);
    expect(latest.observedSequence).toBe(N + 1);
  });
});
