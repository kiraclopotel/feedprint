// §CT-13 (2026-05-04) — comment-batch scorer prompt-parity contract.
//
// Locks the public-figure / group-vs-individual / register / quote-frame /
// when-in-doubt rules added to bring the batch-scorer prompt to parity
// with the COMBINED prompt's documented rules. Pre-§CT-13 the batch-scorer
// lacked these rules entirely, causing 8b to over-flag Romanian political
// grievance comments as shame-attack / fear-appeal / scapegoating
// (a 2026-05-04 evening audit found multiple false positives in screenshots).
//
// These tests are PROMPT-CONTENT regressions: any future edit that removes
// the rules will fail the test. The test does NOT assert classification
// behavior (that requires a live LLM); it asserts the rules ARE in the
// prompt the LLM receives.

import { describe, it, expect } from 'vitest';
import { buildBatchPrompt } from '../../../src/analysis/comment-batch-scorer';

const minimalInput = {
  comments: [{ author: 'u1', text: 'sample comment text' }],
  videoCaption: 'sample caption',
  language: 'Romanian',
};

describe('§CT-13 — comment-batch scorer prompt-parity rules', () => {
  it('contains PUBLIC FIGURE exclusion rule (Rule 1)', () => {
    const { system } = buildBatchPrompt(minimalInput);
    // Key terms that must be present so 8b sees the exclusion.
    expect(system).toMatch(/PUBLIC[- ]FIGURE/i);
    expect(system).toMatch(/political/i);
    expect(system).toMatch(/genuine-opinion/i);
    // V3 (2026-05-15) reframes "NEVER tag as fear-appeal/shame-attack/..."
    // as "are FAIR GAME for harsh language" — same imperative direction,
    // role-based phrasing.
    expect(system).toMatch(/FAIR GAME for harsh[^\n]*language|NEVER tag (it )?as/i);
  });

  it('mentions specific public-figure categories that must NOT be tagged', () => {
    const { system } = buildBatchPrompt(minimalInput);
    // The categories the rule names — politicians, government, parties, etc.
    expect(system).toMatch(/politicians/i);
    expect(system).toMatch(/government/i);
    expect(system).toMatch(/parties/i);
    expect(system).toMatch(/corporations/i);
  });

  it('contains GROUP vs INDIVIDUAL targeting rule (Rule 2)', () => {
    const { system } = buildBatchPrompt(minimalInput);
    // V3 dropped the "GROUP vs INDIVIDUAL" heading; the substance is split
    // across the scapegoating POSITIVE TRIGGER (ethnic/religious/national
    // group + generalization) and the shame-attack POSITIVE TRIGGER, which
    // now requires the target be a PERSON PRESENT (reader / another
    // commenter), not a public figure or absent third party. Lock both pieces.
    expect(system).toMatch(/scapegoating/i);
    expect(system).toMatch(/ETHNIC/i);
    expect(system).toMatch(/PERSON PRESENT|private (person|individual)/i);
    // Public-figure / public-discourse exclusion remains in the DO NOT FLAG
    // PUBLIC-FIGURE ... CRITIQUE block.
    expect(system).toMatch(/PUBLIC[- ]FIGURE[^\n]*CRITIQUE/i);
  });

  it('explicitly handles collective national self-criticism', () => {
    const { system } = buildBatchPrompt(minimalInput);
    // The "ce popor de nebuni suntem" example was the false-positive found
    // in that 2026-05-04 audit's screenshot 4: collective self-criticism
    // mis-tagged as shame-attack on the audience.
    // §CT-37.G compression broke "Collective national self-criticism" across
    // a line wrap at prompts-v2.ts:578-579 ("Collective\nnational self-
    // criticism"); regex now matches across whitespace.
    expect(system).toMatch(/Collective[\s\S]*?national self-criticism|collective[\s\S]*?self/i);
  });

  it('contains REGISTER rule explicitly mentioning Romanian (Rule 3)', () => {
    const { system } = buildBatchPrompt(minimalInput);
    expect(system).toMatch(/REGISTER/i);
    expect(system).toMatch(/Romanian/i);
    expect(system).toMatch(/affectionate hyperbole|hyperbole/i);
  });

  it('contains QUOTE FRAME rule (Rule 4) — §CT-18 wording assertion against v2 delegation', () => {
    const { system } = buildBatchPrompt(minimalInput);
    expect(system).toMatch(/QUOTE FRAME/i);
    // §CT-18 — buildBatchPrompt now delegates to buildBatchPromptV2 (per
    // CURRENT.md §CT-18). v2 RULE 4 expresses "quoting" semantics via
    // "Bare attribution with no outer endorsement" rather than the literal
    // word "quoting". Either phrasing satisfies the rule's intent.
    expect(system).toMatch(/quoting|Bare attribution|outer endorsement/i);
  });

  it('contains precision-leaning default bias', () => {
    const { system } = buildBatchPrompt(minimalInput);
    // V3 says "Default to 'genuine-opinion' / 'neutral' / 'none' when
    // uncertain" instead of the V2 literal "WHEN IN DOUBT". Both are
    // expressions of the same precision-leaning bias; lock either phrase.
    expect(system).toMatch(/when uncertain|WHEN IN DOUBT/i);
    expect(system).toMatch(/PRECISION OVER RECALL/i);
    expect(system).toMatch(/False positives erode parent trust/i);
  });

  it('contains POSITIVE TRIGGERS section enumerating real-flag conditions', () => {
    const { system } = buildBatchPrompt(minimalInput);
    expect(system).toMatch(/POSITIVE TRIGGERS/i);
    // Ethnic group + biological generalization example
    expect(system).toMatch(/biological/i);
    // Audience-directed catastrophic claim (not against public figures)
    expect(system).toMatch(/AT the audience/i);
  });

  it('refines hostile-crowd label to exclude pure political grievance rooms', () => {
    const { system } = buildBatchPrompt(minimalInput);
    // The room-label section should explicitly say political grievance ≠ hostile-crowd
    expect(system).toMatch(/hostile-crowd/);
    expect(system).toMatch(/political grievance|political critique/i);
    // §CT-18 — v2 wording is "without coordinated attacks"; v1 had
    // "without coordinated personal attacks". Either phrasing locks the
    // exclusion-of-pile-on-from-polarized intent.
    expect(system).toMatch(/without coordinated (personal )?attacks/i);
  });

  it('preserves existing technique enum (no regression on technique list)', () => {
    const { system } = buildBatchPrompt(minimalInput);
    // The technique-list line must still include all original techniques.
    const required = [
      'fear-appeal', 'shame-attack', 'anger-trigger',
      'bandwagon', 'fomo', 'scapegoating', 'toxic-positivity',
      'misleading-format', 'pile-on', 'mockery', 'sarcasm',
      'genuine-opinion', 'supportive', 'neutral', 'off-topic', 'none',
    ];
    for (const t of required) {
      expect(system).toContain(t);
    }
  });

  it('preserves user template structure (numbered comments + post text)', () => {
    // §CT-26f — buildBatchPrompt now constructs an Encounter and the user
    // prompt emits POST_ENVIRONMENT + per-comment compact lines per
    // GROQ_PROMPT_ARCHITECTURE §4.1. Old "Post caption:" / "1. @alice: ..."
    // format replaced by "Post text: ..." / "1. by @user_B (...): "..."", where the
    // label stands in for the handle.
    const { user } = buildBatchPrompt({
      comments: [
        { author: 'alice', text: 'first comment' },
        { author: 'bob', text: 'second comment' },
      ],
      videoCaption: 'video caption text',
      language: 'English',
    });
    expect(user).toContain('[POST_ENVIRONMENT]');
    expect(user).toContain('Post text: "video caption text"');
    expect(user).toContain('[COMMENTS]');
    expect(user).toMatch(/1\. by @user_B [^\n]*"first comment"/);
    expect(user).toMatch(/2\. by @user_C [^\n]*"second comment"/);
  });
});
