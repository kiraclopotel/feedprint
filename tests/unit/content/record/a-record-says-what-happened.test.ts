/** @vitest-environment jsdom */
// Wiring audit of 13 Sep 2026, batch D: a record describes what happened.
//
// Pins, one per finding (docs/audits/2026-09-13-wiring/CHAIN-DATA.md):
//   C13 a swear mask is written as verdict 'masked', neither pass nor flag;
//   C23 a hide whose page change did not land is 'flagged', not 'flagged-hidden';
//   C15 a blocked record carries no technique and no score;
//   C17 a blocked record with no surface says 'unknown', not 'video';
//   C36 a blocked record with no kind carries none;
//   C14 a blocked record carries the rail that decided it, when one did;
//   C7  the sponsored row with applied 'allow' names the switch in its note;
//   C26 a room summary carries no technique entry;
//   C5  two items with the same words are two records; one item twice is one;
//   C12 every marker kind is out of the identity-health denominator;
//   C19 records with no session id are judged per platform.
// Legacy records are never touched: every change here is to what NEW records
// say, and canonical-payload-stability.test.ts pins the old bytes.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../src/forensics/store', () => ({
  addRecord: vi.fn(async () => undefined),
  getChainState: vi.fn(async () => ({ nextPosition: 7, prevRecordHash: 'prev-hash-stub' })),
}));
vi.mock('../../../../src/forensics/signing', () => ({
  signHash: vi.fn(async () => 'stub-signature'),
  getPublicKeyFingerprint: vi.fn(async () => 'stub-fp'),
}));
vi.mock('../../../../src/forensics/hasher', () => ({
  sha256: vi.fn(async (s: string) => `hash-of-len-${s.length}`),
}));

import { logForensicEvent, logBlockedEvent, logEnvironmentEvent } from '../../../../src/forensics/logger';
import { addRecord } from '../../../../src/forensics/store';
import { decisionForBlock, decisionForLegacy, decisionForMask, NOTE_SETTING_OFF, NOTE_NOT_APPLIED, NOTE_LEGACY_ACTED, NOTE_AD_HIDDEN } from '../../../../src/content/record/decision';
import { readSource } from '../../../helpers/read-source';
import { forensicDedupKey, shouldLogForensic, _resetForensicDedupForTesting } from '../../../../src/content/record/forensic-gate';
import { summarizeRecordIdentity } from '../../../../src/forensics/record-identity-health';
import { computeAttendance } from '../../../../src/forensics/attendance';
import { isDecidedContentRecord, isFlaggedRecord } from '../../../../src/forensics/flag-provenance';
import type { AnalysisResult } from '../../../../src/types/analysis';
import type { ForensicRecord } from '../../../../src/types/forensic';

const added = vi.mocked(addRecord);
const lastRecord = () => added.mock.calls[added.mock.calls.length - 1][0];

function analysis(action: AnalysisResult['action']): AnalysisResult {
  return {
    postId: 'p-1',
    techniques: [{ technique: 'shame-attack', present: true, confidence: 0.9, severity: 8, evidence: [] }],
    overallScore: 8,
    overallConfidence: 0.9,
    isManipulative: true,
    processingTimeMs: 0,
    action,
  };
}

beforeEach(() => {
  added.mockReset();
  _resetForensicDedupForTesting();
});

describe('C13: a mask is its own verdict', () => {
  it('a decision applied as mask writes verdict masked', async () => {
    await logForensicEvent({
      originalText: 'what the **** is this',
      neutralizedText: 'what the **** is this',
      analysis: { ...analysis('rewrite'), techniques: [], overallScore: 0, isManipulative: false },
      mode: 'teen',
      platform: 'twitter',
      aiSource: 'rules',
      decision: decisionForMask('teen'),
    });
    expect(lastRecord().verdict).toBe('masked');
  });

  it('a masked record is decided and not flagged', () => {
    const r = { verdict: 'masked', kind: 'post' } as ForensicRecord;
    expect(isDecidedContentRecord(r)).toBe(true);
    expect(isFlaggedRecord(r)).toBe(false);
  });
});

describe('C23: a failed hide is not hidden', () => {
  it('visualApplied false on a hide writes flagged, not flagged-hidden', async () => {
    await logForensicEvent({
      originalText: 'a hide that did not land',
      neutralizedText: '',
      analysis: analysis('hide'),
      mode: 'child',
      platform: 'tiktok',
      aiSource: 'cloud',
      visualApplied: false,
    });
    const rec = lastRecord();
    expect(rec.verdict).toBe('flagged');
    expect(rec.visualApplied).toBe(false);
  });

  it('a hide that landed still writes flagged-hidden', async () => {
    await logForensicEvent({
      originalText: 'a hide that landed',
      neutralizedText: '',
      analysis: analysis('hide'),
      mode: 'child',
      platform: 'tiktok',
      aiSource: 'cloud',
    });
    expect(lastRecord().verdict).toBe('flagged-hidden');
  });
});

