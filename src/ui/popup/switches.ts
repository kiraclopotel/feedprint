// FeelingWise: the switch logic both popups share (Receipts and Off).
//
// Two things live here so the two popups cannot drift apart:
//
//   1. The mode switch. Applying a preset overwrites the whole feature grid,
//      so a switch that would undo something the person changed asks first, and
//      leaving Child demands the PIN, where one is set, even inside the grace
//      window. No level demands a PIN to enter (12 Oct 2026: the PIN is a
//      feature, never forced). The pure helpers decide;
//      `useModeSwitch` holds the pending state for the segment row.
//
//   2. Per-platform overrides. A feature can carry `perPlatform[p].enabled`,
//      which the content script honours over the global bit. The popup reads
//      the override for the page it is looking at when it knows the platform,
//      and a flip of the global switch clears that override so the switch
//      never stays shadowed.

import { useCallback, useEffect, useState } from 'react';
import {
  type FWSettings, type FeatureId, type FeatureToggles, type PlatformId,
  applyPreset, getSettings, isFeatureEnabled, parentPinUnknown, saveSettings, updateFeature,
} from '../../storage/settings';
import type { Mode } from '../../types/mode';
import { levelGridKeepingTheirs, presetKeepingOwnList, receiptsFeatures } from '../../storage/switch-scope';
import { detectCoveragePlatform } from './coverage-map';

// ─── Mode switch ───

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
    return false;
  }
  const ak = Object.keys(a as Record<string, unknown>);
  const bk = Object.keys(b as Record<string, unknown>);
  if (ak.length !== bk.length) return false;
  for (const k of ak) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (!deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) {
      return false;
    }
  }
  return true;
}

/**
 * True when switching to `targetMode` would change the current feature grid,
 * that is, applying the preset is destructive to the user's custom toggles.
 * When the grid already equals the target preset, returns false so the UI
 * applies silently with no confirm prompt.
 */
export function modeSwitchResetsToggles(
  currentFeatures: FeatureToggles,
  targetMode: Mode,
): boolean {
  // Only the switches Receipts has count: one stored for a switch now in Off is not a customization
  // anyone can see or undo here. The person's own list does not count either: a level keeps it, so
  // it is never what a switch would reset.
  const target = presetKeepingOwnList(applyPreset(targetMode).features, currentFeatures);
  return !deepEqual(receiptsFeatures(currentFeatures), receiptsFeatures(target));
}

/**
 * Resolve what a click on a mode segment should do:
 *   'noop'    already in that mode.
 *   'confirm' different mode, the person changed a switch of the level they are on (the grid differs from that
 *             level's own preset, the measure the reset link uses), AND the target preset would change the grid.
 *   'apply'   everything else: an untouched level moves in one tap, and so does a grid that already equals the target.
 * The question is about the person's own changes. It used to be asked whenever the target's grid differed from the
 * current one, which asked an untouched install on every move to or from Strict, since swearing is the one switch that
 * differs between the levels (12 Oct 2026).
 */
export function resolveModeClick(
  settings: Pick<FWSettings, 'mode' | 'features'>,
  targetMode: Mode,
): 'noop' | 'apply' | 'confirm' {
  if (settings.mode === targetMode) return 'noop';
  const wouldLoseEdits = modeSwitchResetsToggles(settings.features, settings.mode);
  return wouldLoseEdits && modeSwitchResetsToggles(settings.features, targetMode) ? 'confirm' : 'apply';
}

/**
 * True when a mode click must demand the PIN even inside the 15-minute grace
 * window (D6): leaving Child is a protection downgrade. Entering Child, or a
 * non-child to non-child switch, keeps its current friction. No PIN set means
 * nothing to demand.
 */
export function modeSwitchRequiresPin(
  settings: Pick<FWSettings, 'mode' | 'parentPin' | 'readFailedFallback'>,
  targetMode: Mode,
): boolean {
  // A snapshot that could not be read says parentPin is '' and mode is child,
  // so this returned false and a child leaving Child mode was asked for
  // nothing. "I could not find out whether a PIN exists" is not "no PIN
  // exists" (2026-09-19).
  if (parentPinUnknown(settings)) return settings.mode === 'child' && targetMode !== 'child';
  return settings.mode === 'child' && targetMode !== 'child' && !!settings.parentPin;
}

/**
 * Write the preset for `mode` over the grid. Only the recorder's popup
 * has a preset row; Off's popup has none, so nothing there applies a preset.
 * A preset row added back to Off must come through this machine, or one tap
 * wipes the breaks and the quiet hours without a word. The person's own list
 * of words, phrases and accounts is theirs and is never reset by a level.
 */
async function applyModePreset(mode: Mode): Promise<void> {
  const patch = applyPreset(mode);
  // A level sets Receipts' own switches; what the install stored for Off's switches, and the person's own list, is left as it was.
  const stored = (await getSettings()).features;
  await saveSettings({ mode, levelChosen: true, features: levelGridKeepingTheirs(patch.features, stored), presets: patch.presets });
}

