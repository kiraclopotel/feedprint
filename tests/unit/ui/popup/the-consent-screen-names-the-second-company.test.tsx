/** @vitest-environment jsdom */
// The whole popup, with a key present, when the relay names a second company (the paid reading's
// Claude reader): the screen says two companies read, names both, and one press stores a consent for
// each under the name served and over the same words shown. When the relay names only the first,
// the screen is the one it always was and nothing is stored for a second. A person who agreed to the
// first company before the second was served is asked once more, for both.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';

import { installChromeStorageStub } from '../../../helpers/chrome-storage';
import { utcDayKey, utcMonthKey, CURRENT_SETTINGS_SCHEMA_VERSION } from '../../../../src/storage/settings';
import { POPUP_STRINGS } from '../../../../src/i18n/popup-strings';
import { UI_LANGUAGES } from '../../../../src/i18n';
import type { LicenseInfo } from '../../../../src/storage/license';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const t = POPUP_STRINGS.en;
const FIRST = 'First Company Inc., USA';
const SECOND = 'Second Company Ltd., EU';
const BEARER = 'fw-starter-abc12345';
const KEY: LicenseInfo = { tier: 'starter', secret: 'abc12345' };

function stored(): Record<string, unknown> {
  return {
    settingsSchemaVersion: CURRENT_SETTINGS_SCHEMA_VERSION, lastResetDate: utcDayKey(), lastResetMonth: utcMonthKey(),
    fw_license_key: BEARER, dailyCap: 2500, totalChecksToday: 0, totalTokensThisMonth: 100,
    setupDone: true, mode: 'adult', aiAnalysisEnabled: true,
  };
}

function probeAnswer(first: string | null, second: string | null): Response {
  const h: Record<string, string | null> = { 'x-fw-provider-legal': first, 'x-fw-claude-provider-legal': second };
  return { status: 200, headers: { get: (n: string) => h[n.toLowerCase()] ?? null } } as unknown as Response;
}

async function settle(): Promise<void> {
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
}

async function openPopup(first: string | null, second: string | null, initial: Record<string, unknown> = {}): Promise<HTMLElement> {
  installChromeStorageStub({ initial: { ...stored(), ...initial }, sendMessage: () => undefined });
  (globalThis as { fetch: unknown }).fetch = vi.fn(async () => probeAnswer(first, second));
  document.body.innerHTML = '<div id="root"></div>';
  await import('../../../../src/ui/popup/Popup');
  await settle();
  await settle();
  return document.getElementById('root') as HTMLElement;
}

async function digestOf(bearer: string): Promise<string> {
  const { sha256 } = await import('../../../../src/forensics/hasher');
  return (await sha256(bearer)).slice(0, 32);
}

beforeEach(() => {
  vi.resetModules();
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = ''; });

describe('with a key and no consent, two companies served', () => {
  it('says two companies read, names both, and one press stores a consent for each over the same words', async () => {
    const root = await openPopup(FIRST, SECOND);
    const screen = root.querySelector('[data-testid="reading-consent"]');
    expect(screen).not.toBeNull();
    expect(screen!.textContent).toContain(t.consentWhyTwo);
    expect(screen!.textContent).not.toContain(t.consentWhy);
    expect(screen!.textContent).toContain(t.consentToWhom(FIRST));
    expect(screen!.textContent).toContain(t.consentToWhomClaude(SECOND));

    await act(async () => { (root.querySelector('[data-testid="consent-start"]') as HTMLButtonElement).click(); });
    await settle();
    const rc = await import('../../../../src/storage/reading-consent');
    const { readingConsentText } = await import('../../../../src/ui/popup/panels/ReadingConsentScreen');
    const { sha256 } = await import('../../../../src/forensics/hasher');
    const first = await rc.getReadingConsent(BEARER);
    const second = await rc.getReadingConsent(BEARER, 'claude');
    expect(first?.provider).toBe(FIRST);
    expect(second?.provider).toBe(SECOND);
    expect(first?.textHash).toBe(await sha256(readingConsentText(t, FIRST, SECOND)));
    expect(second?.textHash).toBe(first?.textHash);
    expect(root.querySelector('[data-testid="reading-consent"]')).toBeNull();
  });
});

