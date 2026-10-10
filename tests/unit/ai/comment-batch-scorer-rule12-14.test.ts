// CYCLE N+4 — RULES 12 + 13 + 14 code-side enrichment lock.
//
// Validates the prompt-vs-code reconciliation: deterministic conditional
// logic for harm-floor override (Phase 1, RULE 12 partial), author-recidivism
// boost (Phase 2, RULE 13), and algorithmic-amplification room narrative
// (Phase 2, RULE 14) all live in `comment-batch-scorer.ts`. Prompt now
// only carries cross-references; runtime owns the gates.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/ai/client', () => ({
  callAI: vi.fn(),
}));

import {
  scoreBatch,
  encounterFromLegacyBatchInput,
  __resetBatchCacheForTests,
} from '../../../src/analysis/comment-batch-scorer';
import { callAI } from '../../../src/ai/client';
import { Ok } from '../../../src/ai/ai-error';

const mockCallAI = callAI as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockCallAI.mockReset();
  __resetBatchCacheForTests();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'debug').mockImplementation(() => {});
});

const llmJson = (
  comments: unknown[],
  envOverride: Record<string, unknown> = {},
) =>
  Ok(
    JSON.stringify({
      comments,
      environment: {
        label: 'healthy-discussion',
        summary: 'test',
        ...envOverride,
      },
    }),
  );

// ---------------------------------------------------------------------
// Phase 1 retention - RULE 12 partial (unchanged by cycle)
// ---------------------------------------------------------------------

describe('Phase 1 retention: identity-slur + ad-hominem override still fire', () => {
  it('identity-slur match + classifier non-flag escalates to shame-attack sev>=8 hide', async () => {
    mockCallAI.mockResolvedValue(
      llmJson([
        { index: 1, technique: 'sarcasm', sentiment: 'neutral', severity: 3, reason: 'humor' },
      ]),
    );
    const enc = encounterFromLegacyBatchInput({
      comments: [{ author: 'a', text: 'fucking nigger' }],
      videoCaption: 'caption',
      language: 'English',
    });
    const result = await scoreBatch(enc);
    expect(result.comments[0].technique).toBe('shame-attack');
    expect(result.comments[0].severity).toBeGreaterThanOrEqual(8);
    expect(result.comments[0].action).toBe('hide');
  });

  it('ad-hominem top-category + classifier non-flag at low sev escalates to shame-attack sev>=6', async () => {
    mockCallAI.mockResolvedValue(
      llmJson([
        { index: 1, technique: 'genuine-opinion', sentiment: 'neutral', severity: 2, reason: '' },
      ]),
    );
    const enc = encounterFromLegacyBatchInput({
      comments: [
        { author: 'a', text: 'idiot moron psycho jerk loser' },
      ],
      videoCaption: 'caption',
      language: 'English',
    });
    const result = await scoreBatch(enc);
    expect(result.comments[0].technique).toBe('shame-attack');
    expect(result.comments[0].severity).toBeGreaterThanOrEqual(6);
  });
});

// ---------------------------------------------------------------------
// RULE 13 - Author-recidivism boost (Phase 2)
// ---------------------------------------------------------------------

