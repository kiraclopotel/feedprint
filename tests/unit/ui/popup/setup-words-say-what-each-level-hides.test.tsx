/** @vitest-environment jsdom */
// SETUP-WORDS: setup keeps its one-word level labels (Silent, Calm, Open), and each level has one sentence that says
// what happens to a flagged post, shown on the setup screen under the chosen level.
//
// Check 1: each sentence says what a flagged post does (arrives rephrased or as written), names the dot the level shows
//          (none, green, red), names no age, and is at most 24 words.
// Check 2: what leaves. The welcome line says a fingerprint goes to time-stamp services at Calm and Open; no level sentence says "only", "after consent"
//          or "never"; a sentence that says "Nothing leaves this computer" does so ONLY when the donation sender (the last sender not gated by the
//          level) refuses at Silent and calls no fetch: F50's own check, repeated here so the sentence cannot land before the gate.
// Check 4: the Welcome keeps both limits and begins with what the person can do.
// Plus: setup's level screen has the three one-word labels and no sublabel under them.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';

import { POPUP_STRINGS } from '../../../../src/i18n/popup-strings';
import { saveSettings } from '../../../../src/storage/settings';
import { donateExport, _setDonationRecipientsForTesting } from '../../../../src/forensics/donation';
import { SetupWizard } from '../../../../src/ui/popup/Popup';
import { installChromeStorageStub } from '../../../helpers/chrome-storage';
import { button, click, host, installStorage, mount, t, unmount } from '../../../helpers/popup-walk';

type Mode = 'child' | 'teen' | 'adult';
const LINE: Record<Mode, string> = {
  child: POPUP_STRINGS.en.levelSentenceChild,
  teen: POPUP_STRINGS.en.levelSentenceTeen,
  adult: POPUP_STRINGS.en.levelSentenceAdult,
};
const ARRIVES: Record<Mode, RegExp> = {
  child: /^A flagged post arrives rephrased\b/,
  // Calm shows a flagged post as the page drew it until the reading answers (only Silent covers it,
  // content/protection/child-first-protection.ts), so its sentence says as written (14 Oct 2026, the open board's R063).
  teen: /^A flagged post arrives as written\b/,
  adult: /^A flagged post arrives as written\b/,
};
const DOT: Record<Mode, RegExp> = { child: /\bno dot\b/, teen: /\bgreen dot\b/, adult: /\bred dot\b/ };
const AGE_WORD = /\b(child|children|kids?|teen|teens|teenagers?|adults?|parents?)\b/i;

describe('check 1: a level sentence says what a flagged post does and which dot it shows, names no age, in 24 words or fewer', () => {
  for (const mode of ['child', 'teen', 'adult'] as Mode[]) {
    it(`${mode}: starts with what a flagged post does and names its dot`, () => {
      expect(LINE[mode]).toMatch(ARRIVES[mode]);
      expect(LINE[mode]).toMatch(DOT[mode]);
    });
    it(`${mode}: names no age`, () => {
      expect(LINE[mode]).not.toMatch(AGE_WORD);
    });
    it(`${mode}: at most 24 words, no dash`, () => {
      expect(LINE[mode].split(/\s+/).filter(w => /[\p{L}\p{N}]/u.test(w)).length).toBeLessThanOrEqual(24);
      expect(LINE[mode]).not.toMatch(/[—–]/);
    });
  }
});

describe('check 2: what leaves', () => {
  it('the welcome line says a fingerprint goes to time-stamp services, and that Silent without a key sends nothing at all', () => {
    expect(POPUP_STRINGS.en.setupWelcomeBody1).toMatch(/Only a fingerprint[^.]*time-stamp services[^.]*; Silent without a key sends nothing at all\./);
  });
  it('no line says only, after consent or never', () => {
    for (const m of ['child', 'teen', 'adult'] as Mode[]) expect(LINE[m], m).not.toMatch(/\b(only|after consent|never)\b/i);
  });

  describe('the Silent sentence waits for the gate (F50)', () => {
    beforeEach(() => installChromeStorageStub({ initial: { mode: 'child', levelChosen: true } }));
    afterEach(() => { _setDonationRecipientsForTesting(null); vi.restoreAllMocks(); });
    it('"Nothing leaves this computer" is on the Silent line only if donateExport refuses at Silent and calls no fetch', async () => {
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
    // Each level's line starts with its name and says what the person sees on a post.
    expect(t.setupLevelChildLine.startsWith(`${t.modeChild}:`)).toBe(true);
    expect(t.setupLevelTeenLine.startsWith(`${t.modeTeen}:`)).toBe(true);
    expect(t.setupLevelAdultLine.startsWith(`${t.modeAdult}:`)).toBe(true);
    expect(t.setupLevelChildLine).toMatch(/no dot/);
    expect(t.setupLevelChildLine).toMatch(/swearing masked/);
    expect(t.setupLevelTeenLine).toMatch(/green dot/);
    expect(t.setupLevelAdultLine).toMatch(/red dot/);
    await mount(createElement(SetupWizard, { onComplete: () => {} }));
    await click(button(t.beginSetup));
    await click(button(t.modeChild));
    expect(host.querySelector('[data-testid="setup-level-line"]')?.textContent).toContain(t.levelSentenceChild);
    await click(button(t.modeAdult));
    expect(host.querySelector('[data-testid="setup-level-line"]')?.textContent).toContain(t.levelSentenceAdult);
  });
});
