// The AI card of Receipts' Settings: the main switch for the reading, the rewrite switches and the rewrite
// language. It renders only when the stored key's plan covers the reading (reading-gate), so an install without a
// key sees no AI row it cannot use. With a key the main switch is always in view: it reads off, and is locked, at
// Strict, and the callAI chokepoint reads the stored flag. Presets keep seeding the hidden rows, so a key added
// later reveals the stored values, never masked or flipped. Settings places it right under the level picker, above
// the essentials: rows that appear only once a key is stored would go unseen further down. It is a drawer, open
// the first time and then as the person last left it; closed, it shrinks to a pill so the key's part still shows and
// asks to be pressed. The pill is green only while the reading is at work; with AI checks off, or at a level that sends
// nothing, it takes the card's own colour, because a green pill there told people the reading ran when nothing did.

import { useEffect, useRef, useState } from 'react';
import { usePopupT } from '../../../../i18n/react';
import type { PopupStrings } from '../../../../i18n/popup-strings';
import type { LicenseInfo } from '../../../../storage/license';
import { type FeatureId, type FWSettings, type PlatformId, isFeatureEnabled, saveSettings } from '../../../../storage/settings';
import { levelMakesNoCalls, makesNoOutsideCall } from '../../../../types/mode';
import { ChevronDown } from '../../../shared/icons/lucide';
import { FeatRow, Toggle } from '../../controls';
import { useReadingOn } from '../../reading-gate';

/** A switch row of the card, as Settings lists it. */
export interface AiRow {
  id: FeatureId;
  name: string;
  desc: string;
  betaTag?: boolean;
}

/** Whether the person left the AI drawer open; absent until they first open or close it, and absent means open. */
export const AI_DRAWER_OPEN_KEY = 'fw_ai_drawer_open';
const DRAWER_BODY_ID = 'fw-ai-drawer-rows';

/** The stored choice, once read in this popup; undefined until then. Absent from storage reads as open. */
let knownOpen: boolean | undefined;
let reading: Promise<boolean> | null = null;

/**
 * Reads the stored choice once per popup. The popup starts it when it opens, so by the time a person reaches Settings
 * the drawer can draw in its final state at once, with no open-then-close on every visit.
 */
export function readAiDrawerOpen(): Promise<boolean> {
  if (knownOpen !== undefined) return Promise.resolve(knownOpen);
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return Promise.resolve(true);
  reading ??= chrome.storage.local.get(AI_DRAWER_OPEN_KEY).then((stored) => {
    const value = stored[AI_DRAWER_OPEN_KEY];
    knownOpen ??= typeof value === 'boolean' ? value : true;
    return knownOpen;
  }).catch(() => true).finally(() => { reading = null; });
  return reading;
}

/**
 * Open or closed, or null while the stored choice is still being read (Settings opened before the popup's own read
 * landed): the drawer then draws as the pill without moving, and settles once. A press always wins over a read that
 * lands after it.
 */
function useDrawerOpen(): [boolean | null, () => void, boolean] {
  const [open, setOpen] = useState<boolean | null>(knownOpen ?? null);
  const pressed = useRef(false);
  useEffect(() => {
    if (open !== null) return;
    let live = true;
    void readAiDrawerOpen().then((value) => { if (live && !pressed.current) setOpen(value); });
    return () => { live = false; };
  }, []);
  const flip = () => {
    pressed.current = true;
    const next = !(open ?? false);
    knownOpen = next;
    setOpen(next);
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      void chrome.storage.local.set({ [AI_DRAWER_OPEN_KEY]: next }).catch(() => { /* the choice lasts for this popup */ });
    }
  };
  return [open, flip, pressed.current];
}

/** The names of the rows this card shows with a key, in its order; the License tab lists them as what a key covers. */
export function readingRowNames(t: PopupStrings): string[] {
  return [t.featAiMasterName, t.featRewriteName, t.reframeRewritesName, t.outputLangName];
}

