// Builds the comment hide notice for a mode, a language and what the record
// knows (docs/design/HIDE-NOTICE-2026-09-07.md section 2). Child: null, the
// row closes silently (the owner's 2026-06-19 rule). Teen and Adult, each in its own words: the
// sentence with the row's why when one can be named honestly, the plain
// sentence otherwise, and the two reveal labels.

import type { Mode } from '../../types/mode';
import type { ResolvedUiLanguage } from '../../i18n';
import { MARKER_STRINGS } from '../../i18n/marker-strings';
import { whyFor } from '../../core/policy/why';
import { whyFragment } from './hide-why';
import type { CommentHideNotice } from '../protection/comment-overlay';

export interface CommentHideFacts {
  detectionMode?: string;
  techniques: readonly string[];
  severity?: number;
}

export function commentHideNoticeFor(
  mode: Mode,
  lang: ResolvedUiLanguage,
  facts: CommentHideFacts,
): CommentHideNotice | null {
  if (mode === 'child') return null;
  const ms = MARKER_STRINGS[lang];
  const why = whyFor(facts.detectionMode, facts.techniques, facts.severity);
  const line = mode === 'teen' ? ms.hidCommentLineTeen : ms.hidCommentLine;
  const plain = mode === 'teen' ? ms.hidCommentPlainTeen : ms.hidCommentPlain;
  return {
    text: why ? line(whyFragment(lang, why)) : plain,
    showLabel: ms.hideShowAnyway,
    hideLabel: ms.hideHideAgain,
  };
}
