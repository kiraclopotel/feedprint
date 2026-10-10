/** @vitest-environment jsdom */
// CYCLE N+1d — close the emission gap discovered during CYCLE N+2.
//
// CYCLE N+1 threaded `Result<string, AIFailure>` through `callAI` and surfaced
// `failureKind` + `retryAfterMs` (+ `cap`) on `BatchScoreResult`. CYCLE N+2
// extended `ForensicRecord` with optional `failureKind` and `cap` discriminators
// and added the Operational Events aggregator that groups records by these.
//
// This test pins the EMISSION-side contract that closes the gap: when the
// content-script flushBatch path emits a `cancelled-batch-llm-failure`
// CANCEL_LOG, `logCancelEvent` must stamp `failureKind` and `cap` from the
// input onto the chain record. Pre-N+1d records (pre-stamping) keep the
// aggregator's `failureKind ?? 'network'` back-compat default working.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/forensics/store', () => ({
  addRecord: vi.fn(async () => undefined),
  getChainState: vi.fn(async () => ({
    nextPosition: 5,
    prevRecordHash: 'prev-hash-stub',
  })),
}));
vi.mock('../../../src/forensics/signing', () => ({
  signHash: vi.fn(async () => 'stub-signature'),
  getPublicKeyFingerprint: vi.fn(async () => 'stub-fp'),
}));
vi.mock('../../../src/forensics/hasher', () => ({
  sha256: vi.fn(async (s: string) => `hash-of-len-${s.length}`),
}));

import { logCancelEvent } from '../../../src/forensics/logger';
import { addRecord } from '../../../src/forensics/store';

const mockedAddRecord = vi.mocked(addRecord);

beforeEach(() => {
  mockedAddRecord.mockReset();
});

describe('logCancelEvent — N+1d failureKind / cap stamping', () => {
  it('stamps failureKind and retryAfterMs on cancelled-batch-llm-failure', async () => {
    await logCancelEvent({
      originalText: 'a comment in a rate-limited bucket',
      verdict: 'cancelled-batch-llm-failure',
      mode: 'teen',
      platform: 'tiktok',
      kind: 'comment',
      parentVideoId: 'video-rl-1',
      failureKind: 'rate-limit',
      retryAfterMs: 5000,
    });

    expect(mockedAddRecord).toHaveBeenCalledTimes(1);
    const rec = mockedAddRecord.mock.calls[0][0];
    expect(rec.verdict).toBe('cancelled-batch-llm-failure');
    expect(rec.failureKind).toBe('rate-limit');
    expect(rec.cap).toBeUndefined();
    // detectionMode encodes the cancel reason for grouping; the new
    // failureKind field is an additional discriminator, not a replacement.
    expect(rec.detectionMode).toBe('cancel:cancelled-batch-llm-failure');
  });

  it('stamps cap discriminator when failureKind is cap-exhausted', async () => {
    await logCancelEvent({
      originalText: 'a comment skipped because daily cap was reached',
      verdict: 'cancelled-batch-llm-failure',
      mode: 'teen',
      platform: 'twitter',
      kind: 'comment',
      parentVideoId: 'video-cap-1',
      failureKind: 'cap-exhausted',
      cap: 'daily',
    });

    const rec = mockedAddRecord.mock.calls[0][0];
    expect(rec.failureKind).toBe('cap-exhausted');
    expect(rec.cap).toBe('daily');
  });

  it('keeps parent-room context on cancelled comment records', async () => {
    await logCancelEvent({
      originalText: 'a truncated comment in a known room',
      verdict: 'cancelled-batch-truncated',
      mode: 'teen',
      platform: 'tiktok',
      kind: 'comment',
      parentVideoId: 'video-room-1',
      postUrl: 'https://www.tiktok.com/@creator/video/video-room-1',
      roomAuthor: '@creator',
      roomCaption: 'the parent caption',
      roomUrl: 'https://www.tiktok.com/@creator/video/video-room-1',
    });

    const rec = mockedAddRecord.mock.calls[0][0];
    expect(rec.postUrl).toBe('https://www.tiktok.com/@creator/video/video-room-1');
    expect(rec.roomAuthor).toBe('@creator');
    expect(rec.roomCaption).toBe('the parent caption');
    expect(rec.roomUrl).toBe('https://www.tiktok.com/@creator/video/video-room-1');
  });

  it('back-compat: missing failureKind leaves the field undefined on the record', async () => {
    // Pre-N+1d records were emitted without failureKind. The chain-record
    // shape preserves that — the aggregator (CYCLE N+2) handles the
    // back-compat default-to-'network' on the READ side. The emitter must
    // NOT default; otherwise legacy and new records become indistinguishable.
    await logCancelEvent({
      originalText: 'a pre-N+1d-style cancel record',
      verdict: 'cancelled-batch-llm-failure',
      mode: 'teen',
      platform: 'facebook',
      kind: 'comment',
    });

    const rec = mockedAddRecord.mock.calls[0][0];
    expect(rec.failureKind).toBeUndefined();
    expect(rec.cap).toBeUndefined();
  });

  it('does not stamp failureKind on non-batch-llm-failure cancel records', async () => {
    // Sanity: cancelled-stale / cancelled-mid-flight callers do not pass
    // failureKind; the field must remain undefined on those records so
    // canonical-payload omission keeps the legacy hash byte-identical.
    await logCancelEvent({
      originalText: 'user scrolled past',
      verdict: 'cancelled-stale',
      mode: 'teen',
      platform: 'twitter',
    });

    const rec = mockedAddRecord.mock.calls[0][0];
    expect(rec.failureKind).toBeUndefined();
    expect(rec.cap).toBeUndefined();
  });
});
