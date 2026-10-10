/** @vitest-environment jsdom */
// Receipts' Home carries the same "Something still showing? Tell us" line as Off's popup, with the same
// privacy rules: a prefilled email the person chooses to send, naming the product, the site, the kind of
// page, the version and the switches on there, never the address or anything read on the page.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { HomeTab } from '../../../../src/ui/popup/Popup';
import { receiptsSwitchIds } from '../../../../src/ui/popup/panels/SettingsPanel';
import { REPORT_ADDRESS, reportMailto, switchesOnFor } from '../../../../src/ui/popup/report-link';
import { I18nProvider } from '../../../../src/i18n/react';
import { POPUP_STRINGS } from '../../../../src/i18n/popup-strings';
import { UI_LANGUAGES, type ResolvedUiLanguage } from '../../../../src/i18n';
import { type FWSettings, type FeatureId, utcDayKey } from '../../../../src/storage/settings';
import { adultPreset } from '../../../../src/storage/presets';
import type { LicenseInfo } from '../../../../src/storage/license';
import { installCounterChrome } from '../../../helpers/fake-counter-chrome';

vi.mock('../../../../src/ai/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/ai/client')>();
  return { ...actual, probeProxy: vi.fn(async () => 'ok') };
});

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const FREE = { tier: 'free', secret: '' } as unknown as LicenseInfo;
const decode = (href: string) => {
  const q = new URLSearchParams(href.slice(href.indexOf('?') + 1));
  return { subject: q.get('subject') ?? '', body: q.get('body') ?? '' };
};

function settingsWith(...on: FeatureId[]): FWSettings {
  const features = adultPreset();
  for (const id of on) features[id] = { enabled: true };
  return {
    settingsSchemaVersion: '14', mode: 'adult', strictLanguage: false, parentPin: '', locale: 'en', uiLanguage: 'auto',
    dailyCap: 2000, totalChecksToday: 0, lastResetDate: utcDayKey(), features,
    presets: { appliedAt: '', appliedPreset: 'adult' }, dashboardTheme: 'dark', aiAnalysisEnabled: true,
  } as unknown as FWSettings;
}

describe('the Feedprint email', () => {
  it('names Feedprint in the subject and the version line', () => {
    const s = settingsWith('block-ads');
    const { subject, body } = decode(reportMailto({
      product: 'receipts', site: 'youtube', kind: 'watch', version: '2.5.16', switchesOn: switchesOnFor(s, 'youtube', receiptsSwitchIds()),
    }, POPUP_STRINGS.en));
    expect(subject).toBe('Feedprint: something still showing on YouTube');
    expect(body).toContain('Feedprint version: 2.5.16');
    expect(body).toContain('block-ads');
    expect(body).not.toContain('Off');
  });

  it('says no site in Feedprint\' own words off the five sites', () => {
    const { subject, body } = decode(reportMailto({ product: 'receipts', site: null, kind: null, version: '2.5.16', switchesOn: [] }, POPUP_STRINGS.en));
    expect(subject).toBe('Feedprint: something still showing');
    expect(body).toContain(`Site: ${POPUP_STRINGS.en.receiptsReportNoSite}`);
  });

  it('lists only Feedprint\' own page switches that act on the site', () => {
    const s = settingsWith('hide-stories', 'block-ads');
    expect(switchesOnFor(s, 'youtube', receiptsSwitchIds())).not.toContain('hide-stories');
    expect(switchesOnFor(s, 'instagram', receiptsSwitchIds())).not.toContain('hide-stories');
    expect(switchesOnFor(s, 'instagram', receiptsSwitchIds())).toContain('block-ads');
    expect(receiptsSwitchIds()).not.toContain('rewritten-comments-first');
  });

  it.each(UI_LANGUAGES)('%s: Feedprint has its own words for the subject, the version and no site', (lang) => {
    const t = POPUP_STRINGS[lang as ResolvedUiLanguage];
    expect(t.receiptsReportSubject('YouTube')).toContain('Feedprint');
    expect(t.receiptsReportSubject('YouTube')).toContain('YouTube');
    expect(t.receiptsReportSubject(null)).toContain('Feedprint');
    expect(t.receiptsReportVersion).toContain('Feedprint');
    expect(t.receiptsReportNoSite.length).toBeGreaterThan(0);
  });
});

describe('the line on Feedprint\' Home', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    installCounterChrome();
    const c = (globalThis as unknown as { chrome: Record<string, unknown> }).chrome;
    c.tabs = { query: vi.fn(async () => [{ url: 'https://www.youtube.com/watch?v=SECRETVIDEO&t=42' }]) };
    (c.runtime as Record<string, unknown>).getManifest = () => ({ version: '2.5.16' });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => { act(() => root.unmount()); container.remove(); });

  it('opens a prefilled email to support naming the site and the page kind, never the address', async () => {
    const t = POPUP_STRINGS.en;
    await act(async () => {
      root.render(createElement(I18nProvider, {
        lang: 'en',
        children: createElement(HomeTab, {
          settings: settingsWith('block-ads'), license: FREE, probeResult: 'unknown',
          onOpenDashboard: () => {}, onOpenDashboardSection: () => {},
        }),
      }));
    });
    await act(async () => { await Promise.resolve(); });
    // Since 9 Oct 2026 the line is the first item of the bottom row's contact menu.
    const link = Array.from(container.querySelectorAll('.contact-menu a')).find(a => a.textContent === t.contactReport) as HTMLAnchorElement;
    expect(link).toBeDefined();
    const href = link.getAttribute('href') ?? '';
    expect(href.startsWith(`mailto:${REPORT_ADDRESS}?`)).toBe(true);
    const { subject, body } = decode(href);
    expect(subject).toBe('Feedprint: something still showing on YouTube');
    expect(body).toContain('Page: watch');
    expect(body).toContain('Feedprint version: 2.5.16');
    expect(body).toContain('block-ads');
    expect(href).not.toContain('SECRETVIDEO');
    expect(decodeURIComponent(href)).not.toContain('youtube.com');
  });
});
