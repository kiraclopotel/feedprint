// @vitest-environment jsdom
//
// What a record says when the page did something other than rewrite: a Child video skipped, an
// Adult caption marked in yellow, a Child hide after a rewrite that did not land. Each is built with
// the record's own producers (decisionForJudge, rewriteStage, verdictFor) and read back through the
// dashboard's card, the export's card and the standalone checker. A card must say what happened, never
// that a rewrite was too harmful, softened, or shown, when none was; and the checker must still pass
// on a chain that carries the values, and refuse one whose values were changed.

import { beforeAll, describe, expect, it } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';

import { buildBrowserVerifierSource, BROWSER_VERIFIER_PATH } from '../../../scripts/build-standalone-verifier';
import { attachSignedManifest, buildForensicHtmlExport, FEED_SCRIPT, I18N, type ExportMetadata } from '../../../src/forensics/html-export';
import { computeRecordIntegrityHash } from '../../../src/forensics/canonical-payload';
import { EXPORT_NUMBERS_INLINE_SOURCE } from '../../../src/forensics/export-numbers-inline';
import { FeedCard } from '../../../src/ui/dashboard/components/FeedCard';
import { I18nProvider } from '../../../src/i18n/react';
import { UI_LANGUAGES } from '../../../src/i18n';
import { DASHBOARD_STRINGS } from '../../../src/i18n/dashboard-strings';
import { decisionForJudge, rewriteStage } from '../../../src/content/record/decision';
import { verdictFor } from '../../../src/core/policy/table';
import type { DecisionAction, ForensicRecord } from '../../../src/types/forensic';

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}

type Judge = Parameters<typeof decisionForJudge>[0]['judge'];
function judge(severity: number): Judge {
  return { id: 'judge-v1', hash: 'h', model: 'm', provider: 'p', charged: true, family: 'hostility', severity, effect: 'pressure', intent: 'x' } as unknown as Judge;
}

let seq = 0;
function record(
  mode: 'child' | 'teen' | 'adult',
  severity: number,
  applied: DecisionAction,
  rewrite: { attempted: boolean; outcome: string } | null,
  neutralizedText = '',
): ForensicRecord {
  seq++;
  const decision = decisionForJudge({ mode, judge: judge(severity), provider: 'p', applied, mask: false, rewrite });
  return {
    id: `v-${seq}`, timestamp: `2026-09-26T01:00:0${seq}.000Z`, platform: 'tiktok', originalText: 'a hostile caption with words', originalHash: 'h',
    originalLength: 28, neutralizedText, author: '@user', postUrl: '', techniques: [{ name: 'combined', severity, confidence: 0.9 }],
    overallScore: severity, userAgeCategory: mode, aiSource: 'cloud', feedSource: 'for-you', publicKeyFingerprint: 'fp', chainPosition: seq - 1,
    prevRecordHash: '', kind: 'video', verdict: verdictFor(applied), decision, reader: 'default',
  } as unknown as ForensicRecord;
}

const OFF = { attempted: false, outcome: 'off' };

/** A Child video skipped at a severity where the table itself asks only for a mark (J7). */
const childSkipLowSeverity = () => record('child', 5, 'hide', OFF);
/** A Child video skipped at a severity where the table asks for a hide (J2). */
const childSkipHighSeverity = () => record('child', 8, 'hide', OFF);
/** An Adult yellow caption. */
const adultYellow = () => record('adult', 8, 'mark', OFF);
/** A Child hide after a rewrite that did not land. */
const childHideAfterFailedRewrite = () => record('child', 8, 'hide', rewriteStage(false, null));
/** A hide the table chose with no rewrite stage at all: the historic case the sentence was written for. */
const legacyTableHide = () => { const r = record('child', 9, 'hide', null); return r; };
/** A rewrite that landed: the control for everything that says "softened". */
const softened = () => record('teen', 6, 'soften', rewriteStage(true, { model: 'm' }), 'a calm caption');

function dashboardCard(r: ForensicRecord, lang: (typeof UI_LANGUAGES)[number] = 'en'): string {
  return renderToStaticMarkup(React.createElement(I18nProvider, { lang, children: React.createElement(FeedCard, { record: r }) }));
}

