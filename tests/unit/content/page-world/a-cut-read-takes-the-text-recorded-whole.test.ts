// @vitest-environment jsdom
//
// A reel recorded whole and then read again cut (the Tester's recheck, 12 Oct 2026, Instagram NASA reel): first from the Reels view
// with its whole caption (272 characters), then on the reel's own page after three scrolls, where the caption folds, cut at 37
// characters with an ellipsis. Nothing carried the first text across, so the record of the second read was a fragment.
// The text this device recorded for an item is now kept for the item and completes a later cut read of it.

import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from '../../../helpers/repo-root';
import {
  clearWireStore, enrichPostFromWire, rememberRecordedText, rememberWireItem, wireFieldsFor,
} from '../../../../src/content/page-world/wire-store';
import type { PostContent } from '../../../../src/types/post';

const WHOLE = 'Two hundred and seventy-two characters of a caption about a telescope image, with the date, the place and the people behind it, written long enough that the page folds it at the first line.';
const CUT = 'Two hundred and seventy-two charac… more';

function reel(over: Partial<PostContent>): PostContent {
  return {
    id: 'DeTUk4sDSp-', text: WHOLE, author: 'nasa', timestamp: '2026-10-12T09:11:16.000Z', platform: 'instagram',
    kind: 'video', parentVideoId: 'DeTUk4sDSp-', feedSource: 'unknown', ...over,
  } as unknown as PostContent;
}

beforeEach(() => { clearWireStore(); document.body.innerHTML = ''; });

describe('a text this device recorded for an item completes a later cut read of it', () => {
  it('the cut read takes the whole text, and the record says it was not read off this screen', () => {
    rememberRecordedText(reel({ textCapture: 'whole' }));
    const second = reel({ text: CUT, textCapture: 'cut' });
    expect(enrichPostFromWire(second)).toContain('text');
    expect(second.text).toBe(WHOLE);
    expect(second.textCapture).toBe('platform');
  });

  it('works when the page did not say it cut the text, as long as the text ends in an ellipsis', () => {
    rememberRecordedText(reel({ textCapture: 'whole' }));
    const second = reel({ text: CUT, textCapture: undefined });
    enrichPostFromWire(second);
    expect(second.text).toBe(WHOLE);
  });

  it('a text the page itself cut is never kept as if it were whole', () => {
    rememberRecordedText(reel({ text: CUT, textCapture: 'cut' }));
    expect(wireFieldsFor('instagram', 'DeTUk4sDSp-')).toBeUndefined();
  });

  it('a different reel is not completed from this one', () => {
    rememberRecordedText(reel({ textCapture: 'whole' }));
    const other = reel({ id: 'DzzOther123', text: CUT, textCapture: 'cut' });
    expect(enrichPostFromWire(other)).not.toContain('text');
    expect(other.text).toBe(CUT);
  });

  it('a cut that is not the start of the recorded text is left as it was', () => {
    rememberRecordedText(reel({ textCapture: 'whole' }));
    const different = reel({ text: 'A different caption that was changed by its author since… more', textCapture: 'cut' });
    enrichPostFromWire(different);
    expect(different.text).toContain('A different caption');
  });

  it('a comment is not kept', () => {
    rememberRecordedText(reel({ kind: 'comment', textCapture: 'whole' }));
    expect(wireFieldsFor('instagram', 'DeTUk4sDSp-')).toBeUndefined();
  });

  it('keeps the longer of two records and only the text, so it adds no author, media or paid flag of its own', () => {
    rememberRecordedText(reel({ text: WHOLE.slice(0, 120), textCapture: 'whole', is_sponsored: true, mediaUrls: ['https://cdn.example/a.jpg'] }));
    rememberRecordedText(reel({ textCapture: 'whole' }));
    const held = wireFieldsFor('instagram', 'DeTUk4sDSp-');
    expect(held?.text).toBe(WHOLE);
    expect(held?.author).toBeUndefined();
    expect(held?.isSponsored).toBeUndefined();
    expect(held?.mediaUrls).toBeUndefined();
  });

  it('what the platform sent and what was recorded meet: the longer wins', () => {
    rememberWireItem(reel({ text: WHOLE + ' And a last line only the platform had.' }));
    rememberRecordedText(reel({ textCapture: 'whole' }));
    expect(wireFieldsFor('instagram', 'DeTUk4sDSp-')?.text).toContain('only the platform had');
  });
});

describe('the page keeps the text at the one door every detected post goes through', () => {
  it('rememberRecordedText runs in onPostDetected after the fold is stamped, so a cut text is told from a whole one', () => {
    const src = readFileSync(join(REPO_ROOT, 'src/content/index.ts'), 'utf8');
    const stamp = src.indexOf('stampTextFold(post);');
    const remember = src.indexOf('rememberRecordedText(post);');
    expect(stamp).toBeGreaterThan(0);
    expect(remember).toBeGreaterThan(stamp);
    expect(src.indexOf('enrichPostFromWire(post)')).toBeLessThan(stamp);
  });
});
