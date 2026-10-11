// FeelingWise - usage metering weights shared by the extension and the proxy
//
// The proxy meters every successful call against one per-licence counter:
// one daily call, plus cost-weighted token-equivalents against the
// $0.10 per million counter basis for the monthly cap. The extension keeps
// a local copy of that counter so the popup can show room before the proxy
// answers cap_daily or cap_monthly. Both sides must weigh a call the same
// way, or the popup shows room while the proxy is already refusing
// (STORAGE-LICENCE-WORKER-3).
//
// This file exists twice, byte for byte: src/storage/usage-weights.ts (extension)
// and worker/src/usage-weights.ts (proxy; its tsconfig cannot reach src/).
// tests/unit/usage-weights-parity.test.ts fails when they differ. Edit both.

/**
 * Counter basis: one token-equivalent is worth $0.10 per million.
 *
 * The GROQ_ in the name is historical and means nothing now: this is a unit of
 * account, not a provider's price, and it cancels out of the cap arithmetic
 * (cap = usdCap / basis, cost = tokens * rate / basis). Renaming it is its own
 * commit, after the DeepInfra move is proven live. The rates below are the
 * numbers that carry provider meaning.
 */
export const GROQ_BLENDED_RATE_PER_1M_USD = 0.10;

/**
 * openai/gpt-oss-20b prompt and completion prices.
 *
 * DeepInfra, read live 2026-09-21 from its own /models metadata, not from a
 * marketing page. Was Groq at $0.075 / $0.30 until that day; inference moved
 * because these are the same weights at a fraction of the price.
 *
 * These four numbers are not decoration. The proxy converts them into the
 * token-equivalents it meters every licence's monthly cap from, so leaving
 * them at the old provider's prices would charge every paying family about two
 * and a half times what their reading actually costs, and their EUR 6 would
 * buy them a fraction of what it should.
 */
export const CHAT_PROMPT_RATE_PER_1M_USD = 0.030;
export const CHAT_COMPLETION_RATE_PER_1M_USD = 0.14;

/**
 * openai/gpt-oss-120b, the adult judge since 2026-09-03 (DeepInfra, read live
 * 2026-09-21). No longer twice the 20b price: it is now about 1.2x either way.
 */
export const CHAT_120B_PROMPT_RATE_PER_1M_USD = 0.037;
export const CHAT_120B_COMPLETION_RATE_PER_1M_USD = 0.17;
export const CHAT_120B_MODEL = 'openai/gpt-oss-120b';

/**
 * The second judge of JUDGE-V1-PAIR (src/ai/judge-pair.ts), added 2026-09-21.
 * DeepInfra, read live that day from its own /models metadata.
 *
 * Dearer per million than either gpt-oss, and cheaper per call than the price list
 * suggests: measured over 500 items it spends 36 completion tokens against the 120b's 121,
 * and output is the dear half. It is also asked only where the first judge already fired,
 * about a tenth of items, which is what keeps the whole change near thirteen cents a month
 * for a heavy family instead of doubling the bill.
 */
export const CHAT_PAIR_PROMPT_RATE_PER_1M_USD = 0.13;
export const CHAT_PAIR_COMPLETION_RATE_PER_1M_USD = 0.38;
export const CHAT_PAIR_MODEL = 'google/gemma-4-31B-it';

/**
 * The provider's own price for one call, in token-equivalents.
 *
 * DeepInfra returns `usage.estimated_cost` on every reply and it is exact: a probe on
 * 2026-09-21 billing 56 prompt and 16 completion tokens reported 3.92e-06, which is
 * 56 x 0.030 + 16 x 0.14 per million to the digit. The provider knows what it charged;
 * the table below is this repository's copy of what it charges, kept by hand.
 */
export function costToTokenEquivalents(estimatedCostUsd: number): number {
  return Math.ceil((estimatedCostUsd / GROQ_BLENDED_RATE_PER_1M_USD) * 1_000_000);
}

/**
 * What a call actually costs the counter: the higher of this repository's table and the
 * provider's own figure.
 *
 * Why the higher and not simply the provider's. The monthly cap is a fuse: its job is to
 * stop one family running up a bill nobody agreed to, and a fuse that under-counts is not
 * a fuse. Taking the maximum means a price rise is caught the moment the provider charges
 * it, without waiting for someone to notice and edit two files, while a table that has
 * drifted low cannot quietly let spend through.
 *
 * This exists because that drift is not hypothetical. On 2026-09-21 inference moved
 * provider and for some hours the table still held the old provider's prices, which would
 * have metered every paying family at about two and a half times what their reading cost.
 * The provider was reporting the true number on every single call throughout.
 *
 * When `estimatedCostUsd` is absent, unparseable or not positive, this is exactly
 * chatTokenEquivalents and nothing changes.
 */
