// FeelingWise - User settings (chrome.storage.local)

import { Mode } from '../types/mode';
import type { PlatformId } from '../types/platform-id';
import type { FeatureId, FeatureToggle } from '../types/feature-id';
import type { FeatureToggles } from '../types/feature-toggles';
import { sha256, pbkdf2Hex, randomSaltHex, timingSafeEqual } from '../forensics/hasher';
import { PBKDF2_ITERATIONS } from '../forensics/key-wrap';
import { childPreset, teenPreset, presetForMode, offStartPreset } from './presets';
import { isContextAlive, isContextError, markContextInvalidated } from './context-guard';
import { GROQ_BLENDED_RATE_PER_1M_USD } from './usage-weights';
import { isOffProduct } from '../product';
import { coerceLegacyMode, SURFACE_FEATURE_IDS, ALL_FEATURE_IDS } from './settings-shape';
import type { DashboardTheme, PopupLook, PresetAudit, BlockActionsPlatforms, VideoControls, FWSettings, PickedBlock, ReadCounts, ReadToday } from './settings-shape';
import { migrateSettings } from './settings-migrations';
import { getLocalWithRetry } from './local-read';

// The shape and the migrations moved to their own files (PLAN-2026-09-16 item 10.3). Every name
// they used to export is re-exported here, so no file that reads settings had to change.
export { coerceLegacyMode, SURFACE_FEATURE_IDS, ALL_FEATURE_IDS };
export type { DashboardTheme, PopupLook, PresetAudit, BlockActionsPlatforms, VideoControls, FWSettings, PickedBlock, ReadCounts, ReadToday };
export { migrateSettings } from './settings-migrations';
import type { UsageIncrement, AiCallUsage } from '../types/usage';

/**
 * UTC-day boundary helper. Returns 'YYYY-MM-DD' in UTC. Used by
 * `getSettings()` to gate the daily-counter reset. Local `toDateString()`
 * would let timezone changes (travel, DST) trigger spurious resets
 * mid-day. Exported for unit testing.
 */
export function utcDayKey(d: Date = new Date()): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/**
 * UTC-month boundary helper. Returns 'YYYY-MM' in UTC. Used by
 * `getSettings()` to gate the monthly-counter reset for the
 * tier-monthly-cap feature. Same UTC-monotonicity reasoning as
 * utcDayKey: timezone changes don't trigger spurious mid-month resets.
 * Exported for unit testing.
 */
export function utcMonthKey(d: Date = new Date()): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Rollback-safe settings migrations.
 *
 * This version field is persisted alongside user settings so that any future
 * shape change (renamed key, restructured sub-object, new required field)
 * can run a one-shot migration on read and then bump the stored version.
 *
 * Rules for bumping:
 *   • Only bump when FWSettings' shape *actually* changes in a way that would
 *     trip the getSettings() read path for existing users.
 *   • Every bump MUST have a corresponding branch in `migrateSettings()`.
 *   • Never remove a historical migration branch — older installs may still
 *     read stale data from chrome.storage.local after a pause of weeks/months.
 *
 * Versions:
 *   v1: baseline (cost fields stored as USD cents).
 *   v2: cost fields normalized to USD dollars (migration divides by 100).
 *   v3: `features` (FeatureToggles) + `presets` audit field added. Modes
 *       become presets-as-initial-config: v2 installs seed their `features`
 *       from the preset matching their stored `mode`, and any legacy
 *       videoControls fields with clear v3 equivalents are mapped across.
 *       `mode` stays in FWSettings as the forensic `userAgeCategory` tag;
 *       enforcement code uses `isFeatureEnabled(settings, id, pid?)`.
 *   v4..v11: see the concrete migration branches in `migrateSettings`
 *       below — this list stops narrating them one by one; the branches
 *       are the source of truth.
 * Prior to any versioning, settings were schemaless; absence of the key on
 * read is treated as "legacy, pre-versioning" and migrated to current.
 */
export const CURRENT_SETTINGS_SCHEMA_VERSION = '14';

// `DEFAULT_AI_BLOCKLIST_HASHTAGS` and `BlockAiContentValue` live in
// `./block-ai-defaults` to avoid the circular import that would otherwise
// form between settings.ts and presets.ts. Re-exported here so downstream
// consumers (SettingsSurface.tsx, ai-content-blocker.ts) keep a single
// import path.
export { DEFAULT_AI_BLOCKLIST_HASHTAGS } from './block-ai-defaults';
export type { BlockAiContentValue } from './block-ai-defaults';



const SETTINGS_KEYS: (keyof FWSettings)[] = [
  'settingsSchemaVersion',
  'mode', 'strictLanguage', 'hideUnrewritable',
  'parentPin', 'setupDone', 'levelChosen', 'dailyCap', 'monthlyUsdCapOverride', 'locale', 'outputLanguage', 'uiLanguage',
  'aiAnalysisEnabled',
  'totalChecksToday', 'totalNeutralizedToday', 'totalTokensToday', 'estimatedCostToday', 'lastResetDate',
  'totalChecksThisMonth', 'totalTokensThisMonth', 'lastResetMonth',
  'totalTokensAllTime', 'totalChecksAllTime', 'totalNeutralizedAllTime', 'estimatedCostAllTime',
  // Feature-composable grid.
  'features', 'presets',
  // Appearance: the theme and the popup's style.
  'dashboardTheme', 'popupLook',
  // Engagement-hide counter.
  'metricsHiddenToday', 'metricsHiddenAllTime', 'hiddenByFeature',
  // What was read today (B10-1).
  'readToday',
  // Off's "block this" picks.
  'pickedBlocks',
];

const DEFAULTS: FWSettings = {
  settingsSchemaVersion: CURRENT_SETTINGS_SCHEMA_VERSION,
  // Teen is the broader-age fresh-install default. Setup can apply Child,
  // Teen, or Adult presets explicitly.
  mode: 'teen',
  strictLanguage: false,
  hideUnrewritable: false,
  parentPin: '',
  setupDone: false,
  // null = use the tier default from `license.MONTHLY_USD_CAP_BY_TIER`.
  // Parent can override via the dashboard cap settings.
  monthlyUsdCapOverride: null,
  // 2000 caps worst-case daily spend at ~$0.20/day on the current model while not
  // blocking ordinary use. A single content-heavy permalink page can
  // consume ~150 comment scans on top of the main post; 500 was sized
  // for casual feed-scrolling on the assumption comments stayed in the
  // comment-batch path, but at the per-comment-record detection rate
  // that figure caps a single status-page session in minutes. Users can
  // still dial it down from settings. (Lowered 2500->2000 on 2026-05-31
  // for solvency margin; matches the tier ceiling in license.ts.)
  dailyCap: 2000,
  locale: 'en',
  // Default 'auto' = Phase 1c detection (match input language). Parent picks
  // a specific ISO code in the popup to force every FW output into that
  // language regardless of input.
  outputLanguage: 'auto',
  // Interface language: 'auto' follows the browser, so a Romanian-locale
  // browser gets a Romanian UI with zero configuration.
  uiLanguage: 'auto',
  // Master AI breaker defaults ON: AI analysis is the product's core value;
  // the breaker exists so turning it OFF provably stops all spend.
  aiAnalysisEnabled: true,
  totalChecksToday: 0,
  totalNeutralizedToday: 0,
  totalTokensToday: 0,
  estimatedCostToday: 0,
  // UTC-day key, not local toDateString. See utcDayKey() helper.
  lastResetDate: '',
  // UTC-month key for tier-monthly-cap enforcement. See utcMonthKey()
  // helper. Empty-string sentinel triggers reset on first getSettings()
  // call after install.
  totalChecksThisMonth: 0,
  totalTokensThisMonth: 0,
  lastResetMonth: '',
  totalTokensAllTime: 0,
  totalChecksAllTime: 0,
  totalNeutralizedAllTime: 0,
  estimatedCostAllTime: 0,
  // lastResetDate uses utcDayKey() format. Initial value is set below in the
  // post-DEFAULTS block to keep the constant declaration pure.
  // Fresh installs default to Teen preset. `appliedAt` stays blank until
  // first explicit apply-preset or a v2 → v3 migration stamps it.
  features: teenPreset(),
  presets: {
    appliedAt: '',
    appliedPreset: 'teen',
  },
  // Default 'dark' matches pre-v10 hardcoded look. Parent toggles in the
  // dashboard header; 'system' tracks OS preference at mount.
  dashboardTheme: 'dark',
  // Look A, the one every install had before the choice existed.
  popupLook: 'a',
};