describe('C15, C17, C36, C14: a blocked record says only what the rule knew', () => {
  it('no technique, no score, no invented surface, no invented kind', async () => {
    await logBlockedEvent({
      platform: 'instagram',
      mode: 'child',
      author: 'parent-action',
      postUrl: '',
      blockReason: 'media-timeout',
      matchedToken: 'parent-toggle',
      caption: '',
    });
    const rec = lastRecord();
    expect(rec.verdict).toBe('blocked');
    expect(rec.techniques).toEqual([]);
    expect(rec.overallScore).toBe(0);
    expect(rec.feedSource).toBe('unknown');
    expect(rec.kind).toBeUndefined();
    expect(rec.decision).toBeUndefined();
    expect(rec.detectionMode).toBe('block:media-timeout:parent-toggle');
  });

  it('carries the kind and the rail the caller gave', async () => {
    await logBlockedEvent({
      platform: 'facebook',
      mode: 'adult',
      author: 'Some Brand',
      postUrl: 'https://www.facebook.com/x',
      blockReason: 'ads',
      matchedToken: 'platform-ad-marker',
      caption: 'buy this',
      kind: 'post',
      feedSource: 'for-you',
      decision: decisionForBlock({ mode: 'adult', blockReason: 'ads', matchedToken: 'platform-ad-marker', applied: 'collapse', mask: false }),
    });
    const rec = lastRecord();
    expect(rec.kind).toBe('post');
    expect(rec.feedSource).toBe('for-you');
    expect(rec.decision).toMatchObject({ row: 'R4', action: 'collapse', applied: 'collapse', note: null });
    expect(rec.decision!.rails).toEqual([{ name: 'sponsored', match: '' }]);
  });
});

describe('decisionForBlock and the switched-off note (C14, C7)', () => {
  it('a household hashtag is the blocklist rail with its token', () => {
    const d = decisionForBlock({ mode: 'teen', blockReason: 'hashtag', matchedToken: '#aifruit', applied: 'hide', mask: false })!;
    expect(d).toMatchObject({ row: 'R1', action: 'hide', applied: 'hide', note: null });
    expect(d.rails).toEqual([{ name: 'blocklist', match: '#aifruit' }]);
  });

  it('the AI label, the reel surface and the media timeout have no row', () => {
    for (const reason of ['ai-label:en', 'reel-surface', 'media-timeout']) {
      expect(decisionForBlock({ mode: 'teen', blockReason: reason, matchedToken: 'x', applied: 'hide', mask: false })).toBeUndefined();
    }
  });

  it('an ad served with Block Ads off is the sponsored row, applied allow, note naming the switch', () => {
    const d = decisionForLegacy({ mode: 'adult', detectionMode: 'sponsored-ad:adult', techniques: [], applied: 'allow', mask: false, settingOff: true })!;
    expect(d).toMatchObject({ row: 'R4', action: 'collapse', applied: 'allow', note: NOTE_SETTING_OFF });
    const failed = decisionForLegacy({ mode: 'adult', detectionMode: 'sponsored-ad:adult', techniques: [], applied: 'allow', mask: false })!;
    expect(failed.note).toBe(NOTE_NOT_APPLIED);
  });
});

describe('C26: a room summary carries no technique entry', () => {
  it('techniques is empty; the dominant technique stays in the environment block', async () => {
    await logEnvironmentEvent({
      platform: 'tiktok',
      mode: 'teen',
      parentVideoId: 'v1',
      videoCaption: 'cap',
      environment: {
        label: 'hostile', summary: 'a hostile room', sampled: 20, total: 40,
        dominantTechnique: 'shame-attack',
      } as never,
    });
    const rec = lastRecord();
    expect(rec.techniques).toEqual([]);
    expect(rec.environment!.dominantTechnique).toBe('shame-attack');
  });
});

describe('C5: the dedup key is the item, not its words', () => {
  it('two posts with the same text are two records; the same post twice is one', () => {
    const a = { platform: 'twitter', id: 'tw-1', text: 'same words' };
    const b = { platform: 'twitter', id: 'tw-2', text: 'same words' };
    expect(shouldLogForensic(forensicDedupKey(a))).toBe(true);
    expect(shouldLogForensic(forensicDedupKey(b))).toBe(true);
    expect(shouldLogForensic(forensicDedupKey(a))).toBe(false);
  });

  it('two caption-less videos are two records', () => {
    expect(shouldLogForensic(forensicDedupKey({ platform: 'tiktok', id: 'tk-vid-1', text: '' }))).toBe(true);
    expect(shouldLogForensic(forensicDedupKey({ platform: 'tiktok', id: 'tk-vid-2', text: '' }))).toBe(true);
  });
});

