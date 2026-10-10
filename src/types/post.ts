// FeelingWise - Post content types
// Standardized format produced by platform adapters

import type { AuthorCapture } from './author-capture';
import type { TextCapture } from './text-capture';

/**
 * Where an item was served from. 'permalink' (since 2.5.1) is a post or a
 * thread the reader opened on purpose (an X /status/ page); until then those
 * pages were stamped 'profile', which the dashboard reads as "the reader's
 * choice" and the served-versus-sought analysis reads as profile browsing.
 */
export type FeedSource = 'for-you' | 'following' | 'profile' | 'permalink' | 'search' | 'video' | 'manual' | 'unknown';

/**
 * WHO posted an item the child/teen/adult saw. Derived from live DOM signals
 * (see `src/content/record/account-type.ts`), never fabricated. Shared by
 * `PostContent` and `ForensicRecord`.
 */
export type AccountType = 'person' | 'group' | 'page' | 'advertiser';

/**
 * Tags how a PostContent is positioned in its parent's tree. The 'video' tag
 * marks the caption/title of a video post; 'comment' marks a comment under
 * that video. Default 'post' is the top-level scrollable item on text feeds.
 *
 * Used by adapters that split a single video into N+1 records (caption + N
 * comments) so the forensic store can group them.
 *
 * Differentiates top-level comments from replies and replies-to-replies.
 * Maps to NodeKind / "child + environment" levels:
 *
 *   'post'           — Level 0 root of an environment (text-feed top item)
 *   'video'          — Level 0 caption/title of a video
 *   'comment'        — backward-compat alias; resolves to 'top-comment' when
 *                       depth=0 is supplied. Adapters MAY emit 'top-comment'
 *                       directly going forward; legacy callers keep 'comment'.
 *   'top-comment'    — Level 1: direct comment under a Level 0 post/video
 *   'reply'          — Level 2: a reply addressing a top-comment
 *   'reply-to-reply' — Level 3+: deeper nesting (display capped at depth 3;
 *                       chain still records arbitrary depth)
 *
 * Fields are OPTIONAL (`depth?`, `parent_id?`, etc.) so adapters that don't
 * populate them keep working unchanged.
 */
/**
 * Shared node-kind vocabulary across PostContent + Encounter + the
 * forensic chain. `ForensicRecord.kind` extends this with record-level
 * markers (`environment`, `reset-marker`, `month-rotation-marker`).
 * `PostNodeKind` (PostNode-only) adds media-shape kinds (`reel`,
 * `short`). `CommentNodeKind` derives from this via Extract.
 *
 * Establishing a single base type closes the silent-drop class that
 * was possible pre-2026-05-24 — `encounter-builder.ts` child filters
 * accepted only `'top-comment' | 'reply' | 'reply-to-reply'` but
 * `PostKind` docstrings encouraged adapters to emit `'comment'` as a
 * backward-compat alias. With NodeKind as the shared base, future
 * additions enforce themselves at compile time across every consumer.
 * Audit A8 V1.5 ROADMAP rank 9 closure.
 */
export type NodeKind = 'post' | 'video' | 'comment' | 'top-comment' | 'reply' | 'reply-to-reply';

export type PostKind = NodeKind;

/**
 * Common render-state vocabulary across platforms.
 *
 *   'visible-now'           — node intersects the viewport at extraction time
 *   'rendered-not-visible'  — node is in DOM but scrolled out of viewport
 *   'just-rendered-by-expand' — node entered DOM via a user-initiated expand
 *                                event (Vezi N răspunsuri / Show replies);
 *                                the highest-priority class in the queue
 *                                because it represents what the child JUST
 *                                paid attention to
 *   'scrolled-out'          — IntersectionObserver-flagged scroll-out
 *                                (still in chain — the child saw it,
 *                                FW analyzed it)
 *   'virtualizer-recycled'  — anchor revalidation found the DOM node now
 *                                holds different content (TikTok / X
 *                                virtualizer reuse)
 *   'dom-gone'              — WeakRef.deref() returned undefined; node
 *                                garbage-collected before render-gate ran
 */
