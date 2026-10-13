// The AI card of Receipts' Settings: the main switch for the reading, the rewrite switches and the rewrite
// language. It renders only when the stored key's plan covers the reading (reading-gate), so an install without a
// key sees no AI row it cannot use. With a key the main switch is always in view, at every level, and the callAI
// chokepoint reads the stored flag. Presets keep seeding the hidden rows, so a key added later reveals the stored
// values, never masked or flipped. Settings lists it between General and PIN and language, each a fold of the same
// shape (panels/Fold.tsx). It is open the first time and then as the person last left it; closed, it shrinks to a pill
// so the key's part still shows and asks to be pressed. The pill is green only while the reading is at work; with AI
// checks off, or at Silent while the agreement is not given, it takes the card's own colour, because a green pill
// there told people the reading ran when nothing did.

import { usePopupT } from '../../../../i18n/react';
import type { PopupStrings } from '../../../../i18n/popup-strings';
import type { LicenseInfo } from '../../../../storage/license';
import type { ReadingConsent } from '../../../../storage/reading-consent';
import { type FeatureId, type FWSettings, type PlatformId, isFeatureEnabled, saveSettings } from '../../../../storage/settings';
import { readingActive } from '../../../../types/reading-gate';
import { ChevronDown } from '../../../shared/icons/lucide';
import { FeatRow, Toggle } from '../../controls';
import { useReadingOn } from '../../reading-gate';
import { FOLD_DEFAULT_OPEN, FOLD_KEYS, Fold, readFoldOpen } from '../Fold';

/** A switch row of the card, as Settings lists it. */
export interface AiRow {
  id: FeatureId;
  name: string;
  desc: string;
  betaTag?: boolean;
}

/** Whether the person left the AI drawer open; absent until they first open or close it, and absent means open. */
export const AI_DRAWER_OPEN_KEY = FOLD_KEYS.reading;
const DRAWER_BODY_ID = 'fw-ai-drawer-rows';

/** The stored choice, read once per popup (the popup starts it as it opens, with the settings). */
export function readAiDrawerOpen(): Promise<boolean> {
  return readFoldOpen(FOLD_KEYS.reading, FOLD_DEFAULT_OPEN.reading);
}

/** The names of the rows this card shows with a key, in its order; the License tab lists them as what a key covers. The
 *  dot's row sits in this card too but is left out here: every install draws the dot (packet 36, 13 Oct 2026). */
export function readingRowNames(t: PopupStrings): string[] {
  return [t.featAiMasterName, t.reframeRewritesName, t.featRewriteName, t.outputLangName];
}

export function AiCard({ settings, license, platform, rows, render, toggle, overrideNote, onChange, consent, forceOpen }: {
  settings: FWSettings;
  license: LicenseInfo;
  /** The platform of the page in view; null for none, undefined when not known. */
  platform: PlatformId | null | undefined;
  rows: AiRow[];
  render: (id: FeatureId) => boolean;
  toggle: (id: FeatureId) => Promise<void>;
  overrideNote: (id: FeatureId) => string | undefined;
  onChange: () => Promise<void> | void;
  /** The reading agreement stored for this key (null when none, undefined until read); only Silent asks for it. */
  consent?: ReadingConsent | null;
  /** Start open or shut whatever is stored; a test's way to look at one state. */
  forceOpen?: boolean;
}) {
  const t: PopupStrings = usePopupT();
  const readingOn = useReadingOn(license);
  if (!readingOn) return null;
  const readingAtWork = readingActive(settings, license, consent);
  const aiGroup = rows;
  return (
      // The header names the group; the plan label is the License card's name for what the key buys, and when it is the
      // group's own name (the feature is called one thing everywhere) the header says it once.
      <Fold
        name="reading"
        bodyId={DRAWER_BODY_ID}
        storageKey={FOLD_KEYS.reading}
        defaultOpen={FOLD_DEFAULT_OPEN.reading}
        forceOpen={forceOpen}
        title={t.groupAi}
        plan={t.keySubActive}
        atWork={readingAtWork}
        keepMounted
      >
        <FeatRow
          name={t.featAiMasterName}
          desc={t.featAiMasterDesc}
          quiet
          note={settings.aiAnalysisEnabled === false ? t.featAiMasterOffNote : undefined}
          control={(
            <Toggle
              on={settings.aiAnalysisEnabled !== false}
              onClick={() => {
                void (async () => {
                  await saveSettings({ aiAnalysisEnabled: settings.aiAnalysisEnabled === false });
                  await onChange();
                })();
              }}
              label={t.featAiMasterName}
            />
          )}
        />
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
            {/* The level's second switch, the dot, under its first (packet 36, 13 Oct 2026): the two rows a level sets. */}
            <FeatRow
              name={t.featMarkersName}
              desc={t.featMarkersDesc}
              quiet
              note={overrideNote('show-reframe-markers')}
              control={(
                <Toggle
                  on={render('show-reframe-markers')}
                  onClick={() => { void toggle('show-reframe-markers'); }}
                  label={t.featMarkersName}
                />
              )}
            />
        {/* Every level shows the rewrite switches and the rewrite language: Silent reads with a key, like the others. */}
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
                  noteInFold={r.id === 'rewritten-comments-first' && !onYouTube}
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
            <div className="feat-row fr-stack">
              <div className="fr-body" style={{ width: '100%' }}>
                <div className="fr-name">{t.outputLangName}</div>
              </div>
              <span className="set-select-wrap">
              <select
                value={settings.outputLanguage || 'auto'}
                onChange={(e) => { void (async () => {
                  await saveSettings({ outputLanguage: e.target.value });
                  await onChange();
                })(); }}
                aria-label={t.outputLangAria}
                className="set-select"
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
              <ChevronDown size={16} className="set-select-chev" aria-hidden={true} />
              </span>
            </div>
        </>
      </Fold>
  );
}
