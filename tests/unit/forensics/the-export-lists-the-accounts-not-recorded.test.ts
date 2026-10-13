/** @vitest-environment jsdom */
//
// His walk of 12 Oct 2026: "When you export, it will say the accounts that you chose not to record ... the name will still
// appear in the export, except that there will be no posts." The accounts a person stops recording live in a setting on this
// computer (forensics/author-exclusions.ts); the signed record carries only a count of what was withheld, per heartbeat note,
// and never whose. The export now lists those accounts in a section of its own, with no rows under them, and says that the
// names come from the setting and not from the record, and that the checker does not verify the list. The methodology says
// the same in one sentence. A file that leaves the person's hands (a donation) prints the number and no names.
//
// The files are made by the real exporters over a real signed chain, and read by the page's own script and by the separate
// checker, so the verdict of both is pinned as unchanged by the list.

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import type { ForensicRecord } from '../../../src/types/forensic';
import { computeRecordIntegrityHash } from '../../../src/forensics/canonical-payload';
import { buildForensicHtmlExport, I18N, verifierScript, type ExportMetadata } from '../../../src/forensics/html-export';
import { STANDALONE_VERIFIER_PATH } from '../../../scripts/build-standalone-verifier';
import { UI_LANGUAGES } from '../../../src/i18n';
import { EXCLUSIONS_KEY } from '../../../src/forensics/author-exclusions';
import { escapeHtml } from '../../../src/forensics/html-escape';
import { installChromeStorageStub } from '../../helpers/chrome-storage';

const state = vi.hoisted(() => ({
  jwk: null as JsonWebKey | null,
  fp: '',
  sign: null as null | ((hash: string) => Promise<string>),
  archive: [] as unknown[],
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
  loadArchivesOldestFirst: vi.fn(async () => [{ monthKey: '2026-08', records: state.archive, anchors: [], unreadable: [] }]),
}));
vi.mock('../../../src/forensics/chain-anchor-store', () => ({ getAnchors: vi.fn(async () => []) }));
vi.mock('../../../src/forensics/salvage-store', () => ({ readSalvagedRecords: vi.fn(async () => []) }));
vi.mock('../../../src/forensics/key-genesis', () => ({ getKeyGenesis: vi.fn(async () => null) }));
vi.mock('../../../src/forensics/profile', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  buildExportProfile: vi.fn(async () => ({ name: null, platform: null, browser: null, language: null, timeZone: null })),
}));
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
type Checker = { verifyExportText(text: string): Promise<Report> };
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

const EXCLUDED = [
  { key: 'twitter:zed_q', platform: 'twitter', author: '@zed_q', addedAt: '2026-10-09T07:15:00.000Z', reason: 'a friend' },
  { key: 'youtube:some channel', platform: 'youtube', author: 'Some Channel <b>', addedAt: '2026-10-11T18:30:00.000Z', reason: '' },
];

function withExclusions(list: unknown[]): void {
  installChromeStorageStub({ initial: list.length > 0 ? { [EXCLUSIONS_KEY]: list } : {} });
}

