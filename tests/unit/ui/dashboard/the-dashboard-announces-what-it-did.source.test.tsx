/** @vitest-environment jsdom */
//
// The other half of the 18 September accessibility audit.
//
// That audit found ten places in the popup where the result of the user's own
// action was written to the screen and to nobody else: plain divs with no ARIA
// role, so a screen reader user who was not looking at the exact pixel that
// changed never learned what happened. It built StatusLine, wrapping role
// status and role alert, and it fixed the popup.
//
// It did not reach this tab, which holds the four most consequential buttons in
// the product: Export receipts, Restore, Donate, Back up now. Their results sat
// in plain divs and a plain span until 2026-09-19.
//
// And the dialog that wipes the chain had no focus trap and no focus restore.
// popup/controls.tsx says so in its own comment, written a day after that
// dialog, as its reason for building both: it added them "because that model
// does not have them either". It was right and it was never carried back.
//
// This file reads the source text and does not run the components, which is
// what the .source. in its name says and why the name is there: the tests-shape
// guard refuses an unnamed source-text test under tests/unit, and it caught
// this one before it landed.
//
// So be clear about what a green run here earns. It proves the role is written
// and the trap is wired. It does not prove the rendered DOM carries the role,
// which export-tab-receipts.test.tsx covers for the receipt line by rendering
// it, and it does not prove the wording is useful once announced, which is a
// reading and not a check.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT as ROOT } from '../../../helpers/repo-root';

const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

describe('the dashboard announces what it did (2026-09-19)', () => {
  const exportTab = read('src/ui/dashboard/components/ExportTab.tsx');

  it('routes every action result through the one component that carries a role', () => {
    // Each of these is the result of a button the parent pressed.
    for (const msg of ['{error}', '{exportMsg}', '{donateMsg.text}', '{restoreMsg}', '{folderMsg}']) {
      const at = exportTab.indexOf(msg);
      expect(at, `${msg} is still rendered somewhere`).toBeGreaterThan(-1);
      // The element that opens closest above it is the one that wraps it.
      const before = exportTab.slice(Math.max(0, at - 400), at);
      const lastOpen = before.lastIndexOf('<');
      const tag = before.slice(lastOpen).match(/^<([A-Za-z]+)/)?.[1];
      expect(tag, `${msg} is announced, not written to nobody`).toBe('StatusLine');
    }
  });

  it('an error is assertive and a confirmation is polite', () => {
    expect(exportTab).toContain('<StatusLine tone="alert"');
    expect(exportTab).toContain("tone={donateMsg.ok ? 'status' : 'alert'}");
  });

  it('keeps the data hooks the plain divs carried, so a swap does not break a check elsewhere', () => {
    // It happened on the first swap: the receipt line carries this and a test
    // looks for it, and StatusLine dropped it until it was taught to pass it on.
    expect(exportTab).toContain('data-fw-export-receipt="1"');
    const statusLine = read('src/ui/shared/StatusLine.tsx');
    expect(statusLine, 'and only data- attributes, never role or aria from outside')
      .toContain("k.startsWith('data-')");
  });
});

describe('the dialog that wipes the chain holds the keyboard (2026-09-19)', () => {
  const modal = read('src/ui/dashboard/components/ResetChainConfirmModal.tsx');
  const pinOverlay = read('src/ui/popup/controls.tsx');

  it('traps Tab inside the panel', () => {
    expect(modal, 'a ref to trap within').toContain('panelRef');
    expect(modal, 'the same selector the popup gate uses')
      .toContain('button:not([disabled]), input:not([disabled])');
    expect(modal).toContain('e.preventDefault()');
  });

  it('gives focus back to whatever opened it', () => {
    expect(modal).toContain('previouslyFocused');
    expect(modal).toContain('previouslyFocused.current?.focus?.()');
  });

  it('still closes on Escape, which it always did', () => {
    expect(modal).toContain("e.key === 'Escape'");
  });

  it('matches the gate that named this dialog as the one without them', () => {
    // Not a copy check: both must hold the rule, and the popup is where it was
    // written down first.
    for (const needle of ['panelRef', 'previouslyFocused', "e.key !== 'Tab'"]) {
      expect(pinOverlay, `the popup gate still has ${needle}`).toContain(needle);
      expect(modal, `and so does the reset dialog: ${needle}`).toContain(needle);
    }
  });
});
