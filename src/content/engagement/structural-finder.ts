import { isInPrivateChatSubtree } from '../platforms/adapter';
import { hideElement } from './mark-hidden';
import { observeAddedRoots } from './added-roots';

// FeelingWise — Engagement-bar finder (4-tier redesign, )
//
// Replaces the prior single-signal approach (structural fingerprint +
// sibling extras + aria-label exact-match + wrapper walk) with a unified
// tier-fusion scoring system. Per the deep-research report:
//
//   compass_artifact_wf-18290717-...md (April 2026)
//
// the structural fingerprint failed on FB for four compounding reasons:
// (1) action-bar's immediate parent is no longer display:flex (Meta
// migrated parts to grid + StyleX inline-block shims), (2) spacer/divider
// children diluted the interactive ratio, (3) role="button" lives on
// grandchildren not direct children, (4) virtualization race left the
// scanner running against placeholder divs. Single signals can't catch
// all of these — we combine four orthogonal signals and require any two
// to flag.
//
// FIVE TIERS
//
//   aria-label match. Multi-language (EN/RO/ES/FR/DE/PT/IT/PL/HU)
//            stem set, NFD-decomposed + diacritic-stripped + lowercased,
//            substring-matched. Catches "Îmi place" via "imi place",
//            "Lasă un comentariu" via "lasa un coment", FB's full sentence
//            "Trimite acest conținut prietenilor tăi…" via "trimite".
//
//   SVG icon d-path prefix. Meta's Polaris icon library rotates
//            ~yearly (the same heart in 2024 has the same path in 2026
//            with at most antialiasing tweaks in the trailing decimals).
//            Match the leading ~40 chars of the path data.
//
//   Meta stable-hook proximity. The candidate is itself or
//            inside a container with data-visualcompletion="ignore-dynamic",
//            data-pagelet*="Feed", data-pagelet*="reels", role="feed",
//            role="article", or an actual <article> element. These hooks
//            survive class rotation because Meta's a11y mandate (and
//            their internal visual-regression tooling) requires them.
//
//   Loosened structural fingerprint. flex/grid/inline-flex on
//            the candidate OR its parent OR its grandparent (handles FB's
//            grid migration), 2-8 children, ≥50% of children contain an
//            interactive descendant (counting interactive SUBTREES, not
//            just direct children — fixes the "role=button on grandchild"
//            blind spot).
//
//   Count-text pattern. textContent of the candidate matches
//            "<digit><optional K/M/B suffix> <engagement-count noun>"
//            in RO/EN/ES/FR/DE/IT. Added after a live FB test
//            showed the count summary row migrated from
//            <a href="..."> anchors (caught by Pass C) to plain
//            <div role="button"> with NO aria-label, NO SVG, just
//            visible text like "194 comentarii" / "207 distribuiri".
//            4 scored 1/4 on these (only wrapper hit), below the
//            ≥2 threshold. Tier 5 + wrapper = 2 → tagged. Narrow regex
//            (digit + plural noun) keeps false-positive risk on
//            free-form post body text low; Pass A only iterates
//            interactive candidates so post text isn't reached anyway.
//
// Tier-fusion threshold: ≥2 tiers must hit before flagging. Single-tier
// hits stay invisible — that kills the IG carousel-dot strip false
// positive (only structural) while still flagging the real engagement
// bar (typically 3-4 tiers).
//
// audit swarm-2026-07-13 (ENG-1): the wrapper tier (Tier 3,
// `metaWrapperMatches`) is scored for diagnostics but EXCLUDED from the
// ≥2 count. It is guaranteed true for every candidate this scan ever
// sees (POST_CONTAINER_SELECTORS ⊆ META_STABLE_HOOK_SELECTOR — see
// scoreElement()), so counting it toward the threshold silently
// collapsed "≥2 independent tiers" to "≥1 real tier + free wrapper".
// The live threshold is ≥2 of the 4 remaining tiers {aria, svg,
// structural, count}.
//
// SCOPE
//
// Scans run inside [role="feed"] / <article> / [role="article"] /
// [data-pagelet*="Feed"] / [data-pagelet*="reels"] only — never across
// the whole document. Anything wrapped in [data-fw-essential] is hard-
// excluded so FeelingWise's own in-feed UI (teen marker, popover, action
// placeholder) is preserved verbatim.
//
// SCHEDULING (2026-09-03)
//
// Inserted subtrees are scanned at mutation time through the shared
// added-roots observer (engagement/added-roots.ts): the scan is bounded to
// the container the insert landed in and the hide is applied before the
// next paint. A 2 s full pass over the body is the safety net for content
// Meta fills into an existing placeholder without inserting nodes, and the
// IntersectionObserver re-scans virtualized articles as they scroll into
// view. The earlier shape (a full-body scan coalesced to every 250 ms on
// any mutation) was measured at ~150 ms per pass on a 28k-node page and
// ran four times a second while the feed moved.

