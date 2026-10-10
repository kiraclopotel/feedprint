import { documentMuteBaseline } from './document-start-shield';
import {
  removeProtectionCover,
  syncProtectionCover,
  type ProtectionOwnerScope,
} from '../../diagnostics/protection-health';
import type { ResolvedUiLanguage } from '../../i18n';
import { MARKER_STRINGS } from '../../i18n/marker-strings';

const TOKEN_ATTRIBUTE = 'data-fw-provisional-shield-token';

// Language-keyed cover copy for the "checking" overlay + its screen-reader
// live-region mirror (M80#1 / I18N-4). Kept local to this module rather than
// added to src/i18n/marker-strings.ts's MarkerStrings table because this
// file is the only one this fix is scoped to touch; a future pass can fold
// these into MarkerStrings if it also owns that file. Callers thread the
// already-resolved ResolvedUiLanguage in via ApplyChildShieldOptions.lang —
// this module never reads settings/storage itself, mirroring how
// teen-marker.ts receives `lang` as a plain parameter instead of resolving
// it on its own hot path.
// Checking copy lives in MARKER_STRINGS (D8 fold 2026-07-14) — the one
// language-keyed home for user-visible marker/shield strings.

interface StoredPosition {
  value: string;
  priority: string;
}

interface StoredMediaState {
  element: HTMLMediaElement;
  readonly muted: boolean;
}

function captureMediaState(media: HTMLMediaElement): StoredMediaState {
  return {
    element: media,
    muted: documentMuteBaseline(media) ?? media.muted,
  };
}

export interface ChildShieldHandle {
  readonly element: HTMLElement;
  readonly token: string;
  readonly overlay: HTMLElement;
  readonly previousPosition: StoredPosition;
  readonly previousAriaBusy: string | null;
  readonly previousInert: boolean;
  readonly mediaStates: readonly StoredMediaState[];
  readonly ownsPosition: boolean;
  readonly contentFingerprint: string;
  readonly mountedAt: number;
  readonly isCurrent: (element: HTMLElement) => boolean;
  readonly isSameContent: (element: HTMLElement) => boolean;
  readonly ownerScope: string;
  readonly ownerIdentity: string;
  mutationPrepared: boolean;
  settled: boolean;
  /**
   * The verdict arrived, it said hide or rewrite, and it could not be applied
   * to the live node, so the cover stays in place of the terminal that did not
   * land (settle-protection.ts, disposition 'retain-in-child'). A held cover is
   * a decision, not a cover waiting for one: the deadline reaper leaves it
   * alone, and its copy says the post is hidden instead of still being checked.
   */
  held: boolean;
}

export interface ApplyChildShieldOptions {
  /** Join an existing valid shield on this host instead of replacing it. */
  shareExisting?: boolean;
  /** Owner-specific identity check used immediately before a final DOM mutation. */
  isCurrent?: (element: HTMLElement) => boolean;
  /** Content-only identity check used before a benign release. */
  isSameContent?: (element: HTMLElement) => boolean;
  /** Owners in one scope may share only while they describe the same item. */
  ownerScope?: 'post' | 'image' | 'video' | 'generic';
  ownerIdentity?: string;
  /**
   * Resolved UI language for the "checking" cover text + aria-label. Passed
   * by the caller (same resolveUiLanguage(settings.uiLanguage) source other
   * content-surface strings use) — this module does no language resolution
   * of its own. Defaults to 'en' so existing unthreaded call sites keep
   * their current behavior unchanged.
   */
  lang?: ResolvedUiLanguage;
}

