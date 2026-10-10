// @vitest-environment jsdom
//
// §CT-36 (2026-05-05) — Marker v3 semaphore tests. Replaces §CT-33 v2
// 2-state CALM↔EXPANDED. Per the 2026-05-05 ruling: 3-state cycle
// GREEN → RED → YELLOW → GREEN. The dot color tracks "what is currently
// shown to the reader": GREEN=safe rewrite, RED=raw original toxic,
// YELLOW=FW's explanation. Body content swaps on each click (same text
// holder, three contents). No popover, no sibling reasoning line, no
// close-X. `kind='collapse'` is also in place now: a 2-state toggle swaps
// the calm placeholder ↔ FW's why-reason; the raw original is never shown.

import { describe, it, expect, beforeEach } from 'vitest';
import { renderTeenMarker, pickYellowReason, markerLanguageFor } from '../../../../src/content/markers/teen-marker';
import type { AnalysisResult } from '../../../../src/types/analysis';

function makeAnalysis(overrides: Partial<AnalysisResult> = {}): AnalysisResult {
  return {
    postId: 'p1',
    techniques: [],
    overallScore: 7,
    overallConfidence: 0.7,
    isManipulative: true,
    processingTimeMs: 0,
    primaryTechnique: 'shame-attack',
    explanation: 'commenter personally insults a private target',
    ...overrides,
  };
}

function makeBodyEl(rewriteText: string): HTMLElement {
  const wrap = document.createElement('div');
  const body = document.createElement('div');
  body.textContent = rewriteText;
  wrap.appendChild(body);
  document.body.appendChild(wrap);
  return body;
}

function findHolder(body: HTMLElement): Node | undefined {
  return Array.from(body.childNodes).find(
    n => n.nodeType === Node.TEXT_NODE
      || (n instanceof HTMLElement && !n.classList?.contains('fw-teen-marker')),
  );
}