const ESSENTIAL_SKIP_ATTR = '[data-fw-essential]';

// Container selectors. The scan walks each match and looks for
// engagement elements within. POST_CONTAINER_SELECTORS double as the
// IntersectionObserver target list.
const POST_CONTAINER_SELECTORS: readonly string[] = [
  'article',                            // IG feed posts
  'div[role="article"]',                // FB feed posts
  '[data-pagelet*="reels"]',            // FB + IG reels
  '[data-pagelet*="FeedUnit"]',         // FB feed-unit pagelets
  // A live FB test scored 0 across all four
  // tiers despite 2 articles in DOM. Diagnosis: in the modern FB news-
  // feed layout, the engagement bar wrapper [data-visualcompletion=
  // "ignore-dynamic"] is a SIBLING of div[role="article"], not a
  // descendant. Scoping the scan to articles alone misses the bar
  // entirely. Adding the visual-completion wrapper as a top-level scan
  // target catches it. False-positive risk (the same attribute wraps
  // avatars, tooltips, etc.) is blocked by the tier-fusion threshold
  // (avatars lack engagement aria-labels and engagement SVG paths;
  // they score at most 1 tier and stay invisible).
  '[data-visualcompletion="ignore-dynamic"]',
  // (later) — FB photo viewer (/photo/?fbid=...) and
  // post modals open in [role="dialog"] / [role="complementary"]
  // wrappers without [data-visualcompletion]. Without these in the
  // container list, the inner engagement section is never iterated.
  // Same need on IG modals.
  '[role="dialog"]',
  '[role="complementary"]',
  // (even later) — FB Reels page wraps the entire
  // viewer + engagement column in <div role="main"> with no other
  // container marker. An ancestor diagnostic showed [role="main"]
  // at depth 14 with no [data-pagelet], no [role="article"], no
  // [data-visualcompletion]. Adding [role="main"] here so the scan
  // walks the Reels container; Tier 3 wrapper match (already added to
  // META_STABLE_HOOK_SELECTOR) gives the engagement-button score the
  // ≥2-tier total it needs.
  '[role="main"]',
];

const POST_CONTAINER_SELECTOR = POST_CONTAINER_SELECTORS.join(', ');

// ─── Tier 1 data ───────────────────────────────────────────────────────────
//
// Multi-language aria-label stems. NFD-decomposed + diacritic-stripped +
// lowercased before comparison. Verified against Romanian DOM dumps from
// a live test + community DOM dumps from EN/ES/FR/DE/PT/IT/PL/HU
// for IG and FB. Substring matching — "lasa un coment" catches FB's full
// "Lasă un comentariu" label; "trimite" catches FB's
// "Trimite acest conținut prietenilor tăi sau postează-l în profilul tău."

const ARIA_STEM_SET: readonly string[] = [
  // Like / Unlike
  'like', 'unlike', 'apreci', 'imi place', 'me gusta', 'j aime',
  'gefallt mir', 'curtir', 'gosto', 'mi piace', 'lubie', 'polub',
  'tetszik', 'cofnij',
  // Comment
  // IG session — `comenta` (7 chars) was too long for
  // Romanian -ează verb conjugation. fold("Comentează") = "comenteaza"
  // and `comenta` (c-o-m-e-n-t-a) is NOT a substring of "comenteaza"
  // (c-o-m-e-n-t-e-a-z-a — letter 7 is `e`, not `a`). Shortened to
  // `coment` (6 chars) which catches all Romanian conjugated forms +
  // Comentariu / Comentarii (count nouns) + ES/PT Comentar. EN
  // `comment` stays separate (double m).
  'comment', 'coment', 'kommentier', 'commenta', 'skomentuj',
  'hozzaszolas', 'lasa un coment',
  // Share / Send — : added `distribu` after a live FB
  // Reels test showed the share button (aria-label "Distribuie")
  // not matching any stem and staying visible while Like / Comment
  // hid correctly.
  // (IG session): added `repost` after a live IG Reels
  // test showed the repost button (aria-label "Repostează", cyclic-
  // arrow icon — distinct from "Distribuie" paper-airplane share) not
  // matching and staying visible. IG separates "Distribuie" (DM-share)
  // from "Repostează" (story/feed re-share); we hide both.
  'share', 'partag', 'compart', 'teilen', 'condividi', 'partilh',
  'udostepnij', 'megosztas', 'trimite', 'envoyer', 'enviar',
  'invia', 'wyslij', 'distribu', 'repost',
  // Save / Saved
  'save', 'salv', 'guard', 'enregistr', 'speich', 'zapisz', 'mentes',
  // React (long-press menu)
  'react', 'reaccion', 'reagi', 'reagier', 'zareag', 'reagal',
];

