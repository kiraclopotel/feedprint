// FeelingWise — the platforms' own paid-placement labels, many languages.
//
// A DOM ad rule keys on the exact visible label a platform puts on a paid
// post ("Sponsored", "Ad", "Sponsorizat", ...). The list is a seed written
// 2026-09-03 from the labels already live-verified in the platform adapters
// plus the common translations; the deep-research run the owner was asked
// for (docs/research/PRESET-RULES-RESEARCH-PROMPT.md, category ad-labels)
// replaces it per platform and language when it lands. Matching is against
// an element's ENTIRE trimmed text, folded (lowercase, diacritics stripped),
// never a substring: a caption saying "this is not sponsored" is not a label.

import { wordFamily } from '../../core/repairs/families';

const LABELS: readonly string[] = [
  // en
  'sponsored', 'ad', 'promoted', 'paid partnership', 'paid promotion',
  // ro
  'sponsorizat', 'sponsorizată', 'reclamă', 'promovat', 'parteneriat plătit',
  // es
  'publicidad', 'patrocinado', 'promocionado', 'colaboración pagada',
  // fr
  'sponsorisé', 'sponsorisée', 'publicité', 'contenu sponsorisé', 'partenariat rémunéré',
  // de
  'gesponsert', 'anzeige', 'werbung', 'bezahlte partnerschaft',
  // it
  'sponsorizzato', 'sponsorizzata', 'pubblicità', 'partnership a pagamento',
  // pt
  'patrocinado', 'anúncio', 'publicidade', 'parceria paga',
  // pl
  'sponsorowane', 'reklama', 'płatna współpraca',
  // nl
  'gesponsord', 'advertentie', 'betaald partnerschap',
  // tr
  'sponsorlu', 'reklam', 'ücretli iş birliği',
  // hu
  'hirdetés', 'szponzorált', 'fizetett együttműködés',
  // ru
  'реклама', 'спонсируемый', 'спонсируемая', 'платное партнерство',
  // uk
  'реклама', 'спонсоровано', 'платне партнерство',
];

// Zero-width characters: Facebook's right-column heading is "Sponsored"
// followed by U+200B (owner's live look, 2026-09-03), which no whitespace
// class matches.
const ZERO_WIDTH = /[\u200B-\u200D\u2060\uFEFF]/g;

