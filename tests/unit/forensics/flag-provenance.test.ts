// What decided a flag: a judge, or a rule?
//
// Built from the 2026-09-08 export, which said "594 of 5,233 content records
// flagged, 11%". 400 of those were the platform's own "Sponsored" marker
// matched by a regex, 52 more were the household's blocklist, the swear mask
// and the slur gate, and 142 were a judge reading an item and naming a
// technique. One figure carried an ad blocker and a judge under one word.

import { describe, it, expect } from 'vitest';
import {
  baseDetectionMode,
  flagProvenance,
  computeFlagSplit,
  isDecidedContentRecord,
  isFlaggedRecord,
} from '../../../src/forensics/flag-provenance';
import type { ForensicRecord } from '../../../src/types/forensic';

function rec(over: Partial<ForensicRecord>): ForensicRecord {
  return {
    id: 'r1',
    timestamp: '2026-09-07T00:00:00.000Z',
    platform: 'twitter',
    originalText: 't',
    originalHash: 'h',
    originalLength: 1,
    neutralizedText: '',
    author: 'a',
    postUrl: 'https://x.com/1',
    techniques: [],
    overallScore: 0,
    userAgeCategory: 'teen',
    aiSource: 'cloud',
    feedSource: 'for-you',
    detectionMode: 'x',
    prevRecordHash: 'p',
    chainPosition: 1,
    verdict: 'flagged',
    kind: 'post',
    publicKeyFingerprint: 'f',
    integrityHash: 'i',
    signature: 's',
    ...over,
  } as ForensicRecord;
}

describe('flagProvenance', () => {
  // The 400-record case: the platform said "Sponsored", a regex saw the
  // marker, and no model read a word of it.
  it('a record no model read is rule-decided', () => {
    expect(flagProvenance(rec({ aiSource: 'rules', detectionMode: 'sponsored-ad' }))).toBe('rule');
    expect(flagProvenance(rec({ aiSource: 'none' }))).toBe('rule');
  });

  // A model ran AND a deterministic gate overruled it. The rule is what
  // decided, so the flag belongs on the rule side however good the model was.
  it('a deterministic override is rule-decided even when a model ran', () => {
    expect(flagProvenance(rec({ aiSource: 'cloud', overrideOrigin: 'identity-slur' }))).toBe('rule');
    expect(flagProvenance(rec({ aiSource: 'local', overrideOrigin: 'profanity-tier' }))).toBe('rule');
  });

  it('a model verdict with no override is judged', () => {
    expect(flagProvenance(rec({ aiSource: 'cloud' }))).toBe('judged');
    expect(flagProvenance(rec({ aiSource: 'local' }))).toBe('judged');
  });

  // The split must not depend on the detection-mode label. That string is a
  // human-readable name whose spellings have already changed twice
  // ('profanity-soften' became 'profanity-mask' on 2026-09-07), and a split
  // keyed on it would silently mis-count after the next rename.
  it('does not read the detection-mode text', () => {
    expect(flagProvenance(rec({ aiSource: 'cloud', detectionMode: 'sponsored-ad' }))).toBe('judged');
    expect(flagProvenance(rec({ aiSource: 'rules', detectionMode: 'comment-batch:negative' }))).toBe('rule');
  });
});

describe('isDecidedContentRecord', () => {
  it('counts pass, blocked and both flagged verdicts', () => {
    for (const verdict of ['pass', 'blocked', 'flagged', 'flagged-hidden'] as const) {
      expect(isDecidedContentRecord(rec({ verdict }))).toBe(true);
    }
  });

  it('leaves out what was never decided or is not content', () => {
    expect(isDecidedContentRecord(rec({ verdict: 'cancelled-dom-gone' }))).toBe(false);
    expect(isDecidedContentRecord(rec({ verdict: 'skipped' }))).toBe(false);
    expect(isDecidedContentRecord(rec({ kind: 'environment' }))).toBe(false);
  });

  // Verdict-less records predate the field and were only ever written flagged.
  it('a record with no verdict is a flagged content record', () => {
    const r = rec({});
    delete (r as { verdict?: unknown }).verdict;
    expect(isDecidedContentRecord(r)).toBe(true);
    expect(isFlaggedRecord(r)).toBe(true);
  });
});

