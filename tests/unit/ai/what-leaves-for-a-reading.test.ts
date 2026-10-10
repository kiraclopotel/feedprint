// What actually leaves the computer when the AI reading is on.
//
// Opened 2026-09-20. The English store description said "only the text being read leaves your
// computer, for that reading", and it was false: the prompt carries the handle that wrote each
// comment and the counts beside it. The Spanish, Portuguese and Romanian blocks said it correctly
// the whole time, so the English had been shortened into an untruth after 2.5.10 and nothing in
// 8,491 tests knew. It was found by hand, while rewriting the listing, which is the wrong way to
// find it.
//
// This test is the other half of the guard. The banned-phrase list in
// tests/private/docs/public-copy-claims.test.ts stops any page saying "only the text": that half
// decides what may be written. This half decides what is true, by building a real prompt through
// the live path and reading what is in it. The two have to be changed together, on purpose.
//
// The handle stopped going with the letters-for-names change: the prompt now carries a label such
// as @user_B in its place, the same label for the same account throughout one call, and the real
// name stays in the browser. The counts, the flags and the wording still go, and so do names
// written inside the text, so the banned phrases stay banned: "only the text" is as untrue after
// as before. The pages say what goes, with the label in place of the name.
//
// A test that asserts a privacy-relevant fact is worth more than one that asserts a nice one: if
// somebody makes the handle come back by accident, they will find out here rather than from a
// reader.

import { describe, it, expect } from 'vitest';

import { buildBatchPromptV3 } from '../../../src/ai/prompts-v2';
import type { Encounter, PostNode, CommentNode } from '../../../src/types/post';

function postNode(overrides: Partial<PostNode> = {}): PostNode {
  return {
    id: 'p1',
    kind: 'post',
    text: 'the post being read',
    author: { handle: 'the_post_author', verified: false, is_creator: false },
    metrics: {},
    ...overrides,
  };
}

function commentNode(overrides: Partial<CommentNode> = {}): CommentNode {
  return {
    id: 'c1',
    kind: 'top-comment',
    depth: 1,
    parent_id: 'p1',
    text: 'the comment being read',
    author: {
      handle: 'the_commenter',
      verified: true,
      is_pinned_by_creator: false,
      is_creator_hearted: false,
    },
    // `likes`, not `like_count`: the prompt reads src/types/post.ts's own field name, and a wrong
    // guess here printed 0 and passed the eye. Read the type, never the name that sounds right.
    metrics: { likes: 4321, reply_count: 77 },
    render_state: 'visible-now',
    fw_marker_present: false,
    ...overrides,
  };
}

function encounter(): Encounter {
  const post = postNode();
  return {
    platform: 'twitter',
    surface: { kind: 'twitter-home-feed' },
    observation_iso: '2026-09-20T00:00:00.000Z',
    encounter_id: 'enc-what-leaves',
    post,
    ancestors: [],
    focused: post,
    children: [commentNode()],
  };
}

describe('what leaves the computer for an AI reading', () => {
  it('sends the wording, which is the part every page has always said', () => {
    const { user } = buildBatchPromptV3(encounter());
    expect(user).toContain('the comment being read');
  });

  it('the handle does not leave; a label stands for it', () => {
    const { user } = buildBatchPromptV3(encounter());
    expect(user).not.toContain('the_commenter');
    expect(user).not.toContain('the_post_author');
    // The post's author is always the first label; the one commenter is the second.
    expect(user).toContain('Post by: @user_A');
    expect(user).toMatch(/^1\. by @user_B /m);
  });

  it('sends the counts beside the comment', () => {
    const { user } = buildBatchPromptV3(encounter());
    // The batch line is `L<depth-1> <role> by @user_<letters> (<age>, <likes>, <replies>): "<text>"`.
    // Reading the numbers rather than the punctuation keeps this from failing on a format change
    // that does not change what a reader's data does.
    expect(user).toMatch(/4[.,]?321|4321/);
    expect(user).toContain('77');
  });

  it('marks a verified author, which is a fact about the person and not about the wording', () => {
    const { user } = buildBatchPromptV3(encounter());
    expect(user).toContain('VERIFIED');
  });
});