interface ChildShieldLease {
  readonly element: HTMLElement;
  readonly stamp: string;
  readonly overlay: HTMLElement;
  readonly previousPosition: StoredPosition;
  readonly previousAriaBusy: string | null;
  readonly previousInert: boolean;
  readonly mediaStates: StoredMediaState[];
  readonly ownsPosition: boolean;
  readonly contentFingerprint: string;
  readonly mountedAt: number;
  readonly handles: Set<ChildShieldHandle>;
  readonly ownerIdentities: Map<string, string>;
  readonly preserveMediaOwners: Map<string, string>;
  mediaObserver: MutationObserver | null;
  mediaEventHandler: ((event: Event) => void) | null;
  accessibleStatusActive: boolean;
  /** At least one owner of this cover is held (see ChildShieldHandle.held). */
  held: boolean;
  /**
   * This cover was stranded by the extension going away (M68, strandChildShield).
   * Separate from `held` because the stranded copy must win: a hold that lands
   * afterwards would otherwise repaint a cover that nothing can act on with
   * "FeelingWise hid this post", which reads as a verdict the extension is no
   * longer able to reach.
   */
  stranded: boolean;
  // Q75 (W65): the lease-level mutationPrepared copy was dead - only the
  // per-handle field (read by child-first-protection) carries meaning.
  finalized: boolean;
}

const activeLeases = new WeakMap<HTMLElement, ChildShieldLease>();
const handleLeases = new WeakMap<ChildShieldHandle, ChildShieldLease>();
const accessibleStatusByDocument = new WeakMap<Document, { element: HTMLElement; leases: number }>();

function syncLeaseHealth(lease: ChildShieldLease): void {
  syncProtectionCover({
    element: lease.element,
    overlay: lease.overlay,
    mountedAt: lease.mountedAt,
    ownerScopes: [...lease.handles].map(owner => owner.ownerScope as ProtectionOwnerScope),
  });
}

const BLOCKED_INTERACTION_EVENTS = [
  'click',
  'dblclick',
  'mousedown',
  'mouseup',
  'pointerdown',
  'pointerup',
  'touchstart',
  'touchend',
] as const;

function blockInteraction(event: Event): void {
  event.preventDefault();
  event.stopImmediatePropagation();
}

interface ParsedColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

function parseColor(value: string): ParsedColor | null {
  const normalized = value.trim().toLowerCase();
  const hex = normalized.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    return {
      r: Number.parseInt(hex[1].slice(0, 2), 16),
      g: Number.parseInt(hex[1].slice(2, 4), 16),
      b: Number.parseInt(hex[1].slice(4, 6), 16),
      a: 1,
    };
  }
  if (!normalized.startsWith('rgb')) return null;
  const parts = normalized.match(/[\d.]+/g)?.map(Number);
  if (!parts || parts.length < 3 || parts.some(part => !Number.isFinite(part))) return null;
  return { r: parts[0], g: parts[1], b: parts[2], a: parts[3] ?? 1 };
}

function isOpaqueColor(value: string): boolean {
  if (value === '' || value === 'transparent') return false;
  return (parseColor(value)?.a ?? 0) >= 0.98;
}

