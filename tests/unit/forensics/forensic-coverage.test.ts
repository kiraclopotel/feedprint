/** @vitest-environment jsdom */
// LOOP-031: forensic coverage matrix enforcement.
//
// Asserts the invariants documented in docs/FORENSIC_COVERAGE.md:
//   1. `logEducationalRewrite` (LOOP-032) writes to `feelingwise-forensics`,
//      NOT to the v3 diagnostic store.
//   2. Rewrite records carry the `fr-edu-` id prefix.
//   3. Rewrite records are signed (go through the same addRecord path as
//      detection records, so they pick up LOOP-012 ECDSA signing).
//   4. `PipelineV3ForensicRecord` shape does NOT have `integrityHash` /
//      `signature` / `publicKeyFingerprint` fields — diagnostic, not evidence.
//   5. Legal PDF export signature accepts only `ForensicRecord[]` (TypeScript
//      surface — enforced at compile time, smoke-asserted here).

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoisted mocks.
vi.mock('../../../src/forensics/store', () => ({
  addRecord: vi.fn(async () => undefined),
  getChainState: vi.fn(async () => ({ nextPosition: 0, prevRecordHash: 'feelingwise-chain-genesis-v1' })),
  // Q35: exporter now imports archive-reader -> chain-rotation, which reads
  // this constant at module load.
  FORENSIC_DB_VERSION: 5,
}));
vi.mock('../../../src/forensics/signing', () => ({
  signHash: vi.fn(async () => 'stub-signature'),
  getPublicKeyFingerprint: vi.fn(async () => 'stub-fp'),
}));
vi.mock('../../../src/forensics/hasher', () => ({
  sha256: vi.fn(async (s: string) => `hash-of-${s.length}`),
}));

// 2026-04-28 evening — `logEducationalRewrite` import removed alongside the
// function deletion (replace-toxic-with-educational feature retired). The
// `§2 rewrite records` describe block was reduced to the surviving detection-
// record assertion that doesn't depend on it.
import { logForensicEvent } from '../../../src/forensics/logger';
import { addRecord } from '../../../src/forensics/store';
import { getPublicKeyFingerprint } from '../../../src/forensics/signing';
// §CT-44 (2026-05-06) — `buildV3Record` import removed alongside
// pipeline-v3-writer purge.
import type { ForensicRecord } from '../../../src/types/forensic';
import type { AnalysisResult } from '../../../src/types/analysis';
import { levelOf } from '../../../src/types/mode';

const mockedAddRecord = vi.mocked(addRecord);
const mockedFingerprint = vi.mocked(getPublicKeyFingerprint);

describe('FORENSIC_COVERAGE §2 — detection records route into v1 store', () => {
  beforeEach(() => {
    mockedAddRecord.mockReset();
  });

  // 2026-04-28 evening — `logEducationalRewrite` assertions removed alongside
  // the function deletion. Surviving assertion: detection-record id-prefix
  // discriminator, which is the contract that's still load-bearing for any
  // future rewrite-style record kind (currently only blocked / pass / flagged).
  it('detection record carries `fr-` id prefix (NOT `fr-edu-`)', async () => {
    const analysis: AnalysisResult = {
      postId: 'test',
      techniques: [
        {
          technique: 'fear-appeal',
          present: true,
          confidence: 0.9,
          severity: 7,
          evidence: ['example'],
        },
      ],
      overallScore: 7,
      overallConfidence: 0.9,
      isManipulative: true,
      processingTimeMs: 10,
    };
    await logForensicEvent({
      originalText: 'original',
      neutralizedText: 'neutralized',
      analysis,
      mode: 'teen',
      platform: 'twitter',
      aiSource: 'cloud',
      author: '@poster',
      postUrl: 'https://x.com/poster/status/123',
    });
    const r = mockedAddRecord.mock.calls[0][0];
    expect(r.id).toMatch(/^fr-/);
    expect(r.id).not.toMatch(/^fr-edu-/);
  });

  it('does not write when the signing identity cannot be stamped', async () => {
    mockedFingerprint.mockRejectedValueOnce(new Error('key unavailable'));

    await expect(logForensicEvent({
      originalText: 'original',
      neutralizedText: 'neutralized',
      analysis: {
        postId: 'test',
        techniques: [],
        overallScore: 0,
        overallConfidence: 0,
        isManipulative: false,
        processingTimeMs: 1,
      },
      mode: 'teen',
      platform: 'twitter',
      aiSource: 'cloud',
    })).rejects.toThrow('key unavailable');

    expect(mockedAddRecord).not.toHaveBeenCalled();
  });

  it('keeps the original capture time when a durable delivery drains later', async () => {
    const capturedAt = '2026-07-11T10:00:00.123Z';
    await logForensicEvent({
      originalText: 'captured before signing recovered',
      neutralizedText: 'neutralized',
      analysis: {
        postId: 'test',
        techniques: [],
        overallScore: 0,
        overallConfidence: 0,
        isManipulative: false,
        processingTimeMs: 1,
      },
      mode: 'teen',
      platform: 'twitter',
      aiSource: 'cloud',
    }, 'delivery-delayed', capturedAt);

    expect(mockedAddRecord.mock.calls[0][0].timestamp).toBe(capturedAt);
  });

  it('signs late-after-rotation provenance into the retained record', async () => {
    await logForensicEvent({
      originalText: 'captured before the rotation boundary',
      neutralizedText: 'neutralized',
      analysis: {
        postId: 'test',
        techniques: [],
        overallScore: 0,
        overallConfidence: 0,
        isManipulative: false,
        processingTimeMs: 1,
      },
      mode: 'teen',
      platform: 'twitter',
      aiSource: 'cloud',
    }, 'delivery-late-after-rotation', '2026-07-11T09:59:59.999Z', 'late-after-rotation');

    expect(mockedAddRecord.mock.calls[0][0].detectionMode).toBe(
      'late-after-rotation:unspecified',
    );
  });
});

