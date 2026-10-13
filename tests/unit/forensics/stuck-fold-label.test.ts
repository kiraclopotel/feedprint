/** @vitest-environment jsdom */
// The page's "See more" button, stuck to the end of a stored text (the owner's record, read 12 Oct 2026: 2,082 of
// 2,083 cut Facebook posts, 47 of 47 cut comments and 206 of 206 cut Instagram posts end with the label). The writer
// stores the text without it; the dashboard does the same for the records written before.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/forensics/store', () => ({
  addRecord: vi.fn(async () => undefined),
  getChainState: vi.fn(async () => ({ nextPosition: 5, prevRecordHash: 'prev-hash-stub' })),
}));
vi.mock('../../../src/forensics/signing', () => ({
  signHash: vi.fn(async () => 'stub-signature'),
  getPublicKeyFingerprint: vi.fn(async () => 'stub-fp'),
}));
vi.mock('../../../src/forensics/hasher', () => ({
  sha256: vi.fn(async (s: string) => `hash-of:${s}`),
}));

import { withoutStuckFoldLabel } from '../../../src/forensics/stuck-fold-label';
import { logForensicEvent, logPassEvent, logCancelEvent } from '../../../src/forensics/logger';
import { addRecord } from '../../../src/forensics/store';
import type { AnalysisResult } from '../../../src/types/analysis';

const mockedAddRecord = vi.mocked(addRecord);
beforeEach(() => mockedAddRecord.mockReset());

const analysis: AnalysisResult = {
  postId: 'p-1',
  techniques: [],
  overallScore: 0,
  overallConfidence: 0.8,
  isManipulative: false,
  processingTimeMs: 0,
};

describe('withoutStuckFoldLabel', () => {
  it('takes "See more" off a cut Facebook post and keeps the ellipsis that says it was cut', () => {
    expect(withoutStuckFoldLabel('Three lines of a long post that Facebook cut… See more', 'facebook', 'cut'))
      .toBe('Three lines of a long post that Facebook cut…');
  });

  it('reads the label in the interface language the page was in', () => {
    expect(withoutStuckFoldLabel('Un text lung tăiat de Facebook… Vezi mai mult', 'facebook', 'cut'))
      .toBe('Un text lung tăiat de Facebook…');
    expect(withoutStuckFoldLabel('Un texto largo cortado… Ver más', 'facebook', 'cut')).toBe('Un texto largo cortado…');
    expect(withoutStuckFoldLabel('Um texto longo cortado… Ver mais', 'facebook', 'cut')).toBe('Um texto longo cortado…');
  });

  it('takes a label of several words off whatever the page called the text, when an ellipsis stands right before it', () => {
    // 14 Facebook posts the record calls whole end like this: the control was not found, the label is there all the same.
    expect(withoutStuckFoldLabel('Un text lung tăiat de Facebook… Vezi mai mult', 'facebook', 'whole'))
      .toBe('Un text lung tăiat de Facebook…');
    expect(withoutStuckFoldLabel('Un text lung tăiat de Facebook… Vezi mai mult', 'facebook', undefined))
      .toBe('Un text lung tăiat de Facebook…');
  });

  it('takes the label off a post the page cut at a line with no ellipsis, when the page found its control', () => {
    // 83 Facebook posts the record calls folded end like this.
    expect(withoutStuckFoldLabel('First paragraph of the post.\nSecond one. See more', 'facebook', 'folded'))
      .toBe('First paragraph of the post.\nSecond one.');
    expect(withoutStuckFoldLabel('First paragraph of the post.\nSecond one. See more', 'facebook', 'cut'))
      .toBe('First paragraph of the post.\nSecond one.');
  });

  it('leaves the same words alone when the page found no control and there is no ellipsis: the author may have written them', () => {
    expect(withoutStuckFoldLabel('If you want the whole story, see more', 'facebook', 'whole')).toBe('If you want the whole story, see more');
    expect(withoutStuckFoldLabel('If you want the whole story, see more', 'facebook', undefined)).toBe('If you want the whole story, see more');
  });

  it('takes "more" off a cut Instagram caption, and not off a sentence that ends on the word', () => {
    expect(withoutStuckFoldLabel('A caption the app cut… more', 'instagram', 'cut')).toBe('A caption the app cut…');
    expect(withoutStuckFoldLabel('Come and tell us more', 'instagram', 'cut')).toBe('Come and tell us more');
    expect(withoutStuckFoldLabel('Keep reading... more', 'instagram', 'whole')).toBe('Keep reading... more');
    expect(withoutStuckFoldLabel('Waiting for more', 'facebook', 'folded')).toBe('Waiting for more');
  });

  it('leaves a text that is only the label, an empty text, and a text with no label', () => {
    expect(withoutStuckFoldLabel('See more', 'facebook', 'cut')).toBe('See more');
    expect(withoutStuckFoldLabel('… See more', 'facebook', 'cut')).toBe('… See more');
    expect(withoutStuckFoldLabel('', 'facebook', 'cut')).toBe('');
    expect(withoutStuckFoldLabel('A post that ends in a full stop.', 'facebook', 'cut')).toBe('A post that ends in a full stop.');
  });

  it('touches nothing on a platform that draws its control beside the body', () => {
    for (const platform of ['twitter', 'youtube', 'tiktok'] as const) {
      expect(withoutStuckFoldLabel('A post the platform cut… See more', platform, 'cut')).toBe('A post the platform cut… See more');
    }
  });

  it('does not eat into the middle of a text', () => {
    expect(withoutStuckFoldLabel('See more of this later… and then the post goes on', 'facebook', 'cut'))
      .toBe('See more of this later… and then the post goes on');
  });

  it('drops the white space the button left behind', () => {
    expect(withoutStuckFoldLabel('A post cut here…   See more  \n', 'facebook', 'cut')).toBe('A post cut here…');
  });

  it('reads the longer label when two end the text', () => {
    // "Show more" ends with the one-word label "more": the whole label goes, not only its last word.
    expect(withoutStuckFoldLabel('A caption cut here… Show more', 'instagram', 'cut')).toBe('A caption cut here…');
  });
});

