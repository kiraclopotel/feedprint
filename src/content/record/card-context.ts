// What a post's card carries beyond the author's own words: the quoted post's
// text and author, a link card's title, a video's "From <account>" line, a
// repost's original account. The household blocklist reads these too
// (2026-09-07, from the owner's own case: a blocked name, quoted in someone
// else's post with the person's video, went past because the rule read only
// the author and the body). Read once per item, never pressed, never fetched.
//
// X, Instagram and TikTok (the last two read live through the owner's Chrome
// on 2026-09-07, docs/spec/STRUCTURE-MAP.md). Facebook returns nothing, which
// is "not read", not "nothing there": its feed stalled after one unit on two
// surfaces that night and its card anatomy is not on the map yet. Body
// mentions are never card context on any platform; the card is what sits
// around the author's words (a second author, a sound line, a duet line).

import type { Platform } from '../../types/post';

export interface CardContext {
  /** Text on the card that is not the author's own body: quoted post, card title, attribution line. */
  text?: string;
  /** Handles the card names besides the author, lower-cased, no leading @. */
  accounts?: string[];
  /**
   * For the judge, X only: the quoted post's body and nothing else. No author name, no display name, no handle of the quoted
   * account; `text` above carries those for the household list, which has to read them, and the judge must not (the consent
   * screen promises a letter in place of every account name, and no letter replaces a display name).
   */
  quotedBody?: string;
  /** For the judge, X only: a link card's title and the domain it names, and not the description or anything else on the card. */
  link?: { title?: string; domain?: string };
}

const QUOTED_BODY_MOST_CHARS = 600;
const LINK_TITLE_MOST_CHARS = 200;
const DOMAIN_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/i;
const FROM_RE = /^(?:from|de la|via)\s+/i;

/**
 * A link card's title and domain. The card is read by its leaves (the elements that hold text and no other element), not by its
 * joined text: the domain is the leaf that looks like one, the title is the first leaf that is not the domain, and the description
 * under it is left. A card whose structure gives no leaf is read as one line, which is the title.
 */
function readLinkCard(card: Element): { title?: string; domain?: string } | undefined {
  const leaves = Array.from(card.querySelectorAll('span, div, a, h2, h3'))
    .filter((el) => el.children.length === 0)
    .map((el) => el.textContent?.replace(/\s+/g, ' ').trim() ?? '')
    .filter(Boolean);
  if (leaves.length === 0) {
    const whole = card.textContent?.replace(/\s+/g, ' ').trim();
    if (whole) leaves.push(whole);
  }
  const bare = (t: string): string => t.replace(FROM_RE, '').toLowerCase();
  const domain = leaves.map(bare).find((t) => t.length <= 80 && DOMAIN_RE.test(t));
  const title = leaves.find((t) => !DOMAIN_RE.test(bare(t)) && !FROM_RE.test(t) && t.length >= 3);
  if (!title && !domain) return undefined;
  return {
    ...(title ? { title: title.slice(0, LINK_TITLE_MOST_CHARS) } : {}),
    ...(domain ? { domain } : {}),
  };
}

const ATTRIBUTION_RE = /^(from|de la|via)\s+/i;

