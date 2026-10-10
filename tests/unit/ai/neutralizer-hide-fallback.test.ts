// D-5 — combined-path HIDE-fallback when a rewrite fails on detected harm.
//
// The combined detect+neutralize path attempts a rewrite (action defaults to
// 'rewrite'). When the rewrite is null / empty / rejected by a validator, the
// result carries neutralized=null. Pre-fix, the HIDE-fallback only restored an
// action the AI had EXPLICITLY named ('hide'/'collapse'); a default-'rewrite'
// verdict whose rewrite failed fell through to PASS (pipeline.ts:753-758) — a
// confirmed-manipulative post shown to the child with zero intervention.
//
// Fix: on isManipulative && neutralized===null with no AI-named action, promote
// HIGH-SEVERITY HOSTILE detections to action='hide', mirroring the BATCH path's
// isUnrewritable gate (content/index.ts:1153: sev>=7 AND a hostile technique).
// Lower-severity manipulation keeps the lighter-touch pass (VISION "when in
// doubt, lighter touch") — the fallback must not hide borderline content
// wholesale.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TechniqueResult } from '../../../src/types/analysis';

vi.mock('../../../src/ai/client', () => ({ callAI: vi.fn() }));
vi.mock('../../../src/forensics/hasher', () => ({ sha256: vi.fn(async () => 'deadbeef') }));
const { recordSpy } = vi.hoisted(() => ({ recordSpy: vi.fn(async () => undefined) }));
vi.mock('../../../src/forensics/neutralizer-diagnostics', () => ({ recordNeutralizerEvent: recordSpy }));

import { combinedDetectAndNeutralize } from '../../../src/core/neutralizer';
import { callAI } from '../../../src/ai/client';
import { Ok } from '../../../src/ai/ai-error';

const mockedCallAI = vi.mocked(callAI);

const L1_TECHNIQUES: TechniqueResult[] = [
  { technique: 'fear-appeal', present: false, confidence: 0, severity: 0, evidence: [] },
  { technique: 'shame-attack', present: false, confidence: 0, severity: 0, evidence: [] },
  { technique: 'anger-trigger', present: false, confidence: 0, severity: 0, evidence: [] },
];

beforeEach(() => { mockedCallAI.mockReset(); recordSpy.mockClear(); });

function mockResponse(opts: {
  techniques: Array<{ name: string; verdict: string; severity: number; reason?: string }>;
  neutralizedText?: string | null;
  action?: string;
}) {
  const body: Record<string, unknown> = {
    techniques: opts.techniques,
    overallManipulative: true,
    overallConfidence: 0.9,
    neutralizedText: opts.neutralizedText ?? null,
  };
  if (opts.action) body.action = opts.action;
  mockedCallAI.mockResolvedValueOnce(Ok(JSON.stringify(body)));
}

describe('D-5 combined-path HIDE-fallback on failed rewrite', () => {
  it('high-severity hostile + NO rewrite produced (null) → action=hide (not silent PASS)', async () => {
    mockResponse({
      techniques: [{ name: 'shame-attack', verdict: 'CONFIRMED', severity: 8, reason: 'attack' }],
      neutralizedText: null,
    });
    const result = await combinedDetectAndNeutralize('you are worthless and everyone hates you', L1_TECHNIQUES);
    expect(result).not.toBeNull();
    expect(result!.analysis.isManipulative).toBe(true);
    expect(result!.neutralized).toBeNull();
    expect(result!.analysis.action).toBe('hide');
  });

  it('high-severity hostile + rewrite REJECTED by validator (meta-talk) → action=hide', async () => {
    mockResponse({
      techniques: [{ name: 'shame-attack', verdict: 'CONFIRMED', severity: 9, reason: 'attack' }],
      // Meta-talk opening → validateNeutralization rejects → neutralized stays null.
      neutralizedText: 'This post says the author is upset with the group and wants change.',
    });
    const result = await combinedDetectAndNeutralize('you stupid worthless people', L1_TECHNIQUES);
    expect(result!.neutralized).toBeNull();
    expect(result!.analysis.action).toBe('hide');
  });

  it('lower-severity manipulation + failed rewrite → stays PASS (no wholesale hide)', async () => {
    mockResponse({
      techniques: [{ name: 'fear-appeal', verdict: 'CONFIRMED', severity: 6, reason: 'mild' }],
      neutralizedText: null,
    });
    const result = await combinedDetectAndNeutralize('this might be a little risky honestly', L1_TECHNIQUES);
    expect(result!.analysis.isManipulative).toBe(true);
    expect(result!.neutralized).toBeNull();
    expect(result!.analysis.action).not.toBe('hide');
  });

  it('high-severity hostile + unsafe visible rewrite -> action=hide', async () => {
    mockResponse({
      techniques: [{ name: 'shame-attack', verdict: 'CONFIRMED', severity: 9, reason: 'attack' }],
      neutralizedText: 'That claim is fucking wrong.',
    });
    const result = await combinedDetectAndNeutralize('you are worthless and everyone hates you', L1_TECHNIQUES);
    expect(result!.neutralized).toBeNull();
    expect(result!.analysis.action).toBe('hide');
    expect(recordSpy).toHaveBeenCalledWith('unsafe-visible-language');
  });

  it('AI explicitly named action=hide + failed rewrite → still hide (back-compat)', async () => {
    mockResponse({
      techniques: [{ name: 'shame-attack', verdict: 'CONFIRMED', severity: 8, reason: 'attack' }],
      neutralizedText: null,
      action: 'hide',
    });
    const result = await combinedDetectAndNeutralize('worthless trash, leave', L1_TECHNIQUES);
    expect(result!.analysis.action).toBe('hide');
  });

  it('successful rewrite is unaffected — no forced hide when neutralization is produced', async () => {
    mockResponse({
      techniques: [{ name: 'shame-attack', verdict: 'CONFIRMED', severity: 8, reason: 'attack' }],
      neutralizedText: 'Many people are unhappy with how this group behaves.',
    });
    const result = await combinedDetectAndNeutralize('you stupid worthless people', L1_TECHNIQUES);
    expect(result!.neutralized).not.toBeNull();
    expect(result!.analysis.action).not.toBe('hide');
  });
});