// ─── Tier 2 data ───────────────────────────────────────────────────────────
//
// SVG d-path prefixes for Meta's engagement-icon library. Match by
// startsWith() against the first ~40 characters; Meta updates these
// roughly once per year and the leading bytes are stable across
// antialiasing tweaks. Recompute on a yearly cadence — emit a console
// warning when Tier 1 hits without Tier 2 (the canary that the icon
// set rotated). Source: deep-research report Q3, captured from
// production DOM dumps over 2024-2025.

const ICON_DPATH_PREFIXES: readonly string[] = [
  // IG outline heart (like)
  'M16.792 3.904A4.989 4.989 0 0 1 21.5 9.122',
  // IG filled heart (post-click like)
  'M34.6 6.1c5.7 0 10.4 5.2 10.4 11.5',
  // IG comment bubble
  'M20.656 17.008a9.993 9.993 0 1 0-3.59 3.615',
  // IG share / send paper plane (line element, not path; Tier 1
  // covers it via aria-label)
  'M22 3 9.218 10.083',
  // IG/FB bookmark (save)
  'M20 21l-7.5-5.5L5 21V3',
  // FB thumb (like, small + outline)
  'M6.235 21H3v-9h3.235V21z',
  // FB thumb filled (post-click like)
  'M11.645 4.444l.005-.005a3.585 3.585 0 0 1',
  // FB comment bubble
  'M21.07 11.286c0-4.86-4.123-8.572-9.07-8.572',
  // FB share curved arrow
  'M19.36 12.137 13.59 6.345a.85.85 0 0 0-1.45',
  // FB Care reaction
  'M19.05 11.05a4.95 4.95 0 0 0-7.05-7.07L11',
];

// ─── Tier 3 data ───────────────────────────────────────────────────────────

const META_STABLE_HOOK_SELECTOR =
  '[data-visualcompletion="ignore-dynamic"], '
  + '[data-pagelet*="Feed"], '
  + '[data-pagelet*="reels"], '
  + '[role="feed"], '
  + '[role="article"], article, '
  // (later) — modal coverage. FB photo viewer +
  // post-detail modals wrap engagement in [role="dialog"] or
  // [role="complementary"] (sidebar) without [data-visualcompletion].
  // Tier 3 needs to fire for these wrappers so engagement aria-label
  // matches (Tier 1) can pair to clear the ≥2 threshold. `main` (HTML
  // tag) and [role="main"] (ARIA attribute) are included as final
  // fallbacks for full-page engagement contexts (Reels, profile pages).
  // STEM_SET specificity (engagement verbs + count nouns) guards against
  // false-positives on non-engagement buttons that happen to live
  // inside main. The [role="main"] addition (even later)
  // followed a live Reels test: ancestor diagnostic showed
  // <div role="main"> but no <main> tag, no [data-pagelet], no
  // [role="article"] anywhere on the page — Tier 3 was scoring 0,
  // Reels engagement bar staying visible despite Tier 1 catching all
  // four aria-labels (Îmi place / Comentează / Distribuie / Reacționează).
  + '[role="dialog"], [role="complementary"], [role="main"], main';

// ─── Tier 5 data ───────────────────────────────────────────────────────────
//
// Count-text pattern: "<number><optional ,/./K/M/B> <count noun>". Matches
// text like "194 comentarii", "2,6 K reacții", "207 distribuiri",
// "5K likes", "1 comentariu". Case-insensitive. Romanian diacritics kept
// literal because fold() doesn't decompose ț/ș (they're non-decomposable
// Latin Extended-B chars, not precomposed-with-combining-mark forms).
// Both diacritic and ASCII variants listed for safety.
//
// Scope of Romanian count nouns confirmed from a real FB DOM
// dump: comentarii (comments), distribuiri (shares). Reacții/aprecieri
// added defensively — they appear in the reaction-summary anchor on
// posts with non-trivial engagement. Singular forms (comentariu,
// distribuire, reacție, apreciere) cover "1 X" cases.

