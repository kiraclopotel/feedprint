// FeelingWise — Encounter constructor for flushBatch
//
// Bridges per-platform PostContent extraction and the BATCH classifier's
// Encounter input. X permalinks add rendered ancestry via a DOM walk; TikTok,
// Instagram, YouTube, and Facebook assemble platform-specific Encounters from
// extract-time signals. Incomplete or unrecognized observations use the legacy
// degraded bridge.

import type {
  Encounter,
  PostContent,
  CommentNode,
  PostNode,
  PlatformSurface,
} from '../../types/post';
import { encounterFromLegacyBatchInput } from '../../analysis/comment-batch-scorer';
import { buildPermalinkEncounterContext } from '../platforms/twitter';

/**
 * Build the Encounter for `flushBatch` to send to `scoreBatch`.
 *
 * For X-permalink surfaces (where ancestry exists in rendered DOM), walks the
 * DOM to lift the original post + ancestors + focused into rich Encounter
 * slots. Other supported platforms assemble their own surface, parent, child,
 * metric, and flag fields without a flush-time DOM walk. Missing platform or
 * surface signals fall back to `encounterFromLegacyBatchInput`.
 *
 * Per VISION §1.1 chain-mirror invariant: ancestry comes ONLY from rendered
 * DOM at call time. No pre-fetch, no chain-store lookup, no reconstruction.
 *
 * `expectedUrl` is the URL that was live when `bucket.posts` were observed.
 * `flushBatch` is debounced (`COMMENT_BATCH_DEBOUNCE_MS`); when it fires, the
 * user may have navigated to a DIFFERENT permalink between bucket-fill and
 * flush. The DOM walk in `buildPermalinkEncounterContext` would then bind
 * children-from-permalink-A to post+ancestors-from-permalink-B — a chain-
 * mirror invariant violation. The guard: if `window.location.href !==
 * expectedUrl`, skip the rich path → legacy fallback. Caller passes undefined
 * when no URL was stamped (legacy fallthrough path).
 */
/**
 * Q51 (W55): caption-side context the flush site captured at the
 * chokepoint. `post` is the caption/post PostContent (bucket.posts holds
 * comments only, so the assemblers' in-bucket lookup never finds one);
 * `author` is the bucket's denormalized parent author, the fallback when
 * no caption record was captured.
 */
export interface CaptionContext {
  post?: PostContent;
  author?: string;
}

/**
 * Is this post one of a root item's comment children?
 *
 * Accepts the `'comment'` alias, which `types/post.ts` documents as valid and
 * every assembler used to drop. The type file's own docblock says that
 * silent-drop class was "closed" by giving NodeKind a shared base; it was not —
 * the alias stayed legal and stayed unmatched, so a producer following the
 * documentation lost its comments and nothing failed.
 *
 * It cost YouTube /watch its entire comment section. yt-watch-comments.ts
 * stamps `kind: 'comment'` exactly as documented, every comment fell out here,
 * and scoreBatch was then called with zero children — so the comments were
 * never judged, the deterministic harm-floor fallback that protects during a
 * provider outage never ran either (it iterates the same empty list), and each
 * distinct comment text was written to the chain as a cancelled record naming a
 * Groq model and provider for a call that was never made.
 *
 * Depth still decides the node's own kind below; the alias only decides whether
 * the post is a child at all.
 */
export function isCommentChildKind(kind: string | undefined): boolean {
  return kind === 'top-comment' || kind === 'reply' || kind === 'reply-to-reply' || kind === 'comment';
}

