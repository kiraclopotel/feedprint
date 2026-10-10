// The Firefox copy of each product is the Chrome build with a different manifest and shorter names, and nothing else.
// These read the real manifests, languages and overlay, so a name that grows past addons.mozilla.org's limit, a new
// manifest key, or a Chrome-only permission is caught here and not at upload.

import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, cpSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  AMO_NAME_LIMIT, firefoxManifest, firefoxMessages, makeFirefoxCopy, manifestDrift, readOverlay,
} from '../../scripts/firefox-package.mjs';
import { RELEASE_PRODUCTS, parseReleases, productConfig, RELEASE_COLUMNS } from '../../scripts/reproducible-build.mjs';
import { repoPath } from '../helpers/repo-root';

const read = (p: string): Record<string, unknown> => JSON.parse(readFileSync(repoPath(p), 'utf8'));
const LOCALES = ['en', 'es', 'pt_BR', 'ro'];
const messages = (): Record<string, Record<string, { message: string }>> =>
  Object.fromEntries(LOCALES.map((l) => [l, read(`_locales/${l}/messages.json`) as Record<string, { message: string }>]));

// The built manifest names the bundled worker; the source names the TypeScript entry. The transform treats both alike.
const builtReceipts = (): Record<string, unknown> => ({ ...read('manifest.json'), background: { service_worker: 'service-worker.js', type: 'module' } });

describe('the Firefox manifest', () => {
  it('runs the Receipts worker as a background script, keeps its module type, and drops only downloads.ui', () => {
    const chrome = builtReceipts();
    const firefox = firefoxManifest(chrome, readOverlay('receipts'));
    expect(firefox.background).toEqual({ scripts: ['service-worker.js'], type: 'module' });
    expect(firefox.permissions).toEqual((chrome.permissions as string[]).filter((p) => p !== 'downloads.ui'));
    expect(manifestDrift(chrome, firefox)).toEqual([]);
  });

  it('adds no background to Off and leaves its permissions alone', () => {
    const chrome = read('manifest.off.json');
    const firefox = firefoxManifest(chrome, readOverlay('off'));
    expect(firefox.background).toBeUndefined();
    expect(firefox.permissions).toEqual(chrome.permissions);
    expect(manifestDrift(chrome, firefox)).toEqual([]);
  });

  it('refuses a background it was not written for', () => {
    expect(() => firefoxManifest({ ...builtReceipts(), background: { service_worker: 'a.js', persistent: false } }, readOverlay('receipts'))).toThrow(/unexpected background/);
  });

  it('carries an id, a lowest version and a data statement addons.mozilla.org accepts', () => {
    const ALLOWED = ['authenticationInfo', 'bookmarksInfo', 'browsingActivity', 'financialAndPaymentInfo', 'healthInfo', 'locationInfo',
      'personalCommunications', 'personallyIdentifyingInfo', 'searchTerms', 'websiteActivity', 'websiteContent'];
    for (const product of ['receipts', 'off']) {
      const { gecko } = readOverlay(product);
      expect(gecko.id.length).toBeLessThanOrEqual(80);
      expect(gecko.id).toMatch(/^[a-z0-9.-]+@feelingwise\.org$/);
      // The data statement works from Firefox 140; an older Firefox would install with no statement shown.
      expect(Number(gecko.strict_min_version.split('.')[0])).toBeGreaterThanOrEqual(140);
      const { required, optional = [] } = gecko.data_collection_permissions;
      expect(required.length === 1 && required[0] === 'none' || required.every((c: string) => ALLOWED.includes(c))).toBe(true);
      for (const c of optional) expect([...ALLOWED, 'technicalAndInteraction']).toContain(c);
    }
    expect(readOverlay('receipts').gecko.id).not.toBe(readOverlay('off').gecko.id);
  });
});

describe('the Firefox names', () => {
  it(`fit addons.mozilla.org's ${AMO_NAME_LIMIT} characters in every language, for both products`, () => {
    for (const product of ['receipts', 'off']) {
      const overlay = readOverlay(product);
      const out = firefoxMessages(messages(), overlay);
      for (const l of LOCALES) {
        const name = out[l][overlay.nameKey].message;
        expect([...name].length, `${product} ${l}: ${name}`).toBeLessThanOrEqual(AMO_NAME_LIMIT);
        expect(name.startsWith(product === 'off' ? 'Off' : 'Feedprint')).toBe(true);
      }
    }
  });

  it('keep the Chrome name where it already fits, and change no other message', () => {
    const overlay = readOverlay('receipts');
    const before = messages();
    const out = firefoxMessages(before, overlay);
    expect(out.en.receiptsName.message).toBe(before.en.receiptsName.message);
    for (const l of LOCALES) {
      for (const k of Object.keys(before[l])) if (k !== overlay.nameKey) expect(out[l][k]).toEqual(before[l][k]);
    }
  });

  it('refuse a name over the limit rather than ship one the store turns away', () => {
    const long = { en: { offName: { message: 'Off - ' + 'x'.repeat(60) } } };
    expect(() => firefoxMessages(long, { nameKey: 'offName', names: {} })).toThrow(/takes 50/);
  });
});

