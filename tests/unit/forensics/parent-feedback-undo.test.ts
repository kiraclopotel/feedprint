// Wiring audit 13 Sep, D1-29: a Confirm or Dispute can be taken back by pressing
// the button that is on. The store removes the parent's annotation (never a
// record); the dashboard routes a second press of the same answer to it.

import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

vi.mock('../../../src/forensics/signing', () => ({
  signHash: vi.fn(async () => undefined),
  getPublicKeyFingerprint: vi.fn(async () => undefined),
}));

describe('parent feedback undo', () => {
  it('removes the answer, and leaves other records\' answers alone', async () => {
    const store = await import('../../../src/forensics/store');
    await store.addParentFeedback('r-1', 'confirmed');
    await store.addParentFeedback('r-2', 'disputed');
    await store.removeParentFeedback('r-1');
    const all = await store.getAllParentFeedback();
    expect(all.has('r-1')).toBe(false);
    expect(all.get('r-2')?.feedback).toBe('disputed');
  });

  it('the dashboard takes the answer back when the same button is pressed again, and the card says so', () => {
    const dash = readFileSync('src/ui/dashboard/Dashboard.tsx', 'utf8');
    const handler = dash.slice(dash.indexOf('const onParentFeedback = async'), dash.indexOf('const handleConfirm'));
    expect(handler).toContain('if (parentFeedback.get(recordId)?.feedback === kind) {');
    expect(handler.indexOf('await removeParentFeedback(recordId);')).toBeLessThan(handler.indexOf('await addParentFeedback(recordId, kind);'));
    const card = readFileSync('src/ui/dashboard/components/FeedCard.tsx', 'utf8');
    expect(card.match(/t\.feedUndoAnswerTip/g)?.length).toBe(2);
  });
});