const COUNT_TEXT_PATTERN =
  /(?:^|\s)\d[\d.,kmb\s]*\s+(?:comentarii|comentariu|distribuiri|distribuire|reacții|reacție|reactii|reactie|aprecieri|apreciere|share-uri|shares?|comments?|reactions?|likes?|kommentare?|partages?|commentaires?|comentarios?|reazioni|condivisioni)\b/i;

// ─── Helpers ───────────────────────────────────────────────────────────────

function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    // normalize ț/Ț (U+021B/U+021A) → t/T and ș/Ș
    // (U+0219/U+0218) → s/S manually. These are Latin Extended-B
    // characters with NO canonical NFD decomposition (unlike ţ/ş with
    // cedilla which DO decompose). Without this, modern Romanian
    // aria-labels using the proper t-comma-below / s-comma-below
    // characters miss STEM_SET matches that assume ASCII fallback.
    .replace(/[țȚ]/g, 't')
    .replace(/[șȘ]/g, 's')
    .toLowerCase()
    .trim();
}

function safeComputedStyle(el: HTMLElement): CSSStyleDeclaration | null {
  try {
    return getComputedStyle(el);
  } catch {
    return null;
  }
}

function isFlexLike(s: CSSStyleDeclaration | null): boolean {
  if (!s) return false;
  return s.display === 'flex' || s.display === 'grid' || s.display === 'inline-flex';
}

function containsInteractive(el: Element): boolean {
  if (!el) return false;
  const html = el as HTMLElement;
  if (html.matches?.('[role="button"], [role="toolbar"], button, a[href], svg[aria-label]')) return true;
  return !!html.querySelector?.('[role="button"], [role="toolbar"], button, a[href], svg[aria-label]');
}

// ─── Tier scoring ──────────────────────────────────────────────────────────

function ariaLabelMatches(el: Element): boolean {
  const label = el.getAttribute?.('aria-label');
  if (label) {
    const folded = fold(label);
    if (folded) {
      for (const stem of ARIA_STEM_SET) {
        if (folded.includes(stem)) return true;
      }
    }
  }
  // A live test: FB renders "Toate reacţiile: 74"
  // as <div role="button"> with NO aria-label, only visible text. The
  // text contains the stem `react` (via `reacţiile`), so a textContent
  // fallback catches it. Bounded length (60 chars) keeps post body links
  // — which can also be Pass A candidates via <a href> — from
  // false-matching when they happen to contain engagement words. Engagement
  // labels are short by nature ("Toate reacţiile: 74" ~20 chars,
  // "Lasă un comentariu" ~18); the bound is generous headroom.
  const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
  if (text && text.length <= 60) {
    const folded = fold(text);
    if (folded) {
      for (const stem of ARIA_STEM_SET) {
        if (folded.includes(stem)) return true;
      }
    }
  }
  return false;
}

function svgPathMatches(el: Element): boolean {
  const paths = el.querySelectorAll?.('svg path[d]');
  if (!paths) return false;
  for (const p of paths) {
    const d = (p.getAttribute('d') || '').replace(/\s+/g, ' ').trim();
    for (const prefix of ICON_DPATH_PREFIXES) {
      if (d.startsWith(prefix)) return true;
    }
  }
  return false;
}

function metaWrapperMatches(el: Element): boolean {
  return !!el.closest?.(META_STABLE_HOOK_SELECTOR);
}

function structuralMatches(el: Element): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const cs = safeComputedStyle(el);
  const parentCs = el.parentElement ? safeComputedStyle(el.parentElement) : null;
  const grandCs = el.parentElement?.parentElement
    ? safeComputedStyle(el.parentElement.parentElement)
    : null;
  if (!isFlexLike(cs) && !isFlexLike(parentCs) && !isFlexLike(grandCs)) return false;

  const kids = Array.from(el.children);
  // min children raised 2 → 3 after an FB modal
  // outerHTML showed comment-author avatars getting tagged. The avatar
  // pattern is <div role="button"> with 2 children (the avatar object
  // wrapper + an absolute-positioned tap-target overlay div); the
  // wrapper contains an interactive <a aria-label="Fotografie de profil">,
  // so 1/2 = 50% interactive children → passed Tier 4 ≥50% threshold.
  // Combined with Tier 3 (closest [role="article"] = the comment),
  // total = 2 tiers, tagged, hidden. Avatars are identity context,
  // not engagement. Real engagement bars have at least 3 buttons
  // (Like / Comment / Share, or a 3+ wide reaction toolbar). Lifting
  // the floor to 3 children skips the avatar pattern while still
  // catching every engagement bar shape we've observed.
  if (kids.length < 3 || kids.length > 8) return false;

  let interactive = 0;
  for (const k of kids) {
    if (containsInteractive(k)) interactive++;
  }
  return interactive / kids.length >= 0.5;
}

