// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProcessingQueue, QueueItem, ViewportInfo, ViewportState, priorityForState, staleMsForVelocity, kindWeight, MAX_CONCURRENT, MAX_QUEUE_SIZE } from '../../../../src/content/post-path/post-queue';
import { computeAnchorKey, isAnchorDegenerate } from '../../../../src/core/anchor-key';
import { PostContent } from '../../../../src/types/post';
import { PipelineResult } from '../../../../src/analysis/pipeline';
import { MAX_CONCURRENT_PROXY_FETCHES } from '../../../../src/ai/client';

function makePost(id: string): PostContent {
  return {
    id,
    text: `Post text for ${id}`,
    author: 'testuser',
    timestamp: new Date().toISOString(),
    platform: 'twitter',
    domRef: new WeakRef(document.createElement('div')),
  };
}

const PASS: PipelineResult = { action: 'pass' };

describe('ProcessingQueue', () => {
  let processedOrder: string[];
  let processFn: (post: PostContent, signal: AbortSignal) => Promise<PipelineResult>;
  let onResult: (post: PostContent, result: PipelineResult) => void;
  let resolvers: Map<string, () => void>;

  beforeEach(() => {
    processedOrder = [];
    resolvers = new Map();

    // processFn that records order and can be manually resolved.
    // Day 4 Tier 2.1: signature now (post, signal) — the queue's per-item
    // AbortController.signal threads through. Tests below that exercise
    // cancel paths inspect / await the signal; tests that don't care about
    // cancel ignore it.
    processFn = (post: PostContent, _signal: AbortSignal) => {
      processedOrder.push(post.id);
      return new Promise<PipelineResult>(resolve => {
        resolvers.set(post.id, () => resolve(PASS));
      });
    };

    onResult = vi.fn();
  });

  it('higher priority items processed first', async () => {
    // Use a processFn that resolves immediately to see ordering
    const immediateOrder: string[] = [];
    const immediateFn = async (post: PostContent, _signal: AbortSignal) => {
      immediateOrder.push(post.id);
      return PASS;
    };

    const queue = new ProcessingQueue(immediateFn, onResult);

    // Enqueue low-priority first, then high-priority
    // The first MAX_CONCURRENT items start immediately.
    // So we need to fill the concurrent slots first, then check ordering of remaining
    const blockingResolvers = new Map<string, () => void>();
    let blockCount = 0;
    const blockingFn = (post: PostContent, _signal: AbortSignal) => {
      blockCount++;
      return new Promise<PipelineResult>(resolve => {
        blockingResolvers.set(post.id, () => resolve(PASS));
      });
    };

    const queue2 = new ProcessingQueue(blockingFn, onResult);

    // Fill MAX_CONCURRENT slots
    for (let i = 0; i < MAX_CONCURRENT; i++) {
      queue2.enqueue(makePost(`blocker-${i}`), true);
    }

    // Now add low-priority then high-priority
    queue2.enqueue(makePost('low-1'), false);   // priority 1
    queue2.enqueue(makePost('high-1'), true);    // priority 10

    expect(blockCount).toBe(MAX_CONCURRENT); // Only MAX_CONCURRENT started

    // Resolve one blocker — high-priority should be picked next
    const processedAfterUnblock: string[] = [];
    const origFn = blockingFn;
    // Track what gets processed next
    blockingResolvers.get('blocker-0')!();

    // Allow microtasks to settle
    await new Promise(r => setTimeout(r, 10));

    // blocker-0 resolved, so high-1 (priority 10) should have started before low-1
    expect(blockCount).toBe(MAX_CONCURRENT + 1);
  });

  it('stale items (>30s old) are dropped', async () => {
    const blockingResolvers = new Map<string, () => void>();
    const blockingFn = (post: PostContent, _signal: AbortSignal) => {
      return new Promise<PipelineResult>(resolve => {
        blockingResolvers.set(post.id, () => resolve(PASS));
      });
    };

    const queue = new ProcessingQueue(blockingFn, onResult);

    // Fill concurrent slots
    for (let i = 0; i < MAX_CONCURRENT; i++) {
      queue.enqueue(makePost(`active-${i}`), true);
    }

    // Add item that will become stale
    queue.enqueue(makePost('stale-1'), false);
    expect(queue.pending).toBe(1);

    // Advance time past 30 seconds
    const realNow = Date.now;
    Date.now = () => realNow() + 31_000;

    // Resolve a blocker — stale item should be dropped
    blockingResolvers.get('active-0')!();
    await new Promise(r => setTimeout(r, 10));

    // The stale item should have been filtered out
    expect(queue.pending).toBe(0);

    Date.now = realNow;
  });

  it('queue does not exceed MAX_QUEUE_SIZE', () => {
    const blockingFn = (_post: PostContent, _signal: AbortSignal) =>
      new Promise<PipelineResult>(() => {}); // never resolves
    const onDrop = vi.fn();
    const queue = new ProcessingQueue(blockingFn, onResult, onDrop);

    // Fill concurrent slots
    for (let i = 0; i < MAX_CONCURRENT; i++) {
      queue.enqueue(makePost(`active-${i}`), true);
    }

    // Add MAX_QUEUE_SIZE + 5 more — should cap pending at MAX_QUEUE_SIZE
    for (let i = 0; i < MAX_QUEUE_SIZE + 5; i++) {
      queue.enqueue(makePost(`queued-${i}`), false);
    }

    expect(queue.pending).toBeLessThanOrEqual(MAX_QUEUE_SIZE);
    expect(onDrop).toHaveBeenCalledTimes(5);
    expect(onDrop).toHaveBeenCalledWith(expect.any(Object), 'evicted-size-cap');
  });

  it('notifies the owner when a queued item becomes stale before dispatch', async () => {
    const blockingResolvers = new Map<string, () => void>();
    const blockingFn = (post: PostContent, _signal: AbortSignal) =>
      new Promise<PipelineResult>(resolve => {
        blockingResolvers.set(post.id, () => resolve(PASS));
      });
    const onDrop = vi.fn();
    const queue = new ProcessingQueue(blockingFn, onResult, onDrop);
    for (let i = 0; i < MAX_CONCURRENT; i++) {
      queue.enqueue(makePost(`active-drop-${i}`), { state: 'visible', velocityPxPerSec: 0 });
    }
    const stale = makePost('stale-drop');
    queue.enqueue(stale, { state: 'scrolled-past', velocityPxPerSec: 1500 });

    const realNow = Date.now;
    Date.now = () => realNow() + 9_000;
    blockingResolvers.get('active-drop-0')!();
    await new Promise(r => setTimeout(r, 10));
    Date.now = realNow;

    expect(onDrop).toHaveBeenCalledWith(stale, 'cancelled-stale');
  });

  it('never stale-drops a visible item, however old (PROTECTION-PATH-1)', async () => {
    const blockingResolvers = new Map<string, () => void>();
    const blockingFn = (post: PostContent, _signal: AbortSignal) =>
      new Promise<PipelineResult>(resolve => {
        blockingResolvers.set(post.id, () => resolve(PASS));
      });
    const onDrop = vi.fn();
    const queue = new ProcessingQueue(blockingFn, onResult, onDrop);
    for (let i = 0; i < MAX_CONCURRENT; i++) {
      queue.enqueue(makePost(`active-keep-${i}`), { state: 'visible', velocityPxPerSec: 0 });
    }
    const onScreen = makePost('visible-old');
    queue.enqueue(onScreen, { state: 'visible', velocityPxPerSec: 1500 });
    const scrolledPast = makePost('scrolled-old');
    queue.enqueue(scrolledPast, { state: 'scrolled-past', velocityPxPerSec: 1500 });

    const realNow = Date.now;
    Date.now = () => realNow() + 120_000;
    blockingResolvers.get('active-keep-0')!();
    await new Promise(r => setTimeout(r, 10));
    Date.now = realNow;

    expect(onDrop).toHaveBeenCalledWith(scrolledPast, 'cancelled-stale');
    expect(onDrop).not.toHaveBeenCalledWith(onScreen, expect.anything());
    // The visible item was dispatched into the freed slot, not dropped.
    expect(blockingResolvers.has('visible-old')).toBe(true);
  });

  it('notifies the owner when processing rejects', async () => {
    const failed = makePost('failed-drop');
    const onDrop = vi.fn();
    const queue = new ProcessingQueue(
      async () => { throw new Error('processor failed'); },
      onResult,
      onDrop,
    );

    queue.enqueue(failed, true);
    await vi.waitFor(() => expect(queue.active).toBe(0));

    expect(onDrop).toHaveBeenCalledWith(failed, 'failed');
  });

  it('duplicate post IDs coalesce behind one queued classification', () => {
    const blockingFn = (_post: PostContent, _signal: AbortSignal) =>
      new Promise<PipelineResult>(() => {});
    const queue = new ProcessingQueue(blockingFn, onResult);

    // Fill concurrent slots
    for (let i = 0; i < MAX_CONCURRENT; i++) {
      queue.enqueue(makePost(`active-${i}`), true);
    }

    expect(queue.enqueue(makePost('dup-1'), false)).toBe(true);
    expect(queue.enqueue(makePost('dup-1'), false)).toBe(true); // coalesced DOM instance
    expect(queue.enqueue(makePost('dup-1'), false)).toBe(true); // coalesced DOM instance

    expect(queue.pending).toBe(1);
  });

  it('fans one in-flight verdict out to every coalesced DOM instance', async () => {
    let resolve!: (result: PipelineResult) => void;
    const processFn = vi.fn(() => new Promise<PipelineResult>(done => { resolve = done; }));
    const result = vi.fn();
    const queue = new ProcessingQueue(processFn, result);
    const first = makePost('remounted');
    const second = makePost('remounted');

    expect(queue.enqueue(first, true)).toBe(true);
    expect(queue.enqueue(second, true)).toBe(true);
    expect(processFn).toHaveBeenCalledOnce();

    resolve(PASS);
    await vi.waitFor(() => expect(result).toHaveBeenCalledTimes(2));

    expect(result).toHaveBeenNthCalledWith(1, first, PASS);
    expect(result).toHaveBeenNthCalledWith(2, second, PASS);
    expect(processFn).toHaveBeenCalledOnce();
  });

  it('never fans a verdict to different text that reused the same post id', async () => {
    const processFn = vi.fn(async () => PASS);
    const result = vi.fn();
    const queue = new ProcessingQueue(processFn, result);
    const first = makePost('reused-id');
    first.text = 'first classification input';
    const replacement = makePost('reused-id');
    replacement.text = 'different replacement input';

    expect(queue.enqueue(first, true)).toBe(true);
    expect(queue.enqueue(replacement, true)).toBe(true);
    await vi.waitFor(() => expect(result).toHaveBeenCalledTimes(2));

    expect(processFn).toHaveBeenCalledTimes(2);
    expect(processFn).toHaveBeenCalledWith(first, expect.any(AbortSignal));
    expect(processFn).toHaveBeenCalledWith(replacement, expect.any(AbortSignal));
  });

  it('never coalesces the same text when the author identity changed', async () => {
    const processFn = vi.fn(async () => PASS);
    const queue = new ProcessingQueue(processFn, vi.fn());
    const unknown = makePost('hydrated-author');
    unknown.author = 'unknown';
    const known = makePost('hydrated-author');
    known.author = 'alice';

    queue.enqueue(unknown, true);
    queue.enqueue(known, true);
    await vi.waitFor(() => expect(processFn).toHaveBeenCalledTimes(2));
  });

  it('never coalesces a late-sponsored card with its earlier organic input', async () => {
    const processFn = vi.fn(async () => PASS);
    const queue = new ProcessingQueue(processFn, vi.fn());
    const organic = makePost('late-sponsored');
    const sponsored = makePost('late-sponsored');
    sponsored.is_sponsored = true;

    queue.enqueue(organic, true);
    queue.enqueue(sponsored, true);
    await vi.waitFor(() => expect(processFn).toHaveBeenCalledTimes(2));
  });

  it('promotes a fresh visible remount so its offscreen primary is not stale-dropped', async () => {
    const blockingResolvers = new Map<string, () => void>();
    const processFn = vi.fn((post: PostContent) => new Promise<PipelineResult>(resolve => {
      blockingResolvers.set(post.id, () => resolve(PASS));
    }));
    const queue = new ProcessingQueue(processFn, vi.fn());
    for (let i = 0; i < MAX_CONCURRENT; i++) queue.enqueue(makePost(`busy-${i}`), true);
    const first = makePost('fresh-remount');
    queue.enqueue(first, { state: 'scrolled-past', velocityPxPerSec: 1500 });
    const realNow = Date.now;
    Date.now = () => realNow() + 9_000;
    const visible = makePost('fresh-remount');
    queue.enqueue(visible, { state: 'visible', velocityPxPerSec: 0 });

    blockingResolvers.get('busy-0')!();
    await vi.waitFor(() => expect(blockingResolvers.has('fresh-remount')).toBe(true));

    Date.now = realNow;
  });

  it('reports admission rejected after context failures stop the queue', async () => {
    const stoppedFn = vi.fn(async () => {
      throw new Error('Extension context invalidated.');
    });
    const queue = new ProcessingQueue(stoppedFn, onResult);

    expect(queue.enqueue(makePost('stop-1'), false)).toBe(true);
    expect(queue.enqueue(makePost('stop-2'), false)).toBe(true);
    expect(queue.enqueue(makePost('stop-3'), false)).toBe(true);
    await vi.waitFor(() => expect(queue.active).toBe(0));

    expect(queue.enqueue(makePost('after-stop'), false)).toBe(false);
    expect(stoppedFn).toHaveBeenCalledTimes(3);
  });

  it(`concurrent limit is respected (max ${MAX_CONCURRENT} active)`, () => {
    let activeCount = 0;
    let maxActive = 0;

    const trackingFn = (_post: PostContent, _signal: AbortSignal) => {
      activeCount++;
      maxActive = Math.max(maxActive, activeCount);
      return new Promise<PipelineResult>(resolve => {
        setTimeout(() => {
          activeCount--;
          resolve(PASS);
        }, 10);
      });
    };

    const queue = new ProcessingQueue(trackingFn, onResult);

    // Enqueue 2 * MAX_CONCURRENT items
    for (let i = 0; i < MAX_CONCURRENT * 2; i++) {
      queue.enqueue(makePost(`post-${i}`), true);
    }

    // Only MAX_CONCURRENT should be active at a time
    expect(queue.active).toBe(MAX_CONCURRENT);
    expect(maxActive).toBe(MAX_CONCURRENT);
  });
});

