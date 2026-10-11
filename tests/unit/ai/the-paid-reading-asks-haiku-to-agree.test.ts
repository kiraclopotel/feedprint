// The paid reading acts only where two readers agree: gpt-oss flags, and Gemma or Claude Haiku agrees.
// Every way Haiku can fail (not configured, declined, unusable, timed out, paused
// near the cap, no consent) gives no reading, which leaves today's rule. Nothing here reaches a live
// endpoint: the relay is a stub.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeStorageStub } from '../../helpers/chrome-storage';
import { CURRENT_SETTINGS_SCHEMA_VERSION, utcDayKey, utcMonthKey } from '../../../src/storage/settings';
import { actFires } from '../../../src/ai/judge-pair';

const CUT = 4;
const fires = { charged: true, severity: 5 };
const below = { charged: true, severity: 3 };
const calm = { charged: false, severity: 0 };
const VERDICT = { charged: true, family: 'hostile', severity: 5, effect: 'recruit', intent: 'react' };
const USAGE = { input_tokens: 100, cache_creation_input_tokens: 1000, cache_read_input_tokens: 0, output_tokens: 40 };
const CLAUDE_CONSENT = { textVersion: 'claude-v', textHash: 'a'.repeat(64), at: '2026-10-11T00:00:00.000Z', provider: 'Example Claude Provider, USA' };

describe('the tier table', () => {
  const readings = { fires, below, calm, none: null } as const;
  for (const [g, gpt] of Object.entries(readings)) {
    for (const [m, gemma] of Object.entries(readings)) {
      for (const [h, haiku] of Object.entries(readings)) {
        const expected = g === 'fires' && (m === 'fires' || h === 'fires');
        it(`gpt-oss ${g}, Gemma ${m}, Haiku ${h}: ${expected ? 'acts' : 'passes'}`, () => {
          expect(actFires(gpt, gemma, haiku, CUT)).toBe(expected);
        });
      }
    }
  }
});

function storedSettings(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    settingsSchemaVersion: CURRENT_SETTINGS_SCHEMA_VERSION, lastResetDate: utcDayKey(), lastResetMonth: utcMonthKey(),
    fw_license_key: 'fw-starter-abc12345', dailyCap: 2500, totalChecksToday: 0, totalTokensThisMonth: 0,
    ...extra,
  };
}

async function withConsent(): Promise<void> {
  const rc = await import('../../../src/storage/reading-consent');
  await rc.recordReadingConsent(rc.bearerOf({ tier: 'starter', secret: 'abc12345' }), 'the words shown', CLAUDE_CONSENT.provider, new Date(), 'claude');
}

function relay(status: number, body: unknown) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json', 'x-fw-provider': 'anthropic' },
  }));
}

const ITEM = { text: 'They are all clowns.', platform: 'x', kind: 'comment', parentText: 'The council voted today.' };