// §CT-44 (2026-05-06) — `FORENSIC_COVERAGE §1 — v3 records have NO
// integrityHash / signature fields` describe block removed alongside
// pipeline-v3-writer purge. The v3 record shape was diagnostic-only and
// distinct from the signed v1 ForensicRecord; with v3 gone the contract
// no longer needs this guard. The §3 type-signature check below still
// enforces that exporters accept only `ForensicRecord[]`.

describe('FORENSIC_COVERAGE §3 — legal export accepts only ForensicRecord[]', () => {
  it('exportPDF / exportJSON / exportCSV type-signatures are ForensicRecord[] (compile-time smoke)', async () => {
    // TypeScript enforces this at compile time. Runtime smoke: call the
    // exporters with a fabricated minimal ForensicRecord and confirm they
    // accept it. The V3 record shape would fail `tsc --noEmit` — any
    // regression would surface there, not here.
    const exporter = await import('../../../src/forensics/exporter');
    expect(typeof exporter.exportJSON).toBe('function');
    expect(typeof exporter.exportCSV).toBe('function');
    expect(typeof exporter.exportPDF).toBe('function');

    const rec: ForensicRecord = {
      id: 'fr-test',
      timestamp: new Date().toISOString(),
      platform: 'twitter',
      originalText: 't',
      originalHash: 'h',
      originalLength: 1,
      neutralizedText: 'n',
      author: '@a',
      postUrl: '',
      techniques: [{ name: 'fear-appeal', severity: 7, confidence: 0.9 }],
      overallScore: 7,
      userAgeCategory: 'teen',
      aiSource: 'cloud',
      feedSource: 'unknown',
      integrityHash: 'ih',
    };
    // Smoke: exporters accept the array without type cast.
    expect(() => exporter.exportJSON([rec])).not.toThrow();
    expect(() => exporter.exportCSV([rec])).not.toThrow();
  });
});

// Forensic mode fidelity. The chain record's `userAgeCategory` MUST reflect the
// mode that was actually active. Previously `modeToAgeCategory` collapsed
// 'adult' → 'teen', so an adult-mode session was permanently recorded as 'teen'
// in the only universal mode field — a provenance error (the export read
// "teen mode" for an adult user). The value is per-record, so recording the
// truth on new records leaves every existing record's stored value and hash
// untouched.
describe('forensic mode fidelity — userAgeCategory reflects the active mode', () => {
  beforeEach(() => {
    mockedAddRecord.mockReset();
  });

  const analysis: AnalysisResult = {
    postId: 'test',
    techniques: [{ technique: 'fear-appeal', present: true, confidence: 0.9, severity: 7, evidence: ['x'] }],
    overallScore: 7,
    overallConfidence: 0.9,
    isManipulative: true,
    processingTimeMs: 10,
  };

  it.each(['child', 'teen', 'adult'] as const)('mode "%s" is recorded verbatim', async (mode) => {
    await logForensicEvent({
      originalText: 'original',
      neutralizedText: 'neutralized',
      analysis,
      mode,
      platform: 'twitter',
      aiSource: 'cloud',
      author: '@poster',
      postUrl: 'https://x.com/poster/status/123',
    });
    const r = mockedAddRecord.mock.calls[0][0];
    expect(r.userAgeCategory).toBe(levelOf(mode));
  });
});
