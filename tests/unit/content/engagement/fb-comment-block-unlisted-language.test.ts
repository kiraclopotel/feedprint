// @vitest-environment jsdom
//
// The comment block switch says "no comments at all". It hid comment threads
// by their aria-label, and the label is localised: the stem list carries eight
// European languages and Facebook is read in about a hundred, so in the rest
// the threads stayed on screen with the switch on.
//
// The switch now also marks every [role="article"] that owns a comment
// permalink (?comment_id=, the same word in every language) and the CSS hides
// what carries the mark. Two sides: the comment must be marked, the post must
// not, and the mark must be gone when the switch goes off.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { adultPreset } from '../../../../src/storage/presets';
import {
  CURRENT_SETTINGS_SCHEMA_VERSION,
  type FWSettings,
  type FeatureToggles,
} from '../../../../src/storage/settings';
import { startFacebookEngagementControl } from '../../../../src/content/engagement/facebook-engagement';

const MARK = 'data-fw-fb-comment';

function makeSettings(posting: boolean): FWSettings {
  const features = adultPreset();
  for (const key of Object.keys(features)) features[key as keyof typeof features].enabled = false;
  features['block-comment-posting'] = { enabled: posting };
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
  };
}

/** A post with one comment under it, the comment labelled in Turkish. */
function buildThread(): { post: HTMLElement; comment: HTMLElement; wrapper: HTMLElement } {
  const post = document.createElement('div');
  post.setAttribute('role', 'article');
  post.innerHTML = `
    <a href="/u/posts/postId001">2 h</a>
    <div dir="auto">A post body, long enough to be real content on the page.</div>
  `;
  // Facebook renders the avatar column and the comment article inside one
  // wrapper; the parent rule is what removes the orphaned avatar column.
  const wrapper = document.createElement('div');
  const comment = document.createElement('div');
  comment.setAttribute('role', 'article');
  comment.setAttribute('aria-label', 'Yorum: Ayşe Demir');
  comment.innerHTML = `
    <a href="/u/posts/postId001?comment_id=17861234&amp;__cft__=abc">2 h</a>
    <div dir="auto">A comment in a language the stem list does not carry.</div>
  `;
  wrapper.appendChild(comment);
  post.appendChild(wrapper);
  document.body.appendChild(post);
  return { post, comment, wrapper };
}

beforeEach(() => {
  vi.useFakeTimers();
  document.body.replaceChildren();
});

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
  document.querySelectorAll('style[id^="fw-facebook"]').forEach(el => el.remove());
});

describe('the comment block switch reaches a comment in an unlisted language', () => {
  it('marks the comment and never the post', () => {
    const { post, comment } = buildThread();

    const stop = startFacebookEngagementControl(makeSettings(true));

    expect(comment.getAttribute(MARK)).toBe('1');
    expect(post.hasAttribute(MARK)).toBe(false);
    stop();
  });

  it('marks a comment that arrives later, on the next pass', () => {
    const { post } = buildThread();
    const stop = startFacebookEngagementControl(makeSettings(true));

    const late = document.createElement('div');
    late.setAttribute('role', 'article');
    late.setAttribute('aria-label', '田中さんのコメント');
    late.innerHTML = '<a href="/u/posts/postId001?comment_id=99">1 m</a><div dir="auto">A later comment.</div>';
    post.appendChild(late);
    vi.advanceTimersByTime(2000);

    expect(late.getAttribute(MARK)).toBe('1');
    stop();
  });

  it('the CSS hides what carries the mark and spares the post that contains it', () => {
    buildThread();
    const stop = startFacebookEngagementControl(makeSettings(true));

    const css = document.getElementById('fw-facebook-comment-block-css')?.textContent ?? '';
    expect(css).toContain(`[${MARK}="1"]`);
    // The parent rule must never be able to name the post article: a comment
    // rendered as a direct child of the post would otherwise take the post
    // down with it.
    expect(css).toContain(`*:not([role="article"]):has(> [${MARK}="1"])`);
    expect(css).not.toContain(`*:has(> [${MARK}="1"])`);
    stop();
  });

  it('leaves the page unmarked when the switch is off, and clears the marks on stop', () => {
    const { comment } = buildThread();

    const stopOff = startFacebookEngagementControl(makeSettings(false));
    expect(comment.hasAttribute(MARK)).toBe(false);
    stopOff();

    const stopOn = startFacebookEngagementControl(makeSettings(true));
    expect(comment.getAttribute(MARK)).toBe('1');
    stopOn();
    expect(comment.hasAttribute(MARK)).toBe(false);
  });
});
