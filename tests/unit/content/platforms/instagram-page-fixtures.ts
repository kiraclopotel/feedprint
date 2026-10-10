// The fake Instagram pages the adapter tests read.
//
// Cut out of instagram-adapter.test.ts on 2026-09-16 (PLAN-2026-09-16 item 11.3), which was
// 1,103 lines. Not a test file: vitest collects only names ending in .test.



// @vitest-environment jsdom




export function makeArticle(innerHTML: string): HTMLElement {
  const article = document.createElement('article');
  article.innerHTML = innerHTML;
  return article;
}

export function toNodeList(elements: HTMLElement[]): NodeList {
  const container = document.createElement('div');
  for (const el of elements) {
    container.appendChild(el);
  }
  return container.querySelectorAll('article');
}


export function addSpan(parent: HTMLElement, text: string): HTMLSpanElement {
  const s = document.createElement('span');
  s.textContent = text;
  parent.appendChild(s);
  return s;
}

export function addAuthorLink(parent: HTMLElement, handle: string): HTMLAnchorElement {
  const a = document.createElement('a');
  a.href = `/${handle}/`;
  a.setAttribute('role', 'link');
  addSpan(a, handle);
  parent.appendChild(a);
  return a;
}

export function addCLink(parent: HTMLElement, postId: string, commentId: string, label: string): HTMLAnchorElement {
  const a = document.createElement('a');
  a.href = `/p/${postId}/c/${commentId}/`;
  a.textContent = label;
  parent.appendChild(a);
  return a;
}

export function buildPermalinkRow(
  parent: HTMLElement,
  postId: string,
  handle: string,
  duplicateHandleSpan: boolean,
  bodyText: string,
  commentId: string,
): HTMLElement {
  const row = document.createElement('div');
  parent.appendChild(row);
  addAuthorLink(row, handle);
  if (duplicateHandleSpan) addSpan(row, handle);
  addSpan(row, bodyText);
  addCLink(row, postId, commentId, '1d');
  return row;
}

export function makeTile(href: string, alt: string | null): HTMLAnchorElement {
  const a = document.createElement('a');
  a.setAttribute('href', href);
  if (alt !== null) {
    const img = document.createElement('img');
    img.setAttribute('alt', alt);
    a.appendChild(img);
  }
  return a;
}


export function buildReelContainer(): HTMLElement {
  const container = document.createElement('div');
  container.appendChild(document.createElement('video'));
  const caption = document.createElement('span');
  caption.setAttribute('dir', 'auto');
  caption.textContent = 'A reel caption long enough to pass the extraction threshold.';
  container.appendChild(caption);
  const authorLink = document.createElement('a');
  authorLink.setAttribute('href', '/reelcreator/');
  authorLink.textContent = 'reelcreator';
  container.appendChild(authorLink);
  return container;
}

export function buildReelDialogRow(handle: string, body: string): HTMLElement {
  const row = document.createElement('div');
  const link = document.createElement('a');
  link.setAttribute('href', `/${handle}/`);
  link.textContent = handle;
  row.appendChild(link);
  const span = document.createElement('span');
  span.setAttribute('dir', 'auto');
  span.textContent = body;
  row.appendChild(span);
  row.appendChild(document.createElement('time'));
  return row;
}
