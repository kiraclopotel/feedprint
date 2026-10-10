// The parent's own word / phrase / account blocklist (laydown section 8d).
//
// This is the only rule surface in the product where the parent, not a model,
// decides. Its whole claim is "precise by construction", so the tests that
// matter are the over-blocking ones: a matcher that hides `dietary` because
// the parent typed `diet` has broken the claim, and a parent has no way to
// find out except by noticing posts going missing.
//
// The Romanian cases are not decoration. RO is a first-class language here,
// and a parent typing `slabit` on an ASCII keyboard must match `slăbit`.

import { describe, it, expect } from 'vitest';
import {
  readParentBlocklist,
  matchParentBlocklist,
  activeParentBlocklist,
  isParentBlocklistEmpty,
  EMPTY_PARENT_BLOCKLIST,
  type ParentBlocklistValue,
} from '../../../src/core/parent-blocklist';

const list = (v: Partial<ParentBlocklistValue>): ParentBlocklistValue => ({
  ...EMPTY_PARENT_BLOCKLIST,
  ...v,
});

describe('readParentBlocklist — normalization and defensive read', () => {
  it('returns the empty list for absent or wrong-shaped values', () => {
    expect(readParentBlocklist(undefined)).toEqual(EMPTY_PARENT_BLOCKLIST);
    expect(readParentBlocklist(null)).toEqual(EMPTY_PARENT_BLOCKLIST);
    expect(readParentBlocklist('diet')).toEqual(EMPTY_PARENT_BLOCKLIST);
    expect(readParentBlocklist({ words: 'diet' })).toEqual(EMPTY_PARENT_BLOCKLIST);
  });

  it('folds case, diacritics and stray punctuation into the stored form', () => {
    const read = readParentBlocklist({ words: ['  SlĂbit ', 'Ești!'], phrases: [], accounts: [] });
    expect(read.words).toEqual(['slabit', 'esti']);
  });

  it('drops empties and non-strings, and de-duplicates after folding', () => {
    const read = readParentBlocklist({
      words: ['diet', 'DIET', 'diét', '', '   ', '!!!', 42, null],
      phrases: [],
      accounts: [],
    });
    expect(read.words).toEqual(['diet']);
  });

  it('strips the @ from account rules so @kim and kim are one rule', () => {
    const read = readParentBlocklist({ words: [], phrases: [], accounts: ['@Kim', 'kim'] });
    expect(read.accounts).toEqual(['kim']);
  });

  it('isParentBlocklistEmpty tracks all three lists', () => {
    expect(isParentBlocklistEmpty(EMPTY_PARENT_BLOCKLIST)).toBe(true);
    expect(isParentBlocklistEmpty(list({ accounts: ['kim'] }))).toBe(false);
  });
});

describe('matchParentBlocklist — a word matches whole across case, punctuation and diacritics, and not inside dietary or class', () => {
  it('matches the word on its own', () => {
    expect(matchParentBlocklist(list({ words: ['diet'] }), 'my diet is going well'))
      .toEqual({ kind: 'word', rule: 'diet', scope: 'own' });
  });

  it('does NOT match inside a longer word', () => {
    for (const text of ['dietary advice', 'a dietician said', 'predieting']) {
      expect(matchParentBlocklist(list({ words: ['diet'] }), text)).toBeNull();
    }
  });

  it('does not turn a short rule into a censorship accident', () => {
    // The canonical example of why substring matching is wrong.
    expect(matchParentBlocklist(list({ words: ['ass'] }), 'back to class tomorrow')).toBeNull();
    expect(matchParentBlocklist(list({ words: ['ass'] }), 'do not be an ass'))
      .toEqual({ kind: 'word', rule: 'ass', scope: 'own' });
  });

  it('matches across punctuation, hashtags and casing', () => {
    expect(matchParentBlocklist(list({ words: ['skinnytok'] }), 'watch this #SkinnyTok !!'))
      .toEqual({ kind: 'word', rule: 'skinnytok', scope: 'own' });
  });

  it('matches Romanian text when the rule was typed without diacritics', () => {
    expect(matchParentBlocklist(list({ words: ['slabit'] }), 'am slăbit 10 kg'))
      .toEqual({ kind: 'word', rule: 'slabit', scope: 'own' });
  });

  it('matches when the rule carries diacritics and the text does not', () => {
    const read = readParentBlocklist({ words: ['slăbit'], phrases: [], accounts: [] });
    expect(matchParentBlocklist(read, 'am slabit mult')).toEqual({ kind: 'word', rule: 'slabit', scope: 'own' });
  });
});

