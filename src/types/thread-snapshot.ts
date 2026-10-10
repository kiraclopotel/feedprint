// FeelingWise — ThreadSnapshot types
//
// A ThreadSnapshot is the unit of analysis for the bundle-first
// pipeline. Rather than classifying posts individually, the bundle
// path sends the whole thread (post + top N comments in their
// surface-order) to L1 so the LLM can infer topic, cascade, and
// register holistically.
//
// Scope:
//   • Carries an explicit pipelineVersion stamp so rollback /
//     forensics can tell which pipeline produced which record.
//   • Author identity is an author_hash slot (privacy). The current
//     extractor keeps the handle as-is; the hashing step is wired in
//     a later step. Keeping the field shape stable now so we don't
//     break callers when hashing lands.
//   • parent_id on CommentNode for nested-tree platforms (Twitter).
//     TikTok is flat so it stays null for now.

import { Platform } from './post';

// ─────────────────────────────────────────────────────────────────────────────
// VERSION STAMP
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Pipeline version stamped on every ThreadSnapshot + every forensic
 * record produced by this pipeline. Bump on ANY change to snapshot
 * shape or L1/L2 contract. Format: v3.<major>.<minor>-<stage-tag>.
 */
export const PIPELINE_VERSION = 'v3.0.0-stage1' as const;
type PipelineVersion = typeof PIPELINE_VERSION | string;

// ─────────────────────────────────────────────────────────────────────────────
// COMMENT NODE
// ─────────────────────────────────────────────────────────────────────────────

export interface CommentNode {
  /** Stable id if platform provides one; else synthetic UUID per extraction. */
  id: string;
  /** Raw handle/username as rendered in DOM. */
  author: string;
  /** Comment body text, trimmed. Original casing preserved (important for caps signal). */
  text: string;
  /**
   * 0-based index in the order the comments are SURFACED to the user.
   * NOT chronological. Reflects platform ranking (likes, recency, algorithmic).
   * Used by L1 to reason about cascade: top-surfaced hostile comments amplify
   * a borderline post more than bottom-surfaced ones.
   */
  surface_order: number;
  /**
   * Parent comment id for nested-tree platforms (Twitter replies). `null` for
   * flat platforms (TikTok, Instagram comments).
   */
  parent_id: string | null;
  /**
   * Engagement counts if the surface exposes them. Optional;
   * L1 tolerates undefined.
   */
  likes?: number;
  replies_count?: number;
  /**
   * Triviality gate. When `true`, the comment is emoji-only, a
   * sticker placeholder, or sub-threshold tokens with no named entity
   * — the bundle still includes it for cascade_intensity, but L1 is
   * instructed to assign NO individual flags. Undefined = not
   * evaluated / default substantive.
   */
  trivial?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// POST
// ─────────────────────────────────────────────────────────────────────────────

export interface PostSnapshot {
  id: string;
  author: string;
  text: string;
  /**
   * Sparse engagement counts where available. Undefined is normal — TikTok
   * video views aren't always scrape-safe.
   */
  likes?: number;
  comments_count?: number;
  shares?: number;
  /** ISO-8601 if scrapable from DOM. Many platforms show "3d ago" only. */
  timestamp?: string;
  /** Canonical URL for forensic provenance. Empty string if not derivable. */
  source_url: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// THREAD SNAPSHOT — the L1 input contract
// ─────────────────────────────────────────────────────────────────────────────

export interface ThreadSnapshot {
  /** Pipeline version stamp. Forensic records inherit this. */
  pipeline_version: PipelineVersion;
  /** Monotonic timestamp at extraction time (Date.now()). */
  extracted_at: number;
  platform: Platform;
  post: PostSnapshot;
  /**
   * Comments in surface_order. Length = min(N_requested, actual_available).
   * Default N = 10. Callers may request fewer for testing.
   */
  comments: CommentNode[];
  /**
   * Locale hint for L1 prompt selection. 'en' | 'ro' | 'mixed' | 'unknown'.
   * Mixed flag triggers RO-aware prompt.
   */
  locale_hint: 'en' | 'ro' | 'mixed' | 'unknown';
  /**
   * Diagnostic metadata — useful for debugging extraction, not sent to L1.
   */
  extraction_meta: {
    /** Requested comment count; actual may be shorter. */
    requested_comments: number;
    /** If the DOM was missing expected elements, a short reason for telemetry. */
    warnings: string[];
  };
}