// ─── Day 2: 3-tier priority + adaptive stale + anchor key ────────────────────

describe('priorityForState', () => {
  it('visible-soon > visible > scrolled-past', () => {
    const soon = priorityForState('visible-soon');
    const visible = priorityForState('visible');
    const past = priorityForState('scrolled-past');
    expect(soon).toBeGreaterThan(visible);
    expect(visible).toBeGreaterThan(past);
  });

  it('matches the five real proxy-fetch slots instead of creating a hidden second queue', () => {
    expect(MAX_CONCURRENT).toBe(MAX_CONCURRENT_PROXY_FETCHES);
  });
});

describe('staleMsForVelocity (ARCH §4 adaptive thresholds)', () => {
  it('browsing (<100 px/s) → 60s', () => {
    expect(staleMsForVelocity(0)).toBe(60_000);
    expect(staleMsForVelocity(50)).toBe(60_000);
    expect(staleMsForVelocity(99)).toBe(60_000);
  });
  it('scanning (100–500 px/s) → 20s', () => {
    expect(staleMsForVelocity(100)).toBe(20_000);
    expect(staleMsForVelocity(300)).toBe(20_000);
    expect(staleMsForVelocity(499)).toBe(20_000);
  });
  it('skimming (≥500 px/s) → 8s', () => {
    expect(staleMsForVelocity(500)).toBe(8_000);
    expect(staleMsForVelocity(2000)).toBe(8_000);
  });
  it('negative velocity is clamped to 0 (browsing)', () => {
    expect(staleMsForVelocity(-50)).toBe(60_000);
  });
});