const GREEN  = '#4caf50';
const RED    = '#e53935';
const YELLOW = '#e0a458';

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('§CT-36 Marker v3 — 3-state semaphore (kind=rewrite)', () => {
  it('initial state is GREEN with green dot regardless of severity', () => {
    const body = makeBodyEl('rewritten safe text');
    const marker = renderTeenMarker({
      el: body,
      analysis: makeAnalysis({ overallScore: 9 }), // would have been red severity-color
      originalText: 'original toxic text',
      kind: 'rewrite',
      rewriteText: 'rewritten safe text',
    });
    expect(marker).not.toBeNull();
    expect(body.dataset.fwMarkerState).toBe('green');
    // W65: no aria-pressed on the 3-state cycle; aria-label is the channel.
    expect(marker!.getAttribute('aria-pressed')).toBeNull();
    expect(marker!.style.getPropertyValue('--fw-marker-color')).toBe(GREEN);
  });

  it('first click cycles GREEN → YELLOW — swaps to reason explanation, dot turns yellow', () => {
    const body = makeBodyEl('rewritten safe text');
    const marker = renderTeenMarker({
      el: body,
      analysis: makeAnalysis({ primaryTechnique: 'shame-attack' }),
      originalText: 'original toxic text',
      kind: 'rewrite',
      rewriteText: 'rewritten safe text',
    });

    marker!.click();

    expect(body.dataset.fwMarkerState).toBe('yellow');
    expect(marker!.style.getPropertyValue('--fw-marker-color')).toBe(YELLOW);
    expect(marker!.getAttribute('aria-pressed')).toBeNull();
    // Reason text is "<prefix>: <title> — <reason>". The reason now prefers
    // the per-comment grounded `analysis.explanation` (BATCH classifier
    // verdict.reason) over the static technique template; `makeAnalysis`
    // provides a non-empty explanation that passes the length guard, so
    // the YELLOW body should surface the per-record string verbatim.
    expect(findHolder(body)?.textContent).toBe(
      'FeelingWise Feedback: Shame attack · commenter personally insults a private target',
    );
    // No sibling reasoning line in v3 — reason now lives in YELLOW body state.
    expect(body.nextElementSibling?.classList?.contains('fw-reasoning-line')).toBeFalsy();
  });

  it('second click cycles YELLOW → RED — swaps to original, dot turns red', () => {
    const body = makeBodyEl('rewritten safe text');
    const marker = renderTeenMarker({
      el: body,
      analysis: makeAnalysis({ primaryTechnique: 'shame-attack' }),
      originalText: 'original toxic text',
      kind: 'rewrite',
      rewriteText: 'rewritten safe text',
    });

    marker!.click(); // GREEN → YELLOW
    marker!.click(); // YELLOW → RED

    expect(body.dataset.fwMarkerState).toBe('red');
    expect(marker!.style.getPropertyValue('--fw-marker-color')).toBe(RED);
    expect(marker!.getAttribute('aria-pressed')).toBeNull();
    expect(findHolder(body)?.textContent).toBe('original toxic text');
  });

  it('third click cycles RED → GREEN — restores rewrite, dot turns green', () => {
    const body = makeBodyEl('rewritten safe text');
    const marker = renderTeenMarker({
      el: body,
      analysis: makeAnalysis(),
      originalText: 'original toxic text',
      kind: 'rewrite',
      rewriteText: 'rewritten safe text',
    });

    marker!.click(); // GREEN → YELLOW
    marker!.click(); // YELLOW → RED
    marker!.click(); // RED → GREEN

    expect(body.dataset.fwMarkerState).toBe('green');
    expect(marker!.style.getPropertyValue('--fw-marker-color')).toBe(GREEN);
    expect(marker!.getAttribute('aria-pressed')).toBeNull();
    expect(findHolder(body)?.textContent).toBe('rewritten safe text');
  });

  it('snapshot rewrite once — full cycle preserves the rewrite text exactly', () => {
    const body = makeBodyEl('rewritten safe text');
    const marker = renderTeenMarker({
      el: body,
      analysis: makeAnalysis(),
      originalText: 'original toxic text',
      kind: 'rewrite',
      rewriteText: 'rewritten safe text',
    });

    marker!.click(); marker!.click(); marker!.click(); // full cycle back to GREEN
    expect(findHolder(body)?.textContent).toBe('rewritten safe text');

    marker!.click(); marker!.click(); marker!.click(); // second full cycle
    expect(findHolder(body)?.textContent).toBe('rewritten safe text');
  });

  it('marker on kind=rewrite WITHOUT originalText uses in-place 2-state toggle (rewrite ↔ why)', () => {
    const body = makeBodyEl('rewritten safe text');
    const marker = renderTeenMarker({
      el: body,
      analysis: makeAnalysis(),
      originalText: '', // empty — no RED original to cycle to
      kind: 'rewrite',
      rewriteText: 'rewritten safe text',
    });

    expect(marker).not.toBeNull();
    // 2-state in-place toggle: resting state stamped 'base' (W62: distinct
    // from user-pressed RED so the injector guard stays armed), dot GREEN.
    expect(body.dataset.fwMarkerState).toBe('base');
    expect(marker!.style.getPropertyValue('--fw-marker-color')).toBe(GREEN);
    // No popover is ever portal-mounted to document.body.
    expect(document.querySelector('.fw-teen-popover')).toBeNull();

    // Tap → YELLOW why-line in place; tap again → back to the rewrite.
    marker!.click();
    expect(body.dataset.fwMarkerState).toBe('yellow');
    expect(findHolder(body)?.textContent).toContain('FeelingWise Feedback');
    marker!.click();
    expect(findHolder(body)?.textContent).toBe('rewritten safe text');
  });

  it('mark-only — kind=rewrite WITHOUT rewriteText still renders marker (parent-visibility, ruled 2026-05-06)', () => {
    // When neutralizeText was rejected (voice-inversion / register-flatten
    // / meta-talk / advisory / language-drift / empty-output) the rewrite
    // is empty. Pre-2026-05-06 we returned null here. A live FB verification
    // on a live Facebook post showed the parent must still see WHICH comments
    // FW flagged — silent-no-marker breaks the explainability contract.
    // Mark-only mode: marker rendered, body keeps original, 2-state
    // toggle (severity color = original / YELLOW = explanation).
    const body = makeBodyEl('original text never rewritten');
    const marker = renderTeenMarker({
      el: body,
      analysis: makeAnalysis(),
      originalText: 'original text never rewritten',
      kind: 'rewrite',
      // rewriteText omitted
    });
    expect(marker).not.toBeNull();
    expect(body.querySelector('.fw-teen-marker')).not.toBeNull();
    // Resting state is 'base' (original visible; W62: distinct from
    // user-pressed RED); dot color is RED_COLOR, not the GREEN of the
    // rewrite cycle.
    expect(body.dataset.fwMarkerState).toBe('base');
  });

  it('mark-only — kind=rewrite with whitespace-only rewriteText also renders mark-only marker', () => {
    const body = makeBodyEl('original text');
    const marker = renderTeenMarker({
      el: body,
      analysis: makeAnalysis(),
      originalText: 'original text',
      kind: 'rewrite',
      rewriteText: '   ', // whitespace-only — same as missing
    });
    expect(marker).not.toBeNull();
    expect(body.dataset.fwMarkerState).toBe('base');
  });

  it('marker on kind=collapse uses in-place 2-state toggle — calm line ↔ why, original never shown', () => {
    const body = makeBodyEl('— FeelingWise folded this post —');
    const marker = renderTeenMarker({
      el: body,
      analysis: makeAnalysis(),
      originalText: 'original toxic text',
      kind: 'collapse',
    });

    expect(marker).not.toBeNull();
    // Resting state stamped 'base' (calm placeholder visible; W62: the old
    // 'red' stamp disarmed the injector's rewrite guard), no popover.
    expect(body.dataset.fwMarkerState).toBe('base');
    expect(document.querySelector('.fw-teen-popover')).toBeNull();

    // Tap → YELLOW why-line in place; tap again → back to the calm placeholder.
    // The raw original must NEVER surface in the child's DOM.
    marker!.click();
    expect(body.dataset.fwMarkerState).toBe('yellow');
    expect(findHolder(body)?.textContent).not.toContain('original toxic text');
    expect(findHolder(body)?.textContent).toContain('·');
    marker!.click();
    expect(findHolder(body)?.textContent).toBe('— FeelingWise folded this post —');
    expect(findHolder(body)?.textContent).not.toContain('original toxic text');
  });

  it('idempotent — re-render on same element returns null', () => {
    const body = makeBodyEl('rewritten safe text');
    const first = renderTeenMarker({
      el: body,
      analysis: makeAnalysis(),
      originalText: 'original toxic text',
      kind: 'rewrite',
      rewriteText: 'rewritten safe text',
    });
    expect(first).not.toBeNull();

    const second = renderTeenMarker({
      el: body,
      analysis: makeAnalysis(),
      originalText: 'original toxic text',
      kind: 'rewrite',
      rewriteText: 'rewritten safe text',
    });
    expect(second).toBeNull();
    expect(body.querySelectorAll('.fw-teen-marker')).toHaveLength(1);
  });

  it('kind=collapse base state uses the fixed teal folded-color, never the amber that collides with YELLOW', () => {
    // Folded posts (ads are severity 6) previously used the severity ramp as
    // the base color. At severity 5-7 that ramp returns #E0A458 — byte-
    // identical to the YELLOW explanation color — so the calm↔why toggle
    // showed yellow↔yellow (a live report: "two yellows"). The base is now a
    // fixed teal #4fb3a9 across all severities, guaranteed distinct from the
    // YELLOW explanation state.
    for (const score of [3, 6, 9]) {
      document.body.innerHTML = '';
      const body = makeBodyEl('placeholder text');
      const m = renderTeenMarker({
        el: body,
        analysis: makeAnalysis({ overallScore: score }),
        originalText: 'orig',
        kind: 'collapse',
      });
      const baseColor = m!.style.getPropertyValue('--fw-marker-color');
      expect(baseColor.toLowerCase()).toBe('#4fb3a9');
      expect(baseColor.toLowerCase()).not.toBe('#e0a458'); // never the YELLOW collision
    }
  });
});