export function AiCard({ settings, license, platform, rows, render, toggle, overrideNote, onChange }: {
  settings: FWSettings;
  license: LicenseInfo;
  /** The platform of the page in view; null for none, undefined when not known. */
  platform: PlatformId | null | undefined;
  rows: AiRow[];
  render: (id: FeatureId) => boolean;
  toggle: (id: FeatureId) => Promise<void>;
  overrideNote: (id: FeatureId) => string | undefined;
  onChange: () => Promise<void> | void;
}) {
  const t: PopupStrings = usePopupT();
  const readingOn = useReadingOn(license);
  const [state, flip, pressed] = useDrawerOpen();
  if (!readingOn) return null;
  const open = state === true;
  const readingAtWork = settings.aiAnalysisEnabled !== false && !makesNoOutsideCall(settings);
  const aiGroup = rows;
  return (<>
      {/* "pressed" lets the rows slide in only after a press, not each time Settings opens. */}
      <div className={['pop-card', 'ai-drawer', open ? '' : 'closed', readingAtWork ? '' : 'idle', state === null ? 'unread' : '', pressed ? 'pressed' : ''].filter(Boolean).join(' ')}>
        <button type="button" className="ai-drawer-head" aria-expanded={open} aria-controls={DRAWER_BODY_ID} onClick={flip}>
          <span className="ai-drawer-title">{t.groupAi}</span>
          {/* The plan label is the License card's name for what the key buys; when it is the group's own name
              (the feature is called one thing everywhere), the header says it once. */}
          {t.keySubActive !== t.groupAi && (<>
            <span className="ai-drawer-sep" aria-hidden={true}>·</span>
            <span className="ai-drawer-plan">{t.keySubActive}</span>
          </>)}
          <ChevronDown size={14} className={open ? 'ai-drawer-chev open' : 'ai-drawer-chev'} aria-hidden={true} />
        </button>
        <div id={DRAWER_BODY_ID} className="ai-drawer-body" hidden={!open}>
        <div className="ai-drawer-rows">
        <FeatRow
          name={t.featAiMasterName}
          desc={t.featAiMasterDesc}
          quiet
          note={levelMakesNoCalls(settings)
            ? t.featAiMasterStrictNote
            : settings.aiAnalysisEnabled === false ? t.featAiMasterOffNote : undefined}
          control={(
            <Toggle
              on={settings.aiAnalysisEnabled !== false && !levelMakesNoCalls(settings)}
              disabled={levelMakesNoCalls(settings)}
              heldByLevel={levelMakesNoCalls(settings)}
              onClick={() => {
                // Strict has no reading to switch: the stored choice waits for the level to change.
                if (levelMakesNoCalls(settings)) return;
                void (async () => {
                  await saveSettings({ aiAnalysisEnabled: settings.aiAnalysisEnabled === false });
                  await onChange();
                })();
              }}
              label={levelMakesNoCalls(settings) ? t.featAiMasterAriaStrict : t.featAiMasterName}
            />
          )}
        />
        {/* Not at Strict (M1): Strict sends nothing, so neither rewrite switch nor the rewrite language can
            work there. The stored choices stay, and leaving Strict gives the switches back. */}
        {!levelMakesNoCalls(settings) && (
          <>
            {aiGroup.map(r => {
              // YouTube is capture-only (isCommentRewriteEnabled): the rewrite
              // switch cannot be on there, so on a YouTube tab the row reads
              // unavailable instead of ON (P8).
              const onYouTube = r.id === 'rewritten-comments-first' && platform === 'youtube';
              return (
                <FeatRow
                  key={r.id}
                  name={r.name}
                  desc={r.desc}
                  beta={r.betaTag}
                  // Two facts, not one (2026-09-19). This row is the only one in
                  // the group that never reached `overrideNote`, because its
                  // ternary answered the YouTube question and stopped. The two
                  // are not alternatives: "the rewrite does not run on YouTube"
                  // is a permanent limit of the product, and "this differs on
                  // some platforms" is a thing the parent themselves set and is
                  // the only place the popup says so. They also never collide,
                  // since `overrideNote` speaks only in the general view
                  // (platform undefined) and `onYouTube` only on a YouTube tab,
                  // so the row was dropping a sentence it could always have
                  // shown.
                  quiet
                  note={r.id === 'rewritten-comments-first'
                    ? (onYouTube
                        ? t.featRewriteUnavailableHere
                        : [t.featRewriteNotOnYouTube, overrideNote(r.id)].filter(Boolean).join(' '))
                    : overrideNote(r.id)}
                  control={(
                    <Toggle
                      on={onYouTube ? false : render(r.id)}
                      disabled={onYouTube}
                      onClick={() => { if (!onYouTube) void toggle(r.id); }}
                      label={r.name}
                    />
                  )}
                />
              );
            })}
            {/* Q2/W44: the calmer-rewrite spend tier. Off keeps detection and
                the record intact; flagged posts mark or fold instead of
                rewriting. */}
            <FeatRow
              name={t.reframeRewritesName}
              desc={t.reframeRewritesDesc}
              control={(
                <Toggle
                  on={isFeatureEnabled(settings, 'reframe-rewrites')}
                  onClick={() => { void toggle('reframe-rewrites'); }}
                  label={t.reframeRewritesName}
                />
              )}
            />
            <div className="feat-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
              <div className="fr-body" style={{ width: '100%' }}>
                <div className="fr-name">{t.outputLangName}</div>
              </div>
              <select
                value={settings.outputLanguage || 'auto'}
                onChange={(e) => { void (async () => {
                  await saveSettings({ outputLanguage: e.target.value });
                  await onChange();
                })(); }}
                aria-label={t.outputLangAria}
                className="set-select"
                style={{ width: '100%' }}
              >
                <option value="auto">{t.outputLangAuto}</option>
                <option value="en">English</option>
                <option value="ro">Română (Romanian)</option>
                <option value="es">Español (Spanish)</option>
                <option value="fr">Français (French)</option>
                <option value="de">Deutsch (German)</option>
                <option value="it">Italiano (Italian)</option>
                <option value="pt">Português (Portuguese)</option>
                <option value="nl">Nederlands (Dutch)</option>
                <option value="pl">Polski (Polish)</option>
                <option value="ru">Русский (Russian)</option>
                <option value="tr">Türkçe (Turkish)</option>
                <option value="ja">日本語 (Japanese)</option>
                <option value="ko">한국어 (Korean)</option>
                <option value="zh">中文 (Chinese)</option>
              </select>
            </div>
          </>
        )}
        </div>
        </div>
      </div>
  </>);
}