function rec(over: Partial<ForensicRecord>): ForensicRecord {
  return {
    id: 'r', timestamp: new Date().toISOString(), platform: 'twitter',
    originalText: 't', originalHash: 'h', originalLength: 1, neutralizedText: '',
    author: '@a', postUrl: 'https://x.com/a/status/1', techniques: [], overallScore: 0,
    userAgeCategory: 'teen', aiSource: 'cloud', feedSource: 'for-you',
    integrityHash: 'i', signature: 's', publicKeyFingerprint: 'f', chainPosition: 1,
    verdict: 'pass', kind: 'post',
    ...over,
  } as ForensicRecord;
}

describe('C12: every marker kind is out of the identity denominator', () => {
  it('heartbeat, gap, prune, import, repair, redaction and reconcile markers do not count as hollow content', () => {
    const markers = ['heartbeat-marker', 'gap-marker', 'prune-marker', 'import-marker', 'repair-marker', 'redaction-marker', 'reconcile-marker']
      .map(kind => rec({ kind: kind as ForensicRecord['kind'], author: '', postUrl: '' }));
    const content: ForensicRecord[] = [];
    for (let i = 0; i < 25; i++) content.push(rec({ id: `c${i}` }));
    const s = summarizeRecordIdentity([...content, ...markers]);
    expect(s.contentRecords).toBe(25);
    expect(s.anonymous).toBe(0);
    expect(s.alarm).toBe('ok');
  });
});

describe('C19: no session id means per platform, not one stream', () => {
  it('two platforms with no session id are two runs', () => {
    const t0 = Date.parse('2026-09-07T01:43:00.000Z');
    const out: ForensicRecord[] = [];
    for (let i = 0; i < 40; i++) {
      out.push(rec({ id: `x${i}`, platform: 'twitter', surfaceSessionId: undefined, timestamp: new Date(t0 + i * 23_000).toISOString() }));
      out.push(rec({ id: `t${i}`, platform: 'tiktok', surfaceSessionId: undefined, timestamp: new Date(t0 + i * 23_000 + 11_000).toISOString() }));
    }
    const s = computeAttendance(out);
    expect(s.runs.length).toBe(2);
  });
});

// 2026-09-20: found by running decisionForBlock with media-only-ad-blocker's own arguments.
// Row R4 (sponsored) says collapse in every mode; media-only-ad-blocker.ts hides the post, and
// hide ranks above collapse (actionRank), so the page did MORE than the row names. Before today
// block() only knew two sentences, so this case fell to NOTE_NOT_APPLIED, a false claim that the
// page could not apply the action. The fix reads the two ranks and picks NOTE_LEGACY_ACTED when
// applied outranks action, leaving a genuinely lower rank on NOTE_NOT_APPLIED as before.
describe('2026-09-20: a page that did more than the row names is not a failure', () => {
  it.each(['child', 'teen', 'adult'] as const)(
    'the media-only ad hide on X is row R4, action collapse, and says Block ads hid it, in %s mode',
    (mode) => {
      const d = decisionForBlock({ mode, blockReason: 'ads', matchedToken: 'media-only-ad-marker', applied: 'hide', mask: false })!;
      // Until 9 Oct 2026 this was signed NOTE_LEGACY_ACTED; a hidden ad now has its own sentence.
      expect(d).toMatchObject({ row: 'R4', action: 'collapse', applied: 'hide', note: NOTE_AD_HIDDEN });
      expect(d.note).not.toBe(NOTE_NOT_APPLIED);
    },
  );

  it('a collapse that did not land still says the page could not apply the action', () => {
    const d = decisionForBlock({ mode: 'adult', blockReason: 'ads', matchedToken: 'platform-ad-marker', applied: 'mark', mask: false })!;
    expect(d.note).toBe(NOTE_NOT_APPLIED);
  });

  // applied equal to action (collapse) giving note null is already asserted above, in
  // "carries the kind and the rail the caller gave" (C15/C17/C36/C14): not duplicated here.

  it('media-only-ad-blocker.ts still calls decisionForBlock with the arguments case 1 above relies on', () => {
    const src = readSource('src/content/engagement/media-only-ad-blocker.ts');
    expect(
      src,
      'decisionForBlock is no longer called with blockReason: \'ads\' and applied: \'hide\' in media-only-ad-blocker.ts',
    ).toContain("decisionForBlock({ mode, blockReason: 'ads', matchedToken: 'media-only-ad-marker', applied: 'hide', mask: false })");
  });
});
