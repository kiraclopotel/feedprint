// The one rule for which language of feelingwise.org a reader is sent to. The site is in English
// and Romanian only, so Spanish and Portuguese readers get English: a page in a second language
// beats a link to nothing. Kept in one place because a rule written twice drifts.

const ORIGIN = 'https://feelingwise.org';

/** The page for this interface language: the Romanian one for ro, else English. */
export function sitePageUrl(lang: string, page: string, anchor = ''): string {
  const localized = lang === 'ro' ? `${page}-ro` : page;
  return `${ORIGIN}/${localized}${anchor}`;
}

/**
 * Where Off's popup sends a reader who wants to know what it does with their information: the
 * short "If you use Off" summary at the top of the privacy page, not the whole legal text, which
 * is written for the other extension and opens on a proxy and a paid AI that Off does not have.
 */
export function offPrivacyUrl(lang: string): string {
  return sitePageUrl(lang, 'privacy', '#off');
}