// The keys a person's choice about what is hidden is stored under. While none of them is stored,
// an Off install reads its start set instead of Teen. Once any one is, the read is exactly what it
// was before the start set existed, so an update never changes a saved setting. Off has no
// background page and writes nothing at install, so "nothing chosen yet" is the only sign of a new
// install it has.
const CHOICE_KEYS = ['mode', 'features', 'strictLanguage'] as const;

function nothingChosenYet(stored: Record<string, unknown>): boolean {
  return CHOICE_KEYS.every(k => stored[k] === undefined);
}

/** What Off hides before its person has chosen anything: the listing's promise (presets.ts). */
export function offStartSettings(): Pick<FWSettings, 'mode' | 'features' | 'strictLanguage' | 'presets'> {
  return {
    // Adult is the lightest base for a switch added later (the read seeds a missing one from the
    // mode's preset), and unlike Child it neither forces swearing nor asks for the PIN to leave.
    mode: 'adult',
    features: offStartPreset(),
    strictLanguage: true,
    presets: { appliedAt: '', appliedPreset: 'adult' },
  };
}

/**
 * The first choice on an Off install stores the start set with it. Without this, one switch
 * flipped would store only itself, and the next read would fall back to Teen for everything else.
 */
async function withStartSetOnFirstChoice(partial: Partial<FWSettings>): Promise<Partial<FWSettings>> {
  if (!isOffProduct() || !CHOICE_KEYS.some(k => k in partial)) return partial;
  const stored = await chrome.storage.local.get([...CHOICE_KEYS]);
  return nothingChosenYet(stored) ? { ...offStartSettings(), ...partial } : partial;
}

let _settingsCache: FWSettings | null = null;
// Timestamp of the last successful storage read that populated `_settingsCache`.
// The getSettings() happy path returns the cache without a storage round-trip
// while `Date.now() - _settingsCacheTimestamp < SETTINGS_CACHE_TTL_MS`. Mirrors
// the proven feature-flags.ts TTL cache. 5s = the same bounded-staleness window.
let _settingsCacheTimestamp = 0;
const SETTINGS_CACHE_TTL_MS = 5_000;

// Drop the fast-path cache. Called by every SETTINGS_KEYS writer in THIS realm
// (saveSettings + the counter/pin writers below) so a same-realm
// `await save…(); await getSettings()` reflects the write immediately — the
// chrome.storage.onChanged listener also clears the cache, but it fires on a
// LATER task, so the local write path cannot rely on it for read-after-write
// correctness within the TTL window.
function invalidateSettingsCache(): void {
  _settingsCache = null;
  _settingsCacheTimestamp = 0;
}

// Module-level cache must invalidate when ANY SETTINGS_KEYS field changes
// in chrome.storage.local. Without this, popup edits (parent toggling a
// feature) write through to storage but the content script's next
// getSettings() call returns the stale cached value — toggle silently
// ignored until something else clears the cache. The listener below
// closes the stale-read window (cross-realm: fires in every realm on any
// realm's write). Guard for non-extension contexts (vitest, dashboard
// reachable in some tests) via typeof check.
if (typeof chrome !== 'undefined' && chrome?.storage?.onChanged?.addListener) {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    for (const key of SETTINGS_KEYS) {
      if (key in changes) {
        invalidateSettingsCache();
        return;
      }
    }
  });
}