export function buildEncounterForFlushBatch(
  posts: PostContent[],
  caption: string,
  language: string,
  expectedUrl?: string,
  captionCtx?: CaptionContext,
): Encounter {
  if (posts.length === 0) {
    return encounterFromLegacyBatchInput({
      comments: [],
      videoCaption: caption,
      language,
    });
  }

  const first = posts[0];
  const platformSpec = first.platform_specific;

  // URL cohesion guard. Only honor the rich-Encounter path when
  // the page is still on the URL bucket.posts were observed at. Mismatch ⇒
  // navigation between fill and flush ⇒ DOM ancestry is from a different
  // permalink than the children ⇒ fall back to legacy degraded.
  const currentUrl =
    typeof window !== 'undefined' && window.location ? window.location.href : '';
  const urlCohesionOk = !expectedUrl || currentUrl === expectedUrl;

  // X-permalink rich path
  const isXPermalink =
    first.platform === 'twitter' &&
    platformSpec?.platform === 'twitter' &&
    platformSpec.surfaceKind === 'twitter-permalink';

  if (isXPermalink && urlCohesionOk) {
    const ctx = buildPermalinkEncounterContext();
    if (ctx) {
      return assembleXPermalinkEncounter(posts, language, ctx);
    }
    // Fall through to degraded when DOM walk failed (no tabindex="-1" found,
    // page mid-render, etc.). Better degraded-but-flushed than blocked.
  }

  // TikTok rich path — bucket has caption + videoAuthor; per-
  // PostContent has metrics + flags in platform_specific.tiktok. No DOM walk
  // needed at flush time (everything was captured at extract time).
  const isTikTok =
    first.platform === 'tiktok' &&
    platformSpec?.platform === 'tiktok' &&
    platformSpec.surfaceKind !== undefined;

  if (isTikTok && urlCohesionOk) {
    return assembleTikTokEncounter(posts, caption, language, captionCtx);
  }

  // Instagram rich path — same shape as TikTok (no ancestry; post
  // is root; per-PostContent has metrics + flags). IG-specific surfaces:
  // post / reel / story.
  const isInstagram =
    first.platform === 'instagram' &&
    platformSpec?.platform === 'instagram' &&
    platformSpec.surfaceKind !== undefined;

  if (isInstagram && urlCohesionOk) {
    return assembleInstagramEncounter(posts, caption, language, captionCtx);
  }

  // YouTube rich path — comments are flat-or-replies under a
  // single video. Per-PostContent has metrics + flags including the unique
  // YT signals (verified-channel, creator-heart, pinned). Surfaces: watch / shorts.
  const isYouTube =
    first.platform === 'youtube' &&
    platformSpec?.platform === 'youtube' &&
    platformSpec.surfaceKind !== undefined;

  if (isYouTube && urlCohesionOk) {
    return assembleYouTubeEncounter(posts, caption, language, captionCtx);
  }

  // Facebook rich path — comments under a permalink/home/reel/photo
  // post. Per-PostContent has metrics + flags + the FB-unique reactions/shares
  // signals. The 6-emotion reaction-profile (FB's unique strength per V1.5 P12)
  // is NOT extracted at V1; only aggregate counts.
  const isFacebook =
    first.platform === 'facebook' &&
    platformSpec?.platform === 'facebook' &&
    platformSpec.surfaceKind !== undefined;

  if (isFacebook && urlCohesionOk) {
    return assembleFacebookEncounter(posts, caption, language, captionCtx);
  }

  return enrichLegacyEncounter(posts, caption, language);
}

