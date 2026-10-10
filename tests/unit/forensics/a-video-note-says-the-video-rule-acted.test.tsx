// @vitest-environment jsdom
//
// The note under a card whose applied action differs from the policy row's. For a video the mode's video
// rule chose (Child skips it, Adult marks its caption in yellow) the note says so, in two fixed signed
// sentences, instead of "the legacy path acted before the table was wired". Old records keep their words
// and their hash; the checker takes the new sentences as data; a sentence the page does not know prints
// as written.

import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';

import { buildBrowserVerifierSource, BROWSER_VERIFIER_PATH } from '../../../scripts/build-standalone-verifier';
import { attachSignedManifest, buildForensicHtmlExport, FEED_SCRIPT, I18N, type ExportMetadata } from '../../../src/forensics/html-export';
import { computeRecordIntegrityHash } from '../../../src/forensics/canonical-payload';
import { EXPORT_NUMBERS_INLINE_SOURCE } from '../../../src/forensics/export-numbers-inline';
import { UI_LANGUAGES } from '../../../src/i18n';
import {
  decisionForJudge, decisionForLegacy, rewriteStage, NOTE_AD_HIDDEN, NOTE_LEGACY_ACTED, NOTE_NOT_APPLIED, NOTE_VIDEO_SKIPPED, NOTE_VIDEO_MARKED, NOTE_VIDEO_FOLDED,
} from '../../../src/content/record/decision';
import { verdictFor } from '../../../src/core/policy/table';
import type { DecisionAction, ForensicRecord } from '../../../src/types/forensic';

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}

type Judge = Parameters<typeof decisionForJudge>[0]['judge'];
const judge = (severity: number): Judge =>
  ({ id: 'judge-v1', hash: 'h', model: 'm', provider: 'p', charged: true, family: 'hostility', severity, effect: 'pressure', intent: 'x' } as unknown as Judge);
const OFF = { attempted: false, outcome: 'off' };

function block(mode: 'child' | 'teen' | 'adult', severity: number, applied: DecisionAction, extra: { videoRule?: 'skipped' | 'marked' | 'folded'; landed?: boolean; rewrite?: { attempted: boolean; outcome: string } } = {}) {
  return decisionForJudge({ mode, judge: judge(severity), provider: 'p', applied, mask: false, rewrite: extra.rewrite ?? OFF, videoRule: extra.videoRule, landed: extra.landed });
}

describe('the note the record writes', () => {
  it('a Child skip where the row asked for something else says the video rule skipped it', () => {
    const d = block('child', 5, 'hide', { videoRule: 'skipped' });
    expect(d.action).not.toBe('hide');
    expect(d.note).toBe(NOTE_VIDEO_SKIPPED);
  });

  it('an Adult yellow caption where the row asked for something else says the video rule marked it', () => {
    const d = block('adult', 8, 'mark', { videoRule: 'marked' });
    expect(d.action).not.toBe('mark');
    expect(d.note).toBe(NOTE_VIDEO_MARKED);
  });

  it('a fold on a video turned into a hide says the video rule hid it, and only when a hide was applied', () => {
    const d = block('adult', 8, 'hide', { videoRule: 'folded' });
    expect(d.action).toBe('collapse');
    expect(d.note).toBe(NOTE_VIDEO_FOLDED);
    expect(block('adult', 8, 'mark', { videoRule: 'folded' }).note).not.toBe(NOTE_VIDEO_FOLDED);
    expect(block('adult', 8, 'hide', { videoRule: 'folded', landed: false }).note).toBe(NOTE_NOT_APPLIED);
    expect(block('child', 8, 'hide', { videoRule: 'folded' }).note).toBeNull();
  });

  it('the same for a record with no judge (a rail row): a folded sponsored video says the video rule hid it', () => {
    const facts = { mode: 'teen' as const, detectionMode: 'sponsored-ad', techniques: ['consumer-rapid-frame'], severity: 6, applied: 'hide' as const, mask: false };
    // Since 9 Oct 2026 a hidden ad says Block ads hid it (a-hidden-ad-says-block-ads-hid-it); the video rule still wins.
    expect(decisionForLegacy(facts)!.note).toBe(NOTE_AD_HIDDEN);
    expect(decisionForLegacy({ ...facts, videoRule: 'folded' })!.note).toBe(NOTE_VIDEO_FOLDED);
  });

  it('carries no note when what was shown is what the row asked for', () => {
    expect(block('child', 8, 'hide', { videoRule: 'skipped' }).note).toBeNull();
  });

  it('keeps the old sentence for any other difference, and a failed rewrite or a hide that did not land still wins', () => {
    expect(block('child', 5, 'hide').note).toBe(NOTE_LEGACY_ACTED);
    expect(block('child', 8, 'allow', { videoRule: 'skipped', rewrite: rewriteStage(false, null) }).note).toBe(NOTE_NOT_APPLIED);
    expect(block('child', 5, 'hide', { videoRule: 'skipped', landed: false }).note).toBe(NOTE_NOT_APPLIED);
  });

  it('the old sentence is the one that was signed, character for character', () => {
    expect(NOTE_LEGACY_ACTED).toBe('the legacy path acted before the table was wired; applied is what it did');
  });
});