export async function getSettings(): Promise<FWSettings> {
  // Orphaned content script after an extension reload: chrome.storage throws
  // "Extension context invalidated" on every read. Short-circuit to the last
  // good snapshot (or strongest protection) so the read loop can't flood the
  // console — a tab refresh re-injects a live content script.
  if (!isContextAlive()) {
    return _settingsCache ?? { ...DEFAULTS, mode: 'child', features: childPreset(), readFailedFallback: true };
  }
  // Fast path: return the cached, fully-migrated snapshot when it is still
  // fresh, skipping the chrome.storage round-trip + full migration re-run that
  // ~47 call sites (13 in content/index.ts alone) would otherwise pay on every
  // call. Mirrors feature-flags.ts's TTL cache. Callers must treat the result
  // as read-only (same object reference is returned on a hit — same contract as
  // getFeatureFlags). Bounded staleness = SETTINGS_CACHE_TTL_MS; any write drops
  // the cache (this realm via invalidateSettingsCache; other realms via the
  // onChanged listener), so a genuine change is never masked beyond that window.
  // Sits AFTER the isContextAlive() guard and BEFORE the try, so every
  // error/fail-closed path below is unchanged.
  const now = Date.now();
  if (_settingsCache && now - _settingsCacheTimestamp < SETTINGS_CACHE_TTL_MS) {
    return _settingsCache;
  }
  // This read goes through local-read.ts's getLocalWithRetry, like every other
  // chrome.storage.local reader here. It did not until 2026-09-19: the helper's
  // key parameter was typed for one name and this is the one reader that fetches
  // a list (SETTINGS_KEYS plus 'videoControls'), so a single transient rejection
  // (documented there as happening under concurrent storage I/O) fell straight to
  // the fail-closed snapshot below instead of getting the bounded retry that
  // absorbs the blip everywhere else.
  //
  // The note left here said the write-side guard closed "the actual corruption",
  // meaning a counter written from an unconfirmed snapshot. It did, and it was
  // not the only consequence. That snapshot is DEFAULTS with a child grid, and
  // DEFAULTS carries `parentPin: ''`, so a blip at popup-open time handed every
  // parent-PIN gate the belief that no PIN had ever been set. The helper's body
  // always accepted a list; only its type refused, so the fix was one word.
  try {
    const result = await getLocalWithRetry([...SETTINGS_KEYS, 'videoControls']);
    const settings: FWSettings = { ...DEFAULTS };
    for (const key of SETTINGS_KEYS) {
      if (result[key] !== undefined) {
        (settings as unknown as Record<string, unknown>)[key] = result[key];
      }
    }
    if (isOffProduct() && nothingChosenYet(result)) Object.assign(settings, offStartSettings());

    // Attach the raw legacy videoControls blob (untyped) so the v2 -> v3
    // migration can still map ancient installs; it never reaches the typed
    // return value (dropped again right after migration).
    if (result.videoControls !== undefined) {
      (settings as unknown as Record<string, unknown>).videoControls = result.videoControls;
    }
    // Versioned migrations.
    const migrated = migrateSettings(settings);
    Object.assign(settings, migrated.settings);
    delete (settings as unknown as Record<string, unknown>).videoControls;
    // A stored mode this build does not know (damaged, foreign, or from a later build) reads as
    // Moderate, the one written fallback (coerceLegacyMode, DEC-015). It used to be copied as it
    // came, and levelOf() turns anything that is not child or teen into Relaxed, the loosest level.
    // Only what is read is narrowed: the stored value is not rewritten (the ids stay).
    settings.mode = coerceLegacyMode(settings.mode);
    if (migrated.didMigrate) {
      try {
        // Persist the fields a migration may have set. The v2→v3 migration
        // populates `features` + `presets` (and cost counters); the seed is
        // expensive to recompute correctly if the install edits before this
        // write catches up. Only the fields actually written by migrations
        // are included here — not every field in the settings object.
        await chrome.storage.local.set({
          settingsSchemaVersion: settings.settingsSchemaVersion,
          features: settings.features,
          presets: settings.presets,
          estimatedCostToday: settings.estimatedCostToday,
          estimatedCostAllTime: settings.estimatedCostAllTime,
        });
        // v13 -> v14: drop the removed media-understanding flags from storage
        // rather than leaving an orphaned `true` behind.
        if (migrated.fromVersion !== '14') {
          await chrome.storage.local.remove(['videoUnderstanding', 'imageUnderstanding']);
        }
      } catch {
        // Migration write failed — keep the in-memory migrated value; it
        // will retry on next boot.
      }
    }

    // Defensive feature seeding for installs whose `features` blob
    // predates a feature that was added later. We do NOT bump
    // settingsSchemaVersion for additive features — bumping would re-run
    // the v3→v4 force-reseed which overwrites the parent's customized
    // toggles. Instead, every read fills in any feature id present in
    // `ALL_FEATURE_IDS` but missing from `settings.features`, pulling
    // defaults from the preset that matches the install's mode. Existing
    // toggles are preserved; only the gaps get seeded.
     // An install that saved its settings before the schema version was ever
    // stamped on save (every 2.3.0 install, seen on the 2026-09-03 update
    // gate) reads as current above, because DEFAULTS carry the version, so
    // the migration chain has nothing to key on. Stamp it once, so a later
    // migration can. Nothing else changes: the blob is read as it always was.
    if (result.settingsSchemaVersion === undefined && result.features !== undefined) {
      try {
        await chrome.storage.local.set({ settingsSchemaVersion: settings.settingsSchemaVersion });
      } catch {
        // A realm without storage write access reads fine and stamps next time.
      }
    }
   if (settings.features && typeof settings.features === 'object') {
      const presetDefaults: FeatureToggles = presetForMode(settings.mode);
      for (const id of ALL_FEATURE_IDS) {
        if (!settings.features[id]) {
          settings.features[id] = presetDefaults[id];
        }
      }
    }

    // Reset daily counters if new day, using UTC-day boundary instead of
    // local toDateString(). Local-time day boundaries cause spurious
    // resets when the user crosses a timezone (international travel, DST
    // clock-forward) — counters could reset mid-flight. UTC is monotonic
    // per-install and matches forensic timestamps. The visible reset
    // moment shifts by the user's UTC offset.
    const today = utcDayKey(new Date());
    if (settings.lastResetDate !== today) {
      settings.totalChecksToday = 0;
      settings.totalNeutralizedToday = 0;
      settings.totalTokensToday = 0;
      settings.estimatedCostToday = 0;
      settings.metricsHiddenToday = 0;
      // Yesterday's read count is replaced, not kept. Only where one exists: an install that has
      // never counted (Off keeps none) gains no new stored key from a day rollover.
      const readReset: Partial<FWSettings> = settings.readToday ? { readToday: { date: today } } : {};
      if (settings.readToday) settings.readToday = { date: today };
      settings.lastResetDate = today;
      try {
        await chrome.storage.local.set({
          totalChecksToday: 0,
          totalNeutralizedToday: 0,
          totalTokensToday: 0,
          estimatedCostToday: 0,
          metricsHiddenToday: 0,
          ...readReset,
          lastResetDate: today,
        });
      } catch {
        // Daily reset write failed — continue with in-memory reset values
      }
    }

    // UTC-month rollover for tier-monthly-cap counter. Independent from
    // daily reset — checked separately so a month-flip on the same
    // day-key still triggers monthly reset (rare but possible at month
    // boundaries that fall on the same UTC date as daily reset).
    const thisMonth = utcMonthKey(new Date());
    if (settings.lastResetMonth !== thisMonth) {
      settings.totalChecksThisMonth = 0;
      settings.totalTokensThisMonth = 0;
      settings.lastResetMonth = thisMonth;
      try {
        await chrome.storage.local.set({
          totalChecksThisMonth: 0,
          totalTokensThisMonth: 0,
          lastResetMonth: thisMonth,
        });
      } catch {
        // Monthly reset write failed — continue with in-memory reset values
      }
    }

    _settingsCache = settings;
    _settingsCacheTimestamp = Date.now();
    return settings;
  } catch (err) {
    // A dead context (extension reload orphaned this content script) is the
    // graceful-shutdown case: flag it once (markContextInvalidated logs the
    // refresh hint) and fail closed silently so the read loop can't flood.
    if (isContextError(err)) {
      markContextInvalidated();
      if (_settingsCache) return _settingsCache;
      return { ...DEFAULTS, mode: 'child', features: childPreset(), readFailedFallback: true };
    }
    // Name the error so a persistent storage failure isn't invisible — the
    // fallback below is correct (fail closed) but a silent catch hid the cause
    // when getSettings kept returning Child mode without an obvious reason.
    console.error('[FeelingWise] getSettings read failed — failing closed:', err);
    // FAIL CLOSED (regression C-2). A read error must not silently downgrade
    // protection. If we have a prior good snapshot, reuse it; otherwise return
    // the STRONGEST protection (Child mode + child feature grid), never the
    // lighter teen DEFAULTS. The parent's real settings are restored on the
    // next successful read — this only governs the transient-error window.
    if (_settingsCache) return _settingsCache;
    return { ...DEFAULTS, mode: 'child', features: childPreset(), readFailedFallback: true };
  }
}

/**
 * Settings provenance for chain-writing paths (wiring Q24).
 *
 * Every marker writer (reset, rotation, manual-flag, prune) stamps
 * `userAgeCategory` from the active settings. On the fail-closed path
 * getSettings() returns a SYNTHETIC child snapshot, so a marker written
 * during a storage outage on an adult install would permanently attest
 * 'child' inside a hashed, signed payload. This seam is the single way a
 * chain writer may read settings: it surfaces `readFailed` so the writer
 * can name the fail-closed state in its hashed content instead of silently
 * attesting a mode nobody set. Per-post emit sites already do this via
 * buildConfigSnapshot; this covers the marker writers that were missed.
 */
export interface AttestationSettings {
  mode: Mode;
  /** True when the snapshot is the synthetic fail-closed fallback. */
  readFailed: boolean;
}

export async function getSettingsForAttestation(): Promise<AttestationSettings> {
  const s = await getSettings();
  return { mode: s.mode, readFailed: s.readFailedFallback === true };
}

/**
 * True when this snapshot cannot say whether a parent PIN exists.
 *
 * The fail-closed fallback is `{...DEFAULTS, mode:'child', features:childPreset()}`,
 * and it fails closed on exactly the two things it names. `parentPin` is not one
 * of them: it comes from DEFAULTS, where it is the empty string. So the snapshot
 * a read failure produces says "no PIN has ever been set", which every gate in
 * the product reads as "there is nothing to protect, let them through" (found
 * 2026-09-19).
 *
 * The read itself now retries, which is the root fix, and three attempts can
 * still all fail. A gate must not turn "I could not find out" into "there is no
 * PIN". Every caller treats true as locked: demand the PIN, or refuse the act
 * and say the settings could not be read. That is recoverable, because the next
 * read succeeds; an opened gate is not.
 */
