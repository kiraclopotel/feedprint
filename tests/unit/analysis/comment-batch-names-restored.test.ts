// The comment batch and the room reading send labels in place of account names and put the names
// back into every free-text field of the answer before it is cut, cached, recorded or shown.
// callAI is mocked, so this reads what the scorer hands the client and what it makes of the reply.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/ai/client', () => ({
  callAI: vi.fn(),
}));

import {
  scoreBatch,
  scoreRoom,
  parseRoomAnalysis,
  encounterFromLegacyBatchInput,
  __resetBatchCacheForTests,
} from '../../../src/analysis/comment-batch-scorer';
import { callAI } from '../../../src/ai/client';
import { Ok } from '../../../src/ai/ai-error';
import { _resetForTests as resetFlushBudget } from '../../../src/ai/global-flush-budget';
import { buildNameLabelMapForEncounter, resetNameLabelCountsForTests, readNameLabelCounts } from '../../../src/core/name-labels';
import type { Encounter } from '../../../src/types/post';

const mockCallAI = callAI as unknown as ReturnType<typeof vi.fn>;

function reply(comments: Array<Record<string, unknown>>, summary = 'a summary'): ReturnType<typeof Ok> {
  return Ok(JSON.stringify({ comments, environment: { label: 'healthy-discussion', summary } }));
}

function room(post: string, comments: Array<{ author: string; text: string }>, language = 'English'): Encounter {
  const enc = encounterFromLegacyBatchInput({ comments, videoCaption: post, language }, 'tiktok');
  enc.post.author = { handle: '@creator', verified: false, is_creator: true };
  return enc;
}

beforeEach(() => {
  resetFlushBudget();
  __resetBatchCacheForTests();
  resetNameLabelCountsForTests();
  mockCallAI.mockReset();
  vi.spyOn(console, 'debug').mockImplementation(() => undefined);
});

