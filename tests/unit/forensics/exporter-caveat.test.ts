/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyExportGate, exportJSON } from '../../../src/forensics/exporter';
import type { ForensicRecord } from '../../../src/types/forensic';

function makeRecord(overrides: Partial<ForensicRecord> = {}): ForensicRecord {
  return {
    id: overrides.id ?? 'fr-export-test',
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

afterEach(() => {
  vi.restoreAllMocks();
});

describe('export caveat wording', () => {
  it('labels the overallScore export gate as severity, with a legacy JSON alias', async () => {
    if (typeof URL.createObjectURL !== 'function') {
      (URL as unknown as { createObjectURL: (blob: Blob) => string }).createObjectURL = () => 'blob:stub';
    }
    if (typeof URL.revokeObjectURL !== 'function') {
      (URL as unknown as { revokeObjectURL: (url: string) => void }).revokeObjectURL = () => undefined;
    }

    let captured: Blob | null = null;
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      captured = blob as Blob;
      return 'blob:export-test';
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    const record = makeRecord();
    const filter = applyExportGate([record], {
      minOverallScore: 5,
    });

    exportJSON([record], filter);

    expect(captured).not.toBeNull();
    const payload = JSON.parse(await captured!.text());
    expect(payload.caveat).toContain('below the severity threshold');
    expect(payload.caveat).not.toContain('below the confidence threshold');
    expect(payload.excluded.below_severity_threshold).toBe(1);
    expect(payload.excluded.low_confidence).toBe(1);
  });

});
