// The Child cover terminals of the content script: mount, prepare, commit,
// release and settle a post's cover, the exact-identity comment hide, and
// the classification-gated marker render. createProtectionTerminals binds
// them once to what only content/index.ts owns (the cover manager, the
// classification check and the cancelled-stale record writer); the bodies
// are the ones that lived in index.ts. Extracted per
// docs/audits/2026-08-23-objective-audit/wave4-architecture (Proposal A, end state).

import type { PostContent } from '../../types/post';
import type { ChildProtectionManager } from './child-first-protection';
import { recordSpan } from '../../diagnostics/perf-trace';
import { tryRecoverCommentHideAnchor } from '../post-path/dom-recycle-recovery';
import { buildCommentEntryForRoot, hideCommentTerminal, swapCommentTextInPlace, type CommentHideNotice } from './comment-overlay';
import { renderTeenMarker } from '../markers/teen-marker';
import { createProtectionSettler } from './settle-protection';

export interface ProtectionTerminalDeps {
  childProtection: ChildProtectionManager<PostContent>;
  isCurrentClassification: (post: PostContent) => boolean;
  writeCancelledStaleRecord: (post: PostContent) => void;
}

export function createProtectionTerminals(deps: ProtectionTerminalDeps) {
  const { childProtection, isCurrentClassification, writeCancelledStaleRecord } = deps;

  function prepareCurrentPostMutation(post: PostContent, replacementAnchor?: HTMLElement): boolean {
    return isCurrentClassification(post) && childProtection.prepareMutation(post, replacementAnchor);
  }

  /**
   * Hide one comment on its exact live row. `notice` null closes the row
   * silently (Child); a notice leaves the sentence and a reveal in its place
   * (Teen, Adult; docs/design/HIDE-NOTICE-2026-09-07.md).
   */
  /**
   * The live row this classified comment belongs to, or null.
   *
   * Two steps, and both of them matter. Recovery finds the row again when the
   * platform's virtualizer has moved it. The text comparison then proves the
   * row found is still THIS comment, because recovery is a fingerprint search
   * and `deref()` is a handle to a node the platform may have refilled since.
   * Without it a terminal lands on whatever comment now occupies that place,
   * and the record says it landed on the one that was judged.
   *
   * Lifted out of applyCommentHide on 2026-09-19. The hide terminal did both
   * steps; the rewrite REPLAY in content/index.ts did neither, and replay is
   * the path that runs when a node comes back after a scroll, which is exactly
   * when a node has been recycled. Facebook's newlines are stripped on both
   * sides because its renderer re-wraps a comment between extraction and
   * replay.
   */
  function resolveCommentRow(
    post: PostContent,
  ): { el: HTMLElement; entry: NonNullable<ReturnType<typeof buildCommentEntryForRoot>> } | null {
    const el = tryRecoverCommentHideAnchor(
      post.domRef,
      post.text,
      post.platform,
      {
        parentId: post.parentVideoId ?? '',
        author: post.author,
        depth: post.depth,
      },
    );
    if (!el) return null;
    const entry = buildCommentEntryForRoot(el, post.platform);
    if (!entry) return null;
    const liveText = post.platform === 'facebook' ? entry.text.replace(/[\r\n]/g, '') : entry.text;
    const classifiedText = post.platform === 'facebook' ? post.text.replace(/[\r\n]/g, '') : post.text;
    if (liveText.trim() !== classifiedText.trim()) return null;
    return { el, entry };
  }

  function applyCommentHide(post: PostContent, notice: CommentHideNotice | null = null): boolean {
    try {
      const row = resolveCommentRow(post);
      if (!row) return false;
      const { el, entry } = row;
      if (!prepareCurrentPostMutation(post, el)) return false;
      if (!hideCommentTerminal(entry, notice)) return false;
      commitProtection(post, true);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Star a swearing comment's words in place and prove it landed (11 Oct 2026). The mask is the same swap the
   * batch's mask uses, applied at the door when no reading follows. Returns false when the row moved, was recycled
   * for another comment, or the page refused the text: the comment is then left exactly as served and the caller
   * records nothing that says otherwise.
   */
  function applyCommentMask(post: PostContent, masked: string): boolean {
    try {
      const row = resolveCommentRow(post);
      if (!row) return false;
      const { el, entry } = row;
      if (!prepareCurrentPostMutation(post, el)) return false;
      swapCommentTextInPlace(entry, masked);
      const norm = (s: string): string => s.replace(/\s+/g, ' ').trim();
      return entry.rootEl.dataset.fwRewritten === 'true' && norm(entry.textEl.textContent ?? '') === norm(masked);
    } catch {
      return false;
    }
  }

  function renderCommentMarkerForCurrentClassification(
    post: PostContent,
    options: Parameters<typeof renderTeenMarker>[0],
  ): ReturnType<typeof renderTeenMarker> {
    return isCurrentClassification(post) ? renderTeenMarker(options) : null;
  }

  function mountProtection(post: PostContent, detectedAt: number): void {
    const handle = childProtection.protect(post);
    if (childProtection.enabled) {
      void recordSpan(
        { platform: post.platform, mode: 'child' },
        'first_protection',
        performance.now() - detectedAt,
        handle ? undefined : { success: false, error: 'shield-mount-failed' },
      );
    }
  }

  function protectBeforeEnqueue(post: PostContent, enqueue: () => boolean, detectedAt: number): void {
    mountProtection(post, detectedAt);
    try {
      if (!enqueue()) settleProtection(post, { record: 'unrecorded-fail-open', reason: 'enqueue-refused' });
    } catch (error) {
      settleProtection(post, { record: 'unrecorded-fail-open', reason: 'enqueue-threw' });
      throw error;
    }
  }

  function releaseProtection(post: PostContent): void {
    // A public SPA route/mode generation change leaves the old DOM mounted for
    // up to the delayed rescan. Its stale result must not uncover that raw DOM;
    // the fresh extraction rotates this owner synchronously. Private routes and
    // non-Child modes call releaseAll() directly, so no cover can stick there.
    if (childProtection.enabled && !isCurrentClassification(post)) {
      childProtection.pruneStale();
      return;
    }
    childProtection.release(post);
  }

  /**
   * The only way a cover comes off. Names the record that accounts for the
   * post, writes the one it owns, decides per mode, then releases. See
   * settle-protection.ts.
   */
  const settleProtection = createProtectionSettler<PostContent>({
    isChildProtectionEnabled: () => childProtection.enabled,
    releaseProtection,
    writeCancelledStaleRecord: post => writeCancelledStaleRecord(post),
    holdProtection: post => { childProtection.hold(post); },
  });

  function commitProtection(post: PostContent, preserveMedia: boolean = true): void {
    childProtection.commit(post, preserveMedia);
  }

  return {
    prepareCurrentPostMutation,
    resolveCommentRow,
    applyCommentHide,
    applyCommentMask,
    renderCommentMarkerForCurrentClassification,
    mountProtection,
    protectBeforeEnqueue,
    releaseProtection,
    settleProtection,
    commitProtection,
  };
}
