/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  findCommentEntries,
  swapCommentTextInPlace,
  hideCommentAsFallback,
  hideCommentAsFallbackTerminal,
  hideCommentWithNoticeTerminal,
  hideCommentTerminal,
  recordedCommentHideAction,
  type CommentEntry,
} from '../../../../src/content/protection/comment-overlay';

// ─────────────────────────────────────────────────────────────────────────────
// LOOP-032: findCommentEntries + swapCommentTextInPlace
// ─────────────────────────────────────────────────────────────────────────────

function makeTikTokEntryNode(
  author: string,
  text: string,
): HTMLElement {
  const node = document.createElement('div');
  node.setAttribute('data-e2e', 'comment-level-1');

  const authorA = document.createElement('a');
  authorA.setAttribute('href', `/@${author.replace(/^@/, '')}`);
  authorA.setAttribute('data-e2e', 'comment-username-1');
  authorA.textContent = author;

  const textWrap = document.createElement('div');
  textWrap.setAttribute('data-e2e', 'comment-text-1');
  const textSpan = document.createElement('span');
  textSpan.textContent = text;
  textWrap.appendChild(textSpan);

  node.appendChild(authorA);
  node.appendChild(textWrap);
  return node;
}

function makeStructuralLi(author: string, text: string): HTMLElement {
  const li = document.createElement('li');
  const authorA = document.createElement('a');
  authorA.setAttribute('href', `/@${author.replace(/^@/, '')}`);
  authorA.textContent = author;

  const textSpan = document.createElement('span');
  textSpan.textContent = text;

  // Add a numeric "like count" span to verify it gets skipped
  const likeSpan = document.createElement('span');
  likeSpan.textContent = '42';

  li.appendChild(authorA);
  li.appendChild(textSpan);
  li.appendChild(likeSpan);
  return li;
}

describe('comment-overlay — findCommentEntries (TikTok)', () => {
  let container: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    container = document.createElement('ul');
    container.setAttribute('data-e2e', 'comment-list');
    document.body.appendChild(container);
  });

  it('returns entries via data-e2e path when comment-level-1 nodes present', () => {
    container.appendChild(makeTikTokEntryNode('@user_a', 'lol so cringe'));
    container.appendChild(makeTikTokEntryNode('@user_b', 'horrible driver'));

    const entries = findCommentEntries(container, 'tiktok');
    expect(entries).toHaveLength(2);
    expect(entries[0].author).toBe('@user_a');
    expect(entries[0].text).toBe('lol so cringe');
    expect(entries[1].author).toBe('@user_b');
    expect(entries[1].text).toBe('horrible driver');
  });

  it('preserves textEl ref pointing at the inner span, not the outer wrap', () => {
    container.appendChild(makeTikTokEntryNode('@c', 'hello world'));
    const entries = findCommentEntries(container, 'tiktok');
    expect(entries[0].textEl.tagName).toBe('SPAN');
    expect(entries[0].textEl.textContent).toBe('hello world');
  });

  it('falls back to structural walk when no data-e2e nodes present', () => {
    container.appendChild(makeStructuralLi('@user_a', 'this is a thoughtful comment about kittens'));
    container.appendChild(makeStructuralLi('@user_b', 'agreed with the post about climate change'));

    const entries = findCommentEntries(container, 'tiktok');
    expect(entries).toHaveLength(2);
    expect(entries[0].author).toBe('@user_a');
    expect(entries[0].text).toContain('kittens');
  });

  it('skips entries with data-fw-rewritten="true" (idempotence)', () => {
    const node1 = makeTikTokEntryNode('@a', 'first');
    const node2 = makeTikTokEntryNode('@b', 'second');
    node1.setAttribute('data-fw-rewritten', 'true');
    container.appendChild(node1);
    container.appendChild(node2);

    const entries = findCommentEntries(container, 'tiktok');
    expect(entries).toHaveLength(1);
    expect(entries[0].author).toBe('@b');
  });

  it('returns empty array when container has no recognizable comments', () => {
    const entries = findCommentEntries(container, 'tiktok');
    expect(entries).toEqual([]);
  });

  // ─── LOOP-062: engagement-notification filter ───
  it('filters out RO notification card "X ți-a apreciat videoclipul" (live test 2026-04-20)', () => {
    container.appendChild(makeTikTokEntryNode('@ana_example', 'Ana, RaduEx ți-a apreciat videoclipul. 3-25'));
    container.appendChild(makeTikTokEntryNode('@real', 'actually thoughtful comment about the video'));
    const entries = findCommentEntries(container, 'tiktok');
    // Only the genuine comment survives — the notification card is dropped.
    expect(entries).toHaveLength(1);
    expect(entries[0].text).toContain('thoughtful');
  });

  it('filters "User D really liked your video" (EN notification variant)', () => {
    container.appendChild(makeTikTokEntryNode('@user_d', 'User D really liked your video'));
    container.appendChild(makeTikTokEntryNode('@user_m', 'legit comment about the outfit'));
    const entries = findCommentEntries(container, 'tiktok');
    expect(entries).toHaveLength(1);
    expect(entries[0].author).toBe('@user_m');
  });

  it('filters "și Alți 1 ți-a apreciat videoclipul" multi-name notification', () => {
    container.appendChild(makeTikTokEntryNode('@multi', 'Mihaela, Andrei sax28 și Alți 1 ți-a apreciat videoclipul. 3-25'));
    container.appendChild(makeTikTokEntryNode('@real', 'the car looks great btw'));
    const entries = findCommentEntries(container, 'tiktok');
    expect(entries).toHaveLength(1);
    expect(entries[0].author).toBe('@real');
  });

  it('does NOT filter legit comments that happen to mention "video"', () => {
    container.appendChild(makeTikTokEntryNode('@u1', 'I really like this video, great content'));
    const entries = findCommentEntries(container, 'tiktok');
    expect(entries).toHaveLength(1);
  });

  it('filters notifications even on the structural fallback path', () => {
    container.appendChild(makeStructuralLi('@x', 'Ana ți-a apreciat videoclipul'));
    container.appendChild(makeStructuralLi('@y', 'this is actually a long meaningful comment'));
    const entries = findCommentEntries(container, 'tiktok');
    expect(entries).toHaveLength(1);
    expect(entries[0].author).toBe('@y');
  });
});

