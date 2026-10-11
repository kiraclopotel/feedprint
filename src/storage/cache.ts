// FeelingWise - Processing cache
// LRU cache keyed by SHA-256 of `${platform}|${mode}|${locale}|${outputLanguage}|${post.text}`, plus the parent's
// text for a reply (storage/cache-key.ts).
// The platform prefix isolates per-platform variance — the same caption
// reposted across X / TikTok / YouTube no longer shares a verdict, since
// DOM-context, comment-environment, and audience differ. The mode prefix
// isolates per-mode verdict differences — child mode uses a higher severity
// floor (7) and stricter confidence threshold (~0.45) than teen (6 / ~0.40),
// so the same post can flag in child but pass in teen; caching mode-
// agnostic would return a stale teen-pass verdict for a child-mode scan
// (or vice versa) and silently degrade family-safety guarantees. The
// locale prefix isolates rewrite output, which is language-locked to
// settings.locale.
// Cache key construction lives in pipeline.ts; this comment is the
// authoritative documentation. If you add a new key dimension upstream,
// also extend this list — otherwise future readers debug a phantom drift.
// Prevents re-processing identical content (retweets, reposts, scroll-back).
// Saves ~30-40% of API costs on feeds with repeated content.
// LRU correctness:
//   • get() — delete+set refreshes insertion order on every read, so a hot
//     entry stays at the back of the Map (least-recently-touched at the front).
//   • set() — when at capacity, evicts the first key, which is the
//     least-recently-touched after get() refreshes it. Map iteration is
//     insertion-order in JS, so this is a correct LRU eviction policy.

import { getBuildId } from '../core/build-id';
import { AnalysisResult } from '../types/analysis';

interface CacheEntry {
  analysis: AnalysisResult;
  neutralizedText: string | null;
  timestamp: number;
  /**
   * The judge that produced this verdict. A cache hit re-serves a cloud
   * verdict without calling anything, and the record written from it said
   * aiSource 'cloud' with no aiModel — a record asserting a judgement it
   * could not attribute (38 such rows in the 2026-09-08 export). Stored so a
   * re-served verdict names the same judge the first serving did. Absent on
   * rules-path verdicts, which have no model, and on entries cached before
   * this field existed.
   */
  aiMeta?: { model: string; provider: string };
  /**
   * The model that wrote `neutralizedText`, which on the adult path is not the
   * judge above. A re-served rewrite goes back on the page under the same
   * machine-readable mark, naming the same writer. Absent when no reply named one.
   */
  writerModel?: string;
}

const MAX_ENTRIES = 5000;
const MAX_AGE_MS = 60 * 60 * 1000; // 60 minutes

// Three-tier cache. L1 is the in-memory Map (fast, per-content-script).
// L2 is `chrome.storage.session`, shared across all tabs of the extension
// and surviving content-script restarts (SPA reloads, new tabs to the
// same site, F5). L2 evicts when the browser session ends. This handles
// the same-post-multiple-views case: open a tweet on home → click into
// the profile → click into the detail page — all three views share the
// same SHA-256 key, all three short-circuit on the cached result without
// re-paying the LLM.
// L3 is `chrome.storage.local` (efficiency program e3): cross-DAY
// re-serves are the algorithm's signature behavior (sequence.ts measures
// it) and FW's core thesis — yet the session cache forgot every verdict
// at browser close and re-paid Groq for the same content tomorrow. L3
// keeps verdicts ~7 days, capped, and is version-stamped with the
// extension version: any release (prompt or model changes always ship in
// one) invalidates old entries, so a stale verdict can never outlive the
// judge that produced it. chrome.storage.local — NOT page-origin
// IndexedDB, which a content script would share with the platform's own
// scripts (the page could read FW's verdicts; storage.local is
// extension-private).
const SESSION_PREFIX = 'fwc:';
const LOCAL_PREFIX = 'fwvc:';
const L3_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const L3_MAX_ENTRIES = 4000;
/** Fraction of L3 writes that trigger the lazy expiry/cap sweep. */
const L3_SWEEP_PROBABILITY = 0.02;

interface L3Entry extends CacheEntry {
  /** Extension version that produced the verdict — mismatch = miss. */
  v: string;
}