describe('pickYellowReason — LLM-grounded reason with template fallback', () => {
  // Closes a live report: "the generic explanation seems very repetitive very
  // quickly and boring" report: prefers the per-comment grounded
  // `analysis.explanation` (LLM verdict.reason) over the static
  // technique-keyed template; falls back to the template only when the
  // LLM reason is missing / empty / too short / pathologically long.

  it('returns the LLM explanation when present and within length window', () => {
    const result = pickYellowReason({
      explanation: 'This comment shames the target by ridiculing their accent rather than engaging with the argument.',
      primaryTechnique: 'shame-attack',
    });
    expect(result).toBe('This comment shames the target by ridiculing their accent rather than engaging with the argument.');
  });

  it('two different LLM explanations under the same technique return different strings', () => {
    const a = pickYellowReason({
      explanation: 'This comment ridicules the speaker by mocking their voice.',
      primaryTechnique: 'shame-attack',
    });
    const b = pickYellowReason({
      explanation: 'This comment uses name-calling to make the target feel small.',
      primaryTechnique: 'shame-attack',
    });
    expect(a).not.toBe(b);
  });

  it('falls back to the static template when explanation is empty', () => {
    const result = pickYellowReason({
      explanation: '',
      primaryTechnique: 'shame-attack',
    });
    expect(result).toBe('personally attacks a target with shame language to silence them rather than answer the argument.');
  });

  it('falls back to the static template when explanation is whitespace-only', () => {
    const result = pickYellowReason({
      explanation: '   \n\t  ',
      primaryTechnique: 'fear-appeal',
    });
    expect(result).toBe('uses fear or threat to push the reader toward a decision before they can think it through.');
  });

  it('falls back to the static template when explanation is shorter than 8 chars', () => {
    const result = pickYellowReason({
      explanation: 'Bad.',
      primaryTechnique: 'fomo',
    });
    expect(result).toBe('pushes fear of missing out to drive a quick action.');
  });

  it('falls back to the static template when explanation exceeds 300 chars', () => {
    const longExplanation = 'A'.repeat(301);
    const result = pickYellowReason({
      explanation: longExplanation,
      primaryTechnique: 'bandwagon',
    });
    expect(result).toBe('implies "everyone is doing this" to pressure you to follow along.');
  });

  it('returns generic fallback when both LLM explanation and primaryTechnique are missing', () => {
    const result = pickYellowReason({});
    expect(result).toBe('matched a manipulation pattern.');
  });

  // Deterministic-floor grounding (board queue #4, 2026-07-03): floor
  // verdicts carry no LLM explanation, so the fallback grounds the template
  // in THIS item via the stored evidence COUNT. The matched words themselves
  // must never appear — re-printing a slur re-delivers the harm.
  describe('deterministic-floor fallback grounds the template with the match count', () => {
    it('profanity floor with 2 matches appends the plural count line (EN)', () => {
      const result = pickYellowReason({
        primaryTechnique: 'profanity',
        techniques: [{ technique: 'profanity', evidence: ['xxxx', 'yyyy'] }],
      });
      expect(result).toBe(
        'uses vulgar language as a hostility signal aimed at silencing rather than discussing. The original text had 2 words or phrases from the filter list.',
      );
    });

    it('profanity floor with 1 match appends the singular count line (EN)', () => {
      const result = pickYellowReason({
        primaryTechnique: 'profanity',
        techniques: [{ technique: 'profanity', evidence: ['xxxx'] }],
      });
      expect(result).toContain('The original text had one word or phrase from the filter list.');
    });

    it('never leaks the matched words into the explanation', () => {
      const result = pickYellowReason({
        primaryTechnique: 'profanity',
        techniques: [{ technique: 'profanity', evidence: ['slur-word-a', 'slur-word-b'] }],
      });
      expect(result).not.toContain('slur-word-a');
      expect(result).not.toContain('slur-word-b');
    });

    it('harm-floor (extreme-toxicity) with 3 signals appends the signals line (EN)', () => {
      const result = pickYellowReason({
        primaryTechnique: 'extreme-toxicity',
        techniques: [{ technique: 'extreme-toxicity', evidence: ['s1:x', 's2:y', 's3:z'] }],
      });
      expect(result).toBe(
        'crosses into extreme toxicity beyond normal disagreement. 3 signs of harmful content were found in this text.',
      );
    });

    it('Romanian channel appends the RO count line', () => {
      const result = pickYellowReason(
        {
          primaryTechnique: 'profanity',
          techniques: [{ technique: 'profanity', evidence: ['xxxx', 'yyyy'] }],
        },
        'ro',
      );
      expect(result).toBe(
        'folosește limbaj vulgar ca semnal de ostilitate, menit să reducă la tăcere, nu să discute. Textul original avea 2 cuvinte sau expresii din lista de filtre.',
      );
    });

    it('LLM-path techniques do NOT get the count line (evidence could quote hostile text)', () => {
      const result = pickYellowReason({
        primaryTechnique: 'shame-attack',
        techniques: [{ technique: 'shame-attack', evidence: ['you are pathetic'] }],
      });
      expect(result).toBe('personally attacks a target with shame language to silence them rather than answer the argument.');
    });

    it('floor technique without evidence stays on the plain template', () => {
      const result = pickYellowReason({
        primaryTechnique: 'profanity',
        techniques: [{ technique: 'profanity', evidence: [] }],
      });
      expect(result).toBe('uses vulgar language as a hostility signal aimed at silencing rather than discussing.');
    });

    it('a valid LLM explanation still wins over the grounded fallback', () => {
      const result = pickYellowReason({
        explanation: 'This comment piles vulgar insults on the previous commenter instead of answering them.',
        primaryTechnique: 'profanity',
        techniques: [{ technique: 'profanity', evidence: ['xxxx', 'yyyy'] }],
      });
      expect(result).toBe('This comment piles vulgar insults on the previous commenter instead of answering them.');
    });
  });

  it('returns generic fallback when explanation is undefined and technique is unknown', () => {
    const result = pickYellowReason({ explanation: undefined, primaryTechnique: undefined });
    expect(result).toBe('matched a manipulation pattern.');
  });

  it('static template no longer carries "Watch for X" didactic tail', () => {
    const techniques = [
      'shame-attack',
      'fear-appeal',
      'fomo',
      'bandwagon',
      'scapegoating',
    ] as const;
    for (const t of techniques) {
      const result = pickYellowReason({ primaryTechnique: t });
      expect(result.toLowerCase(), `${t} should not include "watch for"`).not.toContain('watch for');
    }
  });

  // V1.5-A validator-chain failure modes. The 8-300 char gate alone admits
  // pathological reasons that pass length but read worse than the static
  // template. Each silent-failure mode below is rejected and falls back to
  // the per-technique template.

  it('falls back to template when explanation drifts to Romanian on EN channel', () => {
    // RO drift via diacritics + RO-only function words. validateRewriteLanguage
    // detects the language and rejects when it is RO on an EN-expected channel.
    const result = pickYellowReason({
      explanation: 'Comentariul atacă personal subiectul prin limbaj de rușine pentru a-l reduce la tăcere.',
      primaryTechnique: 'shame-attack',
    });
    expect(result).toBe('personally attacks a target with shame language to silence them rather than answer the argument.');
  });

  it('accepts a Romanian explanation on RO channel (lang="ro")', () => {
    // When UI language is RO, a RO-language explanation must pass the
    // validateRewriteLanguage gate and be returned verbatim. Prior to the fix,
    // the gate was hardcoded to 'en' so all RO explanations fell back to the
    // static template.
    const roExplanation = 'Comentariul atacă personal subiectul prin limbaj de rușine pentru a-l reduce la tăcere.';
    const result = pickYellowReason(
      { explanation: roExplanation, primaryTechnique: 'shame-attack' },
      'ro',
    );
    expect(result).toBe(roExplanation);
  });

  it('falls back to RO template when explanation drifts to English on RO channel', () => {
    // An EN explanation must fail the gate when the resolved UI language is RO,
    // and the RO static template is returned instead.
    const result = pickYellowReason(
      {
        explanation: 'This comment attacks the target using shame language to silence them.',
        primaryTechnique: 'shame-attack',
      },
      'ro',
    );
    expect(result).toBe('atacă personal pe cineva cu limbaj de rușinare, ca să-l reducă la tăcere în loc să răspundă argumentului.');
  });

  it('falls back to template when explanation injects generic advisory ("rely on credible sources")', () => {
    // The LLM occasionally substitutes a ChatGPT-coach instruction for an
    // actual reason — "rely on credible sources" is the canonical example.
    // detectInjectedAdvisory catches it.
    const result = pickYellowReason({
      explanation: 'This is concerning content; it is essential to rely on credible sources for accurate information.',
      primaryTechnique: 'fear-appeal',
    });
    expect(result).toBe('uses fear or threat to push the reader toward a decision before they can think it through.');
  });

  it('falls back to template when explanation echoes the kebab-case technique identifier', () => {
    // The 8B model occasionally returns "This is shame-attack with severity 8"
    // verbatim — schema-field echo, reads like JSON not explanation.
    const result = pickYellowReason({
      explanation: 'This comment is shame-attack against the speaker.',
      primaryTechnique: 'shame-attack',
    });
    expect(result).toBe('personally attacks a target with shame language to silence them rather than answer the argument.');
  });

  it('falls back to template when explanation echoes a severity field ("severity 8" / "sev 9")', () => {
    const result = pickYellowReason({
      explanation: 'This comment has severity 8 and is highly hostile toward the speaker.',
      primaryTechnique: 'shame-attack',
    });
    expect(result).toBe('personally attacks a target with shame language to silence them rather than answer the argument.');
  });

  it('accepts a clean meta-style explanation that begins with "This comment..."', () => {
    // detectMetaTalk is intentionally NOT in the chain — explanations are
    // INHERENTLY meta-commentary about the comment, so "This comment..." is
    // the natural register, not a failure mode.
    const result = pickYellowReason({
      explanation: 'This comment ridicules the speaker by mocking their accent rather than engaging with the argument.',
      primaryTechnique: 'shame-attack',
    });
    expect(result).toBe('This comment ridicules the speaker by mocking their accent rather than engaging with the argument.');
  });
});