describe('RULE 13 enrichment: author-recidivism severity boost', () => {
  it('authorRecidivism=2 -> no boost (below threshold)', async () => {
    mockCallAI.mockResolvedValue(
      llmJson([
        { index: 1, technique: 'shame-attack', sentiment: 'negative', severity: 5, reason: 'a' },
        { index: 2, technique: 'shame-attack', sentiment: 'negative', severity: 5, reason: 'b' },
      ]),
    );
    const enc = encounterFromLegacyBatchInput({
      comments: [
        { author: 'recidivist', text: 'you are attack one' },
        { author: 'recidivist', text: 'you are attack two' },
      ],
      videoCaption: 'caption',
      language: 'English',
    });
    const result = await scoreBatch(enc);
    expect(result.environment.authorRecidivism).toBe(2);
    expect(result.comments[0].severity).toBe(5);
    expect(result.comments[1].severity).toBe(5);
  });

  it('authorRecidivism=3 + 2 shame-attack negative comments -> both +1 severity', async () => {
    mockCallAI.mockResolvedValue(
      llmJson([
        { index: 1, technique: 'shame-attack', sentiment: 'negative', severity: 5, reason: 'a' },
        { index: 2, technique: 'shame-attack', sentiment: 'negative', severity: 6, reason: 'b' },
        { index: 3, technique: 'genuine-opinion', sentiment: 'neutral', severity: 2, reason: '' },
      ]),
    );
    const enc = encounterFromLegacyBatchInput({
      comments: [
        { author: 'recidivist', text: 'you are attack one' },
        { author: 'recidivist', text: 'you are attack two' },
        { author: 'recidivist', text: 'you are attack three' },
      ],
      videoCaption: 'caption',
      language: 'English',
    });
    const result = await scoreBatch(enc);
    expect(result.environment.authorRecidivism).toBe(3);
    expect(result.comments[0].severity).toBe(6);
    expect(result.comments[1].severity).toBe(7);
    expect(result.comments[2].severity).toBe(2);
  });

  it('authorRecidivism=5 + genuine-opinion only -> no boost (technique gate)', async () => {
    mockCallAI.mockResolvedValue(
      llmJson([1, 2, 3, 4, 5].map((i) => ({
        index: i,
        technique: 'genuine-opinion',
        sentiment: 'neutral',
        severity: 3,
        reason: '',
      }))),
    );
    const enc = encounterFromLegacyBatchInput({
      comments: [1, 2, 3, 4, 5].map((i) => ({
        author: 'active-commenter',
        text: 'civil opinion ' + i,
      })),
      videoCaption: 'caption',
      language: 'English',
    });
    const result = await scoreBatch(enc);
    expect(result.environment.authorRecidivism).toBe(5);
    for (const c of result.comments) {
      expect(c.severity).toBe(3);
    }
  });

  it('authorRecidivism=3 + comment at sev=9 -> cap at 9 (no overflow)', async () => {
    mockCallAI.mockResolvedValue(
      llmJson([
        { index: 1, technique: 'shame-attack', sentiment: 'negative', severity: 9, reason: 'a' },
        { index: 2, technique: 'scapegoating', sentiment: 'negative', severity: 9, reason: 'b' },
        { index: 3, technique: 'shame-attack', sentiment: 'negative', severity: 8, reason: 'c' },
      ]),
    );
    const enc = encounterFromLegacyBatchInput({
      comments: [
        { author: 'recidivist', text: 'you one' },
        { author: 'recidivist', text: 'you two' },
        { author: 'recidivist', text: 'you three' },
      ],
      videoCaption: 'caption',
      language: 'English',
    });
    const result = await scoreBatch(enc);
    expect(result.comments[0].severity).toBe(9);
    expect(result.comments[1].severity).toBe(9);
    expect(result.comments[2].severity).toBe(9);
  });
});

// ---------------------------------------------------------------------
// RULE 14 - Algorithmic amplification room narrative (Phase 2)
// ---------------------------------------------------------------------

