/** @vitest-environment jsdom */
//
// The four filters that still reached a page with no private-surface gate.
//
// An Off scout named five on 2026-09-19, of which the picker was fixed on its
// own (M312). These four were written up as the standing rule applied where it
// was missing, on the expectation that the reach would be theoretical. Running
// each case against the ungated code refuted that. Every one of them takes
// something:
//
//   the sidebar ad remover hides the WHOLE chat log, because the module walk
//     climbs past the message it read the label in until it reaches a stack;
//   the surface switches hide a tray of story replies inside a chat window,
//     since story replies land in the conversation and NEVER stops only the
//     dialog itself, never a region inside one;
//   the TikTok comment block hides a message composer when the person has
//     typed the word "reply" into it, because the typed text is part of the
//     haystack the scan matches on;
//   the Instagram composer sheet reaches a send-message modal and a chat-log
//     textarea, shown here by running the same selector list with the gate
//     stripped off each line.
//
// The first draft of the sidebar case checked the message row and passed
// against the ungated file, because the walk had already climbed past it. A
// case that measures the wrong element reports a gate that is not there.
//
// Each case is two-sided. A filter that stops working in the feed is not a
// fix, so the feed side is asserted first in every pair.

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../../../src/storage/settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/storage/settings')>();
  return { ...actual, incrementMetricsHidden: vi.fn(async () => {}) };
});

import { blockCommentInputCSS } from '../../../../src/content/engagement/instagram-engagement';
import { hideSidebarAds } from '../../../../src/content/engagement/sidebar-ad-blocker';
import { SURFACE_HIDDEN_MARKER, scanSurfaces, surfaceRulesFor } from '../../../../src/content/engagement/surface-switches';
import { blockTikTokCommentPosting } from '../../../../src/content/engagement/tiktok-engagement';
import { adultPreset } from '../../../../src/storage/presets';
import type { FWSettings, FeatureId } from '../../../../src/storage/settings';

function settingsWith(...on: FeatureId[]): FWSettings {
  const features = adultPreset();
  for (const key of Object.keys(features)) features[key as FeatureId].enabled = on.includes(key as FeatureId);
  return { mode: 'adult', features } as unknown as FWSettings;
}

beforeEach(() => { document.body.innerHTML = ''; });

/** The selector list of a one-rule sheet, so a test can ask the DOM about it. */
function hiddenSelector(css: string): string {
  const brace = css.indexOf('{');
  expect(brace, 'the sheet is one rule with one declaration block').toBeGreaterThan(0);
  return css.slice(0, brace).trim();
}

/**
 * The same selector list with the gate taken off each line, which is what the
 * sheet was before today. The "leaves alone" cases below assert against both
 * forms, because the function was not exported before the fix and so cannot be
 * run against the old file the way the other fixes tonight were: this is the
 * same proof by another route, and it fails if the gate ever stops doing work.
 */
