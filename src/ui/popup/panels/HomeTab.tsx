// The home tab: what is protecting this page right now, and the switches for it.
//
// Cut out of src/ui/popup/Popup.tsx on 2026-09-16 (PLAN-2026-09-16 item 10.3), which was 1,871
// lines holding every panel at once. Popup.tsx re-exports the names it exported before.

import { type ProxyProbeResult, TEXT_CAP_STORAGE_KEY } from '../../../ai/client';
import { CLAUDE_PAUSE_STORAGE_KEY } from '../../../ai/claude-reader';
import { bearerOf, getReadingConsent, type ReadingConsent } from '../../../storage/reading-consent';
import { usePopupT, useUiLanguage } from '../../../i18n/react';
import { formatCount } from '../../shared/format-number';
import { LicenseInfo, dailyCapForTier, effectiveMonthlyTokenCap, isUncappedTier } from '../../../storage/license';
import { FWSettings, utcDayKey } from '../../../storage/settings';
import { levelMakesNoCalls } from '../../../types/mode';
import { mayCallOut } from '../../../types/reading-gate';
import { ChevronRight, ShieldAlert } from '../../shared/icons/lucide';
import { PLATFORM_LABELS, type PageCoverage, describePageCoverage } from '../coverage-map';
import { StatusLine } from '../../shared/StatusLine';
import { getFwVersion } from '../fw-version';
import { pageOf, reportMailto, switchesOnFor, type PageKind } from '../report-link';
import { makerMailto, readLastError, readRecordKeyId } from '../maker-mail';
import { HomeFoot } from '../HomeFoot';
import { DescribePage } from '../DescribePage';
import { sendDomReport } from '../send-dom-report';
import { receiptsSwitchIds } from './SettingsPanel';
import type { Platform } from '../../../types/post';
import { KEY_HELP_URL, computeAiBannerState } from './status';
import { useEffect, useRef, useState } from 'react';
import { COUNT_UP_MS, POPUP_LIFE, prefersReducedMotion } from '../life';

// The tab whose page the "On this page" card describes. In the action popup
// the active tab of the current window IS the page the parent is looking at.
// In the detached window (popup.html?detached=1) that same query resolves to
// the detached window's own chrome-extension:// tab, so the card permanently
// read "not a supported site" in exactly the mode built for keeping the popup
// open beside the feed (audit E2). When detached, ask for the last-focused
// NORMAL browser window instead (`windowTypes` filters out the detached popup
// window itself, plus devtools/app windows) and take its active tab. Resolves
// null — the card's existing unsupported-site copy — when there is no normal
// window to describe (Chrome rejects the lookup in that case).
export async function queryCoverageTab(detached: boolean): Promise<chrome.tabs.Tab | null> {
  if (!detached) {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs[0] ?? null;
  }
  let win: chrome.windows.Window | undefined;
  try {
    win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
  } catch {
    return null;
  }
  if (win?.id === undefined) return null;
  const tabs = await chrome.tabs.query({ active: true, windowId: win.id });
  return tabs[0] ?? null;
}

// What the product looked at today, for Home's count line: posts (feed videos folded in) and comments,
// summed over every platform. Today is the UTC day, the same day the hero's "handled today" uses. A count that
// belongs to another day, or a damaged entry, adds nothing. Numbers only.
export function readTodayTotals(settings: FWSettings): { posts: number; comments: number } {
  const rt = settings.readToday;
  if (!rt || rt.date !== utcDayKey()) return { posts: 0, comments: 0 };
  const whole = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);
  let posts = 0;
  let comments = 0;
  for (const [key, entry] of Object.entries(rt)) {
    // The same keys the bar and the one-site sentence count (stage 3, 10 Oct 2026), so the figure is their sum.
    if (key === 'date' || !(key in PLATFORM_LABELS) || typeof entry !== 'object' || entry === null) continue;
    posts += whole(entry.posts) + whole(entry.videos);
    comments += whole(entry.comments);
  }
  return { posts, comments };
}

/** Today's looked-at count per site, largest first: what the bar under today's figure, and the one-site sentence, are
 * drawn from. n is posts (with videos) and comments together, so the sentence and the bar cannot say different numbers. */
