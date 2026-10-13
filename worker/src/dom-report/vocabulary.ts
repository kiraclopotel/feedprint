// What a page report may say about words and addresses (11 Oct 2026).
//
// This file exists twice, byte for byte: src/core/dom-report/vocabulary.ts (the extension) and worker/src/dom-report/vocabulary.ts
// (the relay; its tsconfig cannot reach src/). A test fails when they differ. Edit both.
//
// A report of a broken page describes its STRUCTURE: tags, roles, which attributes exist, how things nest. It never
// carries what a person reads or what identifies them: no text, no names, no addresses, no ids. Two kinds of string on a
// page are structural all the same and a finder cannot be diagnosed without them:
//
//   - the label a control carries ("Send Message", "Actions for this post"). Our finders match on these.
//   - the shape of an address ("/p/<code>/", "/@<name>/video/<id>"). Our readers match on these.
//
// Both are kept only as far as this file can prove they hold nothing personal. A label keeps its leading words while
// each one is a word from the closed list below (interface words in the six languages we ship), up to three, then says
// how many words follow and nothing else: "Send Message" -> "send+message"; "Actions for this post by Jane Doe" ->
// "actions+for+this+4w"; "Jane Doe" -> "2w". An address keeps a path segment only if it is one of the site sections
// below; a handle becomes "@", a number "0", anything else "*". The lists are closed on purpose: a word or a section
// that is not on them is counted, not copied.

/** Fold a word to lower-case letters without accents, so "Răspunde" and "raspunde" are one word. */
export function foldWord(word: string): string {
  return word
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ł/g, 'l')
    .toLowerCase()
    .replace(/[^a-z]+/g, '');
}

// Interface words only: verbs of the controls, nouns for the parts of a page, the small words around them. Nothing that
// is also a common first name or surname. English, Romanian, Spanish, French, German, Portuguese; folded, so no accents.
const UI_WORDS: ReadonlySet<string> = new Set([
  // English
  'like', 'unlike', 'comment', 'comments', 'share', 'send', 'message', 'messages', 'reply', 'replies', 'follow', 'following',
  'unfollow', 'unfriend', 'friend', 'friends', 'block', 'report', 'save', 'saved', 'more', 'options', 'option', 'actions',
  'action', 'for', 'this', 'post', 'posts', 'by', 'to', 'from', 'see', 'view', 'all', 'close', 'menu', 'search', 'home',
  'back', 'next', 'previous', 'play', 'pause', 'mute', 'unmute', 'settings', 'profile', 'page', 'add', 'delete', 'remove',
  'hide', 'show', 'open', 'learn', 'watch', 'subscribe', 'subscribed', 'join', 'shop', 'buy', 'sponsored', 'ad', 'promoted',
  'about', 'people', 'story', 'stories', 'reel', 'reels', 'video', 'videos', 'photo', 'photos', 'react', 'reaction',
  'reactions', 'toggle', 'turn', 'on', 'off', 'of', 'in', 'your', 'the', 'a', 'and', 'or', 'new', 'top', 'that', 'is',
  // Romanian
  'apreciaza', 'aprecieri', 'comenteaza', 'comentariu', 'comentarii', 'distribuie', 'trimite', 'mesaj', 'raspunde',
  'raspuns', 'raspunsuri', 'urmareste', 'nu', 'mai', 'urmari', 'blocheaza', 'raporteaza', 'salveaza', 'multe', 'optiuni',
  'actiuni', 'pentru', 'aceasta', 'postare', 'de', 'la', 'vezi', 'toate', 'inchide', 'meniu', 'cauta', 'acasa', 'inapoi',
  'urmatorul', 'anteriorul', 'redare', 'sponsorizat', 'reclama', 'promovat', 'prieteni', 'prieten',
  // Spanish
  'gusta', 'me', 'comentar', 'compartir', 'enviar', 'mensaje', 'responder', 'seguir', 'dejar', 'bloquear', 'denunciar',
  'guardar', 'mas', 'opciones', 'acciones', 'para', 'esta', 'publicacion', 'ver', 'todo', 'cerrar', 'buscar', 'inicio',
  'patrocinado', 'publicidad',
  // French
  'aime', 'commenter', 'partager', 'envoyer', 'repondre', 'suivre', 'ne', 'plus', 'bloquer', 'signaler', 'enregistrer',
  'cette', 'publication', 'voir', 'tout', 'fermer', 'rechercher', 'accueil', 'sponsorise', 'publicite',
  // German
  'gefallt', 'mir', 'kommentieren', 'teilen', 'senden', 'nachricht', 'antworten', 'folgen', 'nicht', 'blockieren', 'melden',
  'speichern', 'mehr', 'optionen', 'aktionen', 'fur', 'diesen', 'beitrag', 'von', 'ansehen', 'alle', 'schliessen',
  'suchen', 'startseite', 'gesponsert', 'werbung', 'anzeige',
  // Portuguese
  'curtir', 'compartilhar', 'salvar', 'opcoes', 'acoes', 'publicacao', 'tudo', 'pesquisar', 'anuncio',
]);