function fold(s: string): string {
  return s
    .replace(ZERO_WIDTH, '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[țȚ]/g, 't')
    .replace(/[șȘ]/g, 's')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// The words are a finder family (a repair file may add a language's label). The folded set is rebuilt only when the
// list in force is a different list.
let foldedFor: readonly string[] | null = null;
let folded: ReadonlySet<string> = new Set();
function foldedLabels(): ReadonlySet<string> {
  const list = wordFamily('finder.ads.label-words', LABELS);
  if (list !== foldedFor) {
    foldedFor = list;
    folded = new Set(list.map(fold));
  }
  return folded;
}

/** Longest label, in characters, so callers can reject long text early. */
export const AD_LABEL_MAX_LENGTH = Math.max(...LABELS.map((l) => l.length)) + 4;

/** True when `text`, as a whole, is one of the platforms' ad labels. */
export function isAdLabelText(text: string | null | undefined): boolean {
  if (!text) return false;
  if (text.length > AD_LABEL_MAX_LENGTH + 8) return false;
  // Facebook renders the label with its separator in the same node
  // ("Ad · "); the separator is not part of the label.
  return foldedLabels().has(fold(text.replace(ZERO_WIDTH, '').replace(/^[\s·•|,.\-]+|[\s·•|,.\-]+$/g, '')));
}

/**
 * The text an SVG `<use>` stands for. Facebook (owner's live look,
 * 2026-09-03) draws the "Ad" label, the timestamp and "Learn more" as
 * `<svg><use href="#SvgWml25">`, where the target is a chain of same-document
 * `<svg>` elements each holding one `<use>`, ending in an SVG `<text>` that
 * carries the word. The word is in the document but never inside the post,
 * so a text walk over the post sees nothing. Follows the chain, at most
 * eight hops, same document only; anything else resolves to ''.
 */
export function svgUseText(use: Element): string {
  const doc = use.ownerDocument;
  let cur: Element | null = use;
  for (let hop = 0; cur && hop < 8; hop++) {
    const href = cur.getAttribute('href') ?? cur.getAttribute('xlink:href') ?? '';
    if (!href.startsWith('#') || href.length < 2) return '';
    const target = doc.getElementById(href.slice(1));
    if (!target) return '';
    if (target.tagName.toLowerCase() === 'text') return target.textContent ?? '';
    const next = target.querySelector(':scope > use');
    if (!next) return target.textContent ?? '';
    cur = next;
  }
  return '';
}

/**
 * Every short string one element can put in front of the reader, whichever
 * way the platform draws it: its own text when it is a leaf, an aria-label,
 * a title, an image's alt, and an SVG `<use>` standing for a word. The
 * general measure (owner, 2026-09-03, after the SVG-drawn "Ad"): a label
 * rule that reads all of these does not care which channel the next
 * rotation moves the word to, and the per-platform judged/found tally in
 * feed-ad-blocker.ts says when one it cannot read has arrived. Long strings
 * are dropped early: a label is a word or two.
 */
export function labelTexts(el: Element): string[] {
  const out: string[] = [];
  const push = (s: string | null | undefined) => {
    if (s && s.length <= AD_LABEL_MAX_LENGTH + 8) out.push(s);
  };
  if (el.tagName.toLowerCase() === 'use') { push(svgUseText(el)); return out; }
  if (el.childElementCount === 0) push(el.textContent);
  push(el.getAttribute('aria-label'));
  push(el.getAttribute('title'));
  push(el.getAttribute('alt'));
  // Not read: CSS generated content. It needs getComputedStyle per element,
  // which on a 28k-node Facebook page cost 80 ms on the first scan
  // (scripts/verify/engagement-latency.mjs, 2026-09-03); a label drawn that
  // way is the one channel this reader leaves to the blindness measure.
  return out;
}

/**
 * Invisible characters Facebook glues to each letter piece: the combining
 * grapheme joiner U+034F (live read 2026-10-08) and the zero-width family.
 */
const PIECE_GLUE = /[\u034F\u200B-\u200D\u2060\uFEFF]/g;

/** Most pieces one scrambled word may have: 60 seen live 2026-10-08 (3 real, 57 decoys). */
const MAX_PIECES = 96;

/**
 * Facebook renders a header word ("Sponsored", "Ad", the time stamp) as a
 * flex row of one-letter pieces, each glued to an invisible joiner. The real
 * pieces sit in the row and are put in reading order by CSS `order`; the
 * decoys, which spell the same letters scrambled, are absolutely positioned
 * and stacked out of the row (live read 2026-10-08, ledger
 * ADS-RESILIENCE-2026-10-08.md). So DOM order is not reading order and
 * textContent is garbage. Read it as a person does: drop the hidden and the
 * out-of-row pieces, then sort the rest by CSS order, DOM order breaking ties.
 * Only the drawn-to-fool shape is read, so an ordinary word set in letters
 * (a stylised name, a word game, tiles) never becomes a label: a <span> of
 * <span> pieces only, no loose text of its own, and the trick's signature: the
 * U+034F joiner on every shown piece (three fresh checks on 8 Oct broke every
 * looser rule with ordinary styled words). Left on purpose: a plain word whose
 * every letter carries U+034F reads as drawn, since that is the signature itself.
 * Anything else returns ''.
 */
/**
 * An ad's words for a record: every piece of text under `el`, a space between each, each piece once, in one line.
 * textContent glues the text of neighbouring elements together ("Visit siteExampleApp'", "Sponsoredhttps://www.example-app.test/"),
 * which a record must not keep. Text inside an element matching
 * `skip` (the page's own controls: buttons and the like, picked by role and place, never by their words, since the
 * page is in the person's language) is left out.
 */
export function spacedText(el: Element | null | undefined, skip?: string, shortOnly?: number): string {
  if (!el) return '';
  const parts: string[] = [];
  const seen = new Set<string>();
  const walk = (el.ownerDocument ?? document).createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const piece = (n.nodeValue ?? '').replace(/\s+/g, ' ').trim();
    if (!piece || seen.has(piece)) continue;
    const control = skip ? n.parentElement?.closest(skip) : null;
    // With `shortOnly`, a control is left out only when its words are a short label ("Visit site"): an ad whose own
    // words sit inside a link-button wrapper keeps them (the head's check of 599f1ca1).
    if (control && el.contains(control) && (shortOnly === undefined || (control.textContent ?? '').trim().length <= shortOnly)) continue;
    seen.add(piece);
    parts.push(piece);
  }
  return parts.join(' ');
}

/** The page's own controls inside an ad: their words ("Visit site", "Learn more", "Skip") are not the ad's. */
export const AD_CONTROLS = 'button, [role="button"]';

/** The longest control text that is still a button's label, in a feed ad, where a button may wrap the ad's own words. */
export const SHORT_CONTROL_LABEL = 30;

export function piecedLabelText(el: Element): string {
  if (el.tagName !== 'SPAN' || el.childElementCount < 2 || el.childElementCount > MAX_PIECES) return '';
  // First pass without styles: almost every element fails here, cheaply.
  for (const n of el.childNodes) {
    if (n.nodeType === 3 && (n.textContent ?? '').replace(PIECE_GLUE, '').trim() !== '') return '';
  }
  const pieces: { el: Element; ch: string; joined: boolean }[] = [];
  for (const c of el.children) {
    if (c.tagName !== 'SPAN' || c.childElementCount !== 0) return '';
    const raw = c.textContent ?? '';
    const t = raw.replace(PIECE_GLUE, '').trim();
    if (t.length > 1) return '';
    pieces.push({ el: c, ch: t, joined: raw.includes('͏') });
  }
  const shown: { ch: string; order: number; i: number }[] = [];
  let allJoined = true;
  pieces.forEach(({ el: c, ch, joined }, i) => {
    if (!ch) return;
    if (c.getAttribute('aria-hidden') === 'true') return;
    const cs = getComputedStyle(c);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.position === 'absolute'
      || cs.position === 'fixed' || cs.fontSize === '0px' || cs.opacity === '0') return;
    if (!joined) allJoined = false;
    shown.push({ ch, order: Number.parseInt(cs.order, 10) || 0, i });
  });
  if (shown.length === 0 || !allJoined) return '';
  if (shown.length > AD_LABEL_MAX_LENGTH + 4) return '';
  shown.sort((a, b) => a.order - b.order || a.i - b.i);
  return shown.map((p) => p.ch).join('');
}

/** True when any string the element can show is an ad label. */
export function isAdLabelElement(el: Element): boolean {
  if (labelTexts(el).some(isAdLabelText)) return true;
  return el.childElementCount > 0 && isAdLabelText(piecedLabelText(el));
}

/** The selector for every element `labelTexts` can read; callers filter by context. */
export const LABEL_BEARERS = 'span, a, div, p, h3, h4, use, img, [aria-label], [title]';
