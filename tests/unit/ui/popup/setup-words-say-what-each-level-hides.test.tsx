/** @vitest-environment jsdom */
// SETUP-WORDS (board/units/SETUP-WORDS.md; the head's pass of 12:43 and the lead's answer of 14:12): setup keeps its one-word level labels,
// and the three level lines live in Settings' level block, each saying what the level hides and one clause on what leaves.
//
// Check 1: every switch a line names as hidden is ON in that level's preset, and every line names the slurs and the own rules, which run at every level;
//          a line need not name every switch. Each line is at most 12 words.
// Check 2: what leaves. The Moderate and Relaxed lines say a fingerprint goes to time-stamp services; no line says "only", "after consent"
//          or "never"; the Strict line says "Nothing leaves this computer" ONLY when the donation sender (the last sender not gated by the
//          level) refuses at Strict and calls no fetch: F50's own check, repeated here so the sentence cannot land before the gate.
// Check 4: the Welcome keeps both limits and begins with what the person can do.
// Plus: setup's level screen has the three one-word labels and no sublabel under them.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';

import { POPUP_STRINGS } from '../../../../src/i18n/popup-strings';
import { presetForMode } from '../../../../src/storage/presets';
import { saveSettings } from '../../../../src/storage/settings';
import { donateExport, _setDonationRecipientsForTesting } from '../../../../src/forensics/donation';
import { SetupWizard } from '../../../../src/ui/popup/Popup';
import { installChromeStorageStub } from '../../../helpers/chrome-storage';
import { button, click, host, installStorage, mount, t, unmount } from '../../../helpers/popup-walk';

type Mode = 'child' | 'teen' | 'adult';
const LINE: Record<Mode, string> = {
  child: POPUP_STRINGS.en.modeExplainChildBody,
  teen: POPUP_STRINGS.en.modeExplainTeenBody,
  adult: POPUP_STRINGS.en.modeExplainAdultBody,
};
// The words a line uses for a switch (the words Settings' own rows use), and the switch each stands for.
const WORD_TO_SWITCH: [RegExp, string][] = [
  [/\bcounts\b/i, 'hide-engagement-metrics'],
  [/\bbuttons\b/i, 'hide-action-buttons'],
  [/\bcomment posting\b/i, 'block-comment-posting'],
  [/\bemoji\b/i, 'strip-emojis'],
  [/\b(tagged posts|hashtags|AI labels?)\b/i, 'block-ai-content'],
  [/\b(Reels|Shorts)\b/i, 'block-reels'],
  [/\bads\b/i, 'block-ads'],
];
const hidesSentence = (line: string) => line.split('.')[0];
const on = (mode: Mode, id: string) => (presetForMode(mode) as Record<string, { enabled: boolean } | undefined>)[id]?.enabled === true;

describe('check 1: a level line names only what the level hides, in 12 words or fewer', () => {
  for (const mode of ['child', 'teen', 'adult'] as Mode[]) {
    it(`${mode}: every switch the line names is on in the preset`, () => {
      const named = WORD_TO_SWITCH.filter(([re]) => re.test(hidesSentence(LINE[mode])));
      expect(named.length, 'the line names at least one switch').toBeGreaterThan(0);
      for (const [, id] of named) expect(on(mode, id), `${mode}: "${LINE[mode]}" names ${id}, which its preset leaves off`).toBe(true);
    });
    it(`${mode}: at most 12 words, no dash`, () => {
      expect(LINE[mode].split(/\s+/).filter(w => /[\p{L}\p{N}]/u.test(w)).length).toBeLessThanOrEqual(12);
      expect(LINE[mode]).not.toMatch(/[—–]/);
    });
  }
  // The slurs and the own rules hide at every level (word-filter.ts, decideHideRule has no level), so no line may
  // say a level hides ads and nothing more.
  it('every line names the slurs and your own words, which every level hides', () => {
    for (const m of ['child', 'teen', 'adult'] as Mode[]) {
      expect(LINE[m], m).toMatch(/slurs and your words/);
      expect(LINE[m], m).not.toMatch(/nothing more/i);
    }
  });
});

