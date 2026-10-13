/** @vitest-environment jsdom */
// The dashboard's Issues tab at Silent (the Strict level), 12 Oct 2026. Silent reads once a key is added and the agreement is
// given. The cards that speak of posts "staying as written" do not fit it (at Silent a post is filtered on this computer), so
// Silent has one sentence each, from the packet of the same day: the day's allowance used up, the service not answering, the
// key without the agreement. Silent with no key reads nothing and has no reading to fail, so it shows none. Calm and Open keep
// the cards they had.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { installChromeStorageStub } from '../../helpers/chrome-storage';
import { utcDayKey, utcMonthKey, CURRENT_SETTINGS_SCHEMA_VERSION } from '../../../src/storage/settings';
import { DASHBOARD_STRINGS } from '../../../src/i18n/dashboard-strings';
import { UI_LANGUAGES } from '../../../src/i18n';
import { I18nProvider } from '../../../src/i18n/react';
import { OperationalEventsPanel } from '../../../src/ui/dashboard/components/OperationalEventsPanel';
import { getLicense } from '../../../src/storage/license';

// The real licence reader, but a test can hold it back (one case does).
vi.mock('../../../src/storage/license', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/storage/license')>();
  return { ...actual, getLicense: vi.fn(actual.getLicense) };
});

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const KEY = 'fw-starter-abc12345';
const d = DASHBOARD_STRINGS.en;
const NOW = Date.now();
const PAUSED = { fingerprint: 'starter:2345', code: 'consent_required', at: 1 };
const TROUBLE = { since: NOW - 60_000, at: NOW - 1_000, failures: 5 };