export type RenderState =
  | 'visible-now'
  | 'rendered-not-visible'
  | 'just-rendered-by-expand'
  | 'scrolled-out'
  | 'virtualizer-recycled'
  | 'dom-gone';

/**
 * Per-platform meta as a discriminated union so each branch can grow
 * independently. The adapter MAY stamp this when it has platform-
 * specific provenance worth preserving in the chain (e.g. Twitter's
 * conversationId vs the reply tweet's id, TikTok's data-e2e level marker).
 *
 * OPTIONAL — adapters that don't populate emit nothing here and the chain
 * record simply omits the field. Forensic integrity: present when the
 * adapter knows it; absent when it doesn't.
 *
 * Twitter PlatformSpecificMeta carries Encounter signals. Fields are all
 * optional. The Encounter constructor reads these to populate
 * `Encounter.post.metrics` + `Encounter.post.author.verified` +
 * `Encounter.post.community_notes_present` + `Encounter.post.is_quote_tweet`.
 *
 * The fields are POSTCONTENT-LEVEL — that is, each PostContent record
 * (whether for a focused tweet, an ancestor, or a comment) carries its own
 * metrics + flags. The Encounter constructor knows how to map them to the
 * right slot (post / ancestor / child) based on `kind` + `depth`.
 */
export type PlatformSpecificMeta =
  | {
      platform: 'twitter';
      conversationId?: string;
      inReplyToStatusId?: string;
      /** True when this article carries a Twitter "verified" badge. */
      verified?: boolean;
      /** Engagement metrics extracted from the article's [data-testid] count buttons. */
      metrics?: {
        likes?: number;
        retweets?: number;
        replies?: number;
        views?: number;
        bookmarks?: number;
        quoteTweets?: number;
      };
      /** "Last edited Xh ago" affordance present on the article. */
      isEdited?: boolean;
      /** True when a Community Notes / birdwatch indicator is attached to the article. */
      communityNotesPresent?: boolean;
      /** True when this article embeds a quoted tweet (nested article) in its body. */
      isQuoteTweet?: boolean;
      /** Surface the article was extracted from. Drives PlatformSurface in Encounter. */
      surfaceKind?:
        | 'twitter-permalink'
        | 'twitter-home-feed'
        | 'twitter-photo-modal'
        | 'twitter-profile'
        | 'twitter-search'
        | 'twitter-list';
    }
  | {
      platform: 'tiktok';
      commentLevel?: 1 | 2;
      dataE2eMarker?: string;
      /** Surface drives PlatformSurface in Encounter. */
      surfaceKind?: 'tiktok-feed' | 'tiktok-permalink';
      /** Engagement metrics. Comments carry likes + reply_count; the video
       *  caption additionally carries shares (the For-You action rail's
       *  like/comment/share counts). */
      metrics?: {
        likes?: number;
        reply_count?: number;
        shares?: number;
      };
      /** "• Creator" suffix indicator on the comment author block. */
      isCreator?: boolean;
      /** "Fixat" / "Pinned" indicator (creator-pinned comment). */
      isPinned?: boolean;
      /** Creator-heart icon present (creator endorsed this comment). */
      isCreatorHearted?: boolean;
      /** "Edited" / "(edited)" / "Editat" marker present. */
      isEdited?: boolean;
    }
  | {
      platform: 'facebook';
      threadCommentId?: string;
      expandedFromPrompt?: boolean;
      /** Surface drives PlatformSurface in Encounter. */
      surfaceKind?: 'facebook-permalink' | 'facebook-home-feed' | 'facebook-reel' | 'facebook-photo-modal';
      /** Engagement metrics extracted from per-comment DOM. */
      metrics?: {
        likes?: number;
        reply_count?: number;
      };
      /** Verified-page badge present (svg[aria-label*="erif"]). */
      isVerified?: boolean;
      /** "Author" label adjacent to commenter handle (creator commented under their own post). */
      isAuthor?: boolean;
      /** Aggregate post reactions count (FB-specific; populated on caption record). */
      postReactions?: number;
      /** Aggregate post comments count (FB-specific; populated on caption record). */
      postCommentsCount?: number;
      /** Aggregate post shares count (FB-specific; populated on caption record). */
      postShares?: number;
      /** "Editat" / "Edited" marker present on the comment. */
      isEdited?: boolean;
    }
  | {
      platform: 'instagram';
      commentLevel?: 1 | 2;
      storyContext?: boolean;
      /** Surface drives PlatformSurface in Encounter. */
      surfaceKind?: 'instagram-post' | 'instagram-reel' | 'instagram-story';
      /** Engagement metrics extracted from per-comment DOM. */
      metrics?: {
        likes?: number;
        reply_count?: number;
      };
      /** Verified author badge present (svg[aria-label*="erif"]). */
      isVerified?: boolean;
      /** Post is a carousel (multiple images / videos). Stamped on caption record only. */
      hasCarousel?: boolean;
      /** "Edited" / "Editat" marker present on the comment. */
      isEdited?: boolean;
    }
  | {
      platform: 'youtube';
      channelId?: string;
      /** Surface drives PlatformSurface in Encounter. */
      surfaceKind?: 'youtube-watch' | 'youtube-shorts' | 'youtube-community' | 'youtube-home';
      /** Engagement metrics extracted from per-comment DOM. */
      metrics?: {
        likes?: number;
        reply_count?: number;
      };
      /** Verified channel badge present (ytd-author-comment-badge-renderer). */
      isVerified?: boolean;
      /** Creator-heart icon present (ytd-creator-heart-renderer). */
      isCreatorHearted?: boolean;
      /** Pinned-by-creator badge present (ytd-pinned-comment-badge-renderer). */
      isPinned?: boolean;
      /** "(edited)" inline marker in the comment time-display. */
      isEdited?: boolean;
    };

