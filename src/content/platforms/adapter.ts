// FeelingWise - Platform adapter base interface
// All platform adapters implement this contract

import { PostContent, Platform } from '../../types/post';
import { platformOfHost } from '../../core/host-platform';

export interface PlatformAdapter {
  platform: Platform;
  detectPlatform(): boolean;
  extractPosts(nodes: NodeList): PostContent[];
  getPostSelector(): string;
}

// Private-message surface patterns per platform. FW's product mandate
// (VISION §0 + §1.1) is PUBLIC-feed manipulation defense — private DMs
// are out of scope and reading/rewriting them would be a parental-trust
// + legal/privacy catastrophe (FW extracts comment text → ships to Groq →
// writes to forensic chain → exports). Every pattern below is anchored
// to path start so a public-feed URL containing the substring as part of
// a username (e.g. `/messagesUser`) does NOT trip the gate.
//
// Coverage:
//   • Facebook: /messages, /messages/t/<id>, /messenger, /messenger/<id>
//   • Instagram: /direct, /direct/inbox, /direct/t/<id>
//   • Twitter / X: /messages, /messages/<id>, /messages/compose, /i/chat, /i/chat/<id>
//   • TikTok: /messages, /messages/<id>, /inbox
//   • YouTube: no native DMs — community posts are public, no exclusion needed
//
// The manifest.json `exclude_matches` on `content_scripts` blocks initial
// script injection on these URLs (defense layer 1). This runtime gate
// covers SPA navigation into a DM surface from an already-loaded public
// surface (defense layer 2/3), because the content-script orchestrator
// continues running across SPA route changes.
//
// `/i/chat` is X's current DM URL after the UI migration off
// `/messages`; both legacy and current paths must be excluded.
// URL-level pattern set — match anywhere in path, not just start. Pre-2026-05-27
// the patterns were anchored to `^/` only; that missed sub-paths like FB's
// `/marketplace/<id>/messages/`, `/groups/<id>/chat/`, and the
// `/messages/t/<id>` URL when reached via SPA navigation through an
// intermediate route. The `(^|\/)` + `(\/|$)` framing matches the segment
// anywhere in the path while still avoiding substring false-matches like
// `/messagesUser` or `/inboxfan` (the trailing `(\/|$)` requires a path
// separator or end-of-string).
const PRIVATE_SURFACE_PATTERNS: ReadonlyArray<RegExp> = [
  /(^|\/)messages(\/|$)/i,
  /(^|\/)messenger(\/|$)/i,
  /(^|\/)direct(\/|$)/i,
  /(^|\/)inbox(\/|$)/i,
  /(^|\/)chat(\/|$)/i,
  /(^|\/)conversation(\/|$)/i,
  /(^|\/)dm(\/|$)/i,
];

/**
 * True when the current URL points to a private-message surface (DMs /
 * Messenger / direct inbox) on any supported platform. Callers MUST bail
 * before extracting any DOM content. Pre-fix the FB adapter scanned and
 * even rewrote text inside `facebook.com/messages/t/<id>` — that's
 * VISION-incompatible: FW protects kids from PUBLIC feeds, not private
 * conversations between people.
 */
export function isPrivateMessageSurface(): boolean {
  if (typeof window === 'undefined' || !window.location?.pathname) return false;
  const path = window.location.pathname;
  return PRIVATE_SURFACE_PATTERNS.some((re) => re.test(path));
}

// Chat-overlay aria-label markers across supported languages. FB chat
// heads, IG "Send Message" modals, and the FB Messenger pop-out window
// all render as [role="dialog"] elements with aria-label naming the
// conversation. The 2026-05-27 incident (caught on a live screenshot) was an
// English/Romanian Messenger chat the URL gate missed because the chat
// rendered as a [role="dialog"] overlay without changing the page URL.
// Multi-language coverage matters: FB localizes the dialog aria-label
// per the user's interface language.
const CHAT_OVERLAY_MARKERS: ReadonlyArray<string> = [
  // English
  'messages', 'messenger', 'message conversation', 'chat with', 'new message',
  'conversation with', 'video call', 'voice call', 'active chat',
  // Romanian
  'mesaje', 'mesagerie', 'conversație', 'conversatie', 'mesaj nou', 'conversație cu',
  // Spanish
  'mensajes', 'mensajería', 'mensaje nuevo', 'conversación', 'conversacion',
  // French
  'discussion', 'messages', 'nouvelle discussion', 'conversation avec',
  // German
  'nachrichten', 'unterhaltung', 'neue nachricht',
  // Italian
  'messaggi', 'messaggistica', 'conversazione', 'nuovo messaggio',
  // Portuguese
  'mensagens', 'conversa', 'nova mensagem',
];