async function exportWholeRecord(): Promise<string> {
  state.archive = await month(6);
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

async function readOnPage(html: string): Promise<string | undefined> {
  document.documentElement.innerHTML = html.replace(/[\s\S]*?<body>/, '').replace(/<\/body>[\s\S]*/, '');
  delete w.__FW_VERDICTS__;
  w.__FW_EXPORT__ = payloadOf(html);
  const verdicts = await new Promise<Verdicts | undefined>((resolve) => {
    const done = () => { document.removeEventListener('fw-verified', done); resolve(w.__FW_VERDICTS__); };
    document.addEventListener('fw-verified', done);
    new Function(verifierScript(I18N.en))();
    setTimeout(() => resolve(w.__FW_VERDICTS__), 3000);
  });
  return verdicts?.state;
}

const sectionOf = (html: string): string => /<section id="fw-excluded"[\s\S]*?<\/section>/.exec(html)?.[0] ?? '';

beforeEach(() => { withExclusions([]); });

describe('the whole-record export lists the accounts not recorded, with no rows under them', () => {
  it('names each account, its platform and the day it was set aside, says where the names come from, and the checkers read the file as before', async () => {
    withExclusions(EXCLUDED);
    const html = await exportWholeRecord();
    const section = sectionOf(html);
    expect(section, 'the file has the section').not.toBe('');
    expect(section).toContain(`<h2>${I18N.en.exclHeader}</h2>`);
    expect(section).toContain(I18N.en.exclIntro);
    // Handle (with its @), platform as the page names it, the day, and no records.
    expect(section).toContain('<td class="fw-person-name">@zed_q</td><td>X</td><td>2026-10-09</td><td>0</td>');
    // A name from the setting is written out safely, and an account with no @ gets the one the row shows.
    expect(section).toContain('<td class="fw-person-name">@Some Channel &lt;b&gt;</td><td>YouTube</td><td>2026-10-11</td><td>0</td>');
    expect(section).not.toContain('<b>');
    // Not part of what the signature covers, and not claimed to be: no mark for the provenance digest.
    expect(section).not.toContain('data-fw-prov');
    // Beside the methodology, which says the same in one sentence.
    expect(html).toContain(`data-fw-mth="exclusions">${I18N.en.methodologyExclusionsNote}</p>`);
    expect(html.indexOf('id="fw-excluded"')).toBeLessThan(html.indexOf('class="fw-methodology"'));

    expect(await readOnPage(html)).toBe('verified');
    expect((await checker.verifyExportText(html)).state).toBe('verified');
  }, 30000);

  it('no account set aside: no section, and the verdict is the same', async () => {
    const html = await exportWholeRecord();
    expect(html).not.toContain('id="fw-excluded"');
    expect(html).not.toContain('<td class="fw-person-name">');
    expect(await readOnPage(html)).toBe('verified');
    expect((await checker.verifyExportText(html)).state).toBe('verified');
  }, 30000);

  it('the list is the setting, not the chain: no name reaches the signed data', async () => {
    withExclusions(EXCLUDED);
    const html = await exportWholeRecord();
    const data = JSON.stringify(payloadOf(html));
    expect(data).not.toContain('zed_q');
    expect(data).not.toContain('Some Channel');
  }, 30000);
});

describe('a selected export names them too, and a file that leaves the person\'s hands prints the number alone', () => {
  const included = async (): Promise<ForensicRecord[]> => month(3);
  const filter = async () => {
    const records = await included();
    return { included: records, totalSource: records.length, excludedUnreviewed: 0, excludedLowConfidence: 0, excludedNonDetection: 0 };
  };

  it('by default the accounts are listed', async () => {
    withExclusions(EXCLUDED);
    const { buildHtmlExportDocument } = await import('../../../src/forensics/exporter');
    const f = await filter();
    const html = await buildHtmlExportDocument(f.included, f as never, 'en');
    expect(sectionOf(html)).toContain('@zed_q');
  }, 30000);

  it('for a donation (nameExcludedAccounts false) the number is printed and no name is', async () => {
    withExclusions(EXCLUDED);
    const { buildHtmlExportDocument } = await import('../../../src/forensics/exporter');
    const f = await filter();
    const html = await buildHtmlExportDocument(f.included, f as never, 'en', undefined, { nameExcludedAccounts: false });
    const section = sectionOf(html);
    expect(section).toContain(I18N.en.exclCountOnly.replace('{n}', '2'));
    expect(html).not.toContain('zed_q');
    expect(html).not.toContain('Some Channel');
    expect(section).not.toContain('<table');
  }, 30000);
});

describe('the section reads in every language the export speaks', () => {
  const meta = (locale: ExportMetadata['locale']): ExportMetadata => ({
    fwVersion: 'V1.0.0-test',
    publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'AAA', y: 'BBB' },
    publicKeyFingerprint: 'a3f9c2e1deadbeef',
    locale,
    excludedAccounts: { accounts: [{ platform: 'tiktok', author: 'quiet.one', addedAt: '2026-10-01T00:00:00.000Z' }], named: true },
    methodology: undefined,
  });

  it.each(UI_LANGUAGES)('%s: header, columns, intro and the one-sentence methodology note are the language\'s own', (lang) => {
    const html = buildForensicHtmlExport([], meta(lang));
    const t = I18N[lang];
    const section = sectionOf(html);
    for (const key of ['exclHeader', 'exclIntro', 'exclColAccount', 'exclColPlatform', 'exclColSince', 'exclColRecords'] as const) {
      expect(t[key].length, key).toBeGreaterThan(2);
      expect(section).toContain(escapeHtml(t[key]));
    }
    expect(section).toContain('@quiet.one');
    expect(t.exclCountOnly).toContain('{n}');
    expect(t.methodologyExclusionsNote).toContain('excludedSkipped');
    expect(t.exclIntro).toContain('excludedSkipped');
  });

  it('the English sentences carry no em dash, as the house rule says', () => {
    for (const lang of UI_LANGUAGES) {
      for (const key of ['exclHeader', 'exclIntro', 'exclCountOnly', 'methodologyExclusionsNote'] as const) {
        expect(I18N[lang][key], `${lang} ${key}`).not.toContain('—');
      }
    }
  });
});