export function readTodayBySite(settings: FWSettings): Array<{ site: Platform; n: number; posts: number; comments: number }> {
  const rt = settings.readToday;
  if (!rt || rt.date !== utcDayKey()) return [];
  const whole = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);
  const out: Array<{ site: Platform; n: number; posts: number; comments: number }> = [];
  for (const [key, entry] of Object.entries(rt)) {
    if (key === 'date' || !(key in PLATFORM_LABELS) || typeof entry !== 'object' || entry === null) continue;
    const posts = whole(entry.posts) + whole(entry.videos);
    const comments = whole(entry.comments);
    const n = posts + comments;
    if (n > 0) out.push({ site: key as Platform, n, posts, comments });
  }
  return out.sort((a, b) => b.n - a.n || a.site.localeCompare(b.site));
}

/**
 * The today count as it is shown: with the motion look it climbs from zero to the stored number over COUNT_UP_MS when
 * Home opens, and only then; a number that changes while Home is open is shown as it is. Reduced motion shows it at once.
 */
function useCountUp(target: number): number {
  const animate = POPUP_LIFE.motion && target > 0 && !prefersReducedMotion();
  const [shown, setShown] = useState(animate ? 0 : target);
  const counted = useRef(false);
  useEffect(() => {
    if (counted.current || !animate) { setShown(target); return; }
    counted.current = true;
    const start = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / COUNT_UP_MS);
      setShown(Math.round(target * (1 - (1 - p) ** 3)));
      if (p < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(frame); setShown(target); };
  }, [target, animate]);
  return shown;
}

// ─── The key's numbers ───
// An active key's daily and monthly share, and the line that says a limit was reached. They stood at the top of Home;
// since the owner asked for a clean Home that is not overfilled, they open the License tab, beside
// the key they count.
export function KeyUsage({ settings, license, probeResult = null }: {
  settings: FWSettings;
  license: LicenseInfo;
  probeResult?: ProxyProbeResult | null;
}) {
  const t = usePopupT();
  const tier = license.tier;
  const aiBanner = computeAiBannerState(license, probeResult);

  // The pill and the usage line used to read from the tier alone, and the
  // tier is parsed out of the key TEXT (src/storage/license.ts: `fw-<tier>-`),
  // so any well-shaped key read 'Active'. When the proxy had refused that key
  // the screen said 'Active · unlimited (founder)' and carried the red 'not
  // accepted' card underneath it, at the same time. POP-5 added the card and
  // left the claim it contradicts standing; a correction next to a false
  // headline is the shape this repository keeps meeting. Seen on a real
  // install after a refund revoked its key server-side.
  const keyRejected = aiBanner === 'revoked' || aiBanner === 'expired';
  // Effective daily cap: the smaller of the per-tier ceiling and the
  // user-configurable settings.dailyCap. settings.dailyCap can dial DOWN
  // (more conservative) but cannot exceed the tier ceiling. Free tier =
  // 0 calls.
  const tierDailyCap = dailyCapForTier(tier);
  const uncapped = isUncappedTier(tier);
  // Q48 (W53): same effective-cap formula as the enforcing gate
  // (pipeline.ts): dailyCap <= 0 is the legacy "no user cap" sentinel and
  // means the tier ceiling applies. The old Math.min rendered "0 of 0
  // checks" while AI ran at the full tier cap.
  const dailyCap = tier === 'free'
    ? 0
    : settings.dailyCap > 0
      ? Math.min(settings.dailyCap, tierDailyCap)
      : tierDailyCap;
  const dailyUsed = settings.totalChecksToday ?? 0;
  const dailyPct = dailyCap > 0 ? Math.min(100, Math.round((dailyUsed / dailyCap) * 100)) : 0;
  // Q48 (W53): monthly honesty. The popup showed only the daily counter, so
  // a worker-monthly-capped account wore a green "Active" pill with a
  // healthy daily count while every call 429'd. Read the period-scoped pause
  // marker plus the monthly token share. totalTokensThisMonth is in the
  // proxy's token-equivalents, so this share moves with the proxy's counter
  // rather than showing room it has already spent.
  const monthlyTokenCap = tier === 'free' || uncapped
    ? 0
    : effectiveMonthlyTokenCap(tier, settings.monthlyUsdCapOverride ?? null);
  const monthlyPct = monthlyTokenCap > 0
    ? Math.min(100, Math.round((settings.totalTokensThisMonth / monthlyTokenCap) * 100))
    : 0;
  const [pausedText, setPausedText] = useState<'daily' | 'monthly' | null>(null);
  // The paid reading's second company: on while a consent for it is stored for this key; paused while the
  // reader's own marker says a limit or a refusal stopped it (src/ai/claude-reader.ts).
  const [claudeReading, setClaudeReading] = useState<'off' | 'on' | 'paused'>('off');
  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local || tier === 'free' || !license.secret) return;
    let cancelled = false;
    void (async () => {
      const consent = await getReadingConsent(bearerOf(license), 'claude');
      if (cancelled) return;
      if (!consent) { setClaudeReading('off'); return; }
      const stored = await chrome.storage.local.get([CLAUDE_PAUSE_STORAGE_KEY]).catch(() => ({} as Record<string, unknown>));
      if (cancelled) return;
      const marker = stored[CLAUDE_PAUSE_STORAGE_KEY] as { until?: string } | undefined;
      const until = marker?.until ? Date.parse(marker.until) : NaN;
      setClaudeReading(Number.isFinite(until) && until > Date.now() ? 'paused' : 'on');
    })();
    return () => { cancelled = true; };
  }, [tier, license.secret]);
  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
    let cancelled = false;
    void chrome.storage.local.get([TEXT_CAP_STORAGE_KEY]).then((stored) => {
      if (cancelled) return;
      const now = new Date();
      // NOT-DISPLAYED: the cap marker's period key, matched against what the
      // background wrote. UTC because the cap window is UTC.
      const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
      const day = `${month}-${String(now.getUTCDate()).padStart(2, '0')}`;
      const textMarker = stored[TEXT_CAP_STORAGE_KEY] as { cap?: 'daily' | 'monthly'; periodKey?: string } | undefined;
      if (textMarker?.cap && textMarker.periodKey === (textMarker.cap === 'monthly' ? month : day)) {
        setPausedText(textMarker.cap);
      }
    }).catch(() => { /* markers are best-effort */ });
    return () => { cancelled = true; };
  }, []);

  // The key's state is said once, by the header chip (his word, 8 Oct 2026: a "KEY SAVED" chip over a "KEY HELD"
  // pill said it twice). This keeps only what the chip cannot hold: an active key's numbers.
  if (tier === 'free' || keyRejected) return null;
  return (
    <div className="pop-tier">
      <div className="meta">{uncapped ? t.metaUnlimited(dailyUsed) : t.metaUsage(dailyUsed, dailyCap, dailyPct)}</div>
      {/* Q48 (W53): monthly share next to the daily counter, so the month
          filling up is visible before the day it caps. */}
      {!uncapped && monthlyTokenCap > 0 && (
        <div className="meta" style={{ marginTop: 2 }}>
          {t.metaMonthly(monthlyPct)}
        </div>
      )}
      {/* Period-scoped pause lines: the worker said the limit is reached.
          Same facts as the dashboard Issues cards, one line each. */}
      {claudeReading !== 'off' && !levelMakesNoCalls(settings) && (
        <div className="meta" data-testid="claude-reading-line" style={{ marginTop: 2 }}>
          {claudeReading === 'paused' ? t.claudePausedLine : t.claudeStopsFirst}
        </div>
      )}
      {pausedText && (
        // role="status" (accessibility audit, 2026-09-18): the result of
        // hitting a cap is one of the ten the audit found announced to
        // nobody. The hardcoded #d98a00 ignored the theme; --fw-amber is
        // the same warning token the rest of this surface already uses.
        <StatusLine tone="status" className="meta" style={{ marginTop: 4, color: 'var(--fw-amber)' }}>
          {pausedText === 'monthly' ? t.pausedTextMonthly : t.pausedTextDaily}
        </StatusLine>
      )}
    </div>
  );
}

