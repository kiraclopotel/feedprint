// @vitest-environment jsdom
// InstagramAdapter — lazy-load chain-ID collisions (fwCommentNextIdx)
//
// Cut out of instagram-adapter.test.ts on 2026-09-16 (PLAN-2026-09-16 item 11.3).

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InstagramAdapter } from '../../../../src/content/platforms/instagram';
import { makeArticle, toNodeList, buildReelContainer, buildReelDialogRow } from './instagram-page-fixtures';

describe('InstagramAdapter — lazy-load chain-ID collisions (fwCommentNextIdx)', () => {
  let adapter: InstagramAdapter;

  beforeEach(() => {
    document.body.innerHTML = '';
    adapter = new InstagramAdapter();
    Object.defineProperty(window, 'location', {
      value: { hostname: 'www.instagram.com', pathname: '/' },
      writable: true,
      configurable: true,
    });
  });

  it('a lazy-loaded comment on a second pass never reuses a first-pass comment id', () => {
    const article = makeArticle(`
      <a href="/p/Cxyz1234ABC/" role="link">View</a>
      <a href="/janedoe/" role="link"><span>janedoe</span></a>
      <span dir="auto">Main caption text that is long enough to be extracted by the adapter.</span>
      <ul>
        <li><span>Caption row placeholder ignored by walker</span></li>
        <li>
          <a href="/viewer1/"><span>viewer1</span></a>
          <span>First reaction comment seen on initial extract</span>
        </li>
      </ul>
    `);
    document.body.appendChild(article);

    const first = adapter.extractPosts(toNodeList([article]));
    const firstIds = first.filter(p => p.kind === 'top-comment').map(p => p.id);
    expect(firstIds).toHaveLength(1);

    // Lazy-load: IG appends a new comment <li>; the first <li> keeps its
    // `fwCommentSeen` stamp so the walker skips it without advancing.
    const ul = article.querySelector('ul');
    const newLi = document.createElement('li');
    newLi.innerHTML = `
      <a href="/viewer2/"><span>viewer2</span></a>
      <span>Second reaction comment lazy-loaded after the first scan</span>
    `;
    ul!.appendChild(newLi);

    const second = adapter.extractPosts(toNodeList([article]));
    const secondComments = second.filter(p => p.kind === 'top-comment');
    expect(secondComments).toHaveLength(1);
    expect(secondComments[0].text).toContain('lazy-loaded after the first scan');
    // The collision: pre-fix the new comment re-minted the first pass's
    // `ig-cmt-Cxyz1234ABC-0`, so the dedup layer silently swallowed one of
    // the two distinct comments' forensic records.
    expect(firstIds).not.toContain(secondComments[0].id);
  });

  it('a lazy-loaded reply after viewport re-entry never reuses a first-pass id (comment OR reply)', () => {
    const article = makeArticle(`
      <a href="/p/Cxyz1234ABC/" role="link">View</a>
      <a href="/janedoe/" role="link"><span>janedoe</span></a>
      <span dir="auto">Main caption text that is long enough to be extracted by the adapter.</span>
      <ul>
        <li><span>Caption row placeholder ignored by walker</span></li>
        <li>
          <a href="/viewer1/"><span>viewer1</span></a>
          <span>Top-level comment that the parent should see flagged in the chain record output</span>
          <ul>
            <li>
              <a href="/replier1/"><span>replier1</span></a>
              <span>A nested reply that was expanded</span>
            </li>
          </ul>
        </li>
      </ul>
    `);
    document.body.appendChild(article);

    const first = adapter.extractPosts(toNodeList([article]));
    const firstTop = first.find(p => p.kind === 'top-comment');
    const firstReply = first.find(p => p.kind === 'reply');
    expect(firstTop).toBeDefined();
    expect(firstReply).toBeDefined();

    // Viewport re-entry: the tracker clears `fwCommentSeen` on the comment's
    // own element when the user scrolls it back into view (viewport-tracker
    // clearStampsAndViewedState), so the walker re-walks the parent li — and
    // with it the nested reply <ul>, whose first reply row stays stamped.
    const commentLis = article.querySelectorAll('ul > li');
    const parentLi = Array.from(commentLis).find(
      li => li.querySelector(':scope > ul') !== null,
    ) as HTMLElement;
    delete parentLi.dataset.fwCommentSeen;

    // Lazy-load a second reply into the already-walked reply <ul>.
    const replyUl = parentLi.querySelector(':scope > ul')!;
    const newReplyLi = document.createElement('li');
    newReplyLi.innerHTML = `
      <a href="/replier2/"><span>replier2</span></a>
      <span>A second reply lazy-loaded after the first walk</span>
    `;
    replyUl.appendChild(newReplyLi);

    const second = adapter.extractPosts(toNodeList([article]));
    const secondTop = second.find(p => p.kind === 'top-comment');
    const secondReply = second.find(p => p.kind === 'reply');
    expect(secondTop).toBeDefined();
    expect(secondReply).toBeDefined();
    expect(secondReply!.text).toContain('lazy-loaded after the first walk');

    // Pre-fix: the re-walked parent re-minted `ig-cmt-<pid>-0`, and the new
    // reply then minted `ig-cmt-<pid>-0-r0` — the exact id of the FIRST
    // reply, a different comment. Both collisions must be gone.
    expect(secondTop!.id).not.toBe(firstTop!.id);
    expect(secondReply!.id).not.toBe(firstReply!.id);
    // The new reply stays tied to its re-emitted parent.
    expect(secondReply!.parent_id).toBe(secondTop!.id);
  });

  it('Reels dialog: a lazy-loaded row after a reel-container remount never reuses a first-pass id', () => {
    Object.defineProperty(window, 'location', {
      value: {
        hostname: 'www.instagram.com',
        pathname: '/reels/DREELVID123/',
        href: 'https://www.instagram.com/reels/DREELVID123/',
      },
      writable: true,
      configurable: true,
    });

    const main = document.createElement('main');
    document.body.appendChild(main);
    main.appendChild(buildReelContainer());

    // Div-based comment dialog (2026-06 rotation shape): [role="dialog"] >
    // wrapper > list container with ≥5 direct row children, each row carrying
    // a <time>, a profile link, and a leaf span[dir="auto"] body.
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    const wrapper = document.createElement('div');
    dialog.appendChild(wrapper);
    const list = document.createElement('div');
    wrapper.appendChild(list);
    for (let n = 1; n <= 5; n++) {
      list.appendChild(buildReelDialogRow(`viewer${n}`, `Reaction number ${n} under the reel dialog overlay`));
    }
    document.body.appendChild(dialog);

    const first = adapter.extractPosts(document.querySelectorAll('article'));
    const firstIds = first.filter(p => p.kind === 'top-comment').map(p => p.id);
    expect(firstIds).toHaveLength(5);

    // IG's virtualizer remounts the reel container (losing `fwReelProcessed`)
    // while the comment dialog — and the `fwCommentSeen` stamps on its rows —
    // persists. A new row lazy-loads into the same dialog list.
    main.replaceChildren(buildReelContainer());
    list.appendChild(buildReelDialogRow('viewer6', 'Reaction lazy-loaded into the dialog after the remount'));

    const second = adapter.extractPosts(document.querySelectorAll('article'));
    const secondComments = second.filter(p => p.kind === 'top-comment');
    expect(secondComments).toHaveLength(1);
    expect(secondComments[0].text).toContain('lazy-loaded into the dialog');
    // Pre-fix: the walker's per-call index restarted at 0, re-minting
    // `ig-cmt-DREELVID123-0` for a different viewer's comment.
    expect(firstIds).not.toContain(secondComments[0].id);
  });
});
