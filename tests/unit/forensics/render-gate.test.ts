/** @vitest-environment jsdom */
// Day 4 Tier 2.3 — anchor-revalidation render-gate.
//
// Validates the gate's three-way decision in code form (ARCH §3 + VISION §1.1):
//   • 'match'        — proceed with render
//   • 'dom-recycled' — suppress UI + emit CANCEL_LOG verdict='cancelled-dom-recycled'
//   • 'dom-gone'     — suppress UI + emit CANCEL_LOG verdict='cancelled-dom-gone'
//
// The full integration (index.ts:onProcessingResult / flushBatch) consumes the
// `verifyAnchorMatch` + `cancelVerdictFor` pair from anchor-revalidation.ts.
// This test file pins the gate's decision behavior end-to-end on real DOM
// (jsdom-attached HTMLElement + WeakRef). The chain-stamping side is covered
// by tests/unit/forensics/logger-cancel.test.ts (the logCancelEvent contract for the
// four cancel-* verdicts).

import { describe, it, expect } from 'vitest';
import {
  verifyAnchorMatch,
  cancelVerdictFor,
} from '../../../src/forensics/anchor-revalidation';
import { computeAnchorKey } from '../../../src/core/anchor-key';
import type { PostContent } from '../../../src/types/post';

function makePost(id: string, text: string, attached = true): {
  post: PostContent;
  element: HTMLElement;
} {
  const el = document.createElement('div');
  el.textContent = text;
  if (attached) document.body.appendChild(el);
  return {
    post: {
      id,
      text,
      author: 'a',
      timestamp: new Date().toISOString(),
      platform: 'twitter',
      domRef: new WeakRef(el),
    },
    element: el,
  };
}

describe('render-gate — Tier 2.3 anchor-revalidation contract', () => {
  it('match path: renders through (gate returns "match")', () => {
    const { post } = makePost('p1', 'a post that survives until render');
    const verification = verifyAnchorMatch(computeAnchorKey(post), post, post.domRef);
    expect(verification).toBe('match');
    // Production code: caller proceeds with renderTeenMarker / injectIntoElement.
    // cancelVerdictFor('match') returns null — no CANCEL_LOG to emit.
    expect(cancelVerdictFor(verification)).toBeNull();
  });

  it('dom-recycled path: gate fires "dom-recycled" + maps to cancelled-dom-recycled verdict', () => {
    const { post, element } = makePost('p1', 'original post body');
    // Simulate the platform's virtualizer recycling the node for a different post.
    element.textContent = 'completely different post that was recycled into this slot';
    const verification = verifyAnchorMatch(computeAnchorKey(post), post, post.domRef);
    expect(verification).toBe('dom-recycled');
    // Production code path: emitCancelLog(post, 'cancelled-dom-recycled', ...).
    expect(cancelVerdictFor(verification)).toBe('cancelled-dom-recycled');
  });

  it('dom-gone path: gate fires "dom-gone" + maps to cancelled-dom-gone verdict', () => {
    const { post, element } = makePost('p1', 'soon to be detached');
    element.remove();
    const verification = verifyAnchorMatch(computeAnchorKey(post), post, post.domRef);
    expect(verification).toBe('dom-gone');
    expect(cancelVerdictFor(verification)).toBe('cancelled-dom-gone');
  });

  it('dom-gone path: cleared WeakRef fires "dom-gone" too', () => {
    const { post } = makePost('p1', 'about to lose ref');
    const detachedDomRef = {
      deref: () => undefined,
    } as unknown as WeakRef<HTMLElement>;
    const verification = verifyAnchorMatch(computeAnchorKey(post), post, detachedDomRef);
    expect(verification).toBe('dom-gone');
    expect(cancelVerdictFor(verification)).toBe('cancelled-dom-gone');
  });

  it('partial-text recycled DOM (within first 200 chars) is detected', () => {
    // Edge case: anchor key is `id::text.slice(0,200)`. If the recycled post
    // shares the first 200 chars with the original (rare but possible — both
    // are CTAs with identical openings), the gate could miss the recycle.
    // This test pins the contract: when the first 200 chars differ, the gate
    // fires. When they're identical, the gate considers it a match — that's
    // the documented limitation of the non-cryptographic fingerprint per
    // queue.ts:computeAnchorKey JSDoc.
    const longText = 'A'.repeat(150) + ' end of original';
    const { post, element } = makePost('p1', longText);
    expect(verifyAnchorMatch(computeAnchorKey(post), post, post.domRef)).toBe('match');
    // Recycle: differing 200-char prefix → caught.
    element.textContent = 'B'.repeat(150) + ' end of recycled';
    expect(verifyAnchorMatch(computeAnchorKey(post), post, post.domRef)).toBe('dom-recycled');
  });

  it('whitespace-only DOM mutations do NOT trip the gate (textContent normalized via trim)', () => {
    const { post, element } = makePost('p1', 'stable post body');
    // The recomputeAnchorFromDom helper trims live textContent. Adding leading
    // whitespace shouldn't fire dom-recycled (would be a false positive on
    // platforms that pad text nodes).
    element.textContent = '  stable post body  ';
    expect(verifyAnchorMatch(computeAnchorKey(post), post, post.domRef)).toBe('match');
  });

  it('invariant: every non-match verification produces a non-null cancel verdict', () => {
    // Defensive: cancelVerdictFor must NEVER return null for non-match cases.
    // Used by the gate-emitter pattern: `if (cancelVerdict !== null) emit...`.
    expect(cancelVerdictFor('dom-recycled')).not.toBeNull();
    expect(cancelVerdictFor('dom-gone')).not.toBeNull();
    expect(cancelVerdictFor('match')).toBeNull();
  });
});