/** Is `word` (already folded) one of the interface words the report may copy? */
export function isUiWord(word: string): boolean {
  return UI_WORDS.has(word);
}

/** How many leading label words may be kept. */
export const MAX_KEPT_LABEL_WORDS = 3;

/** A label as a shape: its leading interface words, then the count of what follows. See the header. */
export function labelShape(value: string): string {
  const words = value.split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';
  const kept: string[] = [];
  for (const word of words) {
    if (kept.length >= MAX_KEPT_LABEL_WORDS) break;
    const folded = foldWord(word);
    if (folded !== '' && UI_WORDS.has(folded)) kept.push(folded);
    else break;
  }
  const rest = Math.min(words.length - kept.length, 999);
  if (kept.length === 0) return `${rest}w`;
  return rest > 0 ? `${kept.join('+')}+${rest}w` : kept.join('+');
}

// The sections of the five sites that name a kind of page and carry no person. Lower case.
const SAFE_SEGMENTS: ReadonlySet<string> = new Set([
  'p', 'reel', 'reels', 'explore', 'watch', 'shorts', 'status', 'video', 'videos', 'groups', 'marketplace', 'hashtag', 'search',
  'stories', 'feed', 'photo', 'photos', 'events', 'pages', 'home', 'i', 'results', 'playlist', 'channel', 'tv', 'live',
  'foryou', 'following', 'friends', 'notifications', 'messages', 'settings', 'direct', 'accounts', 'tagged', 'saved', 'comments',
  'posts', 'likes', 'with_replies', 'media', 'highlights', 'lists', 'topics', 'bookmarks', 'compose', 'flow', 'login',
  'permalink.php', 'profile.php', 'story.php', 'photo.php',
]);

/** Is `segment` a path section the report may copy (or one of its three stand-ins)? */
export function isSafeSegment(segment: string): boolean {
  return SAFE_SEGMENTS.has(segment) || segment === '@' || segment === '0' || segment === '*';
}

/** One path segment as a shape. */
function segmentShape(segment: string): string {
  const lower = segment.toLowerCase();
  if (SAFE_SEGMENTS.has(lower)) return lower;
  if (segment.startsWith('@') || segment.startsWith('%40')) return '@';
  if (/^\d+$/.test(segment)) return '0';
  return '*';
}

/** The most path segments a shape keeps. */
export const MAX_PATH_SEGMENTS = 6;

/** A path as a shape: "/@jane/video/7123456" -> "/@/video/0"; at most six segments, none that names a person. */
export function pathShape(pathname: string): string {
  const segments = pathname.split('/').filter(Boolean).slice(0, MAX_PATH_SEGMENTS);
  return '/' + segments.map(segmentShape).join('/');
}

/** Schemes the report may name (never their content). */
export const SAFE_SCHEMES: ReadonlySet<string> = new Set(['javascript', 'mailto', 'tel', 'blob', 'data', 'sms']);

/**
 * An address as a shape: a fragment is "#"; a link to another site "ext"; another scheme only its name; anything on the
 * page's own site its path shape, with "?" when it has a query. A host that is not the page's own is never copied.
 */
export function hrefShape(href: string, ownHost: string): string {
  if (!href) return '';
  if (href.startsWith('#')) return '#';
  let url: URL;
  try {
    url = new URL(href, `https://${ownHost}`);
  } catch {
    return '*';
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    const scheme = url.protocol.replace(':', '');
    return SAFE_SCHEMES.has(scheme) ? scheme : '*';
  }
  const own = ownHost.replace(/^www\./, '');
  const host = url.hostname.replace(/^www\./, '');
  if (host !== own && !host.endsWith(`.${own}`)) return 'ext';
  return pathShape(url.pathname) + (url.search ? '?' : '');
}
