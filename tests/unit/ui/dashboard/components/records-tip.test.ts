// recordTip — the append-only "tip" signature used to skip redundant dashboard
// re-pulls. Same tip ⇒ nothing appended ⇒ the feed array reference can stay put.

import { describe, it, expect } from 'vitest';
import { recordTip } from '../../../../../src/ui/dashboard/components/records-tip';
import type { ForensicRecord } from '../../../../../src/types/forensic';

function rec(id: string, timestamp: string): ForensicRecord {
  // Only the fields recordTip reads matter; cast the rest.
  return { id, timestamp } as ForensicRecord;
}

describe('recordTip', () => {
  it('is "0" for an empty set', () => {
    expect(recordTip([])).toBe('0');
  });

  it('encodes count + last id + last timestamp', () => {
    const recs = [rec('a', '2026-06-01T00:00:00Z'), rec('b', '2026-06-02T00:00:00Z')];
    expect(recordTip(recs)).toBe('2|b|2026-06-02T00:00:00Z');
  });

  it('is STABLE when the set is unchanged (same tip on re-read)', () => {
    const recs = [rec('a', '2026-06-01T00:00:00Z'), rec('b', '2026-06-02T00:00:00Z')];
    const reread = [rec('a', '2026-06-01T00:00:00Z'), rec('b', '2026-06-02T00:00:00Z')];
    expect(recordTip(recs)).toBe(recordTip(reread));
  });

  it('CHANGES when a record is appended (count + tail move)', () => {
    const before = [rec('a', '2026-06-01T00:00:00Z')];
    const after = [...before, rec('b', '2026-06-02T00:00:00Z')];
    expect(recordTip(after)).not.toBe(recordTip(before));
  });

  it('CHANGES when the last record differs at equal length (recheck appended a sighting then trimmed view)', () => {
    const a = [rec('a', '2026-06-01T00:00:00Z'), rec('b', '2026-06-02T00:00:00Z')];
    const b = [rec('a', '2026-06-01T00:00:00Z'), rec('c', '2026-06-03T00:00:00Z')];
    expect(recordTip(a)).not.toBe(recordTip(b));
  });
});