let seq = 0;
function record(mode: 'child' | 'teen' | 'adult', severity: number, applied: DecisionAction, extra: Parameters<typeof block>[3] = {}, note?: string | null): ForensicRecord {
  seq++;
  const decision = block(mode, severity, applied, extra);
  return {
    id: `n-${seq}`, timestamp: `2026-09-26T02:00:0${seq}.000Z`, platform: 'tiktok', originalText: 'a hostile caption with words', originalHash: 'h',
    originalLength: 28, neutralizedText: '', author: '@user', postUrl: '', techniques: [{ name: 'combined', severity, confidence: 0.9 }],
    overallScore: severity, userAgeCategory: mode, aiSource: 'cloud', feedSource: 'for-you', publicKeyFingerprint: 'fp', chainPosition: seq - 1,
    prevRecordHash: '', kind: 'video', verdict: verdictFor(applied), reader: 'default',
    decision: note === undefined ? decision : { ...decision, note },
  } as unknown as ForensicRecord;
}

const META: ExportMetadata = { fwVersion: 'V-test', publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'A', y: 'B' }, publicKeyFingerprint: 'fp', locale: 'en' };

function cardText(r: ForensicRecord): string {
  const html = buildForensicHtmlExport([r], META);
  const m = html.match(/<script type="application\/json" id="fw-export-data">([\s\S]*?)<\/script>/);
  expect(m).not.toBeNull();
  (window as unknown as { __FW_EXPORT__: unknown }).__FW_EXPORT__ = JSON.parse(m![1]);
  document.body.innerHTML = '<div id="fw-feed"></div>';
  new Function(`${EXPORT_NUMBERS_INLINE_SOURCE};${FEED_SCRIPT}`)();
  return (document.getElementById('fw-feed') as HTMLElement).textContent ?? '';
}

