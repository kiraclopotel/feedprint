// FeelingWise - the "seen a lot" pill.
//
// The exposure notice is a count about a source, not a verdict about a post (13 Oct 2026), so it is not the severity
// dot. It is a quiet pill after the post's text that says the count in a sentence: "This account reached you on 9 days
// this month" or "This same post reached you 5 times". It is not a button, takes no tap and no pointer, and changes
// no text. The look is a first plain one (a hairline in the dashboard's "seen a lot" teal); the Visuals seat restyles
// it by changing the one style block below.

import type { AnalysisResult } from '../../types/analysis';
import type { ResolvedUiLanguage } from '../../i18n';
import { MARKER_STRINGS } from '../../i18n/marker-strings';
import { isInspectionTab } from '../post-path/inspection-mode';

const STYLE_ID = 'fw-seen-pill-styles';
export const SEEN_PILL_CLASS = 'fw-seen-pill';

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
span.${SEEN_PILL_CLASS} {
  display: block !important;
  width: fit-content !important;
  max-width: 100% !important;
  margin: 6px 0 0 0 !important;
  padding: 1px 9px !important;
  border: 1px solid rgba(79, 179, 169, 0.65) !important;
  border-radius: 999px !important;
  background: transparent !important;
  color: inherit !important;
  opacity: 0.85 !important;
  font-size: 12px !important;
  line-height: 18px !important;
  font-weight: 400 !important;
  white-space: normal !important;
  pointer-events: none !important;
  user-select: none !important;
}
  `;
  document.head.appendChild(style);
}

/** The pill's sentence, in the reader's language. Null when the analysis carries no count. */
export function seenALotSentence(analysis: AnalysisResult, lang: ResolvedUiLanguage): string | null {
  const exposure = analysis.exposure;
  if (!exposure || !Number.isFinite(exposure.count) || exposure.count < 1) return null;
  const strings = MARKER_STRINGS[lang];
  return exposure.reason === 'creative' ? strings.seenPostLine(exposure.count) : strings.seenDaysLine(exposure.count);
}

/**
 * Mount the pill after the post's text. Idempotent: a post that already has one keeps it. Returns the pill, or null
 * when it was skipped (an inspection tab, no count on the analysis, already there).
 */
export function renderSeenALotPill(opts: {
  el: HTMLElement;
  analysis: AnalysisResult;
  lang?: ResolvedUiLanguage;
}): HTMLElement | null {
  if (isInspectionTab()) return null;
  const { el, analysis } = opts;
  const sentence = seenALotSentence(analysis, opts.lang ?? 'en');
  if (sentence === null) return null;
  if (el.querySelector(`.${SEEN_PILL_CLASS}`) !== null) return null;
  ensureStyles();
  const pill = document.createElement('span');
  pill.className = SEEN_PILL_CLASS;
  pill.setAttribute('role', 'note');
  pill.setAttribute('data-fw-seen-a-lot', analysis.exposure?.reason ?? 'days');
  pill.textContent = sentence;
  el.appendChild(pill);
  return pill;
}

export function removeAllSeenPills(): void {
  document.querySelectorAll(`.${SEEN_PILL_CLASS}`).forEach((p) => p.remove());
}
