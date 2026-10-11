// The paid reading through the adult judge itself: gpt-oss fires, and the item acts when Gemma or
// Claude Haiku agrees. Haiku is asked beside Gemma on every item gpt-oss fired on, never otherwise,
// and the record says what came of it. A Haiku that fails is no vote, so the item keeps the pair's
// rule. JUDGE-V1 itself (prompt hash, model, cut) is untouched.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TechniqueResult } from '../../../src/types/analysis';

vi.mock('../../../src/ai/client', () => ({ callAI: vi.fn() }));
vi.mock('../../../src/forensics/hasher', () => ({ sha256: vi.fn(async () => 'deadbeef') }));
vi.mock('../../../src/forensics/neutralizer-diagnostics', () => ({ recordNeutralizerEvent: vi.fn(async () => undefined) }));

import { combinedDetectAndNeutralize } from '../../../src/core/neutralizer';
import { callAI } from '../../../src/ai/client';
import { Err, Ok } from '../../../src/ai/ai-error';
import { JUDGE_V1_HASH, JUDGE_V1_MODEL, JUDGE_V1_SECOND_MODEL } from '../../../src/ai/prompts';

const mockedCallAI = vi.mocked(callAI);
const NO_L1: TechniqueResult[] = [{ technique: 'fear-appeal', present: false, confidence: 0, severity: 0, evidence: [] }];

type Reading = 'fires' | 'below' | 'fails';
const fields = (r: Reading) => ({ charged: true, family: 'hostile', severity: r === 'fires' ? 5 : 3, effect: 'recruit', intent: 'react' });

function judges(gpt: Reading, gemma: Reading) {
  mockedCallAI.mockImplementation(async (_system, _user, _fast, opts) => {
    const r = opts?.model === JUDGE_V1_SECOND_MODEL ? gemma : gpt;
    return r === 'fails' ? Err({ kind: 'network' }) : Ok(JSON.stringify(fields(r)));
  });
}

function haiku(r: Reading | 'absent') {
  if (r === 'absent') return undefined;
  return vi.fn(async () => (r === 'fails'
    ? { model: 'claude-haiku-5-5', provider: 'anthropic', hash: 'd83cd0253c1c', outcome: 'refused' }
    : { model: 'claude-haiku-5-5', provider: 'anthropic', hash: 'd83cd0253c1c', outcome: 'read', reading: fields(r) }));
}

function run(claudeReader: ReturnType<typeof haiku>) {
  return combinedDetectAndNeutralize('They are all clowns.', NO_L1, 'adult', 'en', 'unknown', undefined, {
    twoStageCascade: true, platform: 'twitter', kind: 'comment', parentText: 'The council voted today.',
    rewrite: async () => '',
    ...(claudeReader ? { claudeReader } : {}),
  });
}

beforeEach(() => { mockedCallAI.mockReset(); });

describe('the tier table through the judge', () => {
  const gpts: Reading[] = ['fires', 'below'];
  const gemmas: Reading[] = ['fires', 'below', 'fails'];
  const haikus: Array<Reading | 'absent'> = ['fires', 'below', 'fails', 'absent'];
  for (const g of gpts) for (const m of gemmas) for (const h of haikus) {
    const acts = g === 'fires' && (m === 'fires' || h === 'fires');
    it(`gpt-oss ${g}, Gemma ${m}, Haiku ${h}: ${acts ? 'acts' : 'passes'}`, async () => {
      judges(g, m);
      const reader = haiku(h);
      const r = await run(reader);
      expect(r?.analysis.isManipulative).toBe(acts);
      // Haiku is asked exactly when gpt-oss fired, beside Gemma, whatever Gemma said.
      if (reader) expect(reader).toHaveBeenCalledTimes(g === 'fires' ? 1 : 0);
      // The record names Haiku only when it was asked, with what came of it.
      const stamp = r?.analysis.judge?.claude;
      if (reader && g === 'fires') expect(stamp?.outcome).toBe(h === 'fails' ? 'refused' : 'read');
      else expect(stamp).toBeUndefined();
      // The measured judge is the same instrument with or without the paid reading.
      expect(r?.analysis.judge?.hash).toBe(JUDGE_V1_HASH);
      expect(r?.analysis.judge?.model).toBe(g === 'fires' ? `${JUDGE_V1_MODEL}+${JUDGE_V1_SECOND_MODEL}` : JUDGE_V1_MODEL);
    });
  }
});

describe('what Haiku is given', () => {
  it('the item, its platform, kind, parent and the judge signal, nothing else', async () => {
    judges('fires', 'below');
    const reader = haiku('fires')!;
    await run(reader);
    expect(reader).toHaveBeenCalledWith({
      text: 'They are all clowns.', platform: 'twitter', kind: 'comment', parentText: 'The council voted today.', signal: undefined,
    });
  });

  it('is asked beside Gemma, not after it', async () => {
    let releaseGemma: () => void = () => undefined;
    mockedCallAI.mockImplementation(async (_s, _u, _f, opts) => {
      if (opts?.model === JUDGE_V1_SECOND_MODEL) await new Promise<void>((done) => { releaseGemma = done; });
      return Ok(JSON.stringify(fields('fires')));
    });
    const reader = haiku('fires')!;
    const pending = run(reader);
    await vi.waitFor(() => expect(reader).toHaveBeenCalledTimes(1));
    releaseGemma();
    expect((await pending)?.analysis.isManipulative).toBe(true);
  });
});