export interface PostContent {
  id: string;
  text: string;
  author: string;
  /**
   * The display name shown beside the handle, when the adapter can read it
   * separately (X: the header span; the handle itself comes from the
   * profile-link href). Undefined wherever the adapter reads only one
   * string for both, or where `author` itself was withheld by an identity
   * gate (a display name from the same untrustworthy slot carries the same
   * misattribution risk `authorCapture: 'withheld'` exists to name).
   */
  authorName?: string;
  timestamp: string;             // ISO-8601
  platform: Platform;
  domRef: WeakRef<HTMLElement>;
  /** Runtime-only bounded feed area used for exact DOM-remount recovery. */
  recoveryScopeRef?: WeakRef<HTMLElement>;
  sourceUrl?: string;
  /**
   * Deep-link that lands the recipient ON this exact comment/reply rather
   * than the post it sits under. Set ONLY from a per-comment permalink the
   * adapter already extracts (an X reply `/status/<id>` URL, an IG `/c/<id>`
   * comment link). Left undefined on posts/captions (their `sourceUrl` is
   * already the address) and on platforms with no stable per-comment URL
   * (TikTok). Threads to the forensic record's `anchorUrl` (forensic.ts),
   * which the standalone HTML export prefers over `postUrl` for the
   * "open the exact comment" link.
   */
  anchorUrl?: string;
  feedSource?: FeedSource;
  /** Tree position. Defaults to 'post' when absent. */
  kind?: PostKind;
  /** When kind='comment' or kind='video': id of the parent video container. */
  parentVideoId?: string;
  /**
   * Optional surrounding-discourse context for the LLM. When the adapter
   * has access to sibling comments / parent post / thread snapshot at
   * extraction time, it MAY format a short context block (one item per
   * line, "• @author: text" convention) and stamp it here. The pipeline
   * forwards it to `combinedDetectAndNeutralize` which embeds it as a
   * "SURROUNDING DISCOURSE (context only — judge POST above)" block in
   * the user prompt.
   *
   * Adapters that do NOT have discourse context (legacy text-feed posts,
   * comment-only paths, etc.) leave this undefined — pipeline behavior
   * is structurally identical in that case.
   */
  context?: string;
  /**
   * Tree depth in the conversation hierarchy ("child + environment"
   * framing). 0 = post/video root, 1 = top-comment, 2 = reply, 3+ = deeper.
   * OPTIONAL — adapters that emit only Level-0 / Level-1 leave this
   * undefined; chain reader treats as 0 for 'post'/'video' and 1 for
   * 'comment'/'top-comment' for back-compat.
   */
  depth?: 0 | 1 | 2 | 3;
  /**
   * Id of the immediate parent node in the tree.
   *   - On a top-comment under a video: parent_id === parentVideoId
   *   - On a reply under a top-comment: parent_id === <top-comment.id>
   *   - On a reply-to-reply: parent_id === <reply.id>
   * The chain is recursively reconstructible from these pointers per
   * VISION §1.1 forensic-mirroring corollary B.
   */
  parent_id?: string;
  /**
   * The immediate parent's own text, read at the same moment as this item,
   * when the adapter had it on the page (an X permalink's ancestor or focused
   * article; 2026-09-07, Stage 2 of the 2026-09-07 plan). Context only: the
   * judge is shown "the post it replies to" and told to judge the item alone,
   * which is the configuration the 2026-09-03 protocol measured (context
   * parent). Undefined on a root post and wherever the parent was not on the
   * page; absent is "not seen", never "no parent".
   */
  parentText?: string;
  /**
   * What the card carries beyond the author's own words (src/content/
   * card-context.ts, 2026-09-07): the quoted post's text and author, a link
   * card's title, a media attribution line and the account it names. Read by
   * the household blocklist so a blocked name is caught when someone else
   * quotes the person. Undefined where the adapter does not read cards.
   */
  card?: { text?: string; accounts?: string[] };
  /**
   * What state the node was in when FW saw it (per RenderState).
   * Drives priority/timing decisions + the chain's "what the child
   * experienced" answer per VISION §1.1.
   */
  render_state?: RenderState;
  /**
   * True when this node entered DOM via an explicit user gesture
   * (Vezi N răspunsuri / Show more replies). Provenance signal so the
   * forensic chain can distinguish replies the child actively expanded
   * from replies the platform pre-loaded but the child never opened.
   * Adapters that don't observe expand events leave this absent.
   */
  expand_event_observed?: boolean;
  /**
   * Per-platform discriminated meta. When the adapter has provenance
   * worth preserving (Twitter conversation root, TikTok DOM marker,
   * FB thread-id, IG comment-level), it stamps it here. The forensic
   * store reads only the platform tag + the fields it knows; unknown
   * fields are preserved in the chain payload (canonical-payload hasher
   * includes the whole sub-object so tampering is tamper-evident).
   */
  platform_specific?: PlatformSpecificMeta;
  /**
   * Sponsored/Ad/Promoted indicator. Stamped on the caption record
   * (kind='post' / 'video') by adapters that detect the platform-
   * specific sponsored marker. Bubbles to `Encounter.post.is_sponsored`
   * in the encounter assembler.
   */
  is_sponsored?: boolean;
  /**
   * WHO posted this — derived from live DOM signals by `deriveAccountType`
   * (`src/content/record/account-type.ts`), stamped once at `onPostDetected`. Threads
   * to `ForensicRecord.accountType`. Undefined when no type is provable.
   */
  accountType?: AccountType;
  /**
   * Named container the post lived in — the Facebook group's name when
   * `accountType === 'group'`. Stamped by the Facebook adapter from the
   * `/groups/<gid>/user/` origin signal. Threads to
   * `ForensicRecord.sourceContainer`. Undefined otherwise.
   */
  sourceContainer?: string;
  /**
   * Impression / exposure order (see IMPRESSION_LAYER_V1.md). Stamped once per
   * post.id at `onPostDetected` — the earliest pre-AI observation point — by
   * `stampImpressionOrder` (`src/content/record/impression-order.ts`). Threads to the
   * matching `ForensicRecord` fields. The honest claim is "FeelingWise locally
   * observed this item entering view at this order/time", never the platform's
   * algorithmic serve order.
   */
  /** Monotonic 1-based local observation order within the surface session. */
  observedSequence?: number;
  /** ISO timestamp of first local observation of this item. */
  viewportSeenAt?: string;
  /** Id of one content-script load (scopes observedSequence). */
  surfaceSessionId?: string;
  /**
   * What the page carried against what the screen showed for this text:
   * 'whole', 'folded' (whole text in the DOM, clamped by style) or 'cut' (a
   * fragment, the rest behind a control). Stamped once at `onPostDetected` by
   * `stampTextFold` (`src/content/record/text-fold.ts`) from `domRef`; threads to
   * `ForensicRecord.textCapture`. Absent when the element was gone.
   */
  textCapture?: TextCapture;
  /**
   * 'withheld' when the recorder refused an author it could see, because it
   * could not show that the header and the body belonged to the same item
   * (X's virtualiser reusing a slot mid-read). Stamped by the adapter beside
   * `author`; threads to `ForensicRecord.authorCapture`. Absent everywhere
   * else, and absent is "the author is the one the page showed".
   */
  authorCapture?: AuthorCapture;
  /**
   * The media addresses the page carried for this post, as read at
   * `onPostDetected` by `stampMediaUrls` (`src/content/record/media-urls.ts`) from
   * `domRef`; threads to `ForensicRecord.mediaUrls`. Absent when the element
   * was gone or carried no qualifying media.
   */
  mediaUrls?: string[];
}