describe('computeFlagSplit', () => {
  it('separates the two, and the halves add up to the total', () => {
    const records = [
      ...Array.from({ length: 400 }, () => rec({ aiSource: 'rules', detectionMode: 'sponsored-ad' })),
      ...Array.from({ length: 21 }, () => rec({ aiSource: 'rules', detectionMode: 'blocklist:word:elon' })),
      ...Array.from({ length: 142 }, () => rec({ aiSource: 'cloud', detectionMode: 'combined-detect-neutralize' })),
      ...Array.from({ length: 4670 }, () => rec({ verdict: 'pass' })),
    ];
    const split = computeFlagSplit(records)!;
    expect(split.decided).toBe(5233);
    // The 400 ads left the flag count on 2026-09-14 (rebuild plan, standing
    // decision 1): they are reported on their own paid-placement line, inside
    // the denominator and inside nothing else. What is left is the 142 a judge
    // read and the 21 the household's word list matched.
    expect(split.paidPlacement).toBe(400);
    expect(split.flagged).toBe(163);
    expect(split.judged).toBe(142);
    expect(split.rule).toBe(21);
    expect(split.judged + split.rule).toBe(split.flagged);
    // The rule families that are left are the household's own, with the ad
    // marker no longer wearing a rule family's name.
    expect(split.ruleKinds).toEqual([{ kind: 'blocklist', records: 21 }]);
  });

  it('cancelled and environment records are in neither half', () => {
    const split = computeFlagSplit([
      rec({ verdict: 'pass' }),
      rec({ verdict: 'cancelled-stale' }),
      rec({ kind: 'environment', verdict: 'pass' }),
    ])!;
    expect(split.decided).toBe(1);
    expect(split.flagged).toBe(0);
  });

  it('a file with nothing decided returns null rather than 0%', () => {
    expect(computeFlagSplit([])).toBeNull();
    expect(computeFlagSplit([rec({ verdict: 'cancelled-stale' })])).toBeNull();
  });
});

// A record the person typed into the dashboard. manual-flag.ts writes it with
// techniques:[], overallScore 0 and the comment "No detector ran". Counting it
// as judged made page one say "A model read the item and named a technique"
// about a row whose own badge, further down the same file, says a human typed
// it — and, when it was the only flag, made the rule row add "Every flag in
// this file was made by a judge that read the item."
describe('manual flags', () => {
  const manual = (over = {}) => rec({ aiSource: 'local', feedSource: 'manual', detectionMode: 'manual', techniques: [], overallScore: 0, ...over });

  it('is its own provenance, not judged', () => {
    expect(flagProvenance(manual())).toBe('manual');
    expect(flagProvenance(manual({ feedSource: 'for-you', id: 'fr-manual-123' }))).toBe('manual');
    expect(flagProvenance(manual({ feedSource: 'for-you', detectionMode: 'manual:parent' }))).toBe('manual');
  });

  it('is counted apart from judged and rule', () => {
    const split = computeFlagSplit([manual(), rec({ verdict: 'pass' })])!;
    expect(split.flagged).toBe(1);
    expect(split.manual).toBe(1);
    expect(split.judged).toBe(0);
    expect(split.rule).toBe(0);
    // and it is not filed under a rule family
    expect(split.ruleKinds).toEqual([]);
  });
});

// The label on a rule family must name the gate that DECIDED. Reading the
// detection mode alone filed a slur the identity gate caught under
// 'comment-batch' — beside the model verdicts it had just overruled.
describe('ruleKinds labelling', () => {
  it('names the override gate when one fired', () => {
    const split = computeFlagSplit([
      rec({ aiSource: 'cloud', overrideOrigin: 'identity-slur', detectionMode: 'comment-batch:negative' }),
      rec({ aiSource: 'cloud', overrideOrigin: 'profanity-tier', detectionMode: 'comment-batch:negative' }),
    ])!;
    expect(split.ruleKinds.map(k => k.kind).sort()).toEqual(['identity-slur', 'profanity-tier']);
  });

  // A record replayed after a chain rotation carries 'late-after-rotation:<mode>'.
  // Splitting on the first colon filed every replayed record under one
  // meaningless family instead of its own.
  it('strips the delivery prefix so a replayed record groups with its own family', () => {
    expect(baseDetectionMode('late-after-rotation:sponsored-ad')).toBe('sponsored-ad');
    expect(baseDetectionMode('sponsored-ad')).toBe('sponsored-ad');
    expect(baseDetectionMode(undefined)).toBe('');
    // Read on a family that still reaches ruleKinds: advertising leaves the
    // split entirely since 2026-09-14, so a sponsored-ad pair would prove
    // nothing about the prefix.
    const split = computeFlagSplit([
      rec({ aiSource: 'rules', detectionMode: 'blocklist:word:elon' }),
      rec({ aiSource: 'rules', detectionMode: 'late-after-rotation:blocklist:word:elon' }),
    ])!;
    expect(split.ruleKinds).toEqual([{ kind: 'blocklist', records: 2 }]);
  });
});