function assembleXPermalinkEncounter(
  children: PostContent[],
  language: string,
  ctx: NonNullable<ReturnType<typeof buildPermalinkEncounterContext>>,
): Encounter {
  const surface: PlatformSurface = {
    kind: 'twitter-permalink',
    conversation_id: ctx.conversationId,
  };

  // Direct parent of the children = the focused node. This is the parent_id
  // each child PostContent should already carry (twitter.ts:extractPosts
  // populates it via walkPermalinkTree), but we fall back to focused.id when
  // the field is absent (legacy / non-permalink-extracted PostContent).
  const focusedId = ctx.focused.id;

  // Default depth for children = focused.depth + 1 (cap at 3). For X-permalink
  // children-of-focused, twitter.ts:extractPosts already stamps the right
  // depth on PostContent — this fallback is for cases where the field was
  // missed.
  const focusedDepth = 'depth' in ctx.focused ? ctx.focused.depth : 0;
  const fallbackChildDepth = (Math.min(focusedDepth + 1, 3) || 1) as 1 | 2 | 3;

  const childCommentNodes: CommentNode[] = children.map((p, idx) => {
    const ps = p.platform_specific;
    const tw = ps?.platform === 'twitter' ? ps : undefined;
    const m = tw?.metrics;
    const verified = !!tw?.verified;

    // Prefer the per-PostContent depth (twitter.ts stamps it for permalink);
    // fall back to fallbackChildDepth.
    const depthRaw = p.depth ?? fallbackChildDepth;
    const depth = (Math.max(1, Math.min(3, depthRaw)) || 1) as 1 | 2 | 3;
    const kind: CommentNode['kind'] =
      depth === 1 ? 'top-comment' : depth === 2 ? 'reply' : 'reply-to-reply';

    return {
      id: p.id || `child-${idx}`,
      kind,
      depth,
      parent_id: p.parent_id ?? focusedId,
      text: p.text,
      author: {
        handle: p.author,
        verified,
        // X does NOT surface these flags natively.
        // is_pinned_by_creator and is_creator_hearted are platform-specific
        // signals that exist on TikTok / YouTube but not X. The hardcode-false
        // here is the correct mapping for X-permalink children. Per-platform
        // assemblers (assembleTikTokEncounter / assembleYouTubeEncounter)
        // populate these from their own platform_specific signals.
        is_pinned_by_creator: false,
        is_creator_hearted: false,
      },
      metrics: {
        likes: m?.likes,
        reply_count: m?.replies,
        views: m?.views,
      },
      render_state: p.render_state ?? 'visible-now',
      fw_marker_present: false,
      expand_event_observed: p.expand_event_observed,
      // propagate edit-marker for chain-mirror integrity.
      is_edited: tw?.isEdited,
    };
  });

  return {
    platform: 'twitter',
    surface,
    observation_iso: new Date().toISOString(),
    encounter_id: newEncounterId(),
    post: ctx.post,
    ancestors: ctx.ancestors,
    focused: ctx.focused,
    children: childCommentNodes,
    output_language: language,
  };
}

/**
 * assemble a rich TikTok Encounter from bucket data + per-
 * PostContent platform_specific.tiktok signals. Unlike X-permalink, TikTok
 * doesn't need a DOM walk at flush-time: the post (caption/author) is on
 * the bucket and the per-comment metrics + flags were stamped at extraction
 * time by tiktok.ts. This keeps the chain-mirror invariant (every byte
 * traces to extract-time DOM) without re-walking after the debounce window.
 */
