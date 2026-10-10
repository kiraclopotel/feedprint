import type { Mode } from '../../types/mode';
import type { Platform } from '../../types/post';
import type { ResolvedUiLanguage } from '../../i18n';
import {
  applyChildShield,
  commitChildShield,
  holdChildShield,
  strandChildShield,
  prepareChildShieldMutation,
  releaseChildShield,
  type ChildShieldHandle,
} from './provisional-shield';
import { resolveProtectionHost } from './protection-host';
import { isInspectionTab } from '../post-path/inspection-mode';

interface ProtectableItem {
  id: string;
  text?: string;
  platform?: Platform;
  kind?: string;
  domRef: WeakRef<HTMLElement>;
}

let nextProtectionOwner = 0;

function normalizeIdentityText(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 200);
}

function liveIdentityMatches(element: HTMLElement, expectedText: string): boolean {
  const labelled = [element, ...element.querySelectorAll<HTMLElement>('[alt], [aria-label]')]
    .flatMap(candidate => [candidate.getAttribute('alt') ?? '', candidate.getAttribute('aria-label') ?? '']);
  return [element.textContent ?? '', ...labelled]
    .some(candidate => candidate.replace(/\s+/g, ' ').trim().includes(expectedText));
}

function containsItemIdentity(element: HTMLElement, id: string): boolean {
  if (!id) return false;
  const candidates = [
    element,
    ...element.querySelectorAll<HTMLElement>('[href], [data-id], [data-item-id], [data-post-id], [id]'),
  ];
  return candidates.some(candidate =>
    ['href', 'data-id', 'data-item-id', 'data-post-id', 'id']
      .some(attribute => (candidate.getAttribute(attribute) ?? '').includes(id)),
  );
}

function mediaIdentity(element: HTMLElement): string {
  return Array.from(
    element.querySelectorAll<HTMLMediaElement | HTMLImageElement>('video, audio, img'),
    media => media.currentSrc || media.src,
  ).filter(Boolean).join('|');
}

export class ChildProtectionManager<T extends ProtectableItem> {
  private mode: Mode = 'adult';
  // Resolved UI language for the "checking" cover text (M80#1 / I18N-4
  // wiring). Set once per session via setLang, mirroring setMode — a
  // mid-session language change (no runtime listener wires this today, see
  // content/index.ts) takes effect on the NEXT protect() mount only, never
  // retroactively re-labels an already-mounted cover. Acceptable: language
  // preference changes are rare and covers are short-lived.
  private lang: ResolvedUiLanguage = 'en';
  // Deadline for a provisional cover whose verdict never arrives. A verdict
  // normally lands in seconds (queue + two LLM calls); the only way a cover
  // lives past a minute is a dropped verdict (extension reload, queue
  // cancel, thrown handler), and without a deadline that cover is permanent
  // opaque black, indistinguishable from FW deleting the post. Fail open at
  // the deadline: the deterministic extraction-time layer has already run,
  // and a forever-hidden post erodes trust more than one late reveal.
  private static readonly RELEASE_DEADLINE_MS = 60_000;
  private readonly byItem = new WeakMap<T, ChildShieldHandle>();
  private readonly active = new Set<ChildShieldHandle>();
  private readonly staleRearmed = new WeakSet<ChildShieldHandle>();
  private readonly itemByHandle = new WeakMap<ChildShieldHandle, T>();
  private readonly retiredItems = new WeakSet<T>();
  /** Set once the extension goes away under this tab (M68, strandAll). */
  private stranded = false;

  constructor(
    private readonly onStaleRelease?: (item: T, anchor: HTMLElement) => void,
    private readonly onProtectionEnded?: (item: T, elapsedMs: number) => void,
    private readonly ownerScope: 'post' = 'post',
  ) {}

  get enabled(): boolean {
    return this.mode === 'child';
  }

  get activeCount(): number {
    this.pruneStale();
    return this.active.size;
  }

  setMode(mode: Mode): void {
    if (this.mode === 'child' && mode !== 'child') this.releaseAll();
    this.mode = mode;
  }

  setLang(lang: ResolvedUiLanguage): void {
    this.lang = lang;
  }

  protect(item: T): ChildShieldHandle | null {
    // The extension went away under this tab (M68). A new cover here could
    // never resolve, so it would be a permanent "FeelingWise is checking this
    // content" over a post nothing is going to check. Mounting nothing leaves
    // the post visible, which is the same as having no extension installed and
    // is what the page already is; the covers already up stay up and say so.
    if (this.stranded) return null;
    // Inspection pass (dashboard-opened tab): no provisional cover — the
    // parent came to SEE this content. Terminal appliers are gated too, and
    // release/commit tolerate the missing handle.
    if (isInspectionTab()) return null;
    if (this.mode !== 'child') return null;
    const anchor = item.domRef.deref();
    if (!anchor) return null;
    return this.protectAt(item, anchor);
  }