export function parentPinUnknown(settings: Pick<FWSettings, 'readFailedFallback'>): boolean {
  return settings.readFailedFallback === true;
}

/**
 * A fresh install starts with its level not chosen, written down so it waits for one. Nothing else
 * writes false: an install that was already running (an update, a browser update) has no value and
 * keeps the level it had, as does every snapshot built without this event.
 */
export async function noteLevelChosenOnInstall(reason: string): Promise<void> {
  if (reason === 'install') await saveSettings({ levelChosen: false });
}

export async function saveSettings(partial: Partial<FWSettings>): Promise<void> {
  await chrome.storage.local.set(await withStartSetOnFirstChoice(partial));
  // Drop this realm's fast-path cache so the next getSettings() reflects the
  // write immediately (onChanged fires only on a later task). Mirrors
  // feature-flags.ts setFeatureFlag's local invalidation.
  invalidateSettingsCache();
}

/**
 * Cross-window-safe single-feature update (POP-2 lost-update fix).
 *
 * The popup can detach into a persistent second window, so two FW surfaces may
 * be open at once, each holding its own in-memory `settings` snapshot. The
 * per-feature toggle handlers used to build `{ ...settings.features, [id]: … }`
 * from that (possibly stale) snapshot and write the WHOLE `features` blob. Since
 * `features` is a single storage key, the later write silently reverted whatever
 * the OTHER window had toggled in the meantime — a durable lost update bounded
 * only by "both surfaces stay open" (exactly the detach feature's use case).
 *
 * This helper eliminates the staleness: it reads the CURRENT `features` blob
 * straight from storage (NOT the TTL-cached getSettings snapshot, and NOT a
 * React-closure snapshot), applies the caller's `update` to ONLY the one changed
 * feature id, and writes the merged blob back. A concurrent change to a DIFFERENT
 * feature in another window survives because it is preserved untouched in the
 * freshly-read base. The caller computes the intended absolute value(s) for the
 * feature it is changing (honoring the user's click), and `update` receives the
 * fresh config for that id so nested state (value / other perPlatform entries)
 * is not dropped.
 */
export async function updateFeature(
  id: FeatureId,
  update: (current: FeatureToggle) => FeatureToggle,
): Promise<void> {
  let base: FeatureToggles;
  // No catch around the read: if chrome.storage cannot be read (dead context
  // after an extension reload), the toggle write is ABORTED by the rethrow.
  // The old fallback synthesized a Teen-preset base and persisted it, which
  // silently reset a Child install's whole grid to Teen strength on one
  // failed read while every forensic record kept saying 'child' (laydown
  // 2026-08-04, D1). A failed click that does nothing is recoverable; a
  // persisted wrong grid is invisible. Callers await this inside toggle
  // handlers whose UI refresh only runs after success, so the visible state
  // stays truthful on abort.
  const result = await chrome.storage.local.get([...CHOICE_KEYS]);
  if (result.features && typeof result.features === 'object') {
    base = { ...(result.features as FeatureToggles) };
  } else if (isOffProduct() && nothingChosenYet(result)) {
    base = offStartPreset();
  } else {
    // Storage has no features blob yet (fresh install pre-first-save): seed a
    // COMPLETE base from the stored mode's preset so we never write a blob
    // that is missing every other feature's defaults.
    base = presetForMode(coerceLegacyMode(result.mode));
  }
  const current: FeatureToggle = base[id] ?? { enabled: false };
  base[id] = update(current);
  await saveSettings({ features: base });
}

/**
 * Full-state reset support. Zeroes the usage counters (daily + all-time)
 * so the popup's "scanned today / fixed today / spent today" tiles drop
 * to zero alongside the Chain A wipe. Called by `resetForensicChain`.
 *
 * Deliberately does NOT touch:
 *   • Configuration (mode, locale, daily cap, parentPin).
 *   • Feature toggles + presets.
 * Reset is "wipe what FW HAS DONE", not "factory reset what the parent SET".
 * If the user wants to nuke their config they uninstall + reinstall.
 *
 * `lastResetDate` is set to today's UTC day key so the daily-rollover
 * hook doesn't immediately re-zero on the next read (which would be a
 * no-op but generates a write). A failure rejects, so the reset can tell the
 * parent the counters were not cleared; the reset settles each clear on its own.
 */
export async function resetUsageStats(): Promise<void> {
  try {
    if (typeof chrome === 'undefined' || !chrome?.storage?.local) return;
    await chrome.storage.local.set({
      totalChecksToday: 0,
      totalNeutralizedToday: 0,
      totalTokensToday: 0,
      estimatedCostToday: 0,
      // Also clear the monthly counter on full-state reset. Same reasoning
      // as the daily counters: full-state reset is "wipe what FW HAS DONE"
      // and the monthly cap is part of "what's been done."
      totalChecksThisMonth: 0,
      totalTokensThisMonth: 0,
      lastResetMonth: utcMonthKey(),
      totalChecksAllTime: 0,
      totalNeutralizedAllTime: 0,
      totalTokensAllTime: 0,
      estimatedCostAllTime: 0,
      lastResetDate: utcDayKey(),
      // The engagement-hider counters are part of DONE-work the same as
      // checks. Clear both Today and All-time on full reset.
      metricsHiddenToday: 0,
      metricsHiddenAllTime: 0,
      hiddenByFeature: {},
    } satisfies Partial<FWSettings>);
    // What was read today is part of what the product has done: cleared with the rest (B10-1). Removed,
    // not zeroed, so a reset leaves no key behind. The chained call is for a host whose storage has no
    // remove (a bare test double); a browser always has one.
    await chrome.storage.local.remove?.('readToday');
    // Also clear the toolbar badge counter. The badge is set imperatively
    // by the service worker on every NEUTRALIZATION_COMPLETE message and
    // is never re-evaluated against storage, so without this clear the
    // last-set value persists on the toolbar after a reset. The
    // chrome.action API is available in the dashboard's extension context
    // (popup, dashboard, service worker) — calling it from here keeps the
    // reset path self-contained without a round-trip through messaging.
    try {
      void chrome.action?.setBadgeText?.({ text: '' });
    } catch {
      // chrome.action unavailable (e.g., MV2 fallback path or test env) — silent.
    }
    // Refresh the in-memory cache so the next getSettings() returns zeros
    // without waiting for the chrome.storage.local round-trip.
    if (_settingsCache) {
      _settingsCache = {
        ..._settingsCache,
        totalChecksToday: 0,
        totalNeutralizedToday: 0,
        totalTokensToday: 0,
        estimatedCostToday: 0,
        totalChecksThisMonth: 0,
        totalTokensThisMonth: 0,
        lastResetMonth: utcMonthKey(),
        totalChecksAllTime: 0,
        totalNeutralizedAllTime: 0,
        totalTokensAllTime: 0,
        estimatedCostAllTime: 0,
        lastResetDate: utcDayKey(),
        // Keep the in-memory cache in sync with storage.
        metricsHiddenToday: 0,
        metricsHiddenAllTime: 0,
        readToday: undefined,
      };
      // Re-stamp so the freshly-patched cache is served (not treated as expired)
      // on the next read within the TTL window.
      _settingsCacheTimestamp = Date.now();
    }
  } catch (err) {
    console.warn('[FeelingWise] resetUsageStats failed:', err);
    throw err;
  }
}

