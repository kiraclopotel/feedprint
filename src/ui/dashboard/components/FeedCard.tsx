// src/ui/dashboard/components/FeedCard.tsx
// Surface-ID: feed-card (1.4.4) — the atomic unit of the activity feed.
//
// CHANGES vs v1:
//   • Platform-aware card shells switched on record.platform: TikTok / IG-reel,
//     YouTube, Facebook card, X compact text thread, Instagram. One shared inner layout
//     (author row → body → reveal toggles → metric row → actions) is wrapped by a
//     per-platform shell that supplies the structural rhythm (no logos, no brand
//     trade dress — platform identity is the metadata dot + domain only, per the
//     shipped color-maps contract).
//   • Per-platform metric rows are display-only, read from record.metrics
//     (primary_likes/likes/retweets/quote_tweets/bookmarks/views/shares/
//     comments_count/reply_count). `likes_obscured` renders struck-through with a
//     "likes hidden by platform" pill. When hideEngagement is set the counts also
//     render struck-through (what FW suppressed for the kid).
//   • Reveal toggles via per-card useState: the AI-reading expand block
//     (environment summary / video AI reading), the "see what the child saw"
//     rewrite reveal, and the hidden-verbatim reveal for flagged-hidden / blocked.
//   • Harm-floor chip from record.harmFloor on hidden / blocked records.
//   • NEW optional `replyingToHandle` prop → renders "↳ replying to @handle".
//   • No on-card media frame: FW stores no video/image frames, so media records
//     show NO placeholder tile (removed 2026-06-28 — the empty "video" frame wasted
//     ~480px of height and drove the Activity-feed scroll jump). A media record is
//     marked by its "media record" kind badge; its evidence lives in the drawer.
//   • NEW: optional `recidivist` prop tags handles surfaced by RecidivistAuthorsPanel.
//   • PRESERVED: View original fallback chain (postUrl → roomUrl → synthesized platform
//     URL) — see buildPlatformFallbackUrl below; mirrors v1 Dashboard.tsx:514-526.
//   • PRESERVED: the kind badge + technique chips, the record.metrics engagement
//     wiring, Confirm / Dispute, and BETA on every rewrite.
//   • The video evidence (on-screen text / scene / transcript) + chain provenance
//     moved OFF the card face into ForensicDetailDrawer, opened by the "forensic
//     detail" action — the card face shows only the poster's caption.

import { formatCompact } from '../../shared/format-number';
import * as React from 'react';
import type { ForensicRecord } from '../../../types/forensic';
import { isHiddenAd, isHiddenAsHarmful, isMarker, isRoomSummary, isRuleBlocked, isTextPlaceholder, readableText } from '../record-sets';
import { shownText } from '../shown-text';
import { I18N } from '../../../i18n/export-strings';
import { isPaidPlacement } from '../../../forensics/paid-placement';
import { feedActionKeyFor } from '../../../forensics/feed-action';
import { DECISION_NOTE_KEYS, decisionNoteWords } from '../../../i18n/decision-notes';
import { levelOfRecorded, type RecordedMode } from '../../../types/mode';
import type { ParentFeedback } from '../../../forensics/store';
import type { MetricGrowth, GrowthKey } from './metric-growth';
import type { FeedCommentStatusKey, FeedMediaStatusKey, MetricWord } from '../../../i18n/dashboard-strings';
import {
  PLATFORM_COLORS,
  PLATFORM_LABELS,
  TECHNIQUE_COLORS,
  BLOCKED_CATEGORY_LABELS,
} from './color-maps';
import { recordDotColor } from './record-dot';
import {
  Heart, Eye, MessageCircle, ExternalLink, ThumbsUp, ThumbsDown, ChevronDown, Flag, RotateCw,
  User, Users, Building, Megaphone,
} from '../../shared/icons/lucide';
import { useDashboardT, usePopupT, useUiLanguage } from '../../../i18n/react';
import { featureLabel } from '../feature-label';
import { GapMarkerSentence } from './GapMarkerSentence';
import { readGapMarkerLine } from '../gap-marker-line';
import { formatDateLocal, formatDateTimeLocal, formatTimeLocal, formatUtcStamp } from '../../shared/format-time';
import { whyWords } from '../../../i18n/why-words';
import { isButtonReading } from '../../../forensics/export-numbers';

export interface FeedCardProps {
  record: ForensicRecord;
  feedback?: ParentFeedback;
  onConfirm?: (record: ForensicRecord) => void;
  onDispute?: (record: ForensicRecord) => void;
  onViewOriginal?: (record: ForensicRecord, url: string | null) => void;
  isInGroup?: boolean;
  hideEngagement?: boolean;
  recidivist?: boolean;
  /** Replies to THIS comment that exist as chain records (linked via
   *  parentRecordId). Distinct from the platform's reply metric. */
  recordedReplies?: number;
  /** Handle of the parent this record replies to. When set, the card renders a
   *  "↳ replying to @handle" line under the author row (reply records). The
   *  caller resolves the handle from `parentRecordId`; FeedCard never fabricates
   *  it. */
  replyingToHandle?: string;
  /** Comment-section "room" combined reading (from the group's environment
   *  record's `.environment` field), folded into this post's forensic-detail
   *  drawer instead of rendering as a separate AI-summary card. Set by
   *  PostGroupCard for the primary post only. */
  roomReading?: NonNullable<ForensicRecord['environment']>;
  /** Light recheck — quietly re-open the original post to refresh its metrics +
   *  re-run the check. Resolves true on success (a new sighting was recorded),
   *  false on failure. When absent, the "Update Metrics" button is hidden. */
  onRecheck?: (record: ForensicRecord, url: string | null) => Promise<boolean>;
  /** Engagement growth across this item's sightings (latest-vs-first), resolved
   *  by the owner via buildGrowthByRecordId. When present, the metric row shows
   *  the latest numbers + a "+N since <date>" delta line. */
  growth?: MetricGrowth | null;
  /** Comment toggle for a post that hosts a comment section (set by
   *  PostGroupCard). When commentCount > 0 and onToggleComments is provided, the
   *  actions row LEADS with a "N comments" button that expands the thread below
   *  the card. The comment cards are themselves FeedCards (same metrics + rules). */
  commentCount?: number;
  commentsExpanded?: boolean;
  onToggleComments?: () => void;
}

// Which platform shell a record renders inside. TikTok and Instagram-reel
// share the vertical video shell; YouTube gets the 16:9 header; Facebook the
// plain card; X (twitter) the compact text thread; Instagram (non-reel) the
// square image shell. Derived purely from record.platform + kind — no new data.
type Shell = 'tiktok' | 'youtube' | 'facebook' | 'x' | 'instagram';

function mediaStatusForRecord(record: ForensicRecord): FeedMediaStatusKey {
  const mediaCapable = record.kind === 'video' || !!record.videoContext;
  if (!mediaCapable) return 'no-media';

  if (!record.videoContext) {
    const reason = String(record.skipReason ?? '').toLowerCase();
    if (record.failureKind || /fail|error|aborted|policy/.test(reason)) return 'failed';
    if (record.platform === 'youtube') return 'not-supported';
    return 'pending';
  }

  const video = record.videoContext;
  const hasFrames = video.frameCount > 0 && (video.model || '').trim().length > 0;
  const hasVisionText = !!(video.overlayText || video.scene || video.contentType || video.techniques.length);
  return hasFrames && hasVisionText ? 'ready' : 'partial';
}

function commentStatusForCount(commentCount: number | undefined): FeedCommentStatusKey {
  if (typeof commentCount !== 'number') return 'unavailable';
  return commentCount > 0 ? 'captured' : 'not-captured';
}

function resolveShell(record: ForensicRecord): Shell {
  switch (record.platform) {
    case 'tiktok':   return 'tiktok';
    case 'youtube':  return 'youtube';
    case 'facebook': return 'facebook';
    case 'twitter':  return 'x';
    case 'instagram':
      // A reel reads as a vertical video; a feed post as a square image. The
      // parentVideoId prefix is the only reliable reel signal on the record.
      return record.parentVideoId?.startsWith('ig-reel-') || record.kind === 'video'
        ? 'tiktok'
        : 'instagram';
    default:         return 'facebook';
  }
}

