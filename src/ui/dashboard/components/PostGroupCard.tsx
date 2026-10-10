// src/ui/dashboard/components/PostGroupCard.tsx
// Surface-ID: post-group-card (1.4.5) + synthetic-post-header (1.4.6)
//
// One social item = one card. A single TikTok video can produce a caption
// record, a video-understanding record (videoContext) and a duplicate caption
// per re-serve — all kind video/post under the same group key. This card
// merges them into ONE unified post card (header + caption + evidence layers
// + sightings line + one action row) instead of stacking sub-cards, with the
// comment records in a scrollable section underneath. PROP CONTRACT
// UNCHANGED — accepts the same RecordGroup shape produced by
// groupRecordsByPost() in Dashboard.tsx.

import * as React from 'react';
import { useState, type ReactNode } from 'react';
import type { ForensicRecord } from '../../../types/forensic';
import type { ParentFeedback } from '../../../forensics/store';
import type { MetricGrowth } from './metric-growth';
import { FeedCard, TimelineRow } from './FeedCard';
import { PLATFORM_COLORS, PLATFORM_LABELS } from './color-maps';
import { authorProfileKey } from '../../../forensics/author-store';
import {
  ChevronDown, ChevronRight, ExternalLink,
} from '../../shared/icons/lucide';
import { useDashboardT, useUiLanguage } from '../../../i18n/react';
import { formatTimeLocal, formatUtcStamp } from '../../shared/format-time';
import { isFlaggedVerdict, isHiddenAsHarmful, isRoomSummary, isRuleBlocked, itemOutcomeOf } from '../record-sets';

export interface RecordGroup {
  key: string;
  postRecord: ForensicRecord | null;
  roomAuthor: string;
  roomCaption: string;
  roomUrl: string;
  platform: ForensicRecord['platform'];
  latestTs: string;
  /**
   * Serve bounds, in the order the reader actually saw this group, and the
   * browsing session it belongs to.
   *
   * `latestTs` above is a WRITE time, which is completion order and measurably
   * disagrees with seen order for 14% of adjacent records. Any statement about
   * time BETWEEN things served has to use these instead; the feed's own sort
   * already does. `sessionKey` matters because a platform can only change at a
   * session boundary, so a gap that spans one is not a gap between two
   * consecutive items.
   */
  firstSeenAt: string;
  lastSeenAt: string;
  sessionKey: string;
  children: ForensicRecord[];
  flaggedCount: number;
  blockedCount: number;
}

export interface PostGroupCardProps {
  group: RecordGroup;
  feedbackMap: Map<string, ParentFeedback>;
  onConfirm: (r: ForensicRecord) => void;
  onDispute: (r: ForensicRecord) => void;
  onViewOriginal: (r: ForensicRecord, url: string | null) => void;
  onRecheck?: (r: ForensicRecord, url: string | null) => Promise<boolean>;
  hideEngagement?: boolean;
  recidivistSet?: Set<string>;
  /** recordId → engagement growth (latest-vs-first), forwarded to each FeedCard. */
  growthByRecordId?: Map<string, MetricGrowth>;
  /**
   * Thread state lifted to the owner, keyed by group.key (finding 14). The
   * feed's virtualizer unmounts a row scrolled out of the window; with the
   * state here, scrolling back finds the thread as the reader left it. When
   * the owner passes none of these, the card keeps the state locally.
   */
  expanded?: boolean;
  onToggleExpanded?: () => void;
  shownComments?: number;
  onShowMoreComments?: (page: number) => void;
  /**
   * A row drawn above the card inside the same measured element (the feed's
   * session and platform-switch dividers). Outside it, the virtualizer never
   * measured the divider and every one scrolled past shifted the offsets
   * (wiring audit 13 Sep, D1-12).
   */
  above?: ReactNode;
}

/** Comment rows rendered per "Show more" press. */
const COMMENT_PAGE = 8;

export interface GroupInventoryCounts {
  checks: number;
  comments: number;
  aiSummaries: number;
}

export function countGroupInventory(group: RecordGroup): GroupInventoryCounts {
  const all = group.postRecord ? [group.postRecord, ...group.children] : group.children;
  return {
    checks: all.filter((r) => r.kind === 'post' || r.kind === 'video').length,
    comments: group.children.filter(
      (r) => r.kind !== 'post' && r.kind !== 'video' && !isRoomSummary(r),
    ).length,
    aiSummaries: group.children.filter(isRoomSummary).length,
  };
}