function countTextMatches(el: Element): boolean {
  const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
  if (!text) return false;
  // Bounded length — count rows are short ("194 comentarii" ~14 chars,
  // "2,6 K reacții" ~13 chars). A long body of text containing the
  // pattern incidentally shouldn't fire. 80 chars is generous headroom
  // for multi-noun rows ("194 comentarii 207 distribuiri").
  if (text.length > 80) return false;
  return COUNT_TEXT_PATTERN.test(text);
}

const TIER_FUSION_THRESHOLD = 2;

interface TierScore {
  aria: boolean;
  svg: boolean;
  wrapper: boolean;
  structural: boolean;
  count: boolean;
  total: number;
}

function scoreElement(el: Element): TierScore {
  // Cheap tiers first. The structural tier costs up to three
  // getComputedStyle calls (a style flush each), and it can only change the
  // verdict when exactly one cheap tier hit: with none the threshold is out
  // of reach, with two it is already met. Measured 2026-09-03: this and the
  // Pass B reorder below took the per-scan cost on a 28k-node page from
  // ~150 ms to under 20 ms. The wrapper tier is diagnostic only and is read
  // for the same candidates.
  const aria = ariaLabelMatches(el);
  const svg = svgPathMatches(el);
  const count = countTextMatches(el);
  const cheap = (aria ? 1 : 0) + (svg ? 1 : 0) + (count ? 1 : 0);
  const structural = cheap === 1 ? structuralMatches(el) : false;
  const wrapper = cheap > 0 ? metaWrapperMatches(el) : false;
  return {
    aria, svg, wrapper, structural, count,
    // wrapper is EXCLUDED from `total` — audit swarm-2026-07-13, ENG-1.
    // Every candidate scored here is a descendant of a container already
    // matched by POST_CONTAINER_SELECTOR (the outer scan-scope list, e.g.
    // `article`, `[role="dialog"]`, `[data-pagelet*="FeedUnit"]`), and
    // POST_CONTAINER_SELECTORS is a strict subset of/subsumed by
    // META_STABLE_HOOK_SELECTOR (Tier 3's selector — e.g. `[data-pagelet*=
    // "Feed"]` matches anything `*="FeedUnit"` already matched). That means
    // `el.closest(META_STABLE_HOOK_SELECTOR)` finds the enclosing container
    // (or something closer) for every candidate this function ever sees —
    // `wrapper` is a constant `true`, not an independent signal. Counting
    // it toward the fusion total silently collapsed the documented "≥2 of
    // 5 tiers" threshold to "≥1 real tier + free wrapper", which let a
    // single weak signal (e.g. aria-label containing the generic English
    // word "share") hide buttons inside a user-opened share/save dialog.
    // `wrapper` is still returned/aggregated into tierHits for the
    // per-tier diagnostic logging in instagram-engagement.ts /
    // facebook-engagement.ts — only its contribution to `total` is removed.
    total:
      (aria ? 1 : 0)
      + (svg ? 1 : 0)
      + (structural ? 1 : 0)
      + (count ? 1 : 0),
  };
}

// ─── Tagging ───────────────────────────────────────────────────────────────

// Inline display:none is the load-bearing hide mechanism. The CSS rule
// loses to Meta's StyleX !important at higher specificity (0,1,0 vs
// typical StyleX 0,1,1+); inline styles win against any non-inline
// declaration regardless. Cleanup restores `display` via controller.ts.
function tagAsEngagement(el: HTMLElement): boolean {
  if (el.dataset.fwEngagementBar === 'true') return false;
  if (el.closest(ESSENTIAL_SKIP_ATTR)) return false;
  // The scan only runs under hide-action-buttons (facebook-engagement.ts and
  // instagram-engagement.ts start it on `hideActions`); it used to stamp
  // hide-engagement-metrics and sent a "post disappeared" triage to the wrong
  // toggle (M116).
  hideElement(el, {
    marker: 'data-fw-engagement-bar', value: 'true',
    reason: 'hide-action-buttons:structural-bar',
  });
  return true;
}

// ─── Public API ────────────────────────────────────────────────────────────

