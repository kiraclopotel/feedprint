// FeelingWise - shared <style> tag helpers for the engagement modules.
//
// Every engagement module injects its CSS through one <style> element keyed
// by a stable id (the controller's STYLE_TAG_IDS list removes them all on a
// settings reset). The bodies were copy-pasted ten times; this is the one
// copy. Ids are owned by the callers and must not change.
//
// This is also the one place a stylesheet's hides are held to the rule the
// door (mark-hidden.ts) holds JavaScript hides to: nothing inside a menu, a
// tooltip or a list of choices (11 Oct 2026, the owner's report of the card on
// an account name losing its Unfollow and Block). A rule in a stylesheet cannot
// call the door, so each hiding rule is given the same exclusion here, whatever
// module wrote it.

import { POPUP_LAYER_GATE_CSS } from '../../core/protected-regions';

/** A selector that names one of our own stamps was decided by code that asked the door when it stamped. */
const OWN_STAMP = /\[data-fw-/;

/** Split a selector list at its top-level commas: not inside (), [] or a quoted string. */
function splitSelectorList(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote = '';
  let start = 0;
  for (let i = 0; i < list.length; i++) {
    const ch = list[i];
    if (ch.charCodeAt(0) === 92) { i++; continue; } // a backslash escapes the next character
    if (quote) { if (ch === quote) quote = ''; continue; }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    else if (ch === ',' && depth === 0) { parts.push(list.slice(start, i)); start = i + 1; }
  }
  parts.push(list.slice(start));
  return parts.map((p) => p.trim()).filter(Boolean);
}

function hidesWhatItMatches(rule: CSSStyleRule): boolean {
  return rule.style.display === 'none' || rule.style.visibility === 'hidden';
}

function guardRules(rules: CSSRuleList): void {
  for (const rule of Array.from(rules)) {
    const style = rule as CSSStyleRule;
    if (typeof style.selectorText === 'string' && style.style) {
      if (!hidesWhatItMatches(style)) continue;
      const guarded = splitSelectorList(style.selectorText).map((sel) =>
        OWN_STAMP.test(sel) || sel.includes('::') ? sel : sel + POPUP_LAYER_GATE_CSS);
      try { style.selectorText = guarded.join(', '); } catch { /* a selector the engine refuses is left as written */ }
    }
    const nested = (rule as CSSGroupingRule).cssRules;
    if (nested) guardRules(nested);
  }
}

/** Inject `css` under `id` once; a second call with the same id is a no-op. */
export function ensureStyleTag(id: string, css: string): void {
  if (document.getElementById(id)) return;
  const style = document.createElement('style');
  style.id = id;
  style.textContent = css;
  document.head.appendChild(style);
  try { if (style.sheet) guardRules(style.sheet.cssRules); } catch { /* a sheet that cannot be read stays as written */ }
}

/** Remove the <style> element with `id`, if present. */
export function removeStyleTag(id: string): void {
  document.getElementById(id)?.remove();
}
