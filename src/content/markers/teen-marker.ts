// FeelingWise — Teen-mode marker (in-place semaphore)
//
// Renders a small severity-colored dot inline with the rewritten or folded
// post text. Tapping the dot swaps the SAME post body in place through its
// states — no frame, no popover, no corner box. The teen sees, in real time,
// what FeelingWise changed and why. Repeated exposure with labels is the
// inoculation paradigm (Roozenbeek et al. 2022, Sci Adv).
//
// Three render shapes, all in place:
//   • rewrite + rewriteText  → 3-state semaphore: GREEN (rewrite) →
//     YELLOW (why) → RED (original), cycling the body text on each tap.
//   • rewrite, no rewrite    → 2-state: original ↔ YELLOW (why).
//   • collapse (folded post)  → 2-state: calm placeholder ↔ YELLOW (why).
//     The raw original is NEVER shown — collapse exists because the content
//     was judged too harmful to re-show; it lives only in the parent's
//     forensic record.
//
// DOM CONTRACT
//   • Marker mounts as a child of the post-text element (or the collapse
//     placeholder element) — flows inline after the visible text.
//   • The dot IS the UI. No element is portal-mounted to document.body; the
//     marker only ever rewrites the text it is mounted beside.
//
// VISUAL LANGUAGE
//   Severity color ramp, no glyphs (deep-research finding: Romanian high-
//   uncertainty-avoidance culture reads ⚠ alarm icons as bureaucratic
//   noise; calm dot + color is the better signal).
//     1-4   → teal      #4FB3A9
//     5-7   → amber     #E0A458
//     8-10  → red       #E53935 (bright red, not muted coral)
//   Bumped from 10px dot in 22×22 to 14px dot in 28×28 click target.
//   Live-test on a real X profile known for heavy flagged content reported
//   "no red dot" despite 23 detected fixes — the prior 10px amber-defaulted marker was too
//   subtle against Twitter's chrome to read as feedback. The bigger dot
//   + brighter red for sev≥8 + a one-shot entry pulse make the protection
//   signal legible without sacrificing WCAG 2.5.5 (still well above 24×24
//   minimum).

import type { AnalysisResult, TechniqueName } from '../../types/analysis';
import { detectInjectedAdvisory } from '../../core/neutralizer';
import { validateRewriteLanguage } from '../../analysis/comment-rewriter';
import { detectLanguage } from '../../core/lang-detect';
import type { ResolvedUiLanguage } from '../../i18n';
import {
  MARKER_STRINGS,
  MARKER_TITLES,
  MARKER_REASONS,
  type MarkerStrings,
} from '../../i18n/marker-strings';
import { isInspectionTab } from '../post-path/inspection-mode';
import { clearRewriteMarks, markAiText, rewriteChangesText, type AiWriter } from './ai-mark';
import { removeAllSeenPills } from './seen-a-lot-pill';
import { askOpenReason } from '../../ai/open-reason';

// ─── Localized strings ──────────────────────────────────────────────────────
//
// All static marker copy (technique titles, fallback reasons, aria labels)
// lives in src/i18n/marker-strings.ts, typed per language. Every entry point
// defaults to 'en' so unthreaded callers behave exactly as before.

function getReasonFor(technique: TechniqueName | undefined, lang: ResolvedUiLanguage): string {
  if (technique) {
    const reason = MARKER_REASONS[lang][technique];
    if (reason) return reason;
  }
  return MARKER_STRINGS[lang].fallbackReason;
}

// Schema-field echo regex. The BATCH classifier returns `reason` as plain
// prose, but the model occasionally echoes the kebab-case technique
// identifier verbatim (e.g. "This is shame-attack with severity 8"). Such
// reasons read like JSON, not explanation, and break parent trust. The
// pattern below catches the kebab-case forms only — single-word entries
// like "bandwagon" or "sexual" are ambiguous with normal English and are
// not included here. Severity-field echoes are caught separately.
const TECHNIQUE_ECHO_RE = /\b(?:fear-appeal|anger-trigger|shame-attack|false-urgency|toxic-positivity|misleading-format|combined-stack|body-comparison-priming|parasocial-coercion|consumer-rapid-frame|hyperreal-trauma-bait|violence-graphic|self-harm|drug-promotion|extreme-toxicity)\b/i;
const SEVERITY_ECHO_RE = /\bsev(?:erity)?[\s_:-]*\d+\b/i;
// The measured reader of Open posts has no prose reason: its line on the record is the instrument's tag
// ("judge-v1: threat, recruit, wants the reader to fear"), kept for the export's "Model's stated reason". It is no
// explanation for a person, so the yellow state shows the same plain template Calm falls back to (the Tester's twenty-first
// read, 12 Oct 2026).
const INTERNAL_TAG_RE = /^\s*judge-v1:/i;