export interface TagResult {
  /** Newly-tagged elements on this pass. Cumulative tagging is idempotent. */
  tagged: number;
  /**
   * Elements that met the tier-fusion threshold on this pass, whether newly
   * tagged or tagged on an earlier pass. `tagged` falls to zero in the steady
   * state (tagging is idempotent), so it cannot tell a rotated selector family
   * from a fully-processed page; this can. Selector-family sweep reporting
   * reads this, never `tagged` (RECON F3a, 2026-08-18).
   */
  matched: number;
  /** Number of post containers scanned. */
  containers: number;
  /** Per-tier hit counts (cumulative across all candidate elements). */
  tierHits: {
    aria: number;
    svg: number;
    wrapper: number;
    structural: number;
    count: number;
  };
}

export function tagEngagementElements(root: ParentNode = document): TagResult {
  let tagged = 0;
  let matched = 0;
  let containers = 0;
  const tierHits = { aria: 0, svg: 0, wrapper: 0, structural: 0, count: 0 };

  // Outermost containers only. The selector list nests (role=main holds the
  // feed, a post article holds its comment articles), so a nested container
  // was scanned once for itself and again inside every ancestor; every
  // candidate was scored three times per pass. A root that is itself a
  // container is scanned as one (the incremental path hands over comment
  // articles directly).
  const articles: HTMLElement[] = [];
  if (root instanceof HTMLElement && root.matches(POST_CONTAINER_SELECTOR)) {
    articles.push(root);
  } else {
    for (const a of root.querySelectorAll<HTMLElement>(POST_CONTAINER_SELECTOR)) {
      const outer = a.parentElement?.closest(POST_CONTAINER_SELECTOR);
      if (outer && root.contains(outer)) continue;
      articles.push(a);
    }
  }

  for (const article of articles) {
    // META-8: POST_CONTAINER_SELECTORS includes bare [role="dialog"] and
    // [role="complementary"] with no chat/DM exclusion of its own — a
    // coexisting Messenger/IG chat-overlay dialog satisfies the same
    // selectors as the real comments/post modal. Skip it entirely so this
    // scan never walks (getComputedStyle/SVG-path/aria-label) the DOM of an
    // open private conversation window. UI-only privacy hygiene; does not
    // affect the forensic chain.
    if (isInPrivateChatSubtree(article)) continue;

    containers++;

    // PASS A — interactive elements (buttons, anchors, aria-labeled svgs,
    // toolbars). Score each; flag when ≥2 tiers light up. The
    // [role="toolbar"] addition () catches FB's reaction-
    // emoji wrapper <span role="toolbar" aria-label="Vezi cine a
    // reacţionat la asta">. Tagging the toolbar hides all reaction-emoji
    // children at once — cheaper than enumerating every reaction stem
    // (Uau / Tristeţe / Ador / Furios / Mulţumesc) in STEM_SET.
    const candidates = article.querySelectorAll<HTMLElement>(
      '[role="button"], [role="toolbar"], button, a[href], svg[aria-label]'
    );
    for (const el of candidates) {
      // Already hidden on an earlier pass: it still counts as matched (the
      // selector-family sweep reads `matched`), and is not scored again.
      if (el.dataset.fwEngagementBar === 'true') { matched++; continue; }
      if (el.closest(ESSENTIAL_SKIP_ATTR)) continue;
      const score = scoreElement(el);
      if (score.aria) tierHits.aria++;
      if (score.svg) tierHits.svg++;
      if (score.wrapper) tierHits.wrapper++;
      if (score.structural) tierHits.structural++;
      if (score.count) tierHits.count++;
      if (score.total >= TIER_FUSION_THRESHOLD) {
        matched++;
        if (tagAsEngagement(el)) tagged++;
      }
    }

    // PASS B — bar containers (TIGHTENED , RE-TIGHTENED
    // IG session).
    //
    // Earlier iteration walked every div in the article and tagged any
    // flex-shaped div whose subtree contained a tagged button. That
    // matched the OUTER post-content wrapper (which contains the action
    // section among other sections like image, caption, comments) and
    // hid entire posts on Instagram, reported live as "nothing loads" — that
    // was Pass B over-reaching.
    //
    // The fix: require the candidate to BE flex itself (not just have a
    // flex parent/grandparent), have at most 6 direct children (bar
    // rows are small; post wrappers have many sections), AND contain a
    // tagged button as a DIRECT or grandchild descendant only (not deep
    // descendants — that's how the post wrapper qualified).
    //
    // IG re-tightening: a live IG Reels test (after
    // adding `repost` stem) showed videos appearing for ~2s then
    // disappearing. Cause: cascade between Pass B and the periodic 2s
    // rescan. Pass A tags the Repostează button (direct child of its
    // .xieb3on row wrapper), then Pass B tags the .xieb3on row (1 tagged
    // button as direct child), then on rescan Pass B sees the [per-Reel]
    // wrapper (2 children: video container + rail wrapper) with a tagged
    // .xieb3on row as a GRANDCHILD — qualifies under the old "any tagged
    // descendant" rule — and tags the [per-Reel] wrapper, hiding the
    // <video> element. The tagged-row was acting as an upward-propagation
    // signal it shouldn't have been.
    //
    // Re-tightened: the direct/grandchild hit must be a tagged engagement
    // BUTTON (role="button" / button / a[href] / svg[aria-label] /
    // role="toolbar"), not just any tagged element. Tagged row wrappers
    // (which are tagged divs WITHOUT a button-like role) no longer count
    // as upward-propagation signals. [per-Reel] wrapper's grandchildren
    // are .xieb3on rows (tagged, but plain divs) — no longer match.
    // Tagged buttons live at depth 3+ from [per-Reel] (rail wrapper →
    // row → button), out of Pass B's depth-2 reach. Video preserved.
    const TAGGED_BUTTON_HIT =
      '[data-fw-engagement-bar="true"][role="button"], '
      + '[data-fw-engagement-bar="true"][role="toolbar"], '
      + 'button[data-fw-engagement-bar="true"], '
      + 'a[href][data-fw-engagement-bar="true"], '
      + 'svg[aria-label][data-fw-engagement-bar="true"]';
    // Cheapest test first: almost no div has a tagged button as a child or
    // grandchild, so the child-count and the scoped query prune nearly
    // everything before getComputedStyle runs. The old order read computed
    // style for every div in the container on every pass.
    const divs = article.querySelectorAll<HTMLElement>('div');
    for (const div of divs) {
      if (div.children.length < 2 || div.children.length > 6) continue;
      if (div.dataset.fwEngagementBar === 'true') continue;
      // Tagged engagement BUTTON (not just any tagged div) must be a
      // direct child or grandchild. Restricting to buttons prevents the
      // upward cascade where Pass B's own row-wrapper tags become
      // propagation signals on subsequent rescans (see comment above).
      const directHit = div.querySelector(
        `:scope > :is(${TAGGED_BUTTON_HIT}), `
        + `:scope > * > :is(${TAGGED_BUTTON_HIT})`
      );
      if (!directHit) continue;
      if (div.closest(ESSENTIAL_SKIP_ATTR)) continue;
      if (!metaWrapperMatches(div)) continue;
      const cs = safeComputedStyle(div);
      if (!isFlexLike(cs)) continue;
      if (tagAsEngagement(div)) tagged++;
    }

    // PASS C — count rows. Anchors whose href hints at the metric URL
    // — universal across languages because URL paths don't translate.
    //
    // restricted from "any anchor with comment_id="
    // to "anchors whose visible text looks like a count" because a
    // live test on FB modal showed that EVERY comment-related link
    // (avatar image, author name, reply prompt) carries `comment_id=`
    // in its href for tracking. Tagging all of them would hide author
    // identities. Real count anchors have textContent of either pure
    // digits (with optional K/M/B suffix and commas/dots) or
    // digit+count-noun (e.g. "194 comentarii"). The numeric-only regex
    // here, plus Tier 5's count-text pattern, together catch every count
    // shape we've seen on FB/IG without false-positives on profile
    // links.
    const NUMERIC_ONLY_PATTERN = /^[\d.,KMB\s]+$/i;
    const countAnchors = article.querySelectorAll<HTMLElement>(
      'a[href*="/likers/"], a[href*="/liked_by/"], a[href*="/reactions/"], '
      + 'a[href*="comment_id="], a[href$="/comments/"]'
    );
    for (const a of countAnchors) {
      if (a.closest(ESSENTIAL_SKIP_ATTR)) continue;
      const text = (a.textContent || '').replace(/\s+/g, ' ').trim();
      if (!text) continue;
      if (text.length > 80) continue;
      const looksLikeCount =
        NUMERIC_ONLY_PATTERN.test(text) || COUNT_TEXT_PATTERN.test(text);
      if (!looksLikeCount) continue;
      if (tagAsEngagement(a)) tagged++;
    }

  }

  return { tagged, matched, containers, tierHits };
}