describe('comment-overlay — findCommentEntries (YouTube)', () => {
  let container: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  it('returns entries from ytd-comment-thread-renderer elements', () => {
    const thread = document.createElement('ytd-comment-thread-renderer') as unknown as HTMLElement;
    const author = document.createElement('div');
    author.id = 'author-text';
    author.textContent = '@ytuser';
    const content = document.createElement('div');
    content.id = 'content-text';
    content.textContent = 'this is a YouTube comment';
    thread.appendChild(author);
    thread.appendChild(content);
    container.appendChild(thread);

    const entries = findCommentEntries(container, 'youtube');
    expect(entries).toHaveLength(1);
    expect(entries[0].author).toBe('@ytuser');
    expect(entries[0].text).toBe('this is a YouTube comment');
    expect(entries[0].textEl.id).toBe('content-text');
  });
});

describe('comment-overlay — swapCommentTextInPlace (stealth invariants)', () => {
  let container: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    container = document.createElement('ul');
    container.setAttribute('data-e2e', 'comment-list');
    document.body.appendChild(container);
  });

  it('swaps textEl.textContent but leaves author element intact', () => {
    const node = makeTikTokEntryNode('@user_a', 'original toxic text');
    container.appendChild(node);

    const entries = findCommentEntries(container, 'tiktok');
    const entry = entries[0];
    const authorBefore = entry.rootEl.querySelector<HTMLAnchorElement>('a[data-e2e="comment-username-1"]');
    expect(authorBefore?.textContent).toBe('@user_a');

    swapCommentTextInPlace(entry, 'Octopuses have three hearts and blue blood.');

    expect(entry.textEl.textContent).toBe('Octopuses have three hearts and blue blood.');
    const authorAfter = entry.rootEl.querySelector<HTMLAnchorElement>('a[data-e2e="comment-username-1"]');
    expect(authorAfter?.textContent).toBe('@user_a');
    expect(authorAfter?.getAttribute('href')).toBe('/@user_a');
  });

  it('marks rootEl with data-fw-rewritten="true"', () => {
    const node = makeTikTokEntryNode('@b', 'x');
    container.appendChild(node);
    const entries = findCommentEntries(container, 'tiktok');
    swapCommentTextInPlace(entries[0], 'new text');
    expect(entries[0].rootEl.dataset.fwRewritten).toBe('true');
  });

  it('does NOT inject any yellow-frame container, category chip, or 💡 header', () => {
    const node = makeTikTokEntryNode('@c', 'x');
    container.appendChild(node);
    const entries = findCommentEntries(container, 'tiktok');
    swapCommentTextInPlace(entries[0], 'educational fact');

    // No yellow-frame overlay class exists anywhere after swap
    expect(document.querySelectorAll('.fw-comment-overlay').length).toBe(0);
    expect(document.querySelectorAll('.fw-comment-topic').length).toBe(0);
    // Container should NOT have display:none forced on it
    expect(container.style.getPropertyValue('display')).not.toBe('none');
    // No "💡" / "Știai că" / "Did you know" in any DOM node
    const dom = document.body.innerHTML;
    expect(dom).not.toMatch(/💡/u);
    expect(dom).not.toMatch(/Știai/);
    expect(dom.toLowerCase()).not.toContain('did you know');
  });

  it('preserves the textEl-own font, not a sibling div font (TikTok Path B picker)', () => {
    // Reproduce the structural-fallback shape: the rootEl has a sibling div
    // whose computed font differs from the textEl's own. The Path B picker
    // (`buildEntryFromTikTokNode` fallback / `buildEntryFromStructuralChild`)
    // picks the longest-text element as textEl. The font snapshot must
    // anchor on textEl's own computed style so the rewrite inherits the
    // correct platform font. Snapshotting via a first-text-node walker
    // could jump to a sibling element with a different font.
    document.body.innerHTML = '';
    const root = document.createElement('div');
    // Sibling with a non-platform font — the bug repro. If the snapshot
    // walker picked this element, the rewrite would lock the wrong font.
    const sibling = document.createElement('div');
    sibling.style.fontFamily = 'Roboto';
    sibling.textContent = 'short';
    // The textEl with the platform font.
    const textEl = document.createElement('span');
    textEl.style.fontFamily = 'TikTokFont';
    textEl.textContent = 'this is the longest comment text in the row';
    root.appendChild(sibling);
    root.appendChild(textEl);
    document.body.appendChild(root);

    const entry: CommentEntry = {
      rootEl: root,
      textEl,
      author: '',
      text: textEl.textContent ?? '',
    };
    swapCommentTextInPlace(entry, 'rewritten text');

    // textEl carries an inline fontFamily after swap — and it must match
    // the textEl's own font, never the sibling's.
    expect(textEl.style.fontFamily).toContain('TikTokFont');
    expect(textEl.style.fontFamily).not.toContain('Roboto');
  });

  it('descends into inner content-bearing span when outer textEl is a wrapper (TikTok Path A)', () => {
    // TikTok Path A reality: `entry.textEl` resolves to
    // `[data-e2e="comment-text-1"] span` (the OUTER wrapper). TikTok nests
    // the actual content-bearing span inside; the wrapper may carry
    // collapse rules (e.g. font-size 0 to suppress whitespace between
    // inline-block children) that are NOT the rendered typography. Pre-fix
    // a snapshot of the wrapper applied font-size:0 inline → rewrite
    // rendered invisibly small. Hybrid fix: walk inward to the deepest
    // descendant whose first child is a Text node; snapshot from THAT
    // element; apply to entry.textEl as the write target.
    document.body.innerHTML = '';
    const root = document.createElement('div');
    const outerWrapper = document.createElement('span');
    outerWrapper.style.fontSize = '0';
    outerWrapper.style.fontFamily = 'WrapperFont';
    const innerSpan = document.createElement('span');
    innerSpan.style.fontSize = '14px';
    innerSpan.style.fontFamily = 'InnerContentFont';
    innerSpan.textContent = 'the actual visible comment body';
    outerWrapper.appendChild(innerSpan);
    root.appendChild(outerWrapper);
    document.body.appendChild(root);

    const entry: CommentEntry = {
      rootEl: root,
      textEl: outerWrapper,
      author: '',
      text: outerWrapper.textContent ?? '',
    };
    swapCommentTextInPlace(entry, 'rewritten body');

    // Write target is still the wrapper (entry.textEl) — caller contract.
    expect(outerWrapper.textContent).toBe('rewritten body');
    // Snapshot picked up the inner span's font, not the wrapper's font-size:0.
    expect(outerWrapper.style.fontFamily).toContain('InnerContentFont');
    expect(outerWrapper.style.fontFamily).not.toContain('WrapperFont');
    expect(outerWrapper.style.fontSize).toBe('14px');
    // The applied font-size must be a non-zero value — never the wrapper's
    // collapsed font-size:0 which would render the rewrite invisible.
    expect(outerWrapper.style.fontSize).not.toBe('0px');
    expect(outerWrapper.style.fontSize).not.toBe('0');
  });

  it('falls back outward to a non-zero font-size when the inner host carries font-size:0 (defensive)', () => {
    // Edge case: the inward walker descends to a leaf whose own font-size
    // is 0. The fallback walks outward from the snapshot host (capped at
    // entry.textEl) until a non-zero value surfaces, so we never apply
    // font-size:0 inline.
    document.body.innerHTML = '';
    const root = document.createElement('div');
    const wrapper = document.createElement('span');
    wrapper.style.fontSize = '15px';
    const inner = document.createElement('span');
    inner.style.fontSize = '0';
    inner.textContent = 'visible comment text';
    wrapper.appendChild(inner);
    root.appendChild(wrapper);
    document.body.appendChild(root);

    const entry: CommentEntry = {
      rootEl: root,
      textEl: wrapper,
      author: '',
      text: wrapper.textContent ?? '',
    };
    swapCommentTextInPlace(entry, 'rewritten');

    expect(wrapper.style.fontSize).toBe('15px');
  });

  it('preserves font-style / font-variant / text-transform from textEl', () => {
    document.body.innerHTML = '';
    const root = document.createElement('div');
    const textEl = document.createElement('span');
    textEl.style.fontStyle = 'italic';
    textEl.style.fontVariant = 'small-caps';
    textEl.style.textTransform = 'uppercase';
    textEl.textContent = 'styled native text content';
    root.appendChild(textEl);
    document.body.appendChild(root);

    const entry: CommentEntry = {
      rootEl: root,
      textEl,
      author: '',
      text: textEl.textContent ?? '',
    };
    swapCommentTextInPlace(entry, 'replacement');

    expect(textEl.style.fontStyle).toBe('italic');
    expect(textEl.style.fontVariant).toBe('small-caps');
    expect(textEl.style.textTransform).toBe('uppercase');
  });

  it('does NOT add extra DOM children to the comment row', () => {
    const node = makeTikTokEntryNode('@d', 'x');
    container.appendChild(node);
    const childCountBefore = node.childElementCount;

    const entries = findCommentEntries(container, 'tiktok');
    swapCommentTextInPlace(entries[0], 'new prose');

    expect(node.childElementCount).toBe(childCountBefore);
  });

  it('second findCommentEntries walk after swap returns empty (idempotence)', () => {
    const node = makeTikTokEntryNode('@e', 'x');
    container.appendChild(node);

    const first = findCommentEntries(container, 'tiktok');
    expect(first).toHaveLength(1);
    swapCommentTextInPlace(first[0], 'new');

    const second = findCommentEntries(container, 'tiktok');
    expect(second).toHaveLength(0);
  });
});