describe('the Firefox copy of a build', () => {
  it('is the Chrome folder byte for byte apart from the manifest and the names, and leaves the Chrome folder as it was', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'fw-firefox-'));
    mkdirSync(join(tmp, 'scripts', 'firefox'), { recursive: true });
    cpSync(repoPath('scripts/firefox/overlay.json'), join(tmp, 'scripts', 'firefox', 'overlay.json'));
    const dist = join(tmp, readOverlay('off').chromeDist);
    for (const l of LOCALES) {
      mkdirSync(join(dist, '_locales', l), { recursive: true });
      cpSync(repoPath(`_locales/${l}/messages.json`), join(dist, '_locales', l, 'messages.json'));
    }
    const chromeManifest = JSON.stringify(read('manifest.off.json'), null, 2);
    writeFileSync(join(dist, 'manifest.json'), chromeManifest);
    writeFileSync(join(dist, 'content.js'), 'console.log(1);\n');

    const r = makeFirefoxCopy('off', tmp);
    expect(r.to).toBe(readOverlay('off').firefoxDist);
    expect(readFileSync(join(tmp, r.to, 'content.js'), 'utf8')).toBe('console.log(1);\n');
    const ff = JSON.parse(readFileSync(join(tmp, r.to, 'manifest.json'), 'utf8'));
    expect(ff.browser_specific_settings.gecko.id).toBe('off@feelingwise.org');
    expect(readFileSync(join(dist, 'manifest.json'), 'utf8')).toBe(chromeManifest);
    expect(JSON.parse(readFileSync(join(dist, '_locales', 'en', 'messages.json'), 'utf8')).offName.message)
      .toBe((read('_locales/en/messages.json') as Record<string, { message: string }>).offName.message);
  });

  it('refuses to run before the Chrome build exists', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'fw-firefox-'));
    mkdirSync(join(tmp, 'scripts', 'firefox'), { recursive: true });
    cpSync(repoPath('scripts/firefox/overlay.json'), join(tmp, 'scripts', 'firefox', 'overlay.json'));
    expect(() => makeFirefoxCopy('receipts', tmp)).toThrow(/build the Chrome copy first/);
    expect(existsSync(join(tmp, readOverlay('receipts').firefoxDist))).toBe(false);
  });
});

describe('the reproducible build knows the Firefox copies', () => {
  it('builds each from the Chrome build plus the copy step, with no Chrome store item', () => {
    expect(productConfig('receipts-firefox')).toMatchObject({ script: 'build:firefox', dist: 'dist-firefox', stem: 'receipts-firefox', storeId: null });
    expect(productConfig('off-firefox')).toMatchObject({ script: 'build:off-firefox', dist: 'dist-off-firefox', stem: 'off-firefox', storeId: null });
    expect(RELEASE_PRODUCTS).toEqual(['receipts', 'off', 'receipts-firefox', 'off-firefox']);
  });

  it('accepts a Firefox row in the release ledger', () => {
    const row = ['off-firefox', '1.0.13', 'a'.repeat(40), '24.14.0', 'c'.repeat(64), 'd'.repeat(64), '2026-10-20'].join('\t');
    expect(parseReleases(`${RELEASE_COLUMNS.join('\t')}\n${row}\n`)[0].product).toBe('off-firefox');
  });

  it('wires the npm targets to the copy step', () => {
    const scripts = (read('package.json') as { scripts: Record<string, string> }).scripts;
    expect(scripts['build:firefox']).toBe('npm run build && node scripts/firefox-package.mjs --product receipts');
    expect(scripts['build:off-firefox']).toBe('npm run build:off && node scripts/firefox-package.mjs --product off');
    // The Chrome targets are untouched by the Firefox ones.
    expect(scripts.build).not.toContain('firefox');
    expect(scripts['build:off']).not.toContain('firefox');
  });
});