const META: ExportMetadata = { fwVersion: 'V-test', publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'A', y: 'B' }, publicKeyFingerprint: 'fp', locale: 'en' };

function exportCardText(r: ForensicRecord): string {
  const html = buildForensicHtmlExport([r], META);
  const m = html.match(/<script type="application\/json" id="fw-export-data">([\s\S]*?)<\/script>/);
  expect(m).not.toBeNull();
  (window as unknown as { __FW_EXPORT__: unknown }).__FW_EXPORT__ = JSON.parse(m![1]);
  document.body.innerHTML = '<div id="fw-feed"></div>';
  new Function(`${EXPORT_NUMBERS_INLINE_SOURCE};${FEED_SCRIPT}`)();
  return (document.getElementById('fw-feed') as HTMLElement).textContent ?? '';
}

describe('the records are built as the post path builds them', () => {
  it('a Child skip says hide with no rewrite; a yellow caption says mark; a hide after a failed rewrite says so', () => {
    const skip = childSkipHighSeverity();
    expect(skip.decision).toMatchObject({ applied: 'hide', rewrite: OFF });
    expect(skip.verdict).toBe('flagged-hidden');
    expect(skip.neutralizedText).toBe('');

    const yellow = adultYellow();
    expect(yellow.decision).toMatchObject({ applied: 'mark', rewrite: OFF });
    expect(yellow.verdict).toBe('flagged');

    const failed = childHideAfterFailedRewrite();
    expect(failed.decision).toMatchObject({ applied: 'hide', rewrite: { attempted: true, outcome: 'failed' } });
    expect(failed.verdict).toBe('flagged-hidden');
  });

  it('a low-severity Child skip is one where the table alone would only have marked', () => {
    // The premise of the card tests below: the hide here is not the table's.
    expect(childSkipLowSeverity().decision).toMatchObject({ action: 'mark', applied: 'hide' });
  });
});

describe('the dashboard card', () => {
  it.each(UI_LANGUAGES)('%s: says no rewrite was shown for a record where none was', (lang) => {
    const t = DASHBOARD_STRINGS[lang];
    for (const r of [childSkipLowSeverity(), childSkipHighSeverity(), adultYellow(), childHideAfterFailedRewrite()]) {
      const html = dashboardCard(r, lang);
      expect(html, `${lang} ${r.decision!.applied}: no "shown to the ... as" head`).not.toContain(t.feedShownAs(r.userAgeCategory as never));
      expect(html, `${lang}: no rewrite text block`).not.toContain('fc-shown-text');
    }
  });

  it.each(UI_LANGUAGES)('%s: a hide the table did not choose is not called too harmful to rewrite', (lang) => {
    const t = DASHBOARD_STRINGS[lang];
    // Child skip where the table asked only for a mark, and a hide that came after a rewrite was tried.
    expect(dashboardCard(childSkipLowSeverity(), lang), `${lang} skip`).not.toContain(t.feedHarmFloorNote);
    expect(dashboardCard(childHideAfterFailedRewrite(), lang), `${lang} failed rewrite`).not.toContain(t.feedHarmFloorNote);
  });

  it.each(UI_LANGUAGES)('%s: a hide the table chose, with no rewrite tried, still says why', (lang) => {
    const t = DASHBOARD_STRINGS[lang];
    expect(dashboardCard(legacyTableHide(), lang), `${lang} table hide`).toContain(t.feedHarmFloorNote);
    expect(dashboardCard(childSkipHighSeverity(), lang), `${lang} table hide at 8, video skip`).toContain(t.feedHarmFloorNote);
  });

  it('a hidden card still offers the verbatim record, whichever note it carries', () => {
    for (const r of [childSkipLowSeverity(), childHideAfterFailedRewrite(), legacyTableHide()]) {
      expect(dashboardCard(r)).toContain(DASHBOARD_STRINGS.en.feedRevealVerbatim);
    }
  });

  it('a rewrite that landed still shows its text, the control for the above', () => {
    const html = dashboardCard(softened());
    expect(html).toContain('a calm caption');
    expect(html).toContain('fc-shown-text');
  });
});

