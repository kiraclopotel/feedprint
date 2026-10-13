// One fold of the Settings list: a header that names it and a body that opens under it, closed to a pill that reads as a
// button. General, the reading (Live Rephrase) and PIN and language are all this one shape, so they open and close the
// same way, one under the other. The header is the button, the whole row of it; its chevron sits in a square chip at the
// right edge so the thing to press to close is as big as a thumb and says which way it goes (down to open, up to close).
// Each fold keeps the choice the person last made, in storage, and the popup reads them once as it opens (readFoldOpen),
// so Settings draws every fold in its place on the first frame.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown } from '../../shared/icons/lucide';

/** Where each fold keeps its last choice. The reading's key is older than the others and keeps its name. */
export const FOLD_KEYS = {
  general: 'fw_fold_general_open',
  reading: 'fw_ai_drawer_open',
  topics: 'fw_fold_topics_open',
  device: 'fw_fold_device_open',
} as const;

/** What a fold does the first time: every fold waits shut until the person opens it, and then keeps what they left
 *  (13 Oct 2026; the reading used to open by itself on a fresh keyed install, the longest page of the three). */
export const FOLD_DEFAULT_OPEN = { general: false, reading: false, topics: false, device: false } as const;

/** The stored choice per key, once read in this popup. */
const known = new Map<string, boolean>();
const reads = new Map<string, Promise<boolean>>();

/**
 * Reads one stored choice once per popup. The popup starts it when it opens, so by the time a person reaches Settings the
 * fold can draw in its final state at once, with no open-then-close on every visit.
 */
export function readFoldOpen(key: string, dflt: boolean): Promise<boolean> {
  const have = known.get(key);
  if (have !== undefined) return Promise.resolve(have);
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return Promise.resolve(dflt);
  let pending = reads.get(key);
  if (!pending) {
    pending = chrome.storage.local.get(key).then((stored) => {
      const value = stored[key];
      if (!known.has(key)) known.set(key, typeof value === 'boolean' ? value : dflt);
      return known.get(key) as boolean;
    }).catch(() => dflt).finally(() => { reads.delete(key); });
    reads.set(key, pending);
  }
  return pending;
}

/** Forgets what this popup knows of the choices, so the next draw reads storage again. A test's way to start clean. */
export function forgetFoldChoices(): void {
  known.clear();
  reads.clear();
}

/** Every fold's choice, read together. */
export function readAllFoldsOpen(): Promise<boolean[]> {
  return Promise.all((Object.keys(FOLD_KEYS) as (keyof typeof FOLD_KEYS)[]).map((k) => readFoldOpen(FOLD_KEYS[k], FOLD_DEFAULT_OPEN[k])));
}

/**
 * Open or closed, or null while the stored choice is still being read (Settings opened before the popup's own read
 * landed): the fold then draws as the pill without moving, and settles once. A press always wins over a read that lands
 * after it. `forced` starts it open or closed whatever is stored (a page that opens on one fold).
 */
function useFoldOpen(key: string, dflt: boolean, forced?: boolean): [boolean | null, () => void, boolean] {
  const [open, setOpen] = useState<boolean | null>(forced ?? known.get(key) ?? null);
  const pressed = useRef(false);
  useEffect(() => {
    if (open !== null) return;
    let live = true;
    void readFoldOpen(key, dflt).then((value) => { if (live && !pressed.current) setOpen(value); });
    return () => { live = false; };
  }, []);
  const flip = () => {
    pressed.current = true;
    const next = !(open ?? false);
    known.set(key, next);
    setOpen(next);
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      void chrome.storage.local.set({ [key]: next }).catch(() => { /* the choice lasts for this popup */ });
    }
  };
  return [open, flip, pressed.current];
}

export function Fold({ name, bodyId, storageKey, defaultOpen, forceOpen, title, plan, atWork = false, keepMounted = false, children }: {
  /** Which fold, kept as a class (fold-general, fold-reading, fold-topics, fold-device) so a script or a test can tell them apart. */
  name: keyof typeof FOLD_KEYS;
  /** The id of the body, which the header names in aria-controls. */
  bodyId: string;
  storageKey: string;
  defaultOpen: boolean;
  forceOpen?: boolean;
  title: string;
  /** A second name after a dot in the header, when the fold has one (the key's plan). */
  plan?: string;
  /** Closed, the pill takes the reading's green while it is at work; every other fold keeps the card's own colours. */
  atWork?: boolean;
  /** Draw the body at once and keep it drawn when closed. A fold with state worth keeping while shut asks for it; the
      others draw their body on the first opening only. */
  keepMounted?: boolean;
  children: ReactNode;
}) {
  const [state, flip, pressed] = useFoldOpen(storageKey, defaultOpen, forceOpen);
  const open = state === true;
  // A body is drawn the first time it opens and stays drawn, so what a person typed in it is there when it opens again.
  const [opened, setOpened] = useState(open);
  useEffect(() => { if (open) setOpened(true); }, [open]);
  return (
    <div className={['pop-card', 'ai-drawer', `fold-${name}`, open ? '' : 'closed', atWork ? '' : 'idle', state === null ? 'unread' : '', pressed ? 'pressed' : ''].filter(Boolean).join(' ')}>
      <button type="button" className="ai-drawer-head" aria-expanded={open} aria-controls={bodyId} onClick={flip}>
        <span className="ai-drawer-title">{title}</span>
        {plan && plan !== title && (<>
          <span className="ai-drawer-sep" aria-hidden={true}>·</span>
          <span className="ai-drawer-plan">{plan}</span>
        </>)}
        <span className="ai-drawer-chip" aria-hidden={true}>
          <ChevronDown size={20} className={open ? 'ai-drawer-chev open' : 'ai-drawer-chev'} aria-hidden={true} />
        </span>
      </button>
      <div id={bodyId} className="ai-drawer-body" hidden={!open}>
        <div className="ai-drawer-rows">
          {(keepMounted || open || opened) && children}
        </div>
      </div>
    </div>
  );
}
