// @vitest-environment jsdom
//
// The record signs the level a person set (strict, moderate, relaxed), not an age they never gave. The
// three signed fields that carried the setting (userAgeCategory, configSnapshot.mode,
// decision.household.mode) keep their names; new records carry the level, records written before keep
// 'child', 'teen' or 'adult' and their hash. The checker verifies a chain that mixes both, and every
// screen that shows the setting names the level, or the old id marked as the setting before the levels.

import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';

import { buildBrowserVerifierSource, BROWSER_VERIFIER_PATH } from '../../../scripts/build-standalone-verifier';
import { attachSignedManifest, buildForensicHtmlExport, I18N, modeLabel } from '../../../src/forensics/html-export';
import { buildEvidenceReportHTML } from '../../../src/forensics/exporter';
import { computeRecordIntegrityHash } from '../../../src/forensics/canonical-payload';
import { decisionForJudge } from '../../../src/content/record/decision';
import { buildConfigSnapshot } from '../../../src/content/record/config-snapshot';
import { DASHBOARD_STRINGS } from '../../../src/i18n/dashboard-strings';
import { UI_LANGUAGES } from '../../../src/i18n';
import { levelOf, levelOfRecorded, isBeforeLevels, type Mode, type RecordedMode } from '../../../src/types/mode';
import type { ForensicRecord } from '../../../src/types/forensic';

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}

type Judge = Parameters<typeof decisionForJudge>[0]['judge'];
const JUDGE = { id: 'judge-v1', hash: 'h', model: 'm', provider: 'p', charged: true, family: 'hostility', severity: 8, effect: 'pressure', intent: 'x' } as unknown as Judge;
const OFF = { attempted: false, outcome: 'off' };

/** A record as the post path writes it today, in the given setting. */
function newRecord(mode: Mode, i = 0): Omit<ForensicRecord, 'integrityHash' | 'signature' | 'chainAnchor'> {
  return {
    id: `new-${mode}-${i}`, timestamp: `2026-10-05T10:00:0${i}.000Z`, platform: 'x', originalText: 'a hostile post', originalHash: 'oh',
    originalLength: 14, neutralizedText: '', author: '@new', postUrl: '', techniques: [{ name: 'combined', severity: 8, confidence: 0.9 }],
    overallScore: 8, userAgeCategory: levelOf(mode), aiSource: 'cloud', feedSource: 'for-you', publicKeyFingerprint: 'fp', chainPosition: i,
    prevRecordHash: '', kind: 'post', verdict: 'flagged-hidden', reader: 'default',
    configSnapshot: buildConfigSnapshot(mode, 4, 2000),
    decision: decisionForJudge({ mode, judge: JUDGE, provider: 'p', applied: 'hide', mask: false, rewrite: OFF }),
  } as unknown as Omit<ForensicRecord, 'integrityHash' | 'signature' | 'chainAnchor'>;
}

// A record written before the levels, fixed here as data: 'child' in all three fields.
const OLD_RECORD = {
  id: 'old-1', timestamp: '2026-09-25T10:00:00.000Z', platform: 'tiktok', originalText: 'an old caption', originalHash: 'oh',
  originalLength: 14, neutralizedText: '', author: '@old', postUrl: '', techniques: [{ name: 'combined', severity: 5, confidence: 0.9 }],
  overallScore: 5, userAgeCategory: 'child', aiSource: 'cloud', feedSource: 'for-you', publicKeyFingerprint: 'fp', chainPosition: 0,
  prevRecordHash: '', kind: 'video', verdict: 'flagged-hidden', reader: 'default',
  configSnapshot: { mode: 'child', threshold: 4, dailyCap: 2000 },
  decision: {
    judge: { id: 'judge-v1', hash: 'h', model: 'm', provider: 'p' },
    reading: { charged: true, family: 'hostility', severity: 5, effect: 'pressure', intent: 'x' },
    descriptor: null, rails: [], household: { mode: 'child', reader: 'default', topicRule: null, mask: false },
    row: 'J7', action: 'hide', applied: 'hide', rewrite: { attempted: false, outcome: 'off' }, note: null,
  },
} as unknown as Omit<ForensicRecord, 'integrityHash' | 'signature' | 'chainAnchor'>;

describe('the level', () => {
  it('child is strict, teen is moderate, adult is relaxed', () => {
    expect([levelOf('child'), levelOf('teen'), levelOf('adult')]).toEqual(['strict', 'moderate', 'relaxed']);
  });

  it('a signed value names its level whichever side of the change it was written on', () => {
    expect(['child', 'strict', 'teen', 'moderate', 'adult', 'relaxed', 'other', undefined].map(levelOfRecorded))
      .toEqual(['strict', 'strict', 'moderate', 'moderate', 'relaxed', 'relaxed', null, null]);
    expect(['child', 'teen', 'adult'].every((v) => isBeforeLevels(v))).toBe(true);
    expect(['strict', 'moderate', 'relaxed'].some((v) => isBeforeLevels(v))).toBe(false);
  });

  it.each(['child', 'teen', 'adult'] as const)('a new %s record carries the level in all three signed fields', (mode) => {
    const r = newRecord(mode);
    expect([r.userAgeCategory, r.configSnapshot!.mode, r.decision!.household.mode]).toEqual([levelOf(mode), levelOf(mode), levelOf(mode)]);
  });
});

