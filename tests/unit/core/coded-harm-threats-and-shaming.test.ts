// A harassing comment is kept, hidden and named without a key and without the AI (11 Oct 2026, the night walk).
// The home page's own example of Feedprint's use is "a harassing comment or a post later deleted", and the free rules kept
// only two of eight sample lines: the self-harm ones. Six passed at severity 0 and were never written to the record. This
// pins what the free rules now keep, what they still leave to the AI on purpose, and the near-misses that must stay quiet.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/ai/client', () => ({ callAI: vi.fn() }));

import { detectCodedHarm, codedHarmVerdictFields } from '../../../src/core/coded-harm-catcher';
import { scoreBatch, encounterFromLegacyBatchInput, clearBatchCache } from '../../../src/analysis/comment-batch-scorer';
import { callAI } from '../../../src/ai/client';
import { _resetForTests as resetFlushBudget } from '../../../src/ai/global-flush-budget';

const mockCallAI = callAI as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  resetFlushBudget();
  mockCallAI.mockReset();
  clearBatchCache();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('a direct threat at the reader', () => {
  it('fires on the threat forms, in three languages', () => {
    const threats = [
      'I know where you live',
      'we know where you live, loser',
      'everyone knows where you go to school',
      'i know where your kids go to school',
      "I'll find you and kill you",
      'I am going to track you down and hurt you',
      'Stiu unde locuiesti',
      'Sabemos donde vives',
    ];
    for (const text of threats) {
      expect(detectCodedHarm(text)?.category, text).toBe('direct-threat');
    }
  });

  it('is called by its name: the catch-all technique, severity 8, hidden', () => {
    const hit = detectCodedHarm('I know where you live');
    expect(hit && codedHarmVerdictFields(hit)).toEqual({ technique: 'combined', severity: 8, hideTier: true });
  });

  it('stays quiet on look-alikes, a friendly move, and the banter it leaves to the AI', () => {
    const quiet = [
      'I know where the bug lives',
      "we'll find you a seat near the front",
      'I know where you live now, congrats on the move!',
      'i know where you live, we are neighbours now, come over for dinner haha',
      "I'll find you and make you regret missing this concert",
      'I am going to track you down and make you pay for dinner lol',
      "I'll kill you if you spoil the finale",
      "you're dead in the next round",
      'I know where he lives, it is the blue house on the corner',
    ];
    for (const text of quiet) {
      const hit = detectCodedHarm(text);
      expect(hit?.category === 'direct-threat' ? hit.pattern : null, text).toBeNull();
    }
  });
});

describe('shaming and exile aimed at the reader', () => {
  it('fires on a claim of being hated paired with an order to vanish, or on being laughed at behind the back', () => {
    const shaming = [
      'Nobody at school likes you, just delete your account',
      'Everyone hates you, go away forever',
      'go away forever, everybody hates you',
      'no one wants you here, disappear',
      'You are so ugly, everyone laughs at you behind your back',
      'Nimeni nu te place, dispari',
      'Toti te urasc, sterge-ti contul',
    ];
    for (const text of shaming) {
      expect(detectCodedHarm(text)?.category, text).toBe('shaming-harassment');
    }
  });

  it('is called the shame attack, severity 8, hidden', () => {
    const hit = detectCodedHarm('Everyone hates you, go away forever');
    expect(hit && codedHarmVerdictFields(hit)).toEqual({ technique: 'shame-attack', severity: 8, hideTier: true });
  });

  it('stays quiet on a claim alone, an order alone, a song and a sitcom', () => {
    const quiet = [
      "Nobody likes you when you're 23",
      'Everybody Hates Chris is back on tonight',
      'honestly nobody likes you here',
      'if the app is slow, just delete your account and sign up again',
      'go away for the weekend, you deserve a rest',
      'the kids laugh at you behind your back in this scene, it is a great pay-off',
      'Nimeni nu te place cand esti obosit, dar maine e alta zi',
    ];
    for (const text of quiet) {
      expect(detectCodedHarm(text)?.category, text).not.toBe('shaming-harassment');
    }
  });
});

describe('the free path with the AI down keeps what the rules find', () => {
  const run = async (text: string) => {
    mockCallAI.mockRejectedValue(new Error('no AI on the free tier'));
    const result = await scoreBatch(encounterFromLegacyBatchInput({
      comments: [{ author: 'a', text }],
      videoCaption: 'c',
      language: 'English',
    }));
    expect(result.failed).toBe(true);
    return result.comments[0];
  };

  it.each([
    'Nobody at school likes you, just delete your account',
    'You are so ugly, everyone laughs at you behind your back',
    'I know where you live',
    'Everyone hates you, go away forever',
    'Kill yourself',
    'kys loser',
  ])('hides and records "%s"', async (text) => {
    const verdict = await run(text);
    expect(verdict.action, text).toBe('hide');
    expect(verdict.severity, text).toBeGreaterThanOrEqual(8);
    expect(verdict.overrideOrigin, text).toBe('coded-harm');
  });

  // Not caught on purpose: plain insults carry no threat and no order to leave, and a rule for them
  // would hide ordinary rudeness at every level. The AI reads them when it runs.
  it.each([
    'We all know what you did, you disgusting liar',
    'you are an idiot and a loser',
  ])('leaves "%s" to the AI', async (text) => {
    const verdict = await run(text);
    expect(verdict.action, text).not.toBe('hide');
    expect(verdict.severity, text).toBeLessThan(7);
  });
});