describe('the export card', () => {
  it.each(UI_LANGUAGES)('%s: shows the video rule in the reader\'s words, and not the legacy words', (lang) => {
    const t = I18N[lang];
    const skipped = cardText(record('child', 5, 'hide', { videoRule: 'skipped' }));
    const folded = cardText(record('adult', 8, 'hide', { videoRule: 'folded' }));
    const marked = cardText(record('adult', 8, 'mark', { videoRule: 'marked' }));
    // The export card reads its words from the table by locale; the feed script is language-neutral, so
    // check the table entries exist and differ from the legacy words, and the English card shows the English.
    expect(t.feedNoteVideoSkipped.length).toBeGreaterThan(10);
    expect(t.feedNoteVideoMarked.length).toBeGreaterThan(10);
    expect(t.feedNoteVideoFolded.length).toBeGreaterThan(10);
    expect(t.feedNoteVideoFolded).not.toBe(t.feedNoteLegacyActed);
    expect(t.feedNoteVideoSkipped).not.toBe(t.feedNoteLegacyActed);
    expect(t.feedNoteVideoMarked).not.toBe(t.feedNoteLegacyActed);
    if (lang === 'en') {
      expect(skipped).toContain(t.feedNoteVideoSkipped);
      expect(marked).toContain(t.feedNoteVideoMarked);
      expect(folded).toContain(t.feedNoteVideoFolded);
      expect(folded).not.toContain(t.feedNoteLegacyActed);
      expect(skipped).not.toContain(t.feedNoteLegacyActed);
      expect(marked).not.toContain(t.feedNoteLegacyActed);
    }
  });

  it('a record signed with the old sentence still shows the old words', () => {
    const old = cardText(record('child', 5, 'hide', {}, NOTE_LEGACY_ACTED));
    expect(old).toContain(I18N.en.feedNoteLegacyActed);
  });

  it('a sentence the page does not know prints as written', () => {
    expect(cardText(record('child', 5, 'hide', {}, 'a sentence from a later build'))).toContain('a sentence from a later build');
  });
});

describe('an old record keeps its hash', () => {
  // A record written before this change, fixed here as data: the note is the old sentence. The hash is
  // pinned; a change to the canonical payload, to the note's text or to how a record is hashed moves it.
  const OLD_RECORD = {
    id: 'old-1', timestamp: '2026-09-25T10:00:00.000Z', platform: 'tiktok', originalText: 'an old caption', originalHash: 'oh',
    originalLength: 14, neutralizedText: '', author: '@old', postUrl: '', techniques: [{ name: 'combined', severity: 5, confidence: 0.9 }],
    overallScore: 5, userAgeCategory: 'child', aiSource: 'cloud', feedSource: 'for-you', publicKeyFingerprint: 'fp', chainPosition: 0,
    prevRecordHash: '', kind: 'video', verdict: 'flagged-hidden', reader: 'default',
    decision: {
      judge: { id: 'judge-v1', hash: 'h', model: 'm', provider: 'p' },
      reading: { charged: true, family: 'hostility', severity: 5, effect: 'pressure', intent: 'x' },
      descriptor: null, rails: [], household: { mode: 'child', reader: 'default', topicRule: null, mask: false },
      row: 'J7', action: 'mark', applied: 'hide', rewrite: { attempted: false, outcome: 'off' }, note: NOTE_LEGACY_ACTED,
    },
  } as unknown as Omit<ForensicRecord, 'integrityHash' | 'signature' | 'chainAnchor'>;

  it('is the value it was, so no record already written is disturbed by the new sentences', async () => {
    expect(await computeRecordIntegrityHash(OLD_RECORD)).toBe('94ad47e96f9392dc4cad0ad91f1f61d22b773fea685254eb59fddfdb4c9d6eeb');
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
    const shapes = [
      record('child', 5, 'hide', { videoRule: 'skipped' }),
      record('adult', 8, 'mark', { videoRule: 'marked' }),
      record('adult', 8, 'hide', { videoRule: 'folded' }),
      record('child', 5, 'hide', {}, NOTE_LEGACY_ACTED),
    ];
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

  it('verifies a chain that carries the three new sentences and an old one', async () => {
    const report = await api.verifyExportText(signedHtml);
    expect(report.failures).toEqual([]);
    expect(report.state).toBe('verified');
    expect(report.records).toBe(4);
  });

  it('refuses a record whose note was changed', async () => {
    const tampered = signedHtml.replace(/(<script type="application\/json" id="fw-export-data">)([\s\S]*?)(<\/script>)/, (_m, open: string, body: string, close: string) => {
      const data = JSON.parse(body) as { records: ForensicRecord[]; manifest?: unknown };
      (data.records[0].decision as { note: string }).note = NOTE_LEGACY_ACTED;
      delete data.manifest;
      return open + JSON.stringify(data).replace(/</g, '\\u003c') + close;
    });
    const report = await api.verifyExportText(tampered);
    expect(report.state).toBe('failed');
    expect(report.failures[0]?.index).toBe(0);
  });
});