function handleFromHref(href: string | null): string | undefined {
  if (!href) return undefined;
  const m = /^\/([A-Za-z0-9_]{1,15})(?:[/?#]|$)/.exec(href);
  return m ? m[1].toLowerCase() : undefined;
}

function readTwitter(container: Element): CardContext {
  const texts: string[] = [];
  const accounts = new Set<string>();
  let quotedBody: string | undefined;
  let link: { title?: string; domain?: string } | undefined;

  // The quoted post: a nested article rendered as a link, with its own body
  // and its own author header.
  const quoted = container.querySelector('article[role="link"]');
  if (quoted) {
    const body = quoted.querySelector('[data-testid="tweetText"]')?.textContent?.trim();
    if (body) {
      texts.push(body);
      quotedBody = body.slice(0, QUOTED_BODY_MOST_CHARS);
    }
    const authorLink = quoted.querySelector<HTMLAnchorElement>('[data-testid="User-Name"] a[href^="/"], a[href^="/"][role="link"]');
    const h = handleFromHref(authorLink?.getAttribute('href') ?? null);
    if (h) accounts.add(h);
    // The quoted author's display name is card text too: a household phrase
    // rule ("elon musk") reads it even when the handle differs from the words.
    const name = quoted.querySelector('[data-testid="User-Name"]')?.textContent?.trim();
    if (name) texts.push(name);
  }

  // A link card: its title and description are text the reader meets.
  for (const card of container.querySelectorAll('[data-testid^="card."]')) {
    if (quoted && quoted.contains(card)) continue;
    const t = card.textContent?.trim();
    if (t) texts.push(t);
    link ??= readLinkCard(card);
  }

  // A media attribution line ("From <Name>" on a video from another account,
  // "De la" in the Romanian interface): the link names the account.
  for (const a of container.querySelectorAll<HTMLAnchorElement>('a[href^="/"]')) {
    if (quoted && quoted.contains(a)) continue;
    const label = a.textContent?.trim() ?? '';
    if (!ATTRIBUTION_RE.test(label)) continue;
    texts.push(label);
    const h = handleFromHref(a.getAttribute('href'));
    if (h) accounts.add(h);
  }

  const out: CardContext = {};
  if (texts.length) out.text = texts.join('\n');
  if (accounts.size) out.accounts = Array.from(accounts);
  if (quotedBody) out.quotedBody = quotedBody;
  if (link) out.link = link;
  return out;
}

// Instagram: a first path segment that looks like a handle and is not one.
const IG_NOT_HANDLES = new Set(['explore', 'reels', 'reel', 'p', 'stories', 'accounts', 'direct', 'about', 'legal', 'api', 'emails', 'terms', 'privacy', 'help', 'audio', 'locations', 'tv', 'developer', 'press']);
const IG_AVATAR_ALT_RE = /profile picture|poz[aă] de profil|foto (do|de) perfil|photo de profil|profilbild/i;
// Header lines that name a second party: a repost, a paid partnership, the audio line.
const IG_ATTRIBUTION_RE = /^(reposted|repostat|paid partnership|parteneriat pl[aă]tit|colaborare pl[aă]tit[aă]|original audio|sunet original|audio original|áudio original|son original)/i;

function igHandle(href: string | null | undefined): string | undefined {
  if (!href) return undefined;
  const m = /^(?:https?:\/\/(?:www\.)?instagram\.com)?\/([A-Za-z0-9_.]{1,30})\/?(?:[?#]|$)/.exec(href);
  if (!m) return undefined;
  const h = m[1].toLowerCase();
  return IG_NOT_HANDLES.has(h) ? undefined : h;
}

/**
 * An Instagram post: the author is the first handle link (the avatar), the
 * media is the first video or non-avatar image, and everything between is
 * the header. A collab post carries a second handle link there; the audio
 * line is a link into /audio/; a repost or paid-partnership line is a leaf.
 * A comment row has no media and no card.
 */
function readInstagram(container: Element): CardContext {
  const texts = new Set<string>();
  const accounts = new Set<string>();
  const handleLinks = Array.from(container.querySelectorAll<HTMLAnchorElement>('a[href]')).filter((a) => igHandle(a.getAttribute('href')));
  if (!handleLinks.length) return {};
  const author = igHandle(handleLinks[0].getAttribute('href'));
  const media = Array.from(container.querySelectorAll('video, img')).find((m) => {
    if (m.tagName === 'IMG' && IG_AVATAR_ALT_RE.test(m.getAttribute('alt') ?? '')) return false;
    const a = m.closest('a[href]');
    return !a || !igHandle(a.getAttribute('href'));
  });
  if (!media) return {};
  const before = (el: Element): boolean => Boolean(el.compareDocumentPosition(media) & Node.DOCUMENT_POSITION_FOLLOWING);

  for (const a of handleLinks) {
    if (!before(a)) break;
    const h = igHandle(a.getAttribute('href'));
    if (!h || h === author) continue;
    accounts.add(h);
    const t = a.textContent?.trim();
    if (t) texts.add(t);
  }
  for (const a of container.querySelectorAll<HTMLAnchorElement>('a[href*="/audio/"]')) {
    if (!before(a)) continue;
    const t = a.textContent?.trim();
    if (t) texts.add(t);
  }
  for (const el of container.querySelectorAll('span, div, a')) {
    if (el.children.length !== 0 || !before(el)) continue;
    const t = el.textContent?.trim() ?? '';
    if (!IG_ATTRIBUTION_RE.test(t)) continue;
    texts.add(t);
    const row = el.closest('a') ? el.closest('a')!.parentElement : el.parentElement;
    for (const a of row?.querySelectorAll<HTMLAnchorElement>('a[href]') ?? []) {
      const h = igHandle(a.getAttribute('href'));
      if (h && h !== author) accounts.add(h);
    }
  }

  const out: CardContext = {};
  if (texts.size) out.text = Array.from(texts).join('\n');
  if (accounts.size) out.accounts = Array.from(accounts);
  return out;
}

// TikTok: the sound line under the caption, and a duet or stitch line at the caption's head.
const TT_DUET_RE = /^(duet|stitch)\s+(with|cu|con|com|mit|avec)\s+/i;

function ttHandle(href: string | null | undefined): string | undefined {
  if (!href) return undefined;
  const m = /^(?:https?:\/\/(?:www\.)?tiktok\.com)?\/@([A-Za-z0-9_.]{1,24})(?:[/?#]|$)/.exec(href);
  return m ? m[1].toLowerCase() : undefined;
}

/**
 * A TikTok video unit: the author is the first handle link; the sound line is
 * `[data-e2e="video-music"]` (a link into /music/, "original sound - Name" or a
 * song), and a duet or stitch says so at the head of the caption with the
 * other account linked. A comment row has neither and no card. On the For You
 * page of 2026-09-07 the unit carried no caption element at all, so only the
 * sound line is read there.
 */
function readTiktok(container: Element): CardContext {
  const texts = new Set<string>();
  const accounts = new Set<string>();
  const author = ttHandle(container.querySelector<HTMLAnchorElement>('a[href*="/@"]')?.getAttribute('href'));

  const music = container.querySelector('[data-e2e="video-music"]');
  if (music) {
    const t = music.textContent?.trim();
    if (t) texts.add(t);
    const links = music.matches('a[href]') ? [music as HTMLAnchorElement] : Array.from(music.querySelectorAll<HTMLAnchorElement>('a[href]'));
    for (const a of links) {
      const h = ttHandle(a.getAttribute('href'));
      if (h && h !== author) accounts.add(h);
    }
  }

  const desc = container.querySelector('[data-e2e="video-desc"], [data-e2e="browse-video-desc"]');
  const descText = desc?.textContent?.trim() ?? '';
  if (desc && TT_DUET_RE.test(descText)) {
    texts.add(descText.split('\n')[0].slice(0, 200));
    const h = ttHandle(desc.querySelector<HTMLAnchorElement>('a[href*="/@"]')?.getAttribute('href'));
    if (h && h !== author) accounts.add(h);
  }

  const out: CardContext = {};
  if (texts.size) out.text = Array.from(texts).join('\n');
  if (accounts.size) out.accounts = Array.from(accounts);
  return out;
}

/** The card for a record: the context when it carries anything, undefined otherwise, so an empty card is omitted from the payload. */
export function cardForRecord(container: Element | null | undefined, platform: Platform): CardContext | undefined {
  const c = readCardContext(container, platform);
  return Object.keys(c).length ? c : undefined;
}

/** The card's context beyond the author's words, for the platform's anatomy; empty when not read. */
export function readCardContext(container: Element | null | undefined, platform: Platform): CardContext {
  if (!container) return {};
  try {
    if (platform === 'twitter') return readTwitter(container);
    if (platform === 'instagram') return readInstagram(container);
    if (platform === 'tiktok') return readTiktok(container);
    return {};
  } catch {
    return {};
  }
}
