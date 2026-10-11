// A name that is only MENTIONED in a text gets a letter like the ones who speak (11 Oct 2026, the Tester's full test).
//
// The consent screen says "a label such as @user_A in place of each account name". The map was built from the people who
// speak in a call (the author, the thread, the commenters), so the very account an attack is aimed at, written as @name
// inside the post or the comment above it, went out as written. Now every @handle in the texts a call sends gets a token
// of its own. No AI call here; the rewrite checks are not touched.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildNameLabelMapForEncounter,
  buildNameLabelMapForPost,
  replaceNamesInText,
  restoreNames,
  resetNameLabelCountsForTests,
} from '../../../src/core/name-labels';
import type { Encounter, PostNode, CommentNode } from '../../../src/types/post';

function post(handle: string, text: string): PostNode {
  return { id: 'p1', kind: 'post', text, metrics: {}, author: { handle, verified: false, is_creator: false } };
}

function comment(handle: string, text: string): CommentNode {
  return {
    id: `c-${handle}`, kind: 'top-comment', depth: 1, parent_id: 'p1', text, metrics: {},
    author: { handle, verified: false, is_pinned_by_creator: false, is_creator_hearted: false },
    render_state: 'visible-now', fw_marker_present: false,
  };
}

function encounter(p: PostNode, children: CommentNode[], ancestors: CommentNode[] = []): Encounter {
  return {
    platform: 'twitter', surface: { kind: 'twitter-home-feed' }, observation_iso: '2026-10-11T00:00:00.000Z',
    encounter_id: 'enc', post: p, ancestors, focused: p, children,
  };
}

beforeEach(() => resetNameLabelCountsForTests());

describe('the post path: a name written inside the texts gets a token', () => {
  const attack = '@anyhandle you are a pathetic little nobody and everyone here knows it';

  it('a mentioned account is replaced by a letter, in the post and in the post it answers', () => {
    const m = buildNameLabelMapForPost('@poster', undefined, [attack, 'what @anyhandle said above was fine']);
    expect(m.entries.map((e) => e.handle)).toEqual(['poster', 'anyhandle']);
    expect(replaceNamesInText(m, attack)).toBe('@user_B you are a pathetic little nobody and everyone here knows it');
    expect(replaceNamesInText(m, 'what @anyhandle said above was fine')).toBe('what @user_B said above was fine');
  });

  it('the same handle written twice, in other letter cases, is one person', () => {
    const m = buildNameLabelMapForPost('@poster', undefined, ['@AnyHandle hello', 'and @anyhandle again']);
    expect(m.entries).toHaveLength(2);
  });

  it("a mention of the author keeps the author's token", () => {
    const m = buildNameLabelMapForPost('@poster', undefined, ['thanks @poster, and @anyhandle']);
    expect(m.entries.map((e) => [e.token, e.handle])).toEqual([['@user_A', 'poster'], ['@user_B', 'anyhandle']]);
  });

  it('the tail of an address is not a name, and a label that is already there names nobody', () => {
    const m = buildNameLabelMapForPost('@poster', undefined, ['write to me at ann@example.com, or ask @user_A, or @_x', 'a lone @ and an @']);
    expect(m.entries.map((e) => e.handle)).toEqual(['poster', '_x']);
    expect(replaceNamesInText(m, 'ann@example.com')).toBe('ann@example.com');
  });

  it("a mention inside the caption context is found; the speaker's own head is not read as a mention", () => {
    const context = '• @Jess Smith: agreed with @viewer_two\n• @viewer_two: @anyhandle is lying';
    const m = buildNameLabelMapForPost('@poster', context);
    expect(m.entries.map((e) => e.handle)).toEqual(['poster', 'Jess Smith', 'viewer_two', 'anyhandle']);
  });

  it('a rewrite that keeps the mentioned account gets the real handle back, not a letter', () => {
    const m = buildNameLabelMapForPost('@poster', undefined, [attack]);
    const restored = restoreNames(m, 'I disagree with @user_B, and I would like to talk about it.', 'rewrite', attack);
    expect(restored.text).toBe('I disagree with @anyhandle, and I would like to talk about it.');
  });
});

describe('the comment path: a name written inside a comment gets a token', () => {
  it('a commenter who is not in the thread, named by another, is labelled', () => {
    const m = buildNameLabelMapForEncounter(encounter(
      post('creator', 'the video'),
      [comment('first', '@anyhandle is a clown'), comment('second', 'agree with @first')],
    ));
    expect(m.entries.map((e) => [e.token, e.handle])).toEqual([
      ['@user_A', 'creator'], ['@user_B', 'first'], ['@user_C', 'second'], ['@user_D', 'anyhandle'],
    ]);
    expect(replaceNamesInText(m, '@anyhandle is a clown')).toBe('@user_D is a clown');
    expect(replaceNamesInText(m, 'agree with @first')).toBe('agree with @user_B');
  });

  it('a comment without text (an older node shape) adds nothing', () => {
    const p = post('creator', 'x');
    const m = buildNameLabelMapForEncounter(encounter(p, [{ ...comment('first', ''), text: undefined as unknown as string }]));
    expect(m.entries.map((e) => e.handle)).toEqual(['creator', 'first']);
  });
});
