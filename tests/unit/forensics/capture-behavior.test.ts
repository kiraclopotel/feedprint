// @vitest-environment jsdom
//
// FeelingWise — PAPA-16 behavioral capture hook unit tests (§BT, Round 1 (A)).
//
// Locks the contracts the queue depends on:
//   • captureBehaviorEvent is fire-and-forget — must NEVER throw, even under
//     jsdom IDB unavailability.
//   • readAllCapturedBehavior returns [] on failure; never undefined.
//   • clearCapturedBehavior no-throws on failure.
//   • Type shapes are stable across the eventKind enum.
//
// IDB persistence verification is out-of-scope; same rationale as
// `capture-prompt-io.test.ts` and `perf-trace.test.ts` (jsdom IDB partial).

import { describe, it, expect, beforeEach } from 'vitest';
import {
  captureBehaviorEvent,
  readAllCapturedBehavior,
  clearCapturedBehavior,
  __resetCaptureBehaviorForTests,
  type CapturedBehavior,
} from '../../../src/forensics/capture-behavior';

describe('capture-behavior — no-throw contract under IDB unavailable', () => {
  beforeEach(() => {
    __resetCaptureBehaviorForTests();
  });

  it('captureBehaviorEvent does not throw when indexedDB is missing or fails', async () => {
    await expect(
      captureBehaviorEvent({
        ts: Date.now(),
        postId: 'p-1',
        eventKind: 'dispatched',
        ageMs: 42,
        state: 'visible',
        kind: 'post',
        isDegenerate: false,
      }),
    ).resolves.toBeUndefined();
  });

  it('readAllCapturedBehavior never throws — returns CapturedBehavior[]', async () => {
    const result = await readAllCapturedBehavior();
    expect(Array.isArray(result)).toBe(true);
  });

  it('clearCapturedBehavior never throws', async () => {
    await expect(clearCapturedBehavior()).resolves.toBeUndefined();
  });
});

describe('capture-behavior — type shape stability', () => {
  it('CapturedBehavior accepts all 6 eventKind values', () => {
    const kinds: CapturedBehavior['eventKind'][] = [
      'dispatched',
      'classified',
      'cancelled-stale',
      'cancelled-mid-flight',
      'evicted-size-cap',
      'failed',
    ];
    for (const eventKind of kinds) {
      const e: CapturedBehavior = { ts: 0, postId: 'x', eventKind };
      expect(e.eventKind).toBe(eventKind);
    }
  });

  it('CapturedBehavior optional fields can be omitted', () => {
    const minimal: CapturedBehavior = { ts: 0, postId: 'x', eventKind: 'dispatched' };
    expect(minimal.ageMs).toBeUndefined();
    expect(minimal.state).toBeUndefined();
    expect(minimal.kind).toBeUndefined();
    expect(minimal.isDegenerate).toBeUndefined();
    expect(minimal.verdictLabel).toBeUndefined();
  });
});