// Usage counters: the service worker is the single writer.
//
// Every counter below (checks, neutralized, metrics hidden, tokens) is a
// read-modify-write on chrome.storage.local. Serialising the calls inside
// one realm (the chain below) stopped the per-paint lost updates, but
// `chrome.storage` is shared across every tab, so two tabs incrementing at
// the same instant still lost one, and at a UTC rollover a realm whose 5 s
// cache still held yesterday's snapshot wrote yesterday's count plus one
// into the new period (STORAGE-LICENCE-WORKER-7). Web Locks cannot close
// that: content scripts hold the page's origin.
//
// So content scripts, the popup and the dashboard no longer write counters.
// They send USAGE_INCREMENT to the service worker, which applies the
// increment here (applyUsageIncrement) behind one realm-wide chain and
// re-reads storage whenever its snapshot's period keys are behind the
// clock, so the write is always against the current period. The worker
// acks {ok} or {ok:false,error}; a sender logs a lost increment once per
// reason and carries on (the proxy cap is the hard stop, not this count).
//
// Realm rule: a realm with no `document` (the MV3 worker, or a plain node
// test host) applies locally; a realm with a document routes by message.
// A realm with a document but no runtime messaging (a bare test page)
// applies locally too, so the serialisation tests exercise the real write.
//
// A failed local write must not stop later increments, so the stored chain
// swallows rejections while the promise handed back to the caller still
// rejects.



/** True when this realm owns the counter write (service worker, or a host with no document). */
export function isCounterWriterRealm(): boolean {
  return typeof document === 'undefined';
}

function canRouteCounterByMessage(): boolean {
  return (
    typeof chrome !== 'undefined' &&
    typeof chrome.runtime?.sendMessage === 'function'
  );
}

let _counterWriteChain: Promise<void> = Promise.resolve();

function serializeCounterWrite(apply: () => Promise<void>): Promise<void> {
  const next = _counterWriteChain.then(apply, apply);
  _counterWriteChain = next.then(
    () => { /* chain continues */ },
    () => { /* and continues after a failure too */ },
  );
  return next;
}

/**
 * Settings snapshot whose period keys match the clock. getSettings() serves
 * a 5 s cache; across a UTC day or month boundary that cache can still hold
 * the previous period, and an increment computed from it would carry the
 * old count into the new period. When the keys are behind, drop the cache
 * and read again: the fresh read runs the reset block against storage.
 */
async function settingsForCounterWrite(now: Date = new Date()): Promise<FWSettings> {
  let settings = await getSettings();
  if (settings.lastResetDate !== utcDayKey(now) || settings.lastResetMonth !== utcMonthKey(now)) {
    invalidateSettingsCache();
    settings = await getSettings();
  }
  return settings;
}

function counterPatch(settings: FWSettings, increment: UsageIncrement): Partial<FWSettings> {
  switch (increment.kind) {
    case 'neutralized':
      return {
        totalNeutralizedToday: settings.totalNeutralizedToday + 1,
        totalNeutralizedAllTime: settings.totalNeutralizedAllTime + 1,
      };
    case 'metrics-hidden': {
      const byFeature = { ...(settings.hiddenByFeature ?? {}) };
      for (const [feature, n] of Object.entries(increment.byFeature ?? {})) {
        if (n > 0) byFeature[feature] = (byFeature[feature] ?? 0) + n;
      }
      return {
        metricsHiddenToday: (settings.metricsHiddenToday ?? 0) + increment.by,
        metricsHiddenAllTime: (settings.metricsHiddenAllTime ?? 0) + increment.by,
        hiddenByFeature: byFeature,
      };
    }
    case 'items-read': {
      // Today's counts only: a count that belongs to another day is dropped, not added to.
      const today = settings.lastResetDate;
      const prev: ReadToday = settings.readToday?.date === today ? settings.readToday : { date: today };
      const before = prev[increment.platform];
      const had: ReadCounts = typeof before === 'object' ? before : { posts: 0, comments: 0, videos: 0 };
      const whole = (n: number): number => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);
      return {
        readToday: {
          ...prev,
          date: today,
          [increment.platform]: {
            posts: had.posts + whole(increment.posts),
            comments: had.comments + whole(increment.comments),
            videos: had.videos + whole(increment.videos),
          },
        },
      };
    }
    case 'ai-call': {
      const totalNew = increment.inputTokens + increment.outputTokens;
      // Dollar figure: the call's token-equivalents at the counter basis, which
      // price each direction at the answering model's own rate, as the proxy
      // charges it. One averaged price put on every token would overstate this
      // product's input-heavy calls.
      const costUSD = (increment.tokenEquivalents / 1_000_000) * GROQ_BLENDED_RATE_PER_1M_USD;
      // DO NOT pre-round per-call accumulation: a single L1 call at Groq
      // rate is ~$0.00007, and rounding to cents every call truncates back
      // to the previous value, so the accumulator never moves. Keep raw
      // float precision in storage; the display rounds.
      //
      // One write per call: the daily call count and the monthly
      // token-equivalent counter (the two proxy caps) plus the raw token
      // and cost tallies. totalTokensThisMonth is in token-equivalents so
      // the popup's monthly share divides like the proxy's.
      return {
        totalChecksToday: settings.totalChecksToday + 1,
        totalChecksThisMonth: settings.totalChecksThisMonth + 1,
        totalChecksAllTime: settings.totalChecksAllTime + 1,
        totalTokensToday: settings.totalTokensToday + totalNew,
        totalTokensThisMonth: settings.totalTokensThisMonth + increment.tokenEquivalents,
        estimatedCostToday: settings.estimatedCostToday + costUSD,
        totalTokensAllTime: settings.totalTokensAllTime + totalNew,
        estimatedCostAllTime: settings.estimatedCostAllTime + costUSD,
      };
    }
  }
}

function hasPositive(map: Record<string, number> | undefined): boolean {
  return Object.values(map ?? {}).some(n => n > 0);
}

/**
 * Apply one usage increment to chrome.storage.local in THIS realm. The
 * service worker calls this for every USAGE_INCREMENT it receives; other
 * realms reach it only when they cannot message (see the realm rule above).
 */
export function applyUsageIncrement(increment: UsageIncrement): Promise<void> {
  if (increment.kind === 'metrics-hidden' && increment.by <= 0 && !hasPositive(increment.byFeature)) {
    return Promise.resolve();
  }
  return serializeCounterWrite(async () => {
    const settings = await settingsForCounterWrite();
    // A counter must never be computed off the synthetic fail-closed snapshot
    // (readFailedFallback, set at the two `{...DEFAULTS, ...}` returns inside
    // getSettings() above). That snapshot's counters are always DEFAULTS' zero,
    // so `settings.totalChecksAllTime + 1` etc. in counterPatch() would not add
    // one to the install's real total: it would REPLACE it with 1, because
    // chrome.storage.local.set only touches the keys in the patch. getSettings()
    // returns this snapshot on every storage-read failure with no cache to fall
    // back on, and the service worker realm holds no cache most of the time (the
    // forensic-outbox-drain alarm wakes it roughly every minute), so this is not
    // a rare corner: found by the adversarial read of 2026-09-18, locked by
    // tests/unit/storage/counter-write-synthetic-settings.test.ts. A write that
    // cannot see the true counters must not happen at all rather than happen
    // wrongly: the increment is lost (same as any other failed write; see the
    // "failed write does not stop the increments queued behind it" case in
    // counter-write-serialisation.test.ts) rather than corrupting the stored
    // total. This mirrors getSettingsForAttestation's guard against the same
    // synthetic snapshot for marker writers.
    if (settings.readFailedFallback) {
      throw new Error(
        'counter increment dropped: settings read failed, refusing to write a count computed from the synthetic fail-closed snapshot',
      );
    }
    await chrome.storage.local.set(counterPatch(settings, increment));
    // Drop the cache so the next read sees the just-written value rather than a stale count.
    invalidateSettingsCache();
  });
}

