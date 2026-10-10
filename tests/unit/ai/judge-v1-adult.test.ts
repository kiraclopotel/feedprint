// The adult judge (2026-09-03): JUDGE-V1's question on gpt-oss-120b, fire at
// charged and severity >= 4. This file locks the instrument to what the
// accuracy session measured (docs/research/accuracy-2026-09-03/PROTOCOL.md):
// the prompt text by hash, the model, the schema, the user-message shape, and
// the fire, hide and rewrite rules. A change to any of these is a new
// instrument and needs a new measurement before it ships.

import { createHash } from 'node:crypto';
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

import { combinedDetectAndNeutralize, readWithJudgeV1, JUDGE_V1_FAMILY_TECHNIQUE } from '../../../src/core/neutralizer';
import { callAI } from '../../../src/ai/client';
import { Ok } from '../../../src/ai/ai-error';
import {
  JUDGE_V1_ADULT_SYSTEM,
  JUDGE_V1_MODEL,
  JUDGE_V1_SECOND_MODEL,
  JUDGE_V1_SCHEMA,
  JUDGE_V1_FIRE_SEVERITY,
  JUDGE_V1_HIDE_SEVERITY,
  buildJudgeV1UserPrompt,
  parseJudgeV1,
} from '../../../src/ai/prompts';

const mockedCallAI = vi.mocked(callAI);
const mockedRewrite = vi.fn(async (_input: { text: string; technique: string }) => '');

const NO_L1: TechniqueResult[] = [
  { technique: 'fear-appeal', present: false, confidence: 0, severity: 0, evidence: [] },
];

function verdict(fields: Record<string, unknown>) {
  return Ok(JSON.stringify({
    charged: true, family: 'hostile', severity: 5, effect: 'recruit', intent: 'react', ...fields,
  }));
}

/**
 * Both judges answering the same thing. Since 2026-09-21 a rewrite needs two models to
 * fire (src/ai/judge-pair.ts), so every case below that expects an action has to feed
 * two replies; one reply is now the "they disagreed" case and correctly does nothing.
 */
function bothAgree(fields: Record<string, unknown>) {
  mockedCallAI.mockResolvedValueOnce(verdict(fields));
  mockedCallAI.mockResolvedValueOnce(verdict(fields));
}

async function runAdult(text = 'a post on a real feed', options?: Record<string, unknown>) {
  return combinedDetectAndNeutralize(text, NO_L1, 'adult', 'en', 'unknown', undefined, {
    twoStageCascade: true,
    platform: 'twitter',
    kind: 'post',
    rewrite: mockedRewrite,
    ...options,
  });
}

beforeEach(() => {
  mockedCallAI.mockReset();
  mockedRewrite.mockReset();
  mockedRewrite.mockResolvedValue('');
});

describe('the adult judge is the measured instrument', () => {
  it('carries the prompt the accuracy session measured, byte for byte', () => {
    const hash = createHash('sha256').update(JUDGE_V1_ADULT_SYSTEM).digest('hex').slice(0, 12);
    expect(hash).toBe('4f32b70b07b7');
  });

  it('pins the model, the cut and the hide line the measurement used', () => {
    expect(JUDGE_V1_MODEL).toBe('openai/gpt-oss-120b');
    expect(JUDGE_V1_FIRE_SEVERITY).toBe(4);
    expect(JUDGE_V1_HIDE_SEVERITY).toBe(8);
    expect(JUDGE_V1_SCHEMA.schema.required).toEqual(['charged', 'family', 'severity', 'effect', 'intent']);
    expect(JUDGE_V1_SCHEMA.schema.additionalProperties).toBe(false);
  });

  it('builds the user message in the measured shape: platform, kind, parent as context, the item', () => {
    const msg = buildJudgeV1UserPrompt({ text: 'the item', platform: 'facebook', kind: 'comment', parentText: 'the post' });
    expect(msg).toBe(
      '<user-content>\nPlatform: facebook\n\nKind: comment\n\nTHE POST IT REPLIES TO (context only, not the item to judge):\nthe post\n\nTHE ITEM TO JUDGE:\nthe item\n</user-content>',
    );
    expect(buildJudgeV1UserPrompt({ text: '', platform: 'twitter' })).toContain('THE ITEM TO JUDGE:\n(no text)');
    expect(buildJudgeV1UserPrompt({ text: 'x' })).not.toContain('REPLIES TO');
  });

  it('sends the strict schema and the 120b model, with no triage call in front', async () => {
    mockedCallAI.mockResolvedValueOnce(verdict({ charged: false, family: 'none', severity: 0, effect: 'inert', intent: 'none' }));
    await runAdult();
    expect(mockedCallAI).toHaveBeenCalledTimes(1);
    const [system, user, , opts] = mockedCallAI.mock.calls[0];
    expect(system).toBe(JUDGE_V1_ADULT_SYSTEM);
    expect(user).toContain('Platform: twitter');
    expect(opts?.model).toBe('openai/gpt-oss-120b');
    expect(opts?.jsonSchema?.name).toBe('judge_v1');
  });
});

