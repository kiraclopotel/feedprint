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
});

describe('neutralizer — DEC-008 Combined fallback removal (LOOP-005a)', () => {
  it('does not force combined when LLM is ambivalent (overallManipulative:true, techniques:[])', async () => {
    mockedCallAI.mockResolvedValueOnce(Ok(
      JSON.stringify({
        techniques: [],
        overallManipulative: true,
        overallConfidence: 0.7,
        neutralizedText: null,
      })),
    );

    const result = await combinedDetectAndNeutralize('Some ambivalent text', L1_TECHNIQUES);

    expect(result).not.toBeNull();
    const present = result!.analysis.techniques.filter(t => t.present);
    expect(present).toHaveLength(0);
    expect(
      result!.analysis.techniques.some(t => t.technique === 'combined' && t.present),
    ).toBe(false);
    expect(result!.analysis.isManipulative).toBe(false);
  });

  it('respects "no techniques" even if overallConfidence > 0.5', async () => {
    mockedCallAI.mockResolvedValueOnce(Ok(
      JSON.stringify({
        techniques: [],
        overallManipulative: true,
        overallConfidence: 0.95,
        neutralizedText: 'some rewrite',
      })),
    );

    const result = await combinedDetectAndNeutralize('Another ambivalent text', L1_TECHNIQUES);

    expect(result).not.toBeNull();
    expect(
      result!.analysis.techniques.some(t => t.present),
    ).toBe(false);
    expect(result!.analysis.isManipulative).toBe(false);
    expect(result!.neutralized).toBeNull();
  });

  it('confirms techniques only when the LLM CONFIRMS a named technique', async () => {
    mockedCallAI.mockResolvedValueOnce(Ok(
      JSON.stringify({
        techniques: [
          { name: 'fear-appeal', verdict: 'CONFIRMED', severity: 7, reason: 'catastrophic language' },
          { name: 'shame-attack', verdict: 'CONFIRMED', severity: 6, reason: 'direct insult' },
          // LOOP-028: raised from 5 to 6 so this fixture — which exercises
          // CONFIRMED multi-technique accumulation, not severity policy —
          // still yields 3 present techniques post-severity-floor.
          { name: 'anger-trigger', verdict: 'CONFIRMED', severity: 6, reason: 'outrage framing' },
        ],
        overallManipulative: true,
        overallConfidence: 0.85,
        neutralizedText: null,
      })),
    );

    const result = await combinedDetectAndNeutralize('Real manipulative text', L1_TECHNIQUES);

    expect(result).not.toBeNull();
    const present = result!.analysis.techniques.filter(t => t.present);
    expect(present).toHaveLength(3);
    expect(present.map(t => t.technique).sort()).toEqual(['anger-trigger', 'fear-appeal', 'shame-attack']);
    expect(result!.analysis.isManipulative).toBe(true);
    // No synthetic 'combined' fallback was injected — the confirmed techniques
    // stand on their own, and the pipeline's regex classifyCombined is where
    // DEC-008's ≥3 aggregation is enforced (not here).
    const combinedFlags = result!.analysis.techniques.filter(t => t.technique === 'combined' && t.present);
    expect(combinedFlags).toHaveLength(0);
  });
});

describe('neutralizer — AI hide/collapse HIDE-fallback (2026-05-23 audit)', () => {
  // Console-log diagnosis from a 2026-05-23 live walk surfaced a silent
  // protection-failure mode: the LLM emitted action='hide'/'collapse' for
  // high-severity content, neutralizer downgraded action to undefined to
  // force always-rewrite UX, the rewrite then failed validation (length
  // blowup, register flatten, etc.), and the post slipped through unprotected
  // (Pipeline: PASS, no valid neutralization produced).
  //
  // Fix: capture aiOriginalAction before downgrade, restore it only when
  // rewrite fails. Rewrite-success path stays UX-friendly (collapse/hide
  // downgraded to undefined → rewrite text wins). Rewrite-failure path
  // honors the LLM's protect-intent → pipeline collapse/hide branch fires.

  it("restores action='hide' when LLM said hide AND rewrite is null", async () => {
    mockedCallAI.mockResolvedValueOnce(Ok(
      JSON.stringify({
        techniques: [
          { name: 'shame-attack', verdict: 'CONFIRMED', severity: 9, reason: 'direct dehumanizing attack' },
        ],
        overallManipulative: true,
        overallConfidence: 0.85,
        action: 'hide',
        neutralizedText: null,
      })),
    );

    const result = await combinedDetectAndNeutralize('You are subhuman', L1_TECHNIQUES);

    expect(result).not.toBeNull();
    expect(result!.analysis.isManipulative).toBe(true);
    expect(result!.neutralized).toBeNull();
    // Without the fallback, action would be undefined here → pipeline PASS.
    // With the fallback, action is restored to 'hide' → pipeline collapse/hide
    // branch fires at content/index.ts:1782 and the post is hidden.
    expect(result!.analysis.action).toBe('hide');
  });

  it("restores action='collapse' when LLM said collapse AND rewrite fails validation", async () => {
    // Rewrite "I think this is wrong" against original "ALL the [group] are X"
    // would trip register-flatten (emphasis stripped) → validator rejects →
    // neutralized stays null → fallback should restore collapse.
    mockedCallAI.mockResolvedValueOnce(Ok(
      JSON.stringify({
        techniques: [
          { name: 'shame-attack', verdict: 'CONFIRMED', severity: 7, reason: 'group dehumanization' },
        ],
        overallManipulative: true,
        overallConfidence: 0.8,
        action: 'collapse',
        // Empty rewrite triggers the validation-failure path.
        neutralizedText: '',
      })),
    );

    const result = await combinedDetectAndNeutralize('ALL THE BAD PEOPLE!!!', L1_TECHNIQUES);

    expect(result).not.toBeNull();
    expect(result!.analysis.isManipulative).toBe(true);
    expect(result!.neutralized).toBeNull();
    expect(result!.analysis.action).toBe('collapse');
  });

  it("clears action when LLM said hide AND rewrite succeeds (UX preference honored)", async () => {
    mockedCallAI.mockResolvedValueOnce(Ok(
      JSON.stringify({
        techniques: [
          { name: 'shame-attack', verdict: 'CONFIRMED', severity: 6, reason: 'mild insult' },
        ],
        overallManipulative: true,
        overallConfidence: 0.75,
        action: 'hide',
        // Valid rewrite (passes validators).
        neutralizedText: 'I find this disagreeable.',
      })),
    );

    const result = await combinedDetectAndNeutralize('You suck at this', L1_TECHNIQUES);

    expect(result).not.toBeNull();
    expect(result!.analysis.isManipulative).toBe(true);
    expect(result!.neutralized).not.toBeNull();
    // Rewrite succeeded → action stays undefined → rewrite text shown to user.
    expect(result!.analysis.action).toBeUndefined();
  });
});
