/** @vitest-environment jsdom */
//
// A file that carries more than one signing key must describe each key on
// its own (owner item 8, 2026-09-03): his consolidated export read
// "Recorded by FeelingWise V2.3.0" and "Chain positions in this file: 0 to
// 0" over ten keys and three months of records judged by different models.
// Locks: per-key rows with records, position runs walked inside the key,
// period and models; the export's key marked as checkable and the others as
// hash-only; "Exported by" replacing "Recorded by"; and a single-key file
// keeping its short header unchanged.

import { describe, expect, it } from 'vitest';
import type { ForensicRecord } from '../../../src/types/forensic';
import {
  buildForensicHtmlExport,
  computeEpochSummaries,
  I18N,
} from '../../../src/forensics/html-export';

function record(fp: string, position: number, day: number, over: Partial<ForensicRecord> = {}): ForensicRecord {
  return {
    id: `fr-${fp}-${position}-${day}`,
    timestamp: new Date(Date.UTC(2026, 5, day, 0, 0, position % 60)).toISOString(),
    platform: 'twitter',
    originalText: `t${position}`,
    originalHash: `oh${position}`,
    originalLength: 2,
    techniques: [],
    overallScore: 0,
    userAgeCategory: 'adult',
    chainPosition: position,
    integrityHash: `h${fp}${position}`,
    publicKeyFingerprint: fp,
    ...over,
  } as ForensicRecord;
}

const ACTIVE = 'fd3577e462c42ebc';
const OLD_A = 'c77cfc0df6327079';
const OLD_B = 'ba33893920938125';

function buildHtml(records: ForensicRecord[]): string {
  return buildForensicHtmlExport(records, {
    fwVersion: 'FeelingWise V2.3.0',
    publicKeyJwk: {},
    publicKeyFingerprint: ACTIVE,
    locale: 'en',
  });
}

function multiKeySet(): ForensicRecord[] {
  return [
    // the export's own key: two month runs, one gap inside the second
    record(ACTIVE, 0, 20, { aiModel: 'openai/gpt-oss-20b' }),
    record(ACTIVE, 1, 20, { aiModel: 'openai/gpt-oss-20b' }),
    record(ACTIVE, 2, 21),
    record(ACTIVE, 0, 25, { kind: 'month-rotation-marker' }),
    record(ACTIVE, 1, 25),
    record(ACTIVE, 3, 26),
    // an earlier generation that also starts at 0 and begins above 0 once
    record(OLD_A, 5, 10, { chainAnchor: 'pre-rekey', aiModel: 'llama-3.1-8b-instant' }),
    record(OLD_A, 6, 10, { chainAnchor: 'pre-rekey', aiModel: 'llama-3.1-8b-instant' }),
    record(OLD_A, 7, 11, { chainAnchor: 'pre-rekey' }),
    // an older one with no model at all
    record(OLD_B, 0, 1, { chainAnchor: 'pre-rekey' }),
    record(OLD_B, 1, 2, { chainAnchor: 'pre-rekey' }),
  ];
}

describe('computeEpochSummaries', () => {
  it('walks runs inside each key, never across keys, and lists models', () => {
    const epochs = computeEpochSummaries(multiKeySet(), ACTIVE);
    expect(epochs.map(e => e.fingerprint)).toEqual([ACTIVE, OLD_B, OLD_A]);

    const active = epochs[0];
    expect(active.keyInFile).toBe(true);
    expect(active.records).toBe(6);
    expect(active.runs).toEqual([
      { first: 0, last: 2, count: 3 },
      { first: 0, last: 3, count: 3 },
    ]);
    expect(active.gapsInside).toBe(1);
    expect(active.missingBefore).toBe(0);
    expect(active.models).toEqual(['openai/gpt-oss-20b']);

    const oldA = epochs[2];
    expect(oldA.keyInFile).toBe(false);
    expect(oldA.runs).toEqual([{ first: 5, last: 7, count: 3 }]);
    expect(oldA.missingBefore).toBe(5);
    expect(oldA.models).toEqual(['llama-3.1-8b-instant']);

    expect(epochs[1].models).toEqual([]);
  });

  it('a key the file carries is checkable and sorts before the keys it does not', () => {
    const epochs = computeEpochSummaries(multiKeySet(), ACTIVE, new Set([OLD_A]));
    expect(epochs.map(e => e.fingerprint)).toEqual([ACTIVE, OLD_A, OLD_B]);
    expect(epochs[0].ownKey).toBe(true);
    expect(epochs[1]).toMatchObject({ ownKey: false, keyInFile: true });
    expect(epochs[2]).toMatchObject({ ownKey: false, keyInFile: false });
  });

  it('groups records with no fingerprint under an empty key', () => {
    const epochs = computeEpochSummaries([record('', 0, 1), record('', 1, 1)], ACTIVE);
    expect(epochs).toHaveLength(1);
    expect(epochs[0].fingerprint).toBe('');
    expect(epochs[0].keyInFile).toBe(false);
  });
});