  private protectAt(
    item: T,
    anchor: HTMLElement,
    replaceExisting: boolean = false,
  ): ChildShieldHandle | null {
    if (!replaceExisting) this.pruneStale();
    this.retiredItems.delete(item);
    const existing = this.byItem.get(item);
    if (existing && !existing.settled && !replaceExisting) return existing;
    const element = resolveProtectionHost(anchor, item.platform, item.kind);
    const expectedText = normalizeIdentityText(item.text ?? '');
    const requiresDomIdentity = containsItemIdentity(element, item.id);
    const expectedMediaIdentity = expectedText || requiresDomIdentity ? '' : mediaIdentity(element);
    const isSameContent = (current: HTMLElement): boolean =>
      current.isConnected
      && (!expectedText || liveIdentityMatches(current, expectedText))
      && (!requiresDomIdentity || containsItemIdentity(current, item.id))
      && (!expectedMediaIdentity || mediaIdentity(current) === expectedMediaIdentity);
    const handle = applyChildShield(
      element,
      `${this.ownerScope}:${++nextProtectionOwner}:${item.id}`,
      {
        shareExisting: true,
        ownerScope: this.ownerScope,
        ownerIdentity: `${item.platform ?? 'unknown'}:${item.id}:${expectedText}:${expectedMediaIdentity}`,
        isSameContent,
        isCurrent: current =>
          isSameContent(current)
          && anchor.isConnected
          && (current === anchor || current.contains(anchor)),
        lang: this.lang,
      },
    );
    if (!handle) return null;
    if (existing && existing !== handle) {
      if (!existing.settled) releaseChildShield(existing);
      this.active.delete(existing);
      this.itemByHandle.delete(existing);
    }
    this.byItem.set(item, handle);
    this.active.add(handle);
    this.itemByHandle.set(handle, item);
    // Multiple timers can target one shared handle (shareExisting); only the
    // first to fire acts, the rest no-op on the active-set check.
    setTimeout(
      () => this.expireDeadline(handle),
      ChildProtectionManager.RELEASE_DEADLINE_MS,
    );
    this.pruneStale();
    return handle;
  }

  /**
   * The cover stays because the verdict said hide (or rewrite) and it could
   * not be applied to the live node. Two things change: the copy stops saying
   * the post is being checked, and the deadline reaper stops applying, because
   * the reaper is the answer to a verdict that never came, not to one that
   * came and could not be carried out. The cover still goes when the item's
   * node leaves the page (pruneStale) or when another terminal releases it.
   */
  /**
   * The extension was reloaded, updated or removed under this open tab.
   *
   * M68, open since 2026-07-13 with live evidence from a Child-mode tab that
   * survived an extension reload: covers parked indefinitely as "FeelingWise is
   * checking this content" while every call into the extension threw
   * "Extension context invalidated". Nothing on the page said so. The only
   * signal was one console line that no parent will ever read.
   *
   * Every cover already up keeps covering and changes what it says. New covers
   * stop being mounted, because one mounted now could never resolve.
   *
   * Idempotent: the guard fires once per tab, but a caller re-checking
   * isContextAlive() on a later pass must be free to call this again.
   */
  strandAll(): void {
    if (this.stranded) return;
    this.stranded = true;
    for (const handle of this.active) strandChildShield(handle, this.lang);
  }

  /** True once the extension has gone away under this tab. */
  isStranded(): boolean {
    return this.stranded;
  }

  hold(item: T): boolean {
    if (this.mode !== 'child') return false;
    const handle = this.byItem.get(item);
    if (!handle || handle.settled || !this.active.has(handle)) return false;
    return holdChildShield(handle, this.lang);
  }

  /**
   * Deadline reaper for a cover whose verdict never arrived. No-ops when the
   * handle already settled, was held by a verdict that could not land, or left
   * the active set (the normal path). Cleanup mirrors pruneStale so a later
   * release()/commit() for the item finds nothing and returns null harmlessly.
   */
  private expireDeadline(handle: ChildShieldHandle): void {
    if (!this.active.has(handle) || handle.settled || handle.held) return;
    const item = this.itemByHandle.get(handle);
    const protectionEnded = releaseChildShield(handle);
    this.active.delete(handle);
    this.itemByHandle.delete(handle);
    if (item && this.byItem.get(item) === handle) {
      this.byItem.delete(item);
      this.retiredItems.add(item);
    }
    if (protectionEnded && item) {
      this.onProtectionEnded?.(item, performance.now() - handle.mountedAt);
    }
  }

