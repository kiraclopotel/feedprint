// Verdict cache-key construction — the SINGLE source of truth for the cache-key
// dimensions (mirrors the "LRU cache keyed by …" comment at the top of cache.ts).
// Pure + dependency-free, in its OWN module so a test that mocks the stateful
// `processingCache` singleton does not also have to mock this. Callers sha256()
// the returned string.
//
// Used by the per-post pipeline (writer + reader) AND the comment-batch reframe
// primer (writer) so a reframe computed for a comment is reused when the SAME
// text is later seen as a focused-tweet post on its permalink.
//
// Dimensions: platform | mode | locale | outputLanguage | text.

export function verdictCacheKeyInput(
  platform: string,
  mode: string,
  locale: string,
  outputLanguage: string,
  text: string,
): string {
  return `${platform}|${mode}|${locale}|${outputLanguage}|${text}`;
}
