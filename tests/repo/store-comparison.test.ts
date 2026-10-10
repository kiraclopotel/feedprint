// A build compared with the copy Chrome installed from the Chrome Web Store
// (scripts/reproducible-build.mjs --verify-installed).
//
// The store never hands out the uploaded zip, so its hash is only our record. An installed copy
// carries _metadata/verified_contents.json: the tree hash of every file the store served, signed
// with the store's key, which Chromium publishes. The fixture is that file and the installed
// manifest.json from Receipts 2.5.8 as Chrome installed it on 2026-09-16; both are what the store
// gives every person who installs it. On that copy the signature verifies, and 23 of the 24 files
// of the uploaded zip carry exactly the signed hashes; manifest.json is edited by the store before
// it signs, so it is compared as data.
import { describe, expect, it } from 'vitest';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  STORE_UPDATE_URL,
  compareWithStore,
  extensionIdFromKey,
  filesDigest,
  parseArgs,
  readSignedContents,
  treeHashRoot,
} from '../../scripts/reproducible-build.mjs';
import { repoPath } from '../helpers/repo-root';

const FIXTURE = (name: string) => repoPath('tests', 'fixtures', 'chrome-web-store-install', 'receipts-2.5.8', name);
const record = JSON.parse(readFileSync(FIXTURE('verified_contents.json'), 'utf8'));
const installedManifest = JSON.parse(readFileSync(FIXTURE('installed-manifest.json'), 'utf8'));
const RECEIPTS = 'mcdanhgfcpjpajlmjcdfeaeanlkodifp';

const sha = (b: Buffer) => createHash('sha256').update(b).digest();

describe('what the store signed', () => {
  it('reads the record of a real install, signed with the key Chromium publishes', () => {
    const signed = readSignedContents(record);
    expect(signed.itemId).toBe(RECEIPTS);
    expect(signed.itemVersion).toBe('2.5.8');
    expect(signed.files.size).toBe(24);
    expect(signed.files.has('manifest.json')).toBe(true);
  });

  it('refuses a record whose hashes were changed after signing', () => {
    const forged = structuredClone(record);
    const body = JSON.parse(Buffer.from(forged[0].signed_content.payload, 'base64url').toString('utf8'));
    body.content_hashes[0].files[0].root_hash = 'A'.repeat(43);
    forged[0].signed_content.payload = Buffer.from(JSON.stringify(body)).toString('base64url');
    expect(() => readSignedContents(forged)).toThrow(/does not verify/);
  });

  it('refuses a record signed by anyone but the store', () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const forged = structuredClone(record);
    const entry = forged[0].signed_content;
    const webstore = entry.signatures.find((s: { header: { kid: string } }) => s.header.kid === 'webstore');
    webstore.signature = sign('sha256', Buffer.from(`${webstore.protected}.${entry.payload}`), privateKey).toString('base64url');
    expect(() => readSignedContents(forged)).toThrow(/does not verify/);
    // The same file does verify under the key that signed it, so the refusal above is the key's doing.
    const der = publicKey.export({ format: 'der', type: 'spki' }).toString('hex');
    expect(readSignedContents(forged, der).itemId).toBe(RECEIPTS);
  });

  it('derives the extension id from the key the store puts in the manifest', () => {
    expect(extensionIdFromKey(installedManifest.key)).toBe(RECEIPTS);
    expect(installedManifest.update_url).toBe(STORE_UPDATE_URL);
  });
});

describe("Chromium's tree hash", () => {
  it('is the hash of nothing for an empty file, and of the block for one block', () => {
    expect(treeHashRoot(Buffer.alloc(0))).toBe(sha(Buffer.alloc(0)).toString('base64url'));
    const block = Buffer.alloc(4096, 7);
    expect(treeHashRoot(block)).toBe(sha(block).toString('base64url'));
  });

  it('hashes the block hashes together, 128 to a node, until one is left', () => {
    const two = Buffer.alloc(4097, 1);
    expect(treeHashRoot(two)).toBe(sha(Buffer.concat([sha(two.subarray(0, 4096)), sha(two.subarray(4096))])).toString('base64url'));
    const big = Buffer.alloc(129 * 4096, 2);
    const leaves = Array.from({ length: 129 }, (_, i) => sha(big.subarray(i * 4096, (i + 1) * 4096)));
    const level = [sha(Buffer.concat(leaves.slice(0, 128))), sha(leaves[128])];
    expect(treeHashRoot(big)).toBe(sha(Buffer.concat(level)).toString('base64url'));
  });
});