describe('comment-overlay — hideCommentAsFallback (LOOP-032 safety-gap)', () => {
  let container: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    container = document.createElement('ul');
    container.setAttribute('data-e2e', 'comment-list');
    document.body.appendChild(container);
  });

  it('sets display:none !important so TikTok inline styles can\'t override', () => {
    const node = makeTikTokEntryNode('@a', 'potentially toxic text');
    container.appendChild(node);
    const entries = findCommentEntries(container, 'tiktok');
    hideCommentAsFallback(entries[0]);
    expect(entries[0].rootEl.style.getPropertyValue('display')).toBe('none');
    expect(entries[0].rootEl.style.getPropertyPriority('display')).toBe('important');
  });

  it('marks BOTH data-fw-rewritten AND data-fw-hidden-fallback', () => {
    const node = makeTikTokEntryNode('@b', 'x');
    container.appendChild(node);
    const entries = findCommentEntries(container, 'tiktok');
    hideCommentAsFallback(entries[0]);
    expect(entries[0].rootEl.dataset.fwRewritten).toBe('true');
    expect(entries[0].rootEl.dataset.fwHiddenFallback).toBe('true');
  });

  it('does NOT modify textEl content — text sits intact in hidden DOM (forensic audit)', () => {
    const node = makeTikTokEntryNode('@c', 'the original bad comment text');
    container.appendChild(node);
    const entries = findCommentEntries(container, 'tiktok');
    hideCommentAsFallback(entries[0]);
    expect(entries[0].textEl.textContent).toBe('the original bad comment text');
  });

  it('second findCommentEntries walk after hide returns empty (dedup across observer runs)', () => {
    const node = makeTikTokEntryNode('@d', 'x');
    container.appendChild(node);
    const first = findCommentEntries(container, 'tiktok');
    hideCommentAsFallback(first[0]);
    const second = findCommentEntries(container, 'tiktok');
    expect(second).toHaveLength(0);
  });

  it('reports an applied terminal only after the hidden DOM state is present', () => {
    const node = makeTikTokEntryNode('@e', 'hide terminal text');
    container.appendChild(node);
    const entry = findCommentEntries(container, 'tiktok')[0];

    expect(hideCommentAsFallbackTerminal(entry)).toBe(true);
    expect(entry.rootEl.dataset.fwHiddenFallback).toBe('true');
    expect(entry.rootEl.style.getPropertyValue('display')).toBe('none');
    expect(entry.rootEl.style.getPropertyPriority('display')).toBe('important');
  });

  it('records hide only when the hide reached the DOM', () => {
    expect(recordedCommentHideAction(true)).toBe('hide');
    expect(recordedCommentHideAction(false)).toBe('mark');
  });
});

