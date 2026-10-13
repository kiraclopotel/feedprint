/** @vitest-environment jsdom */
//
// The page a stranger opens told them a rejected signature was a missing key,
// and for one whole class of file gave an amber verdict with no reason at all.
//
// Found 2026-09-19 by a read of the export against the checker beside it. The
// core splits a record that fell short of verified four ways, and each way
// means something different to a lawyer:
//
//   priorKey            the signing key is not in this file;
//   unsigned            the record carries no signature;
//   signatureUnverified the signature could not be checked;
//   signatureRejected   the signature WAS checked, under the key this file
//                       carries, and came back false.
//
// The in-page summary had two buckets. Anything not `unsigned` fell into the
// first, so `signatureRejected` was reported with the sentence "sit under
// signing key(s) this file does not carry: keys of earlier installs that were
// never exported" — and because that record's fingerprint IS the file's own
// key, the count of keys "this file does not carry" included the file's key.
// FORMAT.md calls that reading the sharpest edge in the document, and requires
// a checker to say those records name no key so the reading is a rotation or
// an edit and is proof of neither. The standalone .mjs checker has obeyed that
// since the day it was written. The page, which is the artefact that actually
// reaches the lawyer, had not.
//
// Separately, `carriedKey` is its own route to a partial verdict in
// verificationState and no branch printed anything for it, so a file whose
// only shortfall was a key that travelled beside the records showed
// "PARTIALLY VERIFIED" with nothing under it but a note about time stamps.
//
// These cases drive the real branch, sliced out of the page script and run
// against per-record shapes the core really returns, so a rewording that drops
// a reason fails here.

import { describe, it, expect, beforeEach } from 'vitest';
import { I18N } from '../../../src/i18n/export-strings';
import { FIXED_VERDICT_KEYS, VERIFIER_SCRIPT_TEMPLATE } from '../../../src/forensics/html-export-scripts';

type Rec = Record<string, unknown>;

/**
 * The counting loop and the partial branch, lifted from the page script and
 * run as themselves. Slicing rather than restating: a test that re-implements
 * the rule it checks proves only that the author held one opinion twice.
 */
function summarize(perRecord: Rec[]): string[] {
  const src = VERIFIER_SCRIPT_TEMPLATE;
  const from = src.indexOf('var priorKeyCount=0');
  expect(from, 'the counting loop is where the slice expects it').toBeGreaterThan(0);
  const marker = "if(carriedCount>0)summary.appendChild(el('p',null,[FIXED.chainPartialCarriedKey";
  const to = src.indexOf(marker);
  expect(to, 'the carried-key line is where the slice expects it').toBeGreaterThan(from);
  // Through the withheldNote() call that follows the carried-key line, so the
  // slice runs the same reasons a reader of a partial file would see.
  const body = src.slice(from, src.indexOf('withheldNote();', to) + 'withheldNote();'.length);

  const out: string[] = [];
  const el = (_tag: string, _attrs: unknown, kids?: string[]): string => (kids ? kids[0] : '');
  const summary = { appendChild: (t: string): void => { out.push(t); } };
  const FIXED: Record<string, string> = {};
  for (const k of FIXED_VERDICT_KEYS) FIXED[k] = I18N.en[k as keyof typeof I18N.en] as string;

  // The page's own count formatter is in scope there; the slice is given a plain one (every count here is under a thousand).
  const run = new Function('perRecord', 'el', 'summary', 'FIXED', 'state', 'fmtCount', `${body}\n}`);
  run(perRecord, el, summary, FIXED, 'partial', String);
  return out;
}

/**
 * The same slice under a green headline. The withheld note has to print there
 * too, because that is the verdict whose body sentence is the untrue one.
 */
function summarizeVerified(perRecord: Rec[]): string[] {
  const src = VERIFIER_SCRIPT_TEMPLATE;
  const from = src.indexOf('var withheldCount=0');
  expect(from, 'the withheld count is where the slice expects it').toBeGreaterThan(0);
  const body = src.slice(from, src.indexOf('};', src.indexOf('var withheldNote=function()', from)) + 2)
    + '\nwithheldNote();';
  const out: string[] = [];
  const el = (_tag: string, _attrs: unknown, kids?: string[]): string => (kids ? kids[0] : '');
  const summary = { appendChild: (t: string): void => { out.push(t); } };
  const FIXED: Record<string, string> = {};
  for (const k of FIXED_VERDICT_KEYS) FIXED[k] = I18N.en[k as keyof typeof I18N.en] as string;
  new Function('perRecord', 'el', 'summary', 'FIXED', 'fmtCount', body)(perRecord, el, summary, FIXED, String);
  return out;
}

beforeEach(() => { document.body.innerHTML = ''; });

