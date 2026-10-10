// The page disabled its own verify button and, on two paths, never gave it back.
//
// `runVerification` disables the button at the top so a reader cannot start a
// second run over the first. The manifest-failure path hands it back and so
// does the success path. Two others did not: the key-setup catch and the catch
// around the record loop both rendered a FAILED band and returned with the
// button still disabled, so a reader whose browser hiccuped mid-check was left
// with a red verdict and no way to try again short of reloading the file. On a
// 2.3 MB export that a lawyer has been sent, "reload the file" is not obvious
// advice, and the red band is not a true reading of the records.
//
// Beside it, the record-loop catch printed the key-setup sentence, which names
// a malformed key or a fingerprint that does not match the declared one, over
// a failure that happened while hashing records long after the key had been
// accepted and used.
//
// Found 2026-09-19 by a read of the export against the checker. Both are fixed
// in the shared failure renderer: it hands the button back, and the caller says
// which sentence to print.
//
// This is a source read, because the behaviour lives inside a script held as a
// template literal and the thing worth locking is that no failure path can
// return without the button.

import { describe, expect, it } from 'vitest';
import { I18N } from '../../../src/i18n/export-strings';
import { VERIFIER_SCRIPT_TEMPLATE } from '../../../src/forensics/html-export-scripts';

/** The body of runVerification, where the button is disabled and handed back. */
function runVerificationBody(): string {
  const src = VERIFIER_SCRIPT_TEMPLATE;
  const from = src.indexOf('async function runVerification(){');
  expect(from, 'runVerification is where this expects it').toBeGreaterThan(0);
  return src.slice(from, src.indexOf('\n  async function', from + 10) + 1 || undefined);
}

/** True when the shared failure renderer really does hand the button back. */
function rendererHandsBack(): boolean {
  const src = VERIFIER_SCRIPT_TEMPLATE;
  const from = src.indexOf('function renderVerifierSetupFailure(');
  if (from < 0) return false;
  const body = src.slice(from, src.indexOf('\n  }', from));
  return body.includes("document.getElementById('fw-verify-btn')") && body.includes('btn.disabled=false;');
}

describe('the check hands the button back (2026-09-19)', () => {
  it('the shared failure renderer re-enables the button', () => {
    const src = VERIFIER_SCRIPT_TEMPLATE;
    const from = src.indexOf('function renderVerifierSetupFailure(');
    expect(from).toBeGreaterThan(0);
    const body = src.slice(from, src.indexOf('\n  }', from));
    expect(body, 'it looks the button up itself').toContain("document.getElementById('fw-verify-btn')");
    expect(body, 'and hands it back').toContain('btn.disabled=false;');
  });

  it('every failure path goes through that renderer or re-enables on its own', () => {
    // The measure that would have caught the defect: count the returns inside
    // runVerification that are not preceded by a hand-back. Each `return;`
    // there ends the check, so each one must leave the button usable.
    const body = runVerificationBody();
    const returns = [...body.matchAll(/\n\s*return;/g)];
    expect(returns.length, 'there are early returns to account for').toBeGreaterThan(0);
    for (const m of returns) {
      const before = body.slice(Math.max(0, m.index - 260), m.index);
      // Going through the renderer only counts while the renderer really does
      // it. The first draft of this case took the call as proof, and passed
      // against a renderer with the hand-back deleted.
      const handsBack = before.includes('btn.disabled=false;')
        || (before.includes('renderVerifierSetupFailure(') && rendererHandsBack());
      expect(handsBack, `a return at offset ${m.index} leaves the button disabled`).toBe(true);
    }
  });

  it('the record loop does not blame the key for a failure that came later', () => {
    const body = runVerificationBody();
    expect(body, 'the record loop names its own reason').toContain('FIXED.failReasonCheckStopped');
    // The key-setup sentence still belongs to the key-setup catch, which is the
    // only place those causes are true.
    expect(body.match(/renderVerifierSetupFailure\(/g)?.length, 'both catches use the renderer').toBe(2);
  });

  it('the new sentence exists in every language and does not claim a verdict', () => {
    for (const locale of Object.keys(I18N) as Array<keyof typeof I18N>) {
      const s = I18N[locale].failReasonCheckStopped;
      expect(typeof s, `${locale}`).toBe('string');
      expect(s.length, `${locale} is a sentence`).toBeGreaterThan(60);
      expect(s, `${locale}`).not.toContain('—');
    }
  });

  it('the unreachable chain-link sentence is gone and its guard says less', () => {
    // verifyChain has one exit and it is always ok:true, so no record ever
    // failed for a chain-link reason; the sentence sat in the position a new
    // reason would land in, ready to print a specific wrong cause.
    const src = VERIFIER_SCRIPT_TEMPLATE;
    expect(src).not.toContain('failReasonChainLinkMismatch');
    expect(src).toContain('FIXED.failReasonUnnamed');
    for (const locale of Object.keys(I18N) as Array<keyof typeof I18N>) {
      const s = I18N[locale].failReasonUnnamed;
      expect(s.length, `${locale} is a sentence`).toBeGreaterThan(60);
    }
  });
});