describe('the export card', () => {
  it('says softened only for a record that holds a rewrite', () => {
    for (const r of [childSkipLowSeverity(), childSkipHighSeverity(), adultYellow(), childHideAfterFailedRewrite()]) {
      const text = exportCardText(r);
      expect(text, r.decision!.applied).not.toContain(I18N.en.feedSoftened);
      expect(text).not.toContain(I18N.en.feedRewriteBeta);
      expect(text).toContain('a hostile caption with words');
    }
    const control = exportCardText(softened());
    expect(control).toContain(I18N.en.feedSoftened);
    expect(control).toContain('a calm caption');
  });

  it('names what was done in the reader\'s words: hidden for a skip, marked for a yellow caption', () => {
    expect(exportCardText(childSkipHighSeverity())).toContain(DASHBOARD_STRINGS.en.feedDecisionAction.hide);
    const yellow = exportCardText(adultYellow());
    expect(yellow).toContain(DASHBOARD_STRINGS.en.feedDecisionShownAs);
    expect(yellow).toContain(DASHBOARD_STRINGS.en.feedDecisionAction.mark);
  });
});

interface FWVerifier {
  verifyExportText(text: string): Promise<{ state: string; manifest: string; records: number; failures: Array<{ index: number; id: string | null; reason: string }> }>;
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
    const shapes = [childSkipLowSeverity(), childSkipHighSeverity(), adultYellow(), childHideAfterFailedRewrite(), softened()];
    const records: ForensicRecord[] = [];
    let prev = '';
    for (let i = 0; i < shapes.length; i++) {
      const base = { ...shapes[i], publicKeyFingerprint: fp, chainPosition: i, prevRecordHash: prev } as Omit<ForensicRecord, 'integrityHash' | 'signature' | 'chainAnchor'>;
      const integrityHash = await computeRecordIntegrityHash(base);
      records.push({ ...base, integrityHash, signature: await sign(integrityHash) } as ForensicRecord);
      prev = integrityHash;
    }
    signedHtml = await attachSignedManifest(
      buildForensicHtmlExport(records, { fwVersion: 'V-test', publicKeyJwk: jwk, publicKeyFingerprint: fp, locale: 'en' }),
      sign,
    );
    const src = readFileSync(BROWSER_VERIFIER_PATH, 'utf8');
    expect(src).toBe(buildBrowserVerifierSource());
    new Function('window', 'crypto', 'atob', 'TextEncoder', src)(window, crypto, atob, TextEncoder);
    api = (window as unknown as { FWVerifier: FWVerifier }).FWVerifier;
  });

  function withRecord(edit: (r: ForensicRecord) => void): string {
    return signedHtml.replace(/(<script type="application\/json" id="fw-export-data">)([\s\S]*?)(<\/script>)/, (_m, open: string, body: string, close: string) => {
      const data = JSON.parse(body) as { records: ForensicRecord[]; manifest?: unknown };
      edit(data.records[0]);
      delete data.manifest;
      return open + JSON.stringify(data).replace(/</g, '\\u003c') + close;
    });
  }

  it('verifies a chain that carries a skip, a yellow caption, a hide after a failed rewrite and a rewrite', async () => {
    const report = await api.verifyExportText(signedHtml);
    expect(report.failures).toEqual([]);
    expect(report.state).toBe('verified');
    expect(report.records).toBe(5);
  });

  it('refuses a record whose applied action was changed, since the values are inside the signed hash', async () => {
    const report = await api.verifyExportText(withRecord((r) => { (r.decision as { applied: string }).applied = 'soften'; }));
    expect(report.state).toBe('failed');
    expect(report.failures[0]?.index).toBe(0);
  });

  it('refuses a record whose rewrite outcome was changed from off to applied', async () => {
    const report = await api.verifyExportText(withRecord((r) => { (r.decision as { rewrite: { outcome: string } }).rewrite.outcome = 'applied'; }));
    expect(report.state).toBe('failed');
    expect(report.failures[0]?.index).toBe(0);
  });
});