// ─── Home tab ───
// Four things and no more (the owner asked for a clean Home, not an overfilled tab): the
// page's status in one short line, today's number, the button that opens the record, and the bottom row. The key's
// numbers went to the License tab, the two mail lines to the bottom row's contact menu, and the free install's "AI
// is off" banner to the License tab, which says it beside the key. A refused key still says so here: that is a fault,
// not an explanation.
export function HomeTab({
  settings, license, probeResult = null, readingTrouble = false, onOpenDashboard, onOpenDashboardSection,
  isDetached = false, onChange, consent,
}: {
  settings: FWSettings;
  license: LicenseInfo;
  // Live proxy-probe outcome (POP-5). Drives the refused-key alert.
  probeResult?: ProxyProbeResult | null;
  // The reading service has not answered several calls in a row: posts stay as written, and Home says so.
  readingTrouble?: boolean;
  // The reading agreement stored for this key (null when none, undefined until read): Silent reads only once it is given.
  consent?: ReadingConsent | null;
  onOpenDashboard: () => void;
  onOpenDashboardSection: (section: 'all' | 'blocked') => void;
  // True when rendered inside the standalone popup.html?detached=1 window —
  // flips the coverage card's tab lookup to the real browsing window (E2).
  isDetached?: boolean;
  // Kept for the callers that still pass it; the License tab now says what a free install's reading needs.
  onOpenLicense?: () => void;
  // The bottom row's style and theme are saved settings; this reloads them.
  onChange?: () => Promise<void> | void;
}) {
  const t = usePopupT();
  const aiBanner = computeAiBannerState(license, probeResult);

  // What's protected on the page the parent is currently looking at. `undefined`
  // = still loading; `null` = not a site FeelingWise runs on. tab.url is
  // available without the `tabs` permission because FW holds host permissions
  // for the supported social domains. Tab resolution lives in queryCoverageTab
  // so the detached window describes the real browsing window, not itself (E2).
  const [coverage, setCoverage] = useState<PageCoverage | null | undefined>(undefined);
  // The site and kind of the page in front, for the report email; the address itself is not kept.
  const [pageInFront, setPageInFront] = useState<{ site: Platform | null; kind: PageKind | null }>({ site: null, kind: null });
  const uiLang = useUiLanguage();
  // "Write to the maker": the record key and the backup's last failure, read once when Home opens (the dashboard
  // reads the same key the same way). Until they answer, the mail says the key could not be read.
  const [maker, setMaker] = useState<{ keyId: string | null; lastError: string | null }>({ keyId: null, lastError: null });
  useEffect(() => {
    let cancelled = false;
    void Promise.all([readRecordKeyId(), readLastError()]).then(([keyId, lastError]) => {
      if (!cancelled) setMaker({ keyId, lastError });
    });
    return () => { cancelled = true; };
  }, []);
  const read = readTodayTotals(settings);
  const bySite = readTodayBySite(settings);
  // Today's figure is what Receipts saw today, the same number the bar under it splits by site.
  const todayShown = useCountUp(read.posts + read.comments);
  const readSentence = read.posts + read.comments > 0
    ? t.homeReadCount(read.posts, read.comments, (n) => formatCount(n, uiLang))
    : t.homeReadNothing;

  useEffect(() => {
    let cancelled = false;
    queryCoverageTab(isDetached).then((tab) => {
      if (cancelled) return;
      const url = tab?.url;
      setPageInFront(pageOf(url));
      if (!url) { setCoverage(null); return; }
      try {
        const u = new URL(url);
        setCoverage(describePageCoverage(u.hostname, u.pathname, uiLang));
      } catch { setCoverage(null); }
    }).catch(() => { if (!cancelled) setCoverage(null); });
    return () => { cancelled = true; };
  }, [uiLang, isDetached]);

  const version = getFwVersion().replace(/^v/, '');
  const reportHref = reportMailto({
    product: 'receipts', ...pageInFront, version,
    switchesOn: switchesOnFor(settings, pageInFront.site, receiptsSwitchIds()),
  }, t);
  const statusTone = coverage === null ? 'idle' : coverage?.fullyProtected ? 'on' : 'limited';

  return (
    <>
      {/* 1. The page in one short line, "YouTube · recording" (his word, 8 and 9 Oct 2026). A dot says the state
          before the words do: steady accent when recording, amber when the page is only partly covered, grey off-site. */}
      {coverage !== undefined && (
        <div className={`home-status ${statusTone}`} role="status">
          <span className="home-status-dot" aria-hidden={true} />
          <span className="home-status-text">
            {coverage === null
              ? t.coverageNoSite
              : coverage.fullyProtected ? t.pageRecording(coverage.platformLabel) : t.pageLimited(coverage.platformLabel)}
            {/* Why the page is only partly covered, in a sentence the coverage map already wrote for it (11 Oct 2026:
                "limited here" stood alone, the reason computed and never shown). */}
            {coverage && !coverage.fullyProtected && coverage.gapNote && (
              <span className="home-status-note">{coverage.gapNote}</span>
            )}
          </span>
        </div>
      )}

      {/* Revoked / unauthorized paid key: every AI call 401s. A fault, so it stays on Home (POP-5). */}
      {aiBanner === 'revoked' && (
        <div className="pop-bn err" role="alert">
          <div className="ttl"><ShieldAlert size={14} /> {t.licenseInvalidTitle}</div>
          <div className="body">{t.licenseInvalidBody}</div>
        </div>
      )}
      {/* The paid period ended: the same fault, said as what it is, with the way to get a key again (R038). */}
      {aiBanner === 'expired' && (
        <div className="pop-bn err" role="alert">
          <div className="ttl"><ShieldAlert size={14} /> {t.licenseExpiredTitle}</div>
          <div className="body">{t.licenseExpiredBody}{' '}
            <a href={KEY_HELP_URL} target="_blank" rel="noopener noreferrer">{t.licenseRenewLink}</a>
          </div>
        </div>
      )}

      {/* The reading service is not answering. Nothing for the person to do, and the licence is fine, so it is a warning and not
          the key alert above (the Tester's full test, 11 Oct 2026). Not shown at Silent: its words say posts show as written,
          and at Silent they are filtered here; the dashboard's Issues card says it for Silent in its own words. */}
      {readingTrouble && aiBanner === 'none' && !levelMakesNoCalls(settings) && (
        <div className="pop-bn warn" role="status">
          <div className="ttl"><ShieldAlert size={14} /> {t.readingTroubleTitle}</div>
          <div className="body">{t.readingTroubleBody}</div>
        </div>
      )}

      {/* 2. Today, led by ONE figure: what Receipts saw today, split by site in the bar under it. What it handled
          (hid, marked, rewrote) is the small figure at the right, when there is any. The card opens the feed. */}
      <div className="pop-card today-card">
        <button
          type="button"
          className="pop-hero"
          onClick={() => onOpenDashboardSection('all')}
          title={t.kpiActionsTip}
        >
          <span className="pop-hero-value">{formatCount(todayShown, uiLang)}</span>
          <span className="pop-hero-label">{t.homeSeenLabel}</span>
          {/* What it handled today and in all, small at the right; the all-time total had no other place (9 Oct 2026). */}
          {(settings.totalNeutralizedToday > 0 || settings.totalNeutralizedAllTime > 0) && (
            <span className="pop-hero-total">
              {settings.totalNeutralizedToday > 0 && <span>{formatCount(settings.totalNeutralizedToday, uiLang)} {t.popHeroLabel}</span>}
              {settings.totalNeutralizedAllTime > 0 && <span>{t.kpiTotal(formatCount(settings.totalNeutralizedAllTime, uiLang))}</span>}
            </span>
          )}
          <ChevronRight size={16} className="pop-hero-chev" aria-hidden={true} />
        </button>
        {/* What Receipts looked at today. One site: the sentence alone, naming the site, from that site's own numbers, so
            no bar stands without words. Two or more: the same sentence shown above a calm bar, largest first, each site
            in its own fixed colour, and a legend whose keys carry their own words as their title. */}
        {bySite.length === 1 ? (
          <div className="pop-count-line" data-testid="home-read-count">
            {t.homeReadCount(bySite[0].posts, bySite[0].comments, (n) => formatCount(n, uiLang), PLATFORM_LABELS[bySite[0].site])}
          </div>
        ) : bySite.length > 1 ? (
          <div className="site-read" data-testid="home-read-count" title={readSentence}>
            <div className="site-read-line">{readSentence}</div>
            <div className="site-bar" aria-hidden={true}>
              {bySite.map((s) => <span key={s.site} className={`site-seg site-${s.site}`} style={{ flexGrow: s.n }} />)}
            </div>
            <div className="site-legend" aria-hidden={true}>
              {bySite.map((s) => {
                const words = `${PLATFORM_LABELS[s.site]} ${formatCount(s.n, uiLang)}`;
                return (
                  <span key={s.site} className="site-key" title={words}>
                    <i className={`site-dot site-${s.site}`} />{words}
                  </span>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="pop-count-line" data-testid="home-read-count">{readSentence}</div>
        )}
      </div>

      {/* 3. The record, and on an adult install with a key the on-demand reading beside it as the second button
          (docs/design/ADULT-MODE-2026-09-05.md). A timestamp in storage arms the reader in the visible tab
          (content/read-this.ts); the popup closes so the page is what the user sees next. What the reading sends
          is said by the consent screen and the button's tooltip, not by a paragraph here. */}
      <div className="home-actions">
        {/* One button: "Read this for me" came off Home on the owner's word. */}
        <button className="pop-cta" onClick={onOpenDashboard}>{t.openDashboard}</button>
      </div>

      {/* A closed fold: a picture of how this page is built, no words in it, shown in full before it can be sent (11 Oct 2026).
          Where nothing may leave now (Silent without a key or the agreement, a level not chosen) it can only be copied. */}
      <DescribePage
        tabId={async () => (await queryCoverageTab(isDetached))?.id}
        send={mayCallOut(settings, license, consent) ? sendDomReport : undefined}
        noCalls={!mayCallOut(settings, license, consent)}
      />

      {/* 4. The bottom row: version, style, theme, the contact menu, privacy. */}
      <HomeFoot
        settings={settings}
        onChange={onChange}
        reportHref={reportHref}
        makerHref={makerMailto({ ...maker, version }, t)}
      />
    </>
  );
}
