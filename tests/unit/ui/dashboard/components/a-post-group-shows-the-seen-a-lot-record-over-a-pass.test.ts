// The Head, 10 Oct 2026: a post group shows one record of the post, the worst verdict winning. A "seen a lot" record
// ranked 0, below a pass, so a group holding both showed the pass. It ranks above a pass now (it carries a marker).

import { describe, expect, it } from 'vitest';
import type { ForensicRecord } from '../../../../../src/types/forensic';
import { pickEvidenceRecord } from '../../../../../src/ui/dashboard/components/PostGroupCard';

const rec = (id: string, over: Partial<ForensicRecord>): ForensicRecord => ({
  id, chainPosition: 1, timestamp: '2026-10-10T10:00:00.000Z', kind: 'video', platform: 'tiktok', originalText: 'text',
  techniques: [], videoContext: { sceneDescription: 'a scene' }, ...over,
}) as unknown as ForensicRecord;

describe('a post group picks the record it shows', () => {
  it('a seen-a-lot record over a passed one, in either order', () => {
    const passed = rec('passed', { verdict: 'pass' });
    const seen = rec('seen', { verdict: 'flagged', techniques: [{ name: 'repeat-exposure', severity: 6, confidence: 1 }] as never });
    expect(pickEvidenceRecord([passed, seen])?.id).toBe('seen');
    expect(pickEvidenceRecord([seen, passed])?.id).toBe('seen');
  });

  it('a flag read from the content still wins over seen a lot', () => {
    const seen = rec('seen', { verdict: 'flagged', techniques: [{ name: 'repeat-exposure', severity: 6, confidence: 1 }] as never });
    const flagged = rec('flagged', { verdict: 'flagged', techniques: [{ name: 'fear-appeal', severity: 7, confidence: 0.9 }] as never });
    expect(pickEvidenceRecord([seen, flagged])?.id).toBe('flagged');
  });
});