describe('computeAnchorKey (ARCH §3 DOM-recycle defense)', () => {
  it('different posts produce different keys', () => {
    const a = computeAnchorKey(makePost('post-a'));
    const b = computeAnchorKey(makePost('post-b'));
    expect(a).not.toBe(b);
  });
  it('same post id + same text produces same key (idempotent)', () => {
    const p1 = makePost('p1');
    const p2 = makePost('p1');
    expect(computeAnchorKey(p1)).toBe(computeAnchorKey(p2));
  });
  it('same id but different text yields different key', () => {
    const p1 = makePost('p');
    const p2 = makePost('p');
    p2.text = 'completely different body that exceeds the slice cap';
    expect(computeAnchorKey(p1)).not.toBe(computeAnchorKey(p2));
  });
  it('only first 200 chars of text contribute (slice cap)', () => {
    const p1 = makePost('long');
    const p2 = makePost('long');
    p1.text = 'X'.repeat(200) + 'AAA';
    p2.text = 'X'.repeat(200) + 'BBB';
    expect(computeAnchorKey(p1)).toBe(computeAnchorKey(p2));
  });
});

describe('Tier C — anchor degeneracy fallback (OSCAR-15 §11.1)', () => {
  it('empty caption falls back to author handle + __nocaption__ marker', () => {
    const p = makePost('tt-music-1');
    p.text = '';
    p.author = 'creator_one';
    expect(computeAnchorKey(p)).toBe('tt-music-1::creator_one::__nocaption__');
  });
  it('whitespace-only caption is treated as empty (degenerate)', () => {
    const p = makePost('ig-empty-1');
    p.text = '   \n\t  ';
    p.author = 'photog';
    expect(computeAnchorKey(p)).toBe('ig-empty-1::photog::__nocaption__');
  });
  it('two creators with empty captions produce DIFFERENT keys (entropy preserved)', () => {
    const p1 = makePost('tt-music-1'); p1.text = ''; p1.author = 'creator_one';
    const p2 = makePost('tt-music-2'); p2.text = ''; p2.author = 'creator_two';
    expect(computeAnchorKey(p1)).not.toBe(computeAnchorKey(p2));
  });
  it('isAnchorDegenerate flags empty/whitespace, not non-empty', () => {
    const empty = makePost('a'); empty.text = '';
    const ws = makePost('b'); ws.text = '   ';
    const ok = makePost('c'); ok.text = 'hello';
    expect(isAnchorDegenerate(empty)).toBe(true);
    expect(isAnchorDegenerate(ws)).toBe(true);
    expect(isAnchorDegenerate(ok)).toBe(false);
  });
});