describe('RULE 14 enrichment: amplification x room-label forensic narrative', () => {
  it('amplification=high + label=pile-on -> forensicNarrative set', async () => {
    const enc = encounterFromLegacyBatchInput({
      comments: [
        { author: 'a', text: 'you attack on remi' },
        { author: 'b', text: 'you attack on remi' },
        { author: 'c', text: 'you attack on remi' },
        { author: 'd', text: 'you attack on remi' },
        { author: 'e', text: 'you attack on remi' },
      ],
      videoCaption: 'caption',
      language: 'English',
    });
    enc.post.metrics = { views: 100000, primary_likes: 100 };
    mockCallAI.mockResolvedValue(
      llmJson(
        [1, 2, 3, 4, 5].map((i) => ({
          index: i,
          technique: 'shame-attack',
          sentiment: 'negative',
          severity: 7,
          reason: 'pile-on',
        })),
        { label: 'pile-on' },
      ),
    );
    const result = await scoreBatch(enc);
    expect(result.environment.algorithmicAmplification).toBe('high');
    expect(result.environment.label).toBe('pile-on');
    expect(result.environment.forensicNarrative).toBe(
      'platform routed child to hostile environment',
    );
  });

  it('amplification=high + label=healthy-discussion -> forensicNarrative undefined', async () => {
    const enc = encounterFromLegacyBatchInput({
      comments: [
        { author: 'a', text: 'civil reply 1' },
        { author: 'b', text: 'civil reply 2' },
      ],
      videoCaption: 'caption',
      language: 'English',
    });
    enc.post.metrics = { views: 100000, primary_likes: 100 };
    mockCallAI.mockResolvedValue(
      llmJson(
        [
          { index: 1, technique: 'genuine-opinion', sentiment: 'neutral', severity: 1, reason: '' },
          { index: 2, technique: 'genuine-opinion', sentiment: 'neutral', severity: 1, reason: '' },
        ],
        { label: 'healthy-discussion' },
      ),
    );
    const result = await scoreBatch(enc);
    expect(result.environment.algorithmicAmplification).toBe('high');
    expect(result.environment.forensicNarrative).toBeUndefined();
  });

  it('amplification=low + label=pile-on -> forensicNarrative undefined', async () => {
    const enc = encounterFromLegacyBatchInput({
      comments: [
        { author: 'a', text: 'you attack' },
        { author: 'b', text: 'you attack' },
      ],
      videoCaption: 'caption',
      language: 'English',
    });
    enc.post.metrics = { views: 100, primary_likes: 50 };
    mockCallAI.mockResolvedValue(
      llmJson(
        [
          { index: 1, technique: 'shame-attack', sentiment: 'negative', severity: 6, reason: 'x' },
          { index: 2, technique: 'shame-attack', sentiment: 'negative', severity: 6, reason: 'x' },
        ],
        { label: 'pile-on' },
      ),
    );
    const result = await scoreBatch(enc);
    expect(result.environment.algorithmicAmplification).toBe('low');
    expect(result.environment.forensicNarrative).toBeUndefined();
  });

  it('amplification=unknown + label=pile-on -> forensicNarrative undefined', async () => {
    const enc = encounterFromLegacyBatchInput({
      comments: [
        { author: 'a', text: 'you attack' },
        { author: 'b', text: 'you attack' },
      ],
      videoCaption: 'caption',
      language: 'English',
    });
    mockCallAI.mockResolvedValue(
      llmJson(
        [
          { index: 1, technique: 'shame-attack', sentiment: 'negative', severity: 6, reason: 'x' },
          { index: 2, technique: 'shame-attack', sentiment: 'negative', severity: 6, reason: 'x' },
        ],
        { label: 'pile-on' },
      ),
    );
    const result = await scoreBatch(enc);
    expect(result.environment.algorithmicAmplification).toBe('unknown');
    expect(result.environment.forensicNarrative).toBeUndefined();
  });

  it('per-comment severity NEVER mutated by RULE 14 (room-label-only signal)', async () => {
    const enc = encounterFromLegacyBatchInput({
      comments: [
        { author: 'a', text: 'you attack 1' },
        { author: 'b', text: 'you attack 2' },
        { author: 'c', text: 'you attack 3' },
        { author: 'd', text: 'you attack 4' },
        { author: 'e', text: 'you attack 5' },
      ],
      videoCaption: 'caption',
      language: 'English',
    });
    enc.post.metrics = { views: 100000, primary_likes: 100 };
    mockCallAI.mockResolvedValue(
      llmJson(
        [1, 2, 3, 4, 5].map((i) => ({
          index: i,
          technique: 'shame-attack',
          sentiment: 'negative',
          severity: 4,
          reason: 'r',
        })),
        { label: 'pile-on' },
      ),
    );
    const result = await scoreBatch(enc);
    expect(result.environment.forensicNarrative).toBe(
      'platform routed child to hostile environment',
    );
    for (const c of result.comments) {
      expect(c.severity).toBe(4);
    }
  });
});

// ---------------------------------------------------------------------
// Sobolane regression baseline - proves no regex patch was added
// ---------------------------------------------------------------------

describe('Sobolane baseline (V1.5 deferred - no regex patch)', () => {
  it('Sobolane (RO dehumanization slur) classifier verdict stays at sarcasm sev=3 post-cycle', async () => {
    mockCallAI.mockResolvedValue(
      llmJson([
        { index: 1, technique: 'sarcasm', sentiment: 'neutral', severity: 3, reason: 'sarcasm' },
      ]),
    );
    const enc = encounterFromLegacyBatchInput({
      comments: [{ author: 'a', text: 'Sobolane vine frigu ha?' }],
      videoCaption: 'caption',
      language: 'Romanian',
    });
    const result = await scoreBatch(enc);
    expect(result.comments[0].technique).toBe('sarcasm');
    expect(result.comments[0].severity).toBe(3);
  });
});
