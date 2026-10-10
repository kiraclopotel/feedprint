// Forensic dedup gate. Extracted from content/index.ts to break the
// runtime cycle index.ts <-> video-pipeline.ts (Audit 1 R5). Both
// modules now import shouldLogForensic from here, eliminating the
// back-edge from video-pipeline.ts to index.ts.
//
// Session-scoped dedup set: the same comment text seen twice in one
// session writes one forensic record, not two. Bounded by the characters it
// holds and by a far higher entry ceiling, shedding the oldest key only (see
// MAX_DEDUP_CHARS below for what the old 2000-entry half-drop cost).
// Cleared on extension reload (module re-init); not persisted to IDB.
// Verdict-by-text-hash persistence lives in pipeline.ts:processingCache.
//
// Two sets, one invariant: only a COMPLETED handling (rendered UI and/or
// a FORENSIC/PASS record) consumes the main dedup entry. A cancelled
// verdict (scrolled away mid-flight, batch slot truncated, LLM failure)
// is not-yet-handled — it dedups its own cancel records via the separate
// cancel set, so a re-encounter of the same text still gets the full
// treatment instead of a locked-in miss.

// Why the gate sits at the emit site (moved from content/index.ts):
// `processingCache` in pipeline.ts already prevents redundant LLM calls on
// identical post text for 60 minutes. BUT when a cache hit has
// `isManipulative: true`, pipeline returns a full PipelineResult and
// content/index.ts still emits `FORENSIC_LOG` for each DOM re-ingestion
// (scroll-back, retweet from the same author in the same feed, SPA navigation
// that re-mounts timeline nodes). The forensic store's `addRecord` is
// unconditional append — it does not dedup — so each cache hit manifests as a
// separate IDB record with the same text + signature. A real 202-record live
// scroll showed ~20% duplication matching this pattern.
//
// Gate FORENSIC_LOG emission on a session-scoped Set of post-text integrity
// keys. Skip if seen; still perform injection (UX path is per-DOM-element and
// must remain idempotent). Reset on page reload / SPA nav-away via
// `resetForensicDedup()` wired in with navigation listeners elsewhere.
//
// Deliberately NOT fixing at `addRecord` / IDB level: dedup-on-write would
// violate append-only forensic semantics (the store is legal evidence, not a
// K/V). Dedup at the emit site preserves "every record in the store is a
// real user-visible event" — the store remains the source of truth, but
// emission is gated so we only record ONCE per observed post.

import { bumpCounter } from '../../diagnostics/diagnostics';

const loggedForensicTexts = new Set<string>();

/**
 * The dedup key for an item: its platform, its id (or its URL, when it has
 * one) and its text together.
 *
 * Until 2026-09-13 the key was the text alone, so two different posts with the
 * same words (a chain-letter reply, a repost, a caption-less video hashing as
 * '') wrote one record between them, and "seen before" in the export could
 * only ever count cross-session repeats (wiring audit C5, C6). The id alone
 * would over-write on adapters whose comment ids are index-based fallbacks
 * (tk-cmt-<video>-<n>), so both halves stayed in the key.
 *
 * That still missed one case (GEMS.md gem 80, recount 11): an id is not
 * always stable across two captures of the same real item — a virtualizer
 * remount, or an adapter falling back to `crypto.randomUUID()` on a partial
 * read, mints a fresh one each time — so two captures of the same post keyed
 * differently and both got written (63 of 74 duplicate rows in one real
 * session). `sourceUrl` is the platform's own permalink and does not churn,
 * so it replaces the id in the key when the post has one. Text stays in the
 * key either way: Instagram's own comment walker falls back to the PARENT
 * post's URL when a comment has no `/c/` link of its own
 * (`instagram.ts`'s `_walkCommentsContainer`), so two different real
 * comments under one post can share a sourceUrl — text is what still tells
 * them apart. An empty sourceUrl (a failed extraction's own honest "no
 * permalink") is treated the same as none.
 *
 * A comment's own address is its anchorUrl; its sourceUrl can be the parent
 * post's, shared by every comment under it. So a comment without an anchorUrl
 * keeps its id in the key: a pile-on of one line by several accounts is
 * several records. The author is left out of the key because the wire can fill
 * it in later, which would move the key.
 */
export function forensicDedupKey(post: { platform: string; id: string; text: string; sourceUrl?: string; anchorUrl?: string; kind?: string }): string {
  const isComment = post.kind === 'comment' || post.kind === 'top-comment' || post.kind === 'reply' || post.kind === 'reply-to-reply';
  const ownAddress = isComment ? post.anchorUrl : post.sourceUrl;
  return post.platform + '\u0000' + (ownAddress || post.id) + '\u0000' + post.text;
}
const cancelLoggedTexts = new Set<string>();

