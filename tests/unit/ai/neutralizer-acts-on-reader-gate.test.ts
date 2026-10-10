// acts_on_reader gate (2026-06-10) — JUDGE RULE 1 as a schema slot.
//
// Locks the posts-path over-flag gate in neutralizer.ts::judgeToCombinedShape:
// a concerning verdict whose own acts_on_reader field is false (the post
// reports / opines / jokes / educates about an ugly topic rather than working
// ON the reader) is downgraded to benign — unless severity >= 8
// (graphic/extreme content acts regardless). Missing or non-boolean field
// keeps the verdict unchanged (fail-open to prior behavior).
//
// Evidence: posts-runner baseline on claude-feed-2026-06-09 — 32/44
// posts-path interventions were on non-acting content (news reports,
// political opinions, jokes, safety education) despite the prose RULE 1
// saying exactly this. Prose is measured-ignored at 8b; schema slots +
// code gates are the measured-working pattern (comments-path target_present).

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

const NO_L1: TechniqueResult[] = [
  { technique: 'fear-appeal', present: false, confidence: 0, severity: 0, evidence: [] },
];

function judgeResponse(fields: Record<string, unknown>) {
  return Ok(JSON.stringify({
    concerning: true,
    primary_concern: 'fear catastrophizing panic framing',
    severity: 7,
    should_rewrite: false,
    neutralized_text: null,
    ...fields,
  }));
}

async function run(): Promise<{ isManipulative: boolean }> {
  const result = await combinedDetectAndNeutralize(
    'a post about an ugly topic', NO_L1, 'teen', 'en', 'unknown', undefined,
  );
  return { isManipulative: result?.analysis.isManipulative === true };
}

beforeEach(() => {
  mockedCallAI.mockReset();
});

describe('judgeToCombinedShape — acts_on_reader gate', () => {
  it('downgrades a concerning verdict when the model says it does not act on the reader (sev <= 7)', async () => {
    mockedCallAI.mockResolvedValueOnce(judgeResponse({ acts_on_reader: false, severity: 7 }));
    expect((await run()).isManipulative).toBe(false);
  });

  it('keeps acting on severity 8+ even when acts_on_reader=false (graphic/extreme escape hatch)', async () => {
    mockedCallAI.mockResolvedValueOnce(judgeResponse({ acts_on_reader: false, severity: 9 }));
    expect((await run()).isManipulative).toBe(true);
  });

  it('keeps a concerning verdict when acts_on_reader=true', async () => {
    mockedCallAI.mockResolvedValueOnce(judgeResponse({ acts_on_reader: true, severity: 7 }));
    expect((await run()).isManipulative).toBe(true);
  });

  it('fail-open: missing acts_on_reader keeps the verdict unchanged', async () => {
    mockedCallAI.mockResolvedValueOnce(judgeResponse({ severity: 7 }));
    expect((await run()).isManipulative).toBe(true);
  });

  it('fail-open: non-boolean acts_on_reader keeps the verdict unchanged', async () => {
    mockedCallAI.mockResolvedValueOnce(judgeResponse({ acts_on_reader: 'no', severity: 7 }));
    expect((await run()).isManipulative).toBe(true);
  });
});

// PROTECTION-PATH-7: the judge names a direct-harm category as its primary
// concern. Before the harm-category branches existed in mapConcernToTechnique
// (and the names in VALID_TECHNIQUES) such a verdict became 'combined', met
// the combined floor (5 in Child) instead of its own (4), and a self-harm
// post at severity 4 passed raw while a higher-severity record misnamed it.
describe('judgeToCombinedShape — direct-harm categories keep their own name and floor', () => {
  async function runChild(concern: string, severity: number) {
    mockedCallAI.mockResolvedValueOnce(judgeResponse({
      primary_concern: concern, severity, acts_on_reader: true,
    }));
    const result = await combinedDetectAndNeutralize(
      'a post about an ugly topic', NO_L1, 'child', 'en', 'unknown', undefined,
    );
    const present = result?.analysis.techniques.filter(t => t.present).map(t => t.technique) ?? [];
    return { isManipulative: result?.analysis.isManipulative === true, present };
  }

  it('self-harm promotion at severity 4 acts in Child and the record names self-harm', async () => {
    const r = await runChild('self-harm promotion, romanticizes cutting', 4);
    expect(r.isManipulative).toBe(true);
    expect(r.present).toContain('self-harm');
    expect(r.present).not.toContain('combined');
  });

  it.each([
    ['sexualized content aimed at minors', 'sexual'],
    ['graphic violence, real beheading footage', 'violence-graphic'],
    ['drug promotion, glorifies vaping', 'drug-promotion'],
    ['unsafe health experiment, blackout challenge', 'unsafe-health-experiment'],
  ])('maps "%s" to %s', async (concern, technique) => {
    const r = await runChild(concern, 6);
    expect(r.present).toContain(technique);
  });

  it('a self-harm concern that also mentions shame is still self-harm, not shame-attack', async () => {
    const r = await runChild('self-harm encouragement framed as shame about her body', 6);
    expect(r.present).toContain('self-harm');
    expect(r.present).not.toContain('shame-attack');
  });
});
