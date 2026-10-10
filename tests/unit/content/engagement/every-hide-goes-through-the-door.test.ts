/** @vitest-environment jsdom */
//
// One rule, one door.
//
// "Private surfaces are out of scope for every filter, and the gate is by DOM
// region, not by URL alone" was a standing rule written by hand in 33 places
// across 12 files. On 2026-09-19 six of those files were missing it and every
// one was shown to take something: the sidebar ad remover hid a whole chat
// log, the picker could copy the name of a private correspondent into the
// blocked list, the TikTok comment block hid a message composer over a word the
// person had typed. Three more filters that hide things had no check at all.
//
// A rule written in twelve places is a rule that twelve authors can forget.
// On 2026-09-20 it moved into `mark-hidden.ts`, which every filter already
// passed through, and the inline hiding moved in beside it as `hideElement`
// because eight callers were not reading the answer they were given.
//
// This file is the part that keeps it there. The list of filters is read from
// the directory, never from a list somebody maintains, so a filter added next
// year is checked the day it lands. Two things are held:
//
//   nothing in the engagement folder hides an element except through the door;
//   and the door really refuses inside a private conversation.
//
// Written for the owner's question of 2026-09-20 about structure: the answer to
// one rule living in many places is not to partition the tree so the copies
// cannot see each other, it is a door they all go through, and a check that
// says so when somebody walks around it.

import { describe, expect, it, beforeEach } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from '../../../helpers/repo-root';
import { hideElement, markHidden } from '../../../../src/content/engagement/mark-hidden';

const DIR = 'src/content/engagement';

/** Every filter in the folder, enumerated from the folder itself. */
function engagementFiles(): string[] {
  return readdirSync(join(REPO_ROOT, DIR))
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts'))
    .sort();
}

/** A line that makes an element disappear with an inline style. */
const HIDES = /\.style\.setProperty\(\s*'(display|visibility)'\s*,\s*'(none|hidden)'/;
/** The door, in either form; the marking form counts only when its answer is read. */
const DOOR = /hideElement\(|!markHidden\(/;

describe('every hide goes through the door (2026-09-20)', () => {
  it('there are filters to check, or this test is measuring nothing', () => {
    expect(engagementFiles().length).toBeGreaterThan(15);
  });

  it('no filter hides an element without passing through it', () => {
    const offenders: string[] = [];
    for (const file of engagementFiles()) {
      // The door itself is where the hiding is allowed to live.
      if (file === 'mark-hidden.ts') continue;
      const lines = readFileSync(join(REPO_ROOT, DIR, file), 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (!HIDES.test(line)) return;
        // A reset path puts the property back rather than taking it away.
        if (/removeProperty|unmarkHidden/.test(line)) return;
        // Look back for the door. Twelve lines covers a multi-line options
        // object with comments in it, which is the widest real case.
        const before = lines.slice(Math.max(0, i - 12), i).join('\n');
        if (DOOR.test(before)) return;
        offenders.push(`${file}:${i + 1}  ${line.trim()}`);
      });
    }
    expect(offenders, 'these hide without asking the door').toEqual([]);
  });

  describe('and the door really refuses', () => {
    beforeEach(() => { document.body.innerHTML = ''; });

    const opts = { marker: 'data-fw-test', value: 'true', reason: 'block-ads:test', count: 0 };

    it('hideElement leaves a message row alone and says it did', () => {
      document.body.innerHTML = '<div role="log"><div id="msg">see you at six</div></div>';
      const el = document.getElementById('msg') as HTMLElement;
      expect(hideElement(el, opts), 'it reports the refusal').toBe(false);
      expect(el.style.display, 'and nothing was hidden').toBe('');
      expect(el.hasAttribute('data-fw-test'), 'and nothing was marked').toBe(false);
    });

    it('markHidden leaves one alone too, so an attribute-keyed sheet cannot match it', () => {
      // The other half of the door: a filter whose stylesheet keys off the
      // marker gets the rule for free, because an unmarked element matches no
      // rule and stays visible.
      document.body.innerHTML = '<div role="dialog" aria-label="Chat with Mara"><div id="b">hi</div></div>';
      const el = document.getElementById('b') as HTMLElement;
      expect(markHidden(el, opts)).toBe(false);
      expect(el.hasAttribute('data-fw-test')).toBe(false);
    });

    it('and still hides in the feed, or the door is a wall', () => {
      document.body.innerHTML = '<div role="feed"><div id="ad">buy this</div></div>';
      const el = document.getElementById('ad') as HTMLElement;
      expect(hideElement(el, opts)).toBe(true);
      expect(el.style.display).toBe('none');
      expect(el.getAttribute('data-fw-test')).toBe('true');
    });

    it('re-hides an element a re-render stripped, which is what the eight did before', () => {
      // The marking is idempotent and the style is not: a platform can strip an
      // inline style and leave the attribute, and re-applying is how the hide
      // survives that. Moving these callers through the door must not have
      // quietly taken that away.
      document.body.innerHTML = '<div role="feed"><div id="ad">buy this</div></div>';
      const el = document.getElementById('ad') as HTMLElement;
      expect(hideElement(el, opts)).toBe(true);
      el.style.removeProperty('display');
      expect(hideElement(el, opts), 'a repeat is still a hide').toBe(true);
      expect(el.style.display).toBe('none');
    });
  });
});
