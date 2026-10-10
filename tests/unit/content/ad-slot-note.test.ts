// @vitest-environment jsdom
//
// The one line left in an Instagram ad's kept box (hide-primitives.ts noteAdSlot).
// The box's height is Instagram's own measurement and must not move: the
// note is absolutely positioned and the box only gains position:relative,
// which it gives back on removal.

import { describe, expect, it } from 'vitest';
import { noteAdSlot, removeAdSlotNote, AD_SLOT_NOTE_ATTR } from '../../../src/content/hide-primitives';

describe('noteAdSlot', () => {
  it('adds one absolutely positioned line, once, and gives the box position:relative', () => {
    const box = document.createElement('article');
    document.body.appendChild(box);
    noteAdSlot(box, 'An ad was here.');
    noteAdSlot(box, 'An ad was here.');
    const notes = box.querySelectorAll(`:scope > [${AD_SLOT_NOTE_ATTR}]`);
    expect(notes).toHaveLength(1);
    expect((notes[0] as HTMLElement).style.position).toBe('absolute');
    expect((notes[0] as HTMLElement).style.visibility).toBe('visible');
    expect(box.style.position).toBe('relative');
    expect(box.getAttribute('data-fw-prev-position')).toBe('');
  });

  it('leaves a box that already positions itself alone, and removal restores everything', () => {
    const box = document.createElement('article');
    box.style.position = 'sticky';
    document.body.appendChild(box);
    noteAdSlot(box, 'x');
    expect(box.style.position).toBe('sticky');
    expect(box.hasAttribute('data-fw-prev-position')).toBe(false);
    removeAdSlotNote(box);
    expect(box.querySelector(`[${AD_SLOT_NOTE_ATTR}]`)).toBeNull();
    expect(box.style.position).toBe('sticky');

    const plain = document.createElement('article');
    document.body.appendChild(plain);
    noteAdSlot(plain, 'x');
    removeAdSlotNote(plain);
    expect(plain.style.position).toBe('');
    expect(plain.hasAttribute('data-fw-prev-position')).toBe(false);
  });
});