// ─── IntersectionObserver gating ───────────────────────────────────────────
//
// Meta virtualizes off-screen articles — they're rendered as empty
// height-shimmed placeholders until the user scrolls near them. A scan
// that runs at DOMContentLoaded catches placeholders, not real bars.
// IntersectionObserver fires the scan again when an article enters the
// viewport (with 200px lead margin so we tag before the user sees it).

let visibilityObserver: IntersectionObserver | null = null;

function ensureVisibilityObserver(): IntersectionObserver {
  if (!visibilityObserver) {
    visibilityObserver = new IntersectionObserver(
      entries => {
        for (const e of entries) {
          if (e.isIntersecting && e.target instanceof Element) {
            try {
              tagEngagementElements(e.target);
            } catch (err) {
              console.warn('[FW structural-finder] visibility-rescan threw:', err);
            }
          }
        }
      },
      { rootMargin: '200px 0px' }
    );
  }
  return visibilityObserver;
}

function observeArticles(scope: ParentNode): void {
  const io = ensureVisibilityObserver();
  scope.querySelectorAll(POST_CONTAINER_SELECTOR).forEach(a => {
    io.observe(a);
  });
}

// ─── Throttled live scan (public entry) ────────────────────────────────────

export type ScanCallback = (result: TagResult) => void;

