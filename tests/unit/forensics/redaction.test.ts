/** @vitest-environment jsdom */
//
// Evidence-gap register item 20, part 1 (2026-09-06, owner's yes): a record
// can be withheld without a hole. A signed redaction marker names the record
// and the fields; every export blanks those fields on its copy and carries the
// marker; the embedded verifier accepts the blanked copy only on the marker's
// word and fails it otherwise. This file pins the hashed line, the two-sided
// shape check, the parser round trip, the suppression, the verifier's two
// paths against the real embedded source, the feed's rendering, and the
// wiring by source.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { webcrypto } from 'node:crypto';
import {
  applyRedactions,
  collectRedactions,
  isRedactionMarkerInput,
  REDACTED_FIELDS,
  redactionMarkerSummary,
  redactionMarkerText,
  redactionOf,
} from '../../../src/forensics/redaction';
import type { RedactionMarkerInput } from '../../../src/types/redaction-marker';
import { SYSTEM_MARKER_KINDS } from '../../../src/forensics/system-records';
import { computeRecordIntegrityHash } from '../../../src/forensics/canonical-payload';
import { buildForensicHtmlExport, FEED_SCRIPT, I18N, VERIFIER_CORE_FNS_SOURCE, type ExportMetadata } from '../../../src/forensics/html-export';
import type { ForensicRecord } from '../../../src/types/forensic';
import { DASHBOARD_STRINGS } from '../../../src/i18n/dashboard-strings';
import { readSource } from '../../helpers/read-source';
import { EXPORT_NUMBERS_INLINE_SOURCE } from '../../../src/forensics/export-numbers-inline';

/** The export builder is four files since 2026-09-16 (PLAN-2026-09-16 item 10.1): the builder, the
 *  scripts the page carries, the stylesheet, and the string table under i18n. A scan of "the
 *  export's source" reads all four through readSource, which refuses an emptied or re-export-only
 *  file, so a later split cannot turn this scan into an empty pass. */
const EXPORT_SOURCES = [
  'src/forensics/html-export.ts',
  'src/forensics/html-export-scripts.ts',
  'src/forensics/html-export-styles.ts',
  'src/i18n/export-strings.ts',
];
const exportSource = (): string => EXPORT_SOURCES.map((p) => readSource(p)).join(String.fromCharCode(10));


if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}
const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

const core = new Function(
  `"use strict";${VERIFIER_CORE_FNS_SOURCE}
   return { verifyOne: verifyOne, redactionIndex: redactionIndex, importPubKey: importPubKey, fingerprintJwk: fingerprintJwk };`,
)() as {
  verifyOne(rec: unknown, keys: Record<string, CryptoKey>, fp: string, redactions: Record<string, unknown>): Promise<{ ok: boolean; redacted?: boolean; reason?: string; markerId?: string }>;
  redactionIndex(records: unknown[]): Record<string, unknown>;
  importPubKey(jwk: JsonWebKey): Promise<CryptoKey>;
  fingerprintJwk(jwk: JsonWebKey): Promise<string>;
};

async function keypair() {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const full = await crypto.subtle.exportKey('jwk', kp.publicKey);
  const jwk: JsonWebKey = { kty: 'EC', crv: 'P-256', x: full.x, y: full.y };
  const sign = async (hash: string) => {
    const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: { name: 'SHA-256' } }, kp.privateKey, new TextEncoder().encode(hash));
    return Buffer.from(sig).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
  return { jwk, fp: await core.fingerprintJwk(jwk), pub: await core.importPubKey(jwk), sign };
}

