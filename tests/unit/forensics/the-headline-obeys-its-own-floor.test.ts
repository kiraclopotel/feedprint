// The identity panel's headline printed a percentage off any sample above zero.
//
// record-identity-health.ts defines IDENTITY_MIN_DENOM = 20 at the top of
// itself and gates every per-platform row on it: below the floor, stateFor
// returns 'insufficient' and the panel prints "not enough to tell".
//
// The headline above those rows had no floor. It printed anonymousPct whenever
// contentRecords was anything other than zero. So a two-record day read "1 of 2
// records anonymous (50%)" over a list in which every row said there was not
// enough to tell: one number, two treatments, on one panel, from one module
// that defines the floor itself.
//
// The aggregate now carries the same state the rows do, from the same function.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT as ROOT } from '../../helpers/repo-root';
import type { ForensicRecord } from '../../../src/types/forensic';
import {
  summarizeRecordIdentity,
  IDENTITY_MIN_DENOM,
} from '../../../src/forensics/record-identity-health';

let seq = 0;
/** A content record inside the window; anonymous when it has neither author nor link. */
function rec(anonymous: boolean): ForensicRecord {
  seq += 1;
  return {
    id: `r-${seq}`,
    timestamp: new Date().toISOString(),
    platform: 'twitter',
    originalText: 'something',
    originalHash: 'h',
    originalLength: 9,
    neutralizedText: '',
    author: anonymous ? '' : '@someone',
    postUrl: anonymous ? '' : 'https://x.com/someone/status/1',
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
  } as unknown as ForensicRecord;
}

const many = (n: number, anonymous: boolean) => Array.from({ length: n }, () => rec(anonymous));

describe('the headline obeys its own floor (2026-09-19)', () => {
  it('a sample under the floor says so instead of quoting a percentage', () => {
    const summary = summarizeRecordIdentity([rec(true), rec(false)]);
    expect(summary.contentRecords).toBe(2);
    expect(summary.state, 'two records is not a rate').toBe('insufficient');
  });

  it('the rows under it always said that, and still do', () => {
    const summary = summarizeRecordIdentity([rec(true), rec(false)]);
    expect(summary.platforms[0]?.state, 'the row the headline disagreed with').toBe('insufficient');
    expect(summary.state, 'and now the headline agrees with it').toBe(summary.platforms[0]?.state);
  });

  it('a sample at the floor is read normally again', () => {
    const summary = summarizeRecordIdentity(many(IDENTITY_MIN_DENOM, false));
    expect(summary.contentRecords).toBe(IDENTITY_MIN_DENOM);
    expect(summary.state).not.toBe('insufficient');
  });

  it('a real problem over a real sample is still a real problem', () => {
    // The floor must not become a way to say nothing: plenty of records, most
    // of them anonymous, has to read as broken.
    const summary = summarizeRecordIdentity([...many(30, true), ...many(10, false)]);
    expect(summary.contentRecords).toBe(40);
    expect(summary.state, 'not insufficient, and not ok').toBe('broken');
    expect(summary.anonymousPct).toBe(75);
  });

  it('the panel prints the floor sentence rather than the percentage', () => {
    const ui = readFileSync(join(ROOT, 'src/ui/dashboard/components/OperationalEventsPanel.tsx'), 'utf8');
    expect(ui).toContain("recordIdentity.state === 'insufficient'");
    expect(ui, 'and reuses the sentence the rows use, so a reader meets one idea')
      .toContain('t.opsIdentityInsufficient(recordIdentity.contentRecords)');
  });
});
