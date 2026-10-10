// @vitest-environment jsdom
//
// A rewritten post and the emoji stripper must settle, not keep waking each other. The rewrite's
// guard puts the rewrite back whenever the post's text differs from it; the stripper removes emoji
// from any text it has not seen. If the guard's put-back makes new text with an emoji in it, the
// stripper strips it, the guard puts it back, and the page's main thread never rests (a cause that
// fits the owner's report of 26 Sep: X "slowly freezes").

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/storage/settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/storage/settings')>();
  return { ...actual, incrementMetricsHidden: vi.fn(() => Promise.resolve()) };
});

import { startEmojiStripper } from '../../../src/content/engagement/emoji-stripper';
import { injectIntoElement, releaseAllGuards } from '../../../src/content/injector';
import { adultPreset } from '../../../src/storage/presets';
import { CURRENT_SETTINGS_SCHEMA_VERSION, type FWSettings } from '../../../src/storage/settings';
import type { NeutralizedContent } from '../../../src/types/neutralization';
import type { AnalysisResult } from '../../../src/types/analysis';

function settings(): FWSettings {
  const features = adultPreset();
  features['strip-emojis'] = { enabled: true };
  return {
    settingsSchemaVersion: CURRENT_SETTINGS_SCHEMA_VERSION, mode: 'adult', strictLanguage: false,
    hideUnrewritable: false, aiAnalysisEnabled: false, parentPin: '', dailyCap: 0, monthlyUsdCapOverride: null,
    locale: 'en', outputLanguage: 'auto', uiLanguage: 'auto',
    totalChecksToday: 0, totalNeutralizedToday: 0, totalTokensToday: 0, estimatedCostToday: 0, lastResetDate: '',
    totalChecksThisMonth: 0, totalTokensThisMonth: 0, lastResetMonth: '', totalTokensAllTime: 0, totalChecksAllTime: 0,
    totalNeutralizedAllTime: 0, estimatedCostAllTime: 0, features, presets: { appliedAt: '', appliedPreset: 'adult' },
    dashboardTheme: 'dark',
  } as FWSettings;
}

function rewrite(text: string): NeutralizedContent {
  return {
    postId: 'x1', originalHash: 'h', rewrittenText: text, aiSource: 'cloud', processingTimeMs: 1,
    analysis: {
      postId: 'x1', techniques: [], overallScore: 5, overallConfidence: 0.9, isManipulative: true, processingTimeMs: 1,
    } as AnalysisResult,
  };
}

/** An X post body as X draws it: several spans, one with an emoji. */
function tweet(): HTMLElement {
  const article = document.createElement('article');
  const body = document.createElement('div');
  body.setAttribute('data-testid', 'tweetText');
  body.setAttribute('lang', 'en');
  const a = document.createElement('span');
  a.textContent = 'You are all idiots ';
  const b = document.createElement('span');
  b.textContent = 'and you know it 😡';
  body.append(a, b);
  article.appendChild(body);
  document.body.appendChild(article);
  return body;
}

/** Changes past which the two are fighting; the counter then stops both so the test can finish. */
const RUNAWAY = 300;

/** How many times the post's text changes over a number of turns of the event loop. */
async function changesOver(el: HTMLElement, turns: number): Promise<number> {
  let n = 0;
  // A fight runs in microtasks and starves the timers below, so the counter itself ends it.
  const counter = new MutationObserver((records) => {
    n += records.length;
    if (n > RUNAWAY) {
      releaseAllGuards();
      cleanup?.();
      cleanup = null;
      counter.disconnect();
    }
  });
  counter.observe(el, { characterData: true, childList: true, subtree: true });
  for (let i = 0; i < turns; i++) await new Promise((r) => setTimeout(r, 0));
  counter.disconnect();
  return n;
}

let cleanup: (() => void) | null = null;
afterEach(() => { releaseAllGuards(); cleanup?.(); cleanup = null; document.body.innerHTML = ''; });

describe('a rewritten post with emoji stripping on', () => {
  it('settles when the rewrite itself holds an emoji', async () => {
    const body = tweet();
    cleanup = startEmojiStripper('twitter', settings());
    // Counted from before the rewrite: a few changes while the two settle, never a fight.
    const counted = changesOver(body, 45);
    injectIntoElement(body, rewrite('I strongly disagree with you 🙂'), 'adult', false, '');
    expect(await counted).toBeLessThan(20);
  });

  it('settles when the rewrite holds no emoji', async () => {
    const body = tweet();
    cleanup = startEmojiStripper('twitter', settings());
    const counted = changesOver(body, 45);
    injectIntoElement(body, rewrite('I strongly disagree with you'), 'adult', false, '');
    expect(await counted).toBeLessThan(20);
  });
});

describe('a site that keeps writing its own text back', () => {
  it('is not fought forever: the guard stands down after its limit', async () => {
    const body = tweet();
    injectIntoElement(body, rewrite('I strongly disagree with you'), 'adult', false, '');
    // The site answers every put-back by writing its own words again.
    const site = new MutationObserver(() => {
      const first = body.querySelector('span');
      if (first && first.textContent !== 'You are all idiots ') first.textContent = 'You are all idiots ';
    });
    site.observe(body, { characterData: true, childList: true, subtree: true });
    const changes = await changesOver(body, 45);
    site.disconnect();
    expect(changes).toBeLessThan(RUNAWAY);
  });
});