describe('matchParentBlocklist — phrases are boundary-anchored', () => {
  it('matches a phrase inside a sentence', () => {
    expect(matchParentBlocklist(list({ phrases: ['body check'] }), 'daily body check time'))
      .toEqual({ kind: 'phrase', rule: 'body check', scope: 'own' });
  });

  it('matches across punctuation between the words', () => {
    expect(matchParentBlocklist(list({ phrases: ['body check'] }), 'body-check, again'))
      .toEqual({ kind: 'phrase', rule: 'body check', scope: 'own' });
  });

  it('does not match when either end runs into a longer word', () => {
    expect(matchParentBlocklist(list({ phrases: ['body check'] }), 'nobody checked')).toBeNull();
  });
});

describe('matchParentBlocklist — accounts match whole handles', () => {
  it('matches the handle with or without @ on either side', () => {
    const l = readParentBlocklist({ words: [], phrases: [], accounts: ['@kim'] });
    expect(matchParentBlocklist(l, 'anything', '@Kim')).toEqual({ kind: 'account', rule: 'kim', scope: 'own' });
    expect(matchParentBlocklist(l, 'anything', 'kim')).toEqual({ kind: 'account', rule: 'kim', scope: 'own' });
  });

  it('does NOT match a longer handle that starts the same', () => {
    const l = readParentBlocklist({ words: [], phrases: [], accounts: ['@kim'] });
    expect(matchParentBlocklist(l, 'anything', '@kimberly')).toBeNull();
  });

  it('is checked before the text rules', () => {
    const l = list({ words: ['diet'], accounts: ['kim'] });
    expect(matchParentBlocklist(l, 'my diet', 'kim')).toEqual({ kind: 'account', rule: 'kim', scope: 'own' });
  });

  it('ignores accounts when no author is supplied', () => {
    expect(matchParentBlocklist(list({ accounts: ['kim'] }), 'my diet')).toBeNull();
  });
});

describe('matchParentBlocklist — nothing fires on an empty list', () => {
  it('returns null for an empty list even on matching-looking text', () => {
    expect(matchParentBlocklist(EMPTY_PARENT_BLOCKLIST, 'diet body check', 'kim')).toBeNull();
  });

  it('returns null for empty text', () => {
    expect(matchParentBlocklist(list({ words: ['diet'] }), '')).toBeNull();
    expect(matchParentBlocklist(list({ words: ['diet'] }), '   !!!  ')).toBeNull();
  });
});

describe('activeParentBlocklist — reads the feature map', () => {
  const value = { words: ['diet'], phrases: [], accounts: [] };

  it('returns the list when the toggle is on', () => {
    const features = { 'parent-blocklist': { enabled: true, value } };
    expect(activeParentBlocklist(features).words).toEqual(['diet']);
  });

  it('returns the empty list when the toggle is off, even with rules stored', () => {
    const features = { 'parent-blocklist': { enabled: false, value } };
    expect(activeParentBlocklist(features)).toEqual(EMPTY_PARENT_BLOCKLIST);
  });

  it('returns the empty list when the feature entry is missing entirely', () => {
    expect(activeParentBlocklist({})).toEqual(EMPTY_PARENT_BLOCKLIST);
    expect(activeParentBlocklist(undefined)).toEqual(EMPTY_PARENT_BLOCKLIST);
    expect(activeParentBlocklist({ 'parent-blocklist': {} })).toEqual(EMPTY_PARENT_BLOCKLIST);
  });
});


describe('the card around the words (2026-09-07)', () => {
  it('a blocked account named by the card matches, after the author and before the words', () => {
    const l = list({ accounts: ['kim'], words: ['diet'] });
    expect(matchParentBlocklist(l, 'my diet', 'someone', { accounts: ['kim'] })).toEqual({ kind: 'account', rule: 'kim', scope: 'card' });
    expect(matchParentBlocklist(l, 'anything', '@kim', { accounts: ['other'] })).toEqual({ kind: 'account', rule: 'kim', scope: 'own' });
    expect(matchParentBlocklist(l, 'anything', 'someone', { accounts: ['kimberly'] })).toBeNull();
  });

  it('a blocked word in the quoted post or the card title matches with scope card; the own body wins when both hit', () => {
    const l = list({ words: ['ada'] });
    expect(matchParentBlocklist(l, 'cannot believe he predicted it', 'someone', { text: 'Ada Brightwell: the rate of improvement is impressive' }))
      .toEqual({ kind: 'word', rule: 'ada', scope: 'card' });
    expect(matchParentBlocklist(l, 'ada again', 'someone', { text: 'ada on the card too' }))
      .toEqual({ kind: 'word', rule: 'ada', scope: 'own' });
    expect(matchParentBlocklist(l, 'nothing here', 'someone', { text: 'nothing there either' })).toBeNull();
  });

  it('an empty card changes nothing', () => {
    const l = list({ words: ['diet'] });
    expect(matchParentBlocklist(l, 'clean text', 'someone', {})).toBeNull();
    expect(matchParentBlocklist(l, 'my diet', 'someone', {})).toEqual({ kind: 'word', rule: 'diet', scope: 'own' });
  });
});