async function signed(partial: Record<string, unknown>, fp: string, sign: (h: string) => Promise<string>): Promise<ForensicRecord> {
  const base = {
    timestamp: '2026-09-06T12:00:00.000Z', platform: 'tiktok', originalHash: 'oh', originalLength: 5, neutralizedText: '', postUrl: 'https://www.tiktok.com/@a/video/1',
    techniques: [{ name: 'shame-attack', severity: 6, confidence: 0.8 }], overallScore: 0.6, userAgeCategory: 'adult', aiSource: 'cloud', feedSource: 'for-you',
    prevRecordHash: 'genesis', chainPosition: 0, verdict: 'flagged', kind: 'post', publicKeyFingerprint: fp, ...partial,
  } as unknown as Omit<ForensicRecord, 'integrityHash' | 'signature' | 'chainAnchor'>;
  const integrityHash = await computeRecordIntegrityHash(base);
  return { ...base, integrityHash, signature: await sign(integrityHash) } as ForensicRecord;
}

const input: RedactionMarkerInput = { recordId: 'fr-1', recordHash: 'a'.repeat(64), fields: ['originalText', 'author'], reason: 'their parent asked' };

describe('redaction marker text and shape', () => {
  it('the hashed line names the record, its hash, the fields sorted and the reason on one line', () => {
    expect(redactionMarkerText({ ...input, fields: ['author', 'originalText'], reason: 'two\nlines ' }, 't', true)).toBe(
      `[redaction-marker @ t] record=fr-1 recordHash=${'a'.repeat(64)} fields=author,originalText reason=two lines settings-read-failed`,
    );
    expect(redactionMarkerText({ ...input, reason: '' }, 't', false)).not.toContain('reason=');
    expect(redactionMarkerSummary(input)).toBe("withheld at the parent's request: record fr-1, 2 fields");
    expect(SYSTEM_MARKER_KINDS.has('redaction-marker')).toBe(true);
  });

  it('parses its own line back, and nothing else', () => {
    const marker = { id: 'm1', kind: 'redaction-marker', timestamp: 't', originalText: redactionMarkerText(input, 't', false) } as unknown as ForensicRecord;
    expect(redactionOf(marker)).toEqual({ markerId: 'm1', at: 't', recordId: 'fr-1', recordHash: 'a'.repeat(64), fields: ['author', 'originalText'] });
    expect(redactionOf({ ...marker, kind: 'post' } as ForensicRecord)).toBeNull();
    expect(redactionOf({ ...marker, originalText: '[redaction-marker @ t] nothing here' } as ForensicRecord)).toBeNull();
  });

  const accept: unknown[] = [input, { ...input, reason: '' }, { ...input, fields: [...REDACTED_FIELDS] }];
  const reject: unknown[] = [
    null, { ...input, recordId: '' }, { ...input, recordHash: 'short' }, { ...input, fields: [] }, { ...input, fields: ['verdict'] },
    { ...input, reason: 'x'.repeat(201) }, { ...input, reason: 5 },
  ];
  it.each(accept.map((x, i) => [i, x]))('accepts case %i', (_i, x) => { expect(isRedactionMarkerInput(x)).toBe(true); });
  it.each(reject.map((x, i) => [i, x]))('rejects case %i', (_i, x) => { expect(isRedactionMarkerInput(x)).toBe(false); });
});