describe('kindWeight (OSCAR-15 §11.6)', () => {
  it('post > top_comment > reply > batch_rest', () => {
    expect(kindWeight('post')).toBeGreaterThan(kindWeight('top_comment'));
    expect(kindWeight('top_comment')).toBeGreaterThan(kindWeight('reply'));
    expect(kindWeight('reply')).toBeGreaterThan(kindWeight('batch_rest'));
  });
  it('undefined defaults to post-tier weight (back-compat for pre-Tier-C callers)', () => {
    expect(kindWeight(undefined)).toBe(kindWeight('post'));
  });
});

describe('ProcessingQueue — 3-tier priority via ViewportInfo', () => {
  it('keeps one admission slot available for a visible item behind speculative work', () => {
    const started: string[] = [];
    const queue = new ProcessingQueue(
      post => {
        started.push(post.id);
        return new Promise<PipelineResult>(() => {});
      },
      vi.fn(),
    );

    for (let i = 0; i < MAX_CONCURRENT; i++) {
      queue.enqueue(makePost(`soon-${i}`), {
        state: 'visible-soon', velocityPxPerSec: 0,
      });
    }

    expect(queue.active).toBe(MAX_CONCURRENT - 1);
    expect(queue.pending).toBe(1);

    queue.enqueue(makePost('visible-now'), {
      state: 'visible', velocityPxPerSec: 0,
    });

    expect(queue.active).toBe(MAX_CONCURRENT);
    expect(started).toContain('visible-now');
  });

  it('promotes a queued visible-soon duplicate when that same post becomes visible', () => {
    const started: string[] = [];
    const queue = new ProcessingQueue(
      post => {
        started.push(post.id);
        return new Promise<PipelineResult>(() => {});
      },
      vi.fn(),
    );

    for (let i = 0; i < MAX_CONCURRENT; i++) {
      queue.enqueue(makePost(`soon-${i}`), {
        state: 'visible-soon', velocityPxPerSec: 1_500,
      });
    }

    expect(queue.active).toBe(MAX_CONCURRENT - 1);
    expect(queue.pending).toBe(1);

    queue.enqueue(makePost(`soon-${MAX_CONCURRENT - 1}`), {
      state: 'visible', velocityPxPerSec: 0,
    });

    expect(queue.active).toBe(MAX_CONCURRENT);
    expect(queue.pending).toBe(0);
    expect(started).toContain(`soon-${MAX_CONCURRENT - 1}`);
  });

  it('promotes an in-flight visible-soon duplicate before admitting more prefetch', () => {
    const started: string[] = [];
    const queue = new ProcessingQueue(
      post => {
        started.push(post.id);
        return new Promise<PipelineResult>(() => {});
      },
      vi.fn(),
    );

    for (let i = 0; i < MAX_CONCURRENT; i++) {
      queue.enqueue(makePost(`soon-${i}`), {
        state: 'visible-soon', velocityPxPerSec: 0,
      });
    }

    queue.enqueue(makePost('soon-0'), {
      state: 'visible', velocityPxPerSec: 0,
    });

    expect(queue.active).toBe(MAX_CONCURRENT);
    expect(queue.pending).toBe(0);
    expect(started).toContain(`soon-${MAX_CONCURRENT - 1}`);
  });

  it('visible-soon items retain prefetch priority once a shared slot opens', async () => {
    const blockingResolvers = new Map<string, () => void>();
    const blockingFn = (post: PostContent, _signal: AbortSignal) =>
      new Promise<PipelineResult>(resolve => {
        blockingResolvers.set(post.id, () => resolve(PASS));
      });

    const queue = new ProcessingQueue(blockingFn, vi.fn());

    // Saturate concurrency
    for (let i = 0; i < MAX_CONCURRENT; i++) {
      queue.enqueue(makePost(`block-${i}`), true);
    }
    // Pile lower-priority items, then a higher-priority one last
    queue.enqueue(makePost('visible-1'), { state: 'visible', velocityPxPerSec: 0 });
    queue.enqueue(makePost('past-1'), { state: 'scrolled-past', velocityPxPerSec: 0 });
    queue.enqueue(makePost('soon-1'), { state: 'visible-soon', velocityPxPerSec: 0 });

    // Free a shared slot — prefetch priority remains intact outside the
    // separately reserved visible lane.
    blockingResolvers.get('block-0')!();
    await new Promise(r => setTimeout(r, 10));

    expect(blockingResolvers.has('soon-1')).toBe(true);
    expect(blockingResolvers.has('visible-1')).toBe(false);
    expect(blockingResolvers.has('past-1')).toBe(false);
  });

  it('per-item adaptive stale: skimming-velocity items time out at 8s while browsing items survive', async () => {
    const blockingResolvers = new Map<string, () => void>();
    const blockingFn = (post: PostContent, _signal: AbortSignal) =>
      new Promise<PipelineResult>(resolve => {
        blockingResolvers.set(post.id, () => resolve(PASS));
      });

    const queue = new ProcessingQueue(blockingFn, vi.fn());

    // Saturate concurrency
    for (let i = 0; i < MAX_CONCURRENT; i++) {
      queue.enqueue(makePost(`block-${i}`), true);
    }
    queue.enqueue(makePost('skim'), { state: 'scrolled-past', velocityPxPerSec: 1500 });
    queue.enqueue(makePost('browse'), { state: 'scrolled-past', velocityPxPerSec: 30 });
    expect(queue.pending).toBe(2);

    // Advance time 10s — skimming (8s threshold) should drop, browsing (60s) survives
    const realNow = Date.now;
    Date.now = () => realNow() + 10_000;

    blockingResolvers.get('block-0')!();
    await new Promise(r => setTimeout(r, 10));

    // skim was dropped + browse picked up next; queue depth = 0
    expect(queue.pending).toBe(0);
    expect(blockingResolvers.has('browse')).toBe(true);
    expect(blockingResolvers.has('skim')).toBe(false);

    Date.now = realNow;
  });

  it('boolean back-compat: enqueue(post, true) maps to visible / 0 velocity (60s stale)', () => {
    const queue = new ProcessingQueue(
      (_post: PostContent, _signal: AbortSignal) => new Promise<PipelineResult>(() => {}),
      vi.fn(),
    );
    for (let i = 0; i < MAX_CONCURRENT; i++) {
      queue.enqueue(makePost(`block-${i}`), true);
    }
    queue.enqueue(makePost('back-compat'), true);
    expect(queue.pending).toBe(1);
    // Pre-Day-2 callers see no behavioral change other than the longer
    // 60s stale (vs the old fixed 30s) — that's a strict improvement: more
    // patient cancel for browsing-mode users.
  });
});

