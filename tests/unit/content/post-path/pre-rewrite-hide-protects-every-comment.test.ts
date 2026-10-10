// A logging gate must never decide whether the product acts (2026-09-18).
//
// `applyPreRewriteHides` opened its loop with `if (!shouldLogForensic(hide.raw.text)) continue;`.
// Two faults in one line, found by an adversarial read of the capture path.
//
// The one that costs a reader: `shouldLogForensic` is the FORENSIC gate, the
// thing that stops a duplicate ROW being written, and the `continue` skipped the
// hide along with the row. So the second comment carrying the same words as one
// already hidden this session stayed on the page. On a child install that is the
// protection failing silently, on exactly the content the product judged worth
// hiding.
//
// The one that costs the record: every other caller of that gate passes
// `forensicDedupKey(post)`, which is platform, id and text. This one passed the
// bare text, so two DIFFERENT people writing the same words collapsed to one
// entry, and it also wrote text-shaped keys into the shared session set that no
// key-shaped lookup could ever match again.
//
// What holds now: the hide runs first and unconditionally, and the record is
// deduplicated on the comment's own identity.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { forensicDedupKey, shouldLogForensic } from '../../../../src/content/record/forensic-gate';

const source = readFileSync(join(process.cwd(), 'src/content/post-path/video-pipeline.ts'), 'utf8');

/** The loop body, from the `for (const hide of hides)` to the end of the function. */
function hideLoopSource(): string {
  const start = source.indexOf('for (const hide of hides) {');
  expect(start, 'the hide loop is still in this file').toBeGreaterThan(-1);
  return source.slice(start, start + 2600);
}

// The gate's set is module state with no reset, so every case below uses its
// own strings rather than sharing one and depending on the order they run in.
describe('the hide is applied before anything is deduplicated', () => {
  it('applies the hide before the forensic gate is consulted at all', () => {
    const loop = hideLoopSource();
    const hideAt = loop.indexOf('applyUniquePreRewriteHide(');
    const gateAt = loop.indexOf('shouldLogForensic(');
    expect(hideAt, 'the loop still applies the hide').toBeGreaterThan(-1);
    expect(gateAt, 'the loop still gates the record').toBeGreaterThan(-1);
    expect(
      hideAt,
      'the forensic gate is being consulted before the hide is applied, so a comment the product '
      + 'judged worth hiding can be left on the page because a RECORD for the same words already exists',
    ).toBeLessThan(gateAt);
  });

  it('never passes the bare comment text to the gate', () => {
    const loop = hideLoopSource();
    expect(loop).not.toContain('shouldLogForensic(hide.raw.text)');
    expect(loop).toContain('forensicDedupKey(');
  });

  it('falls back to the author and the time when the platform gave no comment id', () => {
    // The case this exists for is two different people writing the same words,
    // and those two differ in the author even when there is no id.
    const loop = hideLoopSource();
    expect(loop).toContain('hide.raw.commentId');
    expect(loop).toContain('hide.raw.authorHandle');
    expect(loop).toContain('hide.raw.timestamp');
  });
});

describe('the record gate tells two people writing the same words apart', () => {
  it('lets both through when the comments differ by id', () => {
    const words = 'case one, the exact same sentence twice';
    const first = forensicDedupKey({ platform: 'youtube', id: 'Ugx-comment-1', text: words });
    const second = forensicDedupKey({ platform: 'youtube', id: 'Ugx-comment-2', text: words });
    expect(first).not.toBe(second);
    expect(shouldLogForensic(first)).toBe(true);
    expect(shouldLogForensic(second)).toBe(true);
  });

  it('lets both through when there is no id and the authors differ', () => {
    const words = 'case two, the exact same sentence twice';
    const first = forensicDedupKey({ platform: 'youtube', id: '@ana@2026-09-18T04:00:00Z', text: words });
    const second = forensicDedupKey({ platform: 'youtube', id: '@user_b@2026-09-18T04:01:00Z', text: words });
    expect(first).not.toBe(second);
    expect(shouldLogForensic(first)).toBe(true);
    expect(shouldLogForensic(second)).toBe(true);
  });

  it('still stops the SAME comment being recorded twice, which is what the gate is for', () => {
    const words = 'case three, the exact same sentence twice';
    const key = forensicDedupKey({ platform: 'youtube', id: 'Ugx-comment-9', text: words });
    expect(shouldLogForensic(key)).toBe(true);
    expect(shouldLogForensic(key)).toBe(false);
  });

  it('the old key collapsed two different people into one, which is the defect', () => {
    // Kept as the statement of what was wrong: the bare text is the same string
    // for both comments, so the second one was refused.
    const words = 'case four, the exact same sentence twice';
    expect(shouldLogForensic(words)).toBe(true);
    expect(shouldLogForensic(words)).toBe(false);
  });
});