async function slotFor(bearer: string): Promise<string> {
  const bytes = new TextEncoder().encode(bearer);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

async function stored(mode: 'child' | 'teen', opts: { key?: boolean; agreed?: boolean; extra?: Record<string, unknown> } = {}): Promise<Record<string, unknown>> {
  const day = utcDayKey();
  return {
    settingsSchemaVersion: CURRENT_SETTINGS_SCHEMA_VERSION, lastResetDate: day, lastResetMonth: utcMonthKey(),
    mode, levelChosen: true, dailyCap: 2500, totalChecksToday: 0, totalTokensThisMonth: 0,
    ...(opts.key === false ? {} : { fw_license_key: KEY }),
    ...(opts.agreed ? { readingConsent: { [await slotFor(KEY)]: { textVersion: 'v', textHash: 'a'.repeat(64), at: '2026-10-12T10:00:00.000Z', provider: 'Example Provider Inc.' } } } : {}),
    ...opts.extra,
  };
}

const utcDay = () => {
  const n = new Date();
  return `${n.getUTCFullYear()}-${String(n.getUTCMonth() + 1).padStart(2, '0')}-${String(n.getUTCDate()).padStart(2, '0')}`;
};

describe('the Issues tab at Silent', () => {
  let host: HTMLDivElement;
  let root: Root;

  // getSettings keeps its answer for five seconds, so each scene moves the clock past that: one scene's level is not the next one's.
  const realNow = Date.now.bind(Date);
  let skew = 0;

  beforeEach(() => {
    vi.spyOn(Date, 'now').mockImplementation(() => realNow() + skew);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); });

  async function show(initial: Record<string, unknown>, lang: (typeof UI_LANGUAGES)[number] = 'en'): Promise<string> {
    skew += 10_000;
    installChromeStorageStub({ initial });
    await act(async () => {
      root.render(createElement(I18nProvider, { lang, children: createElement(OperationalEventsPanel as never, { initialBuckets: [] }) }));
    });
    for (let i = 0; i < 40; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    return host.textContent ?? '';
  }

  // First, on purpose: once a paid key has been read in this realm, a missing key reads as a blip and keeps the paid one (getLicense).
  it('with no key it reads nothing: the AI-health line says so, and no reading card shows even from an old marker', async () => {
    const text = await show(await stored('child', { key: false, extra: { readingTrouble: TROUBLE, readingPaused: PAUSED } }));
    expect(text).not.toContain(d.strictNoAgreement);
    expect(text).not.toContain(d.strictServiceDown);
    expect(text).not.toContain(d.opsCardReadingTroubleTitle);
    expect(text).not.toContain(d.opsCardReadingPausedTitle);
  });

  it('before the level and the licence are read, no reading card shows from an old marker, and none after', async () => {
    // The licence read is held, as it is for a moment on a real install (a missing key is looked for three times).
    let release!: () => void;
    const held = new Promise<void>((r) => { release = r; });
    const real = (await vi.importActual<typeof import('../../../src/storage/license')>('../../../src/storage/license')).getLicense;
    vi.mocked(getLicense).mockImplementation(async () => { await held; return real(); });
    try {
      skew += 10_000;
      installChromeStorageStub({ initial: await stored('child', { key: false, extra: { readingTrouble: TROUBLE, readingPaused: PAUSED } }) });
      await act(async () => {
        root.render(createElement(I18nProvider, { lang: 'en', children: createElement(OperationalEventsPanel as never, { initialBuckets: [] }) }));
      });
      for (let i = 0; i < 20; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
      expect(host.textContent, 'the licence is still being read').not.toContain(d.opsCardReadingTroubleTitle);
      expect(host.textContent).not.toContain(d.opsCardReadingPausedTitle);
      release();
      for (let i = 0; i < 40; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
      expect(host.textContent).not.toContain(d.opsCardReadingTroubleTitle);
      expect(host.textContent).not.toContain(d.strictServiceDown);
    } finally {
      release();
      vi.mocked(getLicense).mockReset();
      vi.mocked(getLicense).mockImplementation(real);
    }
  });

  it('with a key and no agreement, one card says the agreement is missing and nothing leaves', async () => {
    const text = await show(await stored('child'));
    expect(text).toContain(d.strictNoAgreement);
    expect(text).toContain(d.opsAiOffStrictKey);
  });

  it('with a key and the agreement, no such card, and the AI-health section reports the licence as at any level', async () => {
    const text = await show(await stored('child', { agreed: true }));
    expect(text).not.toContain(d.strictNoAgreement);
    expect(text).not.toContain(d.opsAiOffStrictKey);
    expect(text).not.toContain(d.opsAiOffStrict);
    expect(text).toContain(d.opsLicenseActive1);
  });

  it('the service not answering has its own sentence, and not the card about posts staying as written', async () => {
    const text = await show(await stored('child', { agreed: true, extra: { readingTrouble: TROUBLE } }));
    expect(text).toContain(d.strictServiceDown);
    expect(text).not.toContain(d.opsCardReadingTroubleTitle);
    expect(text).not.toContain(d.opsCardReadingTroubleMeaning);
  });

  it("today's allowance used up has its own sentence; the month's limit keeps the ordinary card", async () => {
    const daily = await show(await stored('child', { agreed: true, extra: { textCapReached: { cap: 'daily', periodKey: utcDay() } } }));
    expect(daily).toContain(d.strictAllowanceOut);
    expect(daily).not.toContain(d.opsCardTextCapTitle('daily'));
    act(() => root.unmount());
    root = createRoot(host);
    const monthly = await show(await stored('child', { agreed: true, extra: { textCapReached: { cap: 'monthly', periodKey: utcDay().slice(0, 7) } } }));
    expect(monthly).toContain(d.opsCardTextCapTitle('monthly'));
    expect(monthly).not.toContain(d.strictAllowanceOut);
  });

  it('the reading waiting for the go-ahead is the missing agreement at Silent', async () => {
    const text = await show(await stored('child', { agreed: true, extra: { readingPaused: PAUSED } }));
    expect(text).toContain(d.strictNoAgreement);
    expect(text).not.toContain(d.opsCardReadingPausedTitle);
  });

  it('at Calm the ordinary cards stand, and the Silent sentences do not appear', async () => {
    const text = await show(await stored('teen', { agreed: true, extra: { readingTrouble: TROUBLE, readingPaused: PAUSED } }));
    expect(text).toContain(d.opsCardReadingTroubleTitle);
    expect(text).toContain(d.opsCardReadingPausedTitle);
    expect(text).not.toContain(d.strictNoAgreement);
    expect(text).not.toContain(d.strictServiceDown);
  });
});

describe('the Silent sentences', () => {
  it.each(UI_LANGUAGES)('%s: three sentences, each ending in a full stop, none with an em dash', (lang) => {
    const w = DASHBOARD_STRINGS[lang];
    for (const s of [w.strictAllowanceOut, w.strictServiceDown, w.strictNoAgreement]) {
      expect(s.length).toBeGreaterThan(20);
      expect(s).toMatch(/\.$/);
      expect(s).not.toContain('—');
    }
  });

  it('the English reads as the packet gives it', () => {
    expect(DASHBOARD_STRINGS.en.strictAllowanceOut).toBe("Live Rephrase paused: today's allowance is used up. Posts are filtered on this computer until it renews.");
    expect(DASHBOARD_STRINGS.en.strictServiceDown).toBe('Live Rephrase is not answering. Posts are filtered on this computer.');
    expect(DASHBOARD_STRINGS.en.strictNoAgreement).toBe('Live Rephrase has a key but no agreement yet. Nothing leaves this computer.');
  });
});