// Message-route failures resolve rather than reject. Most callers are
// `void incrementX()` on a paint path, where a rejection is an uncaught
// promise in the page console and nothing else; the loss is reported once
// per reason instead so it stays visible without flooding.
const warnedUsageLoss = new Set<string>();

function reportUsageLoss(reason: string, increment: UsageIncrement): void {
  if (warnedUsageLoss.has(reason)) return;
  warnedUsageLoss.add(reason);
  console.warn(`[FeelingWise] usage increment (${increment.kind}) not applied: ${reason}`);
}

async function sendUsageIncrement(increment: UsageIncrement): Promise<void> {
  // After the extension reloads under an open tab every count from that tab is lost by design, and the context guard
  // already says once to refresh the tab; a warning here would put a second line in the extension's Errors list.
  if (!isContextAlive()) return;
  let reply: unknown;
  try {
    reply = await chrome.runtime.sendMessage({ type: 'USAGE_INCREMENT', payload: increment });
  } catch (err) {
    if (isContextError(err)) {
      markContextInvalidated();
      return;
    }
    reportUsageLoss(err instanceof Error ? err.message : String(err), increment);
    return;
  }
  const ok = typeof reply === 'object' && reply !== null && (reply as { ok?: unknown }).ok === true;
  if (!ok) {
    const error =
      typeof reply === 'object' && reply !== null && typeof (reply as { error?: unknown }).error === 'string'
        ? (reply as { error: string }).error
        : 'no acknowledgement from the service worker';
    reportUsageLoss(error, increment);
  }
}

function recordUsage(increment: UsageIncrement): Promise<void> {
  // Off has no service worker to route to; the popup and the content script
  // write the counter themselves, serialized per realm.
  if (isOffProduct() || isCounterWriterRealm() || !canRouteCounterByMessage()) {
    return applyUsageIncrement(increment);
  }
  return sendUsageIncrement(increment);
}

// What Receipts read (B10-1). A page tells this module each time it accepts an item as read; the
// counts are gathered per page and sent as one increment per platform a moment later (or when the
// tab is hidden or closed), so a scroll does not send one message per item. Numbers only: the
// item itself never reaches this module. Off reads no items and keeps no count.
export type ReadKind = 'post' | 'comment' | 'video';

const READ_FLUSH_MS = 2000;
const pendingReads = new Map<string, ReadCounts>();
let readFlushTimer: ReturnType<typeof setTimeout> | null = null;
let readFlushHooked = false;

function hookReadFlush(): void {
  if (readFlushHooked || typeof document === 'undefined') return;
  readFlushHooked = true;
  const flushSoon = (): void => { void flushItemsRead(); };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushSoon(); });
  if (typeof window !== 'undefined') window.addEventListener('pagehide', flushSoon);
}

/** One item was accepted as read on `platform`. Cheap and synchronous; the write is batched. */
export function recordItemRead(platform: string, kind: ReadKind): void {
  if (isOffProduct()) return;
  const counts = pendingReads.get(platform) ?? { posts: 0, comments: 0, videos: 0 };
  if (kind === 'video') counts.videos += 1;
  else if (kind === 'comment') counts.comments += 1;
  else counts.posts += 1;
  pendingReads.set(platform, counts);
  hookReadFlush();
  if (readFlushTimer === null) readFlushTimer = setTimeout(() => { void flushItemsRead(); }, READ_FLUSH_MS);
}

/** Send what this page has gathered. Called by the timer, on hide and on pagehide; exported for tests. */
export async function flushItemsRead(): Promise<void> {
  if (readFlushTimer !== null) { clearTimeout(readFlushTimer); readFlushTimer = null; }
  const batch = [...pendingReads];
  pendingReads.clear();
  for (const [platform, counts] of batch) {
    await recordUsage({ kind: 'items-read', platform, ...counts });
  }
}

/** Meter one successful AI call. */
export function recordAiCall(call: AiCallUsage): Promise<void> {
  return recordUsage({ kind: 'ai-call', ...call });
}

export function incrementNeutralized(): Promise<void> {
  return recordUsage({ kind: 'neutralized' });
}

// Engagement-hide counter increment. Wired into the 5 per-platform
// engagement files (tiktok/twitter/facebook/instagram/youtube) at the
// dataset.fw*='hidden' assignment points. Default increment is 1 (one DOM
// element transitioned to hidden); the hideMetrics-only branch passes N for
// the per-element loop. Tracks the number of engagement metrics the child
// was not exposed to over time.
export function incrementMetricsHidden(by = 1, byFeature?: Record<string, number>): Promise<void> {
  if (by <= 0 && !hasPositive(byFeature)) return Promise.resolve();
  return recordUsage({ kind: 'metrics-hidden', by, byFeature });
}

// ── PIN attempt throttling (wiring Q26) ──
// A 4-digit space at ~0.6 s/try was exhaustible in well under two hours at
// the keyboard, and the payoff is RESET_FORENSIC_CHAIN, the one
// irreversible act in the product. After PIN_FREE_ATTEMPTS consecutive
// misses, every further miss locks the gate for an escalating window
// (30 s doubling to 15 min). State lives in chrome.storage.local so an SW
// respawn or popup re-open does not reset the counter; every gate in the
// product routes through this one verifyPin, so the throttle covers the
// popup, the dashboard modal, and the SW re-verify alike. A correct entry
// clears it.
//
// "At the keyboard" was doing more work in that first sentence than it looked.
// Until 2026-09-19 each attempt read the miss count, checked the PIN and wrote
// the count back on its own, so a caller firing attempts in parallel had them
// all read the same number and all write that number plus one: measured, ten
// wrong guesses at once cost ONE miss and armed no lock at all. The sequence is
// serialised now (serializePinAttempt, below verifyPin), which is what makes
// the paragraph above true of a loop as well as of fingers.
const PIN_ATTEMPTS_KEY = 'fw_pin_attempts';
const PIN_FREE_ATTEMPTS = 5;
const PIN_LOCK_BASE_MS = 30_000;
const PIN_LOCK_MAX_MS = 15 * 60_000;

interface PinAttemptState { misses: number; lockedUntil: number }

async function readPinAttemptState(): Promise<PinAttemptState> {
  try {
    const r = await chrome.storage.local.get(PIN_ATTEMPTS_KEY);
    const s = r?.[PIN_ATTEMPTS_KEY] as Partial<PinAttemptState> | undefined;
    return {
      misses: typeof s?.misses === 'number' && s.misses >= 0 ? s.misses : 0,
      lockedUntil: typeof s?.lockedUntil === 'number' ? s.lockedUntil : 0,
    };
  } catch (e) {
    // Unreadable state fails CLOSED (SEC-G5): a throttle that cannot be
    // read cannot prove the gate is open, and an attacker who can make the
    // read fail must not get unlimited attempts. The parent retries once
    // storage answers again; a blip costs one retry, not the lockout.
    throw new Error(`PIN attempt state unreadable: ${String((e as Error)?.message ?? e)}`);
  }
}

/**
 * Milliseconds until the PIN gate accepts another attempt; 0 = open now.
 * When the throttle state cannot be read the gate is closed (see
 * readPinAttemptState), so report one base window rather than 0.
 */
export async function pinLockRemainingMs(): Promise<number> {
  try {
    const s = await readPinAttemptState();
    return Math.max(0, s.lockedUntil - Date.now());
  } catch {
    return PIN_LOCK_BASE_MS;
  }
}

