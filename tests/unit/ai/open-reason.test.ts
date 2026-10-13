// The one-line reason behind a yellow dot at Open (src/ai/open-reason.ts). The measured reader answers with labels and no
// prose, so the dot's second state used to show the technique's fixed line on every item; this is the small call that
// says, in a sentence, what the reader's own labels mean for THIS post. Every property below is one the person would
// otherwise find out on their screen: the sentence is checked before it is shown, never quotes the post, never carries a
// swear or a slur, is asked once, and costs nothing when it fails.

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/ai/client', () => ({ callAI: vi.fn(), GROQ_FAST_MODEL: 'openai/gpt-oss-20b' }));
const bump = vi.hoisted(() => vi.fn());
vi.mock('../../../src/diagnostics/diagnostics', () => ({ bumpCounter: bump }));

import { callAI } from '../../../src/ai/client';
import { Err, Ok } from '../../../src/ai/ai-error';
import {
  __resetOpenReasonCacheForTests,
  askOpenReason,
  openReasonSwitch,
  checkOpenReason,
  openReasonSystem,
  openReasonUser,
} from '../../../src/ai/open-reason';

const POST = 'Everyone who believes this is an idiot and should be ashamed of themselves.';
const READING = { family: 'hostile', effect: 'recruit', intent: 'belong' };
const SENTENCE = 'It tries to make you pick a side by shaming anyone who disagrees.';
const mocked = vi.mocked(callAI);

beforeEach(() => {
  mocked.mockReset();
  bump.mockClear();
  __resetOpenReasonCacheForTests();
  openReasonSwitch.on = true;
});

describe('the sentence is off until the pre-registered check passes', () => {
  it('asks nothing and returns null while the switch is off', async () => {
    openReasonSwitch.on = false;
    expect(await askOpenReason({ text: POST, reading: READING, lang: 'en' })).toBeNull();
    expect(mocked).not.toHaveBeenCalled();
  });
});

describe('what the call sends', () => {
  it('asks for one sentence in the interface language, with the labels in plain words and the post fenced', () => {
    const system = openReasonSystem('ro');
    expect(system).toContain('exactly ONE sentence');
    expect(system).toContain('Romanian');
    expect(openReasonSystem('pt-BR')).toContain('Brazilian Portuguese');
    const user = openReasonUser(POST, READING);
    expect(user).toContain('attacks people or a group');
    expect(user).toContain('pulls the reader in');
    expect(user).toContain('make the reader pick a side');
    expect(user).toContain('<user-content>');
    expect(user).not.toMatch(/hostile|recruit|belong|judge/i);
  });

  it('sends at most 1,200 characters of the post', () => {
    const user = openReasonUser('word '.repeat(1000), READING);
    expect(user.length).toBeLessThan(1500);
  });
});

describe('the checks on the sentence', () => {
  it('accepts a plain sentence and cleans fences, quotes and extra lines', () => {
    expect(checkOpenReason(SENTENCE, POST, 'en')).toEqual({ reason: SENTENCE });
    expect(checkOpenReason(`"${SENTENCE}"`, POST, 'en')).toEqual({ reason: SENTENCE });
    expect(checkOpenReason(`\`\`\`\n${SENTENCE}\n\`\`\``, POST, 'en')).toEqual({ reason: SENTENCE });
    expect(checkOpenReason(`${SENTENCE}\nAnother line the model added.`, POST, 'en')).toEqual({ reason: SENTENCE });
  });

  it.each([
    ['too short', 'Pushy.', 'too-short'],
    ['cut off after two words', 'It pulls you', 'too-short'],
    ['too long', `It ${'keeps going and '.repeat(30)}ends.`, 'too-long'],
    ['in another language than the interface', 'Încearcă să te sperie ca să reacționezi înainte să gândești.', 'language'],
    ['quoting the post', 'It says everyone who believes this is an idiot, which pushes you to pick a side.', 'quotes-the-post'],
    ['carrying a swear', 'It is a fucking attempt to make you pick a side.', 'swear-or-slur'],
  ])('refuses a sentence %s', (_name, text, word) => {
    expect(checkOpenReason(text, POST, 'en')).toEqual({ rejected: word });
  });
});

describe('asking', () => {
  it('returns the sentence, counts it, and asks once for the same post', async () => {
    mocked.mockResolvedValue(Ok(SENTENCE));
    const input = { text: POST, reading: READING, lang: 'en' as const };
    expect(await askOpenReason(input)).toBe(SENTENCE);
    expect(await askOpenReason(input)).toBe(SENTENCE);
    expect(mocked).toHaveBeenCalledTimes(1);
    expect(bump).toHaveBeenCalledWith('openReason:landed');
    const [system, user, fast, options] = mocked.mock.calls[0];
    expect(system).toBe(openReasonSystem('en'));
    expect(user).toBe(openReasonUser(POST, READING));
    expect(fast).toBe(true);
    expect(options?.maxTokens).toBe(512);
  });

  it('a failed call is null, counted, and asked again on the next press', async () => {
    mocked.mockResolvedValueOnce(Err({ kind: 'network' } as never));
    mocked.mockResolvedValueOnce(Ok(SENTENCE));
    const input = { text: POST, reading: READING, lang: 'en' as const };
    expect(await askOpenReason(input)).toBeNull();
    expect(bump).toHaveBeenCalledWith('openReason:failed');
    expect(await askOpenReason(input)).toBe(SENTENCE);
    expect(mocked).toHaveBeenCalledTimes(2);
  });

  it('a call that throws is null and never reaches the page as an error', async () => {
    mocked.mockRejectedValue(new Error('boom'));
    expect(await askOpenReason({ text: POST, reading: READING, lang: 'en' })).toBeNull();
    expect(bump).toHaveBeenCalledWith('openReason:failed');
  });

  it('an answer that fails a check is null, counted by its word, and not kept', async () => {
    mocked.mockResolvedValueOnce(Ok('It says everyone who believes this is an idiot and is angry about it.'));
    mocked.mockResolvedValueOnce(Ok(SENTENCE));
    const input = { text: POST, reading: READING, lang: 'en' as const };
    expect(await askOpenReason(input)).toBeNull();
    expect(bump).toHaveBeenCalledWith('openReason:rejected-quotes-the-post');
    expect(await askOpenReason(input)).toBe(SENTENCE);
  });

  it('asks nothing for an empty post', async () => {
    expect(await askOpenReason({ text: '   ', reading: READING, lang: 'en' })).toBeNull();
    expect(mocked).not.toHaveBeenCalled();
  });
});