function assembleTikTokEncounter(
  posts: PostContent[],
  caption: string,
  language: string,
  captionCtx?: CaptionContext,
): Encounter {
  const first = posts[0];
  const ps = first.platform_specific;
  const tk = ps?.platform === 'tiktok' ? ps : undefined;
  const surfaceKind = tk?.surfaceKind ?? 'tiktok-feed';

  // Surface descriptor — needs video_id; pull from parentVideoId (the bucket
  // key, set by the adapter to the TikTok video container's id).
  const videoId = first.parentVideoId ?? 'unknown';
  const surface: PlatformSurface =
    surfaceKind === 'tiktok-permalink'
      ? { kind: 'tiktok-permalink', video_id: videoId }
      : { kind: 'tiktok-feed', video_id: videoId, comment_panel_open: true };

  // Post node — caption text + creator handle from bucket. Metrics on the
  // post itself aren't extracted by the bundle today (V1.5 candidate);
  // leave PostMetrics empty and let the prompt builder render
  // "(no metrics extracted)" gracefully.
  //
  // propagate sponsored flag from the caption PostContent. Q51 (W55): the
  // in-bucket find never matched (bucket.posts holds comments only); the
  // chokepoint-captured caption record is the real source, the bucket's
  // denormalized author the fallback.
  const captionPostTk = posts.find((p) => p.kind === 'video') ?? captionCtx?.post;
  const post: PostNode = {
    id: videoId,
    kind: 'video',
    text: caption,
    author: { handle: captionPostTk?.author ?? captionCtx?.author ?? '', verified: false, is_creator: true },
    metrics: {},
    is_sponsored: captionPostTk?.is_sponsored,
  };

  // Children = comment posts only. The caption record (kind='video') was
  // already lifted into `post` above; including it again in children would
  // make the classifier see the caption text twice (once as the post body,
  // once as a top-comment child) and risk flagging the post body as a
  // hostile comment. Mirrors the FB encounter assembler's filter below.
  const childPosts = posts.filter((p) => isCommentChildKind(p.kind));

  const childCommentNodes: CommentNode[] = childPosts.map((p, idx) => {
    const childPs = p.platform_specific;
    const childTk = childPs?.platform === 'tiktok' ? childPs : undefined;
    const m = childTk?.metrics;

    // Depth: prefer per-PostContent depth (twitter-style); fall back to 1.
    const depth = (p.depth && p.depth >= 1 && p.depth <= 3 ? p.depth : 1) as 1 | 2 | 3;
    const kind: CommentNode['kind'] =
      depth === 1 ? 'top-comment' : depth === 2 ? 'reply' : 'reply-to-reply';

    return {
      id: p.id || `tk-child-${idx}`,
      kind,
      depth,
      parent_id: p.parent_id ?? videoId,
      text: p.text,
      author: {
        handle: p.author,
        verified: false, // TikTok verified per-comment is rare; not extracted by bundle today
        is_pinned_by_creator: !!childTk?.isPinned,
        is_creator_hearted: !!childTk?.isCreatorHearted,
      },
      metrics: {
        likes: m?.likes,
        reply_count: m?.reply_count,
      },
      render_state: p.render_state ?? 'visible-now',
      fw_marker_present: false,
      expand_event_observed: p.expand_event_observed,
      // TikTok N/A (no surfaced edit marker); leave undefined.
    };
  });

  return {
    platform: 'tiktok',
    surface,
    observation_iso: new Date().toISOString(),
    encounter_id: newEncounterId(),
    post,
    ancestors: [],
    focused: post,
    children: childCommentNodes,
    output_language: language,
  };
}

/**
 * assemble a rich Instagram Encounter from bucket data + per-
 * PostContent platform_specific.instagram signals. Mirrors TikTok shape
 * (post-as-root, no ancestry) but uses IG-specific surface variants.
 *
 * Per VISION §1.1 chain-mirror: IG likes are obscured (product policy) on
 * the post itself; per-comment likes ARE surfaced when the modal renders
 * them. The PostMetrics.likes_obscured flag signals the gap to the classifier.
 */
