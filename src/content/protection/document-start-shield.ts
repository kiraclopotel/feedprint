export const DOCUMENT_SHIELD_ATTRIBUTE = 'data-fw-document-start-shield';
export const CONTENT_READY_ATTRIBUTE = 'data-fw-content-shields-ready';
export const DOCUMENT_SHIELD_STYLE_ID = 'fw-document-start-shield-style';
const CONTENT_READY_EVENT = 'fw-content-shields-ready';

// The document curtain can mute media before an item-level shield sees it.
// Preserve the pre-curtain value long enough for that item shield to inherit
// the real baseline instead of adopting the curtain's temporary `true`.
const sharedMuteState = globalThis as typeof globalThis & {
  __fwDocumentMuteBaselines?: WeakMap<HTMLMediaElement, boolean>;
};
const documentMuteBaselines = sharedMuteState.__fwDocumentMuteBaselines
  ?? new WeakMap<HTMLMediaElement, boolean>();
sharedMuteState.__fwDocumentMuteBaselines = documentMuteBaselines;

export function documentMuteBaseline(media: HTMLMediaElement): boolean | undefined {
  return documentMuteBaselines.get(media);
}

export interface DocumentStartShieldController {
  readonly settled: Promise<void>;
  readonly active: boolean;
  release(): void;
}

interface DocumentStartShieldOptions {
  doc?: Document;
  isPrivateSurface: () => boolean;
  readMode: () => Promise<unknown>;
  timeoutMs?: number;
}

interface InlineStyleState {
  value: string;
  priority: string;
}

function captureInlineStyle(element: HTMLElement, property: string): InlineStyleState {
  return {
    value: element.style.getPropertyValue(property),
    priority: element.style.getPropertyPriority(property),
  };
}

function restoreInlineStyle(element: HTMLElement, property: string, state: InlineStyleState): void {
  if (state.value === '') element.style.removeProperty(property);
  else element.style.setProperty(property, state.value, state.priority);
}

