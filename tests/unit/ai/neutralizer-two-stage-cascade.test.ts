// Two-stage cascade in combinedDetectAndNeutralize (Week 2 Day 3 per
// ARCH_SYNTHESIS_V1.md §2 + CURRENT.md §AP).
//
// 2026-05-01. Validates: triage parser; cascade short-circuit on 'no';
// fall-through on yes/unsure/parse_fail; back-compat when twoStageCascade
// is omitted (single-stage path unchanged). Slice-context-override block
// removed 2026-05-24 (ship #17 — Slice machinery purged per audit A1 §2.3).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TechniqueResult } from '../../../src/types/analysis';

vi.mock('../../../src/ai/client', () => ({
  callAI: vi.fn(),
}));
vi.mock('../../../src/forensics/hasher', () => ({
  sha256: vi.fn(async () => 'deadbeef'),
}));
vi.mock('../../../src/forensics/neutralizer-diagnostics', () => ({
  recordNeutralizerEvent: vi.fn(async () => undefined),
}));

import { combinedDetectAndNeutralize } from '../../../src/core/neutralizer';
import { parseTriageVerdict } from '../../../src/ai/prompts';
import { callAI } from '../../../src/ai/client';
import { Ok } from '../../../src/ai/ai-error';
import { recordNeutralizerEvent } from '../../../src/forensics/neutralizer-diagnostics';

const mockedCallAI = vi.mocked(callAI);
const mockedRecordEvent = vi.mocked(recordNeutralizerEvent);

const NO_L1: TechniqueResult[] = [
  { technique: 'fear-appeal', present: false, confidence: 0, severity: 0, evidence: [] },
  { technique: 'shame-attack', present: false, confidence: 0, severity: 0, evidence: [] },
];

beforeEach(() => {
  mockedCallAI.mockReset();
  mockedRecordEvent.mockReset();
});

// ─── parseTriageVerdict ──────────────────────────────────────────────────────

describe('parseTriageVerdict', () => {
  it('exact lowercase tokens', () => {
    expect(parseTriageVerdict('yes')).toBe('yes');
    expect(parseTriageVerdict('no')).toBe('no');
    expect(parseTriageVerdict('unsure')).toBe('unsure');
  });
  it('tolerates leading whitespace + trailing punctuation + casing', () => {
    expect(parseTriageVerdict('  YES.')).toBe('yes');
    expect(parseTriageVerdict('No!')).toBe('no');
    expect(parseTriageVerdict('"unsure"')).toBe('unsure');
  });
  it('does not collide on word-prefix matches (no vs not, no vs nothing)', () => {
    // "not" should NOT classify as "no" — the parser uses word-boundary regex.
    expect(parseTriageVerdict('not really')).toBe('parse_fail');
    expect(parseTriageVerdict('nothing dangerous')).toBe('parse_fail');
    expect(parseTriageVerdict('yesterday I saw')).toBe('parse_fail');
  });
  it('returns parse_fail on empty / null / undefined / non-matching', () => {
    expect(parseTriageVerdict('')).toBe('parse_fail');
    expect(parseTriageVerdict(undefined)).toBe('parse_fail');
    expect(parseTriageVerdict(null)).toBe('parse_fail');
    expect(parseTriageVerdict('maybe')).toBe('parse_fail');
    expect(parseTriageVerdict('I think it might be...')).toBe('parse_fail');
  });
});

// ─── Cascade short-circuit on triage = no ────────────────────────────────────