/** The four shapes verifyOne really returns, copied from its return sites. */
const REJECTED: Rec = { ok: true, unverified: true, unverifiedSignature: true, signatureRejected: true, reason: 'signature-did-not-verify', fingerprint: 'fileOwnKey' };
const PRIOR_KEY: Rec = { ok: true, unverified: true, priorKey: true, reason: 'prior-key', fingerprint: 'oldInstall' };
const UNSIGNED: Rec = { ok: true, unverified: true, unsigned: true };
const UNCHECKABLE: Rec = { ok: true, unverified: true, unverifiedSignature: true, reason: 'signature-unverified' };
const CARRIED: Rec = { ok: true, carriedKey: true, fingerprint: 'travelled' };
const WITHHELD: Rec = { ok: true, redacted: true, markerId: 'm-1' };
const WITHHELD_UNSIGNED: Rec = { ok: true, redacted: true, markerId: 'm-2', noSignature: true };

describe('the amber verdict says why (2026-09-19)', () => {
  it('a rejected signature is not reported as a key the file does not carry', () => {
    const said = summarize([REJECTED]).join(' ');
    expect(said, 'the reader is told the signature was run').toContain('were checked and did not verify');
    expect(said, 'and not that this is an old install').not.toContain('does not carry');
    expect(said, 'nor that no signature failed').not.toContain('carry no signature');
  });

  it('the rejected sentence is the first thing under the headline', () => {
    // A file can hold both. The sharpest reading goes first, or a reader stops
    // at the softer sentence above it.
    // said[0] is the headline itself; the reasons follow it.
    const said = summarize([PRIOR_KEY, UNSIGNED, REJECTED]);
    expect(said[0], 'the headline comes first').toContain('PARTIALLY VERIFIED');
    expect(said[1]).toContain('were checked and did not verify');
    expect(said, 'and the other two are still said').toHaveLength(4);
  });

  it('a key the file really does not carry still reads that way', () => {
    // The other side of the pair: the softer sentence must survive the split,
    // or the fix has only moved the dishonesty.
    const said = summarize([PRIOR_KEY, PRIOR_KEY]).join(' ');
    expect(said).toContain('does not carry');
    expect(said, 'both records counted').toContain('2 record signature(s)');
    expect(said, 'under the one install behind them').toContain('1 signing key(s)');
  });

  it('a rejected record does not inflate the count of keys the file lacks', () => {
    // The old loop stamped `noKeyFps[pu.fingerprint]`, and a rejected record's
    // fingerprint is the file's own key, so the file counted its own key among
    // the ones it does not have.
    const said = summarize([PRIOR_KEY, REJECTED]).join(' ');
    expect(said).toContain('1 record signature(s) sit under 1 signing key(s)');
  });

  it('a signature that could not be checked is not the same sentence either', () => {
    const said = summarize([UNCHECKABLE]).join(' ');
    expect(said).toContain('could not be checked at all');
  });

  it('a key that travelled in the file is given a reason, not left silent', () => {
    // The whole finding is that this produced the headline and nothing else,
    // so the measure is the count: a headline plus exactly one reason.
    const said = summarize([CARRIED]);
    expect(said, 'the amber headline is never bare').toHaveLength(2);
    expect(said[1]).toContain('travelled inside this file');
  });

  it('a verified file with withheld records says their hash was not recomputed', () => {
    // The green body sentence reads "Every included record matched its stored
    // hash". For a withheld record the content has left the file, so nothing
    // was recomputed; the record stands on a signed redaction marker, which is
    // sound and is not what that sentence says. The standalone checker has
    // printed this since 2026-09-08 and the page printed nothing.
    const said = summarizeVerified([WITHHELD, WITHHELD]).join(' ');
    expect(said).toContain('2 record(s) had fields withheld');
    expect(said).toContain('their hash was not recomputed');
    expect(said, 'and both had a signature checked, so no second sentence').not.toContain('no signature was checked');
  });

  it('and says how many of them had no signature checked at all', () => {
    const said = summarizeVerified([WITHHELD, WITHHELD_UNSIGNED]).join(' ');
    expect(said).toContain('2 record(s) had fields withheld');
    expect(said).toContain('For 1 of those, no signature was checked');
  });

  it('a file with nothing withheld gains no sentence about it', () => {
    expect(summarizeVerified([{ ok: true }])).toHaveLength(0);
  });

  it('every interface language carries all five new sentences with their slot', () => {
    for (const locale of Object.keys(I18N) as Array<keyof typeof I18N>) {
      for (const k of ['chainPartialRejected', 'chainPartialUncheckable', 'chainPartialCarriedKey', 'chainWithheld', 'chainWithheldUnchecked'] as const) {
        const v = I18N[locale][k] as string;
        expect(typeof v, `${locale}.${k}`).toBe('string');
        expect(v, `${locale}.${k} has its count slot`).toMatch(/\{[nu]\}/);
        expect(v.length, `${locale}.${k} is a sentence`).toBeGreaterThan(40);
        // No em dashes in anything a recipient reads (house rule).
        expect(v, `${locale}.${k}`).not.toContain('—');
      }
    }
  });
});