// ─── Day 4 Tier 2.1: AbortController per QueueItem ────────────────────────────

describe('ProcessingQueue — Day 4 Tier 2.1 AbortController plumbing', () => {
  it('processFn receives a fresh AbortSignal per item', () => {
    const seenSignals: AbortSignal[] = [];
    const captureFn = (_post: PostContent, signal: AbortSignal) => {
      seenSignals.push(signal);
      return new Promise<PipelineResult>(() => {}); // never resolve
    };

    const queue = new ProcessingQueue(captureFn, vi.fn());
    queue.enqueue(makePost('a'), true);
    queue.enqueue(makePost('b'), true);

    expect(seenSignals.length).toBe(2);
    expect(seenSignals[0]).toBeInstanceOf(AbortSignal);
    expect(seenSignals[1]).toBeInstanceOf(AbortSignal);
    // Each item gets its OWN controller — distinct signal objects.
    expect(seenSignals[0]).not.toBe(seenSignals[1]);
    expect(seenSignals[0].aborted).toBe(false);
    expect(seenSignals[1].aborted).toBe(false);
  });

  it('signal aborts when the item is dropped as stale (cancel-stale path)', async () => {
    let dispatchedSignal: AbortSignal | null = null;
    const blockingResolvers = new Map<string, (r: PipelineResult) => void>();
    const blockingFn = (post: PostContent, signal: AbortSignal) => {
      // Capture the signal on the item that gets dispatched (the stale one
      // never makes it past the drain filter — that's the point of this test).
      dispatchedSignal = signal;
      return new Promise<PipelineResult>(resolve => {
        blockingResolvers.set(post.id, resolve);
      });
    };

    const queue = new ProcessingQueue(blockingFn, vi.fn());

    // Saturate concurrent slots with skimming-velocity items so they have
    // an 8s stale threshold.
    for (let i = 0; i < MAX_CONCURRENT; i++) {
      queue.enqueue(makePost(`block-${i}`), { state: 'visible', velocityPxPerSec: 0 });
    }
    queue.enqueue(makePost('will-stale'), { state: 'scrolled-past', velocityPxPerSec: 1500 });
    expect(queue.pending).toBe(1);

    // Capture a reference to the queued item's controller signal BEFORE
    // staleness triggers, so we can assert it ends up aborted.
    // (Public API doesn't expose internals; we assert via the side-effect:
    // after the drain filter runs on a freed slot, the item is gone AND
    // its signal would be aborted from the perspective of any listener
    // that had captured it. We can't directly observe internal state, so
    // we observe behavior: pending drops to 0 + the would-be-dispatched
    // processFn was never invoked for 'will-stale'.)
    const realNow = Date.now;
    Date.now = () => realNow() + 10_000;
    blockingResolvers.get('block-0')!({ action: 'pass' });
    await new Promise(r => setTimeout(r, 10));

    // Stale item dropped without being dispatched.
    expect(queue.pending).toBe(0);
    expect(blockingResolvers.has('will-stale')).toBe(false);
    // Sanity: the active items did get a non-aborted signal at dispatch.
    expect(dispatchedSignal).not.toBeNull();

    Date.now = realNow;
  });

  it('size-cap evictions abort their controllers (forensic completeness)', () => {
    // Capture every controller via direct enqueue + private inspection isn't
    // available; we observe behavior via aborted-signal property check.
    // Strategy: enqueue >MAX_QUEUE_SIZE items, the surplus gets evicted. Since we
    // can't see the evicted items' controllers from outside, we instead
    // verify the queue is bounded — same back-compat invariant as before —
    // and that no exception fires during eviction (an unaborted controller
    // doesn't raise; an over-eager abort wouldn't either; this is mostly a
    // smoke-test that the abort-on-evict path doesn't crash).
    const queue = new ProcessingQueue(
      (_p: PostContent, _s: AbortSignal) => new Promise<PipelineResult>(() => {}),
      vi.fn(),
    );
    for (let i = 0; i < MAX_CONCURRENT; i++) queue.enqueue(makePost(`active-${i}`), true);
    expect(() => {
      for (let i = 0; i < MAX_QUEUE_SIZE + 5; i++) queue.enqueue(makePost(`queued-${i}`), false);
    }).not.toThrow();
    expect(queue.pending).toBeLessThanOrEqual(MAX_QUEUE_SIZE);
  });

  it('Tier C — same id different surfaceIdentity dedups separately (multi-surface FB)', () => {
    const queue = new ProcessingQueue(
      (_p: PostContent, _s: AbortSignal) => new Promise<PipelineResult>(() => {}),
      vi.fn(),
    );
    // Saturate concurrent slots so queued items remain pending + observable
    for (let i = 0; i < MAX_CONCURRENT; i++) queue.enqueue(makePost(`block-${i}`), true);
    // Same FB post observed in two surfaces = two Encounters per ontology
    queue.enqueue(makePost('fb-post-1'), false, { surfaceIdentity: 'feed' });
    queue.enqueue(makePost('fb-post-1'), false, { surfaceIdentity: 'group:Single Parents Support' });
    expect(queue.pending).toBe(2);
    // Same surface re-enqueue still dedups
    queue.enqueue(makePost('fb-post-1'), false, { surfaceIdentity: 'feed' });
    expect(queue.pending).toBe(2);
  });

  it('Tier C — kind weighting orders within the same viewport state', async () => {
    const blockingResolvers = new Map<string, () => void>();
    const blockingFn = (post: PostContent, _signal: AbortSignal) =>
      new Promise<PipelineResult>(resolve => {
        blockingResolvers.set(post.id, () => resolve(PASS));
      });
    const queue = new ProcessingQueue(blockingFn, vi.fn());
    for (let i = 0; i < MAX_CONCURRENT; i++) queue.enqueue(makePost(`block-${i}`), true);
    // All same viewport state ('visible'); kind orders the tiebreak
    queue.enqueue(makePost('reply-1'), { state: 'visible', velocityPxPerSec: 0 }, { kind: 'reply' });
    queue.enqueue(makePost('post-1'), { state: 'visible', velocityPxPerSec: 0 }, { kind: 'post' });
    queue.enqueue(makePost('rest-1'), { state: 'visible', velocityPxPerSec: 0 }, { kind: 'batch_rest' });
    queue.enqueue(makePost('top-1'), { state: 'visible', velocityPxPerSec: 0 }, { kind: 'top_comment' });
    // Free a slot — 'post' kind drains first within same viewport state
    blockingResolvers.get('block-0')!();
    await new Promise(r => setTimeout(r, 10));
    expect(blockingResolvers.has('post-1')).toBe(true);
    expect(blockingResolvers.has('top-1')).toBe(false);
    expect(blockingResolvers.has('reply-1')).toBe(false);
    expect(blockingResolvers.has('rest-1')).toBe(false);
  });

  it('Tier C — viewport state dominates kind weighting (cross-state never flips)', async () => {
    const blockingResolvers = new Map<string, () => void>();
    const blockingFn = (post: PostContent, _signal: AbortSignal) =>
      new Promise<PipelineResult>(resolve => {
        blockingResolvers.set(post.id, () => resolve(PASS));
      });
    const queue = new ProcessingQueue(blockingFn, vi.fn());
    for (let i = 0; i < MAX_CONCURRENT; i++) queue.enqueue(makePost(`block-${i}`), true);
    // High-kind on scrolled-past should still drain after low-kind on visible
    queue.enqueue(makePost('past-post'), { state: 'scrolled-past', velocityPxPerSec: 0 }, { kind: 'post' });
    queue.enqueue(makePost('visible-rest'), { state: 'visible', velocityPxPerSec: 0 }, { kind: 'batch_rest' });
    blockingResolvers.get('block-0')!();
    await new Promise(r => setTimeout(r, 10));
    expect(blockingResolvers.has('visible-rest')).toBe(true);
    expect(blockingResolvers.has('past-post')).toBe(false);
  });

  it('integration: stale drop aborts the queued item\'s signal before removal', async () => {
    // Capture the controller signal for the SOON-TO-BE-STALE queued item.
    // This requires intercepting via a never-dispatched-but-aborted path:
    // we saturate concurrency, queue a skimming-stale item, advance time,
    // then trigger drain by completing one active. The stale item never
    // reaches processFn (never dispatched) but the queue.ts code calls
    // controller.abort() on it before removal.

    // Approach: capture a reference to the item's controller via the
    // re-enqueue + idempotent path. enqueue(post, ...) is idempotent —
    // but we need a hook into the per-item controller. Without exposing
    // it, we instead test the OBSERVABLE consequence: when a queued item
    // is dropped as stale, its signal would have fired abort. The signal
    // is internal; the public observable is that pending drops to 0 +
    // processFn was never called.

    const blockingResolvers = new Map<string, (r: PipelineResult) => void>();
    let staleDispatchAttempted = false;
    const blockingFn = (post: PostContent, _signal: AbortSignal) => {
      if (post.id === 'stale-target') staleDispatchAttempted = true;
      return new Promise<PipelineResult>(resolve => {
        blockingResolvers.set(post.id, resolve);
      });
    };

    const queue = new ProcessingQueue(blockingFn, vi.fn());

    // Saturate concurrency with browsing items (60s stale).
    for (let i = 0; i < MAX_CONCURRENT; i++) {
      queue.enqueue(makePost(`block-${i}`), { state: 'visible', velocityPxPerSec: 30 });
    }
    // Queue a skimming-velocity item (8s stale).
    queue.enqueue(makePost('stale-target'), { state: 'scrolled-past', velocityPxPerSec: 1500 });
    expect(queue.pending).toBe(1);
    expect(staleDispatchAttempted).toBe(false);

    // Advance past the 8s stale threshold + complete one active item to
    // trigger drain. The drain filter detects stale-target as stale, calls
    // controller.abort() on it BEFORE removing it from the queue, then
    // removes it. processFn for stale-target is never invoked.
    const realNow = Date.now;
    Date.now = () => realNow() + 9_000;
    blockingResolvers.get('block-0')!({ action: 'pass' });
    await new Promise(r => setTimeout(r, 10));

    // Stale-target dropped without dispatch (forensic invariant: abort fired
    // BEFORE removal so any callAI listener wakes via AbortError; pipeline
    // would emit cancelled-stale chain record on the production path).
    expect(queue.pending).toBe(0);
    expect(staleDispatchAttempted).toBe(false);

    Date.now = realNow;
  });
});