function assembleInstagramEncounter(
  posts: PostContent[],
  caption: string,
  language: string,
  captionCtx?: CaptionContext,
): Encounter {
  // Scan ALL posts (not just `posts[0]`) for IG platform_specific. On a
  // lazy-load re-extract flush carrying ONLY new comments, posts[0] is a
  // comment record; comments DO stamp `surfaceKind` but `hasCarousel` is
  // stamped ONLY on the caption record at `instagram.ts`. Without this
  // scan, every re-extract loses the carousel signal mid-conversation.
  const ig = posts
    .map((p) => p.platform_specific)
    .find((spec) => spec?.platform === 'instagram') as
      | (PostContent['platform_specific'] & { platform: 'instagram' })
      | undefined;
  const first = posts[0];
  const surfaceKind = ig?.surfaceKind ?? 'instagram-post';

  const postId = first.parentVideoId ?? 'unknown';

  // Surface descriptor per kind.
  const surface: PlatformSurface =
    surfaceKind === 'instagram-reel'
      ? { kind: 'instagram-reel', reel_id: postId }
      : surfaceKind === 'instagram-story'
      ? { kind: 'instagram-story', story_id: postId }
      : { kind: 'instagram-post', post_id: postId };

  // Post node: caption text + IG product-policy likes-obscured flag.
  // propagate sponsored flag from the caption PostContent.
  // Q51 (W55): in-bucket find never matched; chokepoint caption + bucket
  // author are the real sources.
  const captionPostIg = posts.find((p) => p.kind === 'post' || p.kind === 'video') ?? captionCtx?.post;
  const post: PostNode = {
    id: postId,
    kind: surfaceKind === 'instagram-reel' ? 'reel' : 'post',
    text: caption,
    author: { handle: captionPostIg?.author ?? captionCtx?.author ?? '', verified: false, is_creator: true },
    metrics: {
      likes_obscured: true, // IG product policy obscures post likes
    },
    has_carousel: ig?.hasCarousel,
    is_sponsored: captionPostIg?.is_sponsored,
  };

  // Children = comment posts only. Caption (kind='post'|'video') already
  // lifted into `post`; filter prevents duplicate-text exposure to the
  // classifier. Mirrors the FB encounter assembler's filter below.
  const childPosts = posts.filter((p) => isCommentChildKind(p.kind));

  const childCommentNodes: CommentNode[] = childPosts.map((p, idx) => {
    const childPs = p.platform_specific;
    const childIg = childPs?.platform === 'instagram' ? childPs : undefined;
    const m = childIg?.metrics;

    const depth = (p.depth && p.depth >= 1 && p.depth <= 3 ? p.depth : 1) as 1 | 2 | 3;
    const kind: CommentNode['kind'] =
      depth === 1 ? 'top-comment' : depth === 2 ? 'reply' : 'reply-to-reply';

    return {
      id: p.id || `ig-child-${idx}`,
      kind,
      depth,
      parent_id: p.parent_id ?? postId,
      text: p.text,
      author: {
        handle: p.author,
        verified: !!childIg?.isVerified,
        is_pinned_by_creator: false, // IG doesn't surface comment-pinning natively
        is_creator_hearted: false,   // IG has heart-like but it's just engagement, not "creator hearted"
      },
      metrics: {
        likes: m?.likes,
        reply_count: m?.reply_count,
      },
      render_state: p.render_state ?? 'visible-now',
      fw_marker_present: false,
      expand_event_observed: p.expand_event_observed,
      // propagate edit-marker for chain-mirror integrity.
      is_edited: childIg?.isEdited,
    };
  });

  return {
    platform: 'instagram',
    surface,
    observation_iso: new Date().toISOString(),
    encounter_id: newEncounterId(),
    post,
    ancestors: [],
    focused: post,
    children: childCommentNodes,
    output_language: language,
  };
}

/**
 * assemble a rich YouTube Encounter from bucket data + per-
 * PostContent platform_specific.youtube signals. YT comments are flat-or-
 * single-level-reply under a video (no deep ancestry chain), so the shape
 * mirrors TikTok/IG. Per VISION §1.1 chain-mirror, all signals come from
 * extract-time DOM (no flush-time re-walk).
 */
