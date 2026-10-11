// Feedprint, Adult mode: "Read this for me".
//
// A reading aid that answers when asked and is silent otherwise
// (docs/design/ADULT-MODE-2026-09-05.md). The popup arms it (a timestamp in
// chrome.storage.local, no new permission); the visible tab shows the same
// crosshair Off's picker uses; a click on a post or a comment sends that
// item's text, its kind, its platform and, for a comment, the post it replies
// to, through the measured adult judge, unchanged. The five fields come back
// as four flat lines beside the item, plus one line from the record when the
// chain holds the account. The item is not marked, rewritten or hidden; the
// answer card carries the machine-readable AI mark (ai-mark.ts). The
// reading is written to the record as a signed record like any other, under
// its own detectionMode so no rate ever pools it with an automatic verdict.
//
// Only the recorder carries this file: it imports the AI client, which Off's
// bundle gate forbids (scripts/check-off-bundle.mjs).

import type { Platform } from '../../types/post';
import { makesNoOutsideCall } from '../../types/mode';
import type { TextCapture } from '../../types/forensic';
import type { AnalysisResult } from '../../types/analysis';
import type { JudgeV1Verdict } from '../../ai/prompts';
import { callProvenanceFor } from '../../ai/call-provenance';
import { markAiText } from './ai-mark';
import { JUDGE_V1_FAMILY_TECHNIQUE, readWithJudgeV1 } from '../../core/neutralizer';
import { ADULT_READER_FIXED_CONFIDENCE, getEffectiveThreshold } from '../../core/calibration';
import { getSettings, type FWSettings } from '../../storage/settings';
import { getLicense } from '../../storage/license';
import { resolveUiLanguage, type ResolvedUiLanguage } from '../../i18n';
import { MARKER_STRINGS, type MarkerStrings } from '../../i18n/marker-strings';
import { armPick, toast, type Boundary } from '../engagement/picker';
import { TEXT_SCOPE_SELECTORS } from '../engagement/emoji-stripper';
import { CONTAINER_SELECTORS } from '../engagement/word-filter';
import { detectTextFold } from '../record/text-fold';
import { isFacebookCommentArticle } from '../platforms/facebook';
import { isContextAlive, safeSendMessage } from '../../storage/context-guard';
import { sendHighStakesForensicLog } from '../record/forensic-retry';
import { buildConfigSnapshot } from '../record/config-snapshot';
import { currentPageAddress } from '../record/post-url';
import { isInspectionTab } from '../post-path/inspection-mode';
import type { FWMessage, GetAuthorWeekResponse } from '../../types/messages';
import { READ_ARMED_KEY } from '../../storage/read-arm';

/** The record's own label for a reading (`isReadingRecord`, forensics/author-week.ts); never pooled with automatic verdicts. */
export const READ_DETECTION_MODE = 'read-this';
export const READ_ANSWER_ATTR = 'data-fw-read-answer';
const ARM_TTL_MS = 60_000;
const MIN_TEXT_CHARS = 12;
const MAX_TEXT_CHARS = 4000;
const STYLE_ID = 'fw-read-answer-styles';

// Author and channel names sit inside the text scopes; the judge reads the
// item, not its byline.
const NAME_SCOPES = new Set(['[data-testid="User-Name"]']);

// A comment, where the platform marks one. Everything else read is a post.
// Facebook labels a comment article per the user's Facebook language, so it
// goes through the adapter's own stem rule; TikTok's boundary is the box
// around the comment's parts, above the `comment-level-N` paragraph.
const COMMENT_SELECTORS: Partial<Record<Platform, string>> = {
  instagram: 'article ul > li',
  youtube: 'ytd-comment-view-model, ytd-comment-thread-renderer',
};

function isComment(container: Element, platform: Platform): boolean {
  if (platform === 'facebook') {
    return container.matches('div[role="comment"]') || isFacebookCommentArticle(container);
  }
  if (platform === 'tiktok') {
    return !container.matches('[data-e2e="recommend-list-item-container"]')
      && container.querySelector('[data-e2e^="comment-level-"]') !== null;
  }
  const sel = COMMENT_SELECTORS[platform];
  return !!sel && container.matches(sel);
}

// Where the post a comment replies to reads from, for context only. On
// Facebook and Instagram the comment sits inside the post's own container
// and the parent is read there and nowhere else; on TikTok and YouTube the
// comment panel belongs to the page's one open video, so the page is the
// scope.
const PARENT_SELECTORS: Partial<Record<Platform, string>> = {
  facebook: '[data-ad-comet-preview="message"], [data-ad-preview="message"], [data-ad-rendering-role="story_message"]',
  instagram: 'article h1, article [data-testid*="caption"]',
  tiktok: '[data-e2e="browse-video-desc"], [data-e2e="video-desc"]',
  youtube: 'ytd-watch-metadata h1, #title h1, #description-inline-expander',
};
const PARENT_ON_PAGE = new Set<Platform>(['tiktok', 'youtube']);

