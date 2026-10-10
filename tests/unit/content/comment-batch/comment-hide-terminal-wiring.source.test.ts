import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readSource } from '../../../helpers/read-source';
import { repoPath } from '../../../helpers/repo-root';

const FLUSH_PATH = 'src/content/comment-batch/flush.ts';
const LEGACY_PIPELINE_PATH = 'src/content/post-path/video-pipeline.ts';
const source = readSource(FLUSH_PATH);
const legacySource = readSource(LEGACY_PIPELINE_PATH);

describe('M60 comment hide terminal wiring', () => {
  it('routes every flushBatch hide producer through the shared applied-outcome terminal', () => {
    // Three since 2026-09-07: the swear mask never hides, so the profanity block
    // no longer produces a hide (docs/design/POLICY-TABLE-2026-09-07.md).
    expect(source.match(/recordCommentHideOutcome\(/g)).toHaveLength(3);
    expect(source).not.toContain('pendingHides');
  });

  it('does not predeclare a hidden forensic outcome before DOM application', () => {
    expect(source).not.toMatch(/analysis:\s*\{[^\n]*action:\s*'hide'/);
    expect(source).toContain('action: recordedCommentHideAction(hideApplied)');
  });

  it('re-applies the prior verdict at both text-dedup skips instead of uncovering the duplicate', () => {
    // The gate key is the item (platform, id, text) since 2026-09-13 (C5).
    const skips = source.match(/if \(hasLoggedForensic\(forensicDedupKey\(post\)\)\) \{\s*reapplyDuplicateTextVerdict\(post, protectionsToRetain\);\s*continue;/g);
    expect(skips).toHaveLength(2);
    expect(source).not.toMatch(/if \(hasLoggedForensic\(forensicDedupKey\(post\)\)\) continue;/);
  });

  it('an encounter-builder or scoreBatch throw keeps Child covers, unmarks, and records internal-error (PROTECTION-PATH-4)', () => {
    const block = source.match(/encounter constructor or scoreBatch threw[\s\S]{0,2500}?\r?\n  \}\r?\n/)?.[0] ?? '';
    expect(block).toContain('unmarkPostsForReExtraction(bucket.posts)');
    expect(block).toMatch(/if \(settings\.mode === 'child'\) \{\s*for \(const post of bucket\.posts\) protectionsToRetain\.add\(post\);/);
    expect(block).toContain("verdict: 'cancelled-batch-llm-failure'");
    expect(block).toContain("failureKind: 'internal-error'");
  });

  it('keeps the Child cover when a hide target cannot be proven', () => {
    expect(source).toContain("if (settings.mode === 'child') protectionsToRetain.add(post)");
  });

  it('keeps the legacy comment pipeline unique-target and outcome honest', () => {
    expect(legacySource).toContain('applyUniquePreRewriteHide(hide, entries, notice)');
    expect(legacySource).toContain('action: recordedCommentHideAction(hideApplied)');
    expect(legacySource).not.toContain('entries.find(e => e.text === hide.raw.text)');
  });
});

describe('M61 comment rewrite record follows the terminal outcome', () => {
  it('no rewrite record is written before the swap loop runs', () => {
    // The flagged path writes an immediate record only for the mark-only case
    // (no rewrite); a produced rewrite rides on the swap and is recorded by
    // what the terminal returns.
    expect(source).not.toMatch(/neutralizedText:\s*rewrite \|\| ''/);
    expect(source).toMatch(/if \(!rewrite\) \{\s*void sendHighStakesForensicLog\(/);
    expect(source).toContain("record: { sharedFields: item.sharedFields, analysisLike: item.analysisLike }");
    // The mask (2026-09-07) rides the same swap with its own detectionMode and
    // rules provenance; the record still waits for the terminal.
    expect(source).toContain("detectionMode: 'profanity-mask',");
    expect(source).toContain("decision: decisionForMask(settings.mode),");
    expect(source).toContain("analysisLike: baseAnalysis,");
  });

  // Three terminals, three records (2026-09-19). This case used to assert
  // "a hide for a hidden terminal and the rewrite otherwise", which is the
  // defect written down as an expectation: 'unresolved' means the in-place
  // swap did not land, and it was sharing the rewrite record. The chain then
  // said a soften had been shown to the reader while the original comment was
  // still on the page, under a line whose own comment reads "the chain hears
  // what happened, not what was attempted".
  it('the swap loop writes a different record for each of the three terminals, once per swap', () => {
    const idx = source.indexOf("const terminal = applyCommentRewriteTerminal(entry, swap.rewrite, settings.mode,");
    expect(idx).toBeGreaterThan(-1);
    // The last argument is the writer the page's AI mark names, which a landed rewrite's record names too.
    expect(source.slice(idx, idx + 600)).toContain(
      "sendSwapRecord(swap, terminal === 'hidden' ? 'hidden' : terminal === 'rewritten' ? 'rewrite' : 'unresolved', markedWriter(entry, swap))",
    );
    expect(source).toContain("action: recordedCommentHideAction(true)");
    expect(source).toContain("if (recordedSwaps.has(swap)) return;");
  });

  it('a swap that never reached the page says so, in the vocabulary the decision block already had', () => {
    // applied: 'allow' plus a failed rewrite makes decisionForLegacy set
    // NOTE_NOT_APPLIED, "the page could not apply the action; the item stayed
    // as the record says under applied". It was written for this and was not
    // reachable from here until now.
    expect(source).toContain("outcome === 'unresolved'");
    expect(source).toMatch(/neutralizedText: '',[\s\S]{0,400}?'allow',[\s\S]{0,120}?outcome: 'failed'/);
  });

  it('a swear mask never takes the hide fallback the rewrite path has', () => {
    // Both kinds ride one pendingSwaps array. Without a word for the
    // difference a mask that failed to land hid the comment, which the swear
    // policy in this same file says never happens: "a comment that only swears
    // is never hidden".
    expect(source).toContain("kind?: 'rewrite' | 'mask';");
    expect(source).toContain("kind: 'mask',");
    expect(source).toContain("settings.mode, swap.kind !== 'mask', swap.writer)");
  });

  it('a swap abandoned before the loop is not recorded as a rewrite either', () => {
    // The stale-batch path and the skipped-swap path both run through here,
    // and neither of them touched the page.
    expect(source).toContain("for (const swap of pendingSwaps) sendSwapRecord(swap, 'unresolved');");
  });

  it('a batch that goes stale before the swap loop still writes every deferred record', () => {
    // One since 2026-09-07: the mask block has no await, so a batch cannot go
    // stale inside it; the room-record await after it keeps its guard.
    expect(source.match(/if \(!batchIsCurrent\(\)\) \{ flushDeferredSwapRecords\(\); return; \}/g)).toHaveLength(1);
    // And swaps the loop skipped (no element, stale post, a throw) are written after it.
    const loopEnd = source.indexOf('flushDeferredSwapRecords();', source.indexOf('const terminal = applyCommentRewriteTerminal('));
    expect(loopEnd).toBeGreaterThan(-1);
  });
});