function cacheVersion(): string {
  let version = 'dev';
  try {
    version = chrome.runtime.getManifest().version;
  } catch { /* no manifest here: tests and harnesses */ }
  // The build id is part of it: the manifest version is the same on every rebuild of one release, and a verdict must
  // not outlive the build that judged it (a check added to the rewrite, a prompt changed). '' in a build with no id.
  const build = getBuildId();
  return build ? `${version}+${build}` : version;
}

class ProcessingCache {
  private cache = new Map<string, CacheEntry>();

  /**
   * Synchronous get from the in-memory L1 only. Used by paths that can't
   * afford an async hop. Misses don't fall through to L2.
   */
  get(textHash: string): CacheEntry | null {
    const entry = this.cache.get(textHash);
    if (!entry) return null;

    if (Date.now() - entry.timestamp > MAX_AGE_MS) {
      this.cache.delete(textHash);
      return null;
    }

    this.cache.delete(textHash);
    this.cache.set(textHash, entry);
    return entry;
  }

  /**
   * Async get that also checks L2 (chrome.storage.session) on L1 miss.
   * Hydrates L1 with the L2 hit so future synchronous gets within this
   * content-script lifetime are fast. Used by the pipeline so cross-tab
   * / cross-navigation re-views skip the LLM entirely.
   */
  async getPersistent(textHash: string): Promise<CacheEntry | null> {
    const l1 = this.get(textHash);
    if (l1) return l1;

    // L2 is `chrome.storage.session`, which a content script cannot reach unless the worker grants it (it does not):
    // there the area is absent, or refuses. L3 is `chrome.storage.local`, which a content script does reach, and it must
    // still be asked. Until 11 Oct 2026 an absent or refusing L2 ended the lookup, so L3 was written and never read, and
    // every post judged once was judged again after each page reload (the Tester's full test: 34 calls for 24 posts).
    if (typeof chrome !== 'undefined' && chrome.storage?.session) {
      try {
        const key = SESSION_PREFIX + textHash;
        const result = await chrome.storage.session.get(key);
        const entry = (result as Record<string, CacheEntry | undefined>)[key];
        if (entry) {
          if (Date.now() - entry.timestamp > MAX_AGE_MS) {
            await chrome.storage.session.remove(key);
          } else {
            // Hydrate L1.
            this.cache.set(textHash, entry);
            return entry;
          }
        }
      } catch { /* L2 is not reachable from here: L3 still holds the verdict */ }
    }
    return this.getL3(textHash);
  }

  /**
   * L3 lookup (chrome.storage.local, ~7-day TTL). A hit hydrates L1 + L2
   * with a REFRESHED timestamp — the verdict re-enters the fast tiers as
   * if just produced (it is identical content under an identical judge).
   */
  private async getL3(textHash: string): Promise<CacheEntry | null> {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return null;
    try {
      const key = LOCAL_PREFIX + textHash;
      const result = await chrome.storage.local.get(key);
      const entry = (result as Record<string, L3Entry | undefined>)[key];
      if (!entry) return null;
      if (entry.v !== cacheVersion() || Date.now() - entry.timestamp > L3_MAX_AGE_MS) {
        void chrome.storage.local.remove(key).catch(() => {});
        return null;
      }
      // Rebuild from everything L3 actually stored, not a hand-listed subset
      // of fields. A hand-listed subset (analysis, neutralizedText,
      // timestamp only) is exactly what dropped aiMeta here: set() started
      // storing aiMeta into the L3 entry, this rehydration was never taught
      // to read it back out, and a verdict re-served a day later from the
      // persistent tier silently lost the judge it named on first serving
      // (the 2026-09-08 export's 38 unattributed rows; see the aiMeta
      // docblock above and the L3-rehydration test in
      // tests/unit/storage/cache.test.ts). Spreading the stored entry means
      // the next field added to CacheEntry survives the L3 round-trip by
      // construction, instead of depending on someone remembering to add it
      // to a list a second time.
      const { v: _v, ...stored } = entry;
      const fresh: CacheEntry = { ...stored, timestamp: Date.now() };
      this.cache.set(textHash, fresh);
      if (chrome.storage.session) {
        void chrome.storage.session.set({ [SESSION_PREFIX + textHash]: fresh }).catch(() => {});
      }
      return fresh;
    } catch {
      return null;
    }
  }