export type Platform = 'twitter' | 'instagram' | 'tiktok' | 'facebook' | 'youtube';

// ─────────────────────────────────────────────────────────────────────────
// Encounter schema (the BATCH classifier prompt unit)
// ─────────────────────────────────────────────────────────────────────────
//
// An Encounter captures one rendering moment a child experienced — the post
// environment, optionally an ancestry chain (depth>0 surfaces only), and the
// visible comments at that moment in the platform-curated display order. It
// is the unit `buildBatchPromptV3` consumes and the unit one chain record
// describes per VISION §1.1 forensic-mirror corollary B.
//
// Chain-mirror invariant (per `feedback_per_platform_metrics_aware_batch_
// design.md`): every byte in an Encounter traces to DOM-rendered content the
// child's eyes could have hit. No pre-fetched replies. No reconstructed
// history. No cross-Encounter state.
//
// PostContent (above) remains the per-record chain format. Encounter is the
// per-rendering-moment prompt format. They are complementary, not
// alternatives — children of an Encounter become PostContent records when
// they land in the chain.

/** The 5 V1 platforms whose Encounter shapes are concretely specified. */
export type EncounterPlatform = 'twitter' | 'tiktok' | 'instagram' | 'youtube' | 'facebook';

/**
 * Sort order the child sees on the comment list at observation time. The
 * exact label varies per platform — these are normalized values.
 *   'relevant'      — generic relevance/top sort (most platforms default)
 *   'most_relevant' — FB-specific "Cele mai relevante" / "Most relevant"
 *   'newest'        — chronological; FB "Cele mai noi" / X "Latest" / YT "Newest first"
 *   'top'           — YT "Top comments"; X "Liked" subset
 *   'all'           — FB "Toate comentariile" — unfiltered
 *   'liked'         — X "Liked" sort
 */