const LINK_SELECTORS: Record<Platform, string> = {
  twitter: 'a[href*="/status/"]',
  facebook: 'a[href*="/posts/"], a[href*="/permalink/"], a[href*="story_fbid"], a[href*="/videos/"], a[href*="/reel/"]',
  instagram: 'a[href*="/p/"], a[href*="/reel/"]',
  tiktok: 'a[href*="/video/"]',
  youtube: 'a[href*="/watch?v="], a[href*="/shorts/"]',
};

export interface ReadItem {
  text: string;
  kind: 'post' | 'comment';
  parentText?: string;
  author?: string;
  /** The page, for a comment; the item's own link where the page marks one, for a post. */
  postUrl: string;
  /** A comment's own link, where the page marks one. */
  anchorUrl?: string;
  /** What the page carried against what the screen showed (text-fold.ts): the judge reads a fragment on a cut item. */
  textCapture?: TextCapture;
}

function squash(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** The item's own text: the text scopes inside it, bylines left out, nested scopes counted once. */
function scopedText(root: Element, platform: Platform): string {
  const selectors = (TEXT_SCOPE_SELECTORS[platform] ?? []).filter(s => !NAME_SCOPES.has(s));
  const parts: string[] = [];
  const taken: Element[] = [];
  for (const sel of selectors) {
    let found: Element[] = [];
    try { found = Array.from(root.querySelectorAll(sel)); } catch { continue; }
    if (root.matches(sel)) found.unshift(root);
    for (const el of found) {
      if (taken.some(t => t === el || t.contains(el) || el.contains(t))) continue;
      const t = squash(el.textContent ?? '');
      if (!t) continue;
      taken.push(el);
      parts.push(t);
    }
  }
  return parts.join('\n');
}

/**
 * What a picked post or comment holds, or null when there is nothing to
 * read. Only the item's own text scopes count: an item with none (a picture
 * or a video with no caption) is refused rather than read from the box's
 * whole visible text, which would carry the byline, the counts and the
 * page chrome to the judge and into the record.
 */
export function itemFor(b: Boundary, platform: Platform): ReadItem | null {
  if (b.kind !== 'post') return null;
  const container = b.container;
  const own = scopedText(container, platform);
  if (own.length < MIN_TEXT_CHARS) return null;
  const text = own.slice(0, MAX_TEXT_CHARS);
  const comment = isComment(container, platform);
  let parentText: string | undefined;
  if (comment) {
    const parentSel = PARENT_SELECTORS[platform];
    const scope: ParentNode | null = PARENT_ON_PAGE.has(platform)
      ? document
      : (container.parentElement?.closest(CONTAINER_SELECTORS[platform]) ?? null);
    const parentEl = parentSel && scope ? scope.querySelector(parentSel) : null;
    const p = squash(parentEl?.textContent ?? '');
    if (p && p !== text) parentText = p.slice(0, 600);
  }
  let link: string | undefined;
  const a = container.querySelector<HTMLAnchorElement>(LINK_SELECTORS[platform]);
  if (a?.href) {
    try { link = new URL(a.href, location.origin).href; } catch { link = undefined; }
  }
  // The fold is read on the item's box against the untrimmed text, so a cut
  // string's trailing ellipsis is still there to be seen.
  const textCapture = detectTextFold(container, own);
  return comment
    ? { text, kind: 'comment', parentText, author: b.author, postUrl: currentPageAddress(), anchorUrl: link, textCapture }
    : { text, kind: 'post', author: b.author, postUrl: link ?? currentPageAddress(), textCapture };
}

// ─── The answer beside the item ───

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
div[${READ_ANSWER_ATTR}] {
  display: block !important;
  position: relative !important;
  margin: 8px 0 !important;
  padding: 10px 34px 10px 14px !important;
  border-left: 3px solid var(--fw-read-color, #4FB3A9) !important;
  border-radius: 8px !important;
  background: #14181c !important;
  color: #f2f4f5 !important;
  font: 13px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif !important;
  text-align: left !important;
  white-space: normal !important;
  max-width: 100% !important;
  box-sizing: border-box !important;
}
div[${READ_ANSWER_ATTR}] p { margin: 0 0 4px !important; padding: 0 !important; color: inherit !important; font: inherit !important; }
div[${READ_ANSWER_ATTR}] p:last-child { margin-bottom: 0 !important; }
div[${READ_ANSWER_ATTR}] p.fw-read-lead { font-weight: 650 !important; }
div[${READ_ANSWER_ATTR}] p.fw-read-record { color: #b7c0c6 !important; margin-top: 6px !important; }
div[${READ_ANSWER_ATTR}] button.fw-read-close {
  position: absolute !important; top: 6px !important; right: 8px !important;
  width: 22px !important; height: 22px !important; padding: 0 !important;
  border: 0 !important; border-radius: 50% !important; background: transparent !important;
  color: #b7c0c6 !important; font: 16px/22px system-ui, sans-serif !important; cursor: pointer !important;
}
div[${READ_ANSWER_ATTR}] button.fw-read-close:hover { background: rgba(255,255,255,0.1) !important; color: #fff !important; }
`;
  document.head.appendChild(style);
}

function severityColor(severity: number): string {
  if (severity >= 8) return '#E53935';
  if (severity >= 5) return '#E0A458';
  return '#4FB3A9';
}

/** The four lines, from the five fields; one line when nothing is charged. */
export function answerLines(verdict: JudgeV1Verdict, t: MarkerStrings): string[] {
  if (!verdict.charged || verdict.family === 'none') return [t.readNotCharged];
  return [
    t.readVerdict(t.readFamilyName[verdict.family], verdict.severity),
    t.readMechanism[verdict.family],
    `${t.readEffect[verdict.effect]} ${t.readIntent[verdict.intent]}`,
    t.readHonest,
  ];
}

interface AnswerCard {
  el: HTMLDivElement;
  show: (lines: string[], color: string, record?: string) => void;
}

function mountCard(container: Element, platform: Platform, t: MarkerStrings): AnswerCard {
  ensureStyles();
  container.querySelectorAll(`[${READ_ANSWER_ATTR}]`).forEach(old => old.remove());
  const el = document.createElement('div');
  el.setAttribute(READ_ANSWER_ATTR, 'true');
  el.setAttribute('role', 'status');
  // After the item's own text where the page marks it; at the end of the item otherwise.
  const scopes = (TEXT_SCOPE_SELECTORS[platform] ?? []).filter(s => !NAME_SCOPES.has(s));
  let anchor: Element | null = null;
  for (const sel of scopes) {
    try { anchor = container.querySelector(sel); } catch { anchor = null; }
    if (anchor) break;
  }
  if (anchor && anchor !== container) anchor.after(el); else container.appendChild(el);
  const show = (lines: string[], color: string, record?: string): void => {
    el.style.setProperty('--fw-read-color', color);
    el.textContent = '';
    lines.forEach((line, i) => {
      const p = document.createElement('p');
      if (i === 0) p.className = 'fw-read-lead';
      p.textContent = line;
      el.appendChild(p);
    });
    if (record) {
      const p = document.createElement('p');
      p.className = 'fw-read-record';
      p.textContent = record;
      el.appendChild(p);
    }
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'fw-read-close';
    close.setAttribute('aria-label', t.readClose);
    close.textContent = '×';
    close.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); el.remove(); });
    el.appendChild(close);
  };
  return { el, show };
}

// ─── The record ───

async function authorWeek(author: string | undefined, platform: Platform): Promise<{ seen: number; charged: number } | null> {
  if (!author) return null;
  const message: FWMessage = { type: 'GET_AUTHOR_WEEK', payload: { handle: author, platform } };
  const pending = safeSendMessage(message);
  if (!pending) return null;
  try {
    const reply = (await pending) as GetAuthorWeekResponse | undefined;
    return reply && reply.ok ? { seen: reply.seen, charged: reply.charged } : null;
  } catch {
    return null;
  }
}

function analysisFor(verdict: JudgeV1Verdict, processingTimeMs: number): AnalysisResult {
  if (!verdict.charged || verdict.family === 'none') {
    return { postId: '', techniques: [], overallScore: 0, overallConfidence: ADULT_READER_FIXED_CONFIDENCE, isManipulative: false, processingTimeMs };
  }
  const technique = JUDGE_V1_FAMILY_TECHNIQUE[verdict.family];
  return {
    postId: '',
    techniques: [{ technique, present: true, confidence: ADULT_READER_FIXED_CONFIDENCE, severity: verdict.severity, evidence: [] }],
    overallScore: verdict.severity,
    overallConfidence: ADULT_READER_FIXED_CONFIDENCE,
    isManipulative: true,
    processingTimeMs,
    primaryTechnique: technique,
  };
}

/**
 * The record's name for a reading. A pass record's `detectionMode` is
 * `pass:<reason>`, so every reading lands as `pass:read-this:...`; readers of
 * the chain tell a reading from an automatic verdict by that substring
 * (`isReadingRecord`). Charged readings carry the judge's effect and intent
 * here, because a pass record has no reason field; the family and severity
 * ride in the technique.
 */
function readPassReason(verdict: JudgeV1Verdict): string {
  return verdict.charged && verdict.family !== 'none'
    ? `${READ_DETECTION_MODE}:charged:${verdict.effect}:${verdict.intent}`
    : `${READ_DETECTION_MODE}:not-charged`;
}

/**
 * Write the reading down. Always a pass record: nothing on the page was acted
 * on, so the verdict that means "the product acted" would be false, and a
 * reading below the automatic path's fire cut would otherwise enter the
 * chain as a flag the measured rule never fires. What the judge answered
 * rides in the technique, the severity and the pass reason.
 */
async function recordReading(
  item: ReadItem,
  platform: Platform,
  verdict: JudgeV1Verdict,
  settings: FWSettings,
  processingTimeMs: number,
  answered: { model: string; provider: string } | null,
): Promise<void> {
  const analysis = analysisFor(verdict, processingTimeMs);
  const threshold = await getEffectiveThreshold(settings.mode);
  const configSnapshot = buildConfigSnapshot(settings.mode, threshold, settings.dailyCap, settings.features, settings.readFailedFallback);
  await sendHighStakesForensicLog({
    type: 'PASS_LOG',
    payload: {
      originalText: item.text,
      analysis,
      passReason: readPassReason(verdict),
      mode: settings.mode,
      platform,
      aiSource: 'cloud',
      author: item.author ?? '',
      postUrl: item.postUrl,
      anchorUrl: item.anchorUrl,
      feedSource: 'unknown',
      textCapture: item.textCapture,
      // What the server said answered this reading's own call: the proxy can answer another
      // model than the one asked, and names its upstream, which a constant cannot follow.
      aiModel: answered?.model,
      aiProvider: answered?.provider,
      configSnapshot,
      kind: item.kind,
    },
  });
}

// ─── The reading ───

async function read(b: Boundary | null, platform: Platform, t: MarkerStrings): Promise<void> {
  const item = b ? itemFor(b, platform) : null;
  if (!b || b.kind !== 'post' || !item) { toast(t.readRefused); return; }
  const [settings, license] = await Promise.all([getSettings(), getLicense()]);
  if (settings.aiAnalysisEnabled === false || makesNoOutsideCall(settings)) { toast(t.readAiOff); return; }
  if (license.tier === 'free') { toast(t.readNeedsKey); return; }
  const card = mountCard(b.container, platform, t);
  card.show([t.readWaiting], '#4FB3A9');
  const started = performance.now();
  // A signal of the reading's own, so the record names what answered this call and no other.
  const readingCall = new AbortController();
  const [verdict, week] = await Promise.all([
    readWithJudgeV1(item.text, { platform, kind: item.kind, parentText: item.parentText, signal: readingCall.signal }),
    authorWeek(item.author, platform),
  ]);
  if (!verdict) {
    card.el.remove();
    toast(t.readFailed);
    return;
  }
  const record = week && week.seen > 0 ? t.readRecordLine(week.seen, week.charged) : undefined;
  const answered = callProvenanceFor(readingCall.signal);
  card.show(answerLines(verdict, t), verdict.charged ? severityColor(verdict.severity) : '#4FB3A9', record);
  // The card now carries the model's answer, so it carries the AI mark; the
  // waiting line before it did not.
  markAiText(card.el, 'reading', answered ? { model: answered.model } : {});
  void recordReading(item, platform, verdict, settings, performance.now() - started, answered).catch((err) => {
    console.warn('[FeelingWise] Reading not recorded:', err);
  });
}

/** Listen for the popup's arming timestamp; the visible tab, in Adult mode, takes the pick. */
export function startReadThis(platform: Platform, settings: FWSettings): () => void {
  if (isInspectionTab()) return () => {};
  const lang: ResolvedUiLanguage = resolveUiLanguage(settings.uiLanguage);
  const t = MARKER_STRINGS[lang];
  let disarm: (() => void) | null = null;
  const listener = (changes: Record<string, chrome.storage.StorageChange>): void => {
    if (!(READ_ARMED_KEY in changes)) return;
    const at = changes[READ_ARMED_KEY]?.newValue;
    // The key is removed when a pick completes in any window; every other
    // visible window that armed on the same press stands down here.
    if (typeof at !== 'number') { disarm?.(); return; }
    if (Date.now() - at > ARM_TTL_MS || document.visibilityState !== 'visible') return;
    void getSettings().then((fresh) => {
      if (fresh.mode !== 'adult') return;
      disarm?.();
      disarm = armPick(platform, {
        hint: t.readHint,
        onDone: () => {
          disarm = null;
          void chrome.storage.local.remove(READ_ARMED_KEY);
        },
        onPick: (b) => { void read(b, platform, t); },
      });
    });
  };
  // A script whose extension was reloaded under the tab has no storage events left; it goes quiet instead of throwing.
  if (isContextAlive()) chrome.storage.onChanged.addListener(listener);
  return () => { chrome.storage?.onChanged?.removeListener(listener); disarm?.(); };
}
