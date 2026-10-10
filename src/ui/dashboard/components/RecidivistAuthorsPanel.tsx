// src/ui/dashboard/components/RecidivistAuthorsPanel.tsx
// Surface-ID: activity-side-recidivist (NEW)
//
// Brand-new side-rail panel. Closes Inventory Part 7 #4 (per-author recidivism).
//
// Surfaces handles with ≥2 flagged records over the loaded record window.
// Clicking a row dispatches a search-by-handle (component owner wires the callback).
//
// DASH-3 (2026-07-13 dashboard-ui audit): identity is keyed on
// `authorProfileKey(handle, platform)` — the SAME composite key the M18 fix
// gave `author-store` ("same @handle on two platforms merges into one
// profile, corrupting totalSeen/totalFlagged"). This UI-side aggregation was
// added after M18 and recomputed recidivism straight from `records` with a
// raw-handle key, silently reintroducing the identical merge bug: two real
// accounts on different platforms sharing a handle (e.g. "@news") showed up
// as one "frequent flagger" row with a combined count. One row per
// platform-scoped identity now; a real repeat offender who appears on two
// platforms earns two separate rows (both still visible).
//
// Companion to FeedCard's `recidivist` prop: a Set<string> of "frequent"
// platform-scoped identities is also exported so the feed can highlight them
// inline (callers must key their `.has()` lookup the same way, via
// `authorProfileKey`).

import { useMemo } from 'react';
import type { ForensicRecord } from '../../../types/forensic';
import type { AuthorEscalation } from '../../../forensics/analytics';
import { useDashboardT, useUiLanguage } from '../../../i18n/react';
import { PRETTY_TECHNIQUE, TECHNIQUE_COLORS } from './color-maps';
import { formatCount } from '../../shared/format-number';
import { authorProfileKey } from '../../../forensics/author-store';
import { isPaidPlacement } from '../../../forensics/paid-placement';
import { isFlaggedItem } from '../record-sets';
import { computeAccountLedger } from './account-ledger';

const PLATFORM_SHORT: Record<string, string> = {
  twitter: 'X', facebook: 'FB', instagram: 'IG', tiktok: 'TT', youtube: 'YT',
};

export interface RecidivistAuthorsPanelProps {
  records: ForensicRecord[];
  /** Called when the user clicks a row. `handle` is the raw author handle;
   *  `profileKey` is authorProfileKey(handle, platform), the platform-scoped
   *  identity the row was counted under. The feed's author axis accepts
   *  either; wire the profile key so a same-handle account on another
   *  platform stays out (finding 9). */
  onPickAuthor: (handle: string, profileKey: string) => void;
  /** Minimum flag count to be considered a "frequent flagger". Default 2. */
  threshold?: number;
  /** Maximum rows to render. Default 6. */
  limit?: number;
  /**
   * D3: per-author severity trends from analytics.computeAuthorEscalation,
   * keyed by the SAME `authorProfileKey(handle, platform)` this panel keys
   * rows on. Rising/falling renders a small trend line under the row;
   * flat/insufficient-data renders nothing.
   */
  escalations?: Map<string, AuthorEscalation> | null;
}

export function RecidivistAuthorsPanel({
  records, onPickAuthor, threshold = 2, limit = 6, escalations,
}: RecidivistAuthorsPanelProps) {
  const t = useDashboardT();
  // The ledger row carries every content record by the account (pass and
  // flag on one line, served against sought, days, bursts); the panel keeps
  // its "frequent" gate on the flag count and its flag-count pill.
  const rows = useMemo(
    () => computeAccountLedger(records, { minFlagged: threshold, limit }).map((row) => ({
      ...row,
      count: row.flagged,
      platforms: [row.platform],
      // The top two techniques, as chips; more would crowd the row.
      techniques: row.techniques.slice(0, 2),
    })),
    [records, threshold, limit],
  );

  return (
    <div className="side-panel">
      <div className="side-panel-header">
        <h3>{t.recidTitle}</h3>
        <span className="hint">{t.recidHint(threshold)}</span>
      </div>
      {rows.length === 0 ? (
        <div className="muted" style={{ fontSize: 12 }}>{t.recidEmpty}</div>
      ) : rows.map((r) => (
        <button
          type="button"
          className="recidivist-row"
          key={r.key}
          onClick={() => onPickAuthor(r.author, r.key)}
          title={t.recidFilterTip(r.author)}
        >
          <div className="fc-avatar" style={{ ['--avatar-color' as never]: avatarColor(r.author) }}>
            {(r.author.replace(/^@/, '')[0] ?? '?').toUpperCase()}
          </div>
          <div className="recidivist-meta">
            <div className="recidivist-handle">{r.author.startsWith('@') ? r.author : '@' + r.author}</div>
            {r.techniques.length > 0 ? (
              <div className="recid-chips">
                {r.techniques.map(({ name }) => (
                  <span
                    key={name}
                    className="recid-chip"
                    style={{ ['--chip-color' as never]: TECHNIQUE_COLORS[name] ?? 'var(--fw-muted)' }}
                  >
                    {PRETTY_TECHNIQUE[name] ?? name}
                  </span>
                ))}
              </div>
            ) : (
              <div className="recidivist-platforms">
                {r.platforms.map((p) => PLATFORM_SHORT[p] ?? p).join(' · ')}
              </div>
            )}
            <div title={t.recidLedgerTip}>
              <div className="recid-facts primary">
                <Fact name="recorded" n={r.seen} />
                <Fact name="passed" n={r.passed} />
              </div>
              <div className="recid-facts">
                <Fact name="forYou" n={r.forYou} />
                <Fact name="sought" n={r.sought} />
                <Fact name="days" n={r.distinctDays} />
                {r.bursts > 0 && <Fact name="bursts" n={r.bursts} />}
              </div>
            </div>
            {(() => {
              const esc = escalations?.get(r.key);
              const trend = esc?.severityTrend;
              // Q42 (W49): the escalating rule (>= 5 sightings, >= 50% flag
              // rate, rising severity) was computed and never rendered; it
              // is the panel's headline claim, so it gets the loudest chip.
              if (esc?.escalating) {
                return (
                  <div
                    className="aggregate-pill escalating"
                    style={{ fontSize: 12, display: 'inline-block', padding: '1px 8px', borderRadius: 2, marginTop: 4 }}
                    title={t.recidEscalatingTip(esc.flagged, esc.seen)}
                  >
                    {`↑ ${t.recidEscalating}`}
                  </div>
                );
              }
              if (trend !== 'rising' && trend !== 'falling') return null;
              return (
                <div style={{ fontSize: 12, marginTop: 4, color: trend === 'rising' ? 'var(--fw-red)' : 'var(--fw-green)' }}>
                  {trend === 'rising' ? `↑ ${t.recidTrendRising}` : `↓ ${t.recidTrendEasing}`}
                </div>
              );
            })()}
          </div>
          <span className="recidivist-count">{r.count}×</span>
        </button>
      ))}
    </div>
  );
}

