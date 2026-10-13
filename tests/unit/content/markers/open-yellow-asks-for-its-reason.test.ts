// @vitest-environment jsdom
//
// Open's yellow (13 Oct 2026). Calm's yellow is the model's own one-line reason, which comes inside its reply. Open's
// measured reader answers with labels only, so the second press of the dot used to show the technique's fixed line on
// every item. Now the first press to the reason shows that fixed line and asks, once, for a sentence about this post;
// the sentence replaces the line when it arrives, stays for every later press, and on any failure the fixed line stays.
// Calm, which has the reason already, asks for nothing.

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/ai/open-reason', () => ({ askOpenReason: vi.fn() }));

import { renderTeenMarker } from '../../../../src/content/markers/teen-marker';
import { askOpenReason } from '../../../../src/ai/open-reason';
import { MARKER_REASONS } from '../../../../src/i18n/marker-strings';
import type { AnalysisResult } from '../../../../src/types/analysis';

const ORIGINAL = 'Everyone who believes this is an idiot and should be ashamed of themselves.';
const REWRITE = 'I strongly disagree with people who believe this, and it frustrates me.';
const FIXED = MARKER_REASONS.en['shame-attack'];
const BETTER = 'It tries to make you pick a side by shaming anyone who disagrees.';
const asked = vi.mocked(askOpenReason);

function analysis(over: Partial<AnalysisResult> = {}): AnalysisResult {
  return {
    postId: 'p1',
    techniques: [{ technique: 'shame-attack', present: true, confidence: 0.9, severity: 7, evidence: [] }],
    overallScore: 7,
    overallConfidence: 0.9,
    isManipulative: true,
    processingTimeMs: 1,
    primaryTechnique: 'shame-attack',
    // The measured reader's own line on the record: an instrument tag, never shown to a person.
    explanation: 'judge-v1: hostile, recruit, wants the reader to pick a side',
    judge: {
      id: 'judge-v1', hash: 'h', model: 'openai/gpt-oss-120b',
      charged: true, family: 'hostile', severity: 7, effect: 'recruit', intent: 'belong',
    },
    ...over,
  } as AnalysisResult;
}

function body(): HTMLElement {
  const el = document.createElement('div');
  el.setAttribute('data-testid', 'tweetText');
  el.textContent = ORIGINAL;
  document.body.appendChild(el);
  return el;
}

const flattenInto = (el: HTMLElement) => (): boolean => { el.textContent = ORIGINAL; return true; };
const dot = (el: HTMLElement): HTMLButtonElement => el.querySelector<HTMLButtonElement>('.fw-teen-marker')!;
const state = (el: HTMLElement): string | undefined => el.dataset.fwMarkerState;
const flush = async (): Promise<void> => { for (let i = 0; i < 4; i++) await Promise.resolve(); };

/** A promise the test settles by hand, so "before the answer" and "after the answer" are two separate moments. */
function deferred(): { promise: Promise<string | null>; settle: (v: string | null) => void } {
  let settle!: (v: string | null) => void;
  const promise = new Promise<string | null>((r) => { settle = r; });
  return { promise, settle };
}

function openWalk(el: HTMLElement, a: AnalysisResult = analysis()): void {
  renderTeenMarker({
    el, analysis: a, originalText: ORIGINAL, kind: 'rewrite', rewriteText: REWRITE,
    entry: 'original', flatten: flattenInto(el),
  });
}

beforeEach(() => {
  document.body.innerHTML = '';
  asked.mockReset();
});