describe('the writer stores the text without the stuck label', () => {
  const stuck = 'Three lines of a long post that Facebook cut… See more';
  const clean = 'Three lines of a long post that Facebook cut…';

  it('a judged item', async () => {
    await logForensicEvent({
      originalText: stuck, neutralizedText: 'rewritten', analysis, mode: 'teen', platform: 'facebook', aiSource: 'cloud', textCapture: 'cut',
    });
    const record = mockedAddRecord.mock.calls[0][0];
    expect(record.originalText).toBe(clean);
    expect(record.originalLength).toBe(clean.length);
    expect(record.originalHash).toBe(`hash-of:${clean}`);
    expect(record.textCapture).toBe('cut');
  });

  it('a passed item', async () => {
    await logPassEvent({
      originalText: stuck, analysis, mode: 'adult', platform: 'facebook', aiSource: 'cloud', passReason: 'below-threshold', textCapture: 'cut',
    });
    expect(mockedAddRecord.mock.calls[0][0].originalText).toBe(clean);
  });

  it('an item given up before it was judged', async () => {
    await logCancelEvent({
      originalText: stuck, mode: 'teen', platform: 'facebook', verdict: 'cancelled-stale', textCapture: 'cut',
    } as Parameters<typeof logCancelEvent>[0]);
    expect(mockedAddRecord.mock.calls[0][0].originalText).toBe(clean);
  });

  it('a text on a platform whose control sits beside it is written as it came', async () => {
    await logForensicEvent({
      originalText: 'A tweet that ends in… Show more', neutralizedText: 'rewritten', analysis, mode: 'teen', platform: 'twitter', aiSource: 'cloud', textCapture: 'cut',
    });
    expect(mockedAddRecord.mock.calls[0][0].originalText).toBe('A tweet that ends in… Show more');
  });
});