function relativeLuminance(color: ParsedColor): number {
  const channel = (value: number): number => {
    const normalized = Math.min(255, Math.max(0, value)) / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
}

function contrastRatio(a: ParsedColor, b: ParsedColor): number {
  const lighter = Math.max(relativeLuminance(a), relativeLuminance(b));
  const darker = Math.min(relativeLuminance(a), relativeLuminance(b));
  return (lighter + 0.05) / (darker + 0.05);
}

function contrastSafeForeground(background: string, candidate: string): string {
  const backgroundColor = parseColor(background);
  const candidateColor = parseColor(candidate);
  if (backgroundColor && candidateColor && candidateColor.a >= 0.98
    && contrastRatio(backgroundColor, candidateColor) >= 4.5) {
    return candidate;
  }
  if (!backgroundColor) return '#374151';
  const dark = parseColor('#111827')!;
  const light = parseColor('#f9fafb')!;
  return contrastRatio(backgroundColor, dark) >= contrastRatio(backgroundColor, light)
    ? '#111827'
    : '#f9fafb';
}

function protectionSurfaceColors(element: HTMLElement): { background: string; foreground: string } {
  const view = element.ownerDocument.defaultView;
  let current: HTMLElement | null = element;
  let foreground = '';
  while (current && view) {
    const computed = view.getComputedStyle(current);
    if (!foreground && isOpaqueColor(computed.color)) foreground = computed.color;
    if (isOpaqueColor(computed.backgroundColor)) {
      return {
        background: computed.backgroundColor,
        foreground: contrastSafeForeground(computed.backgroundColor, foreground),
      };
    }
    current = current.parentElement;
  }
  return {
    background: '#f3f4f6',
    foreground: contrastSafeForeground('#f3f4f6', foreground),
  };
}

function acquireAccessibleStatus(doc: Document, lang: ResolvedUiLanguage): void {
  const existing = accessibleStatusByDocument.get(doc);
  if (existing?.element.isConnected) {
    existing.leases++;
    return;
  }
  const activeLeaseCount = existing?.leases ?? 0;
  const status = doc.createElement('div');
  status.className = 'fw-provisional-shield-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.setAttribute('aria-atomic', 'true');
  const hiddenStyles: Record<string, string> = {
    position: 'fixed',
    width: '1px',
    height: '1px',
    padding: '0',
    margin: '-1px',
    overflow: 'hidden',
    clip: 'rect(0, 0, 0, 0)',
    'white-space': 'nowrap',
    border: '0',
  };
  for (const [property, value] of Object.entries(hiddenStyles)) {
    status.style.setProperty(property, value, 'important');
  }
  (doc.body ?? doc.documentElement).appendChild(status);
  status.textContent = MARKER_STRINGS[lang].checkingText;
  accessibleStatusByDocument.set(doc, { element: status, leases: activeLeaseCount + 1 });
}

function releaseAccessibleStatus(doc: Document): void {
  const state = accessibleStatusByDocument.get(doc);
  if (!state) return;
  state.leases--;
  if (state.leases > 0) return;
  state.element.remove();
  accessibleStatusByDocument.delete(doc);
}

function createOverlay(element: HTMLElement, lang: ResolvedUiLanguage): HTMLElement {
  const overlay = element.ownerDocument.createElement('div');
  overlay.className = 'fw-provisional-shield';
  overlay.setAttribute('aria-label', MARKER_STRINGS[lang].checkingAria);
  overlay.setAttribute('aria-hidden', 'true');
  overlay.textContent = MARKER_STRINGS[lang].checkingText;
  const colors = protectionSurfaceColors(element);

  const criticalStyles: Record<string, string> = {
    position: 'absolute',
    inset: '0',
    'z-index': '2147483647',
    display: 'flex',
    'align-items': 'center',
    'justify-content': 'center',
    'box-sizing': 'border-box',
    'background-color': colors.background,
    color: colors.foreground,
    opacity: '1',
    'pointer-events': 'auto',
    'touch-action': 'none',
    'user-select': 'none',
    'font-family': 'inherit',
    'font-size': '13px',
    'font-weight': '600',
    'text-align': 'center',
    padding: '24px',
  };

  for (const [property, value] of Object.entries(criticalStyles)) {
    overlay.style.setProperty(property, value, 'important');
  }
  for (const eventName of BLOCKED_INTERACTION_EVENTS) {
    overlay.addEventListener(eventName, blockInteraction, { capture: true });
  }

  return overlay;
}

function restorePosition(lease: ChildShieldLease): void {
  if (!lease.ownsPosition) return;
  if (
    lease.element.style.getPropertyValue('position') !== 'relative'
    || lease.element.style.getPropertyPriority('position') !== 'important'
  ) return;

  const { value, priority } = lease.previousPosition;
  if (value === '') {
    lease.element.style.removeProperty('position');
    return;
  }
  lease.element.style.setProperty('position', value, priority);
}

function restoreAriaBusy(lease: ChildShieldLease): void {
  if (lease.element.getAttribute('aria-busy') !== 'true') return;
  if (lease.previousAriaBusy === null) {
    lease.element.removeAttribute('aria-busy');
    return;
  }
  lease.element.setAttribute('aria-busy', lease.previousAriaBusy);
}

function restoreInert(lease: ChildShieldLease): void {
  if (lease.previousInert || !lease.element.hasAttribute('inert')) return;
  lease.element.removeAttribute('inert');
}

function restoreMedia(lease: ChildShieldLease): void {
  for (const state of lease.mediaStates) {
    // A true baseline was never changed by the shield. A false baseline is
    // restored only while the element still carries the value we set.
    if (!state.muted && state.element.muted) state.element.muted = false;
  }
}

function fingerprint(element: HTMLElement): string {
  const clone = element.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('.fw-provisional-shield, .fw-teen-marker').forEach(owned => owned.remove());
  return (clone.textContent ?? '').trim().slice(0, 200);
}

function finalizeLease(lease: ChildShieldLease, shouldRestoreMedia: boolean): void {
  if (lease.finalized) return;
  lease.finalized = true;
  lease.mediaObserver?.disconnect();
  lease.mediaObserver = null;
  if (lease.mediaEventHandler) {
    lease.element.removeEventListener('play', lease.mediaEventHandler, true);
    lease.element.removeEventListener('playing', lease.mediaEventHandler, true);
    lease.element.removeEventListener('volumechange', lease.mediaEventHandler, true);
    lease.mediaEventHandler = null;
  }
  lease.overlay.remove();
  if (lease.accessibleStatusActive) {
    releaseAccessibleStatus(lease.element.ownerDocument);
    lease.accessibleStatusActive = false;
  }
  if (activeLeases.get(lease.element) === lease) activeLeases.delete(lease.element);
  removeProtectionCover(lease.element);
  for (const owner of lease.handles) {
    owner.settled = true;
    handleLeases.delete(owner);
  }
  lease.handles.clear();

  if (lease.element.getAttribute(TOKEN_ATTRIBUTE) !== lease.stamp) return;
  lease.element.removeAttribute(TOKEN_ATTRIBUTE);
  restoreAriaBusy(lease);
  restoreInert(lease);
  restorePosition(lease);
  if (shouldRestoreMedia) restoreMedia(lease);
}

function addOwner(
  lease: ChildShieldLease,
  token: string,
  isCurrent: ((element: HTMLElement) => boolean) | undefined,
  isSameContent: ((element: HTMLElement) => boolean) | undefined,
  ownerScope: string,
  ownerIdentity: string,
): ChildShieldHandle {
  const preservedIdentity = lease.preserveMediaOwners.get(ownerScope);
  if (preservedIdentity !== undefined && preservedIdentity !== ownerIdentity) {
    lease.preserveMediaOwners.delete(ownerScope);
  }
  const handle: ChildShieldHandle = {
    element: lease.element,
    token,
    overlay: lease.overlay,
    previousPosition: lease.previousPosition,
    previousAriaBusy: lease.previousAriaBusy,
    previousInert: lease.previousInert,
    mediaStates: lease.mediaStates,
    ownsPosition: lease.ownsPosition,
    contentFingerprint: lease.contentFingerprint,
    mountedAt: lease.mountedAt,
    isCurrent: isCurrent ?? (element => fingerprint(element) === lease.contentFingerprint),
    isSameContent: isSameContent ?? isCurrent ?? (element => fingerprint(element) === lease.contentFingerprint),
    ownerScope,
    ownerIdentity,
    mutationPrepared: false,
    settled: false,
    // Never inherited from the lease: a hold is one owner's verdict about one
    // item. A fresh owner on the same host is a fresh detection and gets the
    // deadline every unheld cover gets.
    held: false,
  };
  lease.handles.add(handle);
  lease.ownerIdentities.set(ownerScope, ownerIdentity);
  handleLeases.set(handle, lease);
  return handle;
}

function muteNewMedia(lease: ChildShieldLease): void {
  const known = new Set(lease.mediaStates.map(state => state.element));
  const descendants = Array.from(lease.element.querySelectorAll<HTMLMediaElement>('audio, video'));
  const mediaElements = lease.element instanceof HTMLMediaElement
    ? [lease.element, ...descendants]
    : descendants;
  for (const media of mediaElements) {
    if (!known.has(media)) lease.mediaStates.push(captureMediaState(media));
    if (!media.muted) media.muted = true;
  }
}

function retireOwnerScope(lease: ChildShieldLease, ownerScope: string): void {
  for (const owner of [...lease.handles]) {
    if (owner.ownerScope !== ownerScope) continue;
    owner.settled = true;
    lease.handles.delete(owner);
    handleLeases.delete(owner);
  }
  lease.ownerIdentities.delete(ownerScope);
}

function restoreLeaseProtection(lease: ChildShieldLease): void {
  if (lease.element.getAttribute(TOKEN_ATTRIBUTE) === null) {
    lease.element.setAttribute(TOKEN_ATTRIBUTE, lease.stamp);
  }
  if (lease.element.getAttribute('aria-busy') !== 'true') lease.element.setAttribute('aria-busy', 'true');
  if (!lease.element.hasAttribute('inert')) lease.element.setAttribute('inert', '');
  if (
    lease.ownsPosition
    && (
      lease.element.style.getPropertyValue('position') !== 'relative'
      || lease.element.style.getPropertyPriority('position') !== 'important'
    )
  ) lease.element.style.setProperty('position', 'relative', 'important');
  if (lease.overlay.parentElement !== lease.element) lease.element.appendChild(lease.overlay);
  muteNewMedia(lease);
}

function startMediaWatch(lease: ChildShieldLease): void {
  const Observer = lease.element.ownerDocument.defaultView?.MutationObserver ?? MutationObserver;
  lease.mediaObserver = new Observer(() => {
    if (lease.finalized || activeLeases.get(lease.element) !== lease) return;
    const token = lease.element.getAttribute(TOKEN_ATTRIBUTE);
    if (token !== null && token !== lease.stamp) return;
    restoreLeaseProtection(lease);
  });
  lease.mediaObserver.observe(lease.element, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: [TOKEN_ATTRIBUTE, 'aria-busy', 'inert', 'style'],
  });
  lease.mediaEventHandler = (event: Event): void => {
    if (lease.element.getAttribute(TOKEN_ATTRIBUTE) !== lease.stamp) return;
    if (!(event.target instanceof HTMLMediaElement) || !lease.element.contains(event.target)) return;
    muteNewMedia(lease);
  };
  lease.element.addEventListener('play', lease.mediaEventHandler, true);
  lease.element.addEventListener('playing', lease.mediaEventHandler, true);
  lease.element.addEventListener('volumechange', lease.mediaEventHandler, true);
}