describe('applyRedactions', () => {
  const rec = { id: 'fr-1', integrityHash: 'a'.repeat(64), originalText: 'said it', author: '@them', postUrl: 'u', techniques: [{ name: 'x' }], kind: 'post' } as unknown as ForensicRecord;
  const other = { id: 'fr-2', integrityHash: 'b'.repeat(64), originalText: 'kept', author: '@else', kind: 'post' } as unknown as ForensicRecord;
  const marker = { id: 'm1', kind: 'redaction-marker', timestamp: 't', originalText: redactionMarkerText(input, 't', false) } as unknown as ForensicRecord;

  it('blanks the named fields on a copy, keeps the rest, stamps redacted, leaves other records the same object', () => {
    const out = applyRedactions([rec, other, marker]);
    expect(out).toHaveLength(3);
    const blanked = out[0] as unknown as Record<string, unknown>;
    expect(blanked.originalText).toBeUndefined();
    expect(blanked.author).toBeUndefined();
    expect(blanked.postUrl).toBe('u');
    expect(blanked.integrityHash).toBe('a'.repeat(64));
    expect(blanked.redacted).toEqual({ markerId: 'm1', at: 't', fields: ['author', 'originalText'] });
    expect(rec.originalText).toBe('said it');
    expect(out[1]).toBe(other);
    expect(collectRedactions([marker]).get('fr-1')?.recordId).toBe('fr-1');
  });

  it('a marker whose hash does not match the record leaves it alone; a filtered list gains the marker it needs', () => {
    const stale = { ...rec, integrityHash: 'c'.repeat(64) } as ForensicRecord;
    expect(applyRedactions([stale, marker])[0]).toBe(stale);
    const out = applyRedactions([rec], [rec, other, marker]);
    expect(out.map(r => r.id)).toEqual(['fr-1', 'm1']);
    expect(applyRedactions([other], [rec, marker])).toEqual([other]);
  });

  // Cold read finding 1 (COLD-READ-ee35374f-74c9ea6a-2026-09-28.md #1):
  // REDACTED_FIELDS had 'author' but not 'authorName', so a withhold (which
  // always redacts every field in REDACTED_FIELDS, Dashboard.tsx's
  // `fields: [...REDACTED_FIELDS]`) blanked the handle but left the display
  // name beside it in the exported record's own data.
  it('a withhold blanks the display name beside the handle, not only the handle', () => {
    expect(REDACTED_FIELDS).toContain('authorName');
    const withName = { ...rec, authorName: 'Their Real Name' } as unknown as ForensicRecord;
    const fullMarker = {
      id: 'm2', kind: 'redaction-marker', timestamp: 't',
      originalText: redactionMarkerText({ ...input, fields: [...REDACTED_FIELDS] }, 't', false),
    } as unknown as ForensicRecord;
    const out = applyRedactions([withName, fullMarker]);
    const blanked = out[0] as unknown as Record<string, unknown>;
    expect(blanked.author).toBeUndefined();
    expect(blanked.authorName).toBeUndefined();
  });
});

describe('the embedded verifier and the withheld record', () => {
  it('accepts a blanked record on its signed marker, fails it without one or with a mismatched hash', async () => {
    const key = await keypair();
    const record = await signed({ id: 'fr-1', originalText: 'said it', author: '@them' }, key.fp, key.sign);
    const markerInput: RedactionMarkerInput = { recordId: 'fr-1', recordHash: record.integrityHash, fields: ['originalText', 'author'], reason: '' };
    const text = redactionMarkerText(markerInput, '2026-09-06T12:01:00.000Z', false);
    const marker = await signed({ id: 'm1', kind: 'redaction-marker', originalText: text, originalHash: 'h', originalLength: text.length, author: '', postUrl: '', techniques: [], verdict: 'pass', chainPosition: 1, prevRecordHash: record.integrityHash, resetReason: 'r' }, key.fp, key.sign);
    const exported = applyRedactions([record, marker]);
    const keys = { [key.fp]: key.pub };
    const idx = core.redactionIndex(exported);
    expect(await core.verifyOne(exported[0], keys, key.fp, idx)).toEqual({ ok: true, redacted: true, markerId: 'm1' });
    expect(await core.verifyOne(exported[1], keys, key.fp, idx)).toEqual({ ok: true });
    // The same blanked record with the marker gone, or naming another hash, fails.
    expect(await core.verifyOne(exported[0], keys, key.fp, {})).toEqual({ ok: false, reason: 'redaction-unattested' });
    const wrong = { ...marker, originalText: text.replace(record.integrityHash, 'f'.repeat(64)) };
    expect(await core.verifyOne(exported[0], keys, key.fp, core.redactionIndex([wrong]))).toEqual({ ok: false, reason: 'redaction-unattested' });
    // An unblanked record still verifies by its hash, marker or not.
    expect(await core.verifyOne(record, keys, key.fp, idx)).toEqual({ ok: true });
  });

  it('a marker that fails its own signature takes the withheld record down with it (source lock)', () => {
    const src = exportSource();
    expect(src).toContain("if(prr&&prr.redacted&&markerOk[prr.markerId]===false) perRecord[ri]={ok:false,reason:'redaction-unattested'};");
    expect(src).toContain("brokenReason==='redaction-unattested'?FIXED.failReasonRedactionUnattested");
  });
});

