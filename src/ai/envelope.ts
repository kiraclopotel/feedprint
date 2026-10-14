// The envelope: what one reading is shown about one item, built in the extension from what the adapters already hand over
// (the owner's document on the AI reading, 13 Oct 2026: the envelope of page 11, the source map of pages 14 and 15).
//
// Three rules. It never invents a line: a source that is empty prints its absence word ("not shown", "no text", "not read
// from the screen", "not known"), and "none" only where the source itself says so. It cuts by the same numbers everywhere,
// ITEM_MOST_CHARS for the item and CONTEXT_MOST_CHARS for each context line, and says so when it cut. It builds the same
// shape at both depths: a scrolled caption (envelopeForItem, from PostContent) and a comment under an opened room
// (envelopeForRoomNode, from the Encounter) differ only in which lines are filled.
//
// Kept out on purpose: the platform, every handle and display name (each becomes the call's own @user_A letter, as in
// core/name-labels.ts), the pattern-scan flags (harm_floor), the surface, feedSource, expand_event_observed and
// render_state. Those belong to the ledger, not the judge. The platform is read only to name the kind.
//
// Nothing calls this yet: the prompt that would carry it ships only after its measurement (the Measure seat, 14 Oct 2026).

import type { CommentNode, Encounter, Platform, PostContent, PostNode } from '../types/post';
import { buildNameLabelMapForEncounter, replaceNamesInText, type NameLabelMap } from '../core/name-labels';

export const ITEM_MOST_CHARS = 400;
export const CONTEXT_MOST_CHARS = 200;
export const TOP_REPLIES_MOST = 3;

export type EnvelopeKind = 'title' | 'post' | 'caption' | 'comment' | 'reply';

export interface Envelope {
  kind: EnvelopeKind;
  /** whole | first lines only | not read from the screen | not known */
  shown: string;
  /** none | image or video, not read | video, not read | not known */
  media: string;
  placement: 'ordinary' | 'paid';
  text: string;
  repliesTo: string;
  quotesOrLinks: string;
  /** Empty prints "not shown". */
  topReplies: string[];
  reactions: string;
  surfacedFirst: string;
}

const NOT_SHOWN = 'not shown';
const NOT_KNOWN = 'not known';
const NO_TEXT = 'no text';

