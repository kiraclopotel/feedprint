// LOOP-028 regression — severity floor drops LLM emissions below 6/10.
//
// Why: COMBINED_DETECT_NEUTRALIZE prompt instructs the model to return empty
// when its own severity assessment is <6, but Groq's llama-3.1-8b-instant
// violates the rule on a meaningful fraction of outputs (production-43 held
// seven records at severity 3 with overallConfidence 0.9). Pipeline-side
// enforcement in neutralizer.ts is authoritative per LESSONS L-004.
//
// Fixtures below walk the entire severity boundary: reject 0..5, accept 6..10,
// plus edge cases around `severity: undefined` fallback (defaults to 5 → drop)
// and the AI-discovered-extras loop that bypasses the L1 map.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TechniqueResult } from '../../../src/types/analysis';

vi.mock('../../../src/ai/client', () => ({
  callAI: vi.fn(),
}));

vi.mock('../../../src/forensics/hasher', () => ({
  sha256: vi.fn(async () => 'deadbeef'),
}));

const { recordSpy } = vi.hoisted(() => ({
  recordSpy: vi.fn(async () => undefined),
}));
vi.mock('../../../src/forensics/neutralizer-diagnostics', () => ({
  recordNeutralizerEvent: recordSpy,
}));

import { combinedDetectAndNeutralize } from '../../../src/core/neutralizer';
import { callAI } from '../../../src/ai/client';
import { Ok } from '../../../src/ai/ai-error';

const mockedCallAI = vi.mocked(callAI);

const L1_TECHNIQUES: TechniqueResult[] = [
  { technique: 'fear-appeal', present: false, confidence: 0, severity: 0, evidence: [] },
  { technique: 'shame-attack', present: false, confidence: 0, severity: 0, evidence: [] },
  { technique: 'anger-trigger', present: false, confidence: 0, severity: 0, evidence: [] },
];

beforeEach(() => {
  mockedCallAI.mockReset();
  recordSpy.mockClear();
});

function mockResponse(techniques: Array<{ name: string; verdict: string; severity: number; reason?: string }>) {
  mockedCallAI.mockResolvedValueOnce(Ok(
    JSON.stringify({
      techniques,
      overallManipulative: true,
      overallConfidence: 0.9,
      neutralizedText: null,
    })),
  );
}