function labelLooksLikeChat(label: string | null): boolean {
  if (!label) return false;
  const lower = label.toLowerCase();
  return CHAT_OVERLAY_MARKERS.some((m) => lower.includes(m));
}

function isChatOverlayElement(element: Element): boolean {
  return element instanceof HTMLElement
    && element.getAttribute('role') === 'dialog'
    && labelLooksLikeChat(element.getAttribute('aria-label'));
}

/** Node-local probe for newly added chat dialogs; never scans the document. */
export function nodeContainsChatOverlay(node: Node): boolean {
  if (!(node instanceof Element)) return false;
  if (isChatOverlayElement(node)) return true;
  return Array.from(node.querySelectorAll('[role="dialog"][aria-label]'))
    .some(isChatOverlayElement);
}

/**
 * Walk up from `el` looking for a chat-overlay ancestor. Returns the
 * ancestor [role="dialog"] when one is found whose aria-label matches
 * the multi-language CHAT_OVERLAY_MARKERS list. Returns null otherwise.
 *
 * This is the per-element gate (defense layer 3): even when the URL
 * gate misses a chat overlay (the FB chat head popup, the FB pop-out
 * Messenger window, the IG send-message modal), articles extracted
 * from inside the dialog can be filtered out via this helper.
 */
export function findChatOverlayAncestor(el: Element | null): HTMLElement | null {
  if (!el) return null;
  let node: Element | null = el;
  while (node) {
    if (isChatOverlayElement(node)) return node as HTMLElement;
    node = node.parentElement;
  }
  return null;
}

/**
 * True when `el` lives inside a private conversation subtree — either nested
 * in a `role="log"` message live-region (the canonical Messenger/DM chat-log
 * marker) OR inside a chat-overlay `role="dialog"`. Composes the two
 * element-level DM defenses the platform adapters already apply piecemeal
 * (`el.closest('[role="log"]')` in `_collectArticles`, `findChatOverlayAncestor`
 * at `extractPosts`) into one predicate, so the standalone comment-rewrite
 * extractors (`comment-extractors.ts`, `video-pipeline.ts`) can gate their
 * generic `[role="article"]` / `<article>` queries with a single import
 * instead of duplicating the checks. See META-1 (audit 2026-07-13).
 */
export function isInPrivateChatSubtree(el: Element | null): boolean {
  if (!el) return false;
  return !!el.closest('[role="log"]') || findChatOverlayAncestor(el) !== null;
}

/**
 * The same gate as a CSS selector, for the filters that hide with a stylesheet
 * rather than a scan.
 *
 * A stylesheet cannot call a predicate, and on 2026-09-19 a read found the
 * consequence: Facebook's comment-block filter was a document-wide sheet of
 * bare attribute matches ending in `display:none !important`, with no private
 * gate at all, while all six of its siblings had one. The standing rule of this
 * codebase is that private surfaces are out of scope for EVERY filter, gated by
 * DOM region and never by URL alone.
 *
 * It is built from CHAT_OVERLAY_MARKERS above rather than from a second list,
 * because the recurring failure here is one rule written down twice and then
 * changed once. Append it to a selector as
 * `SELECTOR:not(:is(<this>))` and the rule stops at the edge of a chat log or
 * a chat dialog. `:is()` and complex `:not()` are Chrome 88; the sheets that
 * use this already rely on `:has()`, which is 105.
 */
export function privateChatSubtreeCss(): string {
  const dialog = `[role="dialog"]:is(${CHAT_OVERLAY_MARKERS.map((m) => `[aria-label*="${m}" i]`).join(', ')})`;
  return `[role="log"], [role="log"] *, ${dialog}, ${dialog} *`;
}

/**
 * True when the page DOM currently shows ANY chat-overlay dialog. Used
 * by the interceptor to skip extraction at the orchestration level on
 * pages where a chat is the dominant surface (e.g., the FB Messenger
 * pop-out window where the URL may not be a recognized DM path but the
 * entire visible DOM is a chat).
 *
 * Returns false on benign pages (no role=dialog matching a chat marker).
 */
export function hasActiveChatOverlay(): boolean {
  if (typeof document === 'undefined') return false;
  const dialogs = document.querySelectorAll<HTMLElement>('[role="dialog"][aria-label]');
  for (const d of dialogs) {
    if (labelLooksLikeChat(d.getAttribute('aria-label'))) return true;
  }
  return false;
}

/**
 * Detect which platform the current page is on.
 * Returns null if not on a supported platform OR the URL is a private-
 * message surface (DMs out-of-scope per VISION).
 */
export function detectCurrentPlatform(): Platform | null {
  if (isPrivateMessageSurface()) {
    console.log('[FeelingWise] Private-message surface detected — FW skips DM scanning per VISION (public feeds only).');
    return null;
  }
  return platformOfHost(window.location.hostname);
}
