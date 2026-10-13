// A flagged post whose rewrite did not come back kept the author's words behind a red dot, and nothing said which check
// refused it (the owner's export of 12 Oct 2026: 321 of 800 attempts failed, 40 percent; the record kept no reason).
// Two things, ordered by the Leader at 02:0x: the combined call names the check that refused the rewrite as one fixed word
// (rewriteWhy, written on the decision record as rewrite.why), and it makes ONE more try by the rewrite-only call when the
// judge asked for a rewrite and did not deliver a usable one. Never two. Counted (rewriteRetry:landed, :failed), and the
// second answer passes the same checks. Not made when the judge itself declined to rewrite (hide, collapse), when rewriting
// is off, or when the post moved on.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TechniqueResult } from '../../../src/types/analysis';

vi.mock('../../../src/ai/client', () => ({ callAI: vi.fn() }));
vi.mock('../../../src/forensics/hasher', () => ({ sha256: vi.fn(async () => 'deadbeef') }));
const { recordSpy } = vi.hoisted(() => ({ recordSpy: vi.fn(async (_name: string, ..._rest: unknown[]) => undefined) }));
vi.mock('../../../src/forensics/neutralizer-diagnostics', () => ({ recordNeutralizerEvent: recordSpy }));

import { combinedDetectAndNeutralize } from '../../../src/core/neutralizer';
import { callAI } from '../../../src/ai/client';
import { Ok } from '../../../src/ai/ai-error';

const mockedCallAI = vi.mocked(callAI);
const rewrite = vi.fn(async (_input: { text: string; technique: string; signal?: AbortSignal }) => '');

const L1: TechniqueResult[] = [
  { technique: 'shame-attack', present: false, confidence: 0, severity: 0, evidence: [] },
  { technique: 'fear-appeal', present: false, confidence: 0, severity: 0, evidence: [] },
];
const POST = 'you stupid worthless people ruin everything for everyone here';
const GOOD = 'I disagree strongly with how these people have acted and I want something to change here.';
const META = 'This post says the author is upset with the group and wants change.';

function judge(opts: { neutralizedText?: string | null; action?: string; severity?: number } = {}) {
  const body: Record<string, unknown> = {
    techniques: [{ name: 'shame-attack', verdict: 'CONFIRMED', severity: opts.severity ?? 6, reason: 'attack' }],
    overallManipulative: true,
    overallConfidence: 0.9,
    neutralizedText: opts.neutralizedText ?? null,
  };
  if (opts.action) body.action = opts.action;
  mockedCallAI.mockResolvedValueOnce(Ok(JSON.stringify(body)));
}
const run = (options: Record<string, unknown> = {}) =>
  combinedDetectAndNeutralize(POST, L1, undefined, 'en', 'unknown', undefined, { rewrite, ...options });
const counted = (name: string) => recordSpy.mock.calls.filter((c) => c[0] === name).length;

beforeEach(() => {
  mockedCallAI.mockReset();
  rewrite.mockReset();
  rewrite.mockResolvedValue('');
  recordSpy.mockClear();
});

describe('the check that refused the judge\'s rewrite is named', () => {
  it.each([
    ['a meta-talk opening', { neutralizedText: META }, 'meta-talk'],
    ['a rewrite that keeps a swear', { neutralizedText: 'That claim is fucking wrong.' }, 'unsafe-language'],
    ['an answer with no text', { neutralizedText: null }, 'judge-sent-none'],
    ['blank text', { neutralizedText: '   ' }, 'blank'],
    ['text too short to be a rewrite', { neutralizedText: 'no' }, 'too-short'],
  ] as const)('%s', async (_name, reply, why) => {
    judge(reply);
    // No rewrite hook: the legacy callers see the word and no second try.
    const result = await combinedDetectAndNeutralize(POST, L1, undefined, 'en', 'unknown', undefined, {});
    expect(result!.neutralized).toBeNull();
    expect(result!.rewriteWhy).toBe(why);
    expect(counted('rewriteRetry:failed') + counted('rewriteRetry:landed')).toBe(0);
  });

  it('the judge saying "too hostile to defuse" is its own word, and gets no second try', async () => {
    judge({ neutralizedText: null, action: 'hide', severity: 6 });
    const result = await run();
    expect(result!.neutralized).toBeNull();
    expect(result!.rewriteWhy).toBe('judge-declined');
    expect(rewrite).not.toHaveBeenCalled();
  });

  it('a rewrite that lands has no word', async () => {
    judge({ neutralizedText: GOOD });
    const result = await run();
    expect(result!.neutralized?.rewrittenText).toBe(GOOD);
    expect(result!.rewriteWhy).toBeUndefined();
    expect(rewrite).not.toHaveBeenCalled();
  });
});