describe('check 2: what leaves', () => {
  it('Moderate and Relaxed say a fingerprint goes to time-stamp services', () => {
    for (const m of ['teen', 'adult'] as Mode[]) expect(LINE[m], m).toMatch(/fingerprint[^.]*time-stamp services/i);
  });
  it('no line says only, after consent or never', () => {
    for (const m of ['child', 'teen', 'adult'] as Mode[]) expect(LINE[m], m).not.toMatch(/\b(only|after consent|never)\b/i);
  });

  describe('the Strict sentence waits for the gate (F50)', () => {
    beforeEach(() => installChromeStorageStub({ initial: { mode: 'child', levelChosen: true } }));
    afterEach(() => { _setDonationRecipientsForTesting(null); vi.restoreAllMocks(); });
    it('"Nothing leaves this computer" is on the Strict line only if donateExport refuses at Strict and calls no fetch', async () => {
      if (!/nothing leaves this computer/i.test(LINE.child)) return; // no promise on screen, nothing to hold
      await saveSettings({});
      _setDonationRecipientsForTesting([{ id: 'x', name: 'X', endpoint: 'https://donate.example.org/r', noticeUrl: 'https://example.org/n' }]);
      const fetchSpy = vi.fn();
      const record = { id: 'r1' } as never;
      const out = await donateExport([record], { included: [record], totalSource: 1, excludedUnreviewed: 0, excludedLowConfidence: 0, excludedNonDetection: 0 } as never, 'en', { fetch: fetchSpy, buildDocument: vi.fn(async () => '<html></html>') });
      expect(out).toEqual({ kind: 'refused', reason: 'strict' });
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });
});

describe('check 4 and setup: the Welcome and the level screen', () => {
  beforeEach(() => installStorage());
  afterEach(unmount);

  it('the Welcome begins with what the person can do and keeps both limits, on every path', async () => {
    await mount(createElement(SetupWizard, { onComplete: () => {} }));
    const text = host.textContent ?? '';
    // Before anything else, which browser Receipts goes on: a computer other people use, or your own.
    expect(text.indexOf(t.setupWelcomePurpose)).toBeGreaterThan(-1);
    expect(text.indexOf(t.setupWelcomePurpose)).toBeLessThan(text.indexOf(t.setupWelcomeBody1));
    expect(t.setupWelcomePurpose).toMatch(/other people use/);
    expect(t.setupWelcomePurpose).toMatch(/your own/);
    expect(t.setupWelcomeBody2.startsWith('You can confirm or dispute')).toBe(true);
    expect(text).toContain(t.setupWelcomeBody2);
    expect(t.setupWelcomeBody2).toMatch(/misses things/);
    expect(t.setupWelcomeBody2).toMatch(/makes mistakes/);
    expect(text, 'the "60 seconds" line is gone').not.toMatch(/60 seconds/);
  });

  it('the level screen keeps three one-word labels, none picked, with no sublabel under them', async () => {
    await mount(createElement(SetupWizard, { onComplete: () => {} }));
    await click(button(t.beginSetup));
    const buttons = Array.from(host.querySelectorAll<HTMLElement>('.mode-btn'));
    expect(buttons.map(b => b.textContent?.trim())).toEqual([t.modeChild, t.modeTeen, t.modeAdult]);
    for (const b of buttons) {
      expect(b.getAttribute('role')).toBe('radio');
      expect(b.getAttribute('aria-checked')).toBe('false');
      expect(b.querySelector('.age'), 'no sublabel').toBeNull();
    }
    const lines = host.querySelector('[data-testid="setup-level-lines"]')?.textContent ?? '';
    for (const line of [t.setupLevelChildLine, t.setupLevelTeenLine, t.setupLevelAdultLine]) expect(lines).toContain(line);
    expect(host.querySelector('[data-testid="setup-level-line"]'), 'no level line before a level is picked').toBeNull();
  });

  // The page-part switches are Off's, so a level in Receipts changes swearing, the PIN and what leaves the computer,
  // not the rest of the page. The screen says so, and shows the chosen level's line from Settings.
  it('says what a level changes, and shows the chosen level\'s line', async () => {
    expect(t.setupWhoTitle).not.toMatch(/filter/i);
    // Each level's line starts with its name and says what it sends out and what it locks.
    expect(t.setupLevelChildLine.startsWith(`${t.modeChild}:`)).toBe(true);
    expect(t.setupLevelTeenLine.startsWith(`${t.modeTeen}:`)).toBe(true);
    expect(t.setupLevelAdultLine.startsWith(`${t.modeAdult}:`)).toBe(true);
    expect(t.setupLevelChildLine).toMatch(/sends nothing/i);
    expect(t.setupLevelChildLine).toMatch(/swearing/);
    expect(t.setupLevelChildLine).toMatch(/locks the settings with a PIN/);
    expect(t.setupLevelTeenLine).toMatch(/fingerprint/);
    expect(t.setupLevelTeenLine).toMatch(/locks the settings with a PIN/);
    expect(t.setupLevelAdultLine).toMatch(/fingerprint/);
    expect(t.setupLevelAdultLine).toMatch(/sets no PIN/);
    await mount(createElement(SetupWizard, { onComplete: () => {} }));
    await click(button(t.beginSetup));
    await click(button(t.modeChild));
    expect(host.querySelector('[data-testid="setup-level-line"]')?.textContent).toContain(t.modeExplainChildBody);
    await click(button(t.modeAdult));
    expect(host.querySelector('[data-testid="setup-level-line"]')?.textContent).toContain(t.modeExplainAdultBody);
  });
});
