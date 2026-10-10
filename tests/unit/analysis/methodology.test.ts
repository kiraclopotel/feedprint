// Export methodology block ("under what criteria was this identified,"
// specified 2026-07-02). Locks: (1) the block renders the LIVE prompt builders,
// (2) the restated thresholds cannot drift from their source constants
// (methodology.ts states them as data for bundle-weight reasons; these
// imports are the drift guard), (3) the block is JSON-serializable.

import { describe, it, expect } from 'vitest';
import { buildMethodologyBlock } from '../../../src/forensics/methodology';
import { HARM_FLOOR_TRIGGER_THRESHOLD } from '../../../src/core/harm-floor';
import { isManipulative, MANIPULATION_SEVERITY_THRESHOLD, TOPIC_LABELS } from '../../../src/analysis/comment-batch-scorer';
import { GROQ_FAST_MODEL } from '../../../src/ai/client';
import {
  JUDGE_V1_ADULT_SYSTEM,
  JUDGE_V1_FIRE_SEVERITY,
  JUDGE_V1_HIDE_SEVERITY,
  JUDGE_V1_MODEL,
} from '../../../src/ai/prompts';
import { JUDGE_V1_FAMILY_TECHNIQUE } from '../../../src/core/neutralizer';

const block = buildMethodologyBlock('9.9.9');