describe('the feed shows a withheld record without its content', () => {
  it('renders the withheld line in place of the text and author', () => {
    const META: ExportMetadata = { fwVersion: 'V', publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'A', y: 'B' }, publicKeyFingerprint: 'fp', locale: 'en' };
    const rec = { id: 'fr-1', timestamp: '2026-09-06T12:00:00.000Z', platform: 'tiktok', originalText: 'said it', originalHash: 'h', originalLength: 7, neutralizedText: '', author: '@them', postUrl: '', techniques: [], overallScore: 0, userAgeCategory: 'adult', aiSource: 'cloud', feedSource: 'for-you', integrityHash: 'a'.repeat(64), signature: 's', publicKeyFingerprint: 'fp', chainPosition: 0, kind: 'post', verdict: 'pass' } as unknown as ForensicRecord;
    const marker = { ...rec, id: 'm1', kind: 'redaction-marker', chainPosition: 1, author: '', originalText: redactionMarkerText({ recordId: 'fr-1', recordHash: 'a'.repeat(64), fields: ['originalText', 'author'], reason: '' }, 't', false), resetReason: 'withheld' } as unknown as ForensicRecord;
    const html = buildForensicHtmlExport(applyRedactions([rec, marker]), META);
    const m = html.match(/<script type="application\/json" id="fw-export-data">([\s\S]*?)<\/script>/);
    (window as unknown as { __FW_EXPORT__: unknown }).__FW_EXPORT__ = JSON.parse(m![1]);
    document.body.innerHTML = '<div id="fw-feed"></div>';
    new Function(`${EXPORT_NUMBERS_INLINE_SOURCE};${FEED_SCRIPT}`)();
    const feed = document.getElementById('fw-feed') as HTMLElement;
    const card = feed.querySelector('article.fw-item')!;
    expect(card.querySelector('.fw-withheld')?.textContent).toBe(I18N.en.feedWithheld);
    expect(card.querySelector('.fw-item-text')).toBeNull();
    expect(card.querySelector('.fw-item-author')?.textContent).toBe(I18N.en.feedWithheldAuthor);
    expect(html).not.toContain('said it');
    expect(html).not.toContain('@them');
    for (const locale of Object.keys(I18N) as Array<keyof typeof I18N>) {
      expect(I18N[locale].feedWithheld.length).toBeGreaterThan(40);
      expect(I18N[locale].perRecordRedacted.length).toBeGreaterThan(10);
      expect(I18N[locale].failReasonRedactionUnattested.length).toBeGreaterThan(20);
    }
  });
});