export function PostGroupCard({
  group, feedbackMap, onConfirm, onDispute, onViewOriginal, onRecheck, hideEngagement, recidivistSet, growthByRecordId,
  expanded: expandedProp, onToggleExpanded, shownComments: shownCommentsProp, onShowMoreComments, above,
}: PostGroupCardProps) {
  const t = useDashboardT();
  // Comments are COLLAPSED by default — the comment button is what expands
  // them, like a real feed (design decision, 2026-06-13, supersedes the
  // 2026-06-12 open-by-default).
  const [expandedLocal, setExpandedLocal] = useState(false);
  // Comment pagination — render the first page of comment cards, then a
  // "Show N more · #range" control that grows the window. Replies render
  // inline under their parent comment via FeedCard, so paging counts the
  // top-level comment rows the thread lays out.
  const [shownCommentsLocal, setShownCommentsLocal] = useState(COMMENT_PAGE);
  // Owner-held state wins when given (see PostGroupCardProps.expanded).
  const expanded = expandedProp ?? expandedLocal;
  const toggleExpanded = onToggleExpanded ?? (() => setExpandedLocal((v) => !v));
  const shownComments = shownCommentsProp ?? shownCommentsLocal;
  const showMoreComments = onShowMoreComments
    ? () => onShowMoreComments(COMMENT_PAGE)
    : () => setShownCommentsLocal((n) => n + COMMENT_PAGE);
  // Total entities in this group: the post (if captured) + each child record.
  // When a group has only ONE entity (e.g. a single Twitter post with no
  // recorded comments, or an isolated comment whose parent post was never
  // captured), render that one entity as a plain FeedCard. The PostGroupCard
  // wrapper + synthetic header + "▶ 1 comment" toggle only earn their weight
  // when there are multiple things to group.
  // Recorded replies per comment: children that name another child as their
  // parent via parentRecordId. Lets each comment card say "N recorded
  // replies" — the platform's reply METRIC can differ (FW only records what
  // was actually on screen).
  const repliesByParent = React.useMemo(() => {
    const m = new Map<string, number>();
    for (const c of group.children) {
      if (c.parentRecordId) m.set(c.parentRecordId, (m.get(c.parentRecordId) ?? 0) + 1);
    }
    return m;
  }, [group.children]);

  // ── Reply → parent-author resolution (within this group only) ──
  // The "↳ replying to @handle" line a reply card shows names the author of
  // the record it answers (parentRecordId). FW only records what was on
  // screen, so the parent may not have been captured — when it's absent from
  // this group, the line is omitted rather than guessed. Built from the
  // group's own records (post + children); never reaches across groups.
  const handleByRecordId = React.useMemo(() => {
    const m = new Map<string, string>();
    const all = group.postRecord ? [group.postRecord, ...group.children] : group.children;
    for (const r of all) {
      const raw = (r.author || '').trim();
      if (raw && raw.toLowerCase() !== 'unknown') {
        m.set(r.id, raw.startsWith('@') ? raw : '@' + raw);
      }
    }
    return m;
  }, [group.postRecord, group.children]);

  // Partition the group. All kind video/post records describe the SAME social
  // item (caption capture, video-understanding capture, duplicate re-serves);
  // everything else is the comment section under it.
  const postKindRecords = React.useMemo(() => {
    const all = group.postRecord ? [group.postRecord, ...group.children] : group.children;
    return all.filter((r) => r.kind === 'post' || r.kind === 'video');
  }, [group.postRecord, group.children]);

  const envRecords = group.children.filter(isRoomSummary);
  const commentRecords = group.children.filter(
    (r) => r.kind !== 'post' && r.kind !== 'video' && !isRoomSummary(r),
  );

  // evidenceRecord: the video/post record carrying videoContext (worst verdict
  // wins when re-serves produced several). captionRecord: the plain-text
  // caption capture (no videoContext).
  const evidenceRecord = pickEvidenceRecord(postKindRecords);
  const captionRecord = postKindRecords.find(
    (r) => !r.videoContext && !!r.originalText && r.originalText.trim().length > 0,
  ) ?? null;
  const primary = evidenceRecord ?? captionRecord ?? postKindRecords[0] ?? null;

  const inventory = countGroupInventory(group);
  const inventoryParts = [
    inventory.checks > 0 ? t.feedTrustCheckedTimes(inventory.checks) : '',
    inventory.comments > 0 ? `${inventory.comments} ${t.feedTrustComments(inventory.comments)}` : '',
    inventory.aiSummaries > 0 ? `${inventory.aiSummaries} ${t.feedTrustAiSummaries(inventory.aiSummaries)}` : '',
  ].filter(Boolean);
  const showInventory =
    inventoryParts.length > 1 || inventory.checks > 1 || inventory.aiSummaries > 0;
  const inventoryLine = showInventory ? (
    <div className="pg-inventory" aria-label={inventoryParts.join(', ')}>
      {inventoryParts.map((part, i) => (
        <React.Fragment key={part}>
          {i > 0 && <span aria-hidden="true">·</span>}
          <span>{part}</span>
        </React.Fragment>
      ))}
    </div>
  ) : null;

  const totalEntities = (group.postRecord ? 1 : 0) + group.children.length;
  // The environment ("room") record is folded into the primary post's
  // forensic-detail drawer (see roomReading below) rather than shown as its own
  // AI-summary card — so it only drives the comment section in the orphan case
  // where there's no primary post to host the drawer.
  const hasComments = commentRecords.length > 0 || (!primary && envRecords.length > 0);
  const canHostComments = (r: ForensicRecord) => r.kind === 'post' || r.kind === 'video';
  // The room reading hosted by the primary post's drawer (worst-verdict env
  // record wins if a re-scan produced several). Undefined when this group has no
  // captured post to fold it into — then it renders as a child card below.
  const roomReading = primary ? envRecords[0]?.environment : undefined;

  if (totalEntities <= 1) {
    const r = group.postRecord ?? group.children[0];
    if (!r) return null;
    const row = (
      <TimelineRow record={r}>
        <FeedCard
          record={r}
          feedback={feedbackMap.get(r.id)}
          onConfirm={onConfirm}
          onDispute={onDispute}
          onViewOriginal={onViewOriginal}
          onRecheck={onRecheck}
          hideEngagement={hideEngagement}
          recidivist={recidivistSet?.has(authorProfileKey(r.author, r.platform))}
          growth={growthByRecordId?.get(r.id) ?? null}
          commentCount={canHostComments(r) ? 0 : undefined}
        />
      </TimelineRow>
    );
    // TimelineRow keys its data-fw-key by record id. The feed's virtualizer
    // measures rows by the GROUP key it asks keyAt() for, and for an orphan
    // comment that is platform:parentVideoId, not the record id, so the row
    // was never measured and kept the 400 px estimate (finding 13). Wrap only
    // when the two differ; the wrapper carries no class so the row's own
    // spine styling is unchanged.
    if (group.key === r.id && !above) return row;
    return <div data-fw-key={group.key}>{above}{row}</div>;
  }

  // ONE clean, centered control: "N comments". Pressing it expands the comment
  // section inline (collapsed by default). No trust-bar chips, no "sorted by
  // serve order" note, no flagged/blocked pills — those cluttered the feed and
  // the "1 post / N AI summaries / checked Nx" labels tested as confusing
  // (usability finding, 2026-06-13).
  const commentsToggle = hasComments && (
    <button
      type="button"
      className="pg-comments-btn"
      onClick={toggleExpanded}
      aria-expanded={expanded}
    >
      {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
      <strong>{commentRecords.length}</strong> {t.grpCommentsWord(commentRecords.length)}
    </button>
  );

  // Env (AI-summary) records always render at the top — they summarize the
  // section. The comment/reply rows below are paginated: the first
  // `shownComments` render, then a "Show N more · #range" control reveals the
  // rest. Reply rows resolve their parent author within the group and pass it
  // to FeedCard as the "↳ replying to @handle" line.
  const visibleComments = commentRecords.slice(0, shownComments);
  const hiddenComments = commentRecords.slice(shownComments);
  const hiddenSerials = hiddenComments
    .map((r) => r.chainPosition)
    .filter((n): n is number => typeof n === 'number' && n >= 0);
  const moreRange = hiddenSerials.length
    ? (() => {
        const lo = Math.min(...hiddenSerials);
        const hi = Math.max(...hiddenSerials);
        return lo === hi ? `#${lo}` : `#${lo}–#${hi}`;
      })()
    : '';

  const renderChild = (child: ForensicRecord) => {
    const replies = repliesByParent.get(child.id) ?? 0;
    const isReply = child.kind === 'reply' || child.kind === 'reply-to-reply';
    const replyingToHandle = isReply && child.parentRecordId
      ? handleByRecordId.get(child.parentRecordId)
      : undefined;
    const depth = child.commentDepth ?? 0;
    return (
      <TimelineRow key={child.id} record={child} rowClass={'sub' + (depth >= 1 ? ' depth2' : '')}>
        <FeedCard
          record={child}
          feedback={feedbackMap.get(child.id)}
          onConfirm={onConfirm}
          onDispute={onDispute}
          onViewOriginal={onViewOriginal}
          onRecheck={onRecheck}
          isInGroup
          hideEngagement={hideEngagement}
          recidivist={recidivistSet?.has(authorProfileKey(child.author, child.platform))}
          recordedReplies={replies}
          replyingToHandle={replyingToHandle}
          growth={growthByRecordId?.get(child.id) ?? null}
        />
      </TimelineRow>
    );
  };

  const commentsSection = expanded && hasComments && (
    <div className="post-group-children">
      {/* The room reading folds into the primary post's drawer; it only renders
          as a child here when there's no primary post to host that drawer. */}
      {!primary && envRecords.map(renderChild)}
      {visibleComments.map(renderChild)}
      {hiddenComments.length > 0 && (
        <button
          type="button"
          className="fx-ledger-expand"
          onClick={showMoreComments}
        >
          {t.fxLedgerMore(moreRange, hiddenComments.length)}
        </button>
      )}
    </div>
  );

  return (
    <div className="post-group" data-fw-key={group.key}>
      {above}
      {primary ? (
        // The grouped post renders through the SAME FeedCard as standalone
        // records, so the feed gets the platform-aware social shell (TikTok
        // vertical video, YouTube header, X thread, etc.). The timeline row
        // hangs it off the chain spine. NOTE: no `is-first` here — that caps the
        // rail above the node, which is only correct for the VERY FIRST record in
        // the feed (handled by the :first-child CSS rule). Applying it per-group
        // put a 27px dead gap above every grouped post, disconnecting the spine
        // (layout finding, 2026-06-16).
        <TimelineRow record={primary}>
          <FeedCard
            record={primary}
            feedback={feedbackMap.get(primary.id)}
            onConfirm={onConfirm}
            onDispute={onDispute}
            onViewOriginal={onViewOriginal}
            onRecheck={onRecheck}
            isInGroup
            hideEngagement={hideEngagement}
            recidivist={recidivistSet?.has(authorProfileKey(primary.author, primary.platform))}
            roomReading={roomReading}
            growth={growthByRecordId?.get(primary.id) ?? null}
            commentCount={commentRecords.length}
            commentsExpanded={expanded}
            onToggleComments={commentRecords.length > 0 ? toggleExpanded : undefined}
          />
        </TimelineRow>
      ) : (
        <>
          {/* The post itself wasn't captured (only comments under it flagged).
              Wrap the synthetic header in a timeline-row lane (empty gutter, no
              node) so it sits on the same rail + left edge as the comment rows
              below it, instead of floating 26px out of alignment. */}
          <div className="fc-tl-row">
            <div className="fc-tl-gutter" />
            <SyntheticPostHeader group={group} onViewOriginal={onViewOriginal} />
          </div>
          {commentsToggle}
        </>
      )}
      {inventoryLine}
      {commentsSection}
    </div>
  );
}

/** The video/post record a group shows: the one carrying videoContext, the worst verdict winning when re-serves
 *  produced several. */
export function pickEvidenceRecord(postKindRecords: readonly ForensicRecord[]): ForensicRecord | null {
  return postKindRecords
    .filter((r) => !!r.videoContext)
    .sort((a, b) => verdictRank(b) - verdictRank(a))[0] ?? null;
}

// Verdict severity order across a group's video/post records — worst wins
// the unified card's single chip: blocked/hidden > flagged > rewritten, marked > passed.
function verdictRank(r: ForensicRecord): number {
  const cls = actionClassOf(r);
  switch (cls) {
    case 'blocked':   return 5;
    case 'hidden':    return 4;
    case 'flagged':   return 3;
    case 'rewritten': return 2;
    case 'manual':    return 2;
    // "Seen a lot" carries a marker on the page: something was done, above a pass (the Head, 10 Oct 2026).
    case 'seenALot':  return 2;
    case 'passed':    return 1;
    default:          return 0;
  }
}

// Same action-label derivation as FeedCard (kept tiny rather than exported —
// FeedCard's version is interleaved with its render).
function actionClassOf(
  r: ForensicRecord,
): 'manual' | 'blocked' | 'passed' | 'rewritten' | 'hidden' | 'flagged' | 'seenALot' | null {
  const reframed = !!r.neutralizedText && r.neutralizedText !== r.originalText;
  if (r.feedSource === 'manual')           return 'manual';
  if (isRuleBlocked(r))                    return 'blocked';
  if (r.verdict === 'pass')                return 'passed';
  if (reframed && r.decision?.applied !== 'mask') return 'rewritten';
  if (r.verdict === 'educational-reframe') return 'rewritten';
  if (isHiddenAsHarmful(r))                return 'hidden';
  if (isFlaggedVerdict(r))                 return 'flagged';
  if (r.verdict === 'harm-floor-trigger')  return 'flagged';
  if (itemOutcomeOf(r) === 'seenALot')     return 'seenALot';
  return null;
}

// Surface-ID: synthetic-post-header (1.4.6) — lightweight header for orphan threads
// where the post itself wasn't captured by the adapter (only comments under it
// got flagged). Uses the denormalized roomAuthor / roomCaption / roomUrl carried
// on the child records.
function SyntheticPostHeader({
  group, onViewOriginal,
}: {
  group: RecordGroup;
  onViewOriginal?: (r: ForensicRecord, url: string | null) => void;
}) {
  const t = useDashboardT();
  const lang = useUiLanguage();
  const platformColor = PLATFORM_COLORS[group.platform];
  const platformLabel = PLATFORM_LABELS[group.platform] ?? group.platform;
  const captionFull = group.roomCaption ?? '';
  const caption = captionFull.slice(0, 200) + (captionFull.length > 200 ? '…' : '');
  const hasUrl = !!(group.roomUrl && group.roomUrl.length > 0);

  return (
    <div className="synthetic-post-header" style={{ ['--platform-color' as never]: platformColor }}>
      <div className="sph-row">
        <strong>
          {group.roomAuthor && group.roomAuthor.toLowerCase() !== 'unknown'
            ? (group.roomAuthor.startsWith('@') ? group.roomAuthor : '@' + group.roomAuthor)
            : (group.roomUrl && /\/reel\//.test(group.roomUrl)
              ? t.feedReelThreadHeader
              : t.feedUnknownAuthor)}
        </strong>
        <span className="fc-platform-name">{platformLabel}</span>
        {/* Reading surface: the reader's clock, with the sealed instant on
            the hover. */}
        <span className="fc-time" title={t.utcStamp(formatUtcStamp(group.latestTs))}>{formatTimeLocal(group.latestTs, lang, true)}</span>
        <span className="sph-orphan-tag">{t.grpOrphanTag}</span>
        {hasUrl && (
          <button
            type="button"
            className="btn sm"
            onClick={() => {
              // No ForensicRecord exists for the synthetic header — fall back
              // to direct URL open (mirrors v1's behavior for orphan threads).
              if (onViewOriginal) {
                // Synthesize a minimal record-shaped stub so the host can route through
                // its open-in-tab handler. The shape only needs `id` + `postUrl`/`roomUrl`
                // for downstream consumers; cast through unknown to satisfy TS.
                const stub = { id: group.key, postUrl: group.roomUrl } as unknown as ForensicRecord;
                onViewOriginal(stub, group.roomUrl);
              } else if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
                void chrome.tabs.create({ url: group.roomUrl, active: true });
              } else {
                window.open(group.roomUrl, '_blank', 'noopener,noreferrer');
              }
            }}
          >
            <ExternalLink size={12} /> {t.grpViewOriginal}
          </button>
        )}
      </div>
      {caption && <div className="sph-caption">{caption}</div>}
      <div className="sph-footer">
        {t.grpOrphanFootnote}
      </div>
    </div>
  );
}
