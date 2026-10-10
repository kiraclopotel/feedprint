/** @vitest-environment jsdom */
// "Extraction health (DOM)" said "no visit observed today" for YouTube and Facebook in a capture
// whose own memory samples show a YouTube tab open from 00:00 to 00:32 UTC that day, with 221
// YouTube records saved in the last 24 hours. Both of the rows' instruments report once per tab
// and never again: the canary saves a success only on the tab's first extraction, and a selector
// family sweep records one hit per page path. A tab opened before midnight UTC had already spent
// both on the previous day's key, so the new day read empty for as long as the tab stayed open.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { installChromeStorageStub, type ChromeStorageStub } from '../../helpers/chrome-storage';
import {
  recordExtractionResult,
  readExtractionCanary,
  _resetExtractionCanaryForTesting,
} from '../../../src/diagnostics/extraction-canary';
import {
  flushNow,
  readSelectorHealth,
  assessPlatformDrift,
  overlayCanary,
  _resetSelectorHealthForTesting,
} from '../../../src/diagnostics/selector-health';
import {
  noteSelectorFamilySweep,
  __resetSelectorFamilyMissStateForTest,
} from '../../../src/content/engagement/selector-family-miss';
import { DASHBOARD_STRINGS } from '../../../src/i18n/dashboard-strings';

const BEFORE_MIDNIGHT = new Date('2026-09-24T23:59:50.000Z');
const AFTER_MIDNIGHT = new Date('2026-09-25T00:10:00.000Z');

let stub: ChromeStorageStub;

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  stub = installChromeStorageStub();
  _resetExtractionCanaryForTesting();
  _resetSelectorHealthForTesting();
  __resetSelectorFamilyMissStateForTest();
});

afterEach(() => {
  stub.restore();
  vi.useRealTimers();
});

describe('a tab that stays open across midnight UTC is seen on the new day', () => {
  it('the canary saves a success for the new day when the same tab keeps extracting', async () => {
    vi.setSystemTime(BEFORE_MIDNIGHT);
    recordExtractionResult('youtube', 3, 5);
    await settle();

    vi.setSystemTime(AFTER_MIDNIGHT);
    recordExtractionResult('youtube', 2, 5);
    await settle();

    const snap = await readExtractionCanary();
    expect(snap.date).toBe('2026-09-25');
    expect(snap.status).toBe('clear');
    expect(snap.successes?.youtube).toBeDefined();

    const rows = overlayCanary(assessPlatformDrift({ date: '2026-09-25', counters: {} }), snap);
    expect(rows.find((r) => r.platform === 'youtube')?.status).toBe('confirmed-by-canary');
  });

  it('a selector family that keeps matching on the same page path is counted on the new day', async () => {
    vi.setSystemTime(BEFORE_MIDNIGHT);
    noteSelectorFamilySweep('youtube.comment-block', 4);
    await flushNow();

    vi.setSystemTime(AFTER_MIDNIGHT);
    noteSelectorFamilySweep('youtube.comment-block', 4);
    await flushNow();

    const health = await readSelectorHealth();
    expect(health.date).toBe('2026-09-25');
    expect(health.counters['youtube.comment-block']?.primary).toBe(1);
    expect(assessPlatformDrift(health).find((r) => r.platform === 'youtube')?.status).toBe('healthy');
  });

  it('the same day still records a family once per page path', async () => {
    vi.setSystemTime(AFTER_MIDNIGHT);
    noteSelectorFamilySweep('youtube.comment-block', 4);
    noteSelectorFamilySweep('youtube.comment-block', 4);
    await flushNow();
    const health = await readSelectorHealth();
    expect(health.counters['youtube.comment-block']?.primary).toBe(1);
  });

  it('the empty rows name the day they cover, which starts at 00:00 UTC', () => {
    for (const lang of ['en', 'ro', 'es', 'pt-BR'] as const) {
      expect(DASHBOARD_STRINGS[lang].opsDriftNotMonitored, lang).toMatch(/UTC/);
      expect(DASHBOARD_STRINGS[lang].opsNoExtraction, lang).toMatch(/UTC/);
    }
  });
});
