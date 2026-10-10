// FeelingWise — post-URL host agreement.
//
// A record's postUrl is supposed to point at the post the child actually saw,
// on the surface FW saw it on. Chrome's extension error console showed one
// `facebook.com/photo/?fbid=...&set=gm.<group>` URL reported under context
// `https://www.instagram.com/` (2026-08-02). Two of the three explanations for
// that pairing are dead:
//
//   • Chrome collapsing two occurrences under one context — Chromium's
//     `RuntimeError::IsEqualImpl` compares `context_url_` as part of error
//     equivalence, so two errors from different pages never merge.
//   • A stale URL surviving an SPA route change — the platform is re-read from
//     `window.location.hostname` at every detection, content scripts are
//     top-frame only, and facebook.com → instagram.com is a cross-origin
//     document swap that keeps nothing.
//
// What survives is cross-surface extraction: an extractor accepting an anchor
// that points at another platform. This module does not decide that question,
// it MEASURES it — every post URL is checked against the document that produced
// it, and a disagreement is counted and named instead of guessed at.
//
// Host normalization is deliberately narrow: strip the www/m/web front, and
// treat twitter.com and x.com as one host (X kept both live). Everything else
// compares literally, so `facebook.com` under `instagram.com` reads foreign,
// which is the point.

const HOST_PREFIX = /^(?:www|m|web|mobile)\./;

/** Registrable-ish host: front label stripped, twitter folded into x. */
export function normalizePostUrlHost(host: string): string {
  const bare = host.toLowerCase().replace(HOST_PREFIX, '');
  return bare === 'twitter.com' ? 'x.com' : bare;
}

/**
 * True when `postUrl` carries an absolute http(s) host that disagrees with the
 * document host. Relative URLs, empty strings and unparseable values are never
 * foreign — they carry no host to disagree with. Pure.
 */
export function isForeignPostUrlHost(postUrl: string, documentHost: string): boolean {
  if (!postUrl || !/^https?:\/\//i.test(postUrl)) return false;
  if (!documentHost) return false;
  let host: string;
  try {
    host = new URL(postUrl).hostname;
  } catch {
    return false;
  }
  if (!host) return false;
  return normalizePostUrlHost(host) !== normalizePostUrlHost(documentHost);
}

/** Current document host, or '' where there is no document (tests, worker). */
export function currentDocumentHost(): string {
  return typeof location !== 'undefined' ? location.hostname : '';
}
