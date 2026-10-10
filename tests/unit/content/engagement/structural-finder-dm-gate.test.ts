// @vitest-environment jsdom
//
// META-8 (audit swarm-2026-07-13) — the engagement-metrics-hider's container
// list (`POST_CONTAINER_SELECTORS` in structural-finder.ts) includes bare
// `[role="dialog"]` and `[role="complementary"]`, with zero chat/DM
// exclusion anywhere in the file. `tagEngagementElements` runs its
// getComputedStyle/SVG-path/aria-label walk across whatever matches those
// selectors, including a coexisting Messenger/IG chat-overlay dialog. Not a
// forensic leak (UI-only, writes nothing to the chain), but a privacy-
// hygiene gap: FW should not be scanning the DOM of an open private
// conversation window at all. Locks that a chat-overlay `[role="dialog"]`
// container is excluded from the scan, while a genuine post container
// alongside it is still scanned and tagged normally.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// tagAsEngagement fires a fire-and-forget chrome.storage write on every real
// tag; jsdom has no `chrome` global, so stub it out to keep the test focused
// on the DM-gate behavior instead of an unrelated unhandled rejection.
vi.mock('../../../../src/storage/settings', () => ({
  incrementMetricsHidden: vi.fn(async () => undefined),
}));

import { tagEngagementElements } from '../../../../src/content/engagement/structural-finder';

// FB thumb (like) icon d-path prefix from ICON_DPATH_PREFIXES, paired with
// an aria-label matching the ARIA_STEM_SET 'like' stem — two independent
// tiers (aria + svg) clear the ≥2-tier fusion threshold on their own.
const LIKE_BUTTON_HTML = `
  <button aria-label="Like">
    <svg><path d="M6.235 21H3v-9h3.235V21z"></path></svg>
  </button>
`;

describe('META-8 — structural-finder container scan excludes chat-overlay dialogs', () => {
  beforeEach(() => { document.body.innerHTML = ''; });
  afterEach(() => { document.body.innerHTML = ''; });

  it('does not tag/hide an engagement-shaped button inside a chat-overlay dialog, still tags the genuine post button', () => {
    document.body.innerHTML = `
      <div role="dialog" aria-label="Chat with Example Contact">
        ${LIKE_BUTTON_HTML}
      </div>
      <article>
        ${LIKE_BUTTON_HTML}
      </article>
    `;

    const chatButton = document.querySelector<HTMLElement>('[role="dialog"] button[aria-label="Like"]')!;
    const feedButton = document.querySelector<HTMLElement>('article button[aria-label="Like"]')!;

    tagEngagementElements(document.body);

    expect(feedButton.dataset.fwEngagementBar).toBe('true');
    expect(chatButton.dataset.fwEngagementBar).toBeUndefined();
  });
});