function assembleYouTubeEncounter(
  posts: PostContent[],
  caption: string,
  language: string,
  captionCtx?: CaptionContext,
): Encounter {
  const first = posts[0];
  const ps = first.platform_specific;
  const yt = ps?.platform === 'youtube' ? ps : undefined;
  const surfaceKind = yt?.surfaceKind ?? 'youtube-watch';

  // youtube-community: standalone channel posts (no parent video). The
  // PostContent stamps `parentVideoId: id` so the assembler can use the
  // same "container-id" lookup as watch/shorts; PostNode then renders
  // as kind:'post' (not 'video') to honor the chain-mirror semantics.
  const videoId = first.kind === 'video' ? first.id : (first.parentVideoId ?? 'unknown');

  const surface: PlatformSurface =
    surfaceKind === 'youtube-shorts'
      ? { kind: 'youtube-shorts', video_id: videoId }
      : surfaceKind === 'youtube-community'
        ? { kind: 'youtube-community', post_id: videoId }
        : surfaceKind === 'youtube-home'
          ? { kind: 'youtube-home', video_id: videoId }
          : { kind: 'youtube-watch', video_id: videoId };

  // propagate sponsored flag from the container PostContent. Watch / shorts
  // emit kind:'video'; community emits kind:'post' (no parent video).
  // Q51 (W55): in-bucket find never matched; chokepoint caption + bucket
  // author are the real sources.
  const captionPostYt = posts.find((p) =>
    surfaceKind === 'youtube-community' ? p.kind === 'post' : p.kind === 'video',
  ) ?? captionCtx?.post;
  const post: PostNode = {
    id: videoId,
    kind:
      surfaceKind === 'youtube-shorts'
        ? 'short'
        : surfaceKind === 'youtube-community'
          ? 'post'
          : 'video',
    text: caption,
    author: { handle: captionPostYt?.author ?? captionCtx?.author ?? '', verified: false, is_creator: true },
    metrics: {},
    is_sponsored: captionPostYt?.is_sponsored,
  };

  // Children = comment posts only. Description record (kind='video') already
  // lifted into `post`; filter prevents duplicate-text exposure to the
  // classifier. Mirrors the FB encounter assembler's filter below.
  const childPosts = posts.filter((p) => isCommentChildKind(p.kind));

  const childCommentNodes: CommentNode[] = childPosts.map((p, idx) => {
    const childPs = p.platform_specific;
    const childYt = childPs?.platform === 'youtube' ? childPs : undefined;
    const m = childYt?.metrics;

    const depth = (p.depth && p.depth >= 1 && p.depth <= 3 ? p.depth : 1) as 1 | 2 | 3;
    const kind: CommentNode['kind'] =
      depth === 1 ? 'top-comment' : depth === 2 ? 'reply' : 'reply-to-reply';

    return {
      id: p.id || `yt-child-${idx}`,
      kind,
      depth,
      parent_id: p.parent_id ?? videoId,
      text: p.text,
      author: {
        handle: p.author,
        verified: !!childYt?.isVerified,
        is_pinned_by_creator: !!childYt?.isPinned,
        is_creator_hearted: !!childYt?.isCreatorHearted,
      },
      metrics: {
        likes: m?.likes,
        reply_count: m?.reply_count,
      },
      render_state: p.render_state ?? 'visible-now',
      fw_marker_present: false,
      expand_event_observed: p.expand_event_observed,
      // propagate edit-marker for chain-mirror integrity.
      is_edited: childYt?.isEdited,
    };
  });

  return {
    platform: 'youtube',
    surface,
    observation_iso: new Date().toISOString(),
    encounter_id: newEncounterId(),
    post,
    ancestors: [],
    focused: post,
    children: childCommentNodes,
    output_language: language,
  };
}

/**
 * assemble a rich Facebook Encounter from bucket data + per-
 * PostContent platform_specific.facebook signals. FB's render is per-expand
 * inline (~5 replies per "Vezi N răspunsuri" click), so the comment list grows
 * incrementally; each flush reflects what the child saw at that moment.
 *
 * V1 carries aggregate post metrics when stamped on the caption record. V1.5
 * adds the 6-emotion reaction-profile (FB's unique strength) per master plan P12.
 */
