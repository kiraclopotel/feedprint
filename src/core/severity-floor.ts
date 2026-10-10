// In core because both products read it: the free filter's AI-content blocker as well as the
// recorder. src/analysis/comment-batch-scorer.ts re-exports it.

/**
 * Below this a manipulation verdict does not flag, and the comment goes to PASS_LOG. The research
 * corpus runner imports it through the scorer. Two files keep their own 6 instead of importing it:
 * harness-common.ts in the research harness, which must load before any extension code, and
 * scripts/build-demo-export.ts, which runs outside the extension bundle. Change both with this one.
 */
export const MANIPULATION_SEVERITY_THRESHOLD = 6;
