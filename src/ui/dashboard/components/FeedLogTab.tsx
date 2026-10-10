// ─── Feed log tab ───
// The dashboard's first tab (the owner's report, 10 Oct 2026): every item of the feed, newest first, with when, where,
// what Feedprint did, how severe and why in one line; a row opens to the rest. The window (Today, Last 7 days, Last 28 days, All) and
// the action chips filter it, each chip with its count in the window. Every other tab's "show me the posts" lands here
// already filtered (FeedLogFilter). It reads the active record from its end and stops once the window is behind it
// (feed-log.ts), so Today on a large record does not walk the whole record. The record's chain, anchor and exclusions
// stay on the Record tab, with its record events (resets, rotations, heartbeats).

import { Fragment, useEffect, useMemo, useState } from 'react';
import type { ForensicRecord } from '../../../types/forensic';
import type { IntegrityResult } from '../../../forensics/chain-integrity';
import { useDashboardT, useUiLanguage } from '../../../i18n/react';
import { dashboardWords } from '../dashboard-words';
import { formatDayMonthLongLocal, formatTimeLocal, formatUtcStamp, localDayKey } from '../../shared/format-time';
import { formatCount } from '../../shared/format-number';
import { isMarker, isTextPlaceholder } from '../record-sets';
import { shownText } from '../shown-text';
import { addExclusion, exclusionKey, readExclusions } from '../../../forensics/author-exclusions';
import { PLATFORM_COLORS, PLATFORM_LABELS } from './color-maps';
import { FileText } from '../../shared/icons/lucide';
import {
  FEED_ACTIONS, FEED_WINDOWS, feedAction, feedLogSlice, feedSeverity, feedWhy, worstTechnique,
  type FeedAction, type FeedLogFilter, type FeedWindow,
} from './feed-log';

const PAGE = 200;

const PILL_CLASS: Record<FeedAction, string> = {
  passed: 'passed', masked: 'passed', hidden: 'hidden', flagged: 'flagged', manual: 'flagged', seenALot: 'skipped', rewritten: 'rewritten', notChecked: 'skipped',
};

function sevColor(s: number): string {
  if (s >= 8) return 'var(--fw-red)';
  if (s >= 5) return 'var(--fw-amber)';
  return 'var(--fw-teal)';
}