function assembleFacebookEncounter(
  posts: PostContent[],
  caption: string,
  language: string,
  captionCtx?: CaptionContext,
): Encounter {
  const first = posts[0];
  const ps = first.platform_specific;
  const fb = ps?.platform === 'facebook' ? ps : undefined;
  const surfaceKind = fb?.surfaceKind ?? 'facebook-permalink';

  const postId = first.parentVideoId ?? 'unknown';

  const surface: PlatformSurface =
    surfaceKind === 'facebook-reel'
      ? { kind: 'facebook-reel', reel_id: postId }
      : surfaceKind === 'facebook-photo-modal'
      ? { kind: 'facebook-photo-modal', post_id: postId, photo_id: postId }
      : surfaceKind === 'facebook-home-feed'
      ? { kind: 'facebook-home-feed', post_id: postId }
      : { kind: 'facebook-permalink', post_id: postId };

  // Look for a caption record carrying postReactions/postCommentsCount/postShares
  // (the adapter may stamp those on the caption only).
  // Q51 (W55): in-bucket find never matched; the chokepoint caption record
  // restores the FB caption metrics and sponsored flag, the bucket author
  // the handle.
  const captionPost = posts.find((p) => p.kind === 'post' || p.kind === 'video') ?? captionCtx?.post;
  const captionFb = captionPost?.platform_specific?.platform === 'facebook' ? captionPost.platform_specific : undefined;

  const post: PostNode = {
    id: postId,
    kind: surfaceKind === 'facebook-reel' ? 'reel' : captionPost?.kind === 'video' ? 'video' : 'post',
    text: caption,
    author: { handle: captionPost?.author ?? captionCtx?.author ?? '', verified: false, is_creator: true },
    metrics: {
      primary_likes: captionFb?.postReactions,
      comments_count: captionFb?.postCommentsCount,
      shares: captionFb?.postShares,
    },
    // propagate sponsored flag from caption PostContent.
    is_sponsored: captionPost?.is_sponsored,
  };

  // Children = comment posts only (skip the caption record we found above).
  const children = posts.filter((p) => isCommentChildKind(p.kind));

  const childCommentNodes: CommentNode[] = children.map((p, idx) => {
    const childPs = p.platform_specific;
    const childFb = childPs?.platform === 'facebook' ? childPs : undefined;
    const m = childFb?.metrics;

    const depth = (p.depth && p.depth >= 1 && p.depth <= 3 ? p.depth : 1) as 1 | 2 | 3;
    const kind: CommentNode['kind'] =
      depth === 1 ? 'top-comment' : depth === 2 ? 'reply' : 'reply-to-reply';

    return {
      id: p.id || `fb-child-${idx}`,
      kind,
      depth,
      parent_id: p.parent_id ?? postId,
      text: p.text,
      author: {
        handle: p.author,
        verified: !!childFb?.isVerified,
        is_pinned_by_creator: !!childFb?.isAuthor, // FB's "Author" label = creator-pinned-equivalent
        is_creator_hearted: false, // FB doesn't have creator-heart natively
      },
      metrics: {
        likes: m?.likes,
        reply_count: m?.reply_count,
      },
      render_state: p.render_state ?? 'visible-now',
      fw_marker_present: false,
      expand_event_observed: p.expand_event_observed,
      // propagate edit-marker for chain-mirror integrity.
      is_edited: childFb?.isEdited,
    };
  });

  return {
    platform: 'facebook',
    surface,
    observation_iso: new Date().toISOString(),
    encounter_id: newEncounterId(),
    post,
    ancestors: [],
    focused: post,
    children: childCommentNodes,
    output_language: language,
    sort_order: 'most_relevant', // FB default; V1.5 reads from sort dropdown
  };
}

function enrichLegacyEncounter(
  posts: PostContent[],
  caption: string,
  language: string,
): Encounter {
  // Pass platform hint so the surface discriminator matches the actual
  // platform; everything else degrades to the same shape as  ship.
  return encounterFromLegacyBatchInput(
    {
      comments: posts.map((p) => ({ author: p.author, text: p.text })),
      videoCaption: caption,
      language,
    },
    posts[0]?.platform,
  );
}

function newEncounterId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `enc-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
