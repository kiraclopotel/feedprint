import { describe, it, expect } from 'vitest';
import {
  matchesTypeFilter, parseSerialQuery, isAdRecord,
} from '../../../../../src/ui/dashboard/components/feed-filters';
import type { ForensicRecord } from '../../../../../src/types/forensic';

function rec(over: Partial<ForensicRecord>): ForensicRecord {
  return {
    id: 'r', timestamp: '2026-06-14T00:00:00.000Z', platform: 'tiktok',
    originalText: '', originalHash: 'h', originalLength: 0, neutralizedText: '',
    author: 'a', postUrl: '', techniques: [], overallScore: 0,
    userAgeCategory: 'teen', aiSource: 'cloud', feedSource: 'foryou', integrityHash: 'ih',
    ...over,
  } as ForensicRecord;
}

describe('matchesTypeFilter', () => {
  it('posts → only kind post', () => {
    expect(matchesTypeFilter(rec({ kind: 'post' }), 'posts')).toBe(true);
    expect(matchesTypeFilter(rec({ kind: 'video' }), 'posts')).toBe(false);
    expect(matchesTypeFilter(rec({ kind: 'comment' }), 'posts')).toBe(false);
  });

  it('video → only kind video', () => {
    expect(matchesTypeFilter(rec({ kind: 'video' }), 'video')).toBe(true);
    expect(matchesTypeFilter(rec({ kind: 'post' }), 'video')).toBe(false);
  });

  it('hidden → blocked or flagged-hidden (content hidden from the child)', () => {
    expect(matchesTypeFilter(rec({ verdict: 'blocked' }), 'hidden')).toBe(true);
    expect(matchesTypeFilter(rec({ verdict: 'flagged-hidden' }), 'hidden')).toBe(true);
    expect(matchesTypeFilter(rec({ verdict: 'flagged' }), 'hidden')).toBe(false);
    expect(matchesTypeFilter(rec({ verdict: 'pass' }), 'hidden')).toBe(false);
  });

  it('ai → cloud-classifier flag only (not the deterministic rules path)', () => {
    expect(matchesTypeFilter(rec({ aiSource: 'cloud', verdict: 'flagged' }), 'ai')).toBe(true);
    expect(matchesTypeFilter(rec({ aiSource: 'cloud', verdict: 'flagged-hidden' }), 'ai')).toBe(true);
    expect(matchesTypeFilter(rec({ aiSource: 'rules', verdict: 'flagged' }), 'ai')).toBe(false);
    expect(matchesTypeFilter(rec({ aiSource: 'cloud', verdict: 'pass' }), 'ai')).toBe(false);
  });

  it('passed → verdict pass', () => {
    expect(matchesTypeFilter(rec({ verdict: 'pass' }), 'passed')).toBe(true);
    expect(matchesTypeFilter(rec({ verdict: 'flagged' }), 'passed')).toBe(false);
  });

  it('ads → sponsored-ad records only', () => {
    expect(matchesTypeFilter(rec({ detectionMode: 'sponsored-ad' }), 'ads')).toBe(true);
    expect(matchesTypeFilter(rec({ detectionMode: 'block:ai-content' }), 'ads')).toBe(false);
    expect(matchesTypeFilter(rec({}), 'ads')).toBe(false);
  });

  it('comments → kind comment; replies → kind reply / reply-to-reply', () => {
    expect(matchesTypeFilter(rec({ kind: 'comment' }), 'comments')).toBe(true);
    expect(matchesTypeFilter(rec({ kind: 'reply' }), 'comments')).toBe(false);
    expect(matchesTypeFilter(rec({ kind: 'reply' }), 'replies')).toBe(true);
    expect(matchesTypeFilter(rec({ kind: 'reply-to-reply' }), 'replies')).toBe(true);
    expect(matchesTypeFilter(rec({ kind: 'comment' }), 'replies')).toBe(false);
  });

  it('repeat-offenders is resolved against the author set in the component (true here)', () => {
    expect(matchesTypeFilter(rec({}), 'repeat-offenders')).toBe(true);
  });

  it('all and the verdict-set filters return true (resolved against precomputed sets)', () => {
    expect(matchesTypeFilter(rec({}), 'all')).toBe(true);
    expect(matchesTypeFilter(rec({}), 'flagged')).toBe(true);
    expect(matchesTypeFilter(rec({}), 'blocked')).toBe(true);
  });
});

describe('isAdRecord', () => {
  it('is true only for sponsored-ad detectionMode', () => {
    expect(isAdRecord(rec({ detectionMode: 'sponsored-ad' }))).toBe(true);
    expect(isAdRecord(rec({ detectionMode: 'sponsored-ad:x' }))).toBe(true);
    expect(isAdRecord(rec({ detectionMode: 'block:ai-content:tok' }))).toBe(false);
    expect(isAdRecord(rec({}))).toBe(false);
  });

  // E1: adult Block Ads events are BLOCKED_LOG records ('block:ads:<token>');
  // the parent's Ads filter must surface them alongside child/teen ad records.
  it('includes adult block:ads category events', () => {
    expect(isAdRecord(rec({ detectionMode: 'block:ads:platform-ad-marker' }))).toBe(true);
    expect(matchesTypeFilter(rec({ detectionMode: 'block:ads:platform-ad-marker' }), 'ads')).toBe(true);
  });
});

describe('parseSerialQuery', () => {
  it('parses a bare #NNN serial', () => {
    expect(parseSerialQuery('#978')).toBe(978);
    expect(parseSerialQuery('  #1041 ')).toBe(1041);
  });

  it('returns null for anything that is not a bare serial (falls back to text search)', () => {
    expect(parseSerialQuery('978')).toBeNull();
    expect(parseSerialQuery('#abc')).toBeNull();
    expect(parseSerialQuery('#12a')).toBeNull();
    expect(parseSerialQuery('swearing')).toBeNull();
    expect(parseSerialQuery('')).toBeNull();
  });
});
