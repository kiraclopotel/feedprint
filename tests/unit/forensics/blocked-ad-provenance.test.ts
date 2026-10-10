// A blocked ad is still an impression, and must carry the same provenance the
// record beside it carries.
//
// The sponsored-ad path in content/index.ts holds a full PostContent and, in
// the same function, the FORENSIC_LOG call passes accountType, sourceContainer,
// observedSequence, viewportSeenAt, surfaceSessionId and metrics while the
// BLOCKED_LOG call passed none of them. Measured on the 2026-08-22
// 5,365-record export: 3,288 of 3,288 passed posts carried the impression
// fields, and 0 of 64 blocked ads did.
//
// Two things broke as a result:
//   1. The export reconstructs replay order from surfaceSessionId +
//      observedSequence + viewportSeenAt and falls back to chain position.
//      Chain order is COMPLETION order, so those 64 ads were the only records
//      in the file placed by when their write finished rather than when they
//      were seen — the exact failure the export's replay-order design exists
//      to avoid.
//   2. The behavior section's advertiser label and advertiser-placement counts
//      read accountType, so a blocked ad could never be counted as one.
//
// These are optional fields: the DOM-side blockers (reels, media-timeout,
// ai-content-blocker, media-only-ad) fire with no post in hand and must keep
// writing byte-identical payloads.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { computeRecordIntegrityHash } from '../../../src/forensics/canonical-payload';
import type { ForensicRecord } from '../../../src/types/forensic';

type Payload = Omit<ForensicRecord, 'integrityHash' | 'signature' | 'chainAnchor'>;

function blockedBase(extra: Partial<ForensicRecord> = {}): Payload {
  return {
    id: 'fr-blk-1',
    timestamp: '2026-08-22T10:00:00Z',
    platform: 'twitter',
    originalText: 'buy this',
    originalHash: 'h',
    originalLength: 8,
    neutralizedText: '',
    author: 'ExampleSat',
    postUrl: 'https://x.com/ExampleSat/status/1',
    techniques: [{ name: 'ai-content-block', severity: 10, confidence: 1 }],
    overallScore: 10,
    userAgeCategory: 'adult',
    aiSource: 'local',
    feedSource: 'for-you',
    detectionMode: 'block:ads:platform-ad-marker',
    prevRecordHash: 'prev',
    chainPosition: 12,
    verdict: 'blocked',
    kind: 'video',
    ...extra,
  } as Payload;
}

describe('blocked-ad provenance — additive, and inside the signature', () => {
  it('leaves DOM-side blocker payloads byte-identical (no post, no fields)', async () => {
    const before = await computeRecordIntegrityHash(blockedBase());
    const after = await computeRecordIntegrityHash(blockedBase({
      accountType: undefined,
      sourceContainer: undefined,
      observedSequence: undefined,
      viewportSeenAt: undefined,
      surfaceSessionId: undefined,
      metrics: undefined,
    }));
    expect(after).toBe(before);
  });

  it('covers the impression order by the hash once it is present', async () => {
    const seenFirst = await computeRecordIntegrityHash(blockedBase({
      surfaceSessionId: 'sess-1', observedSequence: 3,
    }));
    const seenLater = await computeRecordIntegrityHash(blockedBase({
      surfaceSessionId: 'sess-1', observedSequence: 40,
    }));
    // Repainting where an ad appeared in the scroll must break the hash.
    expect(seenLater).not.toBe(seenFirst);
  });

  it('covers the advertiser label by the hash', async () => {
    const asAd = await computeRecordIntegrityHash(blockedBase({ accountType: 'advertiser' }));
    const asPerson = await computeRecordIntegrityHash(blockedBase({ accountType: 'person' }));
    expect(asPerson).not.toBe(asAd);
  });
});