describe('one more try, never two', () => {
  it('the judge\'s text refused, the second answer good: it lands, once, counted', async () => {
    judge({ neutralizedText: META });
    rewrite.mockResolvedValueOnce(GOOD);
    const result = await run();
    expect(result!.neutralized?.rewrittenText).toBe(GOOD);
    expect(result!.rewriteWhy).toBeUndefined();
    expect(rewrite).toHaveBeenCalledTimes(1);
    expect(rewrite).toHaveBeenCalledWith(expect.objectContaining({ text: POST, technique: 'shame-attack' }));
    expect(counted('rewriteRetry:landed')).toBe(1);
    expect(counted('rewriteRetry:failed')).toBe(0);
  });

  it('the judge sent no text, the second answer good: it lands', async () => {
    judge({ neutralizedText: null });
    rewrite.mockResolvedValueOnce(GOOD);
    const result = await run();
    expect(result!.neutralized?.rewrittenText).toBe(GOOD);
    expect(rewrite).toHaveBeenCalledTimes(1);
  });

  it('the second answer refused too: the first word stands with +retry, the call was made once, counted failed', async () => {
    judge({ neutralizedText: META });
    rewrite.mockResolvedValue(META);
    const result = await run();
    expect(result!.neutralized).toBeNull();
    expect(result!.rewriteWhy).toBe('meta-talk+retry');
    expect(rewrite).toHaveBeenCalledTimes(1);
    expect(counted('rewriteRetry:failed')).toBe(1);
  });

  it.each([
    ['nothing back', ''],
    ['a swear kept', 'That claim is fucking wrong.'],
    ['too short', 'no'],
  ])('the second answer must pass the same checks (%s)', async (_name, second) => {
    judge({ neutralizedText: null });
    rewrite.mockResolvedValueOnce(second);
    const result = await run();
    expect(result!.neutralized).toBeNull();
    expect(result!.rewriteWhy).toBe('judge-sent-none+retry');
    expect(counted('rewriteRetry:failed')).toBe(1);
  });

  it('a second call that throws is a failed try, not a crash', async () => {
    judge({ neutralizedText: META });
    rewrite.mockRejectedValueOnce(new Error('network'));
    const result = await run();
    expect(result!.neutralized).toBeNull();
    expect(result!.rewriteWhy).toBe('meta-talk+retry');
    expect(rewrite).toHaveBeenCalledTimes(1);
  });

  it('the hostile fallback still follows a refused second try (severe hostile: hidden, as before)', async () => {
    judge({ neutralizedText: META, severity: 9 });
    rewrite.mockResolvedValue(META);
    const result = await run();
    expect(result!.neutralized).toBeNull();
    expect(result!.analysis.action).toBe('hide');
  });

  it('no try when rewriting is off, when the post moved on, or when the judge asked for hide', async () => {
    judge({ neutralizedText: null });
    await run({ rewriteEnabled: false });
    judge({ neutralizedText: null });
    const gone = new AbortController();
    gone.abort();
    await run({ signal: gone.signal });
    judge({ neutralizedText: null, action: 'collapse' });
    await run();
    expect(rewrite).not.toHaveBeenCalled();
    expect(counted('rewriteRetry:failed') + counted('rewriteRetry:landed')).toBe(0);
  });
});

describe('at Open, where the rewrite is its own call: the same one more try', () => {
  const verdict = (fields: Record<string, unknown> = {}) =>
    Ok(JSON.stringify({ charged: true, family: 'hostile', severity: 5, effect: 'recruit', intent: 'react', ...fields }));
  const bothAgree = (fields: Record<string, unknown> = {}) => {
    mockedCallAI.mockResolvedValueOnce(verdict(fields));
    mockedCallAI.mockResolvedValueOnce(verdict(fields));
  };
  const open = () =>
    combinedDetectAndNeutralize(POST, L1, 'adult', 'en', 'unknown', undefined, { twoStageCascade: true, platform: 'twitter', kind: 'post', rewrite });

  it('a first rewrite that does not come back, a second that does: it lands, the call is made twice, counted', async () => {
    bothAgree();
    rewrite.mockResolvedValueOnce('').mockResolvedValueOnce(GOOD);
    const result = await open();
    expect(result!.neutralized?.rewrittenText).toBe(GOOD);
    expect(result!.rewriteWhy).toBeUndefined();
    expect(rewrite).toHaveBeenCalledTimes(2);
    expect(counted('rewriteRetry:landed')).toBe(1);
  });

  it('both fail: the first word stands with +retry and the call is never made a third time', async () => {
    bothAgree();
    const result = await open();
    expect(result!.neutralized).toBeNull();
    expect(result!.rewriteWhy).toBe('no-text+retry');
    expect(rewrite).toHaveBeenCalledTimes(2);
    expect(counted('rewriteRetry:failed')).toBe(1);
  });

  it('a first rewrite that lands is not asked for twice', async () => {
    bothAgree();
    rewrite.mockResolvedValueOnce(GOOD);
    const result = await open();
    expect(result!.neutralized?.rewrittenText).toBe(GOOD);
    expect(rewrite).toHaveBeenCalledTimes(1);
    expect(counted('rewriteRetry:landed') + counted('rewriteRetry:failed')).toBe(0);
  });
});

describe('the shape-drift counter counts drift, not a benign verdict', () => {
  it('an empty technique list (nothing found) is not counted', async () => {
    mockedCallAI.mockResolvedValueOnce(Ok(JSON.stringify({ techniques: [], overallManipulative: false, overallConfidence: 0.9, neutralizedText: null })));
    const result = await combinedDetectAndNeutralize(POST, L1, undefined, 'en', 'unknown', undefined, {});
    expect(result!.analysis.isManipulative).toBe(false);
    expect(counted('techniques-shape-drift')).toBe(0);
  });

  it('a list of strings where objects belong still is', async () => {
    mockedCallAI.mockResolvedValueOnce(Ok(JSON.stringify({ techniques: ['fear-appeal', 'fomo'], overallManipulative: true, overallConfidence: 0.9, neutralizedText: null })));
    await combinedDetectAndNeutralize(POST, L1, undefined, 'en', 'unknown', undefined, {});
    expect(counted('techniques-shape-drift')).toBe(1);
  });
});
