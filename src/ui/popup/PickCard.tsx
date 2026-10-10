// "Block this": the card that arms the picker on the page and lists what was picked, in Off's popup
// and in Receipts' settings. The picker itself is content/engagement/picker.ts; this card writes only
// the arming and the list, through storage, so neither product needs a tab permission for it.

import { useState } from 'react';
import { PICKER_ARMED_KEY, pickWasTaken } from '../../content/engagement/picker';
import { usePopupT, useUiLanguage } from '../../i18n/react';
import { type FWSettings, type PickedBlock, getSettings, saveSettings } from '../../storage/settings';
import type { Platform } from '../../types/post';
import { formatDayMonthLocal } from '../shared/format-time';
import { SITE_NAMES } from './report-link';

/** The sites in the popup's order, the order the picks are listed in. */
const PICK_PLATFORMS: { id: Platform; label: string }[] = (['tiktok', 'instagram', 'facebook', 'twitter', 'youtube'] as const)
  .map(id => ({ id, label: SITE_NAMES[id] }));

const PICK_ROWS_SHOWN = 4;

interface PickGroup { platform: Platform; label: string; total: number; rows: { label: string; ids: string[] }[] }

/**
 * Picks by platform (in the popup's platform order), rows merged by name, most-picked first. A pick
 * whose box had no label of its own is named by `nameOf`, so no row reads "unnamed".
 */
function groupPicks(picks: readonly PickedBlock[], nameOf: (p: PickedBlock) => string): PickGroup[] {
  const out: PickGroup[] = [];
  for (const p of PICK_PLATFORMS) {
    const mine = picks.filter(x => x.platform === p.id);
    if (mine.length === 0) continue;
    const byLabel = new Map<string, string[]>();
    for (const x of mine) { const name = x.label || nameOf(x); byLabel.set(name, [...(byLabel.get(name) ?? []), x.id]); }
    const rows = [...byLabel].map(([label, ids]) => ({ label, ids }))
      .sort((a, b) => b.ids.length - a.ids.length || a.label.localeCompare(b.label));
    out.push({ platform: p.id, label: p.label, total: mine.length, rows });
  }
  return out;
}

export function PickCard({ settings, reload }: { settings: FWSettings; reload: () => Promise<void> }) {
  const t = usePopupT();
  const uiLang = useUiLanguage();
  const fired = (key: string): number => settings.hiddenByFeature?.[key] ?? 0;
  // "Block this": a timestamp in storage arms the picker in the visible tab
  // (engagement/picker.ts); no tab permission needed. The popup closes so
  // the page is what the user sees next.
  // The picks, grouped by platform and merged by label (left alone, the
  // list would grow without end): one row per thing, with a
  // count when it was picked in more than one shape, a few rows shown per
  // platform, the rest behind "Show N more", and one Clear per platform.
  const pickGroups = groupPicks(settings.pickedBlocks ?? [], p => t.offPickDated(formatDayMonthLocal(p.createdAt, uiLang)));
  const [expanded, setExpanded] = useState<Partial<Record<Platform, boolean>>>({});
  // A search shows every match at once, across platforms; the few-rows fold is for browsing.
  const [pickQuery, setPickQuery] = useState('');
  const pickNeedle = pickQuery.trim().toLocaleLowerCase(uiLang);
  const shownPickGroups = pickNeedle === '' ? pickGroups : pickGroups
    .map(g => ({ ...g, rows: g.rows.filter(r => r.label.toLocaleLowerCase(uiLang).includes(pickNeedle)) }))
    .filter(g => g.rows.length > 0);
  // Set when no tab answered the arming, so the button stops being a press
  // that does nothing and says nothing (found 2026-09-19).
  const [pickUnanswered, setPickUnanswered] = useState(false);
  const armPicker = async (many: boolean) => {
    const at = Date.now();
    setPickUnanswered(false);
    // Started before the write, not after: the answer cannot come earlier than
    // the write it responds to, but it can come in the very next task.
    const taken = pickWasTaken(at);
    await chrome.storage.local.set({ [PICKER_ARMED_KEY]: { at, many } });
    if (await taken) { window.close(); return; }
    setPickUnanswered(true);
  };
  const removePicks = async (ids: string[]) => {
    const fresh = await getSettings();
    await saveSettings({ pickedBlocks: (fresh.pickedBlocks ?? []).filter(p => !ids.includes(p.id)) });
    await reload();
  };

  return (
    <div className="pop-card pick-card" style={{ marginTop: 0 }}>
      <div className="fr-desc" style={{ marginBottom: 10 }}>{t.offPickDesc}</div>
      <div className="pick-actions">
        <button className="pop-cta" onClick={() => { void armPicker(false); }}>{t.offPickButton}</button>
        <button className="pop-cta secondary" onClick={() => { void armPicker(true); }}>{t.offPickManyButton}</button>
      </div>
      {pickUnanswered && <div className="fr-desc" role="status">{t.offPickNoPage}</div>}
      {fired('picker') > 0 && <div className="fr-desc pick-tally">{t.offFiredHidden(fired('picker'))}</div>}
      {pickGroups.length === 0 && <div className="fr-desc">{t.offPickNone}</div>}
      {pickGroups.length > 0 && (
        <input
          type="search"
          className="list-search"
          value={pickQuery}
          placeholder={t.offPickSearch}
          aria-label={t.offPickSearch}
          spellCheck={false}
          onChange={e => setPickQuery(e.target.value)}
        />
      )}
      {pickGroups.length > 0 && shownPickGroups.length === 0 && <div className="fr-desc" role="status">{t.searchNoMatch}</div>}
      {shownPickGroups.map(g => {
        const open = expanded[g.platform] === true || pickNeedle !== '';
        const rows = open ? g.rows : g.rows.slice(0, PICK_ROWS_SHOWN);
        return (
          <div className="pick-group" key={g.platform}>
            <div className="pick-group-hdr">
              <span>{g.label}</span>
              <span className="pick-group-n">{g.total}</span>
              <button type="button" className="lnk" onClick={() => { void removePicks((pickGroups.find(x => x.platform === g.platform) ?? g).rows.flatMap(r => r.ids)); }}>{t.offPickClear}</button>
            </div>
            {rows.map(r => (
              <div className="pick-row" key={r.label}>
                <span className="pick-label" title={r.label}>{r.label}</span>
                {r.ids.length > 1 && <span className="pill-n">×{r.ids.length}</span>}
                <button type="button" className="chip-x" aria-label={`${t.offPickRemove}: ${r.label}`} onClick={() => { void removePicks(r.ids); }}>×</button>
              </div>
            ))}
            {g.rows.length > PICK_ROWS_SHOWN && pickNeedle === '' && (
              <button type="button" className="lnk pick-more" onClick={() => setExpanded(e => ({ ...e, [g.platform]: !open }))}>
                {open ? t.offPickShowLess : t.offPickShowAll(g.rows.length - PICK_ROWS_SHOWN)}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