describe('the fire rule', () => {
  it('passes a charged item under the cut', async () => {
    mockedCallAI.mockResolvedValueOnce(verdict({ severity: 3 }));
    const r = await runAdult();
    expect(r?.analysis.isManipulative).toBe(false);
    expect(r?.analysis.techniques).toEqual([]);
  });

  it('passes an uncharged item whatever its severity says', async () => {
    mockedCallAI.mockResolvedValueOnce(verdict({ charged: false, severity: 9 }));
    expect((await runAdult())?.analysis.isManipulative).toBe(false);
  });

  it('fires at the cut, maps the family to a technique, and asks for a rewrite', async () => {
    bothAgree({ family: 'threat', severity: 4 });
    mockedRewrite.mockResolvedValueOnce('I think this matters and here is why.');
    const r = await runAdult();
    expect(r?.analysis.isManipulative).toBe(true);
    expect(r?.analysis.primaryTechnique).toBe('fear-appeal');
    expect(r?.analysis.overallScore).toBe(4);
    expect(r?.analysis.action).toBe('rewrite');
    expect(r?.neutralized?.rewrittenText).toBe('I think this matters and here is why.');
    expect(mockedRewrite).toHaveBeenCalledWith(expect.objectContaining({ technique: 'fear-appeal' }));
  });

  it('hides at the hide line and does not ask for a rewrite', async () => {
    bothAgree({ family: 'hostile', severity: 8 });
    const r = await runAdult();
    expect(r?.analysis.action).toBe('hide');
    expect(r?.neutralized).toBeNull();
    expect(mockedRewrite).not.toHaveBeenCalled();
  });

  it('keeps the marker without a rewrite when the rewrite path returns nothing', async () => {
    bothAgree({ family: 'commercial', severity: 5 });
    const r = await runAdult();
    expect(r?.analysis.isManipulative).toBe(true);
    expect(r?.analysis.action).toBeUndefined();
    expect(r?.neutralized).toBeNull();
  });

  it('hides strong hostility when no rewrite comes back', async () => {
    bothAgree({ family: 'hostile', severity: 7 });
    const r = await runAdult();
    expect(r?.analysis.action).toBe('hide');
  });

  it('does not ask for a rewrite when rewrites are off', async () => {
    bothAgree({ severity: 6 });
    const r = await runAdult('x', { rewriteEnabled: false });
    expect(r?.analysis.isManipulative).toBe(true);
    expect(mockedRewrite).not.toHaveBeenCalled();
  });

  it('returns null on a malformed reply, so the pipeline records a failed call, not a pass', async () => {
    mockedCallAI.mockResolvedValueOnce(Ok('{"charged": "yes"}'));
    expect(await runAdult()).toBeNull();
  });

  it('maps every family to a technique the record already knows', () => {
    expect(Object.keys(JUDGE_V1_FAMILY_TECHNIQUE).sort()).toEqual(['body', 'commercial', 'hostile', 'none', 'profanity', 'threat']);
  });
});