export type SortOrder =
  | 'relevant'
  | 'most_relevant'
  | 'newest'
  | 'top'
  | 'all'
  | 'liked';

/**
 * Platform + surface discriminator. Each platform has 1-4 surfaces in V1 +
 * a few V1.5/V2 stubs (story / reel / live). The discriminator narrows
 * downstream prompt-template selection (per GROQ_PROMPT_ARCHITECTURE §5).
 */
export type PlatformSurface =
  | { kind: 'twitter-permalink'; conversation_id: string }
  | { kind: 'twitter-home-feed' }
  | { kind: 'twitter-photo-modal'; tweet_id: string; photo_index: number }
  | { kind: 'tiktok-feed'; video_id: string; comment_panel_open: boolean }
  | { kind: 'tiktok-permalink'; video_id: string }
  | { kind: 'instagram-post'; post_id: string; carousel_index?: number }
  | { kind: 'instagram-reel'; reel_id: string }
  | { kind: 'instagram-story'; story_id: string }
  | { kind: 'youtube-watch'; video_id: string }
  | { kind: 'youtube-shorts'; video_id: string }
  | { kind: 'youtube-community'; post_id: string }
  /** A video tile the Home, Subscriptions, Trending or Explore grid showed (since 2026-09-17). */
  | { kind: 'youtube-home'; video_id: string }
  | { kind: 'facebook-permalink'; post_id: string }
  | { kind: 'facebook-home-feed'; post_id: string }
  | { kind: 'facebook-reel'; reel_id: string }
  | { kind: 'facebook-photo-modal'; post_id: string; photo_id: string };