function count(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** The text with its names as letters, cut at `most` characters, saying so when it cut. */
function cutText(labels: NameLabelMap, raw: string | undefined, most: number, oneLine: boolean): string {
  let text = replaceNamesInText(labels, raw ?? '');
  text = oneLine ? text.replace(/\s+/g, ' ').trim() : text.trim();
  if (text.length === 0) return NO_TEXT;
  const chars = Array.from(text);
  if (chars.length <= most) return text;
  return `${chars.slice(0, most).join('')} [cut: ${count(most)} of ${count(chars.length)} characters]`;
}

const contextLine = (labels: NameLabelMap, raw: string | undefined): string => cutText(labels, raw, CONTEXT_MOST_CHARS, true);

/** A root's kind: a video's words are a title on YouTube and a caption elsewhere; TikTok and Instagram show only captions. */
function rootKind(platform: Platform, isVideo: boolean): EnvelopeKind {
  if (platform === 'youtube') return isVideo ? 'title' : 'post';
  if (platform === 'tiktok' || platform === 'instagram') return 'caption';
  if (platform === 'facebook') return isVideo ? 'caption' : 'post';
  return 'post';
}

/** Approvals, then comments under a root or replies under a comment, then shares; each missing one says so. */
function reactionsLine(approvals: number | undefined, comments: number | undefined, shares: number | undefined, root: boolean): string {
  if (approvals === undefined && comments === undefined && shares === undefined) return NOT_SHOWN;
  const part = (n: number | undefined, one: string, many: string): string =>
    n === undefined ? `${many} ${NOT_SHOWN}` : `${count(n)} ${n === 1 ? one : many}`;
  const middle = root ? part(comments, 'comment', 'comments') : part(comments, 'reply', 'replies');
  return [part(approvals, 'approval', 'approvals'), middle, part(shares, 'share', 'shares')].join(', ');
}

// ---- the item path: one PostContent, as a scrolled feed hands it over ----

const CONTEXT_HEAD_RE = /^[ \t]*•[ \t]*(?:@(.{1,64}?):[ \t])?/u;

export function envelopeForItem(post: PostContent): Envelope {
  const kindIn = post.kind ?? 'post';
  const isRoot = kindIn === 'post' || kindIn === 'video';
  const kind: EnvelopeKind = isRoot
    ? rootKind(post.platform, kindIn === 'video')
    : kindIn === 'reply' || kindIn === 'reply-to-reply' ? 'reply' : 'comment';

  // Everyone the envelope could name, so each becomes a letter: the author and the people in the caption context.
  const contextLines = (post.context ?? '').split('\n').filter((l) => l.trim().length > 0);
  const speakers = contextLines.map((l) => ({ author: { handle: l.match(CONTEXT_HEAD_RE)?.[1] ?? '' }, text: l }));
  // Every text the envelope prints is scanned for @mentions (they get letters too), through the post's own text slot.
  const printed = [post.text, post.parentText, post.card?.quotedBody, post.card?.link?.title];
  const labels = buildNameLabelMapForEncounter({
    post: { author: { handle: post.author ?? '', display_name: post.authorName }, text: printed.filter((t) => t !== undefined).join(' ') },
    children: speakers,
  });

  const shown =
    post.textCapture === 'whole' ? 'whole'
      : post.textCapture === 'folded' || post.textCapture === 'cut' ? 'first lines only'
        : post.textCapture === 'platform' ? 'not read from the screen'
          : NOT_KNOWN;

  // TODO(capture): a media kind stamped at capture (the adapters see the player or the image), so this can say none,
  // image or video; an address alone does not tell which, and absent addresses mean "not read", never "no media".
  const media = kindIn === 'video' ? 'video, not read'
    : (post.mediaUrls?.length ?? 0) > 0 ? 'image or video, not read'
      : NOT_KNOWN;

  // A root on TikTok, Instagram, YouTube and Facebook answers nothing; an X post can be a reply whose parent was not on the page.
  const repliesTo = post.parentText !== undefined ? contextLine(labels, post.parentText)
    : isRoot && post.platform !== 'twitter' ? 'none'
      : NOT_SHOWN;

  // Only the card's name-free parts: card.text holds the quoted account's display name, "From <name>", "original sound -
  // <name>" and collab lines, and no letter replaces a display name (card-context.ts says the same for the judge).
  // TODO(capture): name-free card lines for Instagram and TikTok (sound, collab, repost, duet), as X has quotedBody; and
  // Facebook and YouTube cards, not read today (record/card-context.ts reads X, Instagram and TikTok).
  const card = post.card;
  const quoted: string[] = [];
  if (card?.quotedBody !== undefined) quoted.push(`quoted post: ${contextLine(labels, card.quotedBody)}`);
  if (card?.link?.title !== undefined) quoted.push(`link: ${contextLine(labels, card.link.title)}`);
  const quotesOrLinks = quoted.length > 0 ? quoted.join('; ') : NOT_SHOWN;

  const topReplies = isRoot
    ? contextLines.slice(0, TOP_REPLIES_MOST).map((l) => contextLine(labels, l.replace(CONTEXT_HEAD_RE, '')))
    : [];

  // TODO(capture): Facebook reaction types (PostMetrics.reactions_profile is an empty hook); totals only today.
  const meta = post.platform_specific;
  let reactions = NOT_SHOWN;
  let pinned: boolean | undefined;
  if (meta?.platform === 'twitter') {
    reactions = reactionsLine(meta.metrics?.likes, meta.metrics?.replies, meta.metrics?.retweets, isRoot);
  } else if (meta?.platform === 'tiktok') {
    reactions = reactionsLine(meta.metrics?.likes, meta.metrics?.reply_count, meta.metrics?.shares, isRoot);
    pinned = meta.isPinned;
  } else if (meta?.platform === 'facebook') {
    reactions = isRoot
      ? reactionsLine(meta.postReactions, meta.postCommentsCount, meta.postShares, true)
      : reactionsLine(meta.metrics?.likes, meta.metrics?.reply_count, undefined, false);
  } else if (meta?.platform === 'instagram') {
    // Instagram hides a post's likes; a comment's are on the page.
    reactions = reactionsLine(isRoot ? undefined : meta.metrics?.likes, meta.metrics?.reply_count, undefined, isRoot);
  } else if (meta?.platform === 'youtube') {
    reactions = reactionsLine(meta.metrics?.likes, meta.metrics?.reply_count, undefined, isRoot);
    pinned = meta.isPinned;
  }

  return {
    kind,
    shown,
    media,
    // "ordinary" is "no paid marker seen": the document has two words here and no absence word.
    placement: post.is_sponsored === true ? 'paid' : 'ordinary',
    text: cutText(labels, post.text, ITEM_MOST_CHARS, false),
    repliesTo,
    quotesOrLinks,
    topReplies,
    reactions,
    surfacedFirst: !isRoot && pinned === true ? 'yes' : NOT_SHOWN,
  };
}

// ---- the room path: one node of an opened comment room ----

function isPostNode(node: PostNode | CommentNode): node is PostNode {
  return !('depth' in node);
}

/** The envelope of the room's post or of one comment in it, by id; null when the room holds no such node. */
export function envelopeForRoomNode(encounter: Encounter, nodeId: string): Envelope | null {
  const comments: CommentNode[] = [...encounter.ancestors];
  if (!isPostNode(encounter.focused) && !comments.some((c) => c.id === encounter.focused.id)) comments.push(encounter.focused);
  comments.push(...encounter.children);
  const node: PostNode | CommentNode | undefined =
    encounter.post.id === nodeId ? encounter.post : comments.find((c) => c.id === nodeId);
  if (!node) return null;

  const labels = buildNameLabelMapForEncounter(encounter);
  const below = comments.filter((c) => c.parent_id === node.id).slice(0, TOP_REPLIES_MOST).map((c) => contextLine(labels, c.text));

  // The Encounter carries no textCapture, so "shown" is "not known" on this path until capture stamps it there too.
  if (isPostNode(node)) {
    const isVideo = node.kind !== 'post' || node.has_video === true;
    const m = node.metrics;
    const obscured = m.likes_obscured === true || encounter.platform === 'instagram';
    const quoted: string[] = [];
    if (node.is_quote_tweet === true) quoted.push(`quoted post: ${NOT_SHOWN}`);
    return {
      kind: rootKind(encounter.platform, isVideo),
      shown: NOT_KNOWN,
      media: isVideo ? 'video, not read' : node.has_carousel === true ? 'image or video, not read' : NOT_KNOWN,
      placement: node.is_sponsored === true ? 'paid' : 'ordinary',
      text: cutText(labels, node.text, ITEM_MOST_CHARS, false),
      // As on the item path: an X post can answer a post that was not on the page.
      repliesTo: encounter.platform === 'twitter' ? NOT_SHOWN : 'none',
      quotesOrLinks: quoted.length > 0 ? quoted.join('; ') : NOT_SHOWN,
      topReplies: below,
      reactions: reactionsLine(obscured ? undefined : m.primary_likes, m.comments_count ?? encounter.comments_total, m.shares ?? m.retweets, true),
      surfacedFirst: NOT_SHOWN,
    };
  }

  const parent: PostNode | CommentNode | undefined =
    node.parent_id === encounter.post.id ? encounter.post : comments.find((c) => c.id === node.parent_id);
  // Position one is read only in `children`, the list as displayed; an ancestor or the focused comment is shown without
  // its siblings, so only a pin can say yes there.
  const inList = encounter.children.some((c) => c.id === node.id);
  const firstShown = encounter.children.find((c) => c.parent_id === node.parent_id)?.id === node.id;
  const surfacedFirst = node.author.is_pinned_by_creator || (inList && firstShown) ? 'yes' : inList ? 'no' : NOT_SHOWN;
  return {
    kind: node.kind === 'top-comment' ? 'comment' : 'reply',
    shown: NOT_KNOWN,
    media: node.has_media === true ? 'image or video, not read' : node.has_media === false ? 'none' : NOT_KNOWN,
    placement: 'ordinary',
    text: cutText(labels, node.text, ITEM_MOST_CHARS, false),
    repliesTo: parent ? contextLine(labels, parent.text) : NOT_SHOWN,
    quotesOrLinks: NOT_SHOWN,
    topReplies: below,
    reactions: reactionsLine(node.metrics.likes, node.metrics.reply_count, undefined, false),
    surfacedFirst,
  };
}

// ---- the text the model reads ----

export function renderEnvelope(e: Envelope): string {
  return [
    'ITEM',
    `kind: ${e.kind}`,
    `shown: ${e.shown}`,
    `media: ${e.media}`,
    `placement: ${e.placement}`,
    'text:',
    e.text,
    '',
    'CONTEXT, not judged',
    `replies to: ${e.repliesTo}`,
    `quotes or links: ${e.quotesOrLinks}`,
    ...(e.topReplies.length > 0 ? ['top replies:', ...e.topReplies.map((r) => `- ${r}`)] : [`top replies: ${NOT_SHOWN}`]),
    `reactions: ${e.reactions}`,
    `surfaced first: ${e.surfacedFirst}`,
  ].join('\n');
}
