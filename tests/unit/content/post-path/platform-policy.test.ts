// Per-platform product rules — src/content/post-path/platform-policy.ts.
//
// The behavior tests below are real. The wiring assertion at the bottom is a
// SOURCE GUARD, not a behavior proof: the branch lives inside a module-private
// function with no unit harness, so the cheap thing that catches the actual
// regression (someone deletes the gate) is to assert the call site still
// references the shared rule.

import { describe, it, expect } from 'vitest';
import { repoPath } from '../../../helpers/repo-root';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { shouldRecordTextlessVideoPass } from '../../../../src/content/post-path/platform-policy';
import type { Platform } from '../../../../src/types/post';
import type { PassReason } from '../../../../src/analysis/pipeline';

const RESULT_APPLY_PATH = 'src/content/post-path/result-apply.ts';

const ALL_PLATFORMS: Platform[] = ['twitter', 'facebook', 'instagram', 'tiktok', 'youtube'];

describe('shouldRecordTextlessVideoPass — text-less video still enters the chain', () => {
  const TEXTLESS: PassReason[] = ['pre-llm-too-short', 'pre-llm-non-substantive'];

  it('records tiktok and youtube video when there was no text to judge', () => {
    for (const reason of TEXTLESS) {
      expect(shouldRecordTextlessVideoPass('tiktok', reason)).toBe(true);
      expect(shouldRecordTextlessVideoPass('youtube', reason)).toBe(true);
    }
  });

  it('excludes the post-feed platforms, whose posts carry text by construction', () => {
    for (const reason of TEXTLESS) {
      expect(shouldRecordTextlessVideoPass('twitter', reason)).toBe(false);
      expect(shouldRecordTextlessVideoPass('facebook', reason)).toBe(false);
      expect(shouldRecordTextlessVideoPass('instagram', reason)).toBe(false);
    }
  });

  // Measured 2026-08-02: an unlicensed /watch run logged the watch session
  // reaching the pipeline and leaving by the free-tier door, writing no record.
  it('records a YouTube watch session on free tier, where no text AI runs at all', () => {
    expect(shouldRecordTextlessVideoPass('youtube', 'pre-llm-free-tier-no-ai')).toBe(true);
  });

  it('does NOT extend the free-tier arm to tiktok, which would record every free-tier video', () => {
    expect(shouldRecordTextlessVideoPass('tiktok', 'pre-llm-free-tier-no-ai')).toBe(false);
    expect(shouldRecordTextlessVideoPass('instagram', 'pre-llm-free-tier-no-ai')).toBe(false);
  });

  // The honesty boundary: content that was never assessed must not acquire a
  // benign pass record, on any platform.
  it('writes nothing when the content was never assessed', () => {
    const NEVER_ASSESSED: PassReason[] = ['pre-llm-cap-exhausted', 'pre-llm-ai-call-failed'];
    for (const reason of NEVER_ASSESSED) {
      for (const platform of ALL_PLATFORMS) {
        expect(shouldRecordTextlessVideoPass(platform, reason)).toBe(false);
      }
    }
  });

  it('leaves cache-pass and every post-llm reason to their own record paths', () => {
    const ELSEWHERE: PassReason[] = [
      'pre-llm-cache-pass',
      'post-llm-not-manipulative',
      'post-llm-below-threshold',
      'post-llm-no-neutralization',
    ];
    for (const reason of ELSEWHERE) {
      for (const platform of ALL_PLATFORMS) {
        expect(shouldRecordTextlessVideoPass(platform, reason)).toBe(false);
      }
    }
  });
});

describe('wiring guards (source assertions, not behavior proofs)', () => {
  const resultApply = readFileSync(repoPath(...RESULT_APPLY_PATH.split(String.fromCharCode(47))), 'utf8');

  it('the pre-LLM pass branch reads the shared text-less rule, in both record branches', () => {
    // writesTextlessRoomRecord wraps shouldRecordTextlessVideoPass (PLAN-2026-09-15 item 6).
    expect(resultApply.match(/writesTextlessRoomRecord\(post, result\.passContext\.reason\)/g)?.length).toBe(2);
    expect(resultApply).not.toMatch(/post\.platform === 'tiktok'\s*\n?\s*&& post\.kind === 'video'/);
  });
});