describe('comment-overlay — hideCommentWithNoticeTerminal (the sentence where the comment was)', () => {
  let container: HTMLElement;
  const notice = { text: 'FeelingWise hid this comment: an identity slur', showLabel: 'show anyway', hideLabel: 'hide again' };

  beforeEach(() => {
    document.body.innerHTML = '';
    container = document.createElement('ul');
    container.setAttribute('data-e2e', 'comment-list');
    document.body.appendChild(container);
  });

  it('leaves the sentence in the text slot, keeps the row visible, and proves it', () => {
    const node = makeTikTokEntryNode('@a', 'the original slur-laden text');
    container.appendChild(node);
    const entry = findCommentEntries(container, 'tiktok')[0];
    expect(hideCommentWithNoticeTerminal(entry, notice)).toBe(true);
    expect(entry.textEl.textContent).toBe(notice.text);
    expect(entry.rootEl.style.getPropertyValue('display')).toBe('');
    expect(entry.rootEl.textContent).not.toContain('slur-laden');
    expect(entry.rootEl.dataset.fwRewritten).toBe('true');
    expect(entry.rootEl.dataset.fwHiddenFallback).toBe('true');
    const btn = entry.rootEl.querySelector('button[data-fw-comment-reveal]') as HTMLButtonElement;
    expect(btn.textContent).toBe('show anyway');
  });

  it('show anyway restores the original, hide again restores the sentence', () => {
    const node = makeTikTokEntryNode('@b', 'the original text');
    container.appendChild(node);
    const entry = findCommentEntries(container, 'tiktok')[0];
    hideCommentWithNoticeTerminal(entry, notice);
    const btn = entry.rootEl.querySelector('button[data-fw-comment-reveal]') as HTMLButtonElement;
    btn.click();
    expect(entry.textEl.textContent).toBe('the original text');
    expect(entry.rootEl.getAttribute('data-fw-user-revealed')).toBe('true');
    expect(btn.textContent).toBe('hide again');
    btn.click();
    expect(entry.textEl.textContent).toBe(notice.text);
    expect(entry.rootEl.getAttribute('data-fw-user-revealed')).toBeNull();
    expect(btn.textContent).toBe('show anyway');
  });

  it('a second walk skips the row, and a second call is idempotent', () => {
    const node = makeTikTokEntryNode('@c', 'x');
    container.appendChild(node);
    const entry = findCommentEntries(container, 'tiktok')[0];
    expect(hideCommentWithNoticeTerminal(entry, notice)).toBe(true);
    expect(findCommentEntries(container, 'tiktok')).toHaveLength(0);
    expect(hideCommentWithNoticeTerminal(entry, notice)).toBe(true);
    expect(entry.rootEl.querySelectorAll('button[data-fw-comment-reveal]')).toHaveLength(1);
  });

  it('hideCommentTerminal with null closes the row silently (Child), with a notice leaves the sentence', () => {
    const a = makeTikTokEntryNode('@d', 'child text');
    const b = makeTikTokEntryNode('@e', 'teen text');
    container.append(a, b);
    const [ea, eb] = findCommentEntries(container, 'tiktok');
    expect(hideCommentTerminal(ea, null)).toBe(true);
    expect(ea.rootEl.style.getPropertyValue('display')).toBe('none');
    expect(ea.textEl.textContent).toBe('child text');
    expect(hideCommentTerminal(eb, notice)).toBe(true);
    expect(eb.rootEl.style.getPropertyValue('display')).toBe('');
    expect(eb.textEl.textContent).toBe(notice.text);
  });
});