/**
 * Top-level node kinds a post can be. Distinguishes "what is this post"
 * from "where in the tree does it sit" (depth lives on CommentNode for
 * comments; PostNode is implicitly the root).
 */
/**
 * Top-level node kinds a PostNode (root of an Encounter) can take. Narrowed
 * 2026-05-24 (audit A8 §2.3) to remove dead `'image' | 'carousel'` members —
 * neither was ever emitted by an assembler. `'reel' | 'short'` retain coverage
 * for IG / FB reels + YT shorts which assemblers do emit.
 */
export type PostNodeKind = 'post' | 'video' | 'reel' | 'short';

/**
 * Comment-tree positions derived from NodeKind via Extract. depth follows
 * directly: top=1, reply=2, reply-to-reply=3.
 */
export type CommentNodeKind = Extract<NodeKind, 'top-comment' | 'reply' | 'reply-to-reply'>;

interface PostAuthor {
  handle: string;
  display_name?: string;
  verified: boolean;
  is_creator: boolean;
}

interface CommentAuthor {
  handle: string;
  display_name?: string;
  verified: boolean;
  /** Creator pinned this comment to top of section. */
  is_pinned_by_creator: boolean;
  /** Creator-heart icon present on this comment (TikTok/YT). */
  is_creator_hearted: boolean;
}

/**
 * 6-emotion reaction breakdown — FB-only V1.5 hook (icons are inline SVG
 * with no descriptive alt; extraction requires hover-state simulation).
 * V1 leaves this undefined. Fields all optional so partial captures (e.g.,
 * only the dominant reaction known) round-trip cleanly.
 */
interface ReactionsProfile {
  like?: number;
  love?: number;
  care?: number;
  haha?: number;
  wow?: number;
  sad?: number;
  angry?: number;
}

export interface PostMetrics {
  /** X likes / TT likes / YT likes / IG likes (obscured) / FB reactions-aggregated. */
  primary_likes?: number;
  /** True for Instagram (product-policy obscures exact count). False/undefined elsewhere. */
  likes_obscured?: boolean;
  /** X-only. */
  retweets?: number;
  /** X-only. */
  quote_tweets?: number;
  /** X / TT (saves). */
  bookmarks?: number;
  /** X / TT / YT. */
  views?: number;
  /** TT / FB. */
  shares?: number;
  /** Platform-reported total. */
  comments_count?: number;
  /** FB-only V1.5+. V1 leaves undefined. */
  reactions_profile?: ReactionsProfile;
}

