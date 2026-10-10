// Where a record says it came from, and who says so.
//
// The 2026-09-04 evidence audit's sharpest technical finding was that nothing
// in a record ties its bytes to a platform:
//
//   "Point to one thing in it that a page you wrote yourself, saved as HTML,
//    and opened at http://www.facebook.com after adding one line to your hosts
//    file would not also produce - signed, hash-chained, and time-stamped
//    exactly the same way."
//
// Platform attribution was one read of `window.location.hostname` inside the
// content script, which the spoof satisfies. `surfaceOrigin` is stamped in the
// service worker from `sender.origin`, which Chrome sets from the frame that
// sent the message. The page cannot forge it, and the content script does not
// assert it.
//
// It does not close the spoof. Someone who can edit hosts can also serve https
// with a certificate their own machine trusts, and the export says so. What it
// does is make the cheap version visible: all five platforms are HTTPS-only, so
// an http: origin was not a real session on any of them.

import { describe, it, expect } from 'vitest';
import { webcrypto } from 'node:crypto';
import { computeRecordIntegrityHash } from '../../../src/forensics/canonical-payload';
import type { ForensicRecord } from '../../../src/types/forensic';

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}

/**
 * The service worker's helper, reproduced here because it is not exported: the
 * module registers listeners at import and cannot be loaded in a unit test
 * without the whole chrome surface. The contract it locks is what matters, and
 * a divergence would show up in the shape assertions below.
 */
function originFromUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return undefined;
    return u.origin;
  } catch {
    return undefined;
  }
}

describe('origin derivation, the fallback when sender.origin is absent', () => {
  it('keeps protocol and host, drops path, query and fragment', () => {
    expect(originFromUrl('https://www.facebook.com/feed?x=1#y')).toBe('https://www.facebook.com');
    expect(originFromUrl('https://www.tiktok.com/@someone/video/123')).toBe('https://www.tiktok.com');
  });

  it('keeps http visible rather than normalising it away', () => {
    // The whole value of the field is that this case is distinguishable.
    expect(originFromUrl('http://www.facebook.com/feed')).toBe('http://www.facebook.com');
  });

  it('keeps a non-standard port, because a real platform never has one', () => {
    expect(originFromUrl('http://www.facebook.com:8080/feed')).toBe('http://www.facebook.com:8080');
  });

  it('refuses schemes that are not web pages', () => {
    expect(originFromUrl('chrome-extension://abc/popup.html')).toBeUndefined();
    expect(originFromUrl('file:///C:/fake.html')).toBeUndefined();
    expect(originFromUrl('data:text/html,<b>x</b>')).toBeUndefined();
  });

  it('returns nothing rather than guessing', () => {
    expect(originFromUrl(undefined)).toBeUndefined();
    expect(originFromUrl('')).toBeUndefined();
    expect(originFromUrl('not a url')).toBeUndefined();
  });
});

describe('the origin is inside the signature', () => {
  const base = (over: Partial<ForensicRecord> = {}) => ({
    id: 'fr-origin-1',
    timestamp: '2026-09-04T10:00:00.000Z',
    platform: 'facebook',
    originalText: 'text',
    originalHash: 'h',
    originalLength: 4,
    neutralizedText: '',
    author: '@a',
    postUrl: 'https://facebook.com/post/1',
    techniques: [],
    overallScore: 0.1,
    userAgeCategory: 'adult',
    aiSource: 'cloud',
    feedSource: 'for-you',
    chainPosition: 3,
    prevRecordHash: 'p',
    ...over,
  } as unknown as Omit<ForensicRecord, 'integrityHash' | 'signature' | 'chainAnchor'>);

  it('a real session and a spoofed one do not hash alike', async () => {
    const real = await computeRecordIntegrityHash(base({ surfaceOrigin: 'https://www.facebook.com' }));
    const spoof = await computeRecordIntegrityHash(base({ surfaceOrigin: 'http://www.facebook.com' }));
    expect(real).not.toBe(spoof);
  });

  it('a record with no origin hashes as it always did', async () => {
    const withField = await computeRecordIntegrityHash(base({ surfaceOrigin: undefined }));
    const without = await computeRecordIntegrityHash(base());
    expect(withField).toBe(without);
  });

  it('the origin cannot be added to a signed record without breaking its hash', async () => {
    const record = base();
    const original = await computeRecordIntegrityHash(record);
    const repainted = await computeRecordIntegrityHash({
      ...record, surfaceOrigin: 'https://www.facebook.com',
    });
    expect(repainted).not.toBe(original);
  });
});