function finalizeOwner(handle: ChildShieldHandle, commit: boolean, preserveMedia: boolean): boolean {
  if (handle.settled) return false;
  const lease = handleLeases.get(handle);
  handle.settled = true;
  handleLeases.delete(handle);
  if (!lease || lease.finalized) return false;
  lease.handles.delete(handle);
  if (![...lease.handles].some(owner => owner.ownerScope === handle.ownerScope)) {
    lease.ownerIdentities.delete(handle.ownerScope);
  }
  if (commit && preserveMedia) {
    lease.preserveMediaOwners.set(handle.ownerScope, handle.ownerIdentity);
  }
  if (lease.handles.size === 0) {
    finalizeLease(lease, lease.preserveMediaOwners.size === 0);
    return true;
  }
  syncLeaseHealth(lease);
  return false;
}

export function applyChildShield(
  element: HTMLElement,
  token: string,
  options: ApplyChildShieldOptions = {},
): ChildShieldHandle | null {
  if (token.length === 0) return null;

  const existing = activeLeases.get(element);
  if (existing && !existing.finalized) {
    const mountedToken = element.getAttribute(TOKEN_ATTRIBUTE);
    if (mountedToken !== null && mountedToken !== existing.stamp) {
      finalizeLease(existing, false);
      return null;
    }
    // React can remove our owned attributes and replace the host's children in
    // one reconciliation. The page-level extraction observer is older than
    // this lease observer, so a synchronous re-protect may arrive before the
    // observer callback heals the host. A missing token is recoverable; only a
    // different non-null token proves that another lease owns this element.
    restoreLeaseProtection(existing);
    const ownerScope = options.ownerScope ?? 'generic';
    const ownerIdentity = options.ownerIdentity ?? token;
    const existingIdentity = existing.ownerIdentities.get(ownerScope);
    if (options.shareExisting && existingIdentity !== undefined && existingIdentity !== ownerIdentity) {
      retireOwnerScope(existing, ownerScope);
      if (existing.overlay.parentElement !== element) element.appendChild(existing.overlay);
      muteNewMedia(existing);
      const owner = addOwner(existing, token, options.isCurrent, options.isSameContent, ownerScope, ownerIdentity);
      syncLeaseHealth(existing);
      return owner;
    } else {
      const existingOwner = [...existing.handles].find(owner => owner.token === token && !owner.settled);
      if (existingOwner) {
        if (existing.overlay.parentElement !== element) element.appendChild(existing.overlay);
        muteNewMedia(existing);
        syncLeaseHealth(existing);
        return existingOwner;
      }
      if (options.shareExisting) {
        if (existing.overlay.parentElement !== element) element.appendChild(existing.overlay);
        muteNewMedia(existing);
        const owner = addOwner(existing, token, options.isCurrent, options.isSameContent, ownerScope, ownerIdentity);
        syncLeaseHealth(existing);
        return owner;
      }
      finalizeLease(existing, true);
    }
  }

  const previousPosition: StoredPosition = {
    value: element.style.getPropertyValue('position'),
    priority: element.style.getPropertyPriority('position'),
  };
  const previousAriaBusy = element.getAttribute('aria-busy');
  const previousInert = element.hasAttribute('inert');
  const previousToken = element.getAttribute(TOKEN_ATTRIBUTE);
  const mediaStates = Array.from(
    element.querySelectorAll<HTMLMediaElement>('audio, video'),
    captureMediaState,
  );
  const computedPosition = getComputedStyle(element).position;
  const ownsPosition = computedPosition === '' || computedPosition === 'static';
  const lang: ResolvedUiLanguage = options.lang ?? 'en';
  const overlay = createOverlay(element, lang);
  const lease: ChildShieldLease = {
    element,
    stamp: token,
    overlay,
    previousPosition,
    previousAriaBusy,
    previousInert,
    mediaStates,
    ownsPosition,
    contentFingerprint: fingerprint(element),
    mountedAt: performance.now(),
    handles: new Set(),
    ownerIdentities: new Map(),
    preserveMediaOwners: new Map(),
    mediaObserver: null,
    mediaEventHandler: null,
    accessibleStatusActive: false,
    held: false,
    stranded: false,
    finalized: false,
  };
  const handle = addOwner(
    lease,
    token,
    options.isCurrent,
    options.isSameContent,
    options.ownerScope ?? 'generic',
    options.ownerIdentity ?? token,
  );

  try {
    if (ownsPosition) {
      element.style.setProperty('position', 'relative', 'important');
    }
    element.setAttribute(TOKEN_ATTRIBUTE, token);
    element.setAttribute('aria-busy', 'true');
    element.setAttribute('inert', '');
    for (const state of mediaStates) state.element.muted = true;
    element.appendChild(overlay);
    acquireAccessibleStatus(element.ownerDocument, lang);
    lease.accessibleStatusActive = true;
    activeLeases.set(element, lease);
    startMediaWatch(lease);
    syncLeaseHealth(lease);
    return handle;
  } catch {
    overlay.remove();
    handle.settled = true;
    handleLeases.delete(handle);
    lease.handles.clear();
    lease.finalized = true;
    lease.mediaObserver?.disconnect();
    if (lease.accessibleStatusActive) {
      releaseAccessibleStatus(element.ownerDocument);
      lease.accessibleStatusActive = false;
    }
    removeProtectionCover(element);
    restoreAriaBusy(lease);
    restoreInert(lease);
    restorePosition(lease);
    restoreMedia(lease);
    if (previousToken === null) {
      element.removeAttribute(TOKEN_ATTRIBUTE);
    } else {
      element.setAttribute(TOKEN_ATTRIBUTE, previousToken);
    }
    return null;
  }
}

