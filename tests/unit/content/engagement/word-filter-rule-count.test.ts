// @vitest-environment jsdom
//
// The per-rule count (owner 2026-09-03, idea 3): when one of the user's rules
// hides a post, the rule itself is tallied under `rule:<kind>:<rule>` beside
// the switch's line, and the slur tier tallies no rule.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const counted: Array<{ n: number; byFeature: Record<string, number> }> = [];
vi.mock('../../../../src/storage/settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/storage/settings')>();
  return {
    ...actual,
    incrementMetricsHidden: vi.fn(async (n: number, byFeature: Record<string, number>) => { counted.push({ n, byFeature }); }),
  };
});

import { decideHideRule, startWordFilter, wordFilterPolicy } from '../../../../src/content/engagement/word-filter';
import { ruleTallyKey } from '../../../../src/core/parent-blocklist';
import { __flushHiddenCountForTest } from '../../../../src/content/engagement/mark-hidden';
import { adultPreset } from '../../../../src/storage/presets';
import type { FWSettings } from '../../../../src/storage/settings';

function settings(words: string[], accounts: string[] = []): FWSettings {
  const features = adultPreset();
  features['parent-blocklist'] = { enabled: true, value: { words, phrases: ['flat earth'], accounts } };
  return { mode: 'adult', strictLanguage: false, features } as unknown as FWSettings;
}

function tweet(text: string, handle: string): void {
  const article = document.createElement('article');
  article.setAttribute('data-testid', 'tweet');
  article.innerHTML = `<div data-testid="User-Name"><a href="/${handle}">${handle}</a></div><div data-testid="tweetText" lang="en">${text}</div>`;
  document.body.appendChild(article);
}

beforeEach(() => { document.body.innerHTML = ''; __flushHiddenCountForTest(); counted.length = 0; });
afterEach(() => { __flushHiddenCountForTest(); });

describe('decideHideRule', () => {
  it('names the rule that fired, normalized, and no rule for the slur tier', () => {
    const policy = wordFilterPolicy(settings(['Diet'], ['Troll']));
    expect(decideHideRule('a kind message', 'troll', policy)).toEqual({ reason: 'account', rule: 'troll' });
    expect(decideHideRule('my diet starts tomorrow', undefined, policy)).toEqual({ reason: 'word', rule: 'diet' });
    expect(decideHideRule('the flat earth society', undefined, policy)).toEqual({ reason: 'phrase', rule: 'flat earth' });
    expect(decideHideRule('nothing here', undefined, policy)).toBeNull();
  });
});

describe('the tally', () => {
  it('counts each rule that hid something under its own key, beside the word-filter line', () => {
    tweet('my diet starts tomorrow', 'someone');
    tweet('another diet post', 'other');
    tweet('hello', 'troll');
    const stop = startWordFilter('twitter', settings(['diet'], ['troll']));
    __flushHiddenCountForTest();
    stop();
    const by = counted.at(-1)!.byFeature;
    expect(by['word-filter']).toBe(3);
    expect(by[ruleTallyKey('word', 'diet')]).toBe(2);
    expect(by[ruleTallyKey('account', 'troll')]).toBe(1);
    expect(Object.keys(by).filter(k => k.startsWith('rule:'))).toHaveLength(2);
  });
});