describe('Bug B — TikTok marker mount=after (escapes the line-clamp body span)', () => {
  // TikTok comment body is a styled-components line-clamp box
  // (-webkit-line-clamp + overflow:hidden). A marker appended INSIDE it is
  // clipped out of view ("dot in the wall"). mount:'after' inserts the marker
  // as the body span's next sibling so it escapes the clamp while staying in
  // the row. Other platforms keep the default inline 'inside' mount.

  function makeTikTokRow(bodyText: string): { row: HTMLElement; bodySpan: HTMLElement } {
    const row = document.createElement('div');
    row.className = 'css-xyz-7937d88b--DivCommentItemWrapper eNNN';
    const wrap = document.createElement('span');
    const bodySpan = document.createElement('span');
    bodySpan.className = 'TUXText TUXText--tiktok-sans';
    // Simulate TikTok's line-clamp box so a child WOULD be clipped.
    bodySpan.style.display = '-webkit-box';
    bodySpan.style.overflow = 'hidden';
    bodySpan.textContent = bodyText;
    wrap.appendChild(bodySpan);
    row.appendChild(wrap);
    document.body.appendChild(row);
    return { row, bodySpan };
  }

  it('mounts the marker as a SIBLING of the body span, not a child', () => {
    const { bodySpan } = makeTikTokRow('rewritten safe text');
    const marker = renderTeenMarker({
      el: bodySpan,
      analysis: makeAnalysis(),
      originalText: 'original toxic text',
      kind: 'rewrite',
      rewriteText: 'rewritten safe text',
      mount: 'after',
    });
    expect(marker).not.toBeNull();
    // The marker is NOT inside the clamped body span.
    expect(bodySpan.querySelector('.fw-teen-marker')).toBeNull();
    // It is the body span's immediate next sibling.
    expect(bodySpan.nextElementSibling).toBe(marker);
    // The row still resolves from the body span (viewport-tracker SHELL walk).
    expect(bodySpan.closest('[class*="DivCommentItemWrapper"]')).not.toBeNull();
  });

  it('idempotent: a second render with mount=after does not double-mount', () => {
    const { row, bodySpan } = makeTikTokRow('rewritten safe text');
    renderTeenMarker({
      el: bodySpan,
      analysis: makeAnalysis(),
      originalText: 'original toxic text',
      kind: 'rewrite',
      rewriteText: 'rewritten safe text',
      mount: 'after',
    });
    const second = renderTeenMarker({
      el: bodySpan,
      analysis: makeAnalysis(),
      originalText: 'original toxic text',
      kind: 'rewrite',
      rewriteText: 'rewritten safe text',
      mount: 'after',
    });
    expect(second).toBeNull();
    expect(row.querySelectorAll('.fw-teen-marker')).toHaveLength(1);
  });

  it('default mount (inside) is unchanged for non-TikTok platforms', () => {
    const body = makeBodyEl('rewritten safe text');
    const marker = renderTeenMarker({
      el: body,
      analysis: makeAnalysis(),
      originalText: 'original toxic text',
      kind: 'rewrite',
      rewriteText: 'rewritten safe text',
    });
    expect(marker).not.toBeNull();
    // Inline mount: the marker is a CHILD of the body element.
    expect(body.querySelector('.fw-teen-marker')).toBe(marker);
    expect(body.nextElementSibling).toBeNull();
  });

  it('toggle still swaps the body span text when marker is a sibling', () => {
    const { bodySpan } = makeTikTokRow('rewritten safe text');
    const marker = renderTeenMarker({
      el: bodySpan,
      analysis: makeAnalysis(),
      originalText: 'original toxic text',
      kind: 'rewrite',
      rewriteText: 'rewritten safe text',
      mount: 'after',
    });
    expect(bodySpan.dataset.fwMarkerState).toBe('green');
    expect(bodySpan.textContent).toContain('rewritten safe text');
    // GREEN -> YELLOW (explanation)
    marker!.click();
    expect(bodySpan.dataset.fwMarkerState).toBe('yellow');
    // YELLOW -> RED (original)
    marker!.click();
    expect(bodySpan.dataset.fwMarkerState).toBe('red');
    expect(bodySpan.textContent).toContain('original toxic text');
  });
});