function shieldToken(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Covers the root synchronously, then keeps it covered only for Child mode
 * until the main content script confirms its first DOM scan has installed
 * item-level shields. Storage/context failure releases the page.
 */
export function startDocumentStartShield(
  options: DocumentStartShieldOptions,
): DocumentStartShieldController | null {
  if (options.isPrivateSurface()) return null;

  const doc = options.doc ?? document;
  const root = doc.documentElement;
  if (!root) return null;

  doc.getElementById(DOCUMENT_SHIELD_STYLE_ID)?.remove();
  const token = shieldToken();
  const style = doc.createElement('style');
  style.id = DOCUMENT_SHIELD_STYLE_ID;
  style.textContent =
    `html[${DOCUMENT_SHIELD_ATTRIBUTE}="${token}"] { `
    + 'visibility: hidden !important; opacity: 0 !important; pointer-events: none !important; }';

  const previousOpacity = captureInlineStyle(root, 'opacity');
  const previousPointerEvents = captureInlineStyle(root, 'pointer-events');
  root.setAttribute(DOCUMENT_SHIELD_ATTRIBUTE, token);
  root.style.setProperty('opacity', '0', 'important');
  root.style.setProperty('pointer-events', 'none', 'important');
  root.prepend(style);

  const mediaStates = new Map<HTMLMediaElement, boolean>();
  const MediaElement = doc.defaultView?.HTMLMediaElement;
  const muteMedia = (node: Node): void => {
    if (!MediaElement || !(node instanceof Element)) return;
    const media = node instanceof MediaElement
      ? [node, ...node.querySelectorAll<HTMLMediaElement>('audio, video')]
      : Array.from(node.querySelectorAll<HTMLMediaElement>('audio, video'));
    for (const item of media) {
      if (!mediaStates.has(item)) {
        const baseline = documentMuteBaselines.get(item) ?? item.muted;
        mediaStates.set(item, baseline);
        documentMuteBaselines.set(item, baseline);
      }
      if (!item.muted) item.muted = true;
    }
  };
  muteMedia(root);
  const Observer = doc.defaultView?.MutationObserver ?? MutationObserver;
  const mediaObserver = new Observer(mutations => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) muteMedia(node);
    }
  });
  mediaObserver.observe(root, { childList: true, subtree: true });
  const onMediaPlayback = (event: Event): void => muteMedia(event.target as Node);
  root.addEventListener('play', onMediaPlayback, true);
  root.addEventListener('playing', onMediaPlayback, true);
  root.addEventListener('volumechange', onMediaPlayback, true);

  let active = true;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let resolveSettled!: () => void;
  const settled = new Promise<void>(resolve => { resolveSettled = resolve; });

  const release = (): void => {
    if (!active) return;
    active = false;
    if (timeoutId !== null) clearTimeout(timeoutId);
    mediaObserver.disconnect();
    root.removeEventListener('play', onMediaPlayback, true);
    root.removeEventListener('playing', onMediaPlayback, true);
    root.removeEventListener('volumechange', onMediaPlayback, true);
    root.removeEventListener(CONTENT_READY_EVENT, release);
    style.remove();
    if (root.getAttribute(DOCUMENT_SHIELD_ATTRIBUTE) === token) {
      root.removeAttribute(DOCUMENT_SHIELD_ATTRIBUTE);
    }
    root.removeAttribute(CONTENT_READY_ATTRIBUTE);
    // The host may strip our data attribute while leaving the inline lock in
    // place. Attribute ownership and inline-style ownership are independent:
    // restore each critical value whenever it still exactly matches what this
    // controller wrote, even if the token vanished.
    if (
      root.style.getPropertyValue('opacity') === '0'
      && root.style.getPropertyPriority('opacity') === 'important'
    ) restoreInlineStyle(root, 'opacity', previousOpacity);
    if (
      root.style.getPropertyValue('pointer-events') === 'none'
      && root.style.getPropertyPriority('pointer-events') === 'important'
    ) restoreInlineStyle(root, 'pointer-events', previousPointerEvents);
    for (const [media, wasMuted] of mediaStates) {
      const protectedOwner = media.closest(
        '[data-fw-provisional-shield-token], [data-fw-blocked], [data-fw-action="hide"], [data-fw-action="collapse"]',
      );
      if (!wasMuted && media.muted && !protectedOwner) media.muted = false;
      documentMuteBaselines.delete(media);
    }
    mediaStates.clear();
    resolveSettled();
  };

  const controller: DocumentStartShieldController = {
    settled,
    get active() { return active; },
    release,
  };

  timeoutId = setTimeout(release, options.timeoutMs ?? 5_000);

  void Promise.resolve()
    .then(options.readMode)
    .then(mode => {
      // A fresh install has no stored mode yet; getSettings() resolves that
      // same absence to the product default (Teen). Only an explicit Child
      // setting keeps the root curtain through the initial item scan.
      if (mode !== 'child') {
        release();
        return;
      }
      if (root.getAttribute(CONTENT_READY_ATTRIBUTE) === 'true') {
        release();
        return;
      }
      root.addEventListener(CONTENT_READY_EVENT, release, { once: true });
    })
    .catch(() => {
      // Fail-closed, matching getSettings()'s Child fallback on the same
      // storage-error class (settings.ts): do not release the curtain here.
      // The 5s safety timeout above remains the sole release authority for a
      // persistent read failure, so a flaky/erroring boot never drops the
      // root curtain before the initial item scan can cover the page.
    });

  return controller;
}

/**
 * Called immediately after the interceptor's synchronous initial scan. The
 * persistent attribute closes the race where content becomes ready before
 * the bootstrap storage read settles.
 */
export function signalContentShieldReady(doc: Document = document): void {
  const root = doc.documentElement;
  if (
    !root
    || (
      !root.hasAttribute(DOCUMENT_SHIELD_ATTRIBUTE)
      && !doc.getElementById(DOCUMENT_SHIELD_STYLE_ID)
    )
  ) return;
  root.setAttribute(CONTENT_READY_ATTRIBUTE, 'true');
  const EventCtor = doc.defaultView?.Event ?? Event;
  root.dispatchEvent(new EventCtor(CONTENT_READY_EVENT));
}

/** Waits for document.body when content.js is injected at document_start. */
export function waitForDocumentBody(doc: Document = document): Promise<HTMLElement> {
  if (doc.body) return Promise.resolve(doc.body);

  return new Promise(resolve => {
    let observer: MutationObserver | null = null;
    const finish = (): void => {
      if (!doc.body) return;
      observer?.disconnect();
      doc.removeEventListener('DOMContentLoaded', finish);
      resolve(doc.body);
    };

    const Observer = doc.defaultView?.MutationObserver ?? MutationObserver;
    if (doc.documentElement) {
      observer = new Observer(finish);
      observer.observe(doc.documentElement, { childList: true, subtree: true });
    }
    doc.addEventListener('DOMContentLoaded', finish);
    finish();
  });
}