  protectThen(item: T, enqueue: () => boolean | void): ChildShieldHandle | null {
    const handle = this.protect(item);
    try {
      if (enqueue() === false) this.release(item);
    } catch (error) {
      this.release(item);
      throw error;
    }
    return handle;
  }

  prepareMutation(item: T, replacementAnchor?: HTMLElement): boolean {
    if (this.mode !== 'child') return true;
    if (this.retiredItems.has(item)) {
      if (!replacementAnchor?.isConnected) return false;
      const replacement = this.protectAt(item, replacementAnchor, true);
      return replacement ? prepareChildShieldMutation(replacement) : false;
    }
    const handle = this.byItem.get(item);
    if (!handle) return true;
    if (prepareChildShieldMutation(handle)) return true;
    if (!replacementAnchor?.isConnected) return false;
    const replacement = this.protectAt(item, replacementAnchor, true);
    return replacement ? prepareChildShieldMutation(replacement) : false;
  }

  release(item: T): { elapsedMs: number; protectionEnded: boolean } | null {
    const current = this.byItem.get(item);
    if (
      current
      && this.mode === 'child'
      && !current.settled
      && !current.mutationPrepared
      && current.element.isConnected
      && !current.isSameContent(current.element)
    ) {
      if (!this.staleRearmed.has(current)) {
        this.staleRearmed.add(current);
        const anchor = item.domRef.deref();
        const liveAnchor = anchor?.isConnected
          && (current.element === anchor || current.element.contains(anchor))
          ? anchor
          : current.element;
        this.onStaleRelease?.(item, liveAnchor);
      }
      if (current.settled) this.take(item);
      return null;
    }
    const handle = this.take(item);
    if (!handle) return null;
    const protectionEnded = releaseChildShield(handle.handle);
    if (protectionEnded) this.onProtectionEnded?.(item, handle.elapsedMs);
    return { elapsedMs: handle.elapsedMs, protectionEnded };
  }

  commit(item: T, preserveMedia: boolean = true): { elapsedMs: number; protectionEnded: boolean } | null {
    const handle = this.take(item);
    if (!handle) return null;
    const protectionEnded = commitChildShield(handle.handle, preserveMedia);
    if (protectionEnded) this.onProtectionEnded?.(item, handle.elapsedMs);
    return { elapsedMs: handle.elapsedMs, protectionEnded };
  }

  /**
   * Drop manager entries whose lease owner was rotated, whose host detached,
   * or whose host now has a newer owner in this manager. The newest connected
   * owner survives, so route cleanup cannot uncover the only still-visible
   * item while waiting for fresh extraction.
   */
  pruneStale(): void {
    const survivorByElement = new Map<HTMLElement, ChildShieldHandle>();
    for (const handle of this.active) {
      if (!handle.settled && handle.element.isConnected) {
        survivorByElement.set(handle.element, handle);
      }
    }

    for (const handle of [...this.active]) {
      const keep = !handle.settled
        && handle.element.isConnected
        && survivorByElement.get(handle.element) === handle;
      if (keep) continue;
      const item = this.itemByHandle.get(handle);
      const protectionEnded = !handle.settled && releaseChildShield(handle);
      this.active.delete(handle);
      this.itemByHandle.delete(handle);
      if (item && this.byItem.get(item) === handle) {
        this.byItem.delete(item);
        this.retiredItems.add(item);
      }
      if (protectionEnded && item) {
        this.onProtectionEnded?.(item, performance.now() - handle.mountedAt);
      }
    }
  }

  releaseAll(): void {
    for (const handle of this.active) {
      const item = this.itemByHandle.get(handle);
      if (!handle.settled && releaseChildShield(handle) && item) {
        this.onProtectionEnded?.(item, performance.now() - handle.mountedAt);
      }
      this.itemByHandle.delete(handle);
    }
    this.active.clear();
  }

  private take(item: T): { handle: ChildShieldHandle; elapsedMs: number } | undefined {
    const handle = this.byItem.get(item);
    if (!handle) return undefined;
    this.byItem.delete(item);
    this.active.delete(handle);
    this.itemByHandle.delete(handle);
    return { handle, elapsedMs: performance.now() - handle.mountedAt };
  }
}
