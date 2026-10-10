// Taxonomy axis A (PLAN-2026-09-14 item 8): what the item is, from its own
// fields. Two-sided: each value is reached by its record and not by its
// neighbours.

import { describe, expect, it } from 'vitest';
import type { ForensicRecord } from '../../../src/types/forensic';
import { itemAxis } from '../../../src/forensics/item-axis';

let n = 0;
function rec(over: Partial<ForensicRecord> = {}): ForensicRecord {
  n++;
  return {
    id: `fr-${n}`, timestamp: '2026-09-10T10:00:00.000Z', platform: 'twitter',
    originalText: 'text', originalHash: `h-${n}`, originalLength: 4, neutralizedText: '',
    author: '@a', postUrl: '', techniques: [], overallScore: 0, userAgeCategory: 'teen',
    aiSource: 'cloud', feedSource: 'for-you', integrityHash: 'ih', signature: 's',
    publicKeyFingerprint: 'fp', chainPosition: n, verdict: 'pass', kind: 'post', ...over,
  } as ForensicRecord;
}

describe('item axis', () => {
  it('an ad is an ad whatever else it carries', () => {
    expect(itemAxis(rec({ verdict: 'flagged', aiSource: 'rules', detectionMode: 'sponsored-ad',
      techniques: [{ name: 'fear-appeal', severity: 8, confidence: 1 }] }))).toBe('ad');
    expect(itemAxis(rec({ verdict: 'blocked', detectionMode: 'block:ads:platform-ad-marker' }))).toBe('ad');
    expect(itemAxis(rec({ kind: 'comment', accountType: 'advertiser' }))).toBe('ad');
  });

  it('the platform AI label is a badge, before the rule that hid it', () => {
    expect(itemAxis(rec({ verdict: 'blocked', aiSource: 'rules', detectionMode: 'block:ai-label:en',
      techniques: [{ name: 'ai-content-block', severity: 10, confidence: 1 }] }))).toBe('badge');
  });

  it('the user\'s own rules are rule hits; a product gate is not', () => {
    expect(itemAxis(rec({ verdict: 'flagged', aiSource: 'rules', detectionMode: 'blocklist:word:elon' }))).toBe('rule-hit');
    expect(itemAxis(rec({ verdict: 'blocked', detectionMode: 'block:hashtag:x' }))).toBe('rule-hit');
    expect(itemAxis(rec({ verdict: 'blocked', detectionMode: 'blocklist:account:kim' }))).toBe('rule-hit');
    expect(itemAxis(rec({ overrideOrigin: 'identity-slur', verdict: 'flagged' }))).toBe('post');
    expect(itemAxis(rec({ verdict: 'flagged', detectionMode: 'combined-detect-neutralize' }))).toBe('post');
  });

  it('otherwise the node kind decides', () => {
    expect(itemAxis(rec({ kind: 'post' }))).toBe('post');
    expect(itemAxis(rec({ kind: 'video' }))).toBe('post');
    expect(itemAxis(rec({ kind: undefined }))).toBe('post');
    expect(itemAxis(rec({ kind: 'comment' }))).toBe('comment');
    expect(itemAxis(rec({ kind: 'top-comment' }))).toBe('comment');
    expect(itemAxis(rec({ kind: 'reply' }))).toBe('reply');
    expect(itemAxis(rec({ kind: 'reply-to-reply' }))).toBe('reply');
  });

  it('structural records have no item axis', () => {
    for (const kind of ['environment', 'image', 'reset-marker', 'gap-marker'] as const) {
      expect(itemAxis(rec({ kind })), kind).toBeNull();
    }
  });
});
