// Q69 (wiring W66): the comment marker and the comment swap must act on
// the SAME element. The marker loop verified + recovered recycled anchors
// while the swap loop re-deref'd the raw WeakRef: a green dot could mount
// on recovered comment A while the rewrite landed in recycled node B.
// The marker pass publishes its per-post resolution (resolvedAnchorByPost)
// and the swap loop consumes it: verified element shared, verified-null
// skipped, never guess.
//
// 2026-09-19: "absent falls back to the old deref" used to be the third rule
// here, and it was the hole. The whole marker pass, verification included,
// sits inside `if (showMarkers)`, a per-platform cosmetic toggle a parent can
// turn off. With it off, absent was EVERY post in the batch, and every swap
// ran on an unverified deref. A virtualizer that recycled the node between
// enqueue and flush then got the rewrite written into whatever comment now
// sat in that slot, while the comment that was actually scored stayed
// untouched and visible.
//
// A swap now verifies its own anchor when the marker pass did not. Same two
// calls, both pure reads of the DOM. The marker pass's answer is still used
// unchanged wherever it exists, which is what these locks are for.
//
// Source-locks only: exercising the full flushBatch needs the scorer,
// settings, and three protection managers mocked; the wiring is the whole
// fix and these locks pin it.

import { describe, expect, it } from 'vitest';
import { readSource } from '../../../helpers/read-source';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const INDEX_PATH = 'src/content/comment-batch/flush.ts';
const src = readSource(INDEX_PATH);

describe('Q69 — one anchor resolution shared by marker and swap', () => {
  it('the marker loop publishes the verified/recovered anchor for every verified post', () => {
    // Anchored on the marker loop's own shape, not on the recovery call, which
    // the swap-side resolver now makes too.
    const block = src.match(/let el: HTMLElement \| null = verification === 'match'[\s\S]{0,1600}/)?.[0] ?? '';
    expect(block).toContain('resolvedAnchorByPost.set(post, el);');
    // Published BEFORE the null bail-out, so a verified failure is recorded too.
    expect(block.indexOf('resolvedAnchorByPost.set(post, el);'))
      .toBeLessThan(block.indexOf('if (!el) {'));
  });

  it('the swap loop prefers the marker pass resolution and skips on verified-null', () => {
    const block = src.match(/const resolved = resolvedAnchorByPost\.has\(swap\.post\)[\s\S]{0,500}/)?.[0] ?? '';
    expect(block, 'the marker pass answer is used unchanged when it exists')
      .toContain('resolvedAnchorByPost.get(swap.post)');
    expect(block).toContain('if (!el) { retainOnFailure(); continue; }');
  });

  it('a swap verifies its own anchor when the marker pass never ran', () => {
    // The hole this closed: the marker pass is gated on a cosmetic toggle, so
    // "the marker pass never ran" is the ordinary case for any parent who
    // turned markers off, not a rare one.
    const block = src.match(/const resolved = resolvedAnchorByPost\.has\(swap\.post\)[\s\S]{0,500}/)?.[0] ?? '';
    expect(block, 'no unverified deref on the resolution path')
      .toContain('resolveSwapAnchor(swap.post)');

    const resolver = src.match(/const resolveSwapAnchor =[\s\S]{0,900}/)?.[0] ?? '';
    expect(resolver, 'the same verification the marker pass does')
      .toContain('verifyAnchorMatch(computeAnchorKey(post), post, post.domRef)');
    expect(resolver, 'and the same recovery').toContain('tryRecoverCommentAnchor(');
    expect(resolver, "and the same refusal to guess on a cleared WeakRef")
      .toMatch(/'dom-gone'[\s\S]{0,400}return null;/);
  });

  it('the map is declared beside pendingSwaps in the same flush scope', () => {
    const decl = src.indexOf('const resolvedAnchorByPost = new Map<PostContent, HTMLElement | null>();');
    const swaps = src.indexOf('const pendingSwaps: PendingCommentSwap[] = [];');
    expect(decl).toBeGreaterThan(-1);
    expect(Math.abs(decl - swaps)).toBeLessThan(800);
  });
});