/**
 * Severity tier for the timeline gutter node-circle, on the locked marker ramp
 * (low 1-4, mid 5-7, high 8-10). A passed record reads green ('pass'); anything
 * else takes its peak technique severity. Drawn by the parent row so the rail
 * + node sit OUTSIDE the card, in the gutter.
 */
export type TimelineSeverity = 'hi' | 'mi' | 'lo' | 'pass';
export function timelineSeverity(record: ForensicRecord): TimelineSeverity {
  if (record.verdict === 'pass') return 'pass';
  // An ad reads faint whatever its record says (standing decision 1,
  // 2026-09-14): the severity 6 a legacy sponsored-ad record carries is the ad
  // marker firing, not a reading of the item, and the hidden-record floor
  // below would otherwise paint every advertisement as mid on the spine.
  if (isPaidPlacement(record)) return 'lo';
  const peak = (record.techniques ?? []).reduce((mx, tq) => Math.max(mx, tq.severity ?? 0), 0);
  // A record FW actually HID or BLOCKED never reads faint, even when its
  // technique severity is low (e.g. a profanity-tier hide carries severity 4) —
  // the action itself is the strong signal. Floor those nodes at mid.
  if (isRuleBlocked(record) || isHiddenAsHarmful(record)) {
    return peak >= 8 ? 'hi' : 'mi';
  }
  return peak >= 8 ? 'hi' : peak >= 5 ? 'mi' : 'lo';
}

/**
 * One timeline row: the gutter rail + severity node-circle hanging in the
 * left gutter, with the record's card to its right. The continuous rail is
 * drawn by every gutter, so stacked rows read as one chain spine. `rowClass`
 * carries the row variant (`sub` for a comment, `sub depth2` for a reply).
 */
export function TimelineRow({
  record, rowClass, children,
}: {
  record: ForensicRecord;
  rowClass?: string;
  children: React.ReactNode;
}) {
  const t = useDashboardT();
  const sev = timelineSeverity(record);
  // The node's COLOR is the record's technique color (record-dot.ts) so the
  // dot agrees with the technique chip + frequency chart; the severity tier
  // still drives the tooltip wording only.
  return (
    <div className={'fc-tl-row' + (rowClass ? ' ' + rowClass : '')} data-fw-key={record.id}>
      <div className="fc-tl-gutter">
        <span
          className={'fc-tl-node ' + sev}
          style={{ ['--fw-node-color' as never]: recordDotColor(record) }}
          title={t.feedNodeTip(sev)}
          aria-label={t.feedNodeTip(sev)}
        />
      </div>
      {children}
    </div>
  );
}

/**
 * Whether a model wrote this record's reading. The BETA pill and the AI reading speak for a model's work, so they follow
 * the record's own source, not the install's licence: a record saved under a licence still says what read it, and one
 * the built-in filter wrote never claims a model.
 */
function readByModel(r: ForensicRecord): boolean {
  return r.aiSource === 'cloud' || r.aiSource === 'local';
}