describe('M63: one marker line, one language', () => {
  it('a decisive English reason under a Romanian interface renders the whole marker in English', () => {
    const body = makeBodyEl('rewritten safe text');
    const marker = renderTeenMarker({
      el: body,
      analysis: makeAnalysis({ explanation: 'This comment contains a slur and the writer is aiming it at a protected group.' }),
      originalText: 'original toxic text',
      kind: 'rewrite',
      rewriteText: 'rewritten safe text',
      lang: 'ro',
    })!;
    expect(marker).not.toBeNull();
    // The aria-label is the marker's own string table: English, not Romanian.
    expect(marker.getAttribute('aria-label')).not.toMatch(/[ăîâșț]/i);
  });

  it('the language rule: decisive and known follows the reason, anything else keeps the interface language', () => {
    expect(markerLanguageFor('This comment contains a slur and the writer is aiming it at a protected group.', 'ro')).toBe('en');
    expect(markerLanguageFor('Comentariul atacă o persoană și o umilește în fața celorlalți, nu este o glumă.', 'en')).toBe('ro');
    expect(markerLanguageFor('Comentariul atacă o persoană și o umilește în fața celorlalți, nu este o glumă.', 'es')).toBe('ro');
    // Short or empty: the interface language stays.
    expect(markerLanguageFor('', 'ro')).toBe('ro');
    expect(markerLanguageFor('slur', 'ro')).toBe('ro');
    // Spanish and Portuguese interfaces over an English reason follow the reason too.
    expect(markerLanguageFor('This comment contains a slur and the writer is aiming it at a protected group.', 'pt-BR')).toBe('en');
    // Same language: unchanged.
    expect(markerLanguageFor('This comment contains a slur and the writer is aiming it at a protected group.', 'en')).toBe('en');
  });
});
