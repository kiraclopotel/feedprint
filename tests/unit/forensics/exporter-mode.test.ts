/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { exportCSV } from '../../../src/forensics/exporter';
import type { ForensicRecord } from '../../../src/types/forensic';

function makeRecord(overrides: Partial<ForensicRecord> = {}): ForensicRecord {
  return {
    id: overrides.id ?? 'fr-export-mode-test',
    timestamp: overrides.timestamp ?? '2026-06-28T00:00:00.000Z',
    platform: overrides.platform ?? 'tiktok',
    originalText: overrides.originalText ?? 'x',
    originalHash: overrides.originalHash ?? 'hash',
    originalLength: overrides.originalLength ?? 1,
    neutralizedText: overrides.neutralizedText ?? '',
    author: overrides.author ?? '@example',
    postUrl: overrides.postUrl ?? 'https://example.test/post',
    techniques: overrides.techniques ?? [{ name: 'fear-appeal', severity: 4, confidence: 0.9 }],
    overallScore: overrides.overallScore ?? 4,
    userAgeCategory: overrides.userAgeCategory ?? 'teen',
    aiSource: overrides.aiSource ?? 'cloud',
    feedSource: overrides.feedSource ?? 'for-you',
    integrityHash: overrides.integrityHash ?? 'integrity',
    verdict: overrides.verdict ?? 'flagged',
    ...overrides,
  };
}

async function captureCsv(records: ForensicRecord[]): Promise<string> {
  if (typeof URL.createObjectURL !== 'function') {
    (URL as unknown as { createObjectURL: (blob: Blob) => string }).createObjectURL = () => 'blob:stub';
  }
  if (typeof URL.revokeObjectURL !== 'function') {
    (URL as unknown as { revokeObjectURL: (url: string) => void }).revokeObjectURL = () => undefined;
  }

  let captured: Blob | null = null;
  vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
    captured = blob as Blob;
    return 'blob:export-mode-test';
  });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

  exportCSV(records);

  expect(captured).not.toBeNull();
  return captured!.text();
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CSV export mode fidelity', () => {
  it('exposes mode_at_capture when configSnapshot is absent', async () => {
    const csv = await captureCsv([
      makeRecord({
        userAgeCategory: 'adult',
        detectionMode: 'manual',
        configSnapshot: undefined,
      }),
    ]);

    expect(csv).toContain('detection_mode,mode_at_capture,config_mode');
    expect(csv).toContain(',manual,adult,,');
  });

  it('prefers signed configSnapshot.mode for legacy records', async () => {
    const csv = await captureCsv([
      makeRecord({
        userAgeCategory: 'teen',
        detectionMode: 'combined-detect-neutralize',
        configSnapshot: { mode: 'adult', threshold: 0.4, dailyCap: 50 },
      }),
    ]);

    expect(csv).toContain(',combined-detect-neutralize,adult,adult,0.4,50');
  });
});
