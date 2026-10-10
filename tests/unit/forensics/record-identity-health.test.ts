import { describe, it, expect } from 'vitest';
import {
  summarizeRecordIdentity,
  IDENTITY_MIN_DENOM,
  IDENTITY_WINDOW_MS,
  IDENTITY_DEGRADED_PCT,
  IDENTITY_BROKEN_PCT,
} from '../../../src/forensics/record-identity-health';
import type { ForensicRecord } from '../../../src/types/forensic';

const NOW = Date.parse('2026-08-01T12:00:00.000Z');

function rec(over: Partial<ForensicRecord>): ForensicRecord {
  return {
    id: 'r', timestamp: new Date(NOW).toISOString(), platform: 'twitter',
    originalText: 't', originalHash: 'h', originalLength: 1, neutralizedText: '',
    author: 'someone', postUrl: 'https://x.com/someone/status/1', techniques: [],
    overallScore: 0, userAgeCategory: 'teen', aiSource: 'cloud', feedSource: 'home',
    integrityHash: 'ih',
    ...over,
  } as ForensicRecord;
}

/** N records for one platform, `anon` of them fully anonymous (no author, no url). */
function fleet(platform: string, total: number, anon: number, over: Partial<ForensicRecord> = {}): ForensicRecord[] {
  const out: ForensicRecord[] = [];
  for (let i = 0; i < total; i++) {
    const hollow = i < anon;
    out.push(rec({
      platform: platform as ForensicRecord['platform'],
      author: hollow ? '' : 'someone',
      postUrl: hollow ? '' : 'https://x.com/someone/status/1',
      anchorUrl: undefined,
      ...over,
    }));
  }
  return out;
}

describe('summarizeRecordIdentity', () => {
  it('all records carry identity → alarm ok, 0% anonymous', () => {
    const s = summarizeRecordIdentity(fleet('twitter', 40, 0), NOW);
    expect(s.alarm).toBe('ok');
    expect(s.anonymous).toBe(0);
    expect(s.anonymousPct).toBe(0);
    expect(s.worst).toBeNull();
    expect(s.contentRecords).toBe(40);
  });

  it('degraded band raises an amber alarm on the worst platform', () => {
    // 25% anonymous (10/40) sits between degraded (10%) and broken (40%).
    const s = summarizeRecordIdentity(fleet('twitter', 40, 10), NOW);
    expect(s.alarm).toBe('degraded');
    expect(s.worst?.platform).toBe('twitter');
    expect(s.worst?.anonymousPct).toBe(25);
    expect(IDENTITY_DEGRADED_PCT).toBeLessThan(IDENTITY_BROKEN_PCT);
  });

  it('a rotated platform reads broken; a healthy one does not dilute it', () => {
    const s = summarizeRecordIdentity(
      [...fleet('twitter', 40, 36), ...fleet('facebook', 40, 0)],
      NOW,
    );
    // Overall would be 45% but the per-platform split keeps the signal sharp:
    expect(s.alarm).toBe('broken');
    expect(s.worst?.platform).toBe('twitter');
    expect(s.worst?.anonymousPct).toBe(90);
    const fb = s.platforms.find(p => p.platform === 'facebook');
    expect(fb?.state).toBe('ok');
    // Worst-first ordering.
    expect(s.platforms[0].platform).toBe('twitter');
  });

  it('missing author OR url alone is NOT anonymous (needs both missing)', () => {
    const records = [
      ...Array.from({ length: 20 }, () => rec({ author: '', postUrl: 'https://x.com/a/status/1' })), // no author, has url
      ...Array.from({ length: 20 }, () => rec({ author: 'a', postUrl: '', anchorUrl: '' })),          // has author, no url
    ];
    const s = summarizeRecordIdentity(records, NOW);
    expect(s.anonymous).toBe(0);
    expect(s.alarm).toBe('ok');
    expect(s.missingAuthor).toBe(20);
    expect(s.missingUrl).toBe(20);
  });

  it('anchorUrl counts as a source URL (per-comment permalink)', () => {
    const s = summarizeRecordIdentity(
      fleet('twitter', 30, 30, { postUrl: '', anchorUrl: 'https://x.com/a/status/9' }),
      NOW,
    );
    expect(s.anonymous).toBe(0);
    expect(s.alarm).toBe('ok');
  });

  it('too few records → insufficient, never alarms', () => {
    const s = summarizeRecordIdentity(fleet('twitter', IDENTITY_MIN_DENOM - 1, IDENTITY_MIN_DENOM - 1), NOW);
    expect(s.alarm).toBe('ok');
    expect(s.worst).toBeNull();
    expect(s.platforms[0].state).toBe('insufficient');
    expect(s.platforms[0].anonymousPct).toBe(100);
  });

  it('non-content records (markers, room aggregate) are excluded', () => {
    const records = [
      ...fleet('twitter', 30, 0),
      rec({ kind: 'environment', author: '', postUrl: '' }),
      rec({ kind: 'reset-marker', author: '', postUrl: '' }),
      rec({ kind: 'month-rotation-marker', author: '', postUrl: '' }),
    ];
    const s = summarizeRecordIdentity(records, NOW);
    expect(s.contentRecords).toBe(30);
    expect(s.anonymous).toBe(0);
    expect(s.alarm).toBe('ok');
  });

  it('records outside the 24h window are ignored (degraded NOW, not historical)', () => {
    const stale = new Date(NOW - IDENTITY_WINDOW_MS - 60_000).toISOString();
    const records = [
      ...fleet('twitter', 40, 40, { timestamp: stale }), // all hollow but old
      ...fleet('twitter', 30, 0),                         // recent + clean
    ];
    const s = summarizeRecordIdentity(records, NOW);
    expect(s.contentRecords).toBe(30);
    expect(s.anonymous).toBe(0);
    expect(s.alarm).toBe('ok');
  });

  it('empty input → benign zeroed summary', () => {
    const s = summarizeRecordIdentity([], NOW);
    expect(s.contentRecords).toBe(0);
    expect(s.alarm).toBe('ok');
    expect(s.platforms).toEqual([]);
    expect(s.worst).toBeNull();
  });
});
