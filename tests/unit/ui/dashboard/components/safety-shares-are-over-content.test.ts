/** @vitest-environment jsdom */
//
// Every share on the safety panel read lower than it is.
//
// recordMatchesBucket inspects techniques, detectionMode and harmFloor. An
// environment reading (the room summary written per comment batch) and the nine
// system-marker kinds carry none of those, so they could never be in any
// bucket's numerator. The denominator was records.length, so they always sat in
// it.
//
// One profanity record beside nine room summaries showed 10.0%, where the
// honest answer over the content the person was shown is one of one.
//
// isBalanceContent is overview-data's, which is StatisticsTab's, and the
// account ledger's header calls it the rule "the panel, the Overview and
// Statistics must never disagree on". This panel was the one disagreeing.
//
// The arithmetic is asserted directly rather than by rendering: the fix is a
// denominator, and a render test would prove the same thing through three
// layers that are not what changed.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT as ROOT } from '../../../../helpers/repo-root';
import type { ForensicRecord } from '../../../../../src/types/forensic';
import { isBalanceContent } from '../../../../../src/ui/dashboard/record-sets';
import { recordMatchesBucket } from '../../../../../src/ui/dashboard/components/SafetyCategoriesPanel';

let seq = 0;
function rec(over: Partial<ForensicRecord> = {}): ForensicRecord {
  seq += 1;
  return {
    id: `r-${seq}`,
    timestamp: '2026-07-01T10:00:00.000Z',
    platform: 'twitter',
    originalText: 'something',
    originalHash: 'h',
    originalLength: 9,
    neutralizedText: '',
    author: '@someone',
    postUrl: '',
    techniques: [],
    overallScore: 0,
    userAgeCategory: 'adult',
    aiSource: 'cloud',
    feedSource: 'for-you',
    integrityHash: 'deadbeef',
    signature: 'sig',
    publicKeyFingerprint: 'fp',
    chainPosition: seq,
    kind: 'post',
    verdict: 'pass',
    ...over,
  } as unknown as ForensicRecord;
}

const swearing = () => rec({
  verdict: 'flagged',
  techniques: [{ name: 'profanity', severity: 4, confidence: 1 }],
} as Partial<ForensicRecord>);

/** The panel's own arithmetic, over whichever denominator is passed. */
const share = (matched: number, denominator: number) =>
  (denominator > 0 ? Math.round((matched / denominator) * 1000) / 10 : 0);

describe('safety shares are taken over content (2026-09-19)', () => {
  it('a room summary can never be in a bucket, so it is not in the denominator', () => {
    const environment = rec({ kind: 'environment', verdict: undefined } as Partial<ForensicRecord>);
    expect(recordMatchesBucket(environment, 'swearing'), 'never a numerator').toBe(false);
    expect(isBalanceContent(environment), 'so never a denominator either').toBe(false);
  });

  it.each(['reset-marker', 'prune-marker', 'gap-marker', 'month-rotation-marker', 'heartbeat-marker'])(
    'a %s can never be in a bucket, so it is not in the denominator',
    (kind) => {
      const marker = rec({ kind, verdict: undefined } as Partial<ForensicRecord>);
      expect(recordMatchesBucket(marker, 'swearing')).toBe(false);
      expect(isBalanceContent(marker)).toBe(false);
    },
  );

  it('one swear beside nine room summaries is one of one, not one of ten', () => {
    const records = [swearing(), ...Array.from({ length: 9 }, () =>
      rec({ kind: 'environment', verdict: undefined } as Partial<ForensicRecord>))];

    const matched = records.filter((r) => recordMatchesBucket(r, 'swearing')).length;
    const content = records.filter(isBalanceContent).length;

    expect(matched).toBe(1);
    expect(share(matched, records.length), 'what the panel used to say').toBe(10);
    expect(share(matched, content), 'what is true').toBe(100);
  });

  it('with no markers in the mix nothing changes at all', () => {
    const records = [swearing(), rec(), rec(), rec()];
    const matched = records.filter((r) => recordMatchesBucket(r, 'swearing')).length;
    const content = records.filter(isBalanceContent).length;

    expect(content).toBe(records.length);
    expect(share(matched, content)).toBe(share(matched, records.length));
  });

  it('the panel takes its denominator from that predicate and not from the array', () => {
    // The fix is one line and this is the line.
    const src = readFileSync(join(ROOT, 'src/ui/dashboard/components/SafetyCategoriesPanel.tsx'), 'utf8');
    expect(src).toContain('records.filter(isItem).length');
    const code = src.split(/\r?\n/).filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//')).join(' ');
    expect(code, 'the raw length is gone from the code').not.toContain('const totalRecords = records.length');
  });
});