/**
 * The bound on each set, and why it is two numbers rather than one.
 *
 * Until 2026-09-18 the bound was 2000 entries and an overflow dropped the
 * OLDEST HALF at a stroke. Both halves of that were wrong.
 *
 * The eviction size: a reader who scrolls past the cap and scrolls back got a
 * second signed record for a post already on the chain — precisely the
 * duplication this module's header says it exists to stop, reintroduced by its
 * own memory bound, and reintroduced 1000 items at a time. Every count this
 * product publishes is a count of these rows, so the inflation is not cosmetic.
 * The set now sheds the OLDEST KEY ONLY, one per insertion, which is also
 * cheaper: Set iteration order is insertion order, so the first key is O(1) and
 * the Array.from copy the half-drop needed is gone.
 *
 * The unit: an entry count is a bad proxy for memory, because the key carries
 * the item's full text (forensicDedupKey). 2000 keys of a 10,000-character post
 * is 40 MB; 2000 keys of a 20-character comment threw away 1000 items to save
 * 40 kB. The real bound is the characters held. 4,000,000 UTF-16 characters is
 * about 8 MB, three orders below the heap valve's 1536 MB
 * (diagnostics/diagnostics.ts), and it holds roughly 40,000 typical comments —
 * a scroll session that passes it is far longer than any this install has seen.
 * The entry ceiling stays as a second, independent bound so a pathological run
 * of empty keys cannot grow the Set itself without limit.
 */
const MAX_DEDUP_ENTRIES = 50_000;
const MAX_DEDUP_CHARS = 4_000_000;

const heldChars = new WeakMap<Set<string>, number>();

/**
 * What the shedding costs, named so a zero is never read as proof that no
 * duplicate row was ever written: the counter starts at the moment the session
 * starts, and an install that reloads loses it. A dedup entry dropped here is
 * not a lost record, it is a record that may be written twice, and this
 * codebase has no signed vocabulary for that direction (the gap marker states
 * a LOSS, forensics/gap-marker.ts). Until it does, this number is the only
 * trail from an inflated count back to its cause.
 */
function shedOldest(set: Set<string>): void {
  const oldest = set.keys().next().value;
  if (oldest === undefined) return;
  set.delete(oldest);
  heldChars.set(set, (heldChars.get(set) ?? 0) - oldest.length);
  bumpCounter('forensicDedupEvicted');
}

function boundedAdd(set: Set<string>, text: string): void {
  set.add(text);
  heldChars.set(set, (heldChars.get(set) ?? 0) + text.length);
  // A single key longer than the whole budget would otherwise empty the set on
  // every insertion; stop when this key is the only one left, so the item just
  // seen is always remembered.
  while (
    set.size > 1
    && (set.size > MAX_DEDUP_ENTRIES || (heldChars.get(set) ?? 0) > MAX_DEDUP_CHARS)
  ) {
    shedOldest(set);
  }
}

/**
 * Decide whether to write a forensic record for this text.
 * Returns true on first sighting (and adds to the dedup set);
 * false on repeats. Exported for unit coverage.
 */
export function shouldLogForensic(text: string): boolean {
  if (loggedForensicTexts.has(text)) return false;
  boundedAdd(loggedForensicTexts, text);
  return true;
}

/**
 * Non-consuming peek: has this text already been fully handled (record
 * written / UI rendered) this session? Loop gates use this instead of
 * shouldLogForensic so a branch that ends in a CANCEL record doesn't
 * consume the entry and lock out the re-encounter.
 */
export function hasLoggedForensic(text: string): boolean {
  return loggedForensicTexts.has(text);
}

/**
 * Dedup gate for CANCEL records (cancelled-stale / cancelled-mid-flight /
 * cancelled-dom-* / cancelled-batch-*). Dedups cancels against both sets —
 * an already-recorded text never gets a trailing cancel record, and the
 * same text isn't cancel-stamped twice — but NEVER consumes the main
 * entry: a cancelled item stays eligible for full handling on
 * re-encounter.
 */
export function shouldLogCancelForensic(text: string): boolean {
  if (loggedForensicTexts.has(text)) return false;
  if (cancelLoggedTexts.has(text)) return false;
  boundedAdd(cancelLoggedTexts, text);
  return true;
}

/** Test-only: clears both dedup sets. Exported for test isolation. */
export function _resetForensicDedupForTesting(): void {
  loggedForensicTexts.clear();
  cancelLoggedTexts.clear();
  heldChars.set(loggedForensicTexts, 0);
  heldChars.set(cancelLoggedTexts, 0);
}