describe('an old record keeps its hash', () => {
  it("'child' in all three fields hashes as it always did", async () => {
    expect(await computeRecordIntegrityHash(OLD_RECORD)).toBe('21611e5fd9e093dd54ec1061108d4461ccc654dd63e46126342340e7f5bf4347');
  });
});

interface FWVerifier {
  verifyExportText(text: string): Promise<{ state: string; records: number; failures: Array<{ index: number; reason: string }> }>;
}

describe('the standalone checker', () => {
  let signedHtml = '';
  let api: FWVerifier;

  beforeAll(async () => {
    const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const full = await crypto.subtle.exportKey('jwk', kp.publicKey);
    const jwk: JsonWebKey = { kty: 'EC', crv: 'P-256', x: full.x, y: full.y };
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${jwk.x}|${jwk.y}`));
    const fp = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
    const sign = async (hash: string): Promise<string> => {
      const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: { name: 'SHA-256' } }, kp.privateKey, new TextEncoder().encode(hash));
      return Buffer.from(sig).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    };
    const shapes = [OLD_RECORD, newRecord('child', 1), newRecord('teen', 2), newRecord('adult', 3)];
    const records: ForensicRecord[] = [];
    let prev = '';
    for (let i = 0; i < shapes.length; i++) {
      const base = { ...shapes[i], publicKeyFingerprint: fp, chainPosition: i, prevRecordHash: prev } as Omit<ForensicRecord, 'integrityHash' | 'signature' | 'chainAnchor'>;
      const integrityHash = await computeRecordIntegrityHash(base);
      records.push({ ...base, integrityHash, signature: await sign(integrityHash) } as ForensicRecord);
      prev = integrityHash;
    }
    signedHtml = await attachSignedManifest(buildForensicHtmlExport(records, { fwVersion: 'V-test', publicKeyJwk: jwk, publicKeyFingerprint: fp, locale: 'en' }), sign);
    const src = readFileSync(BROWSER_VERIFIER_PATH, 'utf8');
    expect(src).toBe(buildBrowserVerifierSource());
    new Function('window', 'crypto', 'atob', 'TextEncoder', src)(window, crypto, atob, TextEncoder);
    api = (window as unknown as { FWVerifier: FWVerifier }).FWVerifier;
  });

  it('verifies a chain that mixes an old record with records in each level', async () => {
    const report = await api.verifyExportText(signedHtml);
    expect(report.failures).toEqual([]);
    expect(report.state).toBe('verified');
    expect(report.records).toBe(4);
  });

  it('refuses a record whose level was rewritten to the old id', async () => {
    const tampered = signedHtml.replace(/(<script type="application\/json" id="fw-export-data">)([\s\S]*?)(<\/script>)/, (_m, open: string, body: string, close: string) => {
      const data = JSON.parse(body) as { records: ForensicRecord[]; manifest?: unknown };
      (data.records[1] as { userAgeCategory: RecordedMode }).userAgeCategory = 'child';
      delete data.manifest;
      return open + JSON.stringify(data).replace(/</g, '\\u003c') + close;
    });
    const report = await api.verifyExportText(tampered);
    expect(report.state).toBe('failed');
    expect(report.failures[0]?.index).toBe(1);
  });
});

describe('the screens name the level', () => {
  it.each(UI_LANGUAGES)('%s: the export and the printable report name a level, and mark an old id as the setting before', async (lang) => {
    const t = I18N[lang];
    expect(modeLabel('strict', t)).toBe(t.epochModeStrict);
    expect(modeLabel('moderate', t)).toBe(t.epochModeModerate);
    expect(modeLabel('relaxed', t)).toBe(t.epochModeRelaxed);
    expect(modeLabel('child', t)).toBe(`${t.epochModeChild} ${t.epochModeBeforeLevels}`);
    const fresh = await buildEvidenceReportHTML([{ ...newRecord('child'), integrityHash: 'ih', signature: 's' } as ForensicRecord], lang);
    expect(fresh).toContain(`</span> ${t.epochModeStrict}</div>`);
    const old = await buildEvidenceReportHTML([{ ...OLD_RECORD, integrityHash: 'ih', signature: 's' } as ForensicRecord], lang);
    expect(old).toContain(`${t.epochModeChild} ${t.epochModeBeforeLevels}`);
  });

  it.each(UI_LANGUAGES)('%s: the dashboard card speaks to the person on every record, old or new', (lang) => {
    const t = DASHBOARD_STRINGS[lang];
    for (const value of ['strict', 'moderate', 'relaxed', 'child', 'teen'] as const) expect(t.feedShownAs(value)).toBe(t.feedShownAs('adult'));
    expect(Object.keys(t.railMode).sort()).toEqual(['moderate', 'relaxed', 'strict']);
  });
});
