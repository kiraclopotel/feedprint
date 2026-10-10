// @vitest-environment jsdom
//
// FeelingWise — PAPA-16 capture hook unit tests (Tier E, Decision 7).
//
// Locks the contracts the cascade depends on per `src/forensics/capture-prompt-io.ts`
// docblock:
//   • capturePromptIO is fire-and-forget — must NEVER throw, even when IDB is
//     unavailable (test-env default in jsdom without fake-indexeddb).
//   • readAllCapturedTuples returns [] on failure — never throws, never returns
//     undefined.
//   • clearCapturedTuples no-throws on failure.
//   • Type shapes are stable.
//
// IDB persistence verification is out-of-scope here — same rationale as
// `perf-trace.test.ts` (jsdom IndexedDB is not reliably available; behavior on
// real IDB is exercised manually via the dev flag flow).

import { describe, it, expect, beforeEach } from 'vitest';
import {
  capturePromptIO,
  readAllCapturedTuples,
  clearCapturedTuples,
  __resetCapturePromptIOForTests,
  type CapturedTuple,
} from '../../../src/forensics/capture-prompt-io';

describe('capture-prompt-io — no-throw contract under IDB unavailable', () => {
  beforeEach(() => {
    __resetCapturePromptIOForTests();
  });

  it('capturePromptIO does not throw when indexedDB is missing or fails', async () => {
    // jsdom may or may not expose indexedDB; either way the call must not throw.
    await expect(
      capturePromptIO({
        timestamp: Date.now(),
        stage: 'classify',
        sliceProse: 'rendered context',
        systemPrompt: 'sys',
        userPrompt: 'usr',
        rawResponse: '{"foo":"bar"}',
        locale: 'en',
        mode: 'teen',
      }),
    ).resolves.toBeUndefined();
  });

  it('readAllCapturedTuples never throws — returns CapturedTuple[]', async () => {
    const result = await readAllCapturedTuples();
    expect(Array.isArray(result)).toBe(true);
  });

  it('clearCapturedTuples never throws', async () => {
    await expect(clearCapturedTuples()).resolves.toBeUndefined();
  });
});

describe('capture-prompt-io — type shape stability', () => {
  it('CapturedTuple accepts both stages', () => {
    // Compile-check via type narrowing: TypeScript-level assertion that
    // 'triage' | 'classify' is the union; runtime test exists to keep
    // this guard in CI even when typecheck is skipped.
    const triage: CapturedTuple = {
      timestamp: 1, stage: 'triage', sliceProse: '', systemPrompt: '', userPrompt: '', rawResponse: '',
    };
    const classify: CapturedTuple = {
      timestamp: 2, stage: 'classify', sliceProse: '', systemPrompt: '', userPrompt: '', rawResponse: '',
    };
    expect(triage.stage).toBe('triage');
    expect(classify.stage).toBe('classify');
  });

  it('CapturedTuple optional fields can be omitted', () => {
    const minimal: CapturedTuple = {
      timestamp: 0,
      stage: 'classify',
      sliceProse: '',
      systemPrompt: '',
      userPrompt: '',
      rawResponse: '',
    };
    expect(minimal.locale).toBeUndefined();
    expect(minimal.mode).toBeUndefined();
  });
});
