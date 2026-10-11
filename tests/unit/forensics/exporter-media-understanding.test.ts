/** @vitest-environment jsdom */
/**
 * Turn 87 — the EXPORT has to carry what the record now knows.
 *
 * A recipient reading an export is the whole point of the record. If the chain
 * can say "video understanding was off on this platform" and the export cannot,
 * the ambiguity that cost three turns simply moves outward to the reader.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildEvidenceReportHTML, exportCSV } from '../../../src/forensics/exporter';
import type { ForensicRecord } from '../../../src/types/forensic';

function makeRecord(overrides: Partial<ForensicRecord> = {}): ForensicRecord {
  return {
    id: 'fr-media-test',
    timestamp: '2026-08-02T00:00:00.000Z',
    platform: 'youtube',
    originalText: 'x',
    originalHash: 'hash',
    originalLength: 1,
    neutralizedText: '',
    author: '@example',
    postUrl: 'https://example.test/post',
    techniques: [{ name: 'fear-appeal', severity: 4, confidence: 0.9 }],
    overallScore: 4,
    userAgeCategory: 'adult',
    aiSource: 'cloud',
    feedSource: 'video',
    integrityHash: 'integrity',
    verdict: 'flagged',
    ...overrides,
  } as ForensicRecord;
}

async function captureCsv(records: ForensicRecord[]): Promise<string> {
  if (typeof URL.createObjectURL !== 'function') {
    (URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = () => 'blob:stub';
  }
  if (typeof URL.revokeObjectURL !== 'function') {
    (URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = () => undefined;
  }
  let captured: Blob | null = null;
  vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => { captured = b as Blob; return 'blob:t'; });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  exportCSV(records);
  return captured ? await (captured as Blob).text() : '';
}

afterEach(() => vi.restoreAllMocks());

describe('CSV export', () => {
  it('carries both media-understanding columns', async () => {
    const csv = await captureCsv([makeRecord({
      configSnapshot: {
        mode: 'adult', threshold: 6, dailyCap: 2000,
        videoUnderstanding: 'platform-excluded', imageUnderstanding: 'on',
      },
    })]);
    const [header, row] = csv.trim().split('\n');
    expect(header).toContain('config_video_understanding,config_image_understanding');
    expect(row).toContain('platform-excluded');
    // Two Q21 columns (config_enabled_features, config_settings_read_failed),
    // visual_applied, text_capture and author_capture follow the media
    // columns, empty here because the fixture carries none of them; action
    // is 'flagged', the fixture's own default verdict; then paid_reading, empty
    // because the paid reading's Claude reader was not asked (11 Oct 2026).
    expect(row.endsWith(',platform-excluded,on,,,,,,flagged,')).toBe(true);
  });

  it('leaves the columns EMPTY on a record that predates the field — never "off"', async () => {
    const csv = await captureCsv([makeRecord({
      configSnapshot: { mode: 'adult', threshold: 6, dailyCap: 2000 },
    })]);
    const row = csv.trim().split('\n')[1];
    expect(row.endsWith(',,,,,,,flagged,')).toBe(true);
    expect(row).not.toContain('off');
  });

  it('carries enabledFeatures and settingsReadFailed (Q21: hashed fields must reach the reader)', async () => {
    const csv = await captureCsv([makeRecord({
      configSnapshot: {
        mode: 'child', threshold: 6, dailyCap: 2000,
        enabledFeatures: ['block-ads', 'parent-blocklist'],
        settingsReadFailed: true,
      },
    })]);
    const [header, row] = csv.trim().split('\n');
    expect(header).toContain('config_enabled_features,config_settings_read_failed');
    expect(row).toContain('block-ads;parent-blocklist');
    // settings_read_failed=true, then the empty visual_applied, text_capture
    // and author_capture columns, then action ('flagged', the default verdict),
    // then the empty paid_reading column.
    expect(row.endsWith(',true,,,,flagged,')).toBe(true);
  });

  it('the column count matches the header on every shape', async () => {
    const csv = await captureCsv([
      makeRecord({ id: 'a', configSnapshot: { mode: 'adult', threshold: 6, dailyCap: 2000 } }),
      makeRecord({ id: 'b', configSnapshot: { mode: 'teen', threshold: 5, dailyCap: 2000, videoUnderstanding: 'on' } }),
      makeRecord({ id: 'c' }),
    ]);
    const lines = csv.trim().split('\n');
    const width = lines[0].split(',').length;
    // Fields are quoted, so count only top-level commas via a naive CSV split.
    // The pattern below matches a zero-width empty field once more at the very
    // end of the string, on top of the real last field, whenever that last
    // field is non-empty (the action column usually is): drop that spurious
    // trailing match rather than the field it doubles.
    for (const line of lines.slice(1)) {
      const cells = line.match(/("([^"]|"")*"|[^,]*)(,|$)/g) ?? [];
      const cellCount = line.endsWith(',') ? cells.length : cells.length - 1;
      expect(cellCount).toBe(width);
    }
  });
});

describe('HTML verification report', () => {
  it('states the media states in plain English, not the raw enum', async () => {
    const html = await buildEvidenceReportHTML([makeRecord({
      configSnapshot: {
        mode: 'adult', threshold: 6, dailyCap: 2000,
        videoUnderstanding: 'platform-excluded', imageUnderstanding: 'unlicensed',
      },
    })], 'en');
    expect(html).toContain('Media Safety Signals=off (not available on this platform)');
    expect(html).toContain('Image Safety Signals=off (no paid licence)');
  });

  it('renders enabledFeatures and the settings-read-failed note (Q21)', async () => {
    const html = await buildEvidenceReportHTML([makeRecord({
      configSnapshot: {
        mode: 'child', threshold: 6, dailyCap: 2000,
        enabledFeatures: ['block-ads', 'parent-blocklist'],
        settingsReadFailed: true,
      },
    })], 'en');
    expect(html).toContain('Protections on at capture');
    expect(html).toContain('block-ads, parent-blocklist');
    expect(html).toContain('Settings were unreadable when this record was written');
  });

  it('has Romanian parity for every state', async () => {
    const states = ['on', 'off', 'unlicensed', 'platform-excluded', 'surface-excluded'] as const;
    for (const state of states) {
      const record = makeRecord({
        configSnapshot: { mode: 'adult', threshold: 6, dailyCap: 2000, videoUnderstanding: state },
      });
      const en = await buildEvidenceReportHTML([record], 'en');
      const ro = await buildEvidenceReportHTML([record], 'ro');
      expect(en).toContain('Media Safety Signals=');
      expect(ro).toContain('Media Safety Signals=');
      // No untranslated key ever reaches a reader.
      expect(ro).not.toContain(`mediaState_${state}`);
      expect(en).not.toContain(`mediaState_${state}`);
      // The feature NAME is a brand name in both locales; the STATE must translate.
      if (state !== 'on') expect(ro).toContain('oprit');
    }
  });

  it('says nothing at all when the record does not carry the fields', async () => {
    const html = await buildEvidenceReportHTML([makeRecord({
      configSnapshot: { mode: 'adult', threshold: 6, dailyCap: 2000 },
    })], 'en');
    expect(html).toContain('dailyCap=2000');
    expect(html).not.toContain('Media Safety Signals');
    expect(html).not.toContain('Image Safety Signals');
  });
});
