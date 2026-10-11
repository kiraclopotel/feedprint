// The paid reading's Claude reader has one switch: the consent for the second company, stored for the
// key. A refusal that will not change within the hour (a cap, a missing feature, a refused key, a relay
// not configured) is remembered, so the next flagged items get the same stamp without a call, and the
// popup can say that Claude stopped first; a reading clears it. Nothing here reaches a live endpoint.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { installChromeStorageStub } from '../../helpers/chrome-storage';
import { CURRENT_SETTINGS_SCHEMA_VERSION, utcDayKey, utcMonthKey } from '../../../src/storage/settings';

const VERDICT = { charged: true, family: 'hostile', severity: 5, effect: 'recruit', intent: 'react' };
const CLAUDE_PROVIDER = 'Example Claude Provider, EU';

function storedSettings(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    settingsSchemaVersion: CURRENT_SETTINGS_SCHEMA_VERSION, lastResetDate: utcDayKey(), lastResetMonth: utcMonthKey(),
    fw_license_key: 'fw-starter-abc12345', dailyCap: 2500, totalChecksToday: 0, totalTokensThisMonth: 0,
    ...extra,
  };
}

async function withConsent(): Promise<void> {
  const rc = await import('../../../src/storage/reading-consent');
  await rc.recordReadingConsent(rc.bearerOf({ tier: 'starter', secret: 'abc12345' }), 'the words shown', CLAUDE_PROVIDER, new Date(), 'claude');
}

function relay(status: number, body: unknown) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  }));
}

const ITEM = { text: 'They are all clowns.', platform: 'x', kind: 'comment' };

beforeEach(() => {
  vi.resetModules();
  installChromeStorageStub({ initial: storedSettings(), sendMessage: () => undefined });
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('the switch', () => {
  it('is off with a key and no consent for the second company', async () => {
    const { claudeReadingOn } = await import('../../../src/ai/claude-reader');
    expect(await claudeReadingOn()).toBe(false);
  });

  it('is on with a paid key and the consent', async () => {
    await withConsent();
    const { claudeReadingOn } = await import('../../../src/ai/claude-reader');
    expect(await claudeReadingOn()).toBe(true);
  });

  it('is off for a free install even with a stored consent', async () => {
    await withConsent();
    installChromeStorageStub({ initial: storedSettings({ fw_license_key: '' }), sendMessage: () => undefined });
    vi.resetModules();
    const { claudeReadingOn } = await import('../../../src/ai/claude-reader');
    expect(await claudeReadingOn()).toBe(false);
  });

  it('the pipeline reads the consent, not a hidden flag, and the flag is gone', () => {
    const pipeline = readFileSync(new URL('../../../src/analysis/pipeline.ts', import.meta.url), 'utf8');
    expect(pipeline).toContain('await claudeReadingOn()');
    expect(pipeline).not.toContain("isFlagOn('claudeReading')");
    const flags = readFileSync(new URL('../../../src/storage/feature-flags.ts', import.meta.url), 'utf8');
    expect(flags).not.toContain('claudeReading');
  });
});

describe('a refusal that holds', () => {
  it('a monthly cap is stamped as paused-monthly, the next item gets the stamp with no call, and the marker says until when', async () => {
    await withConsent();
    const calls = relay(429, { error: { message: 'Monthly limit reached', code: 'cap_monthly' } });
    const { askClaudeReader, CLAUDE_PAUSE_STORAGE_KEY } = await import('../../../src/ai/claude-reader');
    expect((await askClaudeReader(ITEM)).outcome).toBe('paused-monthly');
    expect((await askClaudeReader(ITEM)).outcome).toBe('paused-monthly');
    expect(calls).toHaveBeenCalledTimes(1);
    const marker = (await chrome.storage.local.get([CLAUDE_PAUSE_STORAGE_KEY]))[CLAUDE_PAUSE_STORAGE_KEY] as { reason: string; until: string };
    expect(marker.reason).toBe('paused-monthly');
    expect(Date.parse(marker.until)).toBeGreaterThan(Date.now());
  });

  it('a daily cap holds until the next UTC day', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-11T20:00:00.000Z'), toFake: ['Date'] });
    await withConsent();
    relay(429, { error: { message: 'Daily limit reached', code: 'cap_daily' } });
    const { askClaudeReader, CLAUDE_PAUSE_STORAGE_KEY } = await import('../../../src/ai/claude-reader');
    expect((await askClaudeReader(ITEM)).outcome).toBe('paused-daily');
    const marker = (await chrome.storage.local.get([CLAUDE_PAUSE_STORAGE_KEY]))[CLAUDE_PAUSE_STORAGE_KEY] as { until: string };
    expect(marker.until).toBe('2026-10-12T00:00:00.000Z');
  });

  it('the relay near its own Claude cap, a missing feature and a refused key hold too, each under its own name', async () => {
    for (const [status, code, outcome] of [[429, 'claude_paused_near_cap', 'paused-near-cap'], [403, 'feature_missing', 'no-feature'], [401, 'invalid_license', 'key-refused'], [503, 'claude_not_configured', 'not-configured']] as const) {
      vi.resetModules();
      installChromeStorageStub({ initial: storedSettings(), sendMessage: () => undefined });
      await withConsent();
      const calls = relay(status, { error: { message: 'x', code } });
      const { askClaudeReader } = await import('../../../src/ai/claude-reader');
      expect((await askClaudeReader(ITEM)).outcome).toBe(outcome);
      expect((await askClaudeReader(ITEM)).outcome).toBe(outcome);
      expect(calls).toHaveBeenCalledTimes(1);
      calls.mockRestore();
    }
  });

  it('a timeout, a refusal and an unusable answer do not hold: the next item is asked again', async () => {
    await withConsent();
    const calls = relay(502, { error: { message: 'x', code: 'claude_refused' } });
    const { askClaudeReader } = await import('../../../src/ai/claude-reader');
    expect((await askClaudeReader(ITEM)).outcome).toBe('refused');
    expect((await askClaudeReader(ITEM)).outcome).toBe('refused');
    expect(calls).toHaveBeenCalledTimes(2);
  });

  it('a reading clears the hold and removes the marker', async () => {
    await withConsent();
    const calls = vi.spyOn(globalThis, 'fetch');
    calls.mockImplementationOnce(async () => new Response(JSON.stringify({ error: { message: 'x', code: 'cap_monthly' } }), { status: 429, headers: { 'Content-Type': 'application/json' } }));
    const { askClaudeReader, CLAUDE_PAUSE_STORAGE_KEY } = await import('../../../src/ai/claude-reader');
    expect((await askClaudeReader(ITEM)).outcome).toBe('paused-monthly');
    // The hour passes: the next call goes out and reads.
    vi.useFakeTimers({ now: Date.now() + 61 * 60 * 1000, toFake: ['Date'] });
    calls.mockImplementationOnce(async () => new Response(JSON.stringify({ verdict: VERDICT, reader: { model: 'claude-haiku-5-5', provider: 'anthropic', judge: 'd83cd0253c1c' } }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    expect((await askClaudeReader(ITEM)).outcome).toBe('read');
    expect((await chrome.storage.local.get([CLAUDE_PAUSE_STORAGE_KEY]))[CLAUDE_PAUSE_STORAGE_KEY]).toBeUndefined();
    expect(calls).toHaveBeenCalledTimes(2);
  });
});
