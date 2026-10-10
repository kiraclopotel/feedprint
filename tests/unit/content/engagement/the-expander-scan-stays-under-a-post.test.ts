/** @vitest-environment jsdom */
//
// The scan that hides "view replies" prompts would hide any short button that
// said "replied", anywhere on the page, including in a private conversation.
//
// `hideExpandRepliesPrompts` is started for the whole document and walks every
// `[role="button"]`. One of its two patterns, REPLY_AUTHOR_PATTERN, is a bare
// `\breplied\b` with no anchor and no context, and a match hides the button's
// PARENT. Facebook writes "Ana replied to your story" on a notification row and
// "Ana replied" in the Messenger dock, and neither of those is a thread
// expander.
//
// So the switch a parent turns on to stop comment threads appearing could take
// a notification row, or a row of somebody's private conversation, with no
// notice and nothing recorded.
//
// Found 2026-09-19, and it is the SECOND filter in this one file found that day
// with no private-surface gate, after the comment-block stylesheet (M286). The
// standing rule is that private surfaces are out of scope for every filter,
// gated by DOM region and never by URL alone.
//
// Two gates, and the cases below hold both: a reply expander always sits under
// the post it belongs to, so the button must be inside a `[role="article"]`;
// and nothing inside a chat log or a chat dialog is touched at all.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { adultPreset } from '../../../../src/storage/presets';
import { CURRENT_SETTINGS_SCHEMA_VERSION, type FWSettings } from '../../../../src/storage/settings';
import { startFacebookEngagementControl } from '../../../../src/content/engagement/facebook-engagement';

function settingsWithCommentBlock(): FWSettings {
  const features = adultPreset();
  for (const key of Object.keys(features)) features[key as keyof typeof features].enabled = false;
  features['block-comment-posting'] = { enabled: true };
  return {
    settingsSchemaVersion: CURRENT_SETTINGS_SCHEMA_VERSION,
    mode: 'adult',
    strictLanguage: false, hideUnrewritable: false, aiAnalysisEnabled: true,
    parentPin: '', dailyCap: 5000, monthlyUsdCapOverride: null, locale: 'en',
    outputLanguage: 'auto', uiLanguage: 'auto',
    totalChecksToday: 0, totalNeutralizedToday: 0, totalTokensToday: 0,
    estimatedCostToday: 0, lastResetDate: '',
    totalChecksThisMonth: 0, totalTokensThisMonth: 0, lastResetMonth: '',
    totalTokensAllTime: 0, totalChecksAllTime: 0,
    totalNeutralizedAllTime: 0, estimatedCostAllTime: 0,
    features,
    presets: { appliedAt: '', appliedPreset: 'adult' },
    dashboardTheme: 'dark',
  } as unknown as FWSettings;
}

/** The button's own wrapper is what the scan hides, so each case reads that. */
function wrapperOf(id: string): HTMLElement {
  return document.getElementById(id)!.parentElement as HTMLElement;
}

const hidden = (id: string): boolean =>
  wrapperOf(id).style.getPropertyValue('display') === 'none';

let stop: (() => void) | null = null;

function run(): void {
  stop = startFacebookEngagementControl(settingsWithCommentBlock());
}

beforeEach(() => {
  vi.useFakeTimers();
  document.body.replaceChildren();
});

afterEach(() => {
  stop?.();
  stop = null;
  vi.useRealTimers();
  document.body.replaceChildren();
  document.querySelectorAll('style[id^="fw-facebook"]').forEach((el) => el.remove());
});

describe('the expander scan stays under a post (2026-09-19)', () => {
  it('still hides a real reply expander under a post', () => {
    // The control, and the reason the scan exists.
    document.body.innerHTML = `
      <div role="article" aria-label="Timeline post by Maria">
        <div dir="auto">a post body long enough to look like a real post</div>
        <div><span role="button" id="expander">View 5 replies</span></div>
      </div>`;
    run();
    expect(hidden('expander'), 'the expander is still hidden').toBe(true);
  });

  it('still hides the "Ana replied" form of the same prompt', () => {
    document.body.innerHTML = `
      <div role="article" aria-label="Timeline post by Maria">
        <div dir="auto">a post body long enough to look like a real post</div>
        <div><span role="button" id="expander">Ana replied</span></div>
      </div>`;
    run();
    expect(hidden('expander')).toBe(true);
  });

  it('leaves a notification row alone, because it is not under a post', () => {
    // "Ana replied to your story" is a notification, not a thread expander, and
    // the bare word match could not tell the difference.
    document.body.innerHTML = `
      <div role="navigation">
        <div><span role="button" id="notif">Ana replied to your story</span></div>
      </div>`;
    run();
    expect(hidden('notif'), 'a notification is not a reply expander').toBe(false);
  });

  it('leaves a chat log alone', () => {
    // role="log" is Messenger's own marker, per adapter.ts. Wrapped in an
    // article on purpose, so the ONLY thing keeping this row on the page is the
    // private gate and not the place gate.
    document.body.innerHTML = `
      <div role="article" aria-label="Timeline post by Maria">
        <div dir="auto">a post body long enough to look like a real post</div>
        <div role="log"><div><span role="button" id="dm">Ana replied</span></div></div>
      </div>`;
    run();
    expect(hidden('dm'), 'a row of a private conversation is not a reply expander').toBe(false);
  });

  it('leaves a chat dialog alone', () => {
    document.body.innerHTML = `
      <div role="article" aria-label="Timeline post by Maria">
        <div dir="auto">a post body long enough to look like a real post</div>
        <div role="dialog" aria-label="Chat with Ana">
          <div><span role="button" id="dock">Ana replied</span></div>
        </div>
      </div>`;
    run();
    expect(hidden('dock')).toBe(false);
  });

  it('does not treat every dialog as private, so a post opened in a modal still works', () => {
    document.body.innerHTML = `
      <div role="dialog" aria-label="Photo">
        <div role="article" aria-label="Timeline post by Maria">
          <div dir="auto">a post body long enough to look like a real post</div>
          <div><span role="button" id="modal">View 5 replies</span></div>
        </div>
      </div>`;
    run();
    expect(hidden('modal'), 'a photo viewer is not a chat').toBe(true);
  });
});
