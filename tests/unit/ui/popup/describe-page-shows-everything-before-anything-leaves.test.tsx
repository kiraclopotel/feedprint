/** @vitest-environment jsdom */
//
// "Describe this page" shows everything before anything leaves (11 Oct 2026, the owner released the report button).
//
// The panel asks the page in front for its structure-only report, shows the person a summary and the whole text, and does
// nothing else until they press: Send (Feedprint, at a level that makes outside calls) sends exactly the text they saw, and
// Copy (Off, which has no network, and any level that sends nothing) only puts it on the clipboard. A page that cannot
// answer, a messages page and a foreign site each say so and show no report.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DescribePage, type SendResult } from '../../../../src/ui/popup/DescribePage';
import { I18nProvider } from '../../../../src/i18n/react';
import { POPUP_STRINGS } from '../../../../src/i18n/popup-strings';
import { UI_LANGUAGES } from '../../../../src/i18n';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const t = POPUP_STRINGS.en;
const REPORT = JSON.stringify({ v: 1, product: 'off', site: 'facebook', day: '2026-10-11', page: { t: 'div', c: [{ t: 'div' }, { t: 'span' }] } });

let host: HTMLDivElement;
let root: Root;
let sendMessage: ReturnType<typeof vi.fn>;
let writeText: ReturnType<typeof vi.fn>;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  sendMessage = vi.fn();
  writeText = vi.fn(async () => {});
  vi.stubGlobal('chrome', { tabs: { sendMessage } });
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function show(props: { send?: (text: string) => Promise<SendResult>; noCalls?: boolean; tab?: number | undefined } = {}): Promise<void> {
  await act(async () => {
    root.render(createElement(I18nProvider, { lang: 'en', children: createElement(DescribePage, {
      tabId: async () => ('tab' in props ? props.tab : 7), send: props.send, noCalls: props.noCalls,
    }) }));
  });
}

const button = (label: string): HTMLButtonElement | undefined =>
  Array.from(host.querySelectorAll('button')).find((b) => b.textContent === label);

async function press(label: string): Promise<void> {
  const b = button(label);
  if (!b) throw new Error(`no button "${label}"`);
  await act(async () => { b.click(); });
}

describe('the panel', () => {
  it('asks the page in front, then shows a summary and the whole text, and sends nothing yet', async () => {
    sendMessage.mockResolvedValue({ ok: true, text: REPORT });
    const send = vi.fn(async (): Promise<SendResult> => 'sent');
    await show({ send });
    await press(t.describeStill);
    expect(sendMessage).toHaveBeenCalledWith(7, { type: 'fw-dom-report', problem: 'did-not-hide' });
    expect(host.textContent).toContain(t.describeSummary(3, 'Facebook'));
    expect(JSON.parse(host.querySelector('pre')!.textContent!)).toEqual(JSON.parse(REPORT));
    expect(send).not.toHaveBeenCalled();
    expect(writeText).not.toHaveBeenCalled();
  });

  it('asks with the problem the person picked', async () => {
    sendMessage.mockResolvedValue({ ok: true, text: REPORT });
    await show();
    await press(t.describeMissing);
    expect(sendMessage).toHaveBeenCalledWith(7, { type: 'fw-dom-report', problem: 'hid-too-much' });
  });

  it('sends exactly the text it showed, once, on the press', async () => {
    sendMessage.mockResolvedValue({ ok: true, text: REPORT });
    const send = vi.fn(async (): Promise<SendResult> => 'sent');
    await show({ send });
    await press(t.describeStill);
    await press(t.describeSend);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(REPORT);
    expect(host.textContent).toContain(t.describeSent);
  });

  it('says plainly when the relay is busy or the send failed, and keeps the report to copy', async () => {
    sendMessage.mockResolvedValue({ ok: true, text: REPORT });
    for (const [result, said] of [['slow', t.describeSlow], ['failed', t.describeFailed]] as const) {
      const send = vi.fn(async (): Promise<SendResult> => result);
      await show({ send });
      await press(t.describeStill);
      await press(t.describeSend);
      expect(host.textContent).toContain(said);
      expect(button(t.describeCopy)).toBeDefined();
      await act(async () => root.render(createElement('div')));
    }
  });

  it('with no send there is no Send button: only Copy, which puts the text on the clipboard', async () => {
    sendMessage.mockResolvedValue({ ok: true, text: REPORT });
    await show();
    await press(t.describeStill);
    expect(button(t.describeSend)).toBeUndefined();
    expect(host.textContent).toContain(t.describeCopyNote);
    await press(t.describeCopy);
    expect(writeText).toHaveBeenCalledWith(REPORT);
    expect(host.textContent).toContain(t.describeCopied);
  });

  it('at a level that sends nothing it says so and only copies', async () => {
    sendMessage.mockResolvedValue({ ok: true, text: REPORT });
    await show({ noCalls: true });
    await press(t.describeElse);
    expect(button(t.describeSend)).toBeUndefined();
    expect(host.textContent).toContain(t.describeNoCalls);
  });

  it('says so, and shows no report, when the page cannot answer, is a messages page or is a foreign site', async () => {
    const cases: Array<[() => void, string]> = [
      [() => sendMessage.mockRejectedValue(new Error('Receiving end does not exist.')), t.describeReload],
      [() => sendMessage.mockResolvedValue({ ok: false, reason: 'private-surface' }), t.describePrivate],
      [() => sendMessage.mockResolvedValue({ ok: false, reason: 'not-a-site' }), t.describeNoSite],
      [() => sendMessage.mockResolvedValue({ ok: false, reason: 'not-clean' }), t.describeReload],
      [() => sendMessage.mockResolvedValue(undefined), t.describeReload],
    ];
    for (const [arrange, said] of cases) {
      arrange();
      await show();
      await press(t.describeStill);
      expect(host.textContent).toContain(said);
      expect(host.querySelector('pre')).toBeNull();
      await act(async () => root.render(createElement('div')));
    }
  });

  it('says to open a supported site when there is no tab to ask', async () => {
    await show({ tab: undefined });
    await press(t.describeStill);
    expect(sendMessage).not.toHaveBeenCalled();
    expect(host.textContent).toContain(t.describeNoSite);
  });
});

describe('the words', () => {
  const keys = [
    'describeTitle', 'describeIntro', 'describeStill', 'describeMissing', 'describeElse', 'describeBuilding', 'describeNoSite',
    'describePrivate', 'describeReload', 'describeSee', 'describeSend', 'describeSendNote', 'describeCopy', 'describeCopyNote',
    'describeCopied', 'describeSent', 'describeSlow', 'describeFailed', 'describeNoCalls',
  ] as const;

  it.each(UI_LANGUAGES)('%s has every word, and none is an em dash sentence or a stray placeholder', (lang) => {
    const strings = POPUP_STRINGS[lang] as unknown as Record<string, unknown>;
    for (const key of keys) {
      expect(typeof strings[key], `${lang}.${key}`).toBe('string');
      expect((strings[key] as string).length, `${lang}.${key}`).toBeGreaterThan(2);
      expect(strings[key] as string).not.toContain('—');
    }
    const summary = (POPUP_STRINGS[lang] as unknown as { describeSummary: (n: number, s: string) => string }).describeSummary(12, 'X');
    expect(summary).toContain('12');
    expect(summary).toContain('X');
  });
});