/**
 * The container an inserted subtree should be scanned as. A root that is or
 * holds a container is scanned itself (its inner containers are found by
 * tagEngagementElements). A root inside a container (a late-filled action
 * bar) is scanned as that container, unless that container is the page's
 * main region, where the root alone is scanned and the 2 s pass covers the
 * rest: main wraps the whole feed and scanning it is the full pass.
 */
function scanTargetFor(root: Element): Element {
  if (root.matches(POST_CONTAINER_SELECTOR) || root.querySelector(POST_CONTAINER_SELECTOR)) return root;
  const container = root.closest<HTMLElement>(POST_CONTAINER_SELECTOR);
  if (!container || container.matches('[role="main"], main')) return root;
  return container;
}

/**
 * Start the live scan: inserted subtrees at mutation time, a full body pass
 * every 2 s, and an IntersectionObserver re-scan of articles as they scroll
 * into view. Returns a teardown function for the controller's reset path.
 */
export function startStructuralEngagementScan(onScan?: ScanCallback): () => void {
  let teardown = false;

  // Scope is document.body, not the feed: FB and IG append photo and post
  // modals to body outside [role="feed"], and a feed-scoped pass never saw
  // them (owner's live test, FB /photo/?fbid=...).
  const scope: ParentNode = document.body;

  const report = (result: TagResult): void => {
    if (onScan && result.containers > 0) onScan(result);
  };

  const fullScan = (): void => {
    if (teardown) return;
    try {
      report(tagEngagementElements(scope));
    } catch (err) {
      console.warn('[FW structural-finder] scan threw:', err);
    }
  };

  // Inserted subtrees, scanned before the next paint. Each root is scanned
  // as its container; the results of one batch are reported once.
  const stopAdded = observeAddedRoots((roots) => {
    if (teardown) return;
    const total: TagResult = { tagged: 0, matched: 0, containers: 0, tierHits: { aria: 0, svg: 0, wrapper: 0, structural: 0, count: 0 } };
    const scanned = new Set<Element>();
    for (const root of roots) {
      observeArticles(root);
      const target = scanTargetFor(root);
      if (scanned.has(target)) continue;
      scanned.add(target);
      const r = tagEngagementElements(target);
      total.tagged += r.tagged;
      total.matched += r.matched;
      total.containers += r.containers;
      for (const k of Object.keys(total.tierHits) as (keyof TagResult['tierHits'])[]) total.tierHits[k] += r.tierHits[k];
    }
    report(total);
  });

  // Initial scan, deferred so the call site finishes setting up first.
  setTimeout(fullScan, 50);

  // Initial article observation for IntersectionObserver gating.
  observeArticles(scope);

  // Safety net: FB fills action-bar content into an existing placeholder
  // after the article was first seen, without inserting a node the
  // added-roots observer can hand over (owner's live test scored 0 across
  // all tiers with 2 articles in the DOM). Idempotent, and cheap now that
  // tagged candidates are skipped.
  const periodicScanId = window.setInterval(fullScan, 2000);

  return () => {
    teardown = true;
    stopAdded();
    if (visibilityObserver) {
      visibilityObserver.disconnect();
      visibilityObserver = null;
    }
    clearInterval(periodicScanId);
  };
}