describe('Open: the first press to the reason', () => {
  it('shows the fixed line, asks once with the post and the reader\'s labels, then shows the sentence', async () => {
    const answer = deferred();
    asked.mockReturnValue(answer.promise);
    const el = body();
    openWalk(el);
    expect(asked).not.toHaveBeenCalled();

    dot(el).click();
    expect(state(el)).toBe('yellow');
    expect(el.textContent).toContain(FIXED);
    expect(el.textContent).not.toContain('judge-v1');
    expect(asked).toHaveBeenCalledTimes(1);
    expect(asked).toHaveBeenCalledWith({
      text: ORIGINAL, reading: expect.objectContaining({ family: 'hostile', effect: 'recruit', intent: 'belong' }), lang: 'en',
    });

    answer.settle(BETTER);
    await flush();
    expect(el.textContent).toContain(BETTER);
    expect(el.textContent).not.toContain(FIXED);
    expect(state(el)).toBe('yellow');
  });

  it('keeps the sentence for every later press and never asks again', async () => {
    asked.mockResolvedValue(BETTER);
    const el = body();
    openWalk(el);
    dot(el).click();
    await flush();
    dot(el).click(); // green
    dot(el).click(); // red
    dot(el).click(); // yellow again
    expect(state(el)).toBe('yellow');
    expect(el.textContent).toContain(BETTER);
    expect(asked).toHaveBeenCalledTimes(1);
  });

  it('a sentence that arrives after the person moved on waits for the next press to the reason', async () => {
    const answer = deferred();
    asked.mockReturnValue(answer.promise);
    const el = body();
    openWalk(el);
    dot(el).click(); // yellow
    dot(el).click(); // green: the calm version
    answer.settle(BETTER);
    await flush();
    expect(state(el)).toBe('green');
    expect(el.textContent).toContain(REWRITE);
    expect(el.textContent).not.toContain(BETTER);
    dot(el).click(); // red
    dot(el).click(); // yellow
    expect(el.textContent).toContain(BETTER);
  });
});

describe('Open: when the sentence does not come', () => {
  it.each([
    ['no answer', () => Promise.resolve(null)],
    ['a refused call', () => Promise.reject(new Error('refused'))],
    ['an answer that names the instrument\'s vocabulary', () => Promise.resolve('This is shame-attack with severity 8, so it is flagged.')],
    ['an answer that gives advice', () => Promise.resolve('You should do your own research before you believe any of this.')],
  ])('%s: the fixed line stays, and so does the dot', async (_name, answer) => {
    asked.mockImplementation(answer);
    const el = body();
    openWalk(el);
    dot(el).click();
    await flush();
    expect(el.textContent).toContain(FIXED);
    expect(state(el)).toBe('yellow');
    dot(el).click();
    expect(state(el)).toBe('green');
  });
});

describe('Open: a mark with no calm version (two states)', () => {
  it('asks on the press to the reason and swaps the sentence in', async () => {
    const answer = deferred();
    asked.mockReturnValue(answer.promise);
    const el = body();
    renderTeenMarker({ el, analysis: analysis(), originalText: ORIGINAL, kind: 'rewrite', rewriteText: '' });
    dot(el).click();
    expect(state(el)).toBe('yellow');
    expect(el.textContent).toContain(FIXED);
    expect(asked).toHaveBeenCalledTimes(1);
    answer.settle(BETTER);
    await flush();
    expect(el.textContent).toContain(BETTER);
    dot(el).click();
    expect(el.textContent).toContain(ORIGINAL);
    dot(el).click();
    expect(el.textContent).toContain(BETTER);
    expect(asked).toHaveBeenCalledTimes(1);
  });
});

describe('where it does not ask', () => {
  it('Calm: the reason came inside the model\'s reply, so a press asks for nothing', () => {
    const el = body();
    const calm = analysis({ judge: undefined, explanation: 'it shames the reader for a belief' });
    renderTeenMarker({ el, analysis: calm, originalText: ORIGINAL, kind: 'rewrite', rewriteText: REWRITE });
    dot(el).click();
    expect(state(el)).toBe('yellow');
    expect(el.textContent).toContain('it shames the reader for a belief');
    expect(asked).not.toHaveBeenCalled();
  });

  it('an item the measured reader did not charge', () => {
    const el = body();
    const a = analysis();
    openWalk(el, { ...a, judge: { ...a.judge!, charged: false } });
    dot(el).click();
    expect(asked).not.toHaveBeenCalled();
  });

  it('a folded post, which has no original to explain', () => {
    const el = document.createElement('div');
    el.textContent = 'Folded: group claim';
    document.body.appendChild(el);
    renderTeenMarker({ el, analysis: analysis(), originalText: ORIGINAL, kind: 'collapse' });
    dot(el).click();
    expect(asked).not.toHaveBeenCalled();
  });
});
