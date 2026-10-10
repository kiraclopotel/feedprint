// ─── The first-run wizard's draft (14 Sep 2026, board line b2) ───
//
// Chrome tears an action popup's document down whenever the click lands
// outside it, and builds it again from scratch on the next open. The setup
// wizard kept its step and its mode in React state alone and wrote nothing
// until the last screen, so a stray click sent the parent back to "Welcome"
// with everything retyped. The walk reproduced it (docs/BOARD.md, b2).
//
// What is safe to keep between two popup documents, and what is not:
//
//   • the step and the mode are choices, not secrets. They are kept.
//   • the PIN and the recovery phrase are NEVER kept. A finished setup holds
//     only salted PBKDF2 hashes of both (storage/settings.ts, "Stored PIN
//     format" and "PIN recovery phrase"), so a draft holding either in clear
//     would make the half-finished state readable where the finished state is
//     not. The wizard instead comes back to the PIN screen (step 2) whenever
//     the draft names a later step, because the later screens have nothing to
//     show without the PIN the parent typed: the phrase on step 3 is generated
//     from the PIN step and is shown exactly once.
//
// Where it lives: chrome.storage.session when the browser offers it (in
// memory, gone when the browser closes, closed to content scripts — the same
// place the PIN grace window lives), and chrome.storage.local otherwise, which
// is what an older Chrome and the test environment have. Either way the key is
// its own, so nothing the setup writes at the end can be mistaken for it: the
// walk's b1 step reads chrome.storage.local for `mode`, `setupDone`,
// `parentPin` and `fw_pin_recovery` before the last click and requires all
// four to be absent.

import type { Mode } from '../types/mode';

/** Draft key. Named apart from every key a finished setup writes. */
export const SETUP_DRAFT_KEY = 'fw_setup_draft';

/**
 * The last screen whose contents survive a teardown. Steps after it need the
 * PIN that was typed into step 2, and the PIN is never persisted, so a draft
 * that names step 3 or 4 comes back here.
 */
const SETUP_DRAFT_MAX_STEP = 2;

export interface SetupDraft {
  /** Wizard step index (0 based), already clamped by readSetupDraft. */
  step: number;
  /** Who the install is for. A choice, not a secret. */
  mode: Mode;
  /** ms epoch of the write; diagnostic only, never a gate. */
  savedAt: number;
}

const MODES: readonly string[] = ['child', 'teen', 'adult'];

/** chrome.storage.session where it exists, chrome.storage.local otherwise. */
function draftArea(): chrome.storage.StorageArea | null {
  try {
    const session = (chrome?.storage as { session?: chrome.storage.StorageArea } | undefined)?.session;
    if (session && typeof session.get === 'function' && typeof session.set === 'function') return session;
    return chrome?.storage?.local ?? null;
  } catch {
    return null;
  }
}

/**
 * Write the draft. Never throws: a wizard that cannot save its place must
 * still let the parent finish the setup in one sitting.
 */
export async function saveSetupDraft(draft: { step: number; mode: Mode }): Promise<void> {
  const area = draftArea();
  if (!area) return;
  try {
    await area.set({
      [SETUP_DRAFT_KEY]: { step: draft.step, mode: draft.mode, savedAt: Date.now() } satisfies SetupDraft,
    });
  } catch {
    /* the wizard keeps working from memory */
  }
}

/**
 * Read the draft back, clamped. Returns null when there is nothing to restore
 * or the stored value is not a draft this build wrote (a hand-edited or
 * older-shape value restores nothing rather than landing the wizard on a
 * screen it cannot render).
 */
export async function readSetupDraft(): Promise<SetupDraft | null> {
  const area = draftArea();
  if (!area) return null;
  let raw: unknown;
  try {
    raw = (await area.get(SETUP_DRAFT_KEY))?.[SETUP_DRAFT_KEY];
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Partial<SetupDraft>;
  if (typeof d.step !== 'number' || !Number.isFinite(d.step) || d.step < 0) return null;
  if (typeof d.mode !== 'string' || !MODES.includes(d.mode)) return null;
  // Adult ends on the mode screen (Popup.tsx, step 1), so a draft can never
  // put an adult install on a later screen than the one it can render.
  const ceiling = d.mode === 'adult' ? 1 : SETUP_DRAFT_MAX_STEP;
  return {
    step: Math.min(Math.floor(d.step), ceiling),
    mode: d.mode as Mode,
    savedAt: typeof d.savedAt === 'number' ? d.savedAt : 0,
  };
}

/** Drop the draft. Called when the setup finishes and when the record is reset. */
export async function clearSetupDraft(): Promise<void> {
  const area = draftArea();
  if (!area) return;
  try {
    await area.remove(SETUP_DRAFT_KEY);
  } catch {
    /* nothing to do: a stale draft is clamped and re-cleared on the next finish */
  }
}
