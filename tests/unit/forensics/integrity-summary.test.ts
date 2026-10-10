// Pure forensic chain-integrity summarizer — src/forensics/integrity-summary.ts.

import { describe, it, expect } from 'vitest';
import { summarizeForensicIntegrity } from '../../../src/forensics/integrity-summary';
import type { IntegrityResult, RecordVerifyStatus } from '../../../src/forensics/chain-integrity';

function perRecord(entries: Array<[string, RecordVerifyStatus]>): Map<string, RecordVerifyStatus> {
  return new Map(entries);
}

describe('summarizeForensicIntegrity', () => {
  it('counts a fully-verified chain with no remediation needed', () => {
    const result: IntegrityResult = {
      valid: true,
      chainLength: 3,
      preChainCount: 0,
      preRekeyCount: 0,
      perRecord: perRecord([['a', 'verified'], ['b', 'verified'], ['c', 'verified']]),
    };
    const s = summarizeForensicIntegrity(result);
    expect(s.valid).toBe(true);
    expect(s.verificationState).toBe('verified');
    expect(s.counts.verified).toBe(3);
    expect(s.counts.broken).toBe(0);
    expect(s.uncheckedAfterBreak).toBe(0);
    expect(s.remediation).toMatch(/verified/i);
  });

  it('separates unsigned, pre-rekey and pre-chain in the counts', () => {
    const result: IntegrityResult = {
      valid: true,
      chainLength: 2,
      preChainCount: 1,
      preRekeyCount: 1,
      perRecord: perRecord([
        ['a', 'verified'], ['b', 'unsigned'],
        ['old', 'pre-rekey'], ['legacy', 'pre-chain'],
      ]),
    };
    const s = summarizeForensicIntegrity(result);
    expect(s.counts.verified).toBe(1);
    expect(s.counts.unsigned).toBe(1);
    expect(s.counts['pre-rekey']).toBe(1);
    expect(s.counts['pre-chain']).toBe(1);
    expect(s.verificationState).toBe('partial');
    expect(s.remediation).toMatch(/signature.*not verified|unverified/i);
  });

  it('does not describe a current-key signature failure as a safe automatic repair', () => {
    const result: IntegrityResult = {
      valid: false,
      brokenAt: 2,
      brokenKind: 'key-mismatch',
      reason: 'signed by an earlier key',
      chainLength: 5,
      preChainCount: 0,
      preRekeyCount: 0,
      perRecord: perRecord([['a', 'verified'], ['b', 'verified'], ['c', 'broken']]),
    };
    const s = summarizeForensicIntegrity(result);
    expect(s.valid).toBe(false);
    expect(s.remediation).not.toMatch(/repair.*automatically/i);
    expect(s.remediation).toMatch(/signature.*verify|restore|unverified/i);
    // 5 chain records, walker checked 3 (2 verified + 1 broken) → 2 un-walked tail.
    expect(s.uncheckedAfterBreak).toBe(2);
  });

  it('warns AGAINST re-anchor for real tampering', () => {
    const result: IntegrityResult = {
      valid: false,
      brokenAt: 0,
      brokenKind: 'tampered',
      reason: 'content modified after signing',
      chainLength: 4,
      preChainCount: 0,
      preRekeyCount: 0,
      perRecord: perRecord([['a', 'broken']]),
    };
    const s = summarizeForensicIntegrity(result);
    expect(s.remediation).toMatch(/tampering|will NOT fix|damaged/i);
    expect(s.uncheckedAfterBreak).toBe(3);
  });

  it('handles a missing perRecord map without throwing', () => {
    const result: IntegrityResult = {
      valid: true,
      chainLength: 0,
      preChainCount: 0,
      preRekeyCount: 0,
    };
    const s = summarizeForensicIntegrity(result);
    expect(s.counts.verified).toBe(0);
    expect(s.uncheckedAfterBreak).toBe(0);
    expect(s.valid).toBe(true);
  });
});
