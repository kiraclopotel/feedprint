// The AI card of Receipts' Settings: the main switch for the reading, the rewrite switches and the rewrite
// language. It renders only when the stored key's plan covers the reading (reading-gate), so an install without a
// key sees no AI row it cannot use. With a key the main switch is always in view: it reads off, and is locked, at
// Strict, and the callAI chokepoint reads the stored flag. Presets keep seeding the hidden rows, so a key added
// later reveals the stored values, never masked or flipped. Settings places it right under the reframe markers,
// since the markers and the rewrites are one feature.

import { usePopupT } from '../../../../i18n/react';
import type { PopupStrings } from '../../../../i18n/popup-strings';
import type { LicenseInfo } from '../../../../storage/license';
import { type FeatureId, type FWSettings, type PlatformId, isFeatureEnabled, saveSettings } from '../../../../storage/settings';
import { levelMakesNoCalls } from '../../../../types/mode';
import { FeatRow, Toggle } from '../../controls';
import { useReadingOn } from '../../reading-gate';

/** A switch row of the card, as Settings lists it. */
export interface AiRow {
  id: FeatureId;
  name: string;
  desc: string;
  betaTag?: boolean;
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
  if (!readingOn) return null;
  const aiGroup = rows;
  return (<>
      <div className="grp-hdr">{t.groupAi}</div>
      <div className="pop-card" style={{ marginTop: 0 }}>
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
  </>);
}
