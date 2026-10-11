// The licence probe keeps the second company's name (the paid reading's Claude reader) beside the
// first, from the header the relay sets only while its Claude route is configured. Nothing in the
// build holds either name, so a build never has to know who reads, and a name the relay stops
// serving stops being offered.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeStorageStub } from '../../helpers/chrome-storage';
import { CURRENT_SETTINGS_SCHEMA_VERSION, utcDayKey, utcMonthKey } from '../../../src/storage/settings';

const FIRST = 'First Company Inc., USA';
const SECOND = 'Second Company Ltd., EU';

function stored(): Record<string, unknown> {
  return {
    settingsSchemaVersion: CURRENT_SETTINGS_SCHEMA_VERSION, lastResetDate: utcDayKey(), lastResetMonth: utcMonthKey(),
    fw_license_key: 'fw-starter-abc12345', dailyCap: 2500, totalChecksToday: 0, totalTokensThisMonth: 100, mode: 'adult', aiAnalysisEnabled: true,
  };
}

function answer(headers: Record<string, string>): Response {
  return { status: 200, headers: { get: (n: string) => headers[n.toLowerCase()] ?? null } } as unknown as Response;
}

beforeEach(() => {
  vi.resetModules();
  installChromeStorageStub({ initial: stored(), sendMessage: () => undefined });
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => { vi.restoreAllMocks(); });

describe('the probe', () => {
  it('keeps both names when the relay serves both', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => answer({ 'x-fw-provider-legal': FIRST, 'x-fw-claude-provider-legal': SECOND }));
    const { probeProxy, servedProviderName, servedClaudeProviderName } = await import('../../../src/ai/client');
    expect(await probeProxy('fw-starter-abc12345')).toBe('ok');
    expect(servedProviderName('fw-starter-abc12345')).toBe(FIRST);
    expect(servedClaudeProviderName('fw-starter-abc12345')).toBe(SECOND);
  });

  it('keeps no second name when the relay serves none, so the Claude reading is not offered', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => answer({ 'x-fw-provider-legal': FIRST }));
    const { probeProxy, servedProviderName, servedClaudeProviderName } = await import('../../../src/ai/client');
    expect(await probeProxy('fw-starter-abc12345')).toBe('ok');
    expect(servedProviderName('fw-starter-abc12345')).toBe(FIRST);
    expect(servedClaudeProviderName('fw-starter-abc12345')).toBeNull();
  });

  it('drops a second name that is not a name: control characters or over 120 characters', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => answer({ 'x-fw-provider-legal': FIRST, 'x-fw-claude-provider-legal': 'x'.repeat(121) }));
    const { probeProxy, servedClaudeProviderName } = await import('../../../src/ai/client');
    await probeProxy('fw-starter-abc12345');
    expect(servedClaudeProviderName('fw-starter-abc12345')).toBeNull();
  });
});
