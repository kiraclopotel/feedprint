// @vitest-environment node
//
// The repair file: what it may carry, and that only our signature makes it count (11 Oct 2026).
//
// A site changes its page and a selector in one of our finders stops matching. A signed file, fetched at run time, may
// add a selector to a named finder, take one out, or switch it off. These tests pin the three things that make that safe:
// the file is closed (only strings, numbers and names; nothing that could run), a file that is not signed by a packaged
// key counts for nothing, and an old file cannot undo a newer one.

import { describe, expect, it } from 'vitest';
import { isSafeRepairSelector, isSafeRepairWord, parseRepairEnvelope, parseRepairPayload } from '../../../../src/core/repairs/format';
import { verifyRepairEnvelope, type RepairPublicKey } from '../../../../src/core/repairs/signed';

const NOW = Date.parse('2026-10-11T17:00:00Z');

const payload = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    v: 1, version: 7, issuedAt: '2026-10-11T16:00:00Z',
    entries: [{ family: 'youtube.count', add: ['like-button-view-model .newName'], remove: ['old'], note: 'renamed on 2026-10-09' }],
    ...over,
  });

describe('a payload is read strictly', () => {
  it('reads a good one', () => {
    const file = parseRepairPayload(payload(), NOW)!;
    expect(file.version).toBe(7);
    expect(file.entries).toEqual([{ family: 'youtube.count', add: ['like-button-view-model .newName'], remove: ['old'], off: false }]);
  });

  it('refuses what is not a repair file', () => {
    for (const bad of [
      '', 'not json', '[]', '{}', '{"v":2,"version":1,"issuedAt":"2026-10-11","entries":[]}',
      payload({ version: -1 }), payload({ version: 1.5 }), payload({ version: 'x' }), payload({ issuedAt: 'tomorrow' }),
      payload({ entries: 'x' }), payload({ entries: new Array(81).fill({ family: 'a.b' }) }),
      payload({ expiresAt: '2026-10-01T00:00:00Z' }), payload({ expiresAt: 'nope' }),
    ]) {
      expect(parseRepairPayload(bad, NOW), bad.slice(0, 60)).toBeNull();
    }
  });

  it('refuses a payload that is too large', () => {
    expect(parseRepairPayload(payload({ entries: [], pad: 'x'.repeat(61_000) }), NOW)).toBeNull();
  });

  it('skips an entry it does not understand and keeps the rest', () => {
    const file = parseRepairPayload(payload({
      entries: [
        { family: 'a.b', code: 'alert(1)' },
        { family: 'Bad Family', add: [] },
        { family: 'a.b', add: ['x'.repeat(241)] },
        { family: 'a.b', add: new Array(21).fill('y') },
        { family: 'a.b', add: [3] },
        { family: 'a.b', off: 'yes' },
        { family: 'c.d', add: ['.fine-class'], off: true },
      ],
    }), NOW)!;
    expect(file.entries).toEqual([{ family: 'c.d', add: ['.fine-class'], remove: [], off: true }]);
  });

  it('an expiry in the future is kept, in the past refuses the file', () => {
    expect(parseRepairPayload(payload({ expiresAt: '2026-12-01T00:00:00Z' }), NOW)!.expiresAt).toBe('2026-12-01T00:00:00Z');
    expect(parseRepairPayload(payload({ expiresAt: '2026-10-11T16:59:00Z' }), NOW)).toBeNull();
  });
});

describe('the envelope is read strictly', () => {
  it('reads payload, signature and key id as text', () => {
    expect(parseRepairEnvelope('{"payload":"p","signature":"s","keyId":"r1"}')).toEqual({ payload: 'p', signature: 's', keyId: 'r1' });
  });
  it('refuses anything else', () => {
    for (const bad of ['', '[]', '{}', '{"payload":1,"signature":"s","keyId":"r1"}', '{"payload":"p","signature":"s"}',
      JSON.stringify({ payload: 'p', signature: 's'.repeat(201), keyId: 'r1' })]) {
      expect(parseRepairEnvelope(bad), bad.slice(0, 40)).toBeNull();
    }
  });
});

