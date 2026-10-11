/** @vitest-environment jsdom */
// The key card on the home tab says, while the paid reading's second company is on for this key, that
// near the monthly limit it stops first and the ordinary reading goes on; while the reader's own
// marker says a limit or a refusal paused it, the card says that instead; with no consent for the
// second company the card says nothing about it.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { installChromeStorageStub } from '../../../helpers/chrome-storage';
import { utcDayKey, utcMonthKey, CURRENT_SETTINGS_SCHEMA_VERSION } from '../../../../src/storage/settings';
import { POPUP_STRINGS } from '../../../../src/i18n/popup-strings';
import type { LicenseInfo } from '../../../../src/storage/license';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const t = POPUP_STRINGS.en;
const BEARER = 'fw-starter-abc12345';
const KEY: LicenseInfo = { tier: 'starter', secret: 'abc12345' };

function stored(): Record<string, unknown> {
  return {
    settingsSchemaVersion: CURRENT_SETTINGS_SCHEMA_VERSION, lastResetDate: utcDayKey(), lastResetMonth: utcMonthKey(),
    fw_license_key: BEARER, dailyCap: 2500, totalChecksToday: 3, totalTokensThisMonth: 100,
    setupDone: true, mode: 'adult', aiAnalysisEnabled: true, levelChosen: true,
  };
}

let root: Root | null = null;

async function renderCard(initial: Record<string, unknown>): Promise<HTMLElement> {
  installChromeStorageStub({ initial: { ...stored(), ...initial }, sendMessage: () => undefined });
  const { getSettings } = await import('../../../../src/storage/settings');
  const { KeyUsage } = await import('../../../../src/ui/popup/panels/HomeTab');
  const settings = await getSettings();
  document.body.innerHTML = '<div id="root"></div>';
  const el = document.getElementById('root') as HTMLElement;
  root = createRoot(el);
  await act(async () => { root!.render(createElement(KeyUsage, { settings, license: KEY, probeResult: 'ok' })); });
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  return el;
}

async function digestOf(bearer: string): Promise<string> {
  const { sha256 } = await import('../../../../src/forensics/hasher');
  return (await sha256(bearer)).slice(0, 32);
}

beforeEach(() => {
  vi.resetModules();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(async () => {
  if (root) { await act(async () => { root!.unmount(); }); root = null; }
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('the key card', () => {
  it('says nothing about a second company while no consent for it is stored', async () => {
    const el = await renderCard({});
    expect(el.querySelector('[data-testid="claude-reading-line"]')).toBeNull();
  });

  it('says the second company stops first while its consent is stored', async () => {
    const digest = await digestOf(BEARER);
    const consent = { textVersion: 'claude-reading-consent-1', textHash: 'a'.repeat(64), at: '2026-10-11T00:00:00.000Z', provider: 'Second Company Ltd., EU' };
    const el = await renderCard({ claudeReadingConsent: { [digest]: consent } });
    expect(el.querySelector('[data-testid="claude-reading-line"]')?.textContent).toBe(t.claudeStopsFirst);
  });

  it('says it is paused while the reader\'s marker holds a time still to come, and not once it has passed', async () => {
    const digest = await digestOf(BEARER);
    const consent = { textVersion: 'claude-reading-consent-1', textHash: 'a'.repeat(64), at: '2026-10-11T00:00:00.000Z', provider: 'Second Company Ltd., EU' };
    const soon = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const el = await renderCard({ claudeReadingConsent: { [digest]: consent }, claudeReadingPaused: { reason: 'paused-monthly', until: soon } });
    expect(el.querySelector('[data-testid="claude-reading-line"]')?.textContent).toBe(t.claudePausedLine);

    await act(async () => { root!.unmount(); }); root = null; vi.resetModules();
    const gone = new Date(Date.now() - 60 * 1000).toISOString();
    const el2 = await renderCard({ claudeReadingConsent: { [digest]: consent }, claudeReadingPaused: { reason: 'paused-monthly', until: gone } });
    expect(el2.querySelector('[data-testid="claude-reading-line"]')?.textContent).toBe(t.claudeStopsFirst);
  });
});