export function FeedLogTab({
  records, loadingRest = false, filter, onFilter, integrity, onWithhold, onViewOriginal, now, archivedOlderCount = 0,
}: {
  /** The active record, oldest first, or its newest page while the rest loads (Dashboard.tsx feedRecords). */
  records: readonly ForensicRecord[];
  /** The newest page is shown while the rest of the record loads. */
  loadingRest?: boolean;
  filter: FeedLogFilter;
  onFilter: (next: FeedLogFilter) => void;
  integrity?: IntegrityResult | null;
  onWithhold?: (r: ForensicRecord, reason: string) => Promise<boolean>;
  onViewOriginal?: (r: ForensicRecord, url: string | null) => void;
  /** The clock, for tests. */
  now?: Date;
  /** Records in archived months older than the ones read (the last 90 days): counted elsewhere, not listed here. */
  archivedOlderCount?: number;
}) {
  const t = useDashboardT();
  const lang = useUiLanguage();
  const words = dashboardWords(lang);
  const win: FeedWindow = filter.window ?? 'today';
  // The local day, ticked each minute, so Today moves at midnight while the tab stays open.
  const [dayKey, setDayKey] = useState(() => localDayKey(new Date().toISOString()));
  useEffect(() => {
    const id = setInterval(() => { const k = localDayKey(new Date().toISOString()); setDayKey(d => (d === k ? d : k)); }, 60_000);
    return () => clearInterval(id);
  }, []);
  const slice = useMemo(() => feedLogSlice(records, filter, now ?? new Date()), [records, filter, now, dayKey]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE);
  useEffect(() => { setLimit(PAGE); }, [filter]);
  const [excludedKeys, setExcludedKeys] = useState<Set<string>>(new Set());
  useEffect(() => { void readExclusions().then(list => setExcludedKeys(new Set(list.map(e => e.key)))).catch(() => {}); }, []);
  const [note, setNote] = useState<{ id: string; text: string } | null>(null);

  const windowLabel = (w: FeedWindow) => (w === 'today' ? t.railWhen.today : w === 'last7' ? t.railWhen.last7 : w === 'last28' ? t.feedLogLast28 : t.filterChips.all);
  const actionLabel = (a: FeedAction): string => {
    switch (a) {
      case 'passed': return t.filterChips.passed;
      case 'hidden': return t.filterChips.hidden;
      case 'masked': return t.ledgerMasked;
      case 'flagged': return t.filterChips.flagged;
      // The action's own words, the ones the CSV and the Activity chip use, with a capital letter as a pill.
      case 'manual': { const w = t.feedActionLabels.manual; return w.charAt(0).toLocaleUpperCase(lang) + w.slice(1); }
      case 'seenALot': { const w = t.feedActionLabels.seenALot; return w.charAt(0).toLocaleUpperCase(lang) + w.slice(1); }
      case 'rewritten': return t.filterChips.rewritten;
      default: return words.ledgerNotChecked;
    }
  };
  const whyText = (r: ForensicRecord, a: FeedAction): string => {
    const why = feedWhy(r, a);
    if (!why) return '';
    if (why.kind === 'ad') return t.sourceChipLabels.advertiser;
    if (why.kind === 'swearing') return t.safetyBucketLabel.swearing;
    if (why.kind === 'blocked') return t.blockedCategoryLabel(why.category);
    if (why.kind === 'noReason') return t.feedLogNoReason;
    return t.techniqueLabel(why.id);
  };

  const visible = slice.rows.slice(0, limit);
  const chip = (on: boolean) => 'chip' + (on ? ' active' : '');

  return (
    <div className="fl-wrap" id="feed-log-start">
      <div className="fl-head">
        <h2 className="fl-title">{t.tabFeedLog}</h2>
        <span className="fl-sub">{t.feedLogSub}</span>
      </div>

      <div className="fl-chips" role="group" aria-label={t.railGroupWhen}>
        {FEED_WINDOWS.map(w => (
          <button key={w} type="button" className={chip(win === w)} aria-pressed={win === w} data-testid={`feed-log-window-${w}`}
            onClick={() => onFilter({ ...filter, window: w, day: undefined })}>{windowLabel(w)}</button>
        ))}
        {filter.platform && (
          <button type="button" className="chip active" onClick={() => onFilter({ ...filter, platform: undefined })}>
            {PLATFORM_LABELS[filter.platform] ?? t.otherSite} ✕
          </button>
        )}
        {filter.day && (
          <button type="button" className="chip active" onClick={() => onFilter({ ...filter, day: undefined })}>
            {formatDayMonthLongLocal(`${filter.day}T12:00:00`, lang)} ✕
          </button>
        )}
      </div>
      <div className="fl-chips" role="group" aria-label={t.feedLogColAction}>
        <button type="button" className={chip(!filter.action)} aria-pressed={!filter.action}
          onClick={() => onFilter({ ...filter, action: undefined })}>
          {t.filterChips.all} <b>{formatCount(slice.inWindow, lang)}</b>
        </button>
        {FEED_ACTIONS.filter(a => slice.counts[a] > 0 || filter.action === a).map(a => (
          <button key={a} type="button" className={chip(filter.action === a)} aria-pressed={filter.action === a}
            data-testid={`feed-log-chip-${a}`}
            onClick={() => onFilter({ ...filter, action: filter.action === a ? undefined : a })}>
            {actionLabel(a)} <b>{formatCount(slice.counts[a], lang)}</b>
          </button>
        ))}
      </div>
      {win === 'all' && !loadingRest && archivedOlderCount > 0 && (
        <p className="fl-note">{t.showingArchivedOlder(archivedOlderCount)}</p>
      )}
      {loadingRest && (
        <p className="fl-note">{t.showingLoadingBefore}<b>{formatCount(records.length, lang)}</b>{t.showingLoadingAfter}</p>
      )}

      {/* Which clock the When column is on, said once and in words (two clocks on one screen, 18 Sep 2026). */}
      <p className="fl-note">{t.feedLogClock}</p>

      <div className="fx-ledger fl-log">
        <div className="fl-row fl-row-head">
          <span>{t.railGroupWhen}</span>
          <span>{t.fxColPlatform}</span>
          <span>{t.feedLogColAction}</span>
          <span>{t.sortSeverity}</span>
          <span>{t.feedWhy}</span>
        </div>
        <div className="fx-ledger-body fl-body">
          {visible.length === 0 ? (
            // While the rest is loading the note above says so; an empty list then says nothing yet.
            loadingRest ? null : (
              <div className="feed-empty">
                <FileText size={36} />
                <div>{slice.windowTotal > 0 && (filter.action || filter.platform || filter.day) ? t.feedLogNoMatch : t.feedLogEmpty}</div>
              </div>
            )
          ) : visible.map((r, i) => {
            const action = feedAction(r);
            const sev = feedSeverity(r);
            const day = localDayKey(r.timestamp);
            const newDay = i === 0 || localDayKey(visible[i - 1].timestamp) !== day;
            const isOpen = expandedId === r.id;
            const top = worstTechnique(r);
            const recordStatus = integrity?.perRecord?.get(r.id) ?? (integrity?.valid === false ? 'unverified' : 'verified');
            const canVisit = /^https?:\/\//.test(r.postUrl ?? '');
            return (
              <Fragment key={r.id}>
                {newDay && win !== 'today' && (
                  <div className="fl-day">{formatDayMonthLongLocal(r.timestamp, lang)}</div>
                )}
                <div
                  className="fl-row"
                  role="button"
                  tabIndex={0}
                  aria-expanded={isOpen}
                  data-testid="feed-log-row"
                  onClick={() => setExpandedId(isOpen ? null : r.id)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpandedId(isOpen ? null : r.id); }
                  }}
                >
                  <span className="fx-ledger-time" title={t.utcStamp(formatUtcStamp(r.timestamp))}>{formatTimeLocal(r.timestamp, lang)}</span>
                  <span className="fx-ledger-platform" style={{ ['--platform-color' as never]: PLATFORM_COLORS[r.platform] ?? 'var(--fw-muted)' }}>
                    <span className="dot" />{PLATFORM_LABELS[r.platform] ?? t.otherSite}
                  </span>
                  <span className={'fx-ledger-verdict ' + PILL_CLASS[action]}>{actionLabel(action)}</span>
                  <span className="fx-ledger-sev">
                    {sev > 0 && <><span className="dot" style={{ background: sevColor(sev) }} />{sev}</>}
                  </span>
                  <span className="fl-why">{r.redacted ? t.withheldShort : whyText(r, action)}</span>
                </div>
                {isOpen && (
                  <div className="fl-open">
                    <div className="fl-open-meta">
                      {r.chainPosition != null && <span>#{r.chainPosition}</span>}
                      {top && <span>{t.techDetail(t.techniqueLabel(top.name), top.severity)}</span>}
                      <span>{t.utcStamp(formatUtcStamp(r.timestamp))}</span>
                      <span className={'status ' + recordStatus}><span className="status-dot" /> {t.recordStatusLabel[recordStatus] ?? t.recordStatusLabel.unverified}</span>
                    </div>
                    <div className="fl-open-block">
                      <div className="fl-open-label">{t.originalLabel}</div>
                      {r.redacted
                        ? <div className="fl-muted">{t.withheldNote}</div>
                        : isTextPlaceholder(r)
                          ? <div className="fl-muted">{shownText(r, lang)}</div>
                          : <div className="fl-text">{r.author ? <strong>{r.author} · </strong> : null}{r.originalText || ''}</div>}
                    </div>
                    {r.neutralizedText && r.neutralizedText !== r.originalText && (
                      <div className="fl-open-block">
                        <div className="fl-open-label">{t.softenedLabel}</div>
                        <div className="fl-text">{r.neutralizedText}</div>
                      </div>
                    )}
                    {canVisit ? (
                      <a href={r.postUrl} target="_blank" rel="noopener noreferrer" className="fl-link"
                        onClick={(e) => { if (!onViewOriginal) return; e.preventDefault(); onViewOriginal(r, r.postUrl ?? null); }}>
                        {t.openOriginalPost}
                      </a>
                    ) : (
                      <span className="fl-muted">{r.platform === 'tiktok' ? t.tiktokNoLink : t.noLinkCaptured}</span>
                    )}
                    {onWithhold && !r.redacted && !isMarker(r) && (
                      <div className="fl-open-actions">
                        <button type="button" className="fx-withhold" onClick={() => {
                          const reason = window.prompt(t.withholdPrompt, '');
                          if (reason === null) return;
                          void onWithhold(r, reason).then(ok => setNote({ id: r.id, text: ok ? t.withholdDone : t.withholdFailed }));
                        }}>{t.withholdBtn}</button>
                        {r.author && !excludedKeys.has(exclusionKey(r.platform, r.author)) && (
                          <button type="button" className="fx-withhold" onClick={() => {
                            const reason = window.prompt(t.withholdPrompt, '');
                            if (reason === null) return;
                            void addExclusion(r.platform, r.author, reason).then(list => {
                              setExcludedKeys(new Set(list.map(e => e.key)));
                              setNote({ id: r.id, text: t.excludeDone });
                            });
                          }}>{t.excludeBtn}</button>
                        )}
                        {r.author && excludedKeys.has(exclusionKey(r.platform, r.author)) && (
                          <span className="fl-muted">{t.ledgerAuthorExcluded}</span>
                        )}
                        {note && note.id === r.id && <span className="fl-muted">{note.text}</span>}
                      </div>
                    )}
                  </div>
                )}
              </Fragment>
            );
          })}
        </div>
        {slice.rows.length > visible.length && (
          <div className="fx-ledger-foot">
            {/* The timeline's words: the rest comes with the button beside it, not by scrolling. */}
            <span>{t.showingBefore}<b>{formatCount(visible.length, lang)}</b>{t.showingBetween}<b>{formatCount(slice.rows.length, lang)}</b>{t.showingAfter}</span>
            <span style={{ flex: 1 }} />
            <button type="button" className="chip" onClick={() => setLimit(l => l + PAGE)}>{t.feedLogMore(formatCount(Math.min(PAGE, slice.rows.length - visible.length), lang))}</button>
          </div>
        )}
      </div>
    </div>
  );
}