describe('wiring (source lock)', () => {
  it('the worker writes the marker on the chain lock; both exporter paths blank before building', () => {
    const sw = read('src/background/service-worker.ts');
    expect(sw).toContain("if (message.type === 'REDACTION_MARKER')");
    expect(sw).toContain('isRedactionMarkerInput(message.payload)');
    const ex = read('src/forensics/exporter.ts');
    // Two HTML export paths since 2026-09-16 (PLAN-2026-09-16 item 6.2 removed the per-chain one).
    expect(ex.match(/buildForensicHtmlExport\(applyRedactions\(/g)?.length).toBe(2);
    const writer = read('src/forensics/redaction.ts');
    const block = writer.slice(writer.indexOf('export function appendRedactionMarker'));
    expect(block).toContain('sharedChainWriteLock(');
    expect(block).toContain("kind: 'redaction-marker'");
    expect(block).toContain('await addRecord(');
    // The copy's `redacted` field is not part of the hash.
    expect(read('src/forensics/canonical-payload.ts')).not.toContain('redacted');
  });

  it('the dashboard blanks the copy every tab sees, walks the raw chain, and offers the withhold control', () => {
    const dash = read('src/ui/dashboard/Dashboard.tsx');
    expect(dash).toContain('const recs = applyRedactions(rawRecs);');
    expect(dash).toContain('setFirstPage(applyRedactions(page));');
    expect(dash).toContain('const integ = await verifyChainIntegrity(rawRecs, unreadableRowsRef.current);');
    expect(dash).toContain('void extendChainIntegrity(rawRecs, wm)');
    expect(dash).toContain('const raw = rawRecordsRef.current.length > 0 ? rawRecordsRef.current : records;');
    expect(dash).not.toMatch(/verifyChainIntegrity\(records\)/);
    expect(dash).toContain("type: 'REDACTION_MARKER'");
    expect(dash).toContain('onWithhold={withholdRecord}');
    // The rows and their withhold button moved from the Record tab to the Feed log on 10 Oct 2026.
    const tab = read('src/ui/dashboard/components/FeedLogTab.tsx');
    expect(tab).toContain('{onWithhold && !r.redacted && !isMarker(r) && (');
    // The reason is asked in the row since 11 Oct 2026, not in window.prompt
    // (tests/unit/ui/dashboard/components/the-withhold-reason-is-asked-in-the-page.test.tsx).
    expect(tab).toContain('{t.withholdPrompt}</label>');
    expect(tab).not.toContain('window.prompt');
    expect(tab).toContain('r.redacted ? t.withheldShort :');
    for (const [locale, s] of Object.entries(DASHBOARD_STRINGS)) {
      for (const k of ['withholdBtn', 'withholdPrompt', 'withholdDone', 'withholdFailed', 'withheldNote', 'withheldShort'] as const) {
        expect((s as unknown as Record<string, unknown>)[k], `${locale}.${k}`).toBeTypeOf('string');
      }
    }
  });
});

// REDACTION THAT DID NOT REDACT. Eleven top-level fields were removed while two
// others on the same record went on quoting the withheld text verbatim. In the
// 2026-09-08 export harmFloor.topEvidence held "1 profanity tokens (fucking)"
// and "1 ideology stems (nazi)", and techniques[].why held "nigga" and
// "dumbass; fuck" — the exact words someone redacting a post is most likely to
// be removing. The export renders a technique's reason on the card.
describe('redaction removes the fields that quote the withheld text', () => {
  it('harmFloor goes, and a technique keeps its finding but loses its quote', () => {
    const rec = {
      id: 'r-1', integrityHash: 'a1'.padEnd(64, '0'), originalText: 'a post with a slur in it',
      harmFloor: { score: 70, topCategory: 'ideology', topEvidence: '1 ideology stems (nazi)' },
      techniques: [{ name: 'scapegoating', severity: 8, confidence: 0.9, why: 'nigga' }],
    } as unknown as ForensicRecord;
    const input: RedactionMarkerInput = {
      recordId: 'r-1',
      recordHash: 'a1'.padEnd(64, '0'),
      fields: ['originalText', 'harmFloor', 'techniqueWhy'],
      reason: 'a slur',
    };
    const marker = {
      id: 'm1', kind: 'redaction-marker', timestamp: 't',
      originalText: redactionMarkerText(input, 't', false),
    } as unknown as ForensicRecord;
    const [out] = applyRedactions([rec, marker]) as unknown as Array<Record<string, unknown>>;
    expect(out.originalText).toBeUndefined();
    expect(out.harmFloor).toBeUndefined();
    const techniques = out.techniques as Array<Record<string, unknown>>;
    // The finding survives — a recipient still needs to know WHAT was found...
    expect(techniques[0].name).toBe('scapegoating');
    expect(techniques[0].severity).toBe(8);
    expect(techniques[0].confidence).toBe(0.9);
    // ...but not the words.
    expect(techniques[0].why).toBeUndefined();
    expect(JSON.stringify(out)).not.toContain('nigga');
    expect(JSON.stringify(out)).not.toContain('nazi');
  });

  it('both new tokens are accepted by the marker validator', () => {
    for (const f of ['harmFloor', 'techniqueWhy']) {
      expect(REDACTED_FIELDS).toContain(f);
    }
  });
});