describe('a build against an installed copy', () => {
  // A small build, and the record the store would have signed for it.
  const manifest = { manifest_version: 3, name: 'x', version: '1.0.0', permissions: ['storage'] };
  const built = new Map<string, Buffer>([
    ['manifest.json', Buffer.from(JSON.stringify(manifest, null, 2))],
    ['content.js', Buffer.from('console.log(1)')],
    ['_locales/en/messages.json', Buffer.from('{"a":{"message":"b"}}')],
  ]);
  const signedFor = (files: Map<string, Buffer>) => ({
    itemId: RECEIPTS,
    itemVersion: '1.0.0',
    files: new Map([...files].map(([p, b]) => [p, p === 'manifest.json' ? 'edited-by-the-store' : treeHashRoot(b)])),
  });
  const installed = { ...manifest, key: installedManifest.key, update_url: STORE_UPDATE_URL };
  const compare = (over: Partial<Parameters<typeof compareWithStore>[0]> = {}) =>
    compareWithStore({ built, signed: signedFor(built), installedManifest: installed, storeId: RECEIPTS, ...over });

  it('matches when every file is what the store signed and the manifest only gained its two keys', () => {
    expect(compare()).toEqual({ matching: ['content.js', '_locales/en/messages.json', 'manifest.json (as data)'], problems: [] });
  });

  it('names a changed file, a file only one side has, and a store record for another extension', () => {
    const changed = new Map(built).set('content.js', Buffer.from('console.log(2)'));
    expect(compare({ built: changed }).problems).toEqual(['content.js: different from what the store signed']);
    const extra = new Map(built).set('extra.js', Buffer.from('x'));
    expect(compare({ built: extra }).problems).toEqual(['extra.js: in this build, not in what the store signed']);
    const fewer = new Map(built);
    fewer.delete('content.js');
    expect(compare({ built: fewer, signed: signedFor(built) }).problems).toEqual(['content.js: signed by the store, not in this build']);
    expect(compare({ storeId: 'kebfpnjiiiboofdjhomcbgphfnlbahmh' }).problems).toEqual([
      `the store signed item ${RECEIPTS}, not kebfpnjiiiboofdjhomcbgphfnlbahmh`,
      'manifest.json: its key is not the key of kebfpnjiiiboofdjhomcbgphfnlbahmh',
    ]);
  });

  it('holds the manifest to the data: a permission, another update address or another key is named', () => {
    expect(compare({ installedManifest: { ...installed, permissions: ['storage', 'tabs'] } }).problems).toEqual(['manifest.json: permissions differ from this build']);
    expect(compare({ installedManifest: { ...installed, update_url: 'https://example.com/update' } }).problems[0]).toMatch(/update_url is "https:\/\/example.com\/update"/);
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
    expect(compare({ installedManifest: { ...installed, key: other } }).problems).toEqual([`manifest.json: its key is not the key of ${RECEIPTS}`]);
    // Key order and whitespace are Chrome's rewrite, not a difference.
    const reordered = Object.fromEntries(Object.entries(installed).reverse());
    expect(compare({ installedManifest: reordered }).problems).toEqual([]);
    // A copy that arrived as a differential update carries a third field the unpacker writes; a
    // string is tolerated like key and update_url, anything else is named.
    expect(compare({ installedManifest: { ...installed, differential_fingerprint: '1.abc' } }).problems).toEqual([]);
    expect(compare({ installedManifest: { ...installed, differential_fingerprint: 7 } }).problems).toEqual(['manifest.json: differential_fingerprint is not a string']);
  });
});

describe('the command line', () => {
  it('refuses an argument it does not know, so a misspelt check never passes as one that ran', () => {
    expect(() => parseArgs(['--verfy', 'x.zip'])).toThrow(/unknown argument "--verfy"/);
    expect(() => parseArgs(['--product'])).toThrow(/needs a value/);
    expect(() => parseArgs(['--verify-installed', 'folder'])).toThrow(/needs --product/);
    expect(() => parseArgs(['--expect-release', '--allow-dirty'])).toThrow(/--allow-dirty/);
    expect(parseArgs(['--product', 'off', '--expect-release'])).toEqual({ '--product': 'off', '--expect-release': true });
  });
});

describe('the contents hash', () => {
  it('depends on the files and their paths, not on the order they were read in', () => {
    const a = new Map([['b.js', Buffer.from('2')], ['a.js', Buffer.from('1')]]);
    const b = new Map([['a.js', Buffer.from('1')], ['b.js', Buffer.from('2')]]);
    expect(filesDigest(a)).toBe(filesDigest(b));
    expect(filesDigest(new Map([['a.js', Buffer.from('1')], ['c.js', Buffer.from('2')]]))).not.toBe(filesDigest(a));
  });
});
