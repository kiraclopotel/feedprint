/** @vitest-environment jsdom */
//
// An archived row the install holds and cannot decode is left out of the whole-record export. The
// file has to say so under its signature, or the person it is sent to reads the hole it leaves
// explained as a filtered extract or a removal. The export states the count in its envelope and
// on a signed page row, and both checkers take the count only when that row agrees, name the rows
// the install could not read as the cause, and still read the file as partly verified.
//
// The files here are made by the real whole-record export over a real signed chain, and read by
// the page's own script and by the separate checker, the way a recipient reads them.

import { beforeAll, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import type { ForensicRecord } from '../../../src/types/forensic';
import type { UnreadableArchivedRow } from '../../../src/forensics/archive-reader';
import { computeRecordIntegrityHash } from '../../../src/forensics/canonical-payload';
import { buildForensicHtmlExport, I18N, verifierScript, type ExportMetadata } from '../../../src/forensics/html-export';
import { VERIFIER_WORDS } from '../../../src/forensics/verifier-words';
import { STANDALONE_VERIFIER_PATH } from '../../../scripts/build-standalone-verifier';
import { UI_LANGUAGES } from '../../../src/i18n';

const state = vi.hoisted(() => ({
  jwk: null as JsonWebKey | null,
  fp: '',
  sign: null as null | ((hash: string) => Promise<string>),
  archive: [] as unknown[],
  unreadable: [] as unknown[],
  signed: '',
}));

vi.mock('../../../src/forensics/signing', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  signHash: vi.fn(async (hash: string) => state.sign!(hash)),
  getPublicKeyJWK: vi.fn(async () => state.jwk),
  getPublicKeyFingerprint: vi.fn(async () => state.fp),
  getSigningKeyCreatedAt: vi.fn(async () => null),
  getSigningKeyOrigins: vi.fn(async () => []),
}));
vi.mock('../../../src/forensics/archive-reader', () => ({
  loadArchivesOldestFirst: vi.fn(async () => [
    { monthKey: '2026-08', records: state.archive, anchors: [], unreadable: state.unreadable },
  ]),
}));
vi.mock('../../../src/forensics/chain-anchor-store', () => ({ getAnchors: vi.fn(async () => []) }));
vi.mock('../../../src/forensics/salvage-store', () => ({ readSalvagedRecords: vi.fn(async () => []) }));
vi.mock('../../../src/forensics/key-genesis', () => ({ getKeyGenesis: vi.fn(async () => null) }));
vi.mock('../../../src/forensics/profile', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  buildExportProfile: vi.fn(async () => ({ name: null, platform: null, browser: null, language: null, timeZone: null })),
}));
// The signed file as it leaves the exporter, before the browser is handed it.
vi.mock('../../../src/forensics/html-export', async (orig) => {
  const real = await orig<typeof import('../../../src/forensics/html-export')>();
  return {
    ...real,
    attachSignedManifest: async (html: string, sign?: (hash: string) => Promise<string>) => {
      state.signed = await real.attachSignedManifest(html, sign);
      return state.signed;
    },
  };
});

type Verdicts = { state: string; byId: Record<string, unknown> };
type Report = { state: string; notes: string[] };
type Checker = { verifyExportText(text: string): Promise<Report>; describe(report: Report, lang?: string): string };
const w = window as unknown as { __FW_EXPORT__?: unknown; __FW_VERDICTS__?: Verdicts };

let checker: Checker;

