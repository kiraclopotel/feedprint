// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { isForeignPostUrlHost, normalizePostUrlHost } from '../../../../src/content/record/post-url-host';

// Turn 91 — a facebook.com post URL was reported under an instagram.com
// context. This is the mechanical check that decides, per record, whether a
// post URL and the page that produced it actually agree.

describe('normalizePostUrlHost', () => {
  it('strips the www/m/web/mobile front label', () => {
    expect(normalizePostUrlHost('www.instagram.com')).toBe('instagram.com');
    expect(normalizePostUrlHost('m.facebook.com')).toBe('facebook.com');
    expect(normalizePostUrlHost('web.facebook.com')).toBe('facebook.com');
    expect(normalizePostUrlHost('mobile.twitter.com')).toBe('x.com');
  });

  it('folds twitter.com into x.com — X kept both hosts live', () => {
    expect(normalizePostUrlHost('twitter.com')).toBe('x.com');
    expect(normalizePostUrlHost('x.com')).toBe('x.com');
  });

  it('leaves every other host literal', () => {
    expect(normalizePostUrlHost('FACEBOOK.com')).toBe('facebook.com');
    expect(normalizePostUrlHost('business.facebook.com')).toBe('business.facebook.com');
  });
});

describe('isForeignPostUrlHost', () => {
  it('reads the reported pairing as foreign', () => {
    expect(isForeignPostUrlHost(
      'https://www.facebook.com/photo/?fbid=123&set=gm.456',
      'www.instagram.com',
    )).toBe(true);
  });

  it('accepts a same-platform URL across the www/m split', () => {
    expect(isForeignPostUrlHost('https://www.instagram.com/p/ABC/', 'instagram.com')).toBe(false);
    expect(isForeignPostUrlHost('https://m.facebook.com/reel/9', 'www.facebook.com')).toBe(false);
  });

  it('accepts x.com URLs on twitter.com and back', () => {
    expect(isForeignPostUrlHost('https://x.com/a/status/1', 'twitter.com')).toBe(false);
    expect(isForeignPostUrlHost('https://twitter.com/a/status/1', 'x.com')).toBe(false);
  });

  it('never calls a hostless value foreign — it carries nothing to disagree with', () => {
    expect(isForeignPostUrlHost('', 'instagram.com')).toBe(false);
    expect(isForeignPostUrlHost('/p/ABC/', 'instagram.com')).toBe(false);
    expect(isForeignPostUrlHost('not a url', 'instagram.com')).toBe(false);
    expect(isForeignPostUrlHost('https://', 'instagram.com')).toBe(false);
  });

  it('never fires when the document host is unknown', () => {
    expect(isForeignPostUrlHost('https://www.facebook.com/p/X-1/', '')).toBe(false);
  });
});
