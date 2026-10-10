// The rewrite call says which model wrote its rewrite, so the page's AI mark and the record can
// name it: the model the reply named, and on a cache hit the model the first reply named. A caller
// with no signal of its own still gets the name, and nothing is named when no reply named a model
// or the rewrite was refused.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/ai/client', () => ({
  callAI: vi.fn(),
  GROQ_FAST_MODEL: 'openai/gpt-oss-20b',
}));

import { neutralizeText, __resetRewriteCacheForTests } from '../../../src/ai/neutralize-only';
import { callAI } from '../../../src/ai/client';
import { noteCallProvenance } from '../../../src/ai/call-provenance';
import { Ok } from '../../../src/ai/ai-error';

const mockCallAI = vi.mocked(callAI);
const INPUT = { text: 'I really hate everyone here', technique: 'shame-attack' };
const REWRITE = "I'm frustrated with the people here.";

/** Answers as the real client does: a text reply notes, under the call's signal, the model it named. */
function replyFrom(model: string | null, text = REWRITE): void {
  mockCallAI.mockImplementationOnce(async (_system, _user, _fast, opts) => {
    if (model) noteCallProvenance(opts?.signal, { model, provider: 'deepinfra' });
    return Ok(text);
  });
}

beforeEach(() => {
  mockCallAI.mockReset();
  __resetRewriteCacheForTests();
});

describe('the rewrite names its writer', () => {
  it('names the model the reply named, with no signal from the caller', async () => {
    replyFrom('openai/gpt-oss-20b');
    const onWriter = vi.fn();
    expect(await neutralizeText({ ...INPUT, onWriter })).toBe(REWRITE);
    expect(onWriter).toHaveBeenCalledWith('openai/gpt-oss-20b');
  });

  it('names the same model on a cache hit, which makes no call', async () => {
    replyFrom('openai/gpt-oss-20b');
    await neutralizeText({ ...INPUT });
    const onWriter = vi.fn();
    expect(await neutralizeText({ ...INPUT, onWriter })).toBe(REWRITE);
    expect(mockCallAI).toHaveBeenCalledTimes(1);
    expect(onWriter).toHaveBeenCalledWith('openai/gpt-oss-20b');
  });

  it('names nobody when the reply named no model', async () => {
    replyFrom(null);
    const onWriter = vi.fn();
    expect(await neutralizeText({ ...INPUT, onWriter })).toBe(REWRITE);
    expect(onWriter).not.toHaveBeenCalled();
  });

  it('names nobody when the rewrite is refused', async () => {
    replyFrom('openai/gpt-oss-20b', 'The author expresses frustration about the people here.');
    const onWriter = vi.fn();
    expect(await neutralizeText({ ...INPUT, onWriter })).toBe('');
    expect(onWriter).not.toHaveBeenCalled();
  });
});