// JUDGE-V1-PAIR, 2026-09-21. The rule and its measurement are in src/ai/judge-pair.ts.
// The single judge was right 78.4 percent of the times it acted on the sealed 500, which
// is about one post in five rewritten that should have been left alone, and that is the
// only failure a reader can see. Two judges agreeing were right 126 of 126 on that split
// and 115 of 115 on dev.
describe('a rewrite needs two judges to agree', () => {
  it('acts when both fire, and names the pair on the record', async () => {
    bothAgree({ family: 'hostile', severity: 6 });
    mockedRewrite.mockResolvedValueOnce('A calmer way to say it.');
    const r = await runAdult();
    expect(r?.analysis.isManipulative).toBe(true);
    expect(mockedCallAI).toHaveBeenCalledTimes(2);
    expect(r?.analysis.judge?.id).toBe('judge-v1-pair');
    expect(r?.analysis.judge?.model).toBe(`${JUDGE_V1_MODEL}+${JUDGE_V1_SECOND_MODEL}`);
  });

  it('asks the SECOND model second, not the same one twice', async () => {
    bothAgree({ severity: 5 });
    await runAdult();
    expect(mockedCallAI.mock.calls[0][3]?.model).toBe(JUDGE_V1_MODEL);
    expect(mockedCallAI.mock.calls[1][3]?.model).toBe(JUDGE_V1_SECOND_MODEL);
    // Same frozen question both times. The instrument is the agreement, not a new prompt.
    expect(mockedCallAI.mock.calls[1][0]).toBe(JUDGE_V1_ADULT_SYSTEM);
    expect(mockedCallAI.mock.calls[1][3]?.jsonSchema?.name).toBe('judge_v1');
  });

  it('does NOTHING when only the first fires, and takes no middle action', async () => {
    mockedCallAI.mockResolvedValueOnce(verdict({ family: 'hostile', severity: 7 }));
    mockedCallAI.mockResolvedValueOnce(verdict({ charged: false, severity: 0, family: 'none', effect: 'inert', intent: 'none' }));
    const r = await runAdult();
    expect(r?.analysis.isManipulative).toBe(false);
    expect(r?.analysis.action).toBeUndefined();
    expect(r?.neutralized).toBeNull();
    expect(mockedRewrite).not.toHaveBeenCalled();
    // No mark, no collapse, nothing on screen. That bucket is right 43 percent of the time
    // weighted to the real base rate, and a mark a reader should ignore half the time
    // teaches them to ignore all of them.
    expect(r?.analysis.techniques).toEqual([]);
  });

  it('still names the pair when they ran and disagreed, because two models did read it', async () => {
    mockedCallAI.mockResolvedValueOnce(verdict({ severity: 6 }));
    mockedCallAI.mockResolvedValueOnce(verdict({ charged: false, severity: 0, family: 'none', effect: 'inert', intent: 'none' }));
    const r = await runAdult();
    expect(r?.analysis.judge?.id).toBe('judge-v1-pair');
    expect(r?.analysis.judge?.model).toBe(`${JUDGE_V1_MODEL}+${JUDGE_V1_SECOND_MODEL}`);
  });

  it('never asks the second judge when the first did not fire, which is what keeps it cheap', async () => {
    mockedCallAI.mockResolvedValueOnce(verdict({ severity: 3 }));
    const r = await runAdult();
    expect(mockedCallAI).toHaveBeenCalledTimes(1);
    // One model read it, so the record says one model read it.
    expect(r?.analysis.judge?.id).toBe('judge-v1');
    expect(r?.analysis.judge?.model).toBe(JUDGE_V1_MODEL);
  });

  it('does not act when the second judge fails to answer at all', async () => {
    mockedCallAI.mockResolvedValueOnce(verdict({ severity: 6 }));
    mockedCallAI.mockResolvedValueOnce(Ok('not json'));
    const r = await runAdult();
    expect(r?.analysis.isManipulative).toBe(false);
  });
});

describe('parseJudgeV1', () => {
  it('accepts the five-field shape and clamps severity to 0..10', () => {
    expect(parseJudgeV1('{"charged":true,"family":"body","severity":12,"effect":"recruit","intent":"compare"}'))
      .toEqual({ charged: true, family: 'body', severity: 10, effect: 'recruit', intent: 'compare' });
  });
  it('rejects a wrong enum, a missing field, and non-JSON', () => {
    expect(parseJudgeV1('{"charged":true,"family":"spam","severity":5,"effect":"recruit","intent":"react"}')).toBeNull();
    expect(parseJudgeV1('{"charged":true,"family":"body","severity":5,"effect":"recruit"}')).toBeNull();
    expect(parseJudgeV1('not json')).toBeNull();
  });
});

describe('child and teen keep the legacy judge', () => {
  it('sends the parent-frame prompt, not JUDGE-V1, in teen mode', async () => {
    mockedCallAI.mockResolvedValue(Ok('no'));
    await combinedDetectAndNeutralize('a post', NO_L1, 'teen', 'en', 'unknown', undefined, { twoStageCascade: true });
    const systems = mockedCallAI.mock.calls.map((c) => c[0]);
    expect(systems.some((s) => s === JUDGE_V1_ADULT_SYSTEM)).toBe(false);
  });
});

// The on-demand reading (content/read-this.ts) asks the same instrument:
// same system prompt, model, schema and message shape, with the five fields
// returned as they are and no cut applied, because nothing is acted on.
describe('readWithJudgeV1 is the same instrument, uncut', () => {
  beforeEach(() => { mockedCallAI.mockReset(); });

  it('sends the measured prompt, model and schema and returns the five fields', async () => {
    mockedCallAI.mockResolvedValueOnce(Ok(JSON.stringify({ charged: true, family: 'commercial', severity: 2, effect: 'inert', intent: 'buy' })));
    const v = await readWithJudgeV1('Only today. 70% off, ends at midnight.', { platform: 'instagram', kind: 'comment', parentText: 'the post' });
    expect(v).toEqual({ charged: true, family: 'commercial', severity: 2, effect: 'inert', intent: 'buy' });
    const [system, user, , opts] = mockedCallAI.mock.calls[0];
    expect(system).toBe(JUDGE_V1_ADULT_SYSTEM);
    expect(user).toBe(buildJudgeV1UserPrompt({ text: 'Only today. 70% off, ends at midnight.', platform: 'instagram', kind: 'comment', parentText: 'the post' }));
    expect(opts).toMatchObject({ model: JUDGE_V1_MODEL, jsonSchema: JUDGE_V1_SCHEMA, jsonMode: true });
  });

  it('a failed call or a wrong shape is null, never a guess', async () => {
    mockedCallAI.mockResolvedValueOnce(Ok('{"charged": "maybe"}'));
    expect(await readWithJudgeV1('some text here', { platform: 'twitter' })).toBeNull();
  });
});