describe('methodology block — court-facing criteria disclosure', () => {
  it('renders the live system prompts, not copies', () => {
    expect(block.prompts.commentJudgeTeenMode).toContain('THE LITMUS');
    expect(block.prompts.commentJudgeTeenMode).toContain('13-17 year old teenager');
    expect(block.prompts.commentJudgeChildMode).toContain('8-12 year old child');
    expect(block.prompts.roomSensor).toContain('topic_labels');
    // Posts path: the age split was REVERTED on the R1 paired-run evidence
    // (2026-07-14, see prompts.ts doc block) — every mode renders the
    // measured 8-14 frame. The comments-path split above is untouched: it
    // was measured GOOD on that path (over-flag cut ~3x, 2026-06-10).
    expect(block.prompts.postJudgeChildMode).toContain('8-14 year old');
    expect(block.prompts.postJudgeTeenMode).toContain('8-14 year old');
    expect(block.prompts.rewriter.length).toBeGreaterThan(50);
    // System instructions only — the placeholder user-content never leaks in.
    expect(block.prompts.commentJudgeTeenMode).not.toContain('(post text)');
  });

  it('thresholds match their source constants (drift locks)', () => {
    expect(block.thresholds.harmFloorTrigger).toBe(HARM_FLOOR_TRIGGER_THRESHOLD);
    // severityFlagGate is the COMMENT path only: the scorer flags at >=6 and
    // passes below. The post path is the floor table, checked separately in
    // methodology-severity-floors.test.ts.
    const verdict = (severity: number) => ({
      index: 1, technique: 'shame-attack' as const, sentiment: 'negative' as const,
      severity, confidence: 0.9, reason: 'x', neutralized_text: null,
    });
    expect(block.thresholds.severityFlagGate).toBe(MANIPULATION_SEVERITY_THRESHOLD);
    expect(isManipulative(verdict(block.thresholds.severityFlagGate))).toBe(true);
    expect(isManipulative(verdict(block.thresholds.severityFlagGate - 1))).toBe(false);
    expect(block.thresholds.profanityFilterSeverity).toBe(4);
  });

  it('never restates the floor range in prose, where it drifted from the table', () => {
    // The note claimed the cells "range from 4 to 8" while the rendered line
    // one above it computed 1 to 8 from the same cells (profanity is 1). A
    // range in prose has no drift guard; the table is the only statement of it.
    const cells = Object.values(block.thresholds.postSeverityFloorByTechniqueAndMode)
      .flatMap(v => [v.child, v.teen]);
    const low = Math.min(...cells);
    const high = Math.max(...cells);
    expect(low).toBe(1);
    expect(high).toBe(8);
    // Any restated range, not only today's cells: the defect was a stale
    // pair of numbers, so a fresh stale pair must fail here too.
    expect(block.thresholds.thresholdsNote).not.toMatch(/range from \d+ to \d+/);
    expect(block.thresholds.thresholdsNote).not.toContain(`${low} to ${high}`);
  });

  it('model pins match the shipping client pin; provenance note defers to per-record stamps', () => {
    expect(block.models.textJudge).toContain(GROQ_FAST_MODEL);
    expect(block.models.modelProvenanceNote).toMatch(/per-record/i);
  });

  // The adult path. Until 2026-09-18 this block described an adult record with
  // the model, the framing and the thresholds of the child/teen post judge,
  // none of which touched it: neutralizer.ts routes every adult post to
  // JUDGE-V1 before the floor table is consulted, and JUDGE-V1 applies no
  // floor. One lock per thing the block was wrong about, plus the sentence that' sent a reader to the wrong table.
  describe('the adult reader, which is what actually judged an adult record', () => {
    it('pins the adult reader to its own model, not the feed judge', () => {
      expect(block.models.adultReader).toContain(JUDGE_V1_MODEL);
      // The whole point: the two pins are different models. A block that let
      // these converge would be back to naming one judge for both paths.
      expect(block.models.adultReader).not.toContain(GROQ_FAST_MODEL);
    });

    it('prints the adult system text verbatim, from the frozen prompt', () => {
      expect(block.prompts.adultReader).toBe(JUDGE_V1_ADULT_SYSTEM);
      // Rendered from the constant, so the five fields it asks for are there.
      expect(block.prompts.adultReader).toContain('charged');
      expect(block.prompts.adultReader).toContain('family');
      expect(block.prompts.adultReader).toContain('intent');
      // System instructions only: no placeholder user content leaks in.
      expect(block.prompts.adultReader).not.toContain('(post text)');
    });

    it('carries the cuts that gated the record, locked to their constants', () => {
      expect(block.thresholds.adultReaderFireSeverity).toBe(JUDGE_V1_FIRE_SEVERITY);
      expect(block.thresholds.adultReaderHideSeverity).toBe(JUDGE_V1_HIDE_SEVERITY);
      // Fire below hide, or the block describes a path that hides everything
      // it acts on.
      expect(block.thresholds.adultReaderFireSeverity).toBeLessThan(block.thresholds.adultReaderHideSeverity);
    });

    it('restates the family map and the fixed confidence without drifting from neutralizer', () => {
      expect(block.thresholds.adultReaderFamilyToTechnique).toEqual(JUDGE_V1_FAMILY_TECHNIQUE);
      // Every family the prompt offers has a technique, including 'none' —
      // an unmapped family would put a record on the page with no technique
      // name and no way to ask where it came from.
      for (const family of ['hostile', 'threat', 'commercial', 'body', 'profanity', 'none']) {
        expect(block.prompts.adultReader).toContain(family);
        expect(block.thresholds.adultReaderFamilyToTechnique[family]).toBeTruthy();
      }
      expect(block.thresholds.adultReaderFixedConfidence).toBe(0.9);
    });

    it('stops telling an adult reader that the floor table applied to them', () => {
      // The floor table is child and teen. Nothing in the block may say the
      // teen column is read for adult mode: that sentence is what sent a
      // reader to the wrong thresholds for fifteen days.
      const prose = [
        block.thresholds.thresholdsNote,
        block.thresholds.adultReaderNote,
        block.prompts.promptsNote,
      ].join(' ');
      expect(prose).not.toMatch(/adult mode (?:uses|reads) the teen (?:column|floor)/i);
      // And it must say, positively, how an adult record was gated.
      expect(block.thresholds.adultReaderNote).toMatch(/charged/i);
      expect(block.thresholds.adultReaderNote).toContain(String(JUDGE_V1_FIRE_SEVERITY));
      expect(block.thresholds.adultReaderNote).toContain(String(JUDGE_V1_HIDE_SEVERITY));
      // The confidence caveat is the one a lawyer needs: it is not a measure
      // of certainty on an adult record.
      expect(block.thresholds.adultReaderNote).toMatch(/fixed value/i);
      // gem 75: the note said an item "acts when charged AND severity
      // reaches" the fire threshold, as if the first judge's own reading
      // were the whole rule. It is not: a second model is asked whenever
      // the first fires, and the pair must agree before the item acts. A
      // charged, high-severity record that reads as a plain pass can be
      // exactly that disagreement, and the note must say so, or a reader
      // has no way to tell that case apart from an unexplained one.
      expect(block.thresholds.adultReaderNote).toMatch(/second model|second opinion/i);
      expect(block.thresholds.adultReaderNote).toMatch(/disagree/i);
    });
  });

  it('carries the closed topic vocabulary and the honesty framing', () => {
    expect(block.topicLabelVocabulary).toEqual(TOPIC_LABELS);
    expect(block.note).toMatch(/AI Safety Interpretation/);
    expect(block.note).toMatch(/[Ss]everity/);
    expect(block.note).toMatch(/confidence/);
    // Doctrine: never absolute-certainty language.
    expect(block.note).not.toMatch(/tamper-?proof|with certainty|proof\b/i);
  });

  // 2026-09-20: the note claimed confidence was a separate value "on every
  // record" while the threshold a few fields below it fixes one on every
  // record written by the adult reader. Found by reading the note beside
  // the threshold it describes.
  it('names the adult reader as the exception when the note describes confidence', () => {
    expect(block.note).toMatch(/Relaxed reader/i);
    expect(block.note).toMatch(/fixed/i);
    expect(block.note).not.toMatch(/how sure the model (is|was)\)? are separate values on every record/i);
    if (/how sure the model/i.test(block.note)) {
      expect(block.note).toMatch(/except/i);
    }
    expect(typeof block.thresholds.adultReaderFixedConfidence).toBe('number');
  });

  it('is plain JSON-serializable (goes into export files verbatim)', () => {
    const roundTripped = JSON.parse(JSON.stringify(block)) as typeof block;
    expect(roundTripped.prompts.commentJudgeTeenMode).toBe(block.prompts.commentJudgeTeenMode);
    expect(roundTripped.extensionVersion).toBe('9.9.9');
  });
});
