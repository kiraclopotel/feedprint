// The machine-readable mark on page text that an AI model wrote.
//
// The EU AI Act, Article 50(2), asks that text an AI system writes or rewrites
// be marked in a form software can read. The visible marker dot is on in every
// preset, but a household can turn it off, so it cannot be the mark. The mark
// is two attributes on the element that holds the model's text. It is set once
// that text is on the page and removed when anything else is written there, so
// the original words, a placeholder, a notice or a swear mask never carry it.

import type { NeutralizedContent } from '../../types/neutralization';

/** Names the element's text as written by an AI model, and says which kind of text it is. */
export const AI_TEXT_ATTR = 'data-fw-ai-generated';
/** The model that wrote the text, as the call's own reply named it. */
export const AI_MODEL_ATTR = 'data-fw-ai-model';

/** A rewrite of a post or comment, or the answer card of "Read this for me". */
export type AiTextKind = 'rewrite' | 'reading';

/** Who wrote a text: present only when a model did. `model` is absent when no reply named one. */
export interface AiWriter {
  model?: string;
}

export function markAiText(el: Element, kind: AiTextKind, writer: AiWriter): void {
  el.setAttribute(AI_TEXT_ATTR, kind);
  const model = writer.model?.trim();
  if (model) el.setAttribute(AI_MODEL_ATTR, model);
  else el.removeAttribute(AI_MODEL_ATTR);
}

/**
 * Remove a rewrite's mark from `root` and from everything inside it. A reading
 * card is left alone: it is its own element, and closing it removes it whole.
 */
export function clearRewriteMarks(root: Element): void {
  const marked = [root, ...Array.from(root.querySelectorAll(`[${AI_TEXT_ATTR}="rewrite"]`))];
  for (const el of marked) {
    if (el.getAttribute(AI_TEXT_ATTR) !== 'rewrite') continue;
    el.removeAttribute(AI_TEXT_ATTR);
    el.removeAttribute(AI_MODEL_ATTR);
  }
}

/**
 * True when a rewrite puts words on the page that were not there. A rewrite
 * equal to the original, as the reader sees it, is the original, and marking it
 * would name a person's own words as a model's.
 */
export function rewriteChangesText(rewrite: string, original: string): boolean {
  const squash = (s: string): string => s.replace(/\s+/g, ' ').trim();
  const shown = squash(rewrite);
  return shown.length > 0 && shown !== squash(original);
}

/**
 * Who wrote a post's rewrite, or null when the page must not mark it: a swear
 * mask is the fixed filter's stars, and a rewrite equal to the original is the
 * original.
 */
export function writerOfRewrite(
  neutralized: Pick<NeutralizedContent, 'aiSource' | 'rewrittenText' | 'writerModel'>,
  originalText: string,
): AiWriter | null {
  if (neutralized.aiSource === 'rules') return null;
  if (!rewriteChangesText(neutralized.rewrittenText, originalText)) return null;
  return neutralized.writerModel ? { model: neutralized.writerModel } : {};
}
