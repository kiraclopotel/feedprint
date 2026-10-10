/** @vitest-environment jsdom */
// The stored dollar figure for an AI call must be what the call cost: each direction at its own
// price, the way the meter weighs it. Averaging the prompt and completion prices and applying the
// average to every token overstates an input-heavy call, and this product's calls are input-heavy.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { utcDayKey, utcMonthKey, CURRENT_SETTINGS_SCHEMA_VERSION } from '../../../src/storage/settings';
import {
  CHAT_120B_MODEL,
  CHAT_120B_COMPLETION_RATE_PER_1M_USD,
  CHAT_120B_PROMPT_RATE_PER_1M_USD,
  CHAT_COMPLETION_RATE_PER_1M_USD,
  CHAT_PROMPT_RATE_PER_1M_USD,
  GROQ_BLENDED_RATE_PER_1M_USD,
  meteredTokenEquivalents,
} from '../../../src/storage/usage-weights';
import { installChromeStorageStub } from '../../helpers/chrome-storage';

// A typical reading: a long prompt with the instructions and the post, and a short verdict.
const PROMPT_TOKENS = 6000;
const COMPLETION_TOKENS = 150;
// The meter rounds a call up to whole token-equivalents, so the stored figure may sit this much above.
const ONE_TOKEN_EQUIVALENT_USD = GROQ_BLENDED_RATE_PER_1M_USD / 1_000_000;

function expectCost(stored: number, real: number): void {
  expect(stored).toBeGreaterThanOrEqual(real - 1e-12);
  expect(stored - real).toBeLessThanOrEqual(ONE_TOKEN_EQUIVALENT_USD);
}

async function storedCostOf(model: string): Promise<number> {
  const { state } = installChromeStorageStub({
    initial: {
      settingsSchemaVersion: CURRENT_SETTINGS_SCHEMA_VERSION,
      lastResetDate: utcDayKey(),
      lastResetMonth: utcMonthKey(),
      estimatedCostToday: 0,
      estimatedCostAllTime: 0,
    },
  });
  const { recordAiCall } = await import('../../../src/storage/settings');
  await recordAiCall({
    inputTokens: PROMPT_TOKENS,
    outputTokens: COMPLETION_TOKENS,
    tokenEquivalents: meteredTokenEquivalents(PROMPT_TOKENS, COMPLETION_TOKENS, model),
    provider: 'deepinfra',
    model,
  });
  expect(state.estimatedCostAllTime).toBe(state.estimatedCostToday);
  return state.estimatedCostToday as number;
}

describe('the stored AI cost is what the call cost', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('gpt-oss-20b: each direction at its own price', async () => {
    const real = (PROMPT_TOKENS * CHAT_PROMPT_RATE_PER_1M_USD
      + COMPLETION_TOKENS * CHAT_COMPLETION_RATE_PER_1M_USD) / 1_000_000;
    expectCost(await storedCostOf('openai/gpt-oss-20b'), real);
  });

  it('gpt-oss-120b: each direction at its own price', async () => {
    const real = (PROMPT_TOKENS * CHAT_120B_PROMPT_RATE_PER_1M_USD
      + COMPLETION_TOKENS * CHAT_120B_COMPLETION_RATE_PER_1M_USD) / 1_000_000;
    expectCost(await storedCostOf(CHAT_120B_MODEL), real);
  });
});
