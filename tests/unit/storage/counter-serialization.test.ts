/** @vitest-environment jsdom */
// Q47 (wiring W52): the AI-call meter joins the serialized counter chain.
//
// It was the one bare read-modify-write among the counters: with
// MAX_CONCURRENT_PROXY_FETCHES=5 landing inside one settings-cache window,
// each call read the same totalTokensThisMonth and the last write won, so
// up to 4 of 5 calls' tokens vanished — the monthly gate fired late and
// the parent's cost display under-reported.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { utcDayKey, utcMonthKey, CURRENT_SETTINGS_SCHEMA_VERSION } from '../../../src/storage/settings';
import { installChromeStorageStub } from '../../helpers/chrome-storage';

const SETTINGS_PATH = 'src/storage/settings.ts';

function installStorageStub(initial: Record<string, unknown> = {}): { state: Record<string, unknown> } {
  // The shared stub (tests/helpers/chrome-storage.ts), without chrome.runtime.sendMessage, as this
  // file's own copy had no runtime at all: with no worker seam the write applies locally, which is
  // the serialised path under test.
  return installChromeStorageStub({ initial });
}

describe('recordAiCall — serialized counter writes (Q47)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('five concurrent calls all land (no lost update)', async () => {
    const { state } = installStorageStub({
      settingsSchemaVersion: CURRENT_SETTINGS_SCHEMA_VERSION,
      lastResetDate: utcDayKey(),
      lastResetMonth: utcMonthKey(),
      totalChecksToday: 0,
      totalChecksThisMonth: 0,
      totalChecksAllTime: 0,
      totalTokensToday: 0,
      totalTokensThisMonth: 0,
      totalTokensAllTime: 0,
      estimatedCostToday: 0,
      estimatedCostAllTime: 0,
    });
    const { recordAiCall } = await import('../../../src/storage/settings');

    await Promise.all(
      Array.from({ length: 5 }, () =>
        recordAiCall({ inputTokens: 100, outputTokens: 50, tokenEquivalents: 225, provider: 'groq', model: 'openai/gpt-oss-20b' }),
      ),
    );

    // The monthly counter is in token-equivalents (the proxy's weighting);
    // the daily and all-time tallies keep raw tokens; one call is one check.
    expect(state.totalTokensThisMonth).toBe(1125);
    expect(state.totalChecksToday).toBe(5);
    expect(state.totalTokensToday).toBe(750);
    expect(state.totalTokensAllTime).toBe(750);
  });

  it('routes through recordUsage like the sibling counters (source-lock)', () => {
    const src = readFileSync(join(process.cwd(), SETTINGS_PATH), 'utf8');
    const fn = src.match(/export function recordAiCall[\s\S]{0,300}/)?.[0] ?? '';
    expect(fn).toContain("return recordUsage({ kind: 'ai-call'");
    // And the one local writer is the serialised chain.
    const apply = src.match(/export function applyUsageIncrement[\s\S]{0,400}/)?.[0] ?? '';
    expect(apply).toContain('return serializeCounterWrite(async () => {');
  });
});
