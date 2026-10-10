// Q2/W44 "detect always, rewrite on purpose" (spec: ai-pipeline.md).
//
// The reframe-rewrites feature toggle owns the calmer-rewrite spend tier.
// Detection is never feature-gated (VISION 1.1): with the toggle off, the
// judge call uses the DETECT-ONLY prompt variant (same JSON contract,
// neutralized_text always null, should_rewrite stays honest because
// judgeToCombinedShape maps should_rewrite=false to the hide tier) and the
// pipeline stamps detectionMode 'combined-detect-only'.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { childPreset, teenPreset, adultPreset } from '../../../src/storage/presets';
import {
  buildJudgeDetectNeutralizeSystem,
  buildJudgeDetectOnlySystem,
} from '../../../src/ai/prompts';
import { POPUP_STRINGS } from '../../../src/i18n/popup-strings';

const INDEX_PATH = 'src/content/post-path/result-apply.ts';
const PIPELINE_PATH = 'src/analysis/pipeline.ts';
const NEUTRALIZER_PATH = 'src/core/neutralizer.ts';

describe('presets seed reframe-rewrites ON everywhere (defaults unchanged)', () => {
  it.each([
    ['child', childPreset()],
    ['teen', teenPreset()],
    ['adult', adultPreset()],
  ])('%s preset', (_mode, preset) => {
    expect(preset['reframe-rewrites']?.enabled).toBe(true);
  });
});

describe('detect-only judge prompt variant', () => {
  const full = buildJudgeDetectNeutralizeSystem();
  const lean = buildJudgeDetectOnlySystem();

  it('actually derives (the marker replace fired)', () => {
    expect(lean).not.toBe(full);
    expect(lean).toContain('DETECT-ONLY CONFIGURATION');
    expect(lean).not.toContain('also produce the rewrite. The rewrite must:');
  });

  it('keeps the JSON contract identical (parser untouched)', () => {
    for (const field of ['"concerning"', '"should_rewrite"', '"neutralized_text"', '"severity"', '"confidence"', 'acts_on_reader']) {
      expect(lean).toContain(field);
    }
  });

  it('keeps should_rewrite honest instead of forcing it false (hide-tier mapping)', () => {
    expect(lean).toContain('answer should_rewrite honestly');
  });
});

describe('wiring (source-lock)', () => {
  const pipeline = readFileSync(join(process.cwd(), PIPELINE_PATH), 'utf8');
  const neutralizer = readFileSync(join(process.cwd(), NEUTRALIZER_PATH), 'utf8');

  it('pipeline derives the gate from the feature toggle with platform override', () => {
    expect(pipeline).toContain("isFeatureEnabled(settings, 'reframe-rewrites', post.platform)");
    expect(pipeline).toContain('rewriteEnabled: rewritesEnabled');
  });

  it('no combined return site stamps the full-call detectionMode literal anymore', () => {
    expect(pipeline.match(/detectionMode: 'combined-detect-neutralize' \}/g)).toBeNull();
    expect(pipeline).toContain("? 'combined-detect-neutralize'");
    expect(pipeline).toContain(": 'combined-detect-only'");
  });

  it('post-llm PASS results carry the judge-variant stamp end to end (W45)', () => {
    const content = readFileSync(join(process.cwd(), INDEX_PATH), 'utf8');
    expect(pipeline).toContain("...passWith('post-llm-not-manipulative', { analysis, aiMeta }), detectionMode: combinedDetectionMode");
    expect(pipeline).toContain("...passWith('post-llm-below-threshold', { analysis, aiMeta }), detectionMode: combinedDetectionMode");
    expect(content).toContain("detectionMode: result.detectionMode ?? 'combined-detect-neutralize'");
  });

  it('neutralizer selects the detect-only prompt on rewriteEnabled === false', () => {
    expect(neutralizer).toMatch(/options\?\.rewriteEnabled === false\s*\n?\s*\? buildJudgeDetectOnlySystem/);
  });
});

describe('popup strings EN/RO parity', () => {
  it('both languages carry the row strings', () => {
    expect(POPUP_STRINGS.en.reframeRewritesName.length).toBeGreaterThan(0);
    expect(POPUP_STRINGS.en.reframeRewritesDesc.length).toBeGreaterThan(0);
    expect(POPUP_STRINGS.ro.reframeRewritesName.length).toBeGreaterThan(0);
    expect(POPUP_STRINGS.ro.reframeRewritesDesc.length).toBeGreaterThan(0);
  });
});