describe('with a key and no consent, one company served', () => {
  it('is the screen it always was, and stores nothing for a second company', async () => {
    const root = await openPopup(FIRST, null);
    const screen = root.querySelector('[data-testid="reading-consent"]');
    expect(screen).not.toBeNull();
    expect(screen!.textContent).toContain(t.consentWhy);
    expect(screen!.textContent).not.toContain(t.consentWhyTwo);
    expect(root.querySelector('[data-testid="consent-second-company"]')).toBeNull();
    await act(async () => { (root.querySelector('[data-testid="consent-start"]') as HTMLButtonElement).click(); });
    await settle();
    const rc = await import('../../../../src/storage/reading-consent');
    expect((await rc.getReadingConsent(BEARER))?.provider).toBe(FIRST);
    expect(await rc.getReadingConsent(BEARER, 'claude')).toBeNull();
  });
});

describe('with a consent for the first company already stored', () => {
  it('asks once more when a second company is served now, and the press stores the second consent', async () => {
    const rc = await import('../../../../src/storage/reading-consent');
    const digest = await digestOf(BEARER);
    const given = { textVersion: rc.READING_CONSENT_TEXT_VERSION, textHash: 'a'.repeat(64), at: '2026-10-05T10:00:00.000Z', provider: FIRST };
    const root = await openPopup(FIRST, SECOND, { readingConsent: { [digest]: given } });
    expect(root.querySelector('[data-testid="reading-consent"]')).not.toBeNull();
    await act(async () => { (root.querySelector('[data-testid="consent-start"]') as HTMLButtonElement).click(); });
    await settle();
    const rc2 = await import('../../../../src/storage/reading-consent');
    expect((await rc2.getReadingConsent(BEARER, 'claude'))?.provider).toBe(SECOND);
  });

  it('asks nothing when both consents are stored under the names served', async () => {
    const rc = await import('../../../../src/storage/reading-consent');
    const digest = await digestOf(BEARER);
    const first = { textVersion: rc.READING_CONSENT_TEXT_VERSION, textHash: 'a'.repeat(64), at: '2026-10-05T10:00:00.000Z', provider: FIRST };
    const second = { textVersion: 'claude-reading-consent-1', textHash: 'a'.repeat(64), at: '2026-10-05T10:00:00.000Z', provider: SECOND };
    const root = await openPopup(FIRST, SECOND, { readingConsent: { [digest]: first }, claudeReadingConsent: { [digest]: second } });
    expect(root.querySelector('[data-testid="reading-consent"]')).toBeNull();
  });
});

describe('the words', () => {
  it.each(UI_LANGUAGES)('%s: the hash covers the second company paragraph only when one is named', async (lang) => {
    const { readingConsentText } = await import('../../../../src/ui/popup/panels/ReadingConsentScreen');
    const s = POPUP_STRINGS[lang];
    const one = readingConsentText(s, FIRST);
    const two = readingConsentText(s, FIRST, SECOND);
    expect(one).toContain(s.consentWhy);
    expect(one).not.toContain(SECOND);
    expect(two).toContain(s.consentWhyTwo);
    expect(two).toContain(s.consentToWhomClaude(SECOND));
    expect(two).not.toContain(s.consentWhy + '\n');
    for (const line of [s.consentWhyTwo, s.consentToWhomClaude(SECOND), s.claudeStopsFirst, s.claudePausedLine]) {
      expect(line).not.toMatch(/—/);
      expect(line.length).toBeGreaterThan(20);
    }
  });

  it('needsReadingConsent: a second company served and not agreed to asks; agreed to, or not served, does not', async () => {
    const { needsReadingConsent } = await import('../../../../src/ui/popup/panels/ReadingConsentScreen');
    const given = { textVersion: 'v', textHash: 'a'.repeat(64), at: '2026-10-05T10:00:00.000Z', provider: FIRST };
    const second = { ...given, provider: SECOND };
    const base = { license: KEY, settings: { aiAnalysisEnabled: true, mode: 'adult' as const }, consent: given, servedProvider: FIRST as string | null, keyRefused: false };
    expect(needsReadingConsent({ ...base, servedClaudeProvider: SECOND, claudeConsent: null })).toBe(true);
    expect(needsReadingConsent({ ...base, servedClaudeProvider: SECOND, claudeConsent: second })).toBe(false);
    expect(needsReadingConsent({ ...base, servedClaudeProvider: SECOND, claudeConsent: { ...second, provider: 'Another Ltd.' } })).toBe(true);
    expect(needsReadingConsent({ ...base, servedClaudeProvider: SECOND, claudeConsent: undefined })).toBe(false);
    expect(needsReadingConsent({ ...base, servedClaudeProvider: null, claudeConsent: null })).toBe(false);
    expect(needsReadingConsent({ ...base })).toBe(false);
  });
});