describe('a selector a repair may carry', () => {
  it('names something specific', () => {
    for (const ok of [
      '[data-testid="tweet"]', '.ytSpecButtonShapeNextButtonTextContent', '#owner-sub-count', 'like-button-view-model',
      'ytd-comments#comments ytd-item-section-renderer', 'div[role="article"] > span[aria-label*="Reply" i]',
      'yt-content-metadata-view-model > .row:nth-child(n+2):has(> .delim)',
    ]) expect(isSafeRepairSelector(ok), ok).toBe(true);
  });

  it('is not a bare tag, not the universal selector, and not short', () => {
    for (const bad of ['*', 'div', 'span', 'body', 'html', 'a', 'button', 'main', 'nav', 'div, span', 'ul', 'p', '', 'ab']) {
      expect(isSafeRepairSelector(bad), bad).toBe(false);
    }
  });

  it('carries nothing that could be a declaration, a script or an escape', () => {
    for (const bad of [
      '.a { display:none }', '.a; color:red', '.a</style>', '.a\\.b', '@import "x"', '.a /* x */', '.a\n.b', 'url(x) .a',
      '.a'.padEnd(241, 'a'), '[data-x="javascript:alert(1)"]{x}', '.a{', '.a}',
      '[data-x="a"', '.a:has(.b', ".a[title='x]", '.a)', '.a]',
    ]) {
      expect(isSafeRepairSelector(bad), JSON.stringify(bad)).toBe(false);
    }
  });
});

describe('a word a repair may carry', () => {
  it('is a short phrase of letters, digits and a little punctuation, in any script', () => {
    for (const ok of ['Sponsored', 'Promovat', 'Sponsorisé', 'Gesponsert', 'Реклама', '広告', 'Ad.', "L'annonce"]) expect(isSafeRepairWord(ok), ok).toBe(true);
  });
  it('is not markup, a script or too long', () => {
    for (const bad of ['', 'a', '<b>x</b>', 'x'.repeat(61), 'a;b', 'a\nb', 'javascript:alert(1)', '{x}']) expect(isSafeRepairWord(bad), JSON.stringify(bad)).toBe(false);
  });
});

async function makeKey(): Promise<{ keys: RepairPublicKey[]; sign: (text: string) => Promise<string> }> {
  const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const toB64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
  return {
    keys: [{ id: 'r1', publicKeyB64: toB64(raw) }],
    sign: async (text: string) => toB64(new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, pair.privateKey, new TextEncoder().encode(text)))),
  };
}

describe('only a packaged key makes a file count', () => {
  it('accepts a file signed by a packaged key', async () => {
    const { keys, sign } = await makeKey();
    const text = payload();
    const file = await verifyRepairEnvelope({ payload: text, signature: await sign(text), keyId: 'r1' }, keys, NOW);
    expect(file?.version).toBe(7);
  });

  it('refuses a payload changed after signing, a signature from another key, an unknown key id, a bad signature', async () => {
    const a = await makeKey();
    const b = await makeKey();
    const text = payload();
    const good = await a.sign(text);
    expect(await verifyRepairEnvelope({ payload: text + ' ', signature: good, keyId: 'r1' }, a.keys, NOW)).toBeNull();
    expect(await verifyRepairEnvelope({ payload: text, signature: await b.sign(text), keyId: 'r1' }, a.keys, NOW)).toBeNull();
    expect(await verifyRepairEnvelope({ payload: text, signature: good, keyId: 'r9' }, a.keys, NOW)).toBeNull();
    expect(await verifyRepairEnvelope({ payload: text, signature: 'AAAA', keyId: 'r1' }, a.keys, NOW)).toBeNull();
    expect(await verifyRepairEnvelope({ payload: text, signature: '!!!not base64', keyId: 'r1' }, a.keys, NOW)).toBeNull();
  });

  it('refuses a validly signed payload that is not a repair file, or has expired', async () => {
    const { keys, sign } = await makeKey();
    for (const text of ['{"v":2}', 'garbage', payload({ expiresAt: '2026-10-01T00:00:00Z' })]) {
      expect(await verifyRepairEnvelope({ payload: text, signature: await sign(text), keyId: 'r1' }, keys, NOW), text.slice(0, 30)).toBeNull();
    }
  });

  it('never throws, whatever it is given', async () => {
    const { keys } = await makeKey();
    expect(await verifyRepairEnvelope({ payload: '', signature: '', keyId: '' }, keys, NOW)).toBeNull();
    expect(await verifyRepairEnvelope({ payload: 'x', signature: 'y', keyId: 'r1' }, [{ id: 'r1', publicKeyB64: 'short' }], NOW)).toBeNull();
  });
});