describe('logBlockedEvent — carries the provenance the caller proved', () => {
  beforeEach(() => vi.resetModules());

  it('stamps every optional field onto the record it writes', async () => {
    const added: Array<Record<string, unknown>> = [];
    vi.doMock('../../../src/forensics/store', () => ({
      addRecord: (r: Record<string, unknown>) => { added.push(r); return Promise.resolve(); },
      getChainState: () => Promise.resolve({ prevRecordHash: 'prev', nextPosition: 5 }),
    }));
    vi.doMock('../../../src/forensics/signing', () => ({
      getPublicKeyFingerprint: () => Promise.resolve('fp'),
      signHash: () => Promise.resolve('sig'),
    }));

    const { logBlockedEvent } = await import('../../../src/forensics/logger');
    await logBlockedEvent({
      platform: 'twitter',
      mode: 'adult',
      author: 'ExampleSat',
      postUrl: 'https://x.com/ExampleSat/status/1',
      blockReason: 'ads',
      matchedToken: 'platform-ad-marker',
      caption: 'buy this',
      feedSource: 'for-you',
      accountType: 'advertiser',
      sourceContainer: 'Some Group',
      observedSequence: 17,
      viewportSeenAt: '2026-08-22T09:59:00Z',
      surfaceSessionId: 'sess-1',
      metrics: { likes: 4 },
      kind: 'post',
    });

    expect(added).toHaveLength(1);
    // M114: the caller that holds the post names its kind; a blocked text ad is a post.
    expect(added[0].kind).toBe('post');
    expect(added[0]).toMatchObject({
      verdict: 'blocked',
      accountType: 'advertiser',
      sourceContainer: 'Some Group',
      observedSequence: 17,
      viewportSeenAt: '2026-08-22T09:59:00Z',
      surfaceSessionId: 'sess-1',
      metrics: { likes: 4 },
    });
  });

  it('carries configSnapshot onto the record it writes (record-completeness M122)', async () => {
    // logBlockedEvent hard-coded `configSnapshot: undefined` unconditionally
    // until 2026-08-24 (known-issues M122), regardless of what the caller
    // could supply. This exercises logBlockedEvent directly (not just the
    // ai-content-blocker.ts caller) so a regression at the root-cause line
    // (logger.ts, the `configSnapshot: input.configSnapshot` write) fails
    // here even if the caller-side test is skipped or the caller changes.
    const added: Array<Record<string, unknown>> = [];
    vi.doMock('../../../src/forensics/store', () => ({
      addRecord: (r: Record<string, unknown>) => { added.push(r); return Promise.resolve(); },
      getChainState: () => Promise.resolve({ prevRecordHash: 'prev', nextPosition: 5 }),
    }));
    vi.doMock('../../../src/forensics/signing', () => ({
      getPublicKeyFingerprint: () => Promise.resolve('fp'),
      signHash: () => Promise.resolve('sig'),
    }));

    const { logBlockedEvent } = await import('../../../src/forensics/logger');
    await logBlockedEvent({
      platform: 'twitter',
      mode: 'adult',
      author: 'ExampleSat',
      postUrl: 'https://x.com/ExampleSat/status/1',
      blockReason: 'ads',
      matchedToken: 'platform-ad-marker',
      caption: 'buy this',
      configSnapshot: { mode: 'adult', threshold: 6, dailyCap: 2000 },
    });

    expect(added).toHaveLength(1);
    expect(added[0].configSnapshot).toEqual({ mode: 'adult', threshold: 6, dailyCap: 2000 });
    // A caller with no kind writes no kind (wiring audit 2026-09-13, C36): the
    // logger no longer stamps 'video' on an item it knows nothing about.
    expect(added[0].kind).toBeUndefined();
    // And no invented severity (C15), no 'video' surface (C17).
    expect(added[0].techniques).toEqual([]);
    expect(added[0].overallScore).toBe(0);
    expect(added[0].feedSource).toBe('unknown');
  });

  it('leaves them undefined when the caller could prove none of them', async () => {
    const added: Array<Record<string, unknown>> = [];
    vi.doMock('../../../src/forensics/store', () => ({
      addRecord: (r: Record<string, unknown>) => { added.push(r); return Promise.resolve(); },
      getChainState: () => Promise.resolve({ prevRecordHash: 'prev', nextPosition: 5 }),
    }));
    vi.doMock('../../../src/forensics/signing', () => ({
      getPublicKeyFingerprint: () => Promise.resolve('fp'),
      signHash: () => Promise.resolve('sig'),
    }));

    const { logBlockedEvent } = await import('../../../src/forensics/logger');
    await logBlockedEvent({
      platform: 'tiktok',
      mode: 'child',
      author: '@creator',
      postUrl: '',
      blockReason: 'reel-surface',
      matchedToken: 'parent-toggle',
      caption: '',
    });

    expect(added).toHaveLength(1);
    expect(added[0].accountType).toBeUndefined();
    expect(added[0].observedSequence).toBeUndefined();
    expect(added[0].surfaceSessionId).toBeUndefined();
  });
});

describe('the advertiser label on a blocked ad is guaranteed, not hopeful', () => {
  it('shares one signal with the gate that produced the block', async () => {
    // 'sponsored-ad:adult' (pipeline.ts) and accountType 'advertiser'
    // (account-type.ts) both key on post.is_sponsored === true and nothing
    // else. So on the one BLOCKED_LOG path that holds a post, passing
    // post.accountType through cannot resolve to anything but 'advertiser' —
    // the block and the label are the same fact stated twice.
    const { deriveAccountType } = await import('../../../src/content/record/account-type');
    expect(deriveAccountType({ is_sponsored: true } as never).accountType).toBe('advertiser');
    expect(deriveAccountType({ is_sponsored: false } as never).accountType).not.toBe('advertiser');
  });
});