describe('page-one summary for a multi-key file', () => {
  it('renders one row per key, marks the checkable key, and says "Exported by"', () => {
    const html = buildHtml(multiKeySet());
    expect(html).toContain(`${I18N.en.summaryKeysInFile}:</dt><dd data-fw-prov="keysInFile">3`);
    expect(html).toContain(`${I18N.en.summaryExportedBy}:</dt><dd data-fw-prov="capturedBy">FeelingWise V2.3.0`);
    expect(html).not.toContain(`${I18N.en.capturedBy}:</dt>`);
    // the misleading single range line is gone
    expect(html).not.toContain(`${I18N.en.summaryChainRange}:</dt>`);

    document.body.innerHTML = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>'));
    const rows = Array.from(document.querySelectorAll('.fw-epochs tbody tr'));
    expect(rows).toHaveLength(3);
    expect(rows[0].textContent).toContain(ACTIVE);
    expect(rows[0].textContent).toContain(I18N.en.epochActiveKey);
    expect(rows[0].textContent).toContain('0 to 3, 2 runs, 1 gaps inside');
    expect(rows[0].textContent).toContain('2026-06-20 to 2026-06-26');
    expect(rows[0].textContent).toContain('openai/gpt-oss-20b');
    expect(rows[2].textContent).toContain(OLD_A);
    expect(rows[2].textContent).toContain(I18N.en.epochPriorKey);
    expect(rows[2].textContent).toContain('5 to 7, 5 missing before');
    expect(rows[1].textContent).toContain(I18N.en.epochNoModel);
  });

  it('a carried key is embedded for the verifier and its row says the key was supplied with the records', () => {
    const jwk: JsonWebKey = { kty: 'EC', crv: 'P-256', x: 'x-old-a', y: 'y-old-a' };
    const html = buildForensicHtmlExport(multiKeySet(), {
      fwVersion: 'FeelingWise V2.3.0',
      publicKeyJwk: {},
      publicKeyFingerprint: ACTIVE,
      publicKeys: [{ fingerprint: ACTIVE, jwk: {} }, { fingerprint: OLD_A, jwk }],
      locale: 'en',
    });
    expect(html).toContain(`${I18N.en.summaryKeysInFile}:</dt><dd data-fw-prov="keysInFile">3, 2 of them supplied with the records`);
    expect(html).toContain('"publicKeys":[{"fingerprint":"fd3577e462c42ebc","jwk":{}},{"fingerprint":"c77cfc0df6327079","jwk":{"kty":"EC","crv":"P-256","x":"x-old-a","y":"y-old-a"}}]');
    document.body.innerHTML = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>'));
    const rows = Array.from(document.querySelectorAll('.fw-epochs tbody tr'));
    expect(rows[1].textContent).toContain(OLD_A);
    expect(rows[1].textContent).toContain(I18N.en.epochCarriedKey);
    expect(rows[2].textContent).toContain(I18N.en.epochPriorKey);
  });

  it('a single-key file keeps the short header: no table, "Recorded by", the range line', () => {
    const html = buildHtml([record(ACTIVE, 0, 1), record(ACTIVE, 1, 1)]);
    expect(html).not.toContain('<table class="fw-epochs"');
    expect(html).not.toContain(`${I18N.en.summaryKeysInFile}:</dt>`);
    expect(html).toContain(`${I18N.en.capturedBy}:</dt><dd data-fw-prov="capturedBy">FeelingWise V2.3.0`);
    expect(html).toContain(`${I18N.en.summaryChainRange}:</dt><dd data-fw-prov="chainRange">0 to 1`);
  });

  it('says "Exported with", not "Recorded with", for a single key whose records span more than one build', () => {
    // One signing key, never reinstalled, can still carry records written by
    // many app updates over time. "Recorded with FeelingWise V2.3.0" would
    // name only the build that happened to run the export, over records the
    // builds row (right above it) shows were written by a different one.
    const html = buildHtml([
      record(ACTIVE, 0, 1, { buildId: 'c87b4846' }),
      record(ACTIVE, 1, 2, { buildId: 'dc840e5c' }),
    ]);
    expect(html).not.toContain('<table class="fw-epochs"');
    expect(html).toContain(`${I18N.en.summaryExportedBy}:</dt><dd data-fw-prov="capturedBy">FeelingWise V2.3.0`);
    expect(html).not.toContain(`${I18N.en.capturedBy}:</dt>`);
  });
});