  /**
   * Store a processing result in BOTH L1 and L2. L2 write is fire-and-
   * forget — we don't await it before the pipeline returns to the caller,
   * so the rewrite doesn't pay an extra storage round-trip.
   */
  set(
    textHash: string,
    analysis: AnalysisResult,
    neutralizedText: string | null,
    aiMeta?: { model: string; provider: string },
    writerModel?: string,
  ): void {
    if (this.cache.size >= MAX_ENTRIES) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }

    const entry: CacheEntry = {
      analysis,
      neutralizedText,
      timestamp: Date.now(),
      ...(aiMeta ? { aiMeta } : {}),
      ...(writerModel ? { writerModel } : {}),
    };
    this.cache.set(textHash, entry);

    // L2 write — silently swallow failures (storage quota, missing API in
    // tests). The L1 entry is enough for in-tab navigation; L2 is the
    // cross-tab gravy.
    if (typeof chrome !== 'undefined' && chrome.storage?.session) {
      const key = SESSION_PREFIX + textHash;
      void chrome.storage.session.set({ [key]: entry }).catch(() => {});
    }

    // L3 write — cross-day persistence, version-stamped. Occasionally
    // sweeps expired / over-cap entries (off the hot path).
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      const l3: L3Entry = { ...entry, v: cacheVersion() };
      void chrome.storage.local.set({ [LOCAL_PREFIX + textHash]: l3 }).catch(() => {});
      if (Math.random() < L3_SWEEP_PROBABILITY) {
        void this.sweepL3().catch(() => {});
      }
    }
  }

  /**
   * Lazy L3 maintenance: drop expired / version-stale entries; when the
   * survivor count still exceeds the cap, drop oldest-first down to the
   * cap. One full read of chrome.storage.local — runs on ~2% of writes,
   * never on the read path.
   */
  private async sweepL3(): Promise<void> {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
    const all = await chrome.storage.local.get(null);
    const now = Date.now();
    const version = cacheVersion();
    const toRemove: string[] = [];
    const alive: { key: string; timestamp: number }[] = [];
    for (const [key, value] of Object.entries(all)) {
      if (!key.startsWith(LOCAL_PREFIX)) continue;
      const entry = value as Partial<L3Entry> | undefined;
      if (!entry || typeof entry.timestamp !== 'number' || entry.v !== version ||
          now - entry.timestamp > L3_MAX_AGE_MS) {
        toRemove.push(key);
      } else {
        alive.push({ key, timestamp: entry.timestamp });
      }
    }
    if (alive.length > L3_MAX_ENTRIES) {
      alive.sort((a, b) => a.timestamp - b.timestamp);
      for (const { key } of alive.slice(0, alive.length - L3_MAX_ENTRIES)) {
        toRemove.push(key);
      }
    }
    if (toRemove.length) {
      await chrome.storage.local.remove(toRemove);
    }
  }

  /**
   * Check if a hash exists in L1 (without touching LRU order). Does NOT
   * check L2; callers that care about L2 should use `getPersistent`.
   */
  has(textHash: string): boolean {
    const entry = this.cache.get(textHash);
    if (!entry) return false;

    if (Date.now() - entry.timestamp > MAX_AGE_MS) {
      this.cache.delete(textHash);
      return false;
    }

    return true;
  }

  /**
   * Clear both L1 and L2.
   */
  clear(): void {
    this.cache.clear();
    if (typeof chrome !== 'undefined' && chrome.storage?.session) {
      void chrome.storage.session.get(null).then(all => {
        const ourKeys = Object.keys(all).filter(k => k.startsWith(SESSION_PREFIX));
        if (ourKeys.length) {
          void chrome.storage.session.remove(ourKeys).catch(() => {});
        }
      }).catch(() => {});
    }
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      void chrome.storage.local.get(null).then(all => {
        const ourKeys = Object.keys(all).filter(k => k.startsWith(LOCAL_PREFIX));
        if (ourKeys.length) {
          void chrome.storage.local.remove(ourKeys).catch(() => {});
        }
      }).catch(() => {});
    }
  }

  get size(): number {
    return this.cache.size;
  }
}

// Singleton instance
export const processingCache = new ProcessingCache();
// The verdict cache-key input lives in ./cache-key (pure, dependency-free) so a
// test that mocks this stateful module needn't also mock the key builder.
