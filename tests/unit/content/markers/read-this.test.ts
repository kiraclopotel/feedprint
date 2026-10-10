// @vitest-environment jsdom
//
// Adult mode's "read this for me" (content/markers/read-this.ts): the popup arms it,
// the visible tab shows the crosshair, a click on a post or a comment sends
// that item alone through the measured adult judge and renders the answer
// beside it, one line from the record under it, and writes the reading to
// the chain under its own detectionMode. The item is not marked, rewritten or
// hidden; the answer card carries the machine-readable AI mark. A free
// install is told what the reading needs and nothing is sent; Off never
// arms; a non-adult mode ignores the arm.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sent: unknown[] = [];
const forensic: unknown[] = [];
let mode: 'child' | 'teen' | 'adult' = 'adult';
let tier = 'family';
let aiOn = true;
let weekReply: unknown = { ok: true, seen: 9, charged: 6 };

vi.mock('../../../../src/ai/client', () => ({
  callAI: vi.fn(),
  getLastCallMeta: vi.fn(() => ({ model: 'openai/gpt-oss-120b', provider: 'groq' })),
  getLastFailureKind: vi.fn(() => null),
}));
vi.mock('../../../../src/forensics/hasher', () => ({ sha256: vi.fn(async () => 'deadbeef') }));
vi.mock('../../../../src/forensics/neutralizer-diagnostics', () => ({ recordNeutralizerEvent: vi.fn(async () => undefined) }));
vi.mock('../../../../src/storage/feature-flags', () => ({ isFeatureEnabled: vi.fn(async () => false) }));
vi.mock('../../../../src/storage/settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/storage/settings')>();
  return {
    ...actual,
    getSettings: vi.fn(async () => ({ mode, uiLanguage: 'en', aiAnalysisEnabled: aiOn, dailyCap: 2000, features: {} })),
    incrementMetricsHidden: vi.fn(() => Promise.resolve()),
  };
});
vi.mock('../../../../src/storage/license', () => ({
  getLicense: vi.fn(async () => ({ tier, secret: 's' })),
}));
// 2026-09-20: the module gained the adult reader's fixed confidence, which the code
// under test writes onto the record; a stand-in without it made recordReading throw
// and the test saw no record.
vi.mock('../../../../src/core/calibration', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../../../src/core/calibration')>()), getEffectiveThreshold: vi.fn(async () => 0.6) }));
vi.mock('../../../../src/content/post-path/inspection-mode', () => ({ isInspectionTab: () => false }));
vi.mock('../../../../src/storage/context-guard', () => ({
  safeSendMessage: vi.fn((m: unknown) => { sent.push(m); return Promise.resolve(weekReply); }),
  isContextAlive: () => true,
}));
vi.mock('../../../../src/content/record/forensic-retry', () => ({
  sendHighStakesForensicLog: vi.fn(async (m: unknown) => { forensic.push(m); return 'accepted'; }),
}));

import { _setProductForTesting } from '../../../../src/product';
import { callAI } from '../../../../src/ai/client';
import { noteCallProvenance } from '../../../../src/ai/call-provenance';
import { Ok } from '../../../../src/ai/ai-error';
import { JUDGE_V1_ADULT_SYSTEM, JUDGE_V1_MODEL, JUDGE_V1_SCHEMA } from '../../../../src/ai/prompts';
import { MARKER_STRINGS } from '../../../../src/i18n/marker-strings';
import { READ_ARMED_KEY } from '../../../../src/storage/read-arm';
import { boundaryFor } from '../../../../src/content/engagement/picker';
import { answerLines, itemFor, startReadThis, READ_ANSWER_ATTR, READ_DETECTION_MODE } from '../../../../src/content/markers/read-this';
import { AI_MODEL_ATTR, AI_TEXT_ATTR } from '../../../../src/content/markers/ai-mark';
import type { FWSettings } from '../../../../src/storage/settings';

const mockedCallAI = vi.mocked(callAI);
const t = MARKER_STRINGS.en;

type Listener = (c: Record<string, { newValue?: unknown }>) => void;
const listeners = new Set<Listener>();
const g = globalThis as unknown as { chrome?: unknown };
let savedChrome: unknown;

const TWEET = (h: string, text: string) =>
  `<div data-testid="cellInnerDiv"><article data-testid="tweet"><div data-testid="User-Name"><a href="/${h}">${h}</a></div>`
  + `<div data-testid="tweetText">${text}</div><a href="/${h}/status/123">link</a></article></div>`;

// Answers as the real client does: a text reply notes, under the caller's signal, the model and
// provider the proxy named on it.
function reply(v: Record<string, unknown>, answered = { model: JUDGE_V1_MODEL, provider: 'deepinfra' }): void {
  mockedCallAI.mockImplementationOnce(async (_system, _user, _fast, opts) => {
    noteCallProvenance(opts?.signal, answered);
    return Ok(JSON.stringify(v));
  });
}

async function flush(): Promise<void> {
  for (let i = 0; i < 6; i++) await new Promise(r => setTimeout(r, 0));
}

function arm(): void {
  for (const l of listeners) l({ [READ_ARMED_KEY]: { newValue: Date.now() } });
}

/** The newest toast; the arming hint stays on the page for a few seconds. */
function lastToast(): string | undefined {
  const all = document.querySelectorAll('[data-fw-picker-toast]');
  return all[all.length - 1]?.textContent ?? undefined;
}

function clickOn(el: Element): void {
  el.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
}

beforeEach(() => {
  savedChrome = g.chrome;
  g.chrome = {
    storage: {
      onChanged: { addListener: (l: Listener) => listeners.add(l), removeListener: (l: Listener) => listeners.delete(l) },
      local: { remove: vi.fn(async () => {}), set: vi.fn(async () => {}) },
    },
  };
  _setProductForTesting('receipts');
  mode = 'adult'; tier = 'family'; aiOn = true;
  weekReply = { ok: true, seen: 9, charged: 6 };
  sent.length = 0; forensic.length = 0;
  mockedCallAI.mockReset();
  document.body.innerHTML = '';
  document.querySelectorAll('[data-fw-picker-toast]').forEach(e => e.remove());
  Element.prototype.getBoundingClientRect = () => ({ width: 300, height: 120, left: 0, top: 0, right: 300, bottom: 120, x: 0, y: 0, toJSON: () => ({}) });
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
});
afterEach(() => { g.chrome = savedChrome; listeners.clear(); _setProductForTesting(null); });

const settings = { uiLanguage: 'en' } as unknown as FWSettings;

describe('itemFor', () => {
  it('reads a post: its own text, kind post, the author and the status link', () => {
    document.body.innerHTML = TWEET('alice', 'These people never learn, do they. Pathetic, every single one.');
    const b = boundaryFor(document.querySelector('[data-testid="tweetText"]')!, 'twitter')!;
    const item = itemFor(b, 'twitter')!;
    expect(item.kind).toBe('post');
    expect(item.text).toBe('These people never learn, do they. Pathetic, every single one.');
    expect(item.author).toBe('alice');
    expect(item.postUrl).toContain('/alice/status/123');
    expect(item.parentText).toBeUndefined();
  });

  it('reads an Instagram comment as a comment, with the caption as the post it replies to', () => {
    document.body.innerHTML = '<main><article><header><a role="link" href="/poster/">poster</a></header><h1>A long caption about the lake this morning</h1>'
      + '<ul><li><a role="link" href="/bob/">bob</a><span dir="auto">You people are ridiculous and this is why nobody likes you</span></li></ul></article></main>';
    const b = boundaryFor(document.querySelector('li span')!, 'instagram')!;
    const item = itemFor(b, 'instagram')!;
    expect(item.kind).toBe('comment');
    expect(item.text).toContain('You people are ridiculous');
    expect(item.parentText).toBe('A long caption about the lake this morning');
  });

  it('refuses an item with almost no text', () => {
    document.body.innerHTML = TWEET('alice', 'ok');
    const b = boundaryFor(document.querySelector('[data-testid="tweetText"]')!, 'twitter')!;
    expect(itemFor(b, 'twitter')).toBeNull();
  });

  it('refuses a picture-only item instead of reading its byline and counts', () => {
    document.body.innerHTML = '<div data-testid="cellInnerDiv"><article data-testid="tweet"><div data-testid="User-Name"><a href="/alice">Alice Example @alice · 2h</a></div>'
      + '<div data-testid="tweetPhoto"><img alt=""></div><div role="group" aria-label="12 replies, 400 likes">12 400 Show more Translate post</div></article></div>';
    const b = boundaryFor(document.querySelector('[data-testid="tweetPhoto"]')!, 'twitter')!;
    expect(b.kind).toBe('post');
    expect(itemFor(b, 'twitter')).toBeNull();
  });

  it('reads a Facebook comment as a comment whatever language Facebook labels it in, with the post as context', () => {
    document.body.innerHTML = '<div role="article"><div data-ad-rendering-role="story_message">Am pus poza cu lacul de azi dimineață, ce ziceți</div>'
      + '<div role="article" aria-label="Comentariu adăugat de Bob acum 2 ore"><h3><a role="link" href="/bob">Bob</a></h3><div dir="auto">Oamenii ăștia nu învață niciodată, jalnic fiecare dintre ei</div></div></div>';
    const b = boundaryFor(document.querySelector('[aria-label^="Comentariu"] [dir="auto"]')!, 'facebook')!;
    const item = itemFor(b, 'facebook')!;
    expect(item.kind).toBe('comment');
    expect(item.text).toContain('nu învață niciodată');
    expect(item.parentText).toBe('Am pus poza cu lacul de azi dimineață, ce ziceți');
  });

  it('reads a TikTok comment as a comment, with the open video\'s description as context', () => {
    document.body.innerHTML = '<div data-e2e="browse-video-desc">Morning run by the river, day 40 of the challenge</div>'
      + '<div class="comment"><span data-e2e="comment-username-1">bob</span><p data-e2e="comment-level-1">Nobody asked, and nobody cares, stop posting this rubbish</p></div>';
    const b = boundaryFor(document.querySelector('[data-e2e="comment-level-1"]')!, 'tiktok')!;
    const item = itemFor(b, 'tiktok')!;
    expect(item.kind).toBe('comment');
    expect(item.text).toContain('Nobody asked');
    expect(item.parentText).toBe('Morning run by the river, day 40 of the challenge');
  });
});

describe('answerLines', () => {
  it('gives four lines from the five fields when charged, naming the mechanism and never the author', () => {
    const lines = answerLines({ charged: true, family: 'hostile', severity: 5, effect: 'recruit', intent: 'react' }, t);
    expect(lines).toEqual([
      'Charged: yes. Hostile, severity 5.',
      t.readMechanism.hostile,
      `${t.readEffect.recruit} ${t.readIntent.react}`,
      t.readHonest,
    ]);
    expect(lines.join(' ')).not.toMatch(/author|racist|this person/i);
  });

  it('gives one line when nothing is charged', () => {
    expect(answerLines({ charged: false, family: 'none', severity: 0, effect: 'inert', intent: 'none' }, t)).toEqual([t.readNotCharged]);
  });
});

describe('startReadThis', () => {
  it('Off never loads this module at all', async () => {
    // It used to ask isOffProduct() and return early. Off does not import it: the recorder's own
    // content script is the only entry point that does (PLAN-2026-09-16 item 9.2).
    const { readFileSync } = await import('node:fs');
    const { repoPath } = await import('../../../helpers/repo-root');
    expect(readFileSync(repoPath('src', 'content', 'markers', 'read-this.ts'), 'utf8')).not.toContain('isOffProduct');
    expect(readFileSync(repoPath('src', 'products', 'off', 'content.ts'), 'utf8')).not.toContain('read-this');
    expect(readFileSync(repoPath('src', 'content', 'index.ts'), 'utf8')).toMatch(/from '\.\/markers\/read-this'/);
  });

  it('a non-adult mode ignores the arm', async () => {
    mode = 'teen';
    startReadThis('twitter', settings);
    arm();
    await flush();
    expect(document.querySelector('[data-fw-picker-outline]')).toBeNull();
  });

  it('asks the measured judge about the picked item alone, answers beside it, adds the record line, and records the reading', async () => {
    document.body.innerHTML = TWEET('alice', 'These people never learn, do they. Pathetic, every single one.');
    reply({ charged: true, family: 'hostile', severity: 5, effect: 'recruit', intent: 'react' });
    startReadThis('twitter', settings);
    arm();
    await flush();
    expect(document.querySelector('[data-fw-picker-outline]')).not.toBeNull();
    clickOn(document.querySelector('[data-testid="tweetText"]')!);
    await flush();

    // The instrument, unchanged: system prompt, model, schema; the item, its kind and platform.
    expect(mockedCallAI).toHaveBeenCalledTimes(1);
    const [system, user, , opts] = mockedCallAI.mock.calls[0];
    expect(system).toBe(JUDGE_V1_ADULT_SYSTEM);
    expect(user).toContain('Platform: twitter');
    expect(user).toContain('Kind: post');
    expect(user).toContain('These people never learn');
    expect(user).not.toContain('alice');
    expect(opts?.model).toBe(JUDGE_V1_MODEL);
    expect(opts?.jsonSchema).toEqual(JUDGE_V1_SCHEMA);

    // The answer, beside the item, in the marker's flat voice.
    const card = document.querySelector(`[${READ_ANSWER_ATTR}]`)!;
    expect(card).not.toBeNull();
    expect(card.closest('article')).not.toBeNull();
    const lines = Array.from(card.querySelectorAll('p')).map(p => p.textContent);
    expect(lines[0]).toBe('Charged: yes. Hostile, severity 5.');
    expect(lines[3]).toBe(t.readHonest);
    expect(lines[4]).toBe('This account has come up 9 times this week. 6 of those were flagged.');
    // Nothing was hidden or rewritten.
    expect(document.querySelector('[data-testid="tweetText"]')!.textContent).toContain('These people never learn');
    expect(document.querySelector('[data-fw-picked]')).toBeNull();

    // The record asked for the week and the reading was written as a pass
    // record (nothing was acted on) under its own reason, the judge's answer
    // in the technique, the severity and the reason.
    expect(sent).toContainEqual({ type: 'GET_AUTHOR_WEEK', payload: { handle: 'alice', platform: 'twitter' } });
    expect(forensic).toHaveLength(1);
    const m = forensic[0] as { type: string; payload: Record<string, unknown> };
    expect(m.type).toBe('PASS_LOG');
    expect(m.payload.passReason).toBe(`${READ_DETECTION_MODE}:charged:recruit:react`);
    expect(m.payload.kind).toBe('post');
    expect(m.payload.author).toBe('alice');
    expect(m.payload.aiSource).toBe('cloud');
    expect(m.payload.aiModel).toBe(JUDGE_V1_MODEL);
    expect(m.payload.postUrl).toContain('/alice/status/123');
    expect((m.payload.analysis as { techniques: { technique: string; severity: number }[] }).techniques[0]).toMatchObject({ technique: 'anger-trigger', severity: 5 });
  });

  it('the recorded reading names the model and provider the server said answered it, not a constant', async () => {
    document.body.innerHTML = TWEET('alice', 'These people never learn, do they. Pathetic, every single one.');
    // The proxy answers a model it does not allow with its default one, and names its upstream.
    reply({ charged: true, family: 'hostile', severity: 5, effect: 'recruit', intent: 'react' }, { model: 'openai/gpt-oss-20b', provider: 'deepinfra' });
    startReadThis('twitter', settings);
    arm();
    await flush();
    clickOn(document.querySelector('[data-testid="tweetText"]')!);
    await flush();

    expect(forensic).toHaveLength(1);
    const m = forensic[0] as { type: string; payload: Record<string, unknown> };
    expect(m.payload.aiProvider).toBe('deepinfra');
    expect(m.payload.aiModel).toBe('openai/gpt-oss-20b');
  });

  it('the answer card carries the AI mark with the model that answered; the waiting card and the item do not', async () => {
    document.body.innerHTML = TWEET('alice', 'These people never learn, do they. Pathetic, every single one.');
    let markWhileWaiting: string | null | undefined;
    mockedCallAI.mockImplementationOnce(async (_system, _user, _fast, opts) => {
      markWhileWaiting = document.querySelector(`[${READ_ANSWER_ATTR}]`)?.getAttribute(AI_TEXT_ATTR);
      noteCallProvenance(opts?.signal, { model: 'openai/gpt-oss-20b', provider: 'deepinfra' });
      return Ok(JSON.stringify({ charged: true, family: 'hostile', severity: 5, effect: 'recruit', intent: 'react' }));
    });
    startReadThis('twitter', settings);
    arm();
    await flush();
    clickOn(document.querySelector('[data-testid="tweetText"]')!);
    await flush();

    expect(markWhileWaiting).toBeNull();
    const card = document.querySelector(`[${READ_ANSWER_ATTR}]`)!;
    expect(card.getAttribute(AI_TEXT_ATTR)).toBe('reading');
    expect(card.getAttribute(AI_MODEL_ATTR)).toBe('openai/gpt-oss-20b');
    // The item's own words are the author's; the reading only sits beside them.
    expect(document.querySelectorAll(`[${AI_TEXT_ATTR}]`)).toHaveLength(1);
  });

  it('a reading that finds nothing charged is one line and a pass record; no record line when the chain holds nothing', async () => {
    document.body.innerHTML = TWEET('carol', 'Finished the book tonight. Worth every page, honestly.');
    reply({ charged: false, family: 'none', severity: 0, effect: 'nourish', intent: 'inform' });
    weekReply = { ok: true, seen: 0, charged: 0 };
    startReadThis('twitter', settings);
    arm();
    await flush();
    clickOn(document.querySelector('[data-testid="tweetText"]')!);
    await flush();
    const lines = Array.from(document.querySelector(`[${READ_ANSWER_ATTR}]`)!.querySelectorAll('p')).map(p => p.textContent);
    expect(lines).toEqual([t.readNotCharged]);
    const m = forensic[0] as { type: string; payload: Record<string, unknown> };
    expect(m.type).toBe('PASS_LOG');
    expect(m.payload.passReason).toBe(`${READ_DETECTION_MODE}:not-charged`);
  });

  it('a picture-only item is refused on the page and nothing is sent', async () => {
    document.body.innerHTML = '<div data-testid="cellInnerDiv"><article data-testid="tweet"><div data-testid="User-Name"><a href="/alice">Alice Example @alice · 2h</a></div>'
      + '<div data-testid="tweetPhoto"><img alt=""></div><div role="group">12 replies 400 likes Show more</div></article></div>';
    startReadThis('twitter', settings);
    arm();
    await flush();
    clickOn(document.querySelector('[data-testid="tweetPhoto"]')!);
    await flush();
    expect(mockedCallAI).not.toHaveBeenCalled();
    expect(forensic).toHaveLength(0);
    expect(lastToast()).toBe(t.readRefused);
  });

  it('a second window that armed on the same press stands down when the first completes the pick', async () => {
    document.body.innerHTML = TWEET('alice', 'These people never learn, do they. Pathetic, every single one.');
    startReadThis('twitter', settings);
    arm();
    await flush();
    expect(document.querySelector('[data-fw-picker-outline]')).not.toBeNull();
    // The other window's pick removed the key; this window sees it go.
    for (const l of listeners) l({ [READ_ARMED_KEY]: { newValue: undefined } });
    await flush();
    expect(document.querySelector('[data-fw-picker-outline]')).toBeNull();
    clickOn(document.querySelector('[data-testid="tweetText"]')!);
    await flush();
    expect(mockedCallAI).not.toHaveBeenCalled();
  });

  it('a free install is told what the reading needs and nothing is sent', async () => {
    tier = 'free';
    document.body.innerHTML = TWEET('alice', 'These people never learn, do they. Pathetic, every single one.');
    startReadThis('twitter', settings);
    arm();
    await flush();
    clickOn(document.querySelector('[data-testid="tweetText"]')!);
    await flush();
    expect(mockedCallAI).not.toHaveBeenCalled();
    expect(forensic).toHaveLength(0);
    expect(lastToast()).toBe(t.readNeedsKey);
  });

  it('with the master breaker off nothing is sent either', async () => {
    aiOn = false;
    document.body.innerHTML = TWEET('alice', 'These people never learn, do they. Pathetic, every single one.');
    startReadThis('twitter', settings);
    arm();
    await flush();
    clickOn(document.querySelector('[data-testid="tweetText"]')!);
    await flush();
    expect(mockedCallAI).not.toHaveBeenCalled();
    expect(lastToast()).toBe(t.readAiOff);
  });

  it('a click on a box, not a post, is refused with a toast and asks nothing', async () => {
    document.body.innerHTML = '<aside aria-label="Trending"><div id="t"><h2>Trending</h2><ul><li>x</li></ul></div></aside>';
    startReadThis('twitter', settings);
    arm();
    await flush();
    clickOn(document.getElementById('t')!);
    await flush();
    expect(mockedCallAI).not.toHaveBeenCalled();
    expect(lastToast()).toBe(t.readRefused);
  });

  it('a failed call removes the waiting card and says so', async () => {
    document.body.innerHTML = TWEET('alice', 'These people never learn, do they. Pathetic, every single one.');
    mockedCallAI.mockResolvedValueOnce({ ok: false, error: { kind: 'network', message: 'down' } } as never);
    startReadThis('twitter', settings);
    arm();
    await flush();
    clickOn(document.querySelector('[data-testid="tweetText"]')!);
    await flush();
    expect(document.querySelector(`[${READ_ANSWER_ATTR}]`)).toBeNull();
    expect(forensic).toHaveLength(0);
    expect(lastToast()).toBe(t.readFailed);
  });
});
