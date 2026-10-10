import { readTikTokVideoIdFromXgWrapper } from './tiktok-video-id';

interface HiddenTikTokAdState {
  videoId: string;
  remountClaimed: boolean;
}

const hiddenTikTokAds = new WeakMap<HTMLElement, HiddenTikTokAdState>();

/** Record only a hide that reached the full TikTok feed-card container. */
export function rememberTikTokAdHide(container: HTMLElement): void {
  const videoId = readTikTokVideoIdFromXgWrapper(container);
  if (!videoId) {
    hiddenTikTokAds.delete(container);
    return;
  }
  hiddenTikTokAds.set(container, { videoId, remountClaimed: false });
}

/**
 * Claim one sponsored extraction after a previously hidden TikTok root changes.
 * The exact same id is a remount replay. A different authoritative id consumes
 * the old state and is processed once as a fresh sponsored card. Missing or
 * unsafe identity is partial hydration, so it retains state and emits nothing.
 */
export function claimTikTokAdRemount(
  container: HTMLElement,
  videoId: string,
  isSponsored: boolean,
): boolean {
  const state = hiddenTikTokAds.get(container);
  if (!state || !isSponsored) return false;

  const wrapperVideoId = readTikTokVideoIdFromXgWrapper(container);
  if (!wrapperVideoId) return false;

  if (wrapperVideoId !== videoId || state.videoId !== videoId) {
    hiddenTikTokAds.delete(container);
    return true;
  }

  if (container.dataset.fwAdHidden === 'true' || state.remountClaimed) return false;
  state.remountClaimed = true;
  return true;
}

// M94: TikTok hydrates the exact ad marker (`data-e2e="ad-tag"`) in a later
// phase than the card body (same three-phase hydration the FB map documented).
// A card extracted before that phase emits its caption as ORGANIC, and the
// same-container dedup then blocks every re-emission — the ad stays visible
// with no record of the miss (live drive 2026-07-14 11:47, on one sponsored
// video). Remember organic caption emissions keyed on the real
// video id so the periodic rescan can claim ONE sponsored reprocess when the
// marker arrives late on the exact same container + video.
const organicTikTokCaptions = new WeakMap<HTMLElement, string>();

/** Record a caption emitted with NO ad marker present. Real video ids only —
 *  synthetic ids have no stable cross-pass identity to compare against. */
export function rememberTikTokOrganicCaption(container: HTMLElement, videoId: string): void {
  organicTikTokCaptions.set(container, videoId);
}

/**
 * Claim one sponsored reprocess after the exact ad marker hydrated late on a
 * container whose caption was already emitted organic (M94). The claim is
 * one-shot (the entry is consumed) and requires the same real video id — a
 * recycled container carrying a NEW video must not inherit it (that identity
 * problem belongs to the M70/M84 remount family). A root already carrying the
 * applied ad-hide has nothing left to reprocess.
 */
export function claimTikTokLateAdMarker(
  container: HTMLElement,
  videoId: string,
  isSponsored: boolean,
): boolean {
  const rememberedId = organicTikTokCaptions.get(container);
  if (rememberedId === undefined || !isSponsored) return false;
  organicTikTokCaptions.delete(container);
  return rememberedId === videoId && container.dataset.fwAdHidden !== 'true';
}