export function FeedCard({
  record, feedback, onConfirm, onDispute, onViewOriginal,
  isInGroup, hideEngagement, recidivist, recordedReplies, replyingToHandle, roomReading, onRecheck, growth,
  commentCount, commentsExpanded, onToggleComments,
}: FeedCardProps) {
  const t = useDashboardT();
  const pt = usePopupT();
  const lang = useUiLanguage();
  const byModel = readByModel(record);
  const descriptorEffect = (() => {
    const d = (record.decision as { descriptorV1?: { effect?: string } } | undefined)?.descriptorV1;
    return d?.effect ? (t.feedEffectLabels[d.effect] ?? null) : null;
  })();
  const platformColor = PLATFORM_COLORS[record.platform];
  const platformLabel = PLATFORM_LABELS[record.platform] ?? record.platform;
  const shell = resolveShell(record);

  // Reveal state — one toggle each for the AI-reading expand block, the
  // "see what the child saw" rewrite, and the hidden-verbatim record. Per-card
  // local state: collapsing keeps the feed skimmable; nothing is fetched.
  const [showAi, setShowAi] = React.useState(false);
  const [showVerbatim, setShowVerbatim] = React.useState(false);
  const [showForensic, setShowForensic] = React.useState(false);
  const [recheckPhase, setRecheckPhase] = React.useState<'idle' | 'busy' | 'done' | 'failed'>('idle');

  // System markers (reset / rotation / prune) are chain bookkeeping, not
  // observed content: render one compact system line instead of a full post
  // card wearing a platform shell and a fake author (Q21 follow-up; the
  // prune marker is new, the other two used to render as odd twitter posts).
  // Sits AFTER every hook call so the hook order stays unconditional.
  if (isMarker(record)) {
    // Every kind gets its own name, so no marker borrows another kind's label.
    const markerLabel = record.kind === 'reset-marker' ? t.feedMarkerReset
      : record.kind === 'month-rotation-marker' ? t.feedMarkerRotation
      : record.kind === 'prune-marker' ? t.feedMarkerPrune
      : record.kind === 'gap-marker' ? t.feedGapHeading(readGapMarkerLine(record.originalText)?.reason ?? '')
      : t.feedMarkerKindWord(record.kind ?? '', 1).toUpperCase();
    return (
      <div className="feed-card" data-fw-key={record.id} style={{
        display: 'flex', alignItems: 'baseline', gap: 10,
        padding: '10px 14px', fontSize: 12, color: 'var(--fw-muted)',
      }}>
        <span style={{ fontFamily: 'monospace', fontSize: 12, border: '1px solid var(--fw-border, #444)', borderRadius: 0, padding: '1px 6px' }}>
          {markerLabel}
        </span>
        <span>{formatDateTimeLocal(record.timestamp, lang)}</span>
        {record.kind === 'gap-marker'
          ? <GapMarkerSentence text={record.originalText} />
          : <span style={{ fontFamily: 'monospace', fontSize: 12, overflowWrap: 'anywhere' }}>{record.originalText}</span>}
      </div>
    );
  }

  // The forensic-detail drawer holds the video's eyes/ears evidence + chain
  // provenance + the comment-section "room" reading OFF the card face. It (and
  // its button) appear when the record carries video evidence OR a folded-in
  // room reading from the group's environment record.
  const hasForensicDetail = !!record.videoContext || !!roomReading;
  const mediaStatus = mediaStatusForRecord(record);
  const mediaCapable = mediaStatus !== 'no-media';
  const commentStatus = commentStatusForCount(commentCount);
  const canToggleComments = commentStatus === 'captured' && !!onToggleComments;

  // For a video record the card face shows only the poster's caption (verbatim);
  // the eyes/ears readings + provenance move into the forensic-detail drawer.
  // The timeline card no longer prints a separate YouTube title block, so the
  // caption must fall back to originalText for every shell (incl. YouTube, whose
  // videoContext.description is always empty — identity.ts) or it shows nothing.
  const videoCaption = record.videoContext
    ? (record.videoContext.description || readableText(record))
    : '';

  // 0 on an ad: display ignores a legacy ad severity (standing decision 1).
  const isAd = isPaidPlacement(record);
  const peakSev = isAd ? 0 : (record.techniques ?? []).reduce((m, t) => Math.max(m, t.severity ?? 0), 0);

  const reframed = !!record.neutralizedText && record.neutralizedText !== record.originalText;

  // Which audience this record was actually processed for — drives the honest
  // "Shown to {you/the teen/the child} as" wording. The mode is taken from the
  // record's own configSnapshot (who it was for at capture time), NOT the mode
  // the dashboard is being viewed in now. Older records without a snapshot fall
  // back to their stored age category.
  const snapMode = record.configSnapshot?.mode;
  const recordMode: RecordedMode = levelOfRecorded(snapMode) ? (snapMode as RecordedMode) : (record.userAgeCategory ?? 'child');

  // Timeline head extras: the peak-severity technique drives the at-a-glance
  // classification chip in line 1; the chain-link names the prior record this
  // one seals onto (chainPosition − 1), so the spine reads as the hash chain.
  const peakTech = isAd
    ? undefined
    : (record.techniques ?? []).slice().sort((a, b) => (b.severity ?? 0) - (a.severity ?? 0))[0];
  const prevChain = typeof record.chainPosition === 'number' && record.chainPosition > 0
    ? record.chainPosition - 1
    : null;

  // Action label — what FW did with this record.
  //
  // `flagged-hidden` gets its own "hidden" label so the audit log distinguishes
  // it from a plain `flagged`: the harm-floor pre-rewrite gate routed this
  // comment to a DOM-hide (no rewrite produced because the content was too
  // harmful to rewrite safely — slur match or profanity tier). Pre-2026-05-24
  // both states rendered as "FLAGGED" which obscured a real semantic split.
  // The class doubles as the (stable, English) CSS hook; the visible text is
  // looked up per-language from the strings table. feedActionKeyFor is
  // shared with the CSV export (feed-action.ts) so the two cannot drift
  // apart on what a hidden, marked, passed or skipped item is called.
  const actionClass = feedActionKeyFor(record);
  const actionLabel = actionClass ? t.feedActionLabels[actionClass] : null;

  // View-original URL — derive canonical URL from `parentVideoId` when
  // available, then fall back to `postUrl` / `roomUrl` / synthesized URL.
  //
  // Why canonical-from-parentVideoId comes FIRST: `postUrl` is captured at
  // the moment the forensic record is written, which can be AFTER the user
  // SPA-navigated away (the AI scoring step in the comment pipeline is
  // async). Reading `location.href` then captures the NEW URL — reported
  // from a live install, 2026-05-24: YT comments' "view original" landed on the YouTube
  // homepage because location.href had already changed to / when the
  // record was logged. `parentVideoId` is captured synchronously at
  // pipeline-start and is deterministic.
  const viewOriginalUrl = resolveViewOriginalUrl(record);

  // "Update Metrics" — re-open the original to refresh engagement counts +
  // re-check. Every kind that has a resolvable original URL qualifies: posts,
  // videos AND comments/replies all gain likes/replies over time. For comments
  // the URL is the exact-comment deep-link (X / YouTube &lc / Facebook
  // comment_id); IG/TikTok comments fall back to the post URL (best-effort).
  const canRecheck = !!onRecheck && !!viewOriginalUrl;

  const handleRecheckClick = async () => {
    if (!onRecheck || recheckPhase === 'busy') return;
    setRecheckPhase('busy');
    let ok = false;
    try { ok = await onRecheck(record, viewOriginalUrl); } catch { ok = false; }
    // Silent-failure rule: a refresh that produced nothing must SAY so on the
    // card, not quietly reset (owner repro 2026-08-01: tab opened and closed,
    // nothing updated, button just went idle).
    setRecheckPhase(ok ? 'done' : 'failed');
    window.setTimeout(() => setRecheckPhase('idle'), ok ? 2200 : 5000);
  };

  const rawHandle = record.author && record.author.trim().length > 0 ? record.author : 'Unknown';
  // A name the recorder saw and refused is not the same as a name it never
  // found, and the card says which (src/types/author-capture.ts). Without this
  // the two read the same, and a refusal looks like a failed read.
  const authorWithheld = record.authorCapture === 'withheld';
  const handleDisplay = authorWithheld
    ? t.feedAuthorWithheld
    : (rawHandle.toLowerCase() === 'unknown' || rawHandle === 'Unknown'
      // An ad's account is its advertiser, so an ad the page did not name says that, not "Unknown author".
      ? (isPaidPlacement(record) ? t.feedAdAuthorNotShown : t.feedUnknownAuthor)
      : (rawHandle.startsWith('@') ? rawHandle : '@' + rawHandle));
  const avatarChar = (handleDisplay.replace(/^@/, '')[0] ?? '?').toUpperCase();

  // Engagement metrics live on `record.metrics` (RecordMetrics, inside the
  // signed payload). The `environment` ("room") record carries its own
  // aggregate bag, used as the fallback. The per-key derivation + display lives
  // in PlatformMetricRow, which receives both bags.
  const envMetrics = record.environment?.metrics;

  const isEnvironment = isRoomSummary(record);
  const isComment = record.kind === 'comment' || record.kind === 'reply' || record.kind === 'reply-to-reply';
  const showContext = isComment && record.roomAuthor && record.roomAuthor.trim().length > 0;

  // ── Shared inner pieces (assembled in a platform shell below) ──

  // Avatar size is keyed to the timeline ROW class (.fc-tl-row.sub /
  // .sub.depth2 scale it down for comments / replies), so the card itself just
  // emits a plain .fc-avatar — no data-depth (the old global [data-depth] margin
  // rules were removed; they'd have indented the avatar now the wrapper is gone).
  const avatarNode = (
    <div
      className="fc-avatar"
      style={{ ['--avatar-color' as never]: isEnvironment ? 'var(--fw-muted)' : avatarColor(rawHandle) }}
      aria-hidden="true"
      title={isEnvironment ? undefined : t.feedAvatarPlaceholder}
    >
      {isEnvironment ? '✦' : avatarChar}
    </div>
  );

  // Line 1: who + what FW did + the at-a-glance technique. Line 2: the record
  // kind, who it replies to, and the chain-link onto the prior record.
  const whoNode = (
    <div className="fc-tl-who">
      <div className="fc-tl-l1">
        <span
          className={'fc-handle' + (recidivist ? ' recidivist' : '')}
          title={isEnvironment ? t.feedEnvHandle : (authorWithheld ? t.feedAuthorWithheldWhy : record.author)}
        >
          {isEnvironment ? t.feedEnvHandle : handleDisplay}
        </span>
        {/* i18n audit found 2026-09-18: this text used to be a CSS
            `content: '\B7 frequent'` on .fc-handle.recidivist::after
            (dashboard-design.css), which cannot be translated and never
            reaches the four language string tables. Rendered here instead so
            the words exist in the DOM; the inline style mirrors the CSS rule
            being retired alongside it (this file does not own the
            stylesheet). The key it asked for was added 2026-09-19: until then
            a Romanian or Spanish dashboard printed these two English words in
            the middle of its own sentences, which is the half of the audit
            that had not landed. */}
        {recidivist && (
          <span
            style={{
              marginLeft: 6, fontSize: 12, fontWeight: 600, color: 'var(--fw-muted)',
              letterSpacing: '0.06em',
            }}
          >
            {t.feedRecidivistFrequent}
          </span>
        )}
        {actionLabel && actionClass && (
          <span className={'fc-action-label ' + actionClass}>{actionLabel}</span>
        )}
        {!isEnvironment && peakSev > 0 && peakTech && (
          <span
            className="fc-tech-tag"
            style={{ ['--technique-color' as never]: TECHNIQUE_COLORS[peakTech.name] ?? null }}
          >
            <i />{t.techniqueLabel(peakTech.name)}
          </span>
        )}
        {/* What the post does to a person, from DESCRIPTOR-V1 on the signed
            decision block (PLAN-2026-09-15 item 1), the same words as the export
            card. The group it also names is not shown: it missed its measure on
            a fresh set (docs/research/taxonomy-2026-09-15/RESULTS-3.md). */}
        {!isEnvironment && descriptorEffect && (
          <span className="fc-tech-tag fc-effect-tag" title={t.feedEffectTip}>
            {descriptorEffect}
          </span>
        )}
      </div>
      <div className="fc-tl-l2">
        <span className="fc-kind-tag">
          {t.feedKindLabels[record.kind ?? 'post'] ?? (record.kind ?? 'post')}
        </span>
        {!isEnvironment && <SourceChip record={record} />}
        {/* "↳ replying to @handle" — reply records name their parent. The handle
            is supplied by the caller (resolved from parentRecordId); never made up. */}
        {replyingToHandle && replyingToHandle.trim().length > 0 && (
          <span className="fc-tl-replyto">↳ {t.feedCommentedUnder(
            replyingToHandle.startsWith('@') ? replyingToHandle : '@' + replyingToHandle,
          )}</span>
        )}
        {showContext && !replyingToHandle && (
          <span className="fc-tl-replyto">{t.feedCommentedUnder(record.roomAuthor ?? '')}</span>
        )}
        {prevChain != null && (
          <span className="fc-chainlink" title={t.feedSerialTip}>
            <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9 17H7A5 5 0 0 1 7 7h2" /><path d="M15 7h2a5 5 0 1 1 0 10h-2" /><line x1="8" y1="12" x2="16" y2="12" />
            </svg>
            <b>#{prevChain}</b>
          </span>
        )}
        {typeof recordedReplies === 'number' && recordedReplies > 0 && (
          <span className="fc-tl-replyto">{t.feedRecordedReplies(recordedReplies)}</span>
        )}
      </div>
    </div>
  );

  // Original verbatim text / video evidence. The video tile (placeholder) is
  // rendered by the platform shell, not here — this is just the derived/text
  // evidence body.
  const bodyNode = (
    <div className="fc-body">
      {record.videoContext ? (
        videoCaption || isHiddenAd(record) ? (
          <div className="fc-original fc-tl-quote">
            <span className="fc-original-label">{isHiddenAd(record) ? I18N[lang].feedAdHidden : t.feedVideoDescription}</span>
            {videoCaption}
          </div>
        ) : null
      ) : (
        <div className="fc-original fc-tl-quote">
          <span className="fc-original-label">
            {isHiddenAd(record) ? I18N[lang].feedAdHidden
              : isRoomSummary(record) && byModel
              ? t.feedEnvSummary
              : record.kind === 'post' || record.kind === 'video' ? t.feedPostText : t.feedOriginalVerbatim}
          </span>
          {/* The marker a caption-less hidden item is stored under is not words anyone saw: an ad says it is an ad above,
              anything else says it was hidden with no caption to keep, naming a rule only when the person wrote it. */}
          {isTextPlaceholder(record)
            ? (isHiddenAd(record) ? null : <span className="fc-text-capture">{shownText(record, lang)}</span>)
            : readableText(record)
            || (record.kind === 'video'
              ? <span className="fc-video-no-audio">{t.feedVideoNoCaption}</span>
              : record.originalText)}
          <TextCaptureNote record={record} />
          <RoomVerdictNote record={record} />
          <ReadingAskedNote record={record} />
          <DecisionNote record={record} />
        </div>
      )}

      {/* Technique chips on flagged records (shown even without a rewrite). */}
      {!reframed && (record.techniques ?? []).length > 0 && peakSev > 0 && (
        <div className="fc-ai-tags">
          {(record.techniques ?? []).map((tq, i) => (
            <span
              key={i}
              className="fc-ai-tag"
              style={{ ['--technique-color' as never]: TECHNIQUE_COLORS[tq.name] ?? null }}
            >
              <span className="tech-dot" />{t.techniqueLabel(tq.name)}
              {tq.severity != null && <span className="sev-num">· {tq.severity}</span>}
            </span>
          ))}
        </div>
      )}

      {/* "Shown to the child as" — the rewrite renders inline beneath the
          verbatim quote (the quote reads first; the calmer version sits under
          it), per the locked timeline-spine redesign. */}
      {reframed && (
        <div className="fc-shown-block fc-tl-shown">
          <div className="fc-shown-head">
            <span className="fc-shown-label">{record.decision?.applied === 'mask' ? t.feedMaskedLabel : t.feedShownAs(recordMode)}</span>
            {(record.techniques ?? []).map((tq, i) => (
              <span
                key={i}
                className="fc-ai-tag"
                style={{ ['--technique-color' as never]: TECHNIQUE_COLORS[tq.name] ?? null }}
              >
                <span className="tech-dot" />{t.techniqueLabel(tq.name)}
                {tq.severity != null && <span className="sev-num">· {tq.severity}</span>}
              </span>
            ))}
            {/* The BETA pill speaks for the model's rewrite. The swear mask uses no model and is
                not a beta feature, so its card carries none. */}
            {record.decision?.applied !== 'mask' && byModel && <span className="beta-pill" title={t.feedBetaTip}>BETA</span>}
          </div>
          <div className="fc-shown-text">{record.neutralizedText}</div>
        </div>
      )}

      {/* AI reading expand block (environment summary / video AI reading) —
          machine surface, dashed, mono. Never an avatar. */}
      {isEnvironment && (
        <>
          {(record.environment?.topicLabels?.length ?? 0) > 0 && (
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 6 }}>
              {record.environment!.topicLabels!.map((l) => (
                <span key={l} className="fc-ai-tag">{l.replace(/-/g, ' ')}</span>
              ))}
            </div>
          )}
          {byModel && <div className="fc-reveal-row">
            <button
              type="button"
              className="fc-reveal-btn"
              aria-expanded={showAi}
              onClick={() => setShowAi((v) => !v)}
            >
              {t.feedAiReadingToggle}
              <ChevronDown size={13} className={'fc-reveal-caret' + (showAi ? ' open' : '')} />
            </button>
          </div>}
          {byModel && showAi && (
            <div className="fc-ai-block">
              <div className="fc-ai-glyph" aria-hidden="true">✦</div>
              <div className="fc-ai-main">
                <div className="fc-ai-head">
                  <span className="fc-ai-label">{t.feedAiInterpretationNote}</span>
                  {byModel && <span className="beta-pill" title={t.feedBetaTip}>BETA</span>}
                </div>
                {/* The summary itself is the card's verbatim quote above, so the
                    AI block carries only the interpretation note + sampling — not
                    a second copy of the same text. */}
                {/* How many comments this reading of the room was made from.
                    It used to appear only when the platform's own comment count
                    could be read too, so on every room where that badge was
                    missing the card showed a confident sentence about the room
                    and nothing about the one or two comments behind it. The
                    export prints the count whenever it has one; this now does
                    the same, with the denominator when it is known and without
                    it when it is not. (2026-09-08: 154 of 286 rooms in the
                    owner's own export were read from fewer than four
                    comments.) */}
                {typeof record.environment?.sampled === 'number' && (
                  <div className="fc-ai-sample">
                    {typeof record.environment.totalVisible === 'number'
                      ? t.feedAiSampled(record.environment.sampled, record.environment.totalVisible)
                      : t.feedAiSampledRead(record.environment.sampled)}
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* Blocked AI-content record — category chip; honest about being our action. */}
      {record.verdict === 'blocked' && record.detectionMode && (
        <div className="fc-shown-block">
          <div className="fc-shown-head">
            <span className="fc-shown-label">{t.feedHiddenLabel}</span>
            <span
              className="fc-ai-tag"
              style={{ ['--technique-color' as never]: '#ab47bc' }}
            >
              <span className="tech-dot" />{t.blockedCategoryLabel(detectionModeLabel(record.detectionMode))}
            </span>
          </div>
          {record.neutralizedText && (
            <div className="fc-shown-text muted">{record.neutralizedText}</div>
          )}
        </div>
      )}

      {/* Hidden ≠ deleted. flagged-hidden / blocked records carry a harm-floor
          chip and a reveal that surfaces the verbatim text preserved as evidence. */}
      {(isHiddenAsHarmful(record) || isRuleBlocked(record)) && !isTextPlaceholder(record) && (
        <div className="fc-harm-row">
          {record.harmFloor && (
            <span className="fc-harm-chip">
              {t.feedHarmFloorLabel(
                record.harmFloor.score,
                record.harmFloor.topCategory ?? record.harmFloor.language,
              )}
            </span>
          )}
          <span className="fc-harm-note">{hideIsTooHarmfulToRewrite(record) ? t.feedHarmFloorNote : t.feedHiddenKeptNote}</span>
          <button
            type="button"
            className="fc-reveal-btn"
            aria-expanded={showVerbatim}
            onClick={() => setShowVerbatim((v) => !v)}
          >
            {t.feedRevealVerbatim}
            <ChevronDown size={13} className={'fc-reveal-caret' + (showVerbatim ? ' open' : '')} />
          </button>
        </div>
      )}
      {(isHiddenAsHarmful(record) || isRuleBlocked(record))
        && showVerbatim && record.originalText && (
        <div className="fc-reveal-panel">
          <span className="fc-reveal-panel-label">{t.feedOriginalVerbatim}</span>
          {readableText(record)}
        </div>
      )}

      {/* Q21: protections at capture. The hashed enabledFeatures list is the
          only proof of WHICH switches were live when this record was written
          (the mode tag alone cannot show a stripped grid); render it so the
          attestation reaches the parent, not only the exports. */}
      {record.configSnapshot?.enabledFeatures && record.configSnapshot.enabledFeatures.length > 0 && (
        <div style={{ marginTop: 8, fontSize: 12, color: 'var(--fw-muted)', display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'baseline' }}>
          <span>{t.feedProtectionsAtCapture}:</span>
          {record.configSnapshot.enabledFeatures.map(f => (
            <span key={f} style={{ fontSize: 12, border: '1px solid var(--fw-border, #444)', borderRadius: 0, padding: '0 5px' }}>{featureLabel(f, pt, t)}</span>
          ))}
        </div>
      )}
      {record.configSnapshot?.settingsReadFailed === true && (
        <div style={{ marginTop: 6, fontSize: 12, color: 'var(--fw-red)' }}>
          {t.feedSettingsReadFailedNote}
        </div>
      )}
    </div>
  );

  // Display-only per-platform metric row from record.metrics. Each platform
  // shows the metrics it actually exposes; never zero-fill. likes_obscured
  // (Instagram) renders the like slot struck-through with a "hidden" pill.
  const metricRow = (
    <PlatformMetricRow
      shell={shell}
      metrics={record.metrics}
      envMetrics={envMetrics}
      hideEngagement={!!hideEngagement}
      obscuredLabel={t.feedLikesObscured}
      growth={growth}
    />
  );

  const actionsNode = (
    <div className="more">
      {/* Comments — status is visible on comment-capable cards even when the
          extractor recorded zero comments or the thread cannot expand here. */}
      {typeof commentCount === 'number' && (
        <button
          type="button"
          className={'fc-action-btn comments'
            + (commentsExpanded ? ' on' : '')
            + (!canToggleComments ? ' muted' : '')}
          disabled={!canToggleComments}
          aria-expanded={canToggleComments ? commentsExpanded : undefined}
          onClick={canToggleComments ? onToggleComments : undefined}
          title={canToggleComments ? t.feedCommentsTip : t.feedCommentStatusTip[commentStatus]}
        >
          <MessageCircle size={14} />{' '}
          {commentStatus === 'captured'
            ? `${commentCount} ${t.grpCommentsWord(commentCount)}`
            : t.feedCommentStatus[commentStatus]}
        </button>
      )}
      {/* View original — fallback chain preserved (Part 6 contract #4). */}
      <button
        type="button"
        className="fc-action-btn"
        disabled={!viewOriginalUrl}
        onClick={() => onViewOriginal?.(record, viewOriginalUrl)}
        title={viewOriginalUrl ? t.feedOpenUrlTip(viewOriginalUrl) : t.feedNoUrlTip}
      >
        <ExternalLink size={14} /> {t.feedViewOriginal}
      </button>
      {/* Confirm / Dispute — present on every record per Part 6 contract #3. */}
      <button
        type="button"
        className={'fc-action-btn confirm' + (feedback?.feedback === 'confirmed' ? ' on' : '')}
        onClick={() => onConfirm?.(record)}
        aria-pressed={feedback?.feedback === 'confirmed'}
        title={feedback?.feedback === 'confirmed' ? t.feedUndoAnswerTip : t.feedConfirmTip}
      >
        <ThumbsUp size={14} /> {feedback?.feedback === 'confirmed' ? t.feedConfirmed : t.feedConfirm}
      </button>
      <button
        type="button"
        className={'fc-action-btn dispute' + (feedback?.feedback === 'disputed' ? ' on' : '')}
        onClick={() => onDispute?.(record)}
        aria-pressed={feedback?.feedback === 'disputed'}
        title={feedback?.feedback === 'disputed' ? t.feedUndoAnswerTip : t.feedDisputeTip}
      >
        <ThumbsDown size={14} /> {feedback?.feedback === 'disputed' ? t.feedDisputed : t.feedDispute}
      </button>
      {/* Media detail — media-capable records always show their evidence status.
          The drawer opens only when this record actually carries videoContext or
          a folded comment-room reading; missing media stays honest and disabled. */}
      {(mediaCapable || hasForensicDetail) && (
        <button
          type="button"
          className={'fc-action-btn forensic media-' + mediaStatus
            + (showForensic ? ' on' : '')
            + (!hasForensicDetail ? ' muted' : '')}
          disabled={!hasForensicDetail}
          aria-expanded={hasForensicDetail ? showForensic : undefined}
          onClick={hasForensicDetail ? () => setShowForensic((v) => !v) : undefined}
          title={mediaCapable ? t.feedMediaStatusTip[mediaStatus] : t.feedForensicDetailTip}
        >
          <Flag size={14} /> {mediaCapable ? t.feedMediaStatus[mediaStatus] : t.feedForensicDetail}
        </button>
      )}
      {/* Recheck — quietly re-open the original to refresh its metrics + re-run
          the check (the LIGHT version: no media stored). Adds a fresh point to
          the post's popularity-over-time trend. docs/redesign/TODO.md #2. */}
      {canRecheck && (
        <button
          type="button"
          className={'fc-action-btn recheck' + (recheckPhase !== 'idle' ? ' ' + recheckPhase : '')}
          disabled={recheckPhase === 'busy'}
          onClick={() => void handleRecheckClick()}
          title={t.feedRecheckTip}
        >
          <RotateCw size={14} className={recheckPhase === 'busy' ? 'fc-spin' : undefined} />{' '}
          {recheckPhase === 'busy'
            ? t.feedRechecking
            : recheckPhase === 'done' ? t.feedRecheckedNow
            : recheckPhase === 'failed' ? t.feedRecheckFailed : t.feedRecheck}
        </button>
      )}
    </div>
  );

  // Right-stacked record meta: this record's serial, capture time, and platform.
  // (Provenance "served in feed" stays OFF the card face — forgeable until the
  // extractor can prove feed vs profile vs followed, docs/redesign/TODO.md #5.)
  const rmetaNode = (
    <div className="fc-tl-rmeta">
      {typeof record.chainPosition === 'number' && (
        <span className="fc-serial" title={t.feedSerialTip}>#{record.chainPosition}</span>
      )}
      {/* The card face answers "when was I looking at this", so it is the
          reader's own clock. The record's sealed instant is one hover away,
          named as UTC in words rather than left as a raw ISO string. */}
      <span className="fc-tl-time" title={t.utcStamp(formatUtcStamp(record.timestamp))}>{formatTimeLocal(record.timestamp, lang)}</span>
      <span className="fc-tl-platform" style={{ ['--platform-color' as never]: platformColor }}>
        <i className="pdot" />{platformLabel}
      </span>
    </div>
  );

  const className =
    'feed-card fc-tl-card fc-platform-shell fc-platform-' + shell + ' '
    + (isInGroup ? 'in-group' : 'standalone')
    + (feedback?.feedback === 'disputed' ? ' disputed-by-parent' : '');

  // Timeline-spine card: head (avatar · who · record meta) → media → verbatim
  // quote + readings (bodyNode) → foot (reach metrics + actions). The gutter
  // rail + severity node-circle are drawn by the parent row, not the card.
  return (
    <article className={className} style={{ ['--platform-color' as never]: platformColor }}>
      {/* i18n audit found 2026-09-18: this text used to be a CSS
          `content: 'you disputed this'` on .feed-card.disputed-by-parent::after
          (dashboard-design.css), which cannot be translated and never reaches
          the four language string tables. Rendered here instead so the words
          exist in the DOM; the inline style mirrors the CSS rule being
          retired alongside it (this file does not own the stylesheet;
          .feed-card already carries position: relative for this anchor). The
          key it asked for was added 2026-09-19; until then this printed in
          English on every non-English dashboard, which is the half of that
          audit that had not landed. */}
      {feedback?.feedback === 'disputed' && (
        <span
          style={{
            position: 'absolute', top: 14, right: 14,
            fontSize: 12, fontWeight: 700, letterSpacing: '0.02em',
           
            padding: '3px 8px', borderRadius: 0,
            background: 'var(--fw-red-soft)', color: 'var(--fw-red)',
          }}
        >
          {t.feedYouDisputedThis}
        </span>
      )}
      <div className="fc-tl-head">
        {avatarNode}
        {whoNode}
        {rmetaNode}
      </div>

      {bodyNode}

      <div className="fc-tl-foot">
        {metricRow}
        {actionsNode}
      </div>
      {hasForensicDetail && (
        <div className={'fc-drawer-wrap' + (showForensic ? ' open' : '')} aria-hidden={!showForensic}>
          <ForensicDetailDrawer record={record} room={roomReading} />
        </div>
      )}
    </article>
  );
}

// Source chip — WHO posted this item, on the card meta line. Renders ONLY when
// the record carries a derived `accountType` (new records); legacy records with
// no label stay silent rather than claim a type we never proved. A person is
// the default and says nothing, so the chip stays off for it: on X every post
// is a person, and a "Person" chip beside every count read as noise
// (likes and quoted posts looked as if they named a person). The
// Facebook group chip appends the group's name (sourceContainer). Icons: group
// / page / advertiser. Honest, DOM-derived (deriveAccountType), never guessed.
/**
 * What the page carried against what the screen showed, under the item's
 * text. A fragment says how much the page held and that the rest sat behind a
 * control; a fold by style says the page held the whole text. Nothing for a
 * whole item, and nothing for a record the detector never saw.
 */
export function TextCaptureNote({ record }: { record: ForensicRecord }) {
  const t = useDashboardT();
  if (record.textCapture === 'cut') {
    return <span className="fc-text-capture">{t.feedTextCapture.cut(record.originalLength)}</span>;
  }
  if (record.textCapture === 'folded') {
    return <span className="fc-text-capture">{t.feedTextCapture.folded}</span>;
  }
  return null;
}

/**
 * True when "too harmful to rewrite" is what the record says: no decision block (a hide from
 * before the block existed), or the table itself chose a hide and no rewrite was tried first.
 * A hide that came from elsewhere (a video the Child setting skips at a severity where the table
 * asked only for a mark, a hide after a rewrite that did not land, a rule of the household's own)
 * gives no such reason.
 */
function hideIsTooHarmfulToRewrite(record: ForensicRecord): boolean {
  // A rule or a limit hid this and nothing was read as harm: a Reels switch, a time limit, an AI label,
  // or the household's own word. "Too harmful" would put a finding on what an instruction did.
  if (record.verdict === 'blocked') return false;
  const d = record.decision;
  return !d || (d.action === 'hide' && d.rewrite?.attempted !== true && d.row !== 'R1');
}

/**
 * This item carried no words of its own, so the verdict on this card was read
 * from the comments under it (ForensicRecord.verdictOrigin === 'room';
 * PLAN-2026-09-14 standing decision 3). The comments it was read from are in
 * the record in their own right, grouped under this same item.
 *
 * Nothing for every other record, which is the ordinary case: absent means the
 * verdict was read from the item itself, and a card that says nothing here is
 * making the ordinary claim, not a weaker one.
 */
function RoomVerdictNote({ record }: { record: ForensicRecord }) {
  const t = useDashboardT();
  if (record.verdictOrigin !== 'room') return null;
  return <span className="fc-room-verdict">{t.feedRoomVerdict}</span>;
}

/**
 * A reading the person asked for with the Read this for me button
 * (export-numbers.ts isButtonReading). The feed did not serve it and no count
 * includes it; the card is the one place that can say so. Nothing for every
 * other record.
 */
export function ReadingAskedNote({ record }: { record: ForensicRecord }) {
  const t = useDashboardT();
  if (!isButtonReading(record)) return null;
  return <span className="fc-room-verdict">{t.feedReadingAsked}</span>;
}

/**
 * Why the product acted, in the policy row's own words, and who was declared at
 * the keyboard (docs/design/DECISION-BLOCK-2026-09-07.md section 4). Nothing
 * for a record without a decision block: absent states nothing, never "allowed".
 */
export function DecisionNote({ record }: { record: ForensicRecord }) {
  const t = useDashboardT();
  const lang = useUiLanguage();
  const d = record.decision;
  if (!d && !record.reader) return null;
  const why = d ? whyWords(lang, d.row, d.reading?.family, d.household.topicRule) : undefined;
  const match = d?.rails.find((r) => r.match)?.match;
  // A mask stacks on allow by design, so its one outcome is said once, as the export card says it:
  // "shown, shown as shown with swearing starred" repeats the word and invites a search for an override.
  const stacked = !!d && d.action === 'allow' && d.applied === 'mask';
  // The sponsored row asks for a fold, and the person's Block ads switch takes the ad off the page, so every hidden ad
  // was signed "folded, shown as hidden" with the sentence about an older path acting first. The reason is known: the
  // ad was hidden, and that is all the card says. Any other note on an ad still shows.
  const adHidden = !!d && isHiddenAd(record) && d.applied === 'hide';
  const action = d ? t.feedDecisionAction[adHidden ? 'hide' : stacked ? 'mask' : d.action] : undefined;
  const applied = d && !stacked && !adHidden && d.applied !== d.action ? t.feedDecisionAction[d.applied] : undefined;
  // The record's own note, so a hide that could not be applied says so on the card as it does in the export.
  const note = d && !(adHidden && typeof d.note === 'string' && DECISION_NOTE_KEYS[d.note] === 'feedNoteLegacyActed') ? decisionNoteWords(lang, d.note, record.visualApplied) : null;
  return (
    <span className="fc-decision">
      {d && (
        <span className="fc-decision-why">
          {t.feedWhy}: {why ?? d.row}{match ? ` ("${match}")` : ''} · {action}
          {applied ? `, ${t.feedDecisionShownAs} ${applied}` : ''}
          {note ? ` · ${note}` : ''}
        </span>
      )}
      {/* 'default' is READER_DEFAULT (content/record/decision.ts), the value when nobody was declared; it read as a person's name. The export says the same words (2026-09-20). */}
      {record.reader && <span className="fc-decision-reader"> · {t.feedReader}: {record.reader === 'default' ? t.feedReaderDefault : record.reader}</span>}
    </span>
  );
}

export function SourceChip({ record }: { record: ForensicRecord }) {
  const t = useDashboardT();
  const acct = record.accountType;
  if (!acct || acct === 'person') return null;
  const Icon = acct === 'group' ? Users : acct === 'page' ? Building : acct === 'advertiser' ? Megaphone : User;
  return (
    <span className={'fc-source-chip ' + acct} title={t.accountFilterLabel}>
      <Icon size={12} />
      {t.sourceChipLabels[acct]}
      {acct === 'group' && record.sourceContainer && (
        <span className="fc-source-name">· {record.sourceContainer}</span>
      )}
    </span>
  );
}

// Display-only metric row. Reads only fields that exist on RecordMetrics;
// renders only what was captured (never zero-fills). likes_obscured →
// strike-through like slot + "likes hidden by platform" pill. hideEngagement →
// every count struck-through (what FW suppressed for the kid). Each platform
// shows the metric set it actually exposes, with the platform-correct "like"
// icon (heart for X/TikTok/Instagram, thumbs-up for Facebook/YouTube).
// When `growth` is present the row shows the LATEST sighting's numbers plus a
// "+N since <date>" delta line (the "Update Metrics" forensic-growth readout).
function PlatformMetricRow({
  shell, metrics, envMetrics, hideEngagement, obscuredLabel, growth,
}: {
  shell: Shell;
  metrics: ForensicRecord['metrics'];
  envMetrics: NonNullable<ForensicRecord['environment']>['metrics'];
  hideEngagement: boolean;
  obscuredLabel: string;
  growth?: MetricGrowth | null;
}) {
  const t = useDashboardT();
  const lang = useUiLanguage();
  // When this item has multiple sightings, show the latest numbers (the most
  // recent recheck) rather than this card's own (possibly older) capture.
  const m = growth?.latest ?? metrics;
  const likes = m?.primary_likes ?? m?.likes ?? envMetrics?.likes;
  const replies = m?.comments_count ?? m?.reply_count ?? envMetrics?.comments;
  const views = m?.views ?? envMetrics?.views;
  const shares = m?.shares ?? envMetrics?.shares;
  const obscured = !!m?.likes_obscured;

  // Facebook + YouTube call the primary reaction a "like" with a thumbs-up;
  // X / TikTok / Instagram use a heart. (Instagram's count is policy-obscured.)
  const LikeIcon = (shell === 'facebook' || shell === 'youtube') ? ThumbsUp : Heart;

  const items: React.ReactNode[] = [];
  const cls = 'm' + (hideEngagement ? ' fc-metric-obscured' : '');

  // Like slot: obscured pill (Instagram) takes precedence over a count.
  if (obscured) {
    items.push(
      <span key="lk" className="m fc-metric-obscured">
        <LikeIcon size={13} /> {obscuredLabel}
      </span>,
    );
  } else if (likes != null) {
    items.push(<span key="lk" className={cls}><LikeIcon size={13} /> <b>{formatCompact(likes, lang)}</b></span>);
  }

  if (replies != null) {
    items.push(<span key="rp" className={cls}><MessageCircle size={13} /> <b>{formatCompact(replies, lang)}</b></span>);
  }

  // X-only secondary metrics, display-only mono counters.
  if (shell === 'x') {
    if (m?.retweets != null) items.push(<span key="rt" className={cls}><b>{formatCompact(m.retweets, lang)}</b> {t.feedMetricWord('reposts', m.retweets)}</span>);
    if (m?.quote_tweets != null) items.push(<span key="qt" className={cls}><b>{formatCompact(m.quote_tweets, lang)}</b> {t.feedMetricWord('quotes', m.quote_tweets)}</span>);
    if (m?.bookmarks != null) items.push(<span key="bm" className={cls}><b>{formatCompact(m.bookmarks, lang)}</b> {t.feedMetricWord('bookmarks', m.bookmarks)}</span>);
  } else if (shares != null) {
    items.push(<span key="sh" className={cls}><b>{formatCompact(shares, lang)}</b> {t.feedMetricWord('shares', shares)}</span>);
  }

  if (views != null) {
    items.push(<span key="vw" className={cls}><Eye size={13} /> <b>{formatCompact(views, lang)}</b></span>);
  }

  const growthLine = growth && growth.deltas.length > 0 ? (
    <div className="fc-metric-growth" title={t.feedGrowthTip(growth.sightings)}>
      <span className="fc-metric-growth-arrow" aria-hidden="true">↑</span>
      {growth.deltas.map((d) => (
        <span key={d.key} className="fc-metric-growth-item">
          {(d.delta > 0 ? '+' : '−') + formatCompact(Math.abs(d.delta), lang)} {t.feedMetricWord(growthWordKey(d.key), Math.abs(d.delta))}
        </span>
      ))}
      <span className="fc-metric-growth-since">{t.feedGrowthSince(formatDateLocal(growth.sinceTs, lang))}</span>
    </div>
  ) : null;

  if (items.length === 0 && !growthLine) return null;

  return (
    <>
      {items.length > 0 && <span className="reach">{items}</span>}
      {growthLine}
    </>
  );
}

// Map a RecordMetrics growth key to the metric word shown in the delta line.
function growthWordKey(k: GrowthKey): MetricWord {
  switch (k) {
    case 'primary_likes': case 'likes': return 'likes';
    case 'views':         return 'views';
    case 'shares':        return 'shares';
    case 'comments_count': return 'comments';
    case 'reply_count':   return 'replies';
    case 'retweets':      return 'reposts';
    case 'quote_tweets':  return 'quotes';
    case 'bookmarks':     return 'bookmarks';
  }
}

// Forensic-detail drawer: the load-bearing evidence surface. A video record's
// eyes (on-screen text + scene) and ears (transcript) readings, the comment-
// section "room" combined reading, plus the chain provenance (frames sent,
// model ids, severity, chain position, integrity fingerprint), live here — OFF
// the card face — so the parent can review the COMPLETE captured evidence,
// never a "trust me" summary (a standing product decision, 2026-06-14, docs/redesign/TODO.md #4). Each
// layer is labeled by the sensor that produced it; AI-derived layers carry the
// BETA pill. Opened by the "forensic detail" action. Display-only — no chain
// change. The video frames themselves are never stored; only this derived text.
function ForensicDetailDrawer({ record, room }: {
  record: ForensicRecord;
  room?: NonNullable<ForensicRecord['environment']>;
}) {
  const t = useDashboardT();
  const vc = record.videoContext;
  // A room reading exists only where a model read the comment section, so its presence is that record's own state.
  const byModel = readByModel(record) || Boolean(room);
  if (!vc && !room) return null;

  // Chain & provenance rows — only the facts the video record actually carries.
  const facts: Array<[string, string]> = [];
  if (vc) {
    if (vc.contentType) facts.push([t.feedFactContentType, vc.contentType]);
    facts.push([t.feedFactFrames, `${vc.frameCount} · ${vc.model}`]);
    if (vc.audioModel) facts.push([t.feedFactAudioModel, vc.audioModel]);
    if (typeof vc.severity === 'number') facts.push([t.feedFactSeverity, `${vc.severity}/10`]);
    // The drawer is the evidence surface: this instant stays on the record's
    // own clock, named in words (t.utcStamp) so it is not read against the
    // local times on the card face above it.
    facts.push([t.feedFactRecordedAt, t.utcStamp(formatUtcStamp(record.timestamp))]);
    if (typeof record.chainPosition === 'number') facts.push([t.feedFactChainPosition, `#${record.chainPosition}`]);
    if (record.signature) facts.push([t.feedFactHash, shortFingerprint(record.signature)]);
  }

  return (
    <div className="fc-drawer">
      <div className="fc-drawer-body">
        {vc && (
          <div className="fc-layers">
            {/* On-screen text is DOM-captured (the poster's own burned-in text),
                not an AI reading — no BETA pill. */}
            {vc.overlayText && (
              <div className="fc-layer">
                <div className="fc-layer-label">{t.feedVideoOnScreen}</div>
                <div className="fc-layer-text">{vc.overlayText}</div>
              </div>
            )}
            {/* Eyes — vision-model scene read. */}
            <div className="fc-layer ai-layer">
              <div className="fc-layer-label">
                {t.feedVideoScene}
                {byModel && <span className="beta-pill" title={t.feedBetaTip}>BETA</span>}
              </div>
              <div className="fc-layer-text">{vc.scene}</div>
            </div>
            {/* Ears — speech-to-text transcript from the audio model. Absence is
                "not captured", never "nothing was said". */}
            <div className="fc-layer ai-layer">
              <div className="fc-layer-label">
                {t.feedVideoSpoken}
                {byModel && <span className="beta-pill" title={t.feedBetaTip}>BETA</span>}
              </div>
              <div className={'fc-layer-text' + (vc.transcript ? '' : ' muted')}>
                {vc.transcript || t.feedVideoNoAudio}
              </div>
            </div>
          </div>
        )}

        {/* Room — the 3rd sensor: the comment section read AS A WHOLE (combined
            tone), folded in as evidence rather than a separate card. */}
        {room && (
          <div className="fc-room">
            <div className="fc-layer ai-layer">
              <div className="fc-layer-label">
                {t.feedRoomTitle}
                {byModel && <span className="beta-pill" title={t.feedBetaTip}>BETA</span>}
              </div>
              <div className="fc-layer-text">{room.summary}</div>
            </div>
            <div className="fc-drawer-facts">
              <div className="fc-drawer-row">
                <span className="fc-drawer-k">{t.feedRoomReactionsLabel}</span>
                <span className="fc-drawer-v">{t.feedRoomReactions(room.negativePct, room.neutralPct, room.positivePct)}</span>
              </div>
              <div className="fc-drawer-row">
                <span className="fc-drawer-k">{t.feedRoomSampledLabel}</span>
                <span className="fc-drawer-v">
                  {room.totalVisible != null ? `${room.sampled} / ${room.totalVisible}` : `${room.sampled}`}
                </span>
              </div>
              {room.dominantTechnique && (
                <div className="fc-drawer-row">
                  <span className="fc-drawer-k">{t.feedRoomDominantLabel}</span>
                  <span className="fc-drawer-v">{t.techniqueLabel(room.dominantTechnique)}</span>
                </div>
              )}
              {/* Structured room analysis (BETA) — shown only when it carries a
                  signal, so a calm room stays uncluttered. */}
              {room.claimVsReaction &&
                room.claimVsReaction !== 'corroborates' &&
                room.claimVsReaction !== 'no-claim' && (
                  <div className="fc-drawer-row">
                    <span className="fc-drawer-k">{t.feedRoomClaimLabel}</span>
                    <span className="fc-drawer-v">{t.feedRoomClaim(room.claimVsReaction)}</span>
                  </div>
                )}
              {room.commentManipulation && room.commentManipulation !== 'none' && (
                <div className="fc-drawer-row">
                  <span className="fc-drawer-k">{t.feedRoomManipulationLabel}</span>
                  <span className="fc-drawer-v">{t.feedRoomManipulation(room.commentManipulation)}</span>
                </div>
              )}
              {room.audienceDistress && (
                <div className="fc-drawer-row">
                  <span className="fc-drawer-k">{t.feedRoomDistressLabel}</span>
                  <span className="fc-drawer-v">{t.feedRoomDistressYes}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {vc && (
          <div className="fc-drawer-facts">
            {facts.map(([k, v], i) => (
              <div key={i} className="fc-drawer-row">
                <span className="fc-drawer-k">{k}</span>
                <span className="fc-drawer-v">{v}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// View-original URL — canonical-form URL derived from `parentVideoId`.
//
// `parentVideoId` on ForensicRecord carries a platform-prefixed identifier
// per video-pipeline.ts:50-82 `derivePlatformVideoId`:
//   • youtube   → `yt-vid-<id>`
//   • tiktok    → `tk-vid-<id>`
//   • instagram → `ig-p-<id>` or `ig-reel-<id>`
// We strip the prefix and build the canonical post URL. For YouTube specifically,
// a `&lc=<commentId>` parameter (when the extractor captured it) deep-links to
// the exact comment instead of the video — closes Inventory Part 7 #4 for YT.
// Resolve the "View original" target for a forensic record. Preference order:
//   1. anchorUrl — the exact-comment deep-link (X reply status URL, IG /c/
//      link). Lands ON the specific comment, not just the post; captured
//      deterministically at extraction (from the comment's own id), so it is
//      NOT subject to the post-navigation staleness that demotes postUrl.
//      Matches the standalone export's "open the exact comment" link.
//   2. canonicalUrl from parentVideoId — deterministic post/video URL.
//   3. postUrl — captured at write time; can be stale if the user SPA-
//      navigated away before the async scoring step logged the record.
//   4. roomUrl — the comment-section/room URL.
// Returns null when none is available (the button renders disabled).
/**
 * True when a URL already carries an EXACT-COMMENT deep-link that lands on (and
 * usually highlights) the specific comment rather than the post/video:
 *   • YouTube   `…&lc=<commentId>`
 *   • Facebook  `…?comment_id=<id>` / `…&comment_id=<id>`
 *   • Instagram `…/c/<id>`
 * X reply links are already routed through `anchorUrl`, so they don't need this.
 */
function isCommentDeepLink(u: string | null | undefined): boolean {
  return !!u && /[?&]lc=|[?&]comment_id=|\/c\/\d+/.test(u);
}

/**
 * True for a bare platform-root URL ("https://www.facebook.com/",
 * "https://x.com/home") — the home-feed fallback captured when no permalink
 * existed at write time. Landing there is misleading ("view original" → the
 * platform's front page), so such URLs are treated as no-URL and the button
 * disables honestly (reported live, 2026-06-11, Facebook records).
 */
function isBareOriginUrl(u: string | null): boolean {
  if (!u) return false;
  try {
    const parsed = new URL(u);
    const path = parsed.pathname.replace(/\/+$/, '');
    return (path === '' || path === '/home' || path === '/foryou') && !parsed.search;
  } catch {
    return false;
  }
}

export function resolveViewOriginalUrl(record: ForensicRecord): string | null {
  const canonicalUrl = record.parentVideoId
    ? buildPlatformFallbackUrl(record.platform, record.parentVideoId, record.author)
    : null;
  const nonEmpty = (u: string | undefined): string | null =>
    (u && u.length > 0 && !isBareOriginUrl(u)) ? u : null;
  const anchorUrl = nonEmpty(record.anchorUrl);
  const postUrl = nonEmpty(record.postUrl);
  const roomUrl = nonEmpty(record.roomUrl);
  // A postUrl that already encodes an exact-comment deep-link IS the locked-
  // position target and must beat the bare canonical URL. Pre-fix, canonicalUrl
  // (rebuilt from parentVideoId WITHOUT the comment id) shadowed it, so "view
  // original" on a YouTube comment landed on the video and the user had to hunt
  // for the comment (found 2026-06-04).
  return (
    anchorUrl
    ?? (isCommentDeepLink(postUrl) ? postUrl : null)
    ?? canonicalUrl
    ?? postUrl
    ?? roomUrl
  );
}

function buildPlatformFallbackUrl(
  platform: ForensicRecord['platform'],
  parentVideoIdOrRawId: string,
  author?: string,
): string | null {
  // Strip platform prefix when present so the URL builds correctly whether
  // the caller passed `parentVideoId` (prefixed) or a raw id.
  const id = stripParentVideoIdPrefix(platform, parentVideoIdOrRawId);
  switch (platform) {
    case 'twitter':   return `https://x.com/i/web/status/${id}`;
    case 'instagram': return parentVideoIdOrRawId.startsWith('ig-reel-')
      ? `https://www.instagram.com/reel/${id}/`
      : `https://www.instagram.com/p/${id}/`;
    case 'youtube':   return `https://www.youtube.com/watch?v=${id}`;
    case 'tiktok': {
      // A TikTok permalink needs the creator handle — the empty `@/video/<id>`
      // form does NOT resolve (it dead-ended "View original" + hid "Update
      // Metrics" on TikTok records, found 2026-06-16). Use the captured author
      // when we have one; otherwise return null so the resolver falls back to a
      // real postUrl / roomUrl rather than a broken link.
      const handle = author && author !== 'unknown' && author.trim().length > 0
        ? (author.startsWith('@') ? author : '@' + author)
        : null;
      return handle ? `https://www.tiktok.com/${handle}/video/${id}` : null;
    }
    case 'facebook':
    default:          return null;
  }
}

function stripParentVideoIdPrefix(platform: ForensicRecord['platform'], id: string): string {
  if (platform === 'youtube' && id.startsWith('yt-vid-')) return id.slice('yt-vid-'.length);
  if (platform === 'tiktok' && id.startsWith('tk-vid-')) return id.slice('tk-vid-'.length);
  if (platform === 'instagram' && id.startsWith('ig-p-')) return id.slice('ig-p-'.length);
  if (platform === 'instagram' && id.startsWith('ig-reel-')) return id.slice('ig-reel-'.length);
  return id;
}

function detectionModeLabel(mode: string): string {
  // mode format: 'block:<reason>:<token>'. Extract the reason segment.
  // Returns the STABLE English category key (filter/color key); localization
  // happens at the display point via t.blockedCategoryLabel(key).
  const parts = mode.split(':');
  return BLOCKED_CATEGORY_LABELS[parts[1]] ?? 'Hidden';
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

// A short, human-scannable fingerprint of the record's signature for the
// "integrity hash" row — first 16 alphanumerics grouped in fours (2aa9-71ce-…).
// The full signature is what actually verifies; this is a glanceable identifier.
function shortFingerprint(signature: string): string {
  const clean = signature.replace(/[^a-zA-Z0-9]/g, '').slice(0, 16);
  return clean.replace(/(.{4})(?=.)/g, '$1-');
}
