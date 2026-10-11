// @vitest-environment jsdom
// The popup's first line said "YouTube · limited here" with no reason, while the reason for each page was already
// computed in four languages (coverage-map.ts gapNote) and never shown (Board, 11 Oct 2026). A partly covered page now
// says why under its line; a page that records fully says nothing more.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { HomeTab } from '../../../../src/ui/popup/Popup';
import { I18nProvider } from '../../../../src/i18n/react';
import { type FWSettings, utcDayKey } from '../../../../src/storage/settings';
import { adultPreset } from '../../../../src/storage/presets';
import type { LicenseInfo } from '../../../../src/storage/license';
import { describePageCoverage } from '../../../../src/ui/popup/coverage-map';
import { installCounterChrome } from '../../../helpers/fake-counter-chrome';

vi.mock('../../../../src/ai/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/ai/client')>();
  return { ...actual, probeProxy: vi.fn(async () => 'ok') };
});
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const FREE = { tier: 'free', secret: '' } as unknown as LicenseInfo;
const settings = {
  settingsSchemaVersion: '14', mode: 'adult', features: adultPreset(), strictLanguage: false, parentPin: '', dailyCap: 0,
  totalChecksToday: 0, totalNeutralizedToday: 0, totalNeutralizedAllTime: 0, totalTokensThisMonth: 0, lastResetDate: utcDayKey(),
  uiLanguage: 'en', dashboardTheme: 'dark', aiAnalysisEnabled: true, presets: { appliedAt: '', appliedPreset: 'adult' },
} as unknown as FWSettings;

let container: HTMLDivElement;
let root: Root;
let url = '';
beforeEach(() => {
  installCounterChrome();
  const c = (globalThis as unknown as { chrome: Record<string, unknown> }).chrome;
  c.tabs = { query: vi.fn(async () => [{ id: 1, url }]) };
  (c.runtime as Record<string, unknown>).getManifest = () => ({ version: '2.5.18' });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

async function homeAt(at: string): Promise<HTMLElement> {
  url = at;
  await act(async () => {
    root.render(createElement(I18nProvider, { lang: 'en', children: createElement(HomeTab, {
      settings, license: FREE, probeResult: 'ok', onOpenDashboard: () => {}, onOpenDashboardSection: () => {},
    } as never) }));
  });
  for (let i = 0; i < 5; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  return container.querySelector('.home-status') as HTMLElement;
}

describe('the popup\'s page line', () => {
  it('on a partly covered page, says why under the line', async () => {
    const at = 'https://www.youtube.com/shorts/abc';
    const u = new URL(at);
    const cov = describePageCoverage(u.hostname, u.pathname, 'en');
    expect(cov?.fullyProtected).toBe(false);
    expect(cov?.gapNote).toBeTruthy();
    const line = await homeAt(at);
    expect(line.querySelector('.home-status-note')?.textContent).toBe(cov!.gapNote);
  });

  it('on a page that records fully, adds nothing', async () => {
    const at = 'https://www.youtube.com/watch?v=x';
    const u = new URL(at);
    expect(describePageCoverage(u.hostname, u.pathname, 'en')?.fullyProtected).toBe(true);
    const line = await homeAt(at);
    expect(line.querySelector('.home-status-note')).toBeNull();
  });
});