// A rewrite that drops every word of a lethal threat reads as a calm opinion and passes the
// surface validators, so a post rewrite is checked for it the way a comment rewrite already is.
describe('a post rewrite that launders lethal language is not shipped', () => {
  const THREAT = 'Someone should burn down that house with the family inside.';
  const LAUNDERED = 'I think the people in that house should be held accountable.';

  it('Child and Teen judge: the laundered rewrite is rejected and counted', async () => {
    mockResponse({
      techniques: [{ name: 'fear-appeal', verdict: 'CONFIRMED', severity: 6, reason: 'threat' }],
      neutralizedText: LAUNDERED,
    });
    const result = await combinedDetectAndNeutralize(THREAT, L1_TECHNIQUES, 'teen');
    expect(result!.analysis.isManipulative).toBe(true);
    expect(result!.neutralized).toBeNull();
    expect(recordSpy).toHaveBeenCalledWith('harm-laundered');
  });

  it('at high severity the rejected rewrite falls to hide', async () => {
    mockResponse({
      techniques: [{ name: 'fear-appeal', verdict: 'CONFIRMED', severity: 8, reason: 'threat' }],
      neutralizedText: LAUNDERED,
    });
    const result = await combinedDetectAndNeutralize(THREAT, L1_TECHNIQUES, 'child');
    expect(result!.neutralized).toBeNull();
    expect(result!.analysis.action).toBe('hide');
  });

  it('Adult judge: the rewrite-only path is rejected the same way', async () => {
    const verdict = Ok(JSON.stringify({ charged: true, family: 'threat', severity: 5, effect: 'recruit', intent: 'react' }));
    mockedCallAI.mockResolvedValueOnce(verdict).mockResolvedValueOnce(verdict);
    const rewrite = vi.fn(async () => LAUNDERED);
    const result = await combinedDetectAndNeutralize(THREAT, L1_TECHNIQUES, 'adult', 'en', 'unknown', undefined, { rewrite });
    expect(rewrite).toHaveBeenCalledTimes(1);
    expect(result!.analysis.isManipulative).toBe(true);
    expect(result!.neutralized).toBeNull();
  });
});

// The meta-commentary patterns catch an editorial label the model adds to its rewrite. The words
// "note" and "warning" alone are ordinary prose, and a rejection is logged like every other one.
describe('meta-commentary in a rewrite', () => {
  const ORIGINAL = 'The storm warning is a total hoax, they just want you scared!';

  it('"warning" used as an ordinary word does not reject the rewrite', async () => {
    const rewrite = 'I think the storm warning is overblown for our area.';
    mockResponse({
      techniques: [{ name: 'fear-appeal', verdict: 'CONFIRMED', severity: 6, reason: 'alarm' }],
      neutralizedText: rewrite,
    });
    const result = await combinedDetectAndNeutralize(ORIGINAL, L1_TECHNIQUES, 'teen');
    expect(result!.neutralized?.rewrittenText).toBe(rewrite);
  });

  it('an editorial label is rejected and counted', async () => {
    mockResponse({
      techniques: [{ name: 'fear-appeal', verdict: 'CONFIRMED', severity: 6, reason: 'alarm' }],
      neutralizedText: 'I think the storm is overstated. Note: alarmist framing softened.',
    });
    const result = await combinedDetectAndNeutralize(ORIGINAL, L1_TECHNIQUES, 'teen');
    expect(result!.neutralized).toBeNull();
    expect(recordSpy).toHaveBeenCalledWith('meta-commentary');
  });

  it('a rewrite too short to show is rejected and counted like every other refusal', async () => {
    mockResponse({
      techniques: [{ name: 'fear-appeal', verdict: 'CONFIRMED', severity: 6, reason: 'alarm' }],
      neutralizedText: 'ok.',
    });
    const result = await combinedDetectAndNeutralize(ORIGINAL, L1_TECHNIQUES, 'teen');
    expect(result!.neutralized).toBeNull();
    expect(recordSpy).toHaveBeenCalledWith('rewrite-too-short');
  });
});
