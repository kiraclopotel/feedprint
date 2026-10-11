// @vitest-environment jsdom
//
// M22 — fire-and-forget chain-write loss for retained forensic records.
//
// Bug: every FORENSIC_LOG was dispatched via `void safeSendMessage(...)`. The
// service worker resolves the message with { ok: false } when the IndexedDB
// write or the signature fails (service-worker.ts:206-222), but the discarded
// promise meant a FLAGGED / flagged-hidden record could be SILENTLY DROPPED
// from the evidence chain — a forensic-completeness gap (VISION §1.1).
//
// Fix: all five retained-record routes go through `sendHighStakesForensicLog`,
// which awaits the SW response and, on { ok: false }, retains the full message
// in a per-content-realm buffer (max 20, max 3 sends). Flagged/blocked evidence
// has overflow priority so pass traffic cannot evict it.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  sendHighStakesForensicLog,
  _resetForensicRetryBufferForTesting,
  _peekForensicRetryBufferForTesting,
  _flushForensicRetryBufferForTesting,
} from '../../../../src/content/record/forensic-retry';

// Controllable chrome.runtime.sendMessage. Each call shifts the next queued
// response; when the queue empties it resolves { ok: true } (success).
let responseQueue: Array<{ ok: boolean }> = [];
let sendCalls: unknown[] = [];

// M22 callsite wiring: every retained chain write must route through the
// retry buffer instead of a direct safeSendMessage. Paths hoisted so a
// decomposition step re-points one line each.
const RETAINED_WRITE_CALLSITES = [
  'src/content/index.ts',
  'src/content/post-path/late-verdict-cache.ts',
  'src/content/record/post-url.ts',
  'src/content/record/forensic-emit.ts',
  'src/content/comment-batch/queue.ts',
  'src/content/comment-batch/flush.ts',
  'src/content/post-path/result-apply.ts',
  'src/content/protection/protection-terminals.ts',
  'src/content/post-path/video-pipeline.ts',
  'src/content/engagement/ai-content-blocker.ts',
  'src/content/engagement/media-timeout.ts',
  'src/content/engagement/reels-blocker.ts',
];

function queueResponses(...responses: Array<{ ok: boolean }>): void {
  responseQueue = responses;
}

beforeEach(() => {
  sendCalls = [];
  responseQueue = [];
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: {
      id: 'fw-test',
      sendMessage: vi.fn((message: unknown) => {
        sendCalls.push(message);
        const next = responseQueue.shift() ?? { ok: true };
        return Promise.resolve(next);
      }),
    },
  };
  _resetForensicRetryBufferForTesting();
});

afterEach(() => {
  _resetForensicRetryBufferForTesting();
  vi.useRealTimers();
});

function flaggedMessage(text: string) {
  return {
    type: 'FORENSIC_LOG' as const,
    payload: {
      originalText: text,
      neutralizedText: '',
      analysis: {
        postId: text,
        techniques: [{ technique: 'shame-attack', present: true, confidence: 0.9, severity: 8, evidence: [] }],
        overallScore: 8,
        overallConfidence: 0.9,
        isManipulative: true,
        processingTimeMs: 0,
        action: 'hide',
      },
      mode: 'teen',
      platform: 'twitter',
      aiSource: 'cloud',
    } as unknown as Record<string, unknown>,
  };
}

function blockedMessage(text: string) {
  return {
    type: 'BLOCKED_LOG' as const,
    payload: {
      originalText: text,
      platform: 'twitter',
      mode: 'child',
      reason: 'blocked before display',
    } as unknown as Record<string, unknown>,
  };
}

function passMessage(text: string) {
  return {
    type: 'PASS_LOG' as const,
    payload: {
      originalText: text,
      platform: 'twitter',
      mode: 'teen',
      analysis: { action: 'pass' },
    } as unknown as Record<string, unknown>,
  };
}