describe('scoreBatch sends labels and restores the names', () => {
  it('hands the client a prompt with no handle, one @ per label, and the identifiers to check', async () => {
    mockCallAI.mockResolvedValueOnce(reply([{ index: 1, technique: 'none', sentiment: 'neutral', severity: 0, reason: '' }]));
    await scoreBatch(room('caption by @creator', [{ author: '@jojo', text: 'you and @creator, jojo agrees' }]));
    const [, user, , opts] = mockCallAI.mock.calls[0] as [string, string, boolean, { knownIdentifiers?: string[] }];
    expect(user).not.toMatch(/@creator|jojo/);
    expect(user).not.toContain('@@');
    expect(user).toContain('Post by: @user_A');
    expect(user).toContain('Post text: "caption by @user_A"');
    expect(user).toContain('1. by @user_B ');
    expect(user).toContain('"you and @user_A, @user_B agrees"');
    expect(opts.knownIdentifiers).toEqual(['@creator', '@jojo']);
  });

  it('restores the reason before the 280-character cut, so a label across the cut is not split', async () => {
    const reason = 'x'.repeat(276) + ' @user_B';
    mockCallAI.mockResolvedValueOnce(reply([{ index: 1, technique: 'shame-attack', sentiment: 'negative', severity: 7, reason, target_present: true }]));
    const res = await scoreBatch(room('caption', [{ author: 'jo', text: 'you are worthless' }]));
    expect(res.comments[0].reason).toHaveLength(280);
    expect(res.comments[0].reason.endsWith(' @jo')).toBe(true);
    expect(res.comments[0].reason).not.toContain('user_');
  });

  it('restores the inline rewrite and the room summary, and drops a rewrite holding a label nobody got', async () => {
    mockCallAI.mockResolvedValueOnce(reply([
      { index: 1, technique: 'shame-attack', sentiment: 'negative', severity: 7, reason: 'attacks @user_A', target_present: true,
        neutralized_text: 'I disagree with @user_A and think user B should calm down.' },
      { index: 2, technique: 'shame-attack', sentiment: 'negative', severity: 7, reason: '@user_Q piles on', target_present: true,
        neutralized_text: 'I think @user_Q is wrong here.' },
    ], 'Utilizatorul B și @user_C se ceartă cu @user_A.'));
    const res = await scoreBatch(room('caption', [
      { author: 'jo', text: 'you are worthless @creator' },
      { author: 'kim', text: 'you too @creator' },
    ], 'Romanian'));
    expect(res.comments[0].neutralizedText).toBe('I disagree with @creator and think @jo should calm down.');
    expect(res.comments[0].reason).toBe('attacks @creator');
    // A label this call never issued: the reason takes the neutral word, the rewrite is dropped.
    expect(res.comments[1].reason).toBe('cineva piles on');
    expect(res.comments[1].neutralizedText).toBeUndefined();
    expect(res.environment.summary).toBe('@jo și @kim se ceartă cu @creator.');
    const counts = readNameLabelCounts();
    expect(counts.droppedRewrites).toBe(1);
    expect(counts.unmatched).toBe(2);
    expect(counts.restored).toBeGreaterThanOrEqual(4);
  });

  it('puts each name back in the form the comment itself wrote it', async () => {
    mockCallAI.mockResolvedValueOnce(reply([
      { index: 1, technique: 'shame-attack', sentiment: 'negative', severity: 7, target_present: true,
        reason: '@user_B calls @user_A a liar', neutralized_text: 'I think @user_A is wrong and @user_A knows it' },
    ]));
    const enc = room('caption', [{ author: 'bob', text: 'Sam Sample is a liar and ssample99 knows it' }]);
    enc.post.author = { handle: 'ssample99', display_name: 'Sam Sample', verified: false, is_creator: true };
    const res = await scoreBatch(enc);
    const [, user] = mockCallAI.mock.calls[0] as [string, string];
    expect(user).not.toMatch(/Sam Sample|ssample99/);
    expect(res.comments[0].neutralizedText).toBe('I think Sam Sample is wrong and ssample99 knows it');
    expect(res.comments[0].reason).toBe('@bob calls Sam Sample a liar');
  });

  it('keys the cache on the people as well as the texts, so another thread never inherits restored names', async () => {
    mockCallAI
      .mockResolvedValueOnce(reply([{ index: 1, technique: 'shame-attack', sentiment: 'negative', severity: 7, reason: 'by @user_B', target_present: true }]))
      .mockResolvedValueOnce(reply([{ index: 1, technique: 'shame-attack', sentiment: 'negative', severity: 7, reason: 'by @user_B', target_present: true }]));
    const first = await scoreBatch(room('same caption', [{ author: 'jo', text: 'you are worthless here' }]));
    const second = await scoreBatch(room('same caption', [{ author: 'kim', text: 'you are worthless here' }]));
    expect(mockCallAI).toHaveBeenCalledTimes(2);
    expect(first.comments[0].reason).toBe('by @jo');
    expect(second.comments[0].reason).toBe('by @kim');
    // The same people again is a hit, restored names and all.
    const again = await scoreBatch(room('same caption', [{ author: '@Jo', text: 'you are worthless here' }]));
    expect(mockCallAI).toHaveBeenCalledTimes(2);
    expect(again.comments[0].reason).toBe('by @jo');
  });

  it('counts three comments with no name as three writers, not one repeat poster', async () => {
    mockCallAI.mockResolvedValueOnce(reply([1, 2, 3].map((i) => ({ index: i, technique: 'none', sentiment: 'neutral', severity: 0, reason: '' }))));
    const res = await scoreBatch(room('caption', [
      { author: 'unknown', text: 'first comment here' },
      { author: 'unknown', text: 'second comment here' },
      { author: 'unknown', text: 'third comment here' },
    ]));
    expect(res.environment.authorRecidivism).toBe(1);
    const [, user] = mockCallAI.mock.calls[0] as [string, string];
    expect(user).toContain('1. by @user_B ');
    expect(user).toContain('3. by @user_D ');
    expect(user).not.toContain('Author recidivism');
  });

  it('counts the same account with and without its @ as one repeat poster', async () => {
    mockCallAI.mockResolvedValueOnce(reply([1, 2, 3].map((i) => ({ index: i, technique: 'none', sentiment: 'neutral', severity: 0, reason: '' }))));
    const res = await scoreBatch(room('caption', [
      { author: '@Jo', text: 'first comment here' },
      { author: 'jo', text: 'second comment here' },
      { author: 'JO', text: 'third comment here' },
    ]));
    expect(res.environment.authorRecidivism).toBe(3);
    const [, user] = mockCallAI.mock.calls[0] as [string, string];
    expect(user).toContain('3. by @user_B ');
  });
});