function ungated(css: string): string {
  return hiddenSelector(css).replace(/:not\(:is\([^{]*?\)\)/g, '');
}

describe('the last four filters stop at a conversation (2026-09-19)', () => {
  describe('Instagram, the composer sheet', () => {
    const hides = (id: string): boolean =>
      Array.from(document.querySelectorAll<HTMLElement>(hiddenSelector(blockCommentInputCSS())))
        .some((el) => el.id === id);
    /** What the sheet would have taken before the gate was added. */
    const wouldHaveHidden = (id: string): boolean =>
      Array.from(document.querySelectorAll<HTMLElement>(ungated(blockCommentInputCSS())))
        .some((el) => el.id === id);

    it('still hides the comment box under a post, or this is not a fix', () => {
      document.body.innerHTML = '<article><div id="c" contenteditable="true" aria-label="Add a comment..."></div></article>';
      expect(hides('c')).toBe(true);
    });

    it('still hides the post button beside it', () => {
      document.body.innerHTML = '<div id="p" role="button" aria-label="Publicar"></div>';
      expect(hides('p')).toBe(true);
    });

    it('leaves the send-message modal alone', () => {
      // Instagram's own share sheet is a chat dialog on the same page as the
      // feed, and several lines of this sheet match on an aria-label substring
      // with no post around them.
      document.body.innerHTML = `
        <div role="dialog" aria-label="New message">
          <div id="m" role="textbox" aria-label="Write a comment to send"></div>
        </div>`;
      expect(hides('m')).toBe(false);
      expect(wouldHaveHidden('m'), 'and the sheet really did reach it before').toBe(true);
    });

    it('leaves a box inside a chat log alone', () => {
      document.body.innerHTML = '<div role="log"><textarea id="t" aria-label="Comment"></textarea></div>';
      expect(hides('t')).toBe(false);
      expect(wouldHaveHidden('t'), 'and the sheet really did reach it before').toBe(true);
    });
  });

  describe('the sidebar ad remover', () => {
    const hidden = (id: string): boolean =>
      document.getElementById(id)?.style.display === 'none';

    it('still removes a labelled module from the right column', () => {
      document.body.innerHTML = `
        <div id="rail">
          <div id="stack">
            <div id="ad"><h3>Sponsored</h3><div><a href="https://elsewhere.example/x">a thing to buy</a></div></div>
            <div id="contacts"><h3>Contacts</h3><div>Mara</div></div>
          </div>
        </div>`;
      hideSidebarAds(document.getElementById('rail') as HTMLElement);
      expect(hidden('ad'), 'the ad module goes').toBe(true);
      expect(hidden('contacts'), 'and the contacts stay').toBe(false);
    });

    it('takes nothing when the label is inside a conversation', () => {
      // Someone quoting the word in a message, or a platform that renders its
      // dock inside the same column. The label is the only trigger there is,
      // so a label read in a chat is the whole of the exposure.
      //
      // The assertion is over the whole chat subtree, not over the message
      // row. The first draft of this case checked the row alone and passed on
      // the unfixed file, because the module walk climbs past the row and
      // hides the chat log itself: a case that measures the wrong element
      // reports a gate that is not there.
      document.body.innerHTML = `
        <div id="rail">
          <div id="log" role="log">
            <div id="msg"><h3>Sponsored</h3><div><a href="https://elsewhere.example/x">look at this</a></div></div>
          </div>
        </div>`;
      hideSidebarAds(document.getElementById('rail') as HTMLElement);
      const chat = document.getElementById('log') as HTMLElement;
      const touched = [chat, ...Array.from(chat.querySelectorAll<HTMLElement>('*'))]
        .filter((el) => el.style.display === 'none');
      expect(touched.map((el) => el.id), 'nothing in or around a chat log is a sidebar ad').toEqual([]);
    });
  });

  describe('the surface switches', () => {
    const { rules } = surfaceRulesFor('facebook', settingsWith('hide-stories'));
    const taken = (id: string): boolean =>
      document.getElementById(id)?.hasAttribute(SURFACE_HIDDEN_MARKER) === true;

    it('still takes the stories tray above the feed', () => {
      document.body.innerHTML = `
        <div id="tray" role="region" aria-label="Stories">
          <a href="/stories/ann/1">Ann</a><a href="/stories/bo/2">Bo</a>
        </div>`;
      scanSurfaces(document, rules);
      expect(taken('tray')).toBe(true);
    });

    it('leaves a tray of story replies inside a chat window', () => {
      // Story replies land in the conversation, so a chat window really does
      // hold /stories/ links. NEVER stops the dialog itself from being taken
      // and says nothing about a region inside one, which is the same gap the
      // picker had.
      document.body.innerHTML = `
        <div role="dialog" aria-label="Chat with Mara">
          <div id="replies" role="region" aria-label="Stories">
            <a href="/stories/mara/9">Mara</a><a href="/stories/mara/10">Mara</a>
          </div>
        </div>`;
      scanSurfaces(document, rules);
      expect(taken('replies'), 'a conversation is not a surface to switch off').toBe(false);
    });
  });

  describe('the TikTok comment block', () => {
    const blocked = (id: string): boolean =>
      document.getElementById(id)?.dataset.fwPostBlocked === 'true'
      || document.getElementById(id)?.style.display === 'none';

    it('still blocks the comment bar under a video', () => {
      document.body.innerHTML = '<div id="bar"><div id="box" contenteditable="true" data-placeholder="Add comment..."></div></div>';
      blockTikTokCommentPosting();
      expect(blocked('box') || blocked('bar'), 'something was blocked').toBe(true);
    });

    it('leaves a message composer alone even when the typed text says reply', () => {
      // This is the widest scan in that file: every editable on the page, kept
      // or dropped on a word found in a placeholder, an aria-label, or the
      // text the person has typed. What someone writes in a private message is
      // part of that haystack.
      document.body.innerHTML = `
        <div role="log">
          <div id="wrap"><div id="dm" contenteditable="true">reply when you can</div></div>
        </div>`;
      blockTikTokCommentPosting();
      expect(blocked('dm'), 'what someone typed is not a placeholder').toBe(false);
      expect(blocked('wrap'), 'and nothing around it went either').toBe(false);
    });
  });
});