export interface ModeSwitchState {
  /** A switch (or a reset to the current mode's defaults) waiting for the user's yes. */
  pendingMode: Mode | null;
  /** True when `pendingMode` is the current mode: a reset to defaults, not a switch. */
  pendingIsReset: boolean;
  /** A click that must pass the PIN first. */
  pinForMode: Mode | null;
  onModeClick: (m: Mode) => void;
  /** "Reset to defaults": asks the same confirm as the segments before applying. */
  requestReset: () => void;
  confirmPending: () => void;
  cancelPending: () => void;
  onPinSuccess: () => void;
  onPinCancel: () => void;
}

/**
 * The state machine behind the mode segments: confirm when the switch would
 * reset toggles, PIN when it leaves Child, apply otherwise. `onApplied` runs
 * after the write (the popups reload their settings there).
 */
export function useModeSwitch(
  settings: Pick<FWSettings, 'mode' | 'features' | 'parentPin'>,
  onApplied: () => Promise<void>,
): ModeSwitchState {
  const [pendingMode, setPendingMode] = useState<Mode | null>(null);
  const [pinForMode, setPinForMode] = useState<Mode | null>(null);

  const applyNow = useCallback(async (m: Mode) => {
    await applyModePreset(m);
    setPendingMode(null);
    await onApplied();
  }, [onApplied]);

  const resume = useCallback((m: Mode) => {
    const action = resolveModeClick(settings, m);
    if (action === 'noop') return;
    if (action === 'confirm') { setPendingMode(m); return; }
    void applyNow(m);
  }, [settings, applyNow]);

  const onModeClick = useCallback((m: Mode) => {
    // Any click replaces (or, on the current mode, cancels) a stale prompt.
    setPendingMode(null);
    setPinForMode(null);
    if (modeSwitchRequiresPin(settings, m)) { setPinForMode(m); return; }
    resume(m);
  }, [settings, resume]);

  const requestReset = useCallback(() => {
    setPinForMode(null);
    if (!modeSwitchResetsToggles(settings.features, settings.mode)) return;
    setPendingMode(settings.mode);
  }, [settings]);

  return {
    pendingMode,
    pendingIsReset: pendingMode !== null && pendingMode === settings.mode,
    pinForMode,
    onModeClick,
    requestReset,
    confirmPending: () => { if (pendingMode !== null) void applyNow(pendingMode); },
    cancelPending: () => setPendingMode(null),
    onPinSuccess: () => { const m = pinForMode; setPinForMode(null); if (m !== null) resume(m); },
    onPinCancel: () => setPinForMode(null),
  };
}

// ─── Per-platform overrides ───

/** The platforms whose `perPlatform[p].enabled` override shadows the global switch. */
export function overriddenPlatforms(settings: FWSettings, id: FeatureId): PlatformId[] {
  const pp = settings.features?.[id]?.perPlatform;
  if (!pp) return [];
  return (Object.keys(pp) as PlatformId[]).filter(p => pp[p]?.enabled !== undefined);
}

/**
 * What the switch should show: the override for `platform` when the popup
 * knows which page it is looking at, else the global bit.
 */
export function switchIsOn(settings: FWSettings, id: FeatureId, platform: PlatformId | null | undefined): boolean {
  return isFeatureEnabled(settings, id, platform ?? undefined);
}

/**
 * Flip the global switch and clear the override that would shadow it: the
 * one for `platform` when known, every enabled override when the popup
 * cannot tell which page it is on. `value` overrides are kept.
 */
export async function flipSwitch(
  settings: FWSettings,
  id: FeatureId,
  platform: PlatformId | null | undefined,
): Promise<void> {
  const next = !switchIsOn(settings, id, platform);
  await updateFeature(id, cur => {
    const pp = { ...(cur.perPlatform ?? {}) };
    const targets = platform ? [platform] : (Object.keys(pp) as PlatformId[]);
    for (const p of targets) {
      const entry = pp[p];
      if (!entry || entry.enabled === undefined) continue;
      const rest = { ...entry };
      delete rest.enabled;
      if (Object.keys(rest).length === 0) delete pp[p];
      else pp[p] = rest;
    }
    const out = { ...cur, enabled: next };
    if (Object.keys(pp).length > 0) out.perPlatform = pp;
    else delete out.perPlatform;
    return out;
  });
}

/** The platform of a tab URL, or null when it is not a supported site. */
function platformOfUrl(url: string | undefined): PlatformId | null {
  if (!url) return null;
  try {
    return detectCoveragePlatform(new URL(url).hostname);
  } catch {
    return null;
  }
}

/**
 * The platform of the page the popup is looking at. `undefined` while the
 * lookup runs or when there is no way to know; `null` when the page is not a
 * supported site. The detached window asks for the last focused normal
 * browser window, since its own active tab is the popup itself.
 */
export function useCurrentPlatform(detached = false): PlatformId | null | undefined {
  const [platform, setPlatform] = useState<PlatformId | null | undefined>(undefined);
  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.tabs?.query) return;
    let cancelled = false;
    (async () => {
      let tab: chrome.tabs.Tab | undefined;
      if (!detached) {
        tab = (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
      } else {
        const win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
        if (win?.id !== undefined) tab = (await chrome.tabs.query({ active: true, windowId: win.id }))[0];
      }
      if (!cancelled) setPlatform(platformOfUrl(tab?.url));
    })().catch(() => { if (!cancelled) setPlatform(undefined); });
    return () => { cancelled = true; };
  }, [detached]);
  return platform;
}