beforeAll(async () => {
  for (const target of [globalThis, window] as unknown as Array<Record<string, unknown>>) {
    if (!(target.crypto as Crypto | undefined)?.subtle) Object.defineProperty(target, 'crypto', { value: webcrypto, configurable: true });
  }
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const full = await crypto.subtle.exportKey('jwk', kp.publicKey);
  state.jwk = { kty: 'EC', crv: 'P-256', x: full.x, y: full.y };
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${full.x}|${full.y}`));
  state.fp = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
  state.sign = async (hash: string) => {
    const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: { name: 'SHA-256' } }, kp.privateKey, new TextEncoder().encode(hash));
    return Buffer.from(sig).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
  if (typeof URL.createObjectURL !== 'function') {
    (URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = () => 'blob:t';
  }
  if (typeof URL.revokeObjectURL !== 'function') {
    (URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = () => undefined;
  }
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  checker = await import(/* @vite-ignore */ pathToFileURL(STANDALONE_VERIFIER_PATH).href) as Checker;
});

/** A month of signed records, each linked to the one before it. */
async function month(n: number): Promise<ForensicRecord[]> {
  const out: ForensicRecord[] = [];
  let prev = '';
  for (let i = 0; i < n; i++) {
    const base = {
      id: `aug-${i}`, timestamp: `2026-08-0${i + 1}T10:00:00.000Z`, platform: 'tiktok', originalText: `post ${i}`,
      originalHash: 'h', originalLength: 6, neutralizedText: '', author: '@user', postUrl: '', techniques: [],
      overallScore: 0, userAgeCategory: 'teen', aiSource: 'cloud', feedSource: 'for-you', publicKeyFingerprint: state.fp,
      chainPosition: i, prevRecordHash: prev, kind: 'post', verdict: 'pass',
    } as Omit<ForensicRecord, 'integrityHash' | 'signature' | 'chainAnchor'>;
    const integrityHash = await computeRecordIntegrityHash(base);
    out.push({ ...base, integrityHash, signature: await state.sign!(integrityHash) } as ForensicRecord);
    prev = integrityHash;
  }
  return out;
}

/** The row upkeep could not decode, as the archive reader names it. */
function unreadableRow(r: ForensicRecord, recordsBefore: number): UnreadableArchivedRow {
  return { id: r.id, chainPosition: r.chainPosition, timestamp: r.timestamp, recordsBefore, reason: 'incorrect header check' };
}

async function exportWholeRecord(archive: ForensicRecord[], unreadable: UnreadableArchivedRow[]): Promise<string> {
  state.archive = archive;
  state.unreadable = unreadable;
  state.signed = '';
  const { exportEverythingHtml } = await import('../../../src/forensics/exporter');
  await exportEverythingHtml([], 'en');
  expect(state.signed, 'the export was signed').toContain('"manifest":');
  return state.signed;
}

function payloadOf(html: string): Record<string, unknown> {
  const m = /<script type="application\/json" id="fw-export-data">([\s\S]*?)<\/script>/.exec(html);
  return JSON.parse(m![1]) as Record<string, unknown>;
}

function row(html: string, name: string): string | null {
  const m = html.match(new RegExp(`<dd data-fw-prov="${name}">([\\s\\S]*?)</dd>`));
  return m ? m[1] : null;
}

/** The page's own check, run as a browser runs it; the verdict and the words it printed. */
async function readOnPage(html: string): Promise<{ state: string | undefined; text: string }> {
  document.documentElement.innerHTML = html.replace(/[\s\S]*?<body>/, '').replace(/<\/body>[\s\S]*/, '');
  delete w.__FW_VERDICTS__;
  w.__FW_EXPORT__ = payloadOf(html);
  const verdicts = await new Promise<Verdicts | undefined>((resolve) => {
    const done = () => { document.removeEventListener('fw-verified', done); resolve(w.__FW_VERDICTS__); };
    document.addEventListener('fw-verified', done);
    new Function(verifierScript(I18N.en))();
    setTimeout(() => resolve(w.__FW_VERDICTS__), 3000);
  });
  return { state: verdicts?.state, text: document.getElementById('fw-status')?.textContent ?? '' };
}

const FILTERED = 'A filtered extract does this';

describe('the whole-record export says how many archived rows it could not read', () => {
  it('one unreadable row: the file carries the count, says it on page one, and both checkers name that cause and read partial', async () => {
    const aug = await month(6);
    const html = await exportWholeRecord([...aug.slice(0, 2), ...aug.slice(3)], [unreadableRow(aug[2], 2)]);

    expect(payloadOf(html).unreadableArchivedRows).toBe(1);
    const said = row(html, 'unreadableRows');
    expect(said, 'page one has no row for the rows the install could not read').not.toBeNull();
    expect(said!).toMatch(/^1\b/);
    expect(html).toContain(`data-fw-prov="unreadableRows.label">${I18N.en.summaryUnreadableRows}:`);

    const page = await readOnPage(html);
    expect(page.state).toBe('partial');
    expect(page.text).toContain(I18N.en.chainNoteOutsideUnreadable.replace('{n}', '1').replace('{u}', '1'));
    expect(page.text).not.toContain(FILTERED);

    const report = await checker.verifyExportText(html);
    expect(report.state).toBe('partial');
    expect(report.notes).toContain(VERIFIER_WORDS.en.noteOutsideUnreadable.replace('{n}', '1').replace('{u}', '1'));
    expect(report.notes).not.toContain(VERIFIER_WORDS.en.noteOutside.replace('{n}', '1'));
    const reading = checker.describe(report, 'en');
    expect(reading, 'the checker still calls this everything the install had').not.toContain('everything the install still had');
    expect(reading.split('\n')[0]).toContain('1 archived record(s) it could not read');
  }, 20000);

  it('no unreadable row: the file is as before, with no count and no row, and reads verified', async () => {
    const aug = await month(6);
    const html = await exportWholeRecord(aug, []);

    expect(Object.keys(payloadOf(html))).not.toContain('unreadableArchivedRows');
    expect(html).not.toContain('data-fw-prov="unreadableRows');

    const page = await readOnPage(html);
    expect(page.state).toBe('verified');
    const report = await checker.verifyExportText(html);
    expect(report.state).toBe('verified');
    expect(checker.describe(report, 'en').split('\n')[0]).toContain('everything the install still had');
  }, 20000);

  it('a count written into the envelope with no signed row explains nothing: a removed record still reads as one', async () => {
    const aug = await month(6);
    const cut = await exportWholeRecord([...aug.slice(0, 2), ...aug.slice(3)], []);
    const edited = cut.replace(
      /(<script type="application\/json" id="fw-export-data">)([\s\S]*?)(<\/script>)/,
      (_m, open: string, body: string, close: string) => {
        const data = JSON.parse(body) as Record<string, unknown>;
        data.unreadableArchivedRows = 1;
        return open + JSON.stringify(data).replace(/</g, '\\u003c') + close;
      },
    );

    const page = await readOnPage(edited);
    expect(page.state).toBe('partial');
    expect(page.text).toContain(FILTERED);
    const report = await checker.verifyExportText(edited);
    expect(report.state).toBe('partial');
    expect(report.notes).toContain(VERIFIER_WORDS.en.noteOutside.replace('{n}', '1'));
  }, 20000);

  it('an unreadable first row: page one does not say the records before the file were removed', async () => {
    // Position 0 is where every month's rotation marker sits, and the install's first record.
    const aug = await month(6);
    const html = await exportWholeRecord(aug.slice(1), [unreadableRow(aug[0], 0)]);

    const before = row(html, 'missingBefore');
    expect(before, 'page one has no row for the records before the file').not.toBeNull();
    expect(before!, 'page one says the records before the file were removed').not.toContain(I18N.en.summaryMissingBeforeNote);
    expect(before!).not.toMatch(/were removed/);
    expect(before!).toMatch(/^1\b/);
    expect(before!).toContain(I18N.en.summaryMissingBeforeNoteUnreadable);
    expect(row(html, 'unreadableRows')!).toMatch(/^1\b/);

    expect((await readOnPage(html)).state).toBe('partial');
    expect((await checker.verifyExportText(html)).state).toBe('partial');
  }, 20000);

  it('in every language, the records before the file are called removed only when the install read every archived row', async () => {
    const aug = await month(3);
    for (const lang of UI_LANGUAGES) {
      const t = I18N[lang];
      const meta: ExportMetadata = { fwVersion: 'V-test', publicKeyJwk: state.jwk!, publicKeyFingerprint: state.fp, locale: lang };
      const counted = row(buildForensicHtmlExport(aug.slice(1), { ...meta, unreadableArchivedRows: 2 }), 'missingBefore');
      expect(counted, lang).not.toBeNull();
      expect(counted!, lang).not.toContain(t.summaryMissingBeforeNote);
      expect(counted!, lang).toContain(t.summaryMissingBeforeNoteUnreadable);
      expect(t.summaryMissingBeforeNoteUnreadable, lang).not.toContain('—');
      const none = row(buildForensicHtmlExport(aug.slice(1), meta), 'missingBefore');
      expect(none!, lang).toContain(t.summaryMissingBeforeNote);
    }
  });

  it('the row reads in every language, with the count first', () => {
    const meta = (locale: ExportMetadata['locale']): ExportMetadata => ({
      fwVersion: 'V-test', publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'A', y: 'B' }, publicKeyFingerprint: 'fp', locale,
      unreadableArchivedRows: 3,
    });
    for (const lang of UI_LANGUAGES) {
      const t = I18N[lang];
      const html = buildForensicHtmlExport([], meta(lang));
      expect(row(html, 'unreadableRows'), lang).toMatch(/^3\b/);
      for (const s of [t.summaryUnreadableRows, t.summaryUnreadableRowsValue, t.chainNoteOutsideUnreadable]) {
        expect(s, lang).toBeTruthy();
        expect(s, lang).not.toContain('—');
      }
      expect(t.chainNoteOutsideUnreadable, lang).toContain('{u}');
      expect(t.chainNoteOutsideUnreadable, lang).not.toMatch(/filtr/i);
    }
  });
});