// ── Stored PIN format (SEC-G5) ──
// `parentPin` holds `pbkdf2$<iterations>$<saltHex>$<digestHex>`: a per-install
// random salt and PBKDF2-HMAC-SHA256 at the same iteration count the
// backup key-wrap uses, so a copy of chrome.storage.local can no longer be
// reversed against the 10,000 possible four-digit digests in one pass.
// Installs that predate this stored a bare unsalted sha256(pin) (64 hex
// chars); verifyPin still accepts that digest exactly as before and, on
// the next successful entry, rewrites the record in the salted format.
// Every comparison is constant-time.
const PIN_HASH_PREFIX = 'pbkdf2';

interface StoredPinHash { iterations: number; salt: string; digest: string }

function parseStoredPinHash(stored: string): StoredPinHash | null {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== PIN_HASH_PREFIX) return null;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations <= 0) return null;
  if (!/^[0-9a-f]+$/.test(parts[2]) || !/^[0-9a-f]{64}$/.test(parts[3])) return null;
  return { iterations, salt: parts[2], digest: parts[3] };
}

/** Derive the salted stored form of a secret (PIN or recovery phrase). */
export async function hashSecretForStorage(secret: string): Promise<string> {
  const salt = randomSaltHex();
  const digest = await pbkdf2Hex(secret, salt, PBKDF2_ITERATIONS);
  return `${PIN_HASH_PREFIX}$${PBKDF2_ITERATIONS}$${salt}$${digest}`;
}

/**
 * Compare a candidate secret against a stored hash. Returns the verdict and
 * whether the stored form is the legacy unsalted digest (caller migrates).
 */
export async function checkStoredSecret(
  secret: string, stored: string,
): Promise<{ ok: boolean; legacy: boolean }> {
  const parsed = parseStoredPinHash(stored);
  if (parsed) {
    const digest = await pbkdf2Hex(secret, parsed.salt, parsed.iterations);
    return { ok: timingSafeEqual(digest, parsed.digest), legacy: false };
  }
  const digest = await sha256(secret);
  return { ok: timingSafeEqual(digest, stored), legacy: true };
}

/**
 * One attempt at a time.
 *
 * read-check-record is three awaits, and every attempt used to run it on its
 * own. A caller firing attempts in parallel had them all read the same miss
 * count and all write that count plus one, so a burst of any size cost a
 * single miss and the lockout never bit: the throttle counted a batch as one
 * wrong guess. Against a keyboard the throttle was sound, which is what the
 * module header claims; against a loop in an extension page's console the
 * 4-digit space stayed exhaustible, and the stored PIN is a salted PBKDF2
 * digest, so reading storage is no substitute for guessing it. Found
 * 2026-09-19.
 *
 * Serialising the sequence is the fix: a queued attempt reads the miss count
 * the one before it wrote. PIN entries are rare and human-paced, so the queue
 * costs nothing in the case that matters.
 */
let pinAttemptQueue: Promise<unknown> = Promise.resolve();

function serializePinAttempt<T>(run: () => Promise<T>): Promise<T> {
  const next = pinAttemptQueue.then(run, run);
  // Keep the chain alive whatever this attempt did, and never leave a
  // rejection unhandled on the queue itself.
  pinAttemptQueue = next.then(() => undefined, () => undefined);
  return next;
}

export async function verifyPin(pin: string): Promise<boolean> {
  const settings = await getSettings();
  if (!settings.parentPin) return false;
  return serializePinAttempt(async () => {
    let state: PinAttemptState;
    try {
      state = await readPinAttemptState();
    } catch {
      return false;
    }
    if (Date.now() < state.lockedUntil) return false;
    const { ok, legacy } = await checkStoredSecret(pin, settings.parentPin);
    if (ok && legacy) {
      // Transparent migration: the parent just proved the PIN, so re-store
      // it salted. A failed rewrite keeps the legacy digest and the verdict.
      try { await setPin(pin); } catch { /* next successful entry retries */ }
    }
    await recordPinAttempt(state, ok);
    if (ok) await markPinVerified();
    return ok;
  });
}

/** Throttle bookkeeping shared by the PIN gate and the recovery-phrase gate. */
async function recordPinAttempt(state: PinAttemptState, ok: boolean): Promise<void> {
  try {
    if (ok) {
      await chrome.storage.local.remove(PIN_ATTEMPTS_KEY);
    } else {
      const misses = state.misses + 1;
      const lockedUntil = misses > PIN_FREE_ATTEMPTS
        ? Date.now() + Math.min(
            PIN_LOCK_MAX_MS,
            PIN_LOCK_BASE_MS * 2 ** (misses - PIN_FREE_ATTEMPTS - 1),
          )
        : 0;
      await chrome.storage.local.set({ [PIN_ATTEMPTS_KEY]: { misses, lockedUntil } });
    }
  } catch {
    // Bookkeeping failure never changes the verdict.
  }
}

// ── PIN recovery phrase (UX-I18N-A11Y-1) ──
// A parent who forgets the PIN used to have no way back except uninstalling,
// which deletes the record. Setup now shows an 8-character recovery phrase
// exactly once; only its salted PBKDF2 hash is stored (same format as the
// PIN), so nothing readable survives on the device. The phrase resets the
// PIN through the same attempt throttle as the PIN gate. It is not
// consumed by use: the parent keeps the one they wrote down. Installs that
// predate this get a phrase the first time they change the PIN.
const PIN_RECOVERY_KEY = 'fw_pin_recovery';
// 32 symbols, no 0/O or 1/I, so a handwritten copy reads back unambiguously.
const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const RECOVERY_LENGTH = 8;

/** Fresh phrase in the display form `XXXX-XXXX`. */
export function generateRecoveryPhrase(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(RECOVERY_LENGTH));
  let out = '';
  for (let i = 0; i < RECOVERY_LENGTH; i++) {
    if (i === RECOVERY_LENGTH / 2) out += '-';
    out += RECOVERY_ALPHABET[bytes[i] % RECOVERY_ALPHABET.length];
  }
  return out;
}

