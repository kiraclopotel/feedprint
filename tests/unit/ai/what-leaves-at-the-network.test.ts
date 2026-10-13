/** @vitest-environment jsdom */
// What leaves for a comment reading, read at the one seam every AI call crosses: the request the
// client hands fetchWithDeadline. The builders, the scorer and the client all run for real; only
// that seam and the storage around the client are stubbed. Test names built into an Encounter go
// through scoreBatch and scoreRoom, and none of them may appear in any request body.
//
// The Adult post judges and the comment fallback rewrite are not on this list: the first never
// carried an author, and the second still sends the comment as written until the pattern step.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { installChromeStorageStub } from '../../helpers/chrome-storage';
import { readingConsentFor } from '../../helpers/reading-consent';
import { utcDayKey, utcMonthKey, CURRENT_SETTINGS_SCHEMA_VERSION } from '../../../src/storage/settings';
import type { Encounter, PostNode, CommentNode } from '../../../src/types/post';

const sent: Array<{ url: string; init: RequestInit }> = [];
let reply = '';
vi.mock('../../../src/ai/fetch-with-deadline', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/ai/fetch-with-deadline')>();
  return {
    ...actual,
    fetchWithDeadline: vi.fn(async (url: string, init: RequestInit) => {
      sent.push({ url, init });
      const body = {
        choices: [{ message: { content: reply }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      };
      const res = { ok: true, status: 200, headers: { get: () => null }, json: async () => body, clone: () => res };
      return res as unknown as Response;
    }),
  };
});

import { scoreBatch, scoreRoom, __resetBatchCacheForTests } from '../../../src/analysis/comment-batch-scorer';
import { _resetForTests as resetFlushBudget } from '../../../src/ai/global-flush-budget';

const NAMES = ['the_post_author', 'the_ancestor', 'the_focused', 'the_commenter', 'the_second_commenter', 'Shown Name'];

function postNode(): PostNode {
  return {
    id: 'p1', kind: 'post', text: 'the post being read, by @the_post_author',
    author: { handle: 'the_post_author', display_name: 'Shown Name', verified: false, is_creator: false }, metrics: {},
  };
}

function commentNode(handle: string, text: string, depth: 1 | 2 | 3 = 1, parent = 'p1'): CommentNode {
  return {
    id: `c-${handle}`, kind: depth === 1 ? 'top-comment' : depth === 2 ? 'reply' : 'reply-to-reply', depth, parent_id: parent, text,
    author: { handle, verified: true, is_pinned_by_creator: false, is_creator_hearted: false },
    metrics: { likes: 4321, reply_count: 77 }, render_state: 'visible-now', fw_marker_present: false,
  };
}

/** An X permalink: post, one ancestor, the focused reply, and two replies below it. */
function encounter(): Encounter {
  const post = postNode();
  const ancestor = commentNode('the_ancestor', 'the thread above, mentioning @the_post_author');
  const focused = commentNode('the_focused', 'the reply being replied to', 2, ancestor.id);
  return {
    platform: 'twitter', surface: { kind: 'twitter-permalink', conversation_id: 'p1' },
    observation_iso: '2026-09-24T00:00:00.000Z', encounter_id: 'enc-network', post, ancestors: [ancestor], focused,
    children: [
      commentNode('the_commenter', 'the comment being read, @the_focused and Shown Name are wrong', 3, focused.id),
      commentNode('the_second_commenter', 'the_commenter has a point', 3, focused.id),
    ],
    output_language: 'English',
  };
}

function bodyText(i: number): string {
  const parsed = JSON.parse(String(sent[i].init.body)) as { messages: Array<{ content: string }> };
  return parsed.messages.map((m) => m.content).join('\n');
}

beforeEach(() => {
  sent.length = 0;
  resetFlushBudget();
  __resetBatchCacheForTests();
  installChromeStorageStub({
    initial: {
      settingsSchemaVersion: CURRENT_SETTINGS_SCHEMA_VERSION,
      lastResetDate: utcDayKey(),
      lastResetMonth: utcMonthKey(),
      // A synthetic key in the fw-<tier>-<secret> shape, so the client's tier gate lets the call through.
      fw_license_key: 'fw-starter-abc12345',
      dailyCap: 2500, totalChecksToday: 0, totalTokensThisMonth: 0,
      ...readingConsentFor('fw-starter-abc12345'),
    },
    sendMessage: () => undefined,
  });
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'debug').mockImplementation(() => undefined);
});

describe('what leaves the computer for a comment reading', () => {
  it('the batch request carries the wording, the counts and the flags, and no test name', async () => {
    reply = JSON.stringify({
      comments: [{ index: 1, technique: 'none', sentiment: 'neutral', severity: 0, reason: '' }],
      environment: { label: 'healthy-discussion', summary: 'x' },
    });
    await scoreBatch(encounter(), 'teen');
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe('https://api.feelingwise.org/v1/chat/completions');
    const body = bodyText(0);
    expect(body).toContain('the comment being read');
    expect(body).toContain('the thread above');
    expect(body).toMatch(/4321/);
    expect(body).toContain('VERIFIED');
    for (const name of NAMES) expect(body, name).not.toContain(name);
    expect(body).toContain('Post by: @user_A');
    expect(body).toContain('by @user_B ');
    expect(body).toContain('1. by @user_D ');
    // And no page address goes with it: the policy is set on the request itself.
    expect(sent[0].init.referrerPolicy).toBe('no-referrer');
    expect(Object.keys(sent[0].init).sort()).toEqual(['body', 'headers', 'method', 'referrerPolicy']);
  });

  it('the room request carries no test name either', async () => {
    reply = JSON.stringify({
      claim_vs_reaction: 'no-claim', comment_manipulation: 'none', audience_distress: false, summary: 'x', topic_labels: ['other'],
    });
    await scoreRoom(encounter(), 'teen');
    expect(sent).toHaveLength(1);
    const body = bodyText(0);
    expect(body).toContain('the comment being read');
    for (const name of NAMES) expect(body, name).not.toContain(name);
  });
});
