// FeelingWise — is this Facebook [role="article"] a comment or a post?
//
// One module, because the answer is needed by three layers that must not
// disagree: the recorder's adapter (platforms/facebook.ts), the on-demand
// reading (markers/read-this.ts) and the comment block switch
// (engagement/facebook-engagement.ts). It carries no adapter, no DOM writing
// and no imports, so the Off build can take it without taking the recorder.

/**
 * True when a Facebook `[role="article"]` aria-label names a comment or a
 * reply rather than a post. Facebook localises the label per the user's
 * Facebook language ("Comment by X", "Comentariu adăugat de X", "Răspuns de
 * la X", "Reply to X"); the stems cover the locales seen live. The reply
 * stems matter: reply articles arriving through the mutation observer used
 * to fall through as posts and land as kind='post' records. Shared with the
 * on-demand reading (content/read-this.ts), which decides a picked item's
 * kind by the same rule.
 */
/**
 * The aria-label stems that mark a Facebook comment or reply, lowercased.
 *
 * ONE list. There were two inside this file and they had already diverged:
 * this one and the extractor's differed on which English reply forms they
 * carried, so a label could be a comment to one predicate and a post to the
 * other. A third copy lives in engagement/facebook-engagement.ts as CSS
 * selectors and a fourth in empty-comment-hide.ts; those two cannot share a
 * plain array, but this pair can and now does.
 *
 * 'reply by' and 'reply from' come from the LIVE diagnostic that built the
 * engagement list. Neither was here until 2026-09-08, while the two forms that
 * were are marked '(presumed)' in their own comment — so every English reply
 * was dropped or misfiled, on the locale that is most of the weekly users. The
 * verified Romanian string, "Răspuns de la X", is literally "Reply from X".
 */
const FB_COMMENT_LABEL_STEMS: readonly string[] = [
  // Top-level comment patterns
  'comentariu',   // RO: "Comentariu adăugat de"
  'comment by',   // EN
  'comment from',
  'commentaire',  // FR
  'comentario',   // ES
  'comentário',   // PT
  'kommentar',    // DE / Nordic
  'commento',     // IT
  // Reply patterns: the same role="article" wrapper, a different label
  'răspuns',      // RO: "Răspuns de la X" — verified live on an RO permalink
  'raspuns',      // RO without diacritics — Facebook renders both
  'reply by',     // EN — observed live
  'reply from',   // EN — observed live
  'reply to',     // EN: "Reply to X" / "Reply to comment by X"
  'replied to',   // EN: "X replied to comment by Y"
  'réponse',      // FR
  'respuesta',    // ES
  'resposta',     // PT
  'svar',         // SV / DA / NO
  'antwort',      // DE
  'risposta',     // IT
];

/**
 * The one English form no prefix rule reaches: "X replied to comment by Y"
 * puts the author's name first, so a startsWith test on 'replied to' can never
 * fire and the stem was dead as written. This phrase is specific enough to
 * carry no false-positive surface of its own.
 */
const FB_REPLIED_TO_PHRASE = ' replied to comment by';

/**
 * True when this `[role="article"]` owns a comment permalink.
 *
 * Facebook renders the timestamp of a comment or a reply as an anchor whose
 * href carries `?comment_id=<id>` (Q58, live-attested 2026-08-11). A post's
 * own timestamp anchor never does. The anchors of the comments inside a post
 * belong to their own `[role="article"]`, so the test is "an anchor this
 * article owns", never "an anchor somewhere under it": on a permalink page the
 * post article contains every comment's anchor, and a containment test would
 * call the post a comment.
 *
 * Why this exists beside the label list: the label is localised, the list
 * carries eight European languages, and Facebook is read in about a hundred.
 * A comment whose label the list does not carry was dropped by the comment
 * walker or, when it reached the post path, written to the chain as a
 * top-level post with a synthetic id, which pollutes the post count and loses
 * the thread (2026-09-08 characterisation, docs/history/2026-09/STATE-DETAIL-2026-09-14.md).
 * `comment_id` is the same word in every language.
 */
export function facebookOwnCommentId(article: Element): string | null {
  for (const anchor of article.querySelectorAll<HTMLAnchorElement>('a[href*="comment_id="]')) {
    if (anchor.closest('[role="article"]') !== article) continue;
    // Read off the href as text rather than through URL, so a relative href,
    // a missing base and a malformed link all degrade to "no id" instead of
    // throwing on a hot path.
    const id = /[?&]comment_id=([^&#]+)/.exec(anchor.getAttribute('href') ?? '')?.[1];
    if (id) return decodeURIComponent(id);
    return '';
  }
  return null;
}

export function hasOwnFacebookCommentAnchor(article: Element): boolean {
  return facebookOwnCommentId(article) !== null;
}

/**
 * True when this `[role="article"]` is a comment or a reply rather than a
 * post: the localised label in the languages the list carries, or the comment
 * permalink in every language. Both signals are needed. A comment that has not
 * yet rendered its timestamp anchor still has its label; a comment in a locale
 * the list misses still has its anchor.
 */
export function isFacebookCommentArticle(article: Element): boolean {
  return isFacebookCommentLabel(article.getAttribute('aria-label'))
    || hasOwnFacebookCommentAnchor(article);
}

export function isFacebookCommentLabel(ariaLabel: string | null | undefined): boolean {
  const label = (ariaLabel || '').toLowerCase();
  if (!label) return false;
  const COMMENT_LABEL_STEMS = FB_COMMENT_LABEL_STEMS;
  if (label.includes(FB_REPLIED_TO_PHRASE)) return true;
  // Tolerate an optional parenthesized prefix some FB locales attach to the
  // aria-label (e.g. "(John Doe) replied to comment by..."); a strict
  // startsWith on the bare stem would misroute these as posts. The
  // `[^)]{1,80}` cap plus the letter lookahead at the strip boundary keeps
  // labels like "(Pinned post by John) See translation" from being re-aimed
  // at the stems.
  const stripped = label.replace(/^\([^)]{1,80}\)\s+(?=[a-zà-ÿ])/i, '');
  return COMMENT_LABEL_STEMS.some(s => label.startsWith(s) || stripped.startsWith(s));
}