describe('the room reading', () => {
  it('sends labels, passes the identifiers, and restores the summary before its 400-character cut', async () => {
    const summary = 'y'.repeat(396) + ' @user_B';
    mockCallAI.mockResolvedValueOnce(Ok(JSON.stringify({
      claim_vs_reaction: 'contradicts', comment_manipulation: 'pile-on', audience_distress: false, summary, topic_labels: ['other'],
    })));
    const res = await scoreRoom(room('caption', [{ author: 'jo', text: 'nope @creator' }]));
    const [, user, , opts] = mockCallAI.mock.calls[0] as [string, string, boolean, { knownIdentifiers?: string[] }];
    expect(user).toContain('- @user_B: "nope @user_A"');
    expect(user).not.toMatch(/creator|jo\b/);
    expect(opts.knownIdentifiers).toEqual(['@creator', '@jo']);
    expect(res?.summary).toHaveLength(400);
    expect(res?.summary.endsWith(' @jo')).toBe(true);
  });

  it('parseRoomAnalysis without a map reads the summary as before', () => {
    const r = parseRoomAnalysis(JSON.stringify({ summary: 'plain @user_B', claim_vs_reaction: 'no-claim' }));
    expect(r?.summary).toBe('plain @user_B');
    const map = buildNameLabelMapForEncounter(room('c', [{ author: 'jo', text: 't' }]));
    expect(parseRoomAnalysis(JSON.stringify({ summary: 'plain @user_B' }), map)?.summary).toBe('plain @jo');
  });
});

describe('words any text of the call wrote are left as written', () => {
  // @creator is @user_A, bob @user_B, jo @user_C, kim @user_D. Two comments write "USER A" and
  // "USER IS" in their own words; kim also names bob bare.
  const shouting = (): Encounter => room('caption', [
    { author: 'bob', text: 'first!' },
    { author: 'jo', text: 'IS THIS USER A BOT LMAO' },
    { author: 'kim', text: 'THIS USER IS A BOT, right bob' },
  ]);
  const summary = 'Commenters shout "IS THIS USER A BOT" at @user_B; @user_D adds "THIS USER IS A BOT".';
  const restored = 'Commenters shout "IS THIS USER A BOT" at @bob; @kim adds "THIS USER IS A BOT".';

  it("the batch summary keeps the commenters' words, and a name another comment wrote bare still comes back as @bob", async () => {
    mockCallAI.mockResolvedValueOnce(reply([1, 2, 3].map((i) => ({ index: i, technique: 'none', sentiment: 'neutral', severity: 0, reason: '' })), summary));
    const res = await scoreBatch(shouting());
    expect(res.environment.summary).toBe(restored);
  });

  it("the room summary keeps the commenters' words", async () => {
    mockCallAI.mockResolvedValueOnce(Ok(JSON.stringify({
      claim_vs_reaction: 'ignores', comment_manipulation: 'pile-on', audience_distress: false, summary, topic_labels: ['other'],
    })));
    const res = await scoreRoom(shouting());
    expect(res?.summary).toBe(restored);
  });

  it("a comment's reason quoting another comment keeps that comment's words, and its own name form", async () => {
    mockCallAI.mockResolvedValueOnce(reply([
      { index: 1, technique: 'none', sentiment: 'neutral', severity: 0, reason: '' },
      { index: 2, technique: 'none', sentiment: 'neutral', severity: 0, reason: '' },
      { index: 3, technique: 'none', sentiment: 'neutral', severity: 0, reason: 'Echoes "IS THIS USER A BOT" at @user_B' },
    ]));
    const res = await scoreBatch(shouting());
    expect(res.comments[2].reason).toBe('Echoes "IS THIS USER A BOT" at bob');
  });
});
