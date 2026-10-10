// Activity tab — post-grouping (tree view).
//
// Pure transform: ForensicRecord[] → RecordGroup[] (one group per post/thread,
// comments nested under their parent). Extracted from Dashboard.tsx so the
// grouping contract can be unit-tested directly without mounting the React tree
// (same pattern as metric-growth.ts / group-behavior.ts).

import type { ForensicRecord } from '../../../types/forensic';
import type { RecordGroup } from './PostGroupCard';
import { platformPostIdFromUrl } from '../../../core/platform-post-id';
import { isFlaggedItem } from '../record-sets';

export function groupRecordsByPost(records: ForensicRecord[]): RecordGroup[] {
  const map = new Map<string, RecordGroup>();

  // Pre-scan the platform-scoped keys that COMMENTS reference as their parent.
  // A post/video that lacks a stamped parentVideoId (an X focused tweet —
  // twitter.ts stamps parentVideoId only on the focused tweet's CHILDREN, never
  // on the focused tweet itself) can then adopt its OWN platform id, derived
  // from its postUrl via the SAME helper that produced the comments' ids, as the
  // group key — but ONLY when a comment actually references it. That merges the
  // focused tweet with its reply thread instead of orphaning the replies under a
  // post-less group while the tweet sits alone. Scoping to referenced ids keeps
  // posts with no captured comments standalone (no home-feed re-sighting merge).
  const referencedParentKeys = new Set<string>();
  for (const r of records) {
    // Any record that points at a parent marks that post-key as referenced:
    // comments AND video-context records (whose parentVideoId is the analysed
    // post's own id — forensic-join stamps it from the post URL). Including
    // video records lets a post merge with its video-analysis even when no
    // comment was captured (the common scroll-past case — a real export,
    // 2026-06-26, had 215/235 such Twitter videos with no parentVideoId at
    // all, now stamped, but a post with only a video and no comment would
    // still split without this).
    if (r.parentVideoId) {
      referencedParentKeys.add(`${r.platform}:${r.parentVideoId}`);
    }
  }

  for (const r of records) {
    const isPostKind = r.kind === 'post' || r.kind === 'video';
    // Group key: parentVideoId for comments; the record's own id for top-level
    // posts/videos AND for legacy records lacking parentVideoId (so they show
    // as standalone single-row groups). The parentVideoId branch is scoped by
    // platform so two unrelated posts that share a raw parentVideoId across
    // platforms (e.g. a Twitter status id numerically equal to a Facebook post
    // id) cannot merge into one thread — the wrong-parent / orphan-thread bug.
    // The record's own id is already globally unique (logger stamps `fr-*`), so
    // the standalone fallback needs no platform scoping.
    let key: string;
    if (r.parentVideoId) {
      key = `${r.platform}:${r.parentVideoId}`;
    } else if (isPostKind) {
      const ownId = platformPostIdFromUrl(r.platform, r.postUrl);
      const ownKey = ownId ? `${r.platform}:${ownId}` : null;
      key = ownKey && referencedParentKeys.has(ownKey) ? ownKey : r.id;
    } else {
      key = r.id;
    }

    let g = map.get(key);
    if (!g) {
      g = {
        key,
        postRecord: null,
        roomAuthor: '',
        roomCaption: '',
        roomUrl: '',
        platform: r.platform,
        latestTs: r.timestamp,
        firstSeenAt: '',
        lastSeenAt: '',
        sessionKey: '',
        children: [],
        flaggedCount: 0,
        blockedCount: 0,
      };
      map.set(key, g);
    }

    if (r.timestamp > g.latestTs) g.latestTs = r.timestamp;

    if (isPostKind && !g.postRecord) {
      g.postRecord = r;
    } else {
      g.children.push(r);
    }

    if (isFlaggedItem(r)) g.flaggedCount++;
    if (r.verdict === 'blocked') g.blockedCount++;

    if (!g.roomAuthor && r.roomAuthor) g.roomAuthor = r.roomAuthor;
    if (!g.roomCaption && r.roomCaption) g.roomCaption = r.roomCaption;
    if (!g.roomUrl && r.roomUrl) g.roomUrl = r.roomUrl;
  }

  // Backfill header context from the post record itself when comments didn't
  // carry denormalized room fields (e.g., older records).
  for (const g of map.values()) {
    if (g.postRecord) {
      if (!g.roomAuthor) g.roomAuthor = g.postRecord.author || 'unknown';
      if (!g.roomCaption) g.roomCaption = g.postRecord.originalText || '';
      if (!g.roomUrl) g.roomUrl = g.postRecord.postUrl || '';
    }
  }

  // Sort children: media-evidence records first (the video/image
  // understanding verdict belongs directly under the post header, not among
  // the comments), then by tree depth (top-level comments before replies),
  // then in the order the child SAW them (observedSequence when both carry
  // it — completion order lies about slow AI verdicts), then by timestamp
  // ascending so a reply appears below the comment it replied to.
  for (const g of map.values()) {
    g.children.sort((a, b) => {
      const va = a.kind === 'video' || a.kind === 'post' || a.kind === 'image' ? 0 : 1;
      const vb = b.kind === 'video' || b.kind === 'post' || b.kind === 'image' ? 0 : 1;
      if (va !== vb) return va - vb;
      const da = a.commentDepth ?? 0;
      const db = b.commentDepth ?? 0;
      if (da !== db) return da - db;
      if (typeof a.observedSequence === 'number' && typeof b.observedSequence === 'number' &&
          a.surfaceSessionId === b.surfaceSessionId) {
        return a.observedSequence - b.observedSequence;
      }
      return a.timestamp.localeCompare(b.timestamp);
    });
  }

  // Feed order = REPLAY order (product decision, 2026-07-02: a fresh chain
  // should show the first post seen first, not the sixth). Sessions sort
  // newest-first so recent activity stays on top of a long chain, but WITHIN
  // a browsing session groups render in the order the child actually saw
  // them (min observedSequence; viewportSeenAt/timestamp fallback) — the
  // chain's write order is COMPLETION order and measurably lies (14% of
  // adjacent records in the 2026-07-01 export are inverted vs seen order).
  // Records without impression fields (pre-0d builds) fall back to their
  // write timestamp, which for them is the only observation anchor.
  interface GroupOrder { session: string; seenAt: string; seq: number; serial: number }
  const order = new Map<RecordGroup, GroupOrder>();
  const sessionStart = new Map<string, string>();
  for (const g of map.values()) {
    const members = g.postRecord ? [g.postRecord, ...g.children] : g.children;
    let session = '';
    let seenAt = '';
    let lastSeen = '';
    let seq = Number.MAX_SAFE_INTEGER;
    let serial = -1;
    for (const m of members) {
      const at = m.viewportSeenAt ?? m.timestamp;
      if (!seenAt || at < seenAt) seenAt = at;
      if (!lastSeen || at > lastSeen) lastSeen = at;
      if (m.surfaceSessionId && !session) session = m.surfaceSessionId;
      if (typeof m.observedSequence === 'number' && m.observedSequence < seq) seq = m.observedSequence;
      if ((m.chainPosition ?? -1) > serial) serial = m.chainPosition ?? -1;
    }
    // Session-less (legacy) groups are their own singleton session so they
    // interleave with real sessions by time, preserving newest-first reading.
    const sessionKey = session || `solo:${g.key}`;
    order.set(g, { session: sessionKey, seenAt, seq, serial });
    // Publish the serve bounds the sort just derived. Anything that talks
    // about time BETWEEN groups has to read these, not the write timestamps.
    g.firstSeenAt = seenAt;
    g.lastSeenAt = lastSeen || seenAt;
    g.sessionKey = sessionKey;
    const cur = sessionStart.get(sessionKey);
    if (!cur || seenAt < cur) sessionStart.set(sessionKey, seenAt);
  }
  return Array.from(map.values()).sort((a, b) => {
    const oa = order.get(a)!;
    const ob = order.get(b)!;
    if (oa.session !== ob.session) {
      // Newest SESSION first (recent activity on top of a long chain).
      const startCmp = sessionStart.get(ob.session)!.localeCompare(sessionStart.get(oa.session)!);
      if (startCmp !== 0) return startCmp;
      // Same-second sessions (legacy solo groups): newest serial first — the
      // pre-0d deterministic tie-break (#797-above-#799), kept unchanged.
      return ob.serial - oa.serial;
    }
    // Same session: replay in seen order (first seen on top).
    if (oa.seq !== ob.seq) return oa.seq - ob.seq;
    const seenCmp = oa.seenAt.localeCompare(ob.seenAt);
    if (seenCmp !== 0) return seenCmp;
    // Serials are unique — deterministic full order for same-second legacy
    // records (the #797-above-#799 flip read as "posts are missing").
    return oa.serial - ob.serial;
  });
}
