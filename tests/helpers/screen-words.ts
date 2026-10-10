// The words on a screen as a person reads them, for tests that scan a screen for a word.

/**
 * The text of an element one text node at a time, with a space between: textContent glues neighbouring elements, so
 * "Home" beside "AI" beside "License" reads "HomeAILicense" and a word-boundary search finds no AI in it.
 */
export function screenWords(el: Element | null): string {
  if (!el) return '';
  const out: string[] = [];
  const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) out.push(n.textContent ?? '');
  return out.join(' ');
}