export interface CommentMetrics {
  likes?: number;
  /** VITAL — per `feedback_per_platform_metrics_aware_batch_design`. */
  reply_count?: number;
  /** X / TT. */
  views?: number;
}

/**
 * Per-comment harm-floor pre-classification.
 *
 * Pre-LLM regex+structural signals computed at observation time per
 * `src/core/harm-floor.ts`. Fed AS LABELS into the BATCH prompt so the Groq
 * classifier sees ground-truth pre-extraction (slur match / profanity density
 * / ad-hominem density / caps / crowd-coordination). Per `feedback_per_
 * platform_metrics_aware_batch_design`: the classifier doesn't get smarter,
 * the input does — pre-filter signals join the Encounter context.
 *
 * Designed as INPUT to Groq, not as REPLACEMENT for Groq (regex alone
 * misclassified a comment that was a single slur). Also serves as the failClosed fallback —
 * when Groq fails, harm-floor score grounds severity instead of defaulting
 * to 'none'/sev=0.
 */
export interface CommentHarmFloor {
  /** Composite 0-100 score from per-comment regex+structural signals. */
  score: number;
  /**
   * Top-contributing category (drives the prompt label). 'identity-slur' is
   * sourced from `src/core/profanity-filter.ts` ENGLISH_SLURS (racial /
   * homophobic / ableist identity targets — nigger, faggot, retard). The
   * other categories are sourced from `src/core/harm-floor.ts` regex
   * categories A-E + I.
   */
  top_category?:
    | 'identity-slur'
    | 'profanity'
    | 'ad-hominem'
    | 'ideology-slur'
    | 'sustained-caps'
    | 'crowd-coordination'
    | 'punctuation-rage'
    | 'emoji-pile'
    | 'repetition';
  /** Evidence snippet from the top signal (≤60 chars; for forensic + prompt). */
  top_evidence?: string;
  /** All non-L1 signal categories that fired with their summed weights. */
  signal_categories: string[];
  /** 'en' | 'ro' | 'mixed' | 'unknown' — drives RO/EN-aware downstream. */
  language: 'en' | 'ro' | 'mixed' | 'unknown';
  /**
   * True when the slur-filter matched (independently of harm-floor numerical
   * score). Drives the failClosed fallback's severity-floor + the chain
   * payload's identity-slur-exposed flag for the parent dashboard.
   */
  identity_slur_match: boolean;
}

export interface PostNode {
  id: string;
  kind: PostNodeKind;
  text: string;
  author: PostAuthor;
  age_iso?: string;
  age_relative?: string;
  metrics: PostMetrics;
  /** X — Community Notes badge present. */
  community_notes_present?: boolean;
  /** X — this tweet is a quote of another tweet. */
  is_quote_tweet?: boolean;
  /** X reply-to-tweet / FB shared / IG cross-posted-from-FB. */
  parent_post_id?: string;
  has_video?: boolean;
  has_carousel?: boolean;
  hashtags?: string[];
  /** TikTok — sound name. */
  sound?: string;
  /**
   * Sponsored/Ad/Promoted post indicator. Universal across all 5 platforms
   * (each detects via its own DOM marker per `extractIs<Platform>Sponsored`
   * adapter helper). When true, the prompt builder emits a `Sponsored: yes`
   * line in `[POST_ENVIRONMENT]` and the classifier weights commercial-
   * intent context (per Rule 3 REGISTER → commercial_pitch register prevents
   * false-positive on standard ad copy tropes that read as fear-appeal in
   * non-commercial context).
   */
  is_sponsored?: boolean;
}