// Guard chain for the LLM-grounded explanation. The BATCH classifier
// surfaces a per-comment `reason` field at `analysis.explanation` (plumbed
// at `src/content/index.ts:1017`); two different comments classified under
// the same technique produce two different reason strings, which fixes the
// "very repetitive very quickly" UX problem with the static template.
//
// The 8-300 char window is the size gate. Beyond that, three silent-
// failure modes produce reasons that pass the length gate but read worse
// than the static template:
//
//   1. Wrong-language drift — LLM emits text in the wrong language.
//      Caught by `validateRewriteLanguage(text, lang)` (matches the resolved UI language).
//   2. Generic-advisory injection — "rely on credible sources", "do your
//      own research", etc. ChatGPT-coach substitute for real reasoning.
//      Caught by `detectInjectedAdvisory` (called with empty original so
//      any advisory phrase is rejected; the parent expects WHY, not advice).
//   3. Hallucinated technique-label / severity echo — LLM returns kebab-
//      case schema fields like "shame-attack" or "severity 8" verbatim.
//      Caught by `TECHNIQUE_ECHO_RE` + `SEVERITY_ECHO_RE`.
//
// `detectMetaTalk` is intentionally NOT in this chain. That validator
// rejects rewrites that drift into meta-narration ("This post says…"); the
// reason field is INHERENTLY meta-commentary about the comment, so meta-
// framing is the natural register for an explanation, not a failure mode.
//
// Any failure → fall back to the static technique template. The rest of
// the marker (title + dot color) stays grounded in the verdict.
export function isUsableReason(reason: string, lang: ResolvedUiLanguage): boolean {
  if (reason.length < 8 || reason.length > 300 || INTERNAL_TAG_RE.test(reason)) return false;
  if (!validateRewriteLanguage(reason, lang)) return false;
  if (detectInjectedAdvisory('', reason) !== null) return false;
  if (TECHNIQUE_ECHO_RE.test(reason) || SEVERITY_ECHO_RE.test(reason)) return false;
  return true;
}

export function pickYellowReason(
  analysis: {
    explanation?: string;
    primaryTechnique?: TechniqueName;
    techniques?: Array<{ technique: TechniqueName; evidence?: string[] }>;
  },
  lang: ResolvedUiLanguage = 'en',
): string {
  const groqReason = analysis.explanation?.trim();
  if (!groqReason || !isUsableReason(groqReason, lang)) {
    return groundedFallbackReason(analysis, lang);
  }
  return groqReason;
}

// Deterministic-floor verdicts (slur / profanity filter, harm-floor) carry
// no LLM explanation by design, so they used to render the identical
// per-technique template on every item — the dominant marker a heavy
// intervention feed shows. Ground the template in THIS item with the match
// COUNT from the stored technique evidence. Count only, never the matched
// words: re-printing a slur inside the explanation would re-deliver the
// harm the filter just removed. Gated to the two floor classes — LLM-path
// evidence arrays can quote the hostile text verbatim and must not leak.
function groundedFallbackReason(
  analysis: {
    primaryTechnique?: TechniqueName;
    techniques?: Array<{ technique: TechniqueName; evidence?: string[] }>;
  },
  lang: ResolvedUiLanguage,
): string {
  const template = getReasonFor(analysis.primaryTechnique, lang);
  const technique = analysis.primaryTechnique;
  if (technique !== 'profanity' && technique !== 'extreme-toxicity') return template;
  const evidence = analysis.techniques?.find(t => t.technique === technique)?.evidence;
  const n = evidence?.length ?? 0;
  if (n === 0) return template;
  const countLine = technique === 'profanity'
    ? MARKER_STRINGS[lang].matchedTermsLine(n)
    : MARKER_STRINGS[lang].harmSignalsLine(n);
  return `${template} ${countLine}`;
}

function getStrings(lang: ResolvedUiLanguage): MarkerStrings {
  return MARKER_STRINGS[lang];
}

/**
 * The language the marker renders in: the reason's, when the detector is
 * decisive about it and the roster carries it (English or Romanian, the two
 * the detector knows); the interface language otherwise. Exported for the lock.
 */
export function markerLanguageFor(explanation: string | undefined, uiLang: ResolvedUiLanguage): ResolvedUiLanguage {
  const text = explanation?.trim();
  if (!text || text.length < 8 || INTERNAL_TAG_RE.test(text)) return uiLang;
  const det = detectLanguage(text);
  if (det.language === 'en' && uiLang !== 'en') return 'en';
  if (det.language === 'ro' && uiLang !== 'ro') return 'ro';
  return uiLang;
}

function getTitleFor(technique: TechniqueName | undefined, lang: ResolvedUiLanguage): string {
  if (!technique) return MARKER_STRINGS[lang].patternDetected;
  return MARKER_TITLES[lang][technique] ?? MARKER_STRINGS[lang].patternDetected;
}

// ─── Severity → color ───────────────────────────────────────────────────────

function severityColor(score: number): string {
  // overallScore is on a 0-10 scale (or 0-1 in some legacy paths — clamp).
  const s = score > 1 ? Math.max(0, Math.min(10, score)) : score * 10;
  if (s < 5) return '#4FB3A9';   // teal
  if (s < 8) return '#E0A458';   // amber
  // Bumped from muted coral #C75B5B to a brighter red #E53935 for sev≥8.
  // The previous coral read as "soft warning" against Twitter's dark chrome;
  // the brighter red registers as "this is the serious one" at a glance.
  return '#E53935';              // red (bright, sev 8-10)
}

// ─── Style injection (idempotent) ───────────────────────────────────────────
//
// Single style block for the marker dot. Re-checked against the live DOM
// on every render (W64): presence of the #fw-teen-marker-styles element is
// the only skip condition, so a replaced <head> heals on the next marker.

// Q68 (W63): identity registry for 'after'-mounted markers. The dot is a
// SIBLING, so descendant queries cannot dedup it, and a platform-inserted
// node between body and dot defeated the old nextElementSibling check.
const markerByElement = new WeakMap<HTMLElement, HTMLButtonElement>();
const STYLE_ID = 'fw-teen-marker-styles';