describe('neutralizer — LOOP-028 severity floor', () => {
  it('drops severity=3 fear-appeal (production-43 style: sev=3, confidence 0.9 would breeze past threshold)', async () => {
    mockResponse([
      { name: 'fear-appeal', verdict: 'CONFIRMED', severity: 3, reason: 'mild framing' },
    ]);

    const result = await combinedDetectAndNeutralize('sample', L1_TECHNIQUES);

    expect(result).not.toBeNull();
    expect(result!.analysis.techniques.some(t => t.present)).toBe(false);
    expect(result!.analysis.isManipulative).toBe(false);
  });

  it('drops severity=5 entries (immediate-below-floor edge)', async () => {
    mockResponse([
      { name: 'shame-attack', verdict: 'CONFIRMED', severity: 5, reason: 'borderline' },
    ]);

    const result = await combinedDetectAndNeutralize('sample', L1_TECHNIQUES);

    expect(result).not.toBeNull();
    expect(result!.analysis.techniques.some(t => t.present)).toBe(false);
  });

  it('keeps severity=6 entries (at-floor boundary)', async () => {
    mockResponse([
      { name: 'fear-appeal', verdict: 'CONFIRMED', severity: 6, reason: 'at the floor' },
    ]);

    const result = await combinedDetectAndNeutralize('sample', L1_TECHNIQUES);

    expect(result).not.toBeNull();
    const present = result!.analysis.techniques.filter(t => t.present);
    expect(present).toHaveLength(1);
    expect(present[0].technique).toBe('fear-appeal');
    expect(present[0].severity).toBe(6);
  });

  it('keeps severity=10 entries', async () => {
    mockResponse([
      { name: 'scapegoating', verdict: 'CONFIRMED', severity: 10, reason: 'maximum' },
    ]);

    const result = await combinedDetectAndNeutralize('sample', L1_TECHNIQUES);

    expect(result).not.toBeNull();
    // scapegoating isn't in L1_TECHNIQUES → added via the AI-discovered-extras loop.
    const present = result!.analysis.techniques.filter(t => t.present);
    expect(present).toHaveLength(1);
    expect(present[0].technique).toBe('scapegoating');
  });

  it('drops low-severity entries from the AI-discovered-extras loop', async () => {
    // scapegoating not in L1 — would enter via the extras loop. sev=4 → dropped.
    mockResponse([
      { name: 'scapegoating', verdict: 'CONFIRMED', severity: 4, reason: 'below floor' },
    ]);

    const result = await combinedDetectAndNeutralize('sample', L1_TECHNIQUES);

    expect(result).not.toBeNull();
    expect(result!.analysis.techniques.some(t => t.present)).toBe(false);
  });

  it('mixed batch — keeps high-severity, drops low-severity, no sibling contagion', async () => {
    mockResponse([
      { name: 'fear-appeal', verdict: 'CONFIRMED', severity: 8, reason: 'strong' },
      { name: 'shame-attack', verdict: 'CONFIRMED', severity: 4, reason: 'mild' },
      { name: 'anger-trigger', verdict: 'CONFIRMED', severity: 7, reason: 'strong' },
    ]);

    const result = await combinedDetectAndNeutralize('sample', L1_TECHNIQUES);

    expect(result).not.toBeNull();
    const present = result!.analysis.techniques.filter(t => t.present);
    expect(present.map(t => t.technique).sort()).toEqual(['anger-trigger', 'fear-appeal']);
    expect(present.every(t => t.severity >= 6)).toBe(true);
    expect(result!.analysis.isManipulative).toBe(true);
  });

  it('missing severity field (undefined → default 5) is treated as below-floor and dropped', async () => {
    // Per neutralizer shape-guard: aiTechnique.severity ?? 5. 5 < SEVERITY_FLOOR → drop.
    mockedCallAI.mockResolvedValueOnce(Ok(
      JSON.stringify({
        techniques: [
          { name: 'fear-appeal', verdict: 'CONFIRMED', reason: 'severity field absent' },
        ],
        overallManipulative: true,
        overallConfidence: 0.9,
        neutralizedText: null,
      })),
    );

    const result = await combinedDetectAndNeutralize('sample', L1_TECHNIQUES);

    expect(result).not.toBeNull();
    expect(result!.analysis.techniques.some(t => t.present)).toBe(false);
  });

  it('records a severity-floor-drop diagnostic event when any drop occurs', async () => {
    mockResponse([
      { name: 'fear-appeal', verdict: 'CONFIRMED', severity: 3, reason: 'below' },
      { name: 'shame-attack', verdict: 'CONFIRMED', severity: 7, reason: 'above' },
    ]);

    await combinedDetectAndNeutralize('sample', L1_TECHNIQUES);

    expect(recordSpy).toHaveBeenCalledWith('severity-floor-drop');
  });

  it('does NOT record severity-floor-drop when nothing is dropped', async () => {
    mockResponse([
      { name: 'fear-appeal', verdict: 'CONFIRMED', severity: 9, reason: 'high' },
    ]);

    await combinedDetectAndNeutralize('sample', L1_TECHNIQUES);

    expect(recordSpy).not.toHaveBeenCalledWith('severity-floor-drop');
  });

  it('drops severity=0 (degenerate emission)', async () => {
    mockResponse([
      { name: 'fear-appeal', verdict: 'CONFIRMED', severity: 0, reason: 'degenerate' },
    ]);

    const result = await combinedDetectAndNeutralize('sample', L1_TECHNIQUES);

    expect(result).not.toBeNull();
    expect(result!.analysis.techniques.some(t => t.present)).toBe(false);
  });

  it('preserves NOT_CONFIRMED verdicts regardless of severity (floor applies only to CONFIRMED)', async () => {
    // A NOT_CONFIRMED verdict never reaches the floor check — the early return
    // on non-CONFIRMED kicks in first. Double-checks the branch structure.
    mockResponse([
      { name: 'fear-appeal', verdict: 'NOT_CONFIRMED', severity: 9, reason: 'hot but rejected' },
    ]);

    const result = await combinedDetectAndNeutralize('sample', L1_TECHNIQUES);

    expect(result).not.toBeNull();
    expect(result!.analysis.techniques.some(t => t.present)).toBe(false);
    expect(recordSpy).not.toHaveBeenCalledWith('severity-floor-drop');
  });

});
