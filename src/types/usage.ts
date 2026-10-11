// UsageIncrement, AiCallUsage: the shape, with no behavior attached.
//
// It was declared in src/storage/settings.ts, and src/types/messages.ts imported it from there, which made the
// types layer depend on a layer above it (PLAN-2026-09-16 item 8.6). The module keeps its logic and
// re-exports this name, so nothing that imports it had to change.

/**
 * One successful AI call, metered the way the proxy meters it: one daily
 * call plus cost-weighted token-equivalents for the monthly cap
 * (src/storage/usage-weights.ts), so the popup's room matches the proxy's
 * counter (STORAGE-LICENCE-WORKER-3).
 */
export interface AiCallUsage {
  /** Raw prompt tokens (0 when the provider reports none). */
  inputTokens: number;
  /** Raw completion tokens. */
  outputTokens: number;
  /** The proxy's weighting of this call against the $0.10/M counter basis. */
  tokenEquivalents: number;
  provider: string;
  model?: string;
}

export type UsageIncrement =
  | ({ kind: 'ai-call' } & AiCallUsage)
  | { kind: 'neutralized' }
  | { kind: 'metrics-hidden'; by: number; byFeature?: Record<string, number> }
  // Items a page read, added to today's count for one platform (B10-1). Numbers only.
  // `commentKeys` are short one-way hashes of comments the page counted: the worker adds only those new today to
  // `comments` and keeps the set in memory (storage/read-keys.ts), so a revisit does not count them again.
  | { kind: 'items-read'; platform: string; posts: number; comments: number; videos: number; commentKeys?: string[] };