describe('M22 — retained forensic-record retry buffer', () => {
  it('an ok:false response lands the payload in the retry buffer', async () => {
    queueResponses({ ok: false });
    const disposition = await sendHighStakesForensicLog(flaggedMessage('toxic-1'));

    expect(disposition).toBe('retry-buffered');
    const buf = _peekForensicRetryBufferForTesting();
    expect(buf).toHaveLength(1);
    expect((buf[0] as { originalText: string }).originalText).toBe('toxic-1');
  });

  it('an ok:true response does NOT buffer (no retry needed)', async () => {
    queueResponses({ ok: true });
    const disposition = await sendHighStakesForensicLog(flaggedMessage('clean-send'));

    expect(disposition).toBe('accepted');
    expect(_peekForensicRetryBufferForTesting()).toHaveLength(0);
  });

  it('a buffered payload is re-sent on the next flush and clears when it succeeds', async () => {
    // First send fails → buffered. Flush re-sends; this time the SW accepts it.
    queueResponses({ ok: false }, { ok: true });
    await sendHighStakesForensicLog(flaggedMessage('retry-me'));
    expect(_peekForensicRetryBufferForTesting()).toHaveLength(1);

    const sendsBeforeFlush = sendCalls.length;
    await _flushForensicRetryBufferForTesting();

    // The flush re-sent the payload (one extra chrome.runtime.sendMessage call)
    // and, because the second response was ok:true, the buffer is now empty.
    expect(sendCalls.length).toBe(sendsBeforeFlush + 1);
    expect(_peekForensicRetryBufferForTesting()).toHaveLength(0);
  });

  it('retries an ambiguous transport failure while the extension context is alive', async () => {
    (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error('message channel closed before response'));

    const disposition = await sendHighStakesForensicLog(flaggedMessage('ambiguous-ack'));

    expect(disposition).toBe('retry-buffered');
    expect(_peekForensicRetryBufferForTesting()).toHaveLength(1);
    expect((_peekForensicRetryBufferForTesting()[0] as { originalText: string }).originalText)
      .toBe('ambiguous-ack');
  });

  it('replay keeps the exact delivery id created before the first send', async () => {
    queueResponses({ ok: false }, { ok: true });
    await sendHighStakesForensicLog(flaggedMessage('stable-delivery'));
    await _flushForensicRetryBufferForTesting();

    const first = sendCalls[0] as { deliveryId?: string; deliveryCapturedAt?: string };
    const replay = sendCalls[1] as { deliveryId?: string; deliveryCapturedAt?: string };
    expect(first.deliveryId).toMatch(/^fd-/);
    expect(first.deliveryCapturedAt).toBeTruthy();
    expect(replay.deliveryId).toBe(first.deliveryId);
    expect(replay.deliveryCapturedAt).toBe(first.deliveryCapturedAt);
  });

  it('assigns distinct delivery ids to distinct observations', async () => {
    await sendHighStakesForensicLog(flaggedMessage('delivery-a'));
    await sendHighStakesForensicLog(flaggedMessage('delivery-b'));

    const ids = sendCalls.map(call => (call as { deliveryId?: string }).deliveryId);
    expect(ids[0]).toMatch(/^fd-/);
    expect(ids[1]).toMatch(/^fd-/);
    expect(ids[0]).not.toBe(ids[1]);
  });

  it('replays a blocked observation with its original BLOCKED_LOG message type', async () => {
    queueResponses({ ok: false }, { ok: true });
    await sendHighStakesForensicLog(
      blockedMessage('blocked-media') as unknown as Parameters<typeof sendHighStakesForensicLog>[0],
    );

    await _flushForensicRetryBufferForTesting();

    expect(sendCalls).toHaveLength(2);
    expect(sendCalls[1]).toMatchObject({
      type: 'BLOCKED_LOG',
      payload: expect.objectContaining({ originalText: 'blocked-media' }),
    });
  });

  it('replays a pass observation with its original PASS_LOG message type', async () => {
    queueResponses({ ok: false }, { ok: true });
    await sendHighStakesForensicLog(
      passMessage('served-pass') as unknown as Parameters<typeof sendHighStakesForensicLog>[0],
    );

    await _flushForensicRetryBufferForTesting();

    expect(sendCalls).toHaveLength(2);
    expect(sendCalls[1]).toMatchObject({
      type: 'PASS_LOG',
      payload: expect.objectContaining({ originalText: 'served-pass' }),
    });
  });

  it('a payload that fails AGAIN on flush stays in the buffer', async () => {
    queueResponses({ ok: false }, { ok: false });
    await sendHighStakesForensicLog(flaggedMessage('still-failing'));
    expect(_peekForensicRetryBufferForTesting()).toHaveLength(1);

    await _flushForensicRetryBufferForTesting();

    // Second attempt also failed → re-buffered, not lost.
    expect(_peekForensicRetryBufferForTesting()).toHaveLength(1);
    expect((_peekForensicRetryBufferForTesting()[0] as { originalText: string }).originalText)
      .toBe('still-failing');
  });

  it('the buffer is bounded at 20 and drops the OLDEST on overflow', async () => {
    // 25 consecutive failures; only the most recent 20 may survive.
    queueResponses(...Array.from({ length: 25 }, () => ({ ok: false })));
    for (let i = 0; i < 25; i++) {
      await sendHighStakesForensicLog(flaggedMessage(`f-${i}`));
    }

    const buf = _peekForensicRetryBufferForTesting();
    expect(buf).toHaveLength(20);
    // Oldest (f-0 .. f-4) dropped; newest retained.
    const texts = buf.map((p) => (p as { originalText: string }).originalText);
    expect(texts[0]).toBe('f-5');
    expect(texts[texts.length - 1]).toBe('f-24');
  });

  it('never lets pass traffic evict a flagged observation on overflow', async () => {
    queueResponses(...Array.from({ length: 21 }, () => ({ ok: false })));
    await sendHighStakesForensicLog(flaggedMessage('keep-flagged'));
    for (let i = 0; i < 20; i++) {
      await sendHighStakesForensicLog(
        passMessage(`pass-${i}`) as unknown as Parameters<typeof sendHighStakesForensicLog>[0],
      );
    }

    const texts = _peekForensicRetryBufferForTesting()
      .map((payload) => (payload as { originalText?: string }).originalText);
    expect(texts).toHaveLength(20);
    expect(texts).toContain('keep-flagged');
  });

  it('stops retrying after three failed sends and clears the exhausted entry', async () => {
    queueResponses({ ok: false }, { ok: false }, { ok: false }, { ok: true });
    await sendHighStakesForensicLog(flaggedMessage('bounded-failure'));

    await _flushForensicRetryBufferForTesting();
    await _flushForensicRetryBufferForTesting();
    await _flushForensicRetryBufferForTesting();

    expect(sendCalls).toHaveLength(3);
    expect(_peekForensicRetryBufferForTesting()).toHaveLength(0);
  });

  it('coalesces a second flush while the first flush is still in flight', async () => {
    queueResponses({ ok: false }, { ok: false });
    await sendHighStakesForensicLog(flaggedMessage('first'));
    await sendHighStakesForensicLog(flaggedMessage('second'));

    sendCalls = [];
    let resolveSecond!: (value: { ok: boolean }) => void;
    const secondResponse = new Promise<{ ok: boolean }>((resolve) => {
      resolveSecond = resolve;
    });
    let flushSendCount = 0;
    (globalThis.chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mockImplementation(
      (message: unknown) => {
        sendCalls.push(message);
        flushSendCount++;
        if (flushSendCount === 1) return Promise.resolve({ ok: false });
        if (flushSendCount === 2) return secondResponse;
        return Promise.resolve({ ok: true });
      },
    );

    const firstFlush = _flushForensicRetryBufferForTesting();
    await vi.waitFor(() => expect(sendCalls).toHaveLength(2));

    const overlappingFlush = _flushForensicRetryBufferForTesting();
    await Promise.resolve();
    expect(sendCalls).toHaveLength(2);

    resolveSecond({ ok: true });
    await Promise.all([firstFlush, overlappingFlush]);
  });

  it('a dead-context send (undefined response) does NOT buffer', async () => {
    // chrome.runtime missing → safeSendMessage returns undefined (context dead).
    (globalThis as unknown as { chrome: unknown }).chrome = {};
    const disposition = await sendHighStakesForensicLog(flaggedMessage('orphaned'));

    expect(disposition).toBe('context-lost');
    expect(_peekForensicRetryBufferForTesting()).toHaveLength(0);
  });
});

describe('M22 callsite wiring', () => {
  it('routes every retained chain write through the retry buffer', () => {
    const directRecordSend = /safeSendMessage\(\s*\{\s*type:\s*'(?:FORENSIC_LOG|BLOCKED_LOG|PASS_LOG|CANCEL_LOG|ENVIRONMENT_LOG)'/g;

    for (const file of RETAINED_WRITE_CALLSITES) {
      const source = readFileSync(resolve(process.cwd(), file), 'utf8');
      expect(source.match(directRecordSend) ?? [], file).toEqual([]);
    }
  });
});