/** Canonical form for hashing and comparison: uppercase, separators dropped. */
export function normalizeRecoveryPhrase(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export async function setRecoveryPhrase(phrase: string): Promise<void> {
  const hash = await hashSecretForStorage(normalizeRecoveryPhrase(phrase));
  await chrome.storage.local.set({ [PIN_RECOVERY_KEY]: hash });
}

export async function hasRecoveryPhrase(): Promise<boolean> {
  const r = await chrome.storage.local.get(PIN_RECOVERY_KEY);
  return typeof r?.[PIN_RECOVERY_KEY] === 'string' && r[PIN_RECOVERY_KEY].length > 0;
}

// Kept in the page's own local storage, not chrome.storage.local, so it survives the very failure it
// is read after. The service worker has no localStorage and never reads it.
const PIN_NOTE_KEY = 'fw_pin_was_set';

/** Records on this profile that a PIN exists. Nothing clears it today because no path removes a PIN; any future path that removes the PIN must remove this key too. */
export function notePinWasSet(): void {
  try { localStorage.setItem(PIN_NOTE_KEY, '1'); } catch { /* no localStorage here */ }
}

function pinWasSetHere(): boolean {
  try { return localStorage.getItem(PIN_NOTE_KEY) === '1'; } catch { return false; }
}

/**
 * Whether storage holds a sign that a PIN was ever set, for a caller whose full settings read has
 * failed. Only the two PIN fields are read, so a failure elsewhere in settings does not hide them.
 * The PIN hash is one sign and the recovery-phrase hash the other, since either alone means a PIN
 * was set; a note kept outside chrome.storage counts as well, for when every read fails. `unreadable` means these two reads failed as well, and says nothing either way.
 */
export async function readPinEvidence(): Promise<'present' | 'none' | 'unreadable'> {
  if (pinWasSetHere()) return 'present';
  try {
    const r = await getLocalWithRetry(['parentPin', PIN_RECOVERY_KEY]);
    const filled = (v: unknown): boolean => typeof v === 'string' && v.length > 0;
    return filled(r.parentPin) || filled(r[PIN_RECOVERY_KEY]) ? 'present' : 'none';
  } catch {
    return 'unreadable';
  }
}

/**
 * Reset the PIN with the recovery phrase. Shares the PIN gate's throttle so
 * the phrase cannot be guessed faster than the PIN. On success the new PIN
 * is stored salted and the attempt counter clears; the grace window is NOT
 * opened, so the caller's gate still runs on its own terms.
 */
export async function resetPinWithRecoveryPhrase(phrase: string, newPin: string): Promise<boolean> {
  if (!/^\d{4}$/.test(newPin)) return false;
  // On the same queue as the PIN, and for the same reason: the sentence above
  // promises the phrase cannot be guessed faster than the PIN, and a parallel
  // burst against either used to cost one miss between them all (2026-09-19).
  return serializePinAttempt(async () => {
    let state: PinAttemptState;
    try {
      state = await readPinAttemptState();
    } catch {
      return false;
    }
    if (Date.now() < state.lockedUntil) return false;
    let stored: unknown;
    try {
      stored = (await chrome.storage.local.get(PIN_RECOVERY_KEY))?.[PIN_RECOVERY_KEY];
    } catch {
      return false;
    }
    if (typeof stored !== 'string' || !stored) return false;
    const { ok } = await checkStoredSecret(normalizeRecoveryPhrase(phrase), stored);
    await recordPinAttempt(state, ok);
    if (!ok) return false;
    await setPin(newPin);
    return true;
  });
}

/** Change the PIN; the current PIN goes through verifyPin (throttle and grace included). */
export async function changePin(currentPin: string, newPin: string): Promise<boolean> {
  if (!/^\d{4}$/.test(newPin)) return false;
  if (!(await verifyPin(currentPin))) return false;
  await setPin(newPin);
  return true;
}

// ── PIN grace window ──
// A tester reported re-entering the PIN too often. Low-stakes gates (opening the
// popup Settings panel) re-prompted on every visit, and the action popup closes
// on blur so each reopen demanded the PIN again. After ONE successful entry we
// remember it for PIN_GRACE_MS so those gates stay open. Stored in
// chrome.storage.session: in-memory, CLEARED when the browser closes, and not
// readable by content scripts — so the grace never survives a browser restart
// and a page script can't forge it. DESTRUCTIVE gates (forensic-chain reset)
// deliberately do NOT consult this and always demand the PIN.
const PIN_GRACE_MS = 15 * 60 * 1000;
const PIN_GRACE_KEY = 'pinVerifiedAt';

/** Record a successful PIN entry so low-stakes gates skip the prompt for a while. */
export async function markPinVerified(): Promise<void> {
  try { await chrome.storage.session?.set({ [PIN_GRACE_KEY]: Date.now() }); }
  catch { /* session storage unavailable — fall back to always-prompt */ }
}

/** True when a PIN was entered within the grace window (low-stakes gates only). */
export async function isPinGraceActive(): Promise<boolean> {
  try {
    const r = await chrome.storage.session?.get(PIN_GRACE_KEY);
    const ts = r?.[PIN_GRACE_KEY];
    return typeof ts === 'number' && Date.now() - ts < PIN_GRACE_MS;
  } catch { return false; }
}

export async function setPin(pin: string): Promise<void> {
  const hash = await hashSecretForStorage(pin);
  await chrome.storage.local.set({ parentPin: hash });
  // Drop the cache so a verifyPin() (which reads via getSettings) right after
  // setting the PIN sees the new hash instead of a stale cached snapshot.
  invalidateSettingsCache();
  notePinWasSet();
}

// ─── Feature-gate helpers ─────────────────────────────────────────────
//
// `isFeatureEnabled(settings, featureId, platformId?)`:
//   • If `platformId` is provided AND the feature has a `perPlatform[platformId]`
//     entry with an `enabled` field defined → return that per-platform value.
//   • Otherwise → return the top-level `enabled`.
//   • Missing feature entry → false (safe default: feature is off).
//
// `getFeatureValue<T>(settings, featureId, platformId?)`:
//   • Same precedence: per-platform override wins when defined.
//   • Returns `undefined` when the feature is missing or has no value.
//
// These are read-only helpers. Mutations go through
// `saveSettings({ features })` plus `applyPreset` below.

export function isFeatureEnabled(
  settings: FWSettings,
  featureId: FeatureId,
  platformId?: PlatformId,
): boolean {
  const f = settings.features?.[featureId];
  if (!f) return false;
  if (platformId) {
    const pp = f.perPlatform?.[platformId];
    if (pp && pp.enabled !== undefined) {
      return !!pp.enabled;
    }
  }
  return !!f.enabled;
}

/**
 * Whether comment text-REWRITING is allowed for a platform. YouTube is
 * capture-only by product rule (2026-06-07): YouTube comments are recorded
 * to the forensic chain and marked, but never text-rewritten — on YouTube FW
 * observes, it does not reframe (the rewrite fan-out is the heavy / over-reach
 * path). This overrides the user's `rewritten-comments-first` toggle for YouTube
 * only; every other platform honors the toggle. Capture, markers, and
 * harm-floor hides do NOT gate on this, so they continue on YouTube.
 */
export function isCommentRewriteEnabled(
  settings: FWSettings,
  platformId?: PlatformId,
): boolean {
  if (platformId === 'youtube') return false;
  return isFeatureEnabled(settings, 'rewritten-comments-first', platformId);
}

export function getFeatureValue<T>(
  settings: FWSettings,
  featureId: FeatureId,
  platformId?: PlatformId,
): T | undefined {
  const f = settings.features?.[featureId];
  if (!f) return undefined;
  if (platformId) {
    const pp = f.perPlatform?.[platformId];
    if (pp && pp.value !== undefined) {
      return pp.value as T;
    }
  }
  return f.value as T | undefined;
}

/**
 * Build the settings patch that applies a preset. Does NOT write to storage
 * — the caller (Popup / Dashboard settings surface) decides when the write
 * happens, typically inside a PIN-gated confirmation flow.
 */
export function applyPreset(mode: Mode): Pick<FWSettings, 'features' | 'presets'> {
  // child | teen | adult — presetForMode is the single source of truth.
  const features: FeatureToggles = presetForMode(mode);
  return {
    features,
    presets: {
      appliedAt: new Date().toISOString(),
      appliedPreset: mode,
    },
  };
}

// The shape lives in src/types/usage.ts so the types layer imports nothing (PLAN-2026-09-16 item 8.6);
// every importer of this module keeps working through this re-export.
export type { UsageIncrement, AiCallUsage } from '../types/usage';

// The shape lives in src/types/feature-toggles.ts so the types layer imports nothing (PLAN-2026-09-16 item 8.6);
// every importer of this module keeps working through this re-export.
export type { FeatureToggles } from '../types/feature-toggles';

// The shape lives in src/types/feature-id.ts so the types layer imports nothing (PLAN-2026-09-16 item 8.6);
// every importer of this module keeps working through this re-export.
export type { FeatureId, FeatureToggle } from '../types/feature-id';

// The shape lives in src/types/platform-id.ts so the types layer imports nothing (PLAN-2026-09-16 item 8.6);
// every importer of this module keeps working through this re-export.
export type { PlatformId } from '../types/platform-id';