describe('the client for the Claude reading', () => {
  beforeEach(() => {
    vi.resetModules();
    installChromeStorageStub({ initial: storedSettings(), sendMessage: () => undefined });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('sends the item and nothing else, with the key and the Claude consent, and returns the reading with who read it', async () => {
    await withConsent();
    const calls = relay(200, { verdict: VERDICT, reader: { model: 'claude-haiku-5-5', provider: 'anthropic', judge: 'd83cd0253c1c' }, usage: USAGE });
    const { askClaudeReader } = await import('../../../src/ai/claude-reader');
    const got = await askClaudeReader(ITEM);
    expect(got).toEqual({ model: 'claude-haiku-5-5', provider: 'anthropic', hash: 'd83cd0253c1c', outcome: 'read', reading: VERDICT });
    expect(calls).toHaveBeenCalledTimes(1);
    const [url, init] = calls.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.feelingwise.org/v1/claude/verdict');
    const headers = new Headers(init.headers);
    expect(headers.get('Authorization')).toBe('Bearer fw-starter-abc12345');
    expect(JSON.parse(headers.get('X-FW-Consent')!)).toMatchObject({ v: 'claude-reading-consent-1', p: CLAUDE_CONSENT.provider });
    expect(JSON.parse(String(init.body))).toEqual({ item: { platform: 'x', kind: 'comment', text: 'They are all clowns.', parentText: 'The council voted today.' } });
  });

  it('meters the call in the local counter the way the relay does', async () => {
    await withConsent();
    relay(200, { verdict: VERDICT, reader: { model: 'claude-haiku-5-5', provider: 'anthropic', judge: 'd83cd0253c1c' }, usage: USAGE });
    const { askClaudeReader } = await import('../../../src/ai/claude-reader');
    const settings = await import('../../../src/storage/settings');
    const spy = vi.spyOn(settings, 'recordAiCall');
    await askClaudeReader(ITEM);
    const { claudeTokenEquivalents } = await import('../../../src/storage/usage-weights');
    expect(spy).toHaveBeenCalledWith({
      inputTokens: 1100, outputTokens: 40, tokenEquivalents: claudeTokenEquivalents(USAGE), provider: 'anthropic', model: 'claude-haiku-5-5',
    });
  });

  it.each([
    [503, 'claude_not_configured', 'not-configured'],
    [502, 'claude_refused', 'refused'],
    [502, 'claude_unusable', 'unusable'],
    [504, 'upstream_timeout', 'timeout'],
    [429, 'claude_paused_near_cap', 'paused-near-cap'],
    [403, 'consent_required', 'no-consent'],
    [502, 'claude_upstream_error', 'error'],
  ])('answers a %i %s with no reading and names the failure (%s)', async (status, code, outcome) => {
    await withConsent();
    relay(status, { error: { code, message: 'x' } });
    const { askClaudeReader } = await import('../../../src/ai/claude-reader');
    const got = await askClaudeReader(ITEM);
    expect(got).toEqual({ model: 'claude-haiku-5-5', provider: 'anthropic', hash: 'd83cd0253c1c', outcome });
  });

  it('a pause near the cap leaves the ordinary reading alone: the next ordinary call is still made', async () => {
    await withConsent();
    relay(429, { error: { code: 'claude_paused_near_cap', message: 'x' } });
    const { askClaudeReader } = await import('../../../src/ai/claude-reader');
    await askClaudeReader(ITEM);
    vi.restoreAllMocks();
    const ordinary = relay(200, { choices: [{ message: { content: '{}' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
    const { callAI } = await import('../../../src/ai/client');
    await callAI('s', 'u', true, {});
    expect(ordinary).toHaveBeenCalledTimes(1);
  });

  it('a relay that does not answer in time gives no reading', async () => {
    await withConsent();
    const real = await vi.importActual<typeof import('../../../src/ai/fetch-with-deadline')>('../../../src/ai/fetch-with-deadline');
    const deadlines: number[] = [];
    vi.doMock('../../../src/ai/fetch-with-deadline', () => ({
      ...real,
      fetchWithDeadline: async (_url: string, _init: RequestInit, deadlineMs: number) => {
        deadlines.push(deadlineMs);
        throw new real.DeadlineError(deadlineMs);
      },
    }));
    const { askClaudeReader, CLAUDE_READER_DEADLINE_MS } = await import('../../../src/ai/claude-reader');
    expect((await askClaudeReader(ITEM)).outcome).toBe('timeout');
    expect(deadlines).toEqual([CLAUDE_READER_DEADLINE_MS]);
    vi.doUnmock('../../../src/ai/fetch-with-deadline');
  });

  it('a relay that cannot be reached gives no reading', async () => {
    await withConsent();
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    const { askClaudeReader } = await import('../../../src/ai/claude-reader');
    expect((await askClaudeReader(ITEM)).outcome).toBe('error');
  });

  it('a reply that is not a verdict gives no reading', async () => {
    await withConsent();
    relay(200, { verdict: { ...VERDICT, severity: 'high' }, reader: {} });
    const { askClaudeReader } = await import('../../../src/ai/claude-reader');
    expect((await askClaudeReader(ITEM)).outcome).toBe('unusable');
  });

  it('makes no call without a Claude consent for this key', async () => {
    const calls = relay(200, { verdict: VERDICT });
    const { askClaudeReader } = await import('../../../src/ai/claude-reader');
    expect((await askClaudeReader(ITEM)).outcome).toBe('no-consent');
    expect(calls).not.toHaveBeenCalled();
  });

  it('makes no call without a paid key', async () => {
    installChromeStorageStub({ initial: storedSettings({ fw_license_key: '' }), sendMessage: () => undefined });
    const calls = relay(200, { verdict: VERDICT });
    const { askClaudeReader } = await import('../../../src/ai/claude-reader');
    expect((await askClaudeReader(ITEM)).outcome).toBe('no-key');
    expect(calls).not.toHaveBeenCalled();
  });
});