export function meteredTokenEquivalents(
  promptTokens: number,
  completionTokens: number,
  model?: string,
  estimatedCostUsd?: number,
): number {
  const fromTable = chatTokenEquivalents(promptTokens, completionTokens, model);
  if (typeof estimatedCostUsd === 'number' && Number.isFinite(estimatedCostUsd) && estimatedCostUsd > 0) {
    const fromUpstream = costToTokenEquivalents(estimatedCostUsd);
    // Bounded, because this is a number from someone else's server deciding when a
    // paying family gets cut off. Taking the higher of two figures is only safe while
    // the higher one is sane: a provider bug reporting an inflated cost would burn a
    // month's cap in an afternoon and refuse readings people had paid for, which is a
    // worse failure than the drift this exists to prevent. Beyond the ceiling the
    // table wins and the upstream figure is ignored rather than trusted.
    //
    // The two agree to the digit today (see the live probe pinned in
    // tests/unit/storage/ai-usage-metered-by-model.test.ts), so this ceiling sits far
    // above anything real and only catches a number that has gone wrong.
    return fromUpstream <= fromTable * UPSTREAM_COST_SANITY_CEILING
      ? Math.max(fromTable, fromUpstream)
      : fromTable;
  }
  return fromTable;
}

/**
 * How far above this repository's own table the upstream's reported cost may go before it
 * is treated as broken rather than as news. Ten times is far beyond any price change a
 * provider makes in one step and far below the runaway that would matter.
 */
export const UPSTREAM_COST_SANITY_CEILING = 10;

/** Chat: prompt and completion weighted by direction against the basis, at the model's price. */
export function chatTokenEquivalents(promptTokens: number, completionTokens: number, model?: string): number {
  // A model not named here bills at the default rates. That was safe while the default
  // was the dearest thing anyone could ask for; it is not once a dearer model exists, so
  // the pair judge is named explicitly rather than left to fall through and be metered
  // at a quarter of what it costs.
  const rates: Record<string, { prompt: number; completion: number }> = {
    [CHAT_120B_MODEL]: { prompt: CHAT_120B_PROMPT_RATE_PER_1M_USD, completion: CHAT_120B_COMPLETION_RATE_PER_1M_USD },
    [CHAT_PAIR_MODEL]: { prompt: CHAT_PAIR_PROMPT_RATE_PER_1M_USD, completion: CHAT_PAIR_COMPLETION_RATE_PER_1M_USD },
  };
  const named = model ? rates[model] : undefined;
  const promptRate = named ? named.prompt : CHAT_PROMPT_RATE_PER_1M_USD;
  const completionRate = named ? named.completion : CHAT_COMPLETION_RATE_PER_1M_USD;
  return Math.ceil(
    promptTokens * promptRate / GROQ_BLENDED_RATE_PER_1M_USD
      + completionTokens * completionRate / GROQ_BLENDED_RATE_PER_1M_USD,
  );
}

/**
 * Claude Haiku (claude-haiku-5-5), the second reader of the paid reading, on prompts of 100K tokens or fewer
 * (Anthropic's pricing page, read live 2026-10-10). One item is bounded far below that, so the dearer
 * card above it never applies. Anthropic bills four directions: plain input, input written to the
 * prompt cache, input read back from it, and output.
 */
const CLAUDE_HAIKU_INPUT_RATE_PER_1M_USD = 0.10;
const CLAUDE_HAIKU_CACHE_WRITE_RATE_PER_1M_USD = 0.125;
const CLAUDE_HAIKU_CACHE_READ_RATE_PER_1M_USD = 0.01;
const CLAUDE_HAIKU_OUTPUT_RATE_PER_1M_USD = 0.50;

/** The usage block of a Messages API answer, as Anthropic reports it. */
export interface ClaudeUsage {
  input_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  output_tokens: number;
}

/** A Claude call in token-equivalents against the same basis as every other call, at Haiku's four prices. */
export function claudeTokenEquivalents(usage: ClaudeUsage): number {
  const count = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);
  const usd = count(usage.input_tokens) * CLAUDE_HAIKU_INPUT_RATE_PER_1M_USD
    + count(usage.cache_creation_input_tokens) * CLAUDE_HAIKU_CACHE_WRITE_RATE_PER_1M_USD
    + count(usage.cache_read_input_tokens) * CLAUDE_HAIKU_CACHE_READ_RATE_PER_1M_USD
    + count(usage.output_tokens) * CLAUDE_HAIKU_OUTPUT_RATE_PER_1M_USD;
  return Math.ceil(usd / GROQ_BLENDED_RATE_PER_1M_USD);
}