export interface CommentNode {
  id: string;
  kind: CommentNodeKind;
  /** 1 = top-comment, 2 = reply, 3 = reply-to-reply. (PostNode is implicitly 0.) */
  depth: 1 | 2 | 3;
  /** Platform-local id of the immediate parent (post or comment). */
  parent_id: string;
  text: string;
  author: CommentAuthor;
  age_iso?: string;
  age_relative?: string;
  metrics: CommentMetrics;
  /** Render state at observation time (per RenderState above). */
  render_state: RenderState;
  /** Does FW already have a chain record for this node? */
  fw_marker_present: boolean;
  /** Child explicitly clicked expand to see this node. */
  expand_event_observed?: boolean;
  has_media?: boolean;
  mentions?: string[];
  /**
   * VISION §1.1 chain-mirror integrity. Comment was edited after first
   * publication (platform surfaces "Edited" / "Editat" marker). The kid
   * may have seen a different version than what the chain currently
   * records. Forensic export should clearly show this caveat so recipients
   * (judge / counselor / parent) understand the chain captures an
   * observation snapshot, not a guarantee of original wording.
   *
   * Captures the BOOLEAN edit-marker; full edit-history (the BEFORE text)
   * requires platform-API access most platforms gate behind verified
   * authorization.
   */
  is_edited?: boolean;
  /** ISO-8601 of when FW captured the edit-marker (may differ from age_iso). */
  edit_observed_at?: string;
  /**
   * Per-comment harm-floor pre-classification (text-only; no L1 cascade).
   * Populated by `scoreBatch` from `src/core/harm-floor.ts:computeHarmFloor`
   * with techniques=[] BEFORE the BATCH prompt is built, so
   * `buildCommentLine` can emit [HF:N category] as a per-comment flag the
   * Groq classifier consumes per RULE 12. Absent when the comment text was
   * empty or pre-filter found zero signal.
   */
  harm_floor?: CommentHarmFloor;
}

/**
 * The unit the BATCH classifier (and the V1 forensic chain) reasons about.
 *
 * Population rules:
 *   - `post` is always present (the environment root).
 *   - `ancestors` is non-empty ONLY for X-permalink (DOM renders the chain).
 *     For TikTok / IG / YT / FB the post IS the root; ancestors === [].
 *   - `focused` === `post` for surfaces where the post is the focal node.
 *     For X-permalink the focused node is the comment whose URL the child
 *     is at (the article with `tabindex="-1"`).
 *   - `children` is populated ONLY from rendered DOM at observation time.
 *     FW NEVER pre-fetches.
 *   - `expand_event_observed` flips on per-event when a child clicks an
 *     expand toggle; absent otherwise.
 */
export interface Encounter {
  platform: EncounterPlatform;
  surface: PlatformSurface;
  /** ISO-8601 of when FW captured this rendering moment (chain-mirror anchor). */
  observation_iso: string;
  /** Chain-unique id for this Encounter — references a forensic record root. */
  encounter_id: string;
  post: PostNode;
  /** Shallowest-first; non-empty only on X-permalink surfaces in V1. */
  ancestors: CommentNode[];
  /**
   * The node FW is centered on. For X-permalink the focused L1/L2/L3 comment
   * (the `tabindex="-1"` article); for all other surfaces, the post itself.
   */
  focused: PostNode | CommentNode;
  /** Direct children of `focused`, in display order. */
  children: CommentNode[];
  /** Sort lens the child sees (when DOM exposes it). */
  sort_order?: SortOrder;
  /** Platform-reported total (e.g. YouTube "2,436,408 Comments"). */
  comments_total?: number;
  /** Whether any comment in `children` carries a pinned-by-creator indicator. */
  has_pinned_indicator?: boolean;
  /**
   * ISO 639-1 hint or human language name; the classifier emits its
   * `reason` + `summary` in this language. Defaults to 'English' when
   * absent. Lives on Encounter (not PostNode) because the LLM output
   * language is a pipeline-level decision, not a node-level fact.
   */
  output_language?: string;
}