type FactName = 'recorded' | 'passed' | 'forYou' | 'sought' | 'days' | 'bursts';

// A zero is dimmed, never dropped: "0 sought" says the reader never went looking for this account.
function Fact({ name, n }: { name: FactName; n: number }) {
  const t = useDashboardT();
  const lang = useUiLanguage();
  return (
    <span className={'recid-fact' + (n === 0 ? ' zero' : '')} data-fact={name}>
      <b>{formatCount(n, lang)}</b> {t.recidFactWords[name](n)}
    </span>
  );
}

/**
 * Companion utility — call from ActivityTab to know which handles to flag in
 * the feed. Returns a Set of platform-scoped keys (`authorProfileKey(handle,
 * platform)`, the M18 composite key); callers must look up with the same
 * key — `recidivistSet.has(authorProfileKey(r.author, r.platform))`, not
 * `.has(r.author)` — or a raw-handle lookup silently reintroduces the
 * cross-platform merge this function was fixed to avoid (DASH-3).
 */
export function computeRecidivistSet(records: ForensicRecord[], threshold = 2): Set<string> {
  const counts: Record<string, number> = {};
  for (const r of records) {
    // An advertiser who bought four placements is not a repeat offender
    // (standing decision 1, 2026-09-14): an ad is a paid placement, never a
    // flag, so it cannot put an account on this panel.
    if (isPaidPlacement(r)) continue;
    // isFlaggedVerdict, not the two verdicts spelled out (2026-09-19).
    //
    // account-ledger.ts, which builds the rows this panel shows, states the
    // contract: "'flagged' is overview-data's isFlaggedVerdict; the panel, the
    // Overview and Statistics must never disagree on what a flag is." This
    // function disagreed with it, over one case: a legacy record carrying no
    // verdict at all, which isFlaggedVerdict counts as a flag and this did not.
    //
    // So on any install with history, an author could reach the panel's
    // threshold on legacy records, appear in Frequent flaggers, and then never
    // be badged in the feed and open zero rows under the "Repeat accounts"
    // filter. One name, two populations, both on the same screen.
    if (isFlaggedItem(r)) {
      const a = r.author || 'unknown';
      if (a.toLowerCase() === 'unknown') continue;
      const key = authorProfileKey(a, r.platform);
      counts[key] = (counts[key] ?? 0) + 1;
    }
  }
  return new Set(Object.entries(counts).filter(([, n]) => n >= threshold).map(([key]) => key));
}

function avatarColor(handle: string): string {
  const h = (handle || '?').replace(/^@/, '');
  let n = 0;
  for (let i = 0; i < h.length; i++) n = (n * 31 + h.charCodeAt(i)) >>> 0;
  // Accessibility audit found 2026-09-18: a hue sweep of oklch(0.58 0.14 H)
  // against the white initial painted on top scored 3.78:1 to 4.62:1, so 355
  // of 360 hues failed the 4.5:1 text-contrast requirement (worst case at hue
  // 191). Dropping lightness to 0.48 clears 4.5:1 at every hue; the same
  // sweep at 0.48 puts the worst case (still hue 191) at 5.61:1.
  return `oklch(0.48 0.14 ${n % 360})`;
}