export function releaseChildShield(handle: ChildShieldHandle): boolean {
  return finalizeOwner(handle, false, false);
}

/**
 * Hold this cover in place of a terminal that did not land, and say so on it.
 *
 * The cover a Child sees while a post is judged says "FeelingWise is checking
 * this content". When the verdict comes back hide (or a rewrite) and the live
 * node refuses the mutation, the cover stays (settle-protection.ts,
 * 'retain-in-child') and that sentence stops being true: nothing is being
 * checked any more, the post is hidden. This swaps the copy for the same
 * sentence the hide notice uses in every mode, and marks the owner held so the
 * deadline reaper, which exists for a verdict that never arrived, leaves a
 * verdict that did arrive alone.
 */
export function holdChildShield(
  handle: ChildShieldHandle,
  lang: ResolvedUiLanguage = 'en',
): boolean {
  if (handle.settled) return false;
  const lease = handleLeases.get(handle);
  if (!lease || lease.finalized) return false;
  handle.held = true;
  // A stranded cover (M68) keeps its own sentence. A hold landing after the
  // extension went away would otherwise repaint it as a verdict nothing can
  // reach, and the refresh instruction is the only useful thing on it.
  if (lease.stranded) return true;
  if (lease.held) return true;
  lease.held = true;
  const held = MARKER_STRINGS[lang].hideNoticeChild;
  lease.overlay.textContent = held;
  lease.overlay.setAttribute('aria-label', held);
  // The live region is one per document and counts every cover on the page.
  // Re-announcing for this one would speak for the others too, so it is only
  // rewritten when this cover is the only one up.
  const status = accessibleStatusByDocument.get(lease.element.ownerDocument);
  if (status && status.leases === 1) status.element.textContent = held;
  return true;
}

