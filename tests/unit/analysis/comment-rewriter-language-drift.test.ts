// Language-drift contract for `validateRewriteLanguage`.
//
// Wired into the comment-batch consumer at `src/content/index.ts` so the
// BATCH V3 inline-rewrite path no longer silently lets an English rewrite
// land on a Romanian comment, as when one came back as "I strongly disagree
// with the author's views.". The fallback per-comment `neutralizeText` path already
// runs this validator internally via `src/ai/neutralize-only.ts:231`.

import { describe, it, expect } from 'vitest';
import { validateRewriteLanguage } from '../../../src/analysis/comment-rewriter';

describe('validateRewriteLanguage — reported comment language-drift regression', () => {
  it('rejects an English rewrite on a Romanian original (reported comment case)', () => {
    const englishRewrite = 'I strongly disagree with the author\'s views.';
    expect(validateRewriteLanguage(englishRewrite, 'ro')).toBe(false);
  });

  it('rejects a Romanian rewrite on an English original (symmetric)', () => {
    const romanianRewrite = 'Nu sunt de acord cu părerile autorului acestui mesaj.';
    expect(validateRewriteLanguage(romanianRewrite, 'en')).toBe(false);
  });

  it('accepts a Romanian rewrite on a Romanian original', () => {
    const romanianRewrite = 'Nu sunt de acord cu acțiunile politicienilor menționați.';
    expect(validateRewriteLanguage(romanianRewrite, 'ro')).toBe(true);
  });

  it('accepts an English rewrite on an English original', () => {
    const englishRewrite = 'I disagree with these views and find them concerning.';
    expect(validateRewriteLanguage(englishRewrite, 'en')).toBe(true);
  });

  it('tolerates short / ambiguous rewrites (no positive cross-leakage)', () => {
    // Short rewrites often lack enough signal for a confident verdict.
    // The validator's symmetric leniency accepts when detector returns
    // 'mixed' and there's no cross-language leakage.
    expect(validateRewriteLanguage('Nu.', 'ro')).toBe(true);
    expect(validateRewriteLanguage('No.', 'en')).toBe(true);
  });
});
