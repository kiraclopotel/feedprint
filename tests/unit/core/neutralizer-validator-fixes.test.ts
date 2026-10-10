// D-6 / D-8 — rewrite-validator over-strictness fixes.
//
// Both validators reject VALID neutralizations, which discards the rewrite and
// (pre-D-5) showed the child the original. These fixes recover the valid
// rewrites WITHOUT loosening the catastrophic guards (Path A predicate-swap and
// Path B agent-action admission must still reject).

import { describe, it, expect } from 'vitest';
import {
  detectRegisterFlattening,
  detectFalseSelfAdmissionPath,
} from '../../../src/core/neutralizer';

describe('D-8 register-flattening guard — shouting is not register to preserve', () => {
  it('does NOT reject a calm rewrite of an ALL-CAPS / "!!!" shouting original', () => {
    // Neutralization STRIPS shouting (caps + "!!!") by design — a calm rewrite
    // of a shouting original is success, not clinical flattening.
    const original = 'THIS IS THE END OF EVERYTHING AND YOU WILL ALL REGRET IGNORING THIS WARNING!!!';
    const rewrite = 'I am worried about the direction things are heading and I think we should pay closer attention.';
    expect(detectRegisterFlattening(original, rewrite)).toBe(false);
  });

  it('STILL rejects a clinically-flat rewrite that drops emphasis WORDS (real flattening)', () => {
    // Original carries intensifier register ("really", "absolutely"); a long,
    // emphasis-free rewrite is the after-school-special flatness the guard exists
    // to catch.
    const original = 'I really, absolutely, completely cannot believe they would do something so reckless to us.';
    const rewrite = 'The decision they made does not seem well considered and may have some negative consequences for the group overall.';
    expect(detectRegisterFlattening(original, rewrite)).toBe(true);
  });

  it('does not fire on short rewrites (brevity, not deliberate flattening)', () => {
    expect(detectRegisterFlattening('THIS IS INSANE!!!', 'I disagree.')).toBe(false);
  });
});

describe('D-6 false-self-admission Path B — leading discourse markers are still stance', () => {
  it('ALLOWS a valid first-person defusion that opens with a discourse marker', () => {
    // "Honestly, I disagree" is a legitimate own-view defusion; the leading
    // adverb should not make Path B reject it.
    const original = 'He is completely wrong about everything.'; // no first person
    expect(detectFalseSelfAdmissionPath(original, 'Honestly, I disagree with him.')).toBeNull();
    expect(detectFalseSelfAdmissionPath(original, 'Personally, I don\'t think that holds up.')).toBeNull();
  });

  it('STILL rejects an agent-action admission even behind a discourse marker', () => {
    // The catastrophic case: original has no first person, rewrite admits the
    // action. A leading adverb must NOT smuggle it past Path B.
    const original = 'He slapped the referee after the match.';
    expect(detectFalseSelfAdmissionPath(original, 'Honestly, I slapped the referee after the match.')).toBe('B');
  });

  it('STILL rejects a Path A predicate swap (unchanged)', () => {
    expect(detectFalseSelfAdmissionPath("You're a disgrace.", "I'm a disgrace.")).toBe('A');
  });
});