/**
 * Strand this cover honestly: the extension went away under an open tab.
 *
 * M68, open since 2026-07-13 with live evidence. After the extension is
 * reloaded or updated, the page-side script keeps running because extraction
 * and cover mounting are pure DOM, but every call into the extension throws
 * "Extension context invalidated". A cover mounted as "FeelingWise is checking
 * this content" therefore waits for a verdict that can never arrive, and it
 * says that sentence for as long as the tab stays open. A parent reading it is
 * told the post is being checked when nothing is checking anything.
 *
 * The post STAYS covered. That is the safe direction and it is not the part
 * that was broken; the untrue sentence was. This swaps the copy for one that
 * says what happened and what clears it, and marks the owner held so the
 * deadline reaper leaves it alone: the reaper answers a verdict that never
 * arrived, and this is a verdict that can never be asked for, which is a
 * different thing and must not end in an uncovered post.
 *
 * Deliberately the same shape as holdChildShield below rather than a parameter
 * on it. The two are different events with different copy and only one of them
 * means the extension is gone, and a session reading either one should not have
 * to work out which case a flag selected.
 */
export function strandChildShield(
  handle: ChildShieldHandle,
  lang: ResolvedUiLanguage = 'en',
): boolean {
  if (handle.settled) return false;
  const lease = handleLeases.get(handle);
  if (!lease || lease.finalized) return false;
  handle.held = true;
  if (lease.stranded) return true;
  lease.stranded = true;
  lease.held = true;
  const notice = MARKER_STRINGS[lang].coverStrandedNotice;
  lease.overlay.textContent = notice;
  lease.overlay.setAttribute('aria-label', notice);
  // One live region per document counts every cover on the page, so
  // re-announcing for this one would speak for the others too. Same rule as
  // holdChildShield: only when this cover is the only one up.
  const status = accessibleStatusByDocument.get(lease.element.ownerDocument);
  if (status && status.leases === 1) status.element.textContent = notice;
  return true;
}

export function prepareChildShieldMutation(handle: ChildShieldHandle): boolean {
  if (handle.settled) return false;
  const lease = handleLeases.get(handle);
  if (!lease || lease.finalized) return false;
  if (lease.element.getAttribute(TOKEN_ATTRIBUTE) !== lease.stamp) return false;
  if (!handle.isCurrent(lease.element)) return false;
  handle.mutationPrepared = true;
  return true;
}

export function commitChildShield(handle: ChildShieldHandle, preserveMedia: boolean = true): boolean {
  return finalizeOwner(handle, true, preserveMedia);
}