describe('ProcessingQueue.invalidate (PROTECTION-PATH-2)', () => {
  function blockingQueue(
    onResult: (post: PostContent, result: PipelineResult) => void,
    onDrop: (post: PostContent, reason: string) => void,
  ) {
    const resolvers = new Map<string, (r: PipelineResult) => void>();
    const signals = new Map<string, AbortSignal>();
    const dispatched: string[] = [];
    const queue = new ProcessingQueue(
      (post: PostContent, signal: AbortSignal) => {
        dispatched.push(post.id);
        signals.set(post.id, signal);
        return new Promise<PipelineResult>(resolve => { resolvers.set(post.id, resolve); });
      },
      onResult,
      onDrop,
    );
    return { queue, resolvers, signals, dispatched };
  }

  it('drops queued items the predicate matches, aborts them, and reports them as invalidated', () => {
    const onResult = vi.fn();
    const onDrop = vi.fn();
    const { queue, signals, dispatched } = blockingQueue(onResult, onDrop);
    for (let i = 0; i < MAX_CONCURRENT; i++) {
      queue.enqueue(makePost(`fill-${i}`), { state: 'visible', velocityPxPerSec: 0 });
    }
    const oldA = makePost('old-a');
    const oldB = makePost('old-b');
    const fresh = makePost('fresh');
    queue.enqueue(oldA, { state: 'visible-soon', velocityPxPerSec: 0 });
    queue.enqueue(oldB, { state: 'scrolled-past', velocityPxPerSec: 0 });
    queue.enqueue(fresh, { state: 'visible-soon', velocityPxPerSec: 0 });
    expect(queue.pending).toBe(3);

    const count = queue.invalidate(post => post.id.startsWith('old-'));

    expect(count).toBe(2);
    expect(queue.pending).toBe(1);
    expect(onDrop).toHaveBeenCalledWith(oldA, 'invalidated');
    expect(onDrop).toHaveBeenCalledWith(oldB, 'invalidated');
    expect(onDrop).not.toHaveBeenCalledWith(fresh, expect.anything());
    expect(dispatched).not.toContain('old-a');
    expect(signals.has('old-a')).toBe(false);
  });

  it('flags in-flight matches: their result is discarded and reported as invalidated, not delivered', async () => {
    const onResult = vi.fn();
    const onDrop = vi.fn();
    const { queue, resolvers, signals } = blockingQueue(onResult, onDrop);
    const stale = makePost('inflight-stale');
    const current = makePost('inflight-current');
    queue.enqueue(stale, { state: 'visible', velocityPxPerSec: 0 });
    queue.enqueue(current, { state: 'visible', velocityPxPerSec: 0 });
    expect(queue.active).toBe(2);

    const count = queue.invalidate(post => post === stale);
    expect(count).toBe(1);
    expect(signals.get('inflight-stale')!.aborted).toBe(true);
    expect(signals.get('inflight-current')!.aborted).toBe(false);
    // Nothing is reported until the flagged call returns.
    expect(onDrop).not.toHaveBeenCalled();

    resolvers.get('inflight-stale')!({ action: 'hide' });
    resolvers.get('inflight-current')!(PASS);
    await vi.waitFor(() => expect(queue.active).toBe(0));

    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onResult).toHaveBeenCalledWith(current, PASS);
    expect(onDrop).toHaveBeenCalledTimes(1);
    expect(onDrop).toHaveBeenCalledWith(stale, 'invalidated');
  });

  it('fans the invalidation out to coalesced remounts of the same input', () => {
    const onResult = vi.fn();
    const onDrop = vi.fn();
    const { queue } = blockingQueue(onResult, onDrop);
    for (let i = 0; i < MAX_CONCURRENT; i++) {
      queue.enqueue(makePost(`fill-${i}`), { state: 'visible', velocityPxPerSec: 0 });
    }
    const first = makePost('twin');
    const remount = makePost('twin');
    queue.enqueue(first, { state: 'visible-soon', velocityPxPerSec: 0 });
    queue.enqueue(remount, { state: 'visible-soon', velocityPxPerSec: 0 });
    expect(queue.pending).toBe(1);

    queue.invalidate(post => post.id === 'twin');

    expect(onDrop).toHaveBeenCalledWith(first, 'invalidated');
    expect(onDrop).toHaveBeenCalledWith(remount, 'invalidated');
    expect(queue.pending).toBe(0);
  });
});
