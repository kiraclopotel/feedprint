// The envelope never invents a line (the owner's document on the AI reading, 13 Oct 2026, page 15): an empty source prints
// its absence word, and a text the envelope cut says where and from how long.
import { describe, expect, it } from 'vitest';
import { CONTEXT_MOST_CHARS, ITEM_MOST_CHARS, envelopeForItem, renderEnvelope } from '../../../src/ai/envelope';
import type { PostContent } from '../../../src/types/post';

const bare: PostContent = {
  id: 'b1', text: '', author: '', timestamp: '2026-10-14T00:00:00.000Z', platform: 'twitter', domRef: new WeakRef({} as HTMLElement),
};

describe('the envelope states every absence', () => {
  it('an item with nothing but its place prints an absence word on every line', () => {
    expect(renderEnvelope(envelopeForItem(bare))).toBe(`ITEM
kind: post
shown: not known
media: not known
placement: ordinary
text:
no text

CONTEXT, not judged
replies to: not shown
quotes or links: not shown
top replies: not shown
reactions: not shown
surfaced first: not shown`);
  });

  it('a blank text and a blank card line are "no text" and "not shown", never an empty line', () => {
    const e = envelopeForItem({ ...bare, kind: 'reply', text: '  \n ', parentText: '   ', card: { text: '  ' } });
    expect(e.text).toBe('no text');
    expect(e.repliesTo).toBe('no text');
    expect(e.quotesOrLinks).toBe('not shown');
  });

  it('a long item is cut at the item length and says so; its words up to the cut are kept', () => {
    const long = 'word '.repeat(300).trim();
    const e = envelopeForItem({ ...bare, text: long });
    expect(ITEM_MOST_CHARS).toBe(400);
    expect(e.text).toBe(`${long.slice(0, 400)} [cut: 400 of 1,499 characters]`);
  });

  it('a long context line is cut at the context length and says so', () => {
    const parent = 'p'.repeat(250);
    const e = envelopeForItem({ ...bare, kind: 'reply', parentText: parent });
    expect(CONTEXT_MOST_CHARS).toBe(200);
    expect(e.repliesTo).toBe(`${'p'.repeat(200)} [cut: 200 of 250 characters]`);
  });

  it('a text at exactly the length is not marked cut', () => {
    const e = envelopeForItem({ ...bare, text: 'a'.repeat(400) });
    expect(e.text).toBe('a'.repeat(400));
  });

  it('a cut never splits a character outside the basic plane', () => {
    const e = envelopeForItem({ ...bare, text: '😀'.repeat(401) });
    expect(e.text).toBe(`${'😀'.repeat(400)} [cut: 400 of 401 characters]`);
  });

  it('a top reply list stops at three', () => {
    const context = ['• one', '• two', '• three', '• four'].join('\n');
    const e = envelopeForItem({ ...bare, platform: 'tiktok', kind: 'video', context });
    expect(e.topReplies).toEqual(['one', 'two', 'three']);
  });
});
