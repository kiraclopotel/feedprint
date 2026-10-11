// The comment batch lines printed a count the page never showed as "0♥, 0↪", which on every YouTube comment told the
// model nobody had liked or answered it. A count now appears only when it was read. And a reply was shown without the
// comment it answers, so "exactly, they should" was read alone; when that comment is in the batch, the reply's line
// now carries its number and first 200 characters.

import { describe, expect, it } from 'vitest';
import { buildBatchPromptV3 } from '../../../src/ai/prompts-v2';
import type { CommentNode, Encounter, PostNode } from '../../../src/types/post';

const post: PostNode = {
  id: 'p1', kind: 'post', text: 'A post about the new school rules', metrics: {},
  author: { handle: 'creator', verified: false, is_creator: false },
};

function comment(overrides: Partial<CommentNode>): CommentNode {
  return {
    id: 'c1', kind: 'top-comment', depth: 1, parent_id: 'p1', text: 'a comment',
    author: { handle: 'commenter', verified: false, is_pinned_by_creator: false, is_creator_hearted: false },
    metrics: {}, render_state: 'visible-now', fw_marker_present: false,
    ...overrides,
  };
}

const userPrompt = (children: CommentNode[]): string => buildBatchPromptV3({
  platform: 'twitter', surface: { kind: 'twitter-home-feed' }, observation_iso: '2026-10-10T20:00:00.000Z',
  encounter_id: 'enc', post, ancestors: [], focused: post, children,
} as Encounter).user;

const lineOf = (user: string, n: number): string => user.split('\n').find((l) => l.startsWith(`${n}. by `)) ?? '';

describe('the batch lines say only what was seen', () => {
  it('a comment whose counts were not read shows no likes and no replies', () => {
    const line = lineOf(userPrompt([comment({ age_relative: '3h', text: 'not sure about this' })]), 1);
    expect(line).toMatch(/\(3h, depth=1\): "not sure about this"$/);
    expect(line).not.toMatch(/♥|↪/);
  });

  it('a comment with counts read still shows them, a zero included', () => {
    const line = lineOf(userPrompt([comment({ metrics: { likes: 0, reply_count: 4 } })]), 1);
    expect(line).toContain('(0♥, 4↪, depth=1)');
  });

  it('a reply carries the first 200 characters of the comment it answers, when that comment is in the batch', () => {
    const long = `They should all be expelled, every one of them. ${'x'.repeat(300)}`;
    const user = userPrompt([
      comment({ id: 'c1', text: long }),
      comment({ id: 'c2', kind: 'reply', depth: 2, parent_id: 'c1', text: 'exactly, they should' }),
    ]);
    const reply = lineOf(user, 2);
    expect(reply).toContain(`[REPLY TO 1: "${long.slice(0, 200)}"]`);
    expect(reply).not.toContain(long.slice(0, 201));
    expect(reply).toMatch(/: "exactly, they should"$/);
  });

  it('a reply whose comment is not in the batch, and a top comment, carry no reply mark', () => {
    const user = userPrompt([
      comment({ id: 'c1', text: 'first' }),
      comment({ id: 'c3', kind: 'reply', depth: 2, parent_id: 'gone', text: 'second' }),
    ]);
    expect(user).not.toContain('REPLY TO');
  });
});
