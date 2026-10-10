// @vitest-environment jsdom
//
// A hide happened, the service worker did not confirm the record, the parent
// navigated, and the record was gone. No counter, no log, nothing in the chain
// saying an attempt was ever made.
//
// The service worker's durable outbox does NOT rescue this. The buffer is fed
// from exactly two conditions, and neither leaves a copy the SW can replay on
// its own:
//
//   • an explicit { ok: false } — the SW's only reachable failure path is
//     `enqueueForensicDelivery` rejecting inside `sharedChainWriteLock`, which
//     means the IDB transaction aborted and nothing reached the outbox
//     (`service-worker.ts` FORENSIC_DELIVERY_TYPES branch); and
//   • an `undefined` response while the context is alive — the SW may have
//     enqueued before the response channel died, or may never have received the
//     message. The outbox covers only the first half of that, and nothing on
//     the content side can tell them apart.
//
// So this buffer holds the only copy. It lives in page memory behind a 4s
// timer. This file locks the pagehide behavior that keeps it alive, and the
// counters that make its failure visible instead of invisible.
//
// Own file, not appended to forensic-log-retry.test.ts: that file's
// dead-context test sets `chrome = {}`, which flips context-guard's one-way
// module flag and silently starves every test declared after it.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  sendHighStakesForensicLog,
  _resetForensicRetryBufferForTesting,
  _peekForensicRetryBufferForTesting,
  _flushForensicRetryOnUnloadForTesting,
} from '../../../src/content/record/forensic-retry';
import {
  _resetDiagnosticsForTesting,
  _getDiagnosticCountersForTesting,
} from '../../../src/diagnostics/diagnostics';

let responseQueue: Array<{ ok: boolean }> = [];
let sendCalls: unknown[] = [];

beforeEach(() => {
  sendCalls = [];
  responseQueue = [];
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: {
      sendMessage: vi.fn((message: unknown) => {
        sendCalls.push(message);
        return Promise.resolve(responseQueue.shift() ?? { ok: true });
      }),
    },
  };
  _resetForensicRetryBufferForTesting();
  _resetDiagnosticsForTesting();
});

afterEach(() => {
  _resetForensicRetryBufferForTesting();
});

function queueResponses(...responses: Array<{ ok: boolean }>): void {
  responseQueue = responses;
}

function flaggedMessage(text: string) {
  return {
    type: 'FORENSIC_LOG' as const,
    payload: {
      originalText: text,
      neutralizedText: '',
      analysis: { postId: text, action: 'hide' },
      mode: 'teen',
      platform: 'twitter',
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

describe('forensic retry buffer survives a page unload', () => {
  it('re-sends every buffered record at pagehide instead of letting the page take them', async () => {
    queueResponses({ ok: false }, { ok: false });
    await sendHighStakesForensicLog(flaggedMessage('hidden-then-navigated'));
    await sendHighStakesForensicLog(blockedMessage('blocked-then-navigated'));
    expect(_peekForensicRetryBufferForTesting()).toHaveLength(2);

    const sendsBefore = sendCalls.length;
    _flushForensicRetryOnUnloadForTesting();

    expect(sendCalls.length - sendsBefore).toBe(2);
    const resent = sendCalls.slice(sendsBefore) as Array<{ payload: { originalText: string } }>;
    expect(resent.map(m => m.payload.originalText)).toEqual([
      'hidden-then-navigated',
      'blocked-then-navigated',
    ]);
  });

  it('leaves the buffer intact, because pagehide also fires into bfcache', async () => {
    // If the realm survives, the 4s timer must still own these entries. A
    // duplicate arriving after a successful resend is dropped by the SW, which
    // keys the outbox and its receipts by deliveryId, so re-sending twice is
    // safe and dropping early is not.
    queueResponses({ ok: false });
    await sendHighStakesForensicLog(flaggedMessage('bfcache-survivor'));

    _flushForensicRetryOnUnloadForTesting();

    expect(_peekForensicRetryBufferForTesting()).toHaveLength(1);
  });

  it('re-sends carry the SAME delivery id, so a duplicate cannot fork the record', async () => {
    queueResponses({ ok: false });
    await sendHighStakesForensicLog(flaggedMessage('one-record-only'));
    const first = sendCalls[0] as { deliveryId: string };

    _flushForensicRetryOnUnloadForTesting();
    const resent = sendCalls[sendCalls.length - 1] as { deliveryId: string };

    expect(first.deliveryId).toMatch(/^fd-/);
    expect(resent.deliveryId).toBe(first.deliveryId);
  });

  it('counts what it flushed, and counts high-stakes records separately', async () => {
    queueResponses({ ok: false }, { ok: false }, { ok: false });
    await sendHighStakesForensicLog(flaggedMessage('flagged-1'));
    await sendHighStakesForensicLog(blockedMessage('blocked-1'));
    await sendHighStakesForensicLog(passMessage('pass-1'));

    _flushForensicRetryOnUnloadForTesting();

    const counters = _getDiagnosticCountersForTesting();
    expect(counters.forensicRetryUnloadFlush).toBe(3);
    expect(counters.forensicRetryUnloadFlushHighStakes).toBe(2);
    expect(counters.forensicRetryUnloadUnreachable).toBeUndefined();
  });

  it('an empty buffer at pagehide bumps nothing, so the counter means what it says', () => {
    _flushForensicRetryOnUnloadForTesting();

    const counters = _getDiagnosticCountersForTesting();
    expect(counters.forensicRetryUnloadFlush).toBeUndefined();
    expect(counters.forensicRetryUnloadUnreachable).toBeUndefined();
  });

  it('a dead extension context counts as unreachable and sends nothing', async () => {
    // Fresh module graph: context-guard's invalidated flag is module-level and
    // one-way by design, so it is isolated here rather than given a production
    // reset seam (same approach as license-cache.test.ts).
    vi.resetModules();
    const retry = await import('../../../src/content/record/forensic-retry');
    const guard = await import('../../../src/storage/context-guard');
    const diag = await import('../../../src/diagnostics/diagnostics');
    diag._resetDiagnosticsForTesting();

    queueResponses({ ok: false });
    await retry.sendHighStakesForensicLog(flaggedMessage('orphaned-realm'));
    expect(retry._peekForensicRetryBufferForTesting()).toHaveLength(1);
    const sendsBefore = sendCalls.length;

    guard.markContextInvalidated();
    retry._flushForensicRetryOnUnloadForTesting();

    expect(sendCalls.length).toBe(sendsBefore);
    const counters = diag._getDiagnosticCountersForTesting();
    expect(counters.forensicRetryUnloadUnreachable).toBe(1);
    expect(counters.forensicRetryUnloadFlush).toBeUndefined();
  });
});

describe('diagnostics counters survive the navigation they measure', () => {
  it('startDiagnostics registers a pagehide flush, so the last 5s of counters are not discarded', async () => {
    // schedulePersist is a 5s debounce; a hard navigation kills the timer.
    // Without this listener the unload counters above would themselves be lost
    // to the event they exist to record.
    vi.resetModules();
    const added: string[] = [];
    const originalAdd = window.addEventListener.bind(window);
    vi.spyOn(window, 'addEventListener').mockImplementation(((type: string, ...rest: unknown[]) => {
      added.push(type);
      return (originalAdd as unknown as (...a: unknown[]) => void)(type, ...rest);
    }) as typeof window.addEventListener);

    const diag = await import('../../../src/diagnostics/diagnostics');
    diag.startDiagnostics();

    expect(added).toContain('pagehide');
    vi.restoreAllMocks();
  });
});