describe('combinedDetectAndNeutralize — two-stage cascade short-circuits on triage=no', () => {
  it('returns benign result without calling classify when triage emits "no"', async () => {
    mockedCallAI.mockResolvedValueOnce(Ok('no')); // triage stage 1

    const result = await combinedDetectAndNeutralize(
      'completely benign post about cats',
      NO_L1,
      'teen',
      'en',
      'unknown',
      undefined,
      { twoStageCascade: true },
    );

    expect(result).not.toBeNull();
    expect(result!.analysis.isManipulative).toBe(false);
    expect(result!.analysis.techniques.every(t => !t.present)).toBe(true);
    expect(result!.neutralized).toBeNull();
    // Critically: only ONE callAI invocation (triage), no classify call
    expect(mockedCallAI).toHaveBeenCalledTimes(1);
    // Telemetry recorded
    expect(mockedRecordEvent).toHaveBeenCalledWith('triage-no');
  });

  it('falls through to classify when triage emits "yes"', async () => {
    mockedCallAI
      .mockResolvedValueOnce(Ok('yes')) // triage
      .mockResolvedValueOnce(Ok(JSON.stringify({
        techniques: [], overallManipulative: false, overallConfidence: 0.4, neutralizedText: null,
      }))); // classify

    await combinedDetectAndNeutralize(
      'borderline post',
      NO_L1,
      'teen',
      'en',
      'unknown',
      undefined,
      { twoStageCascade: true },
    );

    expect(mockedCallAI).toHaveBeenCalledTimes(2);
    expect(mockedRecordEvent).toHaveBeenCalledWith('triage-yes');
  });

  it('falls through to classify when triage emits "unsure"', async () => {
    mockedCallAI
      .mockResolvedValueOnce(Ok('unsure'))
      .mockResolvedValueOnce(Ok(JSON.stringify({
        techniques: [], overallManipulative: false, overallConfidence: 0.4, neutralizedText: null,
      })));

    await combinedDetectAndNeutralize(
      'ambiguous post',
      NO_L1,
      'teen',
      'en',
      'unknown',
      undefined,
      { twoStageCascade: true },
    );

    expect(mockedCallAI).toHaveBeenCalledTimes(2);
    expect(mockedRecordEvent).toHaveBeenCalledWith('triage-unsure');
  });

  it('falls through to classify on parse_fail (recall-safe)', async () => {
    mockedCallAI
      .mockResolvedValueOnce(Ok('I think this might require more analysis...')) // unparseable
      .mockResolvedValueOnce(Ok(JSON.stringify({
        techniques: [], overallManipulative: false, overallConfidence: 0.4, neutralizedText: null,
      })));

    await combinedDetectAndNeutralize(
      'edge case',
      NO_L1,
      'teen',
      'en',
      'unknown',
      undefined,
      { twoStageCascade: true },
    );

    // Recall-safe: parse_fail must NEVER short-circuit (would emit benign on
    // unknown verdict, losing recall). Verifies classify ran.
    expect(mockedCallAI).toHaveBeenCalledTimes(2);
    expect(mockedRecordEvent).toHaveBeenCalledWith('triage-parse-fail');
  });
});

// ─── Back-compat: cascade off ────────────────────────────────────────────────

describe('combinedDetectAndNeutralize — back-compat when twoStageCascade is off', () => {
  it('default behavior (no options arg) runs single-stage classify only', async () => {
    mockedCallAI.mockResolvedValueOnce(Ok(JSON.stringify({
      techniques: [], overallManipulative: false, overallConfidence: 0.4, neutralizedText: null,
    })));

    await combinedDetectAndNeutralize('any post', NO_L1);

    expect(mockedCallAI).toHaveBeenCalledTimes(1);
    // No triage event should have been recorded
    expect(mockedRecordEvent).not.toHaveBeenCalledWith(expect.stringMatching(/^triage-/));
  });

  it('explicit twoStageCascade:false runs single-stage classify only', async () => {
    mockedCallAI.mockResolvedValueOnce(Ok(JSON.stringify({
      techniques: [], overallManipulative: false, overallConfidence: 0.4, neutralizedText: null,
    })));

    await combinedDetectAndNeutralize(
      'any post',
      NO_L1,
      'teen',
      'en',
      'unknown',
      undefined,
      { twoStageCascade: false },
    );

    expect(mockedCallAI).toHaveBeenCalledTimes(1);
  });
});

// Slice-context-override describe block removed 2026-05-24 — see file
// header. The `options.slice` API + slice-builder.ts + slice-renderer.ts
// + types/slice.ts all deleted in ship #17 (audit A1 §2.3 dead-code
// budget). Production never set options.slice; pipeline.ts:627-638
// always falls through to the legacy positional `context` argument.