// Q71 (W64): the DOM is the only authority. The old module-level
// `stylesInjected` latch made removal unrecoverable: any SPA that replaced
// <head> after the first marker left every later marker an invisible
// unstyled button, silently. Same posture as document-start-shield, which
// re-creates its style unconditionally.
function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) {
    return;
  }
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
button.fw-teen-marker {
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  width: 28px !important;
  height: 28px !important;
  margin: 0 0 0 6px !important;
  padding: 0 !important;
  background: transparent !important;
  border: 0 !important;
  cursor: pointer !important;
  vertical-align: middle !important;
  pointer-events: auto !important;
  border-radius: 50% !important;
}
button.fw-teen-marker > span.fw-teen-marker-dot {
  display: block !important;
  width: 14px !important;
  height: 14px !important;
  border-radius: 50% !important;
  background: var(--fw-marker-color, #4FB3A9) !important;
  box-shadow:
    0 0 0 1.5px rgba(0,0,0,0.55),
    0 0 0 2.5px rgba(255,255,255,0.22),
    0 0 8px rgba(229, 57, 53, 0.0) !important;
  transition: transform 0.15s ease, box-shadow 0.2s ease !important;
}
button.fw-teen-marker:hover > span.fw-teen-marker-dot {
  transform: scale(1.18) !important;
}
/* One-shot entry pulse so the marker is visibly NEW when it first lands on
   a post, drawing the parent's eye for ~1.2s before
   settling into the static state. Pulse uses the marker's own color so
   sev-8+ red posts get a red glow, sev-5-7 amber posts get amber, etc.
   Animation is short + non-repeating to avoid sustained motion that would
   irritate on long scroll sessions. Honors prefers-reduced-motion. */
@keyframes fw-teen-marker-entry {
  0%   { transform: scale(0.65); box-shadow: 0 0 0 1.5px rgba(0,0,0,0.55), 0 0 0 2.5px rgba(255,255,255,0.22), 0 0 0 0 var(--fw-marker-color, #4FB3A9); }
  50%  { transform: scale(1.25); box-shadow: 0 0 0 1.5px rgba(0,0,0,0.55), 0 0 0 2.5px rgba(255,255,255,0.22), 0 0 12px 4px var(--fw-marker-color, #4FB3A9); }
  100% { transform: scale(1.0);  box-shadow: 0 0 0 1.5px rgba(0,0,0,0.55), 0 0 0 2.5px rgba(255,255,255,0.22), 0 0 0 0 var(--fw-marker-color, #4FB3A9); }
}
button.fw-teen-marker.fw-marker-entry > span.fw-teen-marker-dot {
  animation: fw-teen-marker-entry 1.2s ease-out !important;
}
button.fw-teen-marker:focus-visible {
  outline: 2px solid #1d9bf0 !important;
  outline-offset: 1px !important;
}
@media (prefers-reduced-motion: reduce) {
  button.fw-teen-marker:hover > span.fw-teen-marker-dot { transform: none !important; }
  button.fw-teen-marker.fw-marker-entry > span.fw-teen-marker-dot { animation: none !important; }
}
  `;
  document.head.appendChild(style);
}

// ─── Marker rendering ───────────────────────────────────────────────────────

export interface RenderMarkerOptions {
  /** Element to mount the marker inside (post-text or placeholder element). */
  el: HTMLElement;
  /** AnalysisResult from the pipeline — used for severity color, technique title, explanation. */
  analysis: AnalysisResult;
  /** Original raw text (for the RED state of the v3 semaphore). May be empty. */
  originalText: string;
  /** 'rewrite' = normal post (rewrite shown); 'collapse' = folded (placeholder shown). */
  kind: 'rewrite' | 'collapse';
  /**
   * Explicit rewrite text for the v3 semaphore's GREEN state. Caller passes
   * the same string they applied to the DOM (post path:
   * `neutralized.rewrittenText`; comment-batch path: the
   * `neutralizeText`-resolved rewrite from the rewrites array). Required
   * for `kind='rewrite'`. Earlier the toggle snapshotted from
   * `holder.textContent` on first click which silently captured the
   * ORIGINAL when the rewrite call was rejected (voice-inverted) or the
   * swap had not yet fired. With the explicit param, an empty
   * `rewriteText` on `kind='rewrite'` causes `renderTeenMarker` to
   * return `null` (no marker rendered) — better than a broken cycle.
   */
  rewriteText?: string;
  /**
   * Where to physically mount the marker DOM node relative to `el`:
   *   • 'inside' (default) — `el.appendChild(marker)`. Used by X / FB / IG /
   *     YT and post-level markers where `el` is a plain text container with
   *     no inner overflow/line-clamp; the marker sits inline at the end of
   *     the text.
   *   • 'after' — insert the marker as the next sibling of `el`
   *     (`el.after(marker)`). Used by TikTok comment markers: TikTok's
   *     comment body span is a styled-components line-clamp box
   *     (`-webkit-line-clamp` + `overflow:hidden`), so a marker appended
   *     INSIDE it is clipped out of view (the "dot in the wall"
   *     mis-position). Mounting as a sibling escapes the clamp while staying
   *     in the same row — the toggle still targets `el` as its text holder,
   *     and the viewport-tracker SHELL_SELECTOR walk still recovers the row
   *     from `el` via closest(). The idempotency guard checks the parent so
   *     a re-render doesn't double-mount.
   */
  mount?: 'inside' | 'after';
  /**
   * Interface language for the marker's static chrome (titles, fallback
   * reasons, aria labels). AI-generated explanation/rewrite text is data and
   * is never translated here. Defaults to 'en' so unthreaded callers behave
   * exactly as before.
   */
  lang?: ResolvedUiLanguage;
  /**
   * Present when a model wrote `rewriteText`. Each tap that puts the rewrite
   * back in the body sets the machine-readable AI mark (ai-mark.ts) on `el`;
   * each tap that shows the original or the reason removes it. Rendering alone
   * never sets it: on the comment path the marker mounts before the swap, over
   * the original.
   */
  aiRewrite?: AiWriter;
  /**
   * Where the walk starts. 'original' is the Open level: the page already shows the author's own words, the dot is red,
   * and a tap goes to the reason (yellow), then the calm version (green), then back to the original. Absent, the walk is
   * the Calm level's and starts on the rewrite the injector already put in the body (green, yellow, red).
   */
  entry?: 'original';
  /**
   * With entry 'original': makes the body one plain text holder before the first tap writes into it (the injector's own
   * text swap, so each platform's rules for its text apply). Returns false when it could not, and the tap then changes
   * nothing. Required for the three-state walk; without it a rewrite-bearing marker falls back to the two-state mark.
   */
  flatten?: () => boolean;
  /**
   * Asked once, when the dot is pressed to the yellow reason, for a sentence about THIS item; the yellow state shows
   * the technique's fixed line until it answers and keeps it on any failure. Absent, the marker builds it for an
   * item the measured reader (Open) charged, from that reader's own labels (src/ai/open-reason.ts); Calm's reason
   * already comes inside the judge's reply, so it asks for nothing.
   */
  askReason?: () => Promise<string | null>;
}

/**
 * Append a tap-able severity marker to the post element. Idempotent: repeated
 * calls on the same element are skipped. Returns the marker button (or null
 * if skipped).
 */
export function renderTeenMarker(opts: RenderMarkerOptions): HTMLButtonElement | null {
  // Inspection pass (dashboard-opened tab): observe only, never mutate.
  if (isInspectionTab()) return null;
  const { el, analysis, originalText, kind } = opts;

  // Whether the rewrite is unavailable — validator rejected it (voice-
  // inversion / register-flatten / meta-talk / advisory / language-drift)
  // OR the upstream call returned empty. Pre-this returned
  // null (no marker), but verification on a real FB Nicușor
  // Dan permalink found: parent could not see WHICH comments FW flagged, only
  // whether the rewrite landed. Now we always render a marker; when no
  // rewrite is available, the marker uses a 2-state toggle (severity
  // color = original visible / YELLOW = explanation) instead of the
  // 3-state semaphore. Forensic chain still has the record either way;
  // the marker is the parent's visible-DOM signal that FW intervened.
  const opensOnTheOriginal = opts.entry === 'original' && typeof opts.flatten === 'function';
  // An item that opens on the original needs the means to write the rewrite in place (flatten); without it the dot can
  // only open the reason, which is the mark-only form.
  const isMarkOnly = kind === 'rewrite'
    && ((opts.rewriteText ?? '').trim().length === 0 || (opts.entry === 'original' && !opensOnTheOriginal));
  const aiRewrite = opts.aiRewrite && rewriteChangesText(opts.rewriteText ?? '', originalText)
    ? opts.aiRewrite
    : undefined;

  const mount = opts.mount ?? 'inside';

  // Idempotency guard — never insert two markers for the same element. The
  // injector guard re-runs replaceText on platform mutations, but the
  // marker is set up once and survives. For 'after' mount the marker is a
  // sibling; Q68 (W63): the old nextElementSibling check broke the moment
  // the platform inserted its own node (translate/pin) between body and
  // dot, double-mounting a second dot with a second closure. The WeakMap
  // identity check (same shape as the hide-notice fix, injector.ts) is the
  // authority; the sibling scan stays as a cross-realm fallback.
  if (el.querySelector('.fw-teen-marker') !== null) return null;
  if (mount === 'after') {
    const prior = markerByElement.get(el);
    if (prior?.isConnected) return null;
    let sib = el.nextElementSibling;
    for (let i = 0; i < 4 && sib; i++, sib = sib.nextElementSibling) {
      if (sib.classList?.contains('fw-teen-marker')) return null;
    }
  }

  ensureStyles();

  // M63: one line, one language. The title and the fallback reason come from
  // the interface language, the AI reason comes in the post's language, and a
  // Romanian interface over an English post read "Vină dată pe un grup:
  // Comment 1 contains a slur". When the reason's language is decisive and is
  // one the roster carries, the whole marker follows the reason.
  const lang: ResolvedUiLanguage = markerLanguageFor(analysis.explanation, opts.lang ?? 'en');
  const color = severityColor(analysis.overallScore);
  const strings = getStrings(lang);
  const title = getTitleFor(analysis.primaryTechnique, lang);
  const explanation = (analysis.explanation && analysis.explanation.trim().length > 0 && !INTERNAL_TAG_RE.test(analysis.explanation))
    ? analysis.explanation.trim()
    : strings.fallbackExplanation;

  const judged = analysis.judge;
  const askReason = opts.askReason ?? (judged?.charged === true && originalText.trim().length > 0
    ? () => askOpenReason({ text: originalText, reading: judged, lang })
    : undefined);

  const marker = document.createElement('button');
  marker.type = 'button';
  // Add `fw-marker-entry` for the one-shot entry pulse. Removed automatically
  // after the animation ends so subsequent renders (idempotency replays)
  // don't re-trigger it.
  marker.className = 'fw-teen-marker fw-marker-entry';
  marker.setAttribute('aria-label', strings.buttonLabel);
  // Q73 (W65): no aria-expanded (the marker discloses no region) and no
  // aria-pressed (a 3-state cycle is not a two-state toggle; 'pressed'
  // collapsed YELLOW and RED into one value). The state-specific
  // aria-label, updated on every click, is the single honest channel.
  marker.setAttribute('data-fw-action', kind);
  // engagement-finder skip guard. The marker is a
  // [role="button"] inside an <article> with an aria-label; without this
  // attribute the structural finder would tag it as engagement and hide
  // FeelingWise's own affordance from the teen.
  marker.setAttribute('data-fw-essential', 'true');
  marker.style.setProperty('--fw-marker-color', color);

  const dot = document.createElement('span');
  dot.className = 'fw-teen-marker-dot';
  marker.appendChild(dot);

  // Marker v3 — branch on `kind`:
  // • 'rewrite' (the 99% case) → 3-state semaphore toggle. Click cycles
  //   body text between rewrite (GREEN), original (RED), and reason
  //   explanation (YELLOW). The dot color tracks "what is currently
  //   visible to the reader" — GREEN=safe rewrite, RED=raw toxic
  //   original, YELLOW=FW's why-explanation. Design rule: no separate frames
  //   or overlay places, the reader changes the comment by pressing the dot
  //   directly. Reason becomes body content (not a sibling
  //   line) so the visual surface is exactly one swappable comment body.
  // • 'collapse' (folded posts) → 2-state in-place toggle. The body shows a
  //   calm placeholder; the dot swaps it in place with FW's one-line reason.
  //   The raw original is never re-shown (collapse exists because the content
  //   was judged too harmful to soften or re-deliver) — it lives only in the
  //   parent's forensic record. No frame, no popover.
  // Pre-(= v2) was 2-state CALM↔EXPANDED with sibling
  // reasoning line. Promoted to 3-state per a direct product spec.
  if (kind === 'rewrite' && originalText.trim().length > 0 && isMarkOnly) {
    // Mark-only path: rewrite was rejected/empty, body keeps the original,
    // 2-state toggle. severity-color (original visible) ↔ YELLOW (explanation).
    attachTwoStateToggle(marker, {
      bodyEl: el,
      baseText: originalText,
      explanation: `${strings.reframePrefix}: ${title} · ${pickYellowReason(analysis, lang)}`,
      explanationFor: (reason) => `${strings.reframePrefix}: ${title} · ${reason}`,
      lang,
      askReason,
      // Base = raw original shown → RED (the semaphore's "original" state),
      // NOT the severity ramp. The amber ramp (#E0A458) is byte-identical to
      // YELLOW_COLOR (#e0a458), so an amber-severity mark-only post toggled
      // yellow↔yellow with no visible change (live report: "two yellows").
      baseColor: RED_COLOR,
      ariaBase: strings.redAriaLabel,
      ariaExplanation: strings.yellowAriaLabel,
    });
  } else if (kind === 'rewrite' && originalText.trim().length > 0) {
    attachStateToggle(marker, {
      bodyEl: el,
      title,
      // Prefer the BATCH classifier's per-comment grounded reason
      // (`analysis.explanation`, plumbed at `src/content/index.ts:1017`)
      // over the static template — the template repeats verbatim across
      // every comment of the same technique, while the LLM reason is
      // grounded in THIS comment's content. `pickYellowReason` falls back
      // to the template when the LLM reason is missing or fails the
      // length guard.
      reason: pickYellowReason(analysis, lang),
      originalText,
      // explicit rewrite text drives the GREEN state. The
      // empty-rewrite refusal above means we never reach this with an
      // unusable rewriteText.
      rewriteText: opts.rewriteText!,
      strings,
      lang,
      askReason,
      aiRewrite,
      ...(opensOnTheOriginal ? { entry: 'original' as const, flatten: opts.flatten, markerInside: mount === 'inside' } : {}),
    });
  } else if (kind === 'collapse') {
    // Folded post: the body already holds the calm placeholder (set by the
    // injector's applyActionPlaceholder). 2-state in-place toggle swaps it
    // with the why-folded reason (collapse is not a rewrite),
    // no original reveal. Severity color (placeholder) ↔ YELLOW (reason).
    const calmText = findTextHolder(el, marker)?.textContent?.trim() || explanation;
    attachTwoStateToggle(marker, {
      bodyEl: el,
      baseText: calmText,
      explanation: `${title} · ${pickYellowReason(analysis, lang)}`,
      // Base = calm folded placeholder (nothing harmful shown) → teal, the
      // "safe/folded" end of the ramp. Using the severity ramp here collided
      // with YELLOW_COLOR for amber-severity folds (live report: "two yellows"); teal
      // is unambiguously distinct from the YELLOW explanation state.
      baseColor: FOLDED_COLOR,
      ariaBase: strings.collapseCalmAria,
      ariaExplanation: strings.collapseWhyAria,
    });
  } else {
    // kind='rewrite' with empty originalText (rare: rewrite shown but no
    // original captured). Body keeps the rewrite; 2-state in-place toggle:
    // GREEN (rewrite) ↔ YELLOW (explanation). No box.
    const baseText = findTextHolder(el, marker)?.textContent?.trim() || (opts.rewriteText ?? '').trim();
    // Q74 (W63): with no base content at all there is nothing to toggle
    // back to; the old fall-through mounted a GREEN dot announcing "safe
    // rewrite shown" over nothing, and toggling back blanked the body.
    if (baseText.length === 0) return null;
    // A rewrite-less marker here means mark-only semantics: the body holds
    // untouched platform content, not FW's rewrite. GREEN would claim a
    // rewrite is shown; use the mark-only posture instead.
    const hasRewrite = (opts.rewriteText ?? '').trim().length > 0;
    attachTwoStateToggle(marker, {
      bodyEl: el,
      baseText,
      explanation: `${strings.reframePrefix}: ${title} · ${pickYellowReason(analysis, lang)}`,
      baseColor: hasRewrite ? GREEN_COLOR : RED_COLOR,
      ariaBase: hasRewrite ? strings.greenAriaLabel : strings.redAriaLabel,
      ariaExplanation: strings.yellowAriaLabel,
      aiBase: hasRewrite ? aiRewrite : undefined,
    });
  }

  if (mount === 'after') {
    el.after(marker);
    markerByElement.set(el, marker); // Q68: identity dedup for sibling mounts
  } else {
    el.appendChild(marker);
  }
  // Strip the entry-pulse class after one cycle so the animation doesn't
  // replay if the post element is re-rendered by the platform (Twitter
  // does this on hover / focus state changes). Use a single rAF +
  // setTimeout to clear after the 1.2s animation ends. Skipped on
  // prefers-reduced-motion (animation is no-op anyway).
  setTimeout(() => marker.classList.remove('fw-marker-entry'), 1300);
  return marker;
}

// ─── Marker v3 — 3-state semaphore toggle (rewrite path) ────────────
//
// Standing product decision: the dot IS the UI; cycle the SAME comment
// body through three contents on each click. No frames, no popovers, no
// sibling lines — a single swappable text holder, three states, three
// colors that track "what's currently shown to the reader":
//
//   GREEN  — safe rewrite (default state on render)
//   RED    — raw original, toxic
//   YELLOW — FW's why-explanation (technique title + locale-correct reason)
//
// Click cycles GREEN → RED → YELLOW → GREEN. State stamped on body element
// via `dataset.fwMarkerState ∈ {'green','red','yellow'}`. Severity color
// is REPLACED by state color on the rewrite path; `kind='collapse'`
// uses the severity ramp as the base color of its 2-state in-place toggle.
//
// Pre-was 2-state (calm/expanded) with a sibling reasoning line.
// Promoted to 3-state per the standing rule: change the comment itself
// when the button is pressed, never create separate frames or places.

const GREEN_COLOR  = '#4caf50';   // GREEN — rewrite (safe) shown
const RED_COLOR    = '#e53935';   // RED   — raw original shown
const YELLOW_COLOR = '#e0a458';   // YELLOW — explanation shown
const FOLDED_COLOR = '#4fb3a9';   // TEAL  — folded-away placeholder (collapse base)

// Q66 (W62): 'base' is the two-state toggle's resting state (calm
// placeholder / mark-only original / rewrite-without-original). It is a
// DISTINCT value from 'red' so the injector guard can tell "FW-chosen
// content visible, defend it against platform re-renders" (green/base)
// apart from "the user pressed for the explanation or the original, do
// not fight them" (yellow/red). Stamping 'red' at render time disarmed
// the guard for every folded post.
type MarkerState = 'green' | 'yellow' | 'red' | 'base';
// Correction found live on cycle order: yellow second, red
// last. Pedagogical rationale per `docs/archive/raport-cercetare-aprofundată.md`
// inoculation-paradigm research: child sees rewrite (GREEN safe) → tap to see
// FW's why-explanation (YELLOW info) → tap again to see the raw original
// (RED, only after the explanation primed them). The reasoning-first cycle
// preserves "non-accusatory educational" framing instead of jumping straight
// to the toxic original.
const NEXT_STATE: Record<'green' | 'yellow' | 'red', MarkerState> = {
  green: 'yellow',
  yellow: 'red',
  red: 'green',
};
// The Open level's walk (12 Oct 2026): it starts on the original, so the reason comes first, then the calm version.
const NEXT_STATE_OPEN: Record<'green' | 'yellow' | 'red', MarkerState> = {
  red: 'yellow',
  yellow: 'green',
  green: 'red',
};

interface StateToggleContext {
  bodyEl: HTMLElement;
  title: string;          // plain-language technique name (locale-aware)
  reason: string;         // one-line reason from REASON_RO/EN template (locale-correct)
  originalText: string;
  rewriteText: string;    // explicit rewrite text drives GREEN state
  strings: MarkerStrings;
  lang: ResolvedUiLanguage;
  /** See RenderMarkerOptions.askReason. */
  askReason?: () => Promise<string | null>;
  /** Present when a model wrote `rewriteText`: GREEN carries the AI mark, RED and YELLOW do not. */
  aiRewrite?: AiWriter;
  /** The Open level: the body holds the author's words untouched, the walk starts on RED and goes red, yellow, green. */
  entry?: 'original';
  /** Turns the body into one text holder before the first tap writes into it (see RenderMarkerOptions.flatten). */
  flatten?: () => boolean;
  /** The marker is a child of `bodyEl`, so a body rewrite that clears the children must put it back. */
  markerInside?: boolean;
}

/**
 * Find the visible-text holder inside bodyEl. Walks direct children,
 * skips the marker. Returns the first text-bearing node to swap on toggle.
 */
function findTextHolder(bodyEl: HTMLElement, marker: HTMLButtonElement): Node | null {
  for (const child of Array.from(bodyEl.childNodes)) {
    if (child === marker) continue;
    if (child.nodeType === Node.TEXT_NODE) {
      const t = child.textContent?.trim() ?? '';
      if (t.length > 0) return child;
    }
    if (child instanceof HTMLElement) {
      if (child.classList?.contains('fw-teen-marker')) continue;
      const t = child.textContent?.trim() ?? '';
      if (t.length > 0) return child;
    }
  }
  return null;
}

/**
 * The colour the platform painted this text in, read from the deepest
 * text-bearing descendant BEFORE a swap destroys it.
 *
 * `holder.textContent = ...` replaces every descendant of the holder with a
 * single text node. Facebook sets the readable colour on an inner span, not on
 * the element `findTextHolder` returns, so the replacement text falls back to
 * the holder's own colour: on the dark theme that is near-black text on a
 * near-black card, and the post reads as blank until you select it. Owner saw
 * it on the live Page, 2026-09-04, on a repeat-exposure mark.
 *
 * Reading the computed colour and pinning it back keeps the swapped text
 * exactly as legible as the text it replaced, without hardcoding a palette or
 * having to know which theme the platform is in.
 *
 * A text-node holder needs none of this: it never had descendants, so it keeps
 * inheriting from the same parent it always did.
 */
function captureTextColor(holder: Node): string | null {
  if (!(holder instanceof HTMLElement)) return null;
  let deepest: HTMLElement = holder;
  for (let depth = 0; depth < 12; depth++) {
    const next = Array.from(deepest.children).find(
      (c): c is HTMLElement => c instanceof HTMLElement && (c.textContent?.trim().length ?? 0) > 0,
    );
    if (!next) break;
    deepest = next;
  }
  try {
    const color = getComputedStyle(deepest).color;
    // Fully transparent is what a platform uses for text it is hiding on
    // purpose; copying it would reproduce the bug rather than fix it.
    return color && color !== 'rgba(0, 0, 0, 0)' ? color : null;
  } catch {
    return null;
  }
}

/** Swap a holder's text and keep it as readable as what it replaced. */
function writeHolderText(holder: Node, text: string, color: string | null): void {
  holder.textContent = text;
  if (color !== null && holder instanceof HTMLElement) {
    holder.style.setProperty('color', color, 'important');
  }
}

function colorForState(state: MarkerState): string {
  return state === 'green' ? GREEN_COLOR
       : state === 'red'   ? RED_COLOR
       : YELLOW_COLOR;
}

function ariaLabelForState(state: MarkerState, strings: MarkerStrings): string {
  return state === 'green' ? strings.greenAriaLabel
       : state === 'red'   ? strings.redAriaLabel
       : strings.yellowAriaLabel;
}

/**
 * The body content shown in YELLOW state — FW's "why I intervened" line.
 * Format: "<prefix>: <technique title> — <reason>". Locale-correct via
 * REASON_RO/EN templates regardless of what Groq returned in `analysis.
 * explanation`. Same content shape as the pre-sibling reasoning
 * line; promoted from sibling-line to body-content per product spec.
 */
function reasonBodyText(ctx: StateToggleContext): string {
  return `${ctx.strings.reframePrefix}: ${ctx.title} · ${ctx.reason}`;
}

/**
 * 2-state in-place toggle. Body shows `baseText`; a click swaps it to the
 * YELLOW `explanation`, another click swaps back. No GREEN state — there's
 * nothing to "restore to". Used by three paths:
 *   • mark-only  — base = original (rewrite rejected/empty)
 *   • collapse   — base = calm placeholder (folded post; original never shown)
 *   • rewrite w/o original — base = the rewrite already in the body
 * Marker color tracks the visible content: `baseColor` for base / YELLOW for
 * the explanation. The base state is stamped 'red' on the body dataset (RED
 * in the 3-state cycle is the same "non-explanation content visible"
 * semantic); the dot color comes from `baseColor`, not RED_COLOR.
 */
interface TwoStateToggleContext {
  bodyEl: HTMLElement;
  baseText: string;
  explanation: string;
  /** With `askReason`: the explanation line for a reason that arrived later. */
  explanationFor?: (reason: string) => string;
  lang?: ResolvedUiLanguage;
  askReason?: () => Promise<string | null>;
  baseColor: string;
  ariaBase: string;
  ariaExplanation: string;
  /** Present when `baseText` is a model's rewrite: the base state carries the AI mark, the reason does not. */
  aiBase?: AiWriter;
}

/** The element shows a model's rewrite exactly when `writer` is given. */
function syncRewriteMark(bodyEl: HTMLElement, writer: AiWriter | undefined): void {
  if (writer) markAiText(bodyEl, 'rewrite', writer);
  else clearRewriteMarks(bodyEl);
}

/**
 * The yellow state asks for a better reason once, the first time it is shown. The fixed line is on the page meanwhile;
 * an answer that fails the marker's own checks, or no answer, leaves it. `apply` swaps the new text in when the
 * answer lands while the reason is still what the person is looking at.
 */
function reasonAsker(
  ask: (() => Promise<string | null>) | undefined,
  lang: ResolvedUiLanguage,
  apply: (reason: string) => void,
): () => void {
  let asked = false;
  return () => {
    if (!ask || asked) return;
    asked = true;
    void ask()
      .then((reason) => { if (reason && isUsableReason(reason, lang)) apply(reason); })
      .catch(() => { /* the fixed line stays */ });
  };
}

function attachTwoStateToggle(marker: HTMLButtonElement, ctx: TwoStateToggleContext): void {
  const { bodyEl } = ctx;
  // Q66 (W62): the resting state is 'base', never 'red'. Render-time 'red'
  // told the injector guard "the user pressed show-original" before anyone
  // touched anything, permanently disarming the guard on every folded
  // post: one platform re-render restored the original graphic content.
  bodyEl.dataset.fwMarkerState = 'base';
  marker.style.setProperty('--fw-marker-color', ctx.baseColor);
  marker.setAttribute('aria-label', ctx.ariaBase);

  // Captured on the first click, while the platform's own nodes are still
  // there to read it from, and reused for every swap after.
  let textColor: string | null = null;
  let colorCaptured = false;
  const askForReason = reasonAsker(ctx.askReason, ctx.lang ?? 'en', (reason) => {
    if (ctx.explanationFor) ctx.explanation = ctx.explanationFor(reason);
    if (bodyEl.dataset.fwMarkerState !== 'yellow' || !bodyEl.isConnected) return;
    const holder = findTextHolder(bodyEl, marker);
    if (holder) writeHolderText(holder, ctx.explanation, textColor);
  });

  marker.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();

    const current = (bodyEl.dataset.fwMarkerState as MarkerState | undefined) ?? 'base';
    const next: MarkerState = current === 'yellow' ? 'base' : 'yellow';
    const holder = findTextHolder(bodyEl, marker);

    if (holder) {
      if (!colorCaptured) { textColor = captureTextColor(holder); colorCaptured = true; }
      writeHolderText(holder, next === 'yellow' ? ctx.explanation : ctx.baseText, textColor);
    }
    syncRewriteMark(bodyEl, next === 'yellow' ? undefined : ctx.aiBase);

    marker.style.setProperty('--fw-marker-color', next === 'yellow' ? YELLOW_COLOR : ctx.baseColor);
    marker.setAttribute('aria-label', next === 'yellow' ? ctx.ariaExplanation : ctx.ariaBase);
    bodyEl.dataset.fwMarkerState = next;
    if (next === 'yellow') askForReason();
  });
}

/**
 * Q72 (W64): remove every mounted marker dot. Called when the parent flips
 * show-reframe-markers off so existing dots stop contradicting the
 * setting. Rewrites and their guards stay: the marker is UI, the rewrite
 * is protection.
 */
export function hasTeenMarker(el: HTMLElement): boolean {
  if (el.querySelector('.fw-teen-marker') !== null) return true;
  const prior = markerByElement.get(el);
  return prior?.isConnected === true;
}

export function removeAllTeenMarkers(): void {
  document.querySelectorAll('.fw-teen-marker').forEach((m) => m.remove());
  removeAllSeenPills();
}

/**
 * Q67 (W62): cache-replay resync. `injectTeen` replaces the body text with
 * the rewrite unconditionally, but `renderTeenMarker` early-returns when a
 * marker already exists, so a marker toggled to RED/YELLOW before a replay
 * kept asserting "original shown" over a body now holding the rewrite. Call
 * after a replay's text swap to re-align state, dot, and aria with the
 * content actually visible. No-op when no marker exists or the state
 * already matches.
 */
export function resyncMarkerToGreen(el: HTMLElement, lang: ResolvedUiLanguage = 'en'): void {
  const state = el.dataset.fwMarkerState as MarkerState | undefined;
  if (state !== 'red' && state !== 'yellow') return;
  const marker = el.querySelector<HTMLButtonElement>('.fw-teen-marker')
    ?? (el.nextElementSibling?.classList?.contains('fw-teen-marker')
      ? (el.nextElementSibling as HTMLButtonElement)
      : null);
  if (!marker) return;
  const strings = getStrings(lang);
  el.dataset.fwMarkerState = 'green';
  marker.style.setProperty('--fw-marker-color', GREEN_COLOR);
  marker.setAttribute('aria-label', strings.greenAriaLabel);
}

/**
 * Wire the marker dot as a 3-state semaphore for rewrite-path posts/comments.
 * Initial state = GREEN (rewrite shown). Each click cycles to next state and
 * swaps the body's text holder content + the dot color.
 */

function attachStateToggle(marker: HTMLButtonElement, ctx: StateToggleContext): void {
  const { bodyEl, strings } = ctx;
  // See captureTextColor: read the platform's colour before the first swap
  // destroys the node carrying it.
  let textColor: string | null = null;
  let colorCaptured = false;
  // The Open level starts on the original, untouched, and walks red, yellow, green; the Calm level starts on the rewrite
  // the injector already wrote and walks green, yellow, red.
  const open = ctx.entry === 'original';
  const start: 'green' | 'red' = open ? 'red' : 'green';
  const walk = open ? NEXT_STATE_OPEN : NEXT_STATE;
  let flattened = !open;
  const askForReason = reasonAsker(ctx.askReason, ctx.lang, (reason) => {
    ctx.reason = reason;
    if (bodyEl.dataset.fwMarkerState !== 'yellow' || !bodyEl.isConnected) return;
    const holder = findTextHolder(bodyEl, marker);
    if (holder) writeHolderText(holder, reasonBodyText(ctx), textColor);
  });
  bodyEl.dataset.fwMarkerState = start;
  marker.style.setProperty('--fw-marker-color', colorForState(start));
  marker.setAttribute('aria-label', ariaLabelForState(start, strings));

  marker.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();

    const current = (bodyEl.dataset.fwMarkerState as MarkerState | undefined) ?? start;
    const next = walk[current as 'green' | 'yellow' | 'red'] ?? start;

    if (!flattened) {
      // The first tap on an Open item: the platform's own nodes are still there, so the colour is read from them, then
      // the body becomes one plain text holder by the injector's own swap. If that cannot be done nothing changes.
      const first = findTextHolder(bodyEl, marker);
      if (first && !colorCaptured) { textColor = captureTextColor(first); colorCaptured = true; }
      let ok = false;
      try { ok = ctx.flatten ? ctx.flatten() : false; } catch { ok = false; }
      if (!ok) return;
      flattened = true;
      // From here on the body holds text FeelingWise wrote or restored; the page scanner must not read it as a new post.
      bodyEl.setAttribute('data-fw-neutralized', 'true');
      if (ctx.markerInside && marker.parentElement !== bodyEl) bodyEl.appendChild(marker);
    }

    const holder = findTextHolder(bodyEl, marker);

    if (holder) {
      // explicit rewrite text from the closure (no DOM snapshot).
      // Pre-the toggle snapshotted from `holder.textContent` on
      // first click which captured the ORIGINAL when the rewrite swap had
      // failed (LLM rejection / network error). With the closure-bound
      // `ctx.rewriteText`, GREEN restores the verified rewrite verbatim.
      const newText = next === 'green'  ? ctx.rewriteText
                    : next === 'red'    ? ctx.originalText
                    /* yellow */        : reasonBodyText(ctx);
      if (!colorCaptured) { textColor = captureTextColor(holder); colorCaptured = true; }
      writeHolderText(holder, newText, textColor);
    }
    syncRewriteMark(bodyEl, next === 'green' ? ctx.aiRewrite : undefined);

    marker.style.setProperty('--fw-marker-color', colorForState(next));
    marker.setAttribute('aria-label', ariaLabelForState(next, strings));
    bodyEl.dataset.fwMarkerState = next;
    if (next === 'yellow') askForReason();
  });
}

