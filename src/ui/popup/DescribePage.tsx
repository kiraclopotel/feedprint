// "Describe this page": the popup's side of the "this broke" report (11 Oct 2026).
//
// A person who sees a finder miss (something still showing, something gone that should not be) can hand us a picture of how
// the page is built, with none of its words (core/dom-report/). The page builds it on request (content/dom-report/); this
// panel asks for it, shows exactly what it holds, and either sends it (Feedprint, on a press, at a level that makes outside
// calls) or only copies it (Off, which has no network and never will, and Feedprint at a level that sends nothing).
//
// The sending function is given in, never imported here: Off's bundle is checked to hold no address of ours, and this file
// is in it.

import { useState } from 'react';
import { DOM_REPORT_REQUEST, type DomReportAnswer } from '../../core/dom-report/protocol';
import type { ReportProblem } from '../../core/dom-report/report';
import { usePopupT } from '../../i18n/react';
import { SITE_NAMES } from './report-link';
import type { Platform } from '../../types/post';
import './describe-page.css';

export type SendResult = 'sent' | 'slow' | 'failed';

export interface DescribePageProps {
  /** The tab in front, or undefined when there is none. */
  tabId: () => Promise<number | undefined>;
  /** Sends the text to us. Absent where nothing may be sent; the panel then only copies. */
  send?: (text: string) => Promise<SendResult>;
  /** Why there is no send: the level makes no outside call. Said once, in the panel's own words. */
  noCalls?: boolean;
}

type State =
  | { s: 'idle' }
  | { s: 'building' }
  | { s: 'ready'; text: string; summary: { parts: number; site: string } }
  | { s: 'said'; text: string };

const ASK_TIMEOUT_MS = 8000;

function countParts(node: { c?: unknown[] } | undefined): number {
  if (!node) return 0;
  return 1 + (node.c ?? []).reduce<number>((sum, child) => sum + countParts(child as { c?: unknown[] }), 0);
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const box = document.createElement('textarea');
      box.value = text;
      box.style.position = 'fixed';
      box.style.opacity = '0';
      document.body.appendChild(box);
      box.select();
      const ok = document.execCommand('copy');
      box.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

export function DescribePage({ tabId, send, noCalls }: DescribePageProps) {
  const t = usePopupT();
  const [state, setState] = useState<State>({ s: 'idle' });
  const [said, setSaid] = useState('');

  const ask = async (problem: ReportProblem): Promise<void> => {
    setSaid('');
    setState({ s: 'building' });
    const id = await tabId();
    if (id === undefined || typeof chrome === 'undefined' || !chrome.tabs?.sendMessage) {
      setSaid(t.describeNoSite);
      setState({ s: 'idle' });
      return;
    }
    let answer: DomReportAnswer | undefined;
    try {
      answer = await Promise.race([
        chrome.tabs.sendMessage(id, { type: DOM_REPORT_REQUEST, problem }) as Promise<DomReportAnswer | undefined>,
        new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), ASK_TIMEOUT_MS)),
      ]);
    } catch {
      answer = undefined;
    }
    if (!answer) { setSaid(t.describeReload); setState({ s: 'idle' }); return; }
    if (!answer.ok) {
      setSaid(answer.reason === 'private-surface' ? t.describePrivate : answer.reason === 'not-a-site' ? t.describeNoSite : t.describeReload);
      setState({ s: 'idle' });
      return;
    }
    let parts = 0;
    let site = '';
    try {
      const report = JSON.parse(answer.text) as { site?: string; page?: { c?: unknown[] } };
      parts = countParts(report.page);
      site = SITE_NAMES[report.site as Platform] ?? '';
    } catch { /* the summary is a courtesy; the text is what matters */ }
    setState({ s: 'ready', text: answer.text, summary: { parts, site } });
  };

  const pretty = (text: string): string => {
    try { return JSON.stringify(JSON.parse(text), null, 1); } catch { return text; }
  };

  const doCopy = async (text: string): Promise<void> => {
    setSaid((await copyText(text)) ? t.describeCopied : t.describeFailed);
  };

  const doSend = async (text: string): Promise<void> => {
    if (!send) return;
    const result = await send(text);
    setSaid(result === 'sent' ? t.describeSent : result === 'slow' ? t.describeSlow : t.describeFailed);
    if (result === 'sent') setState({ s: 'said', text });
  };

  return (
    <details className="describe-fold">
      <summary>{t.describeTitle}</summary>
      <p className="describe-help">{t.describeIntro}</p>
      {(state.s === 'idle' || state.s === 'building') && (
        <div className="describe-choices">
          <button type="button" className="describe-btn" disabled={state.s === 'building'} onClick={() => { void ask('did-not-hide'); }}>{t.describeStill}</button>
          <button type="button" className="describe-btn" disabled={state.s === 'building'} onClick={() => { void ask('hid-too-much'); }}>{t.describeMissing}</button>
          <button type="button" className="describe-btn" disabled={state.s === 'building'} onClick={() => { void ask('other'); }}>{t.describeElse}</button>
        </div>
      )}
      {state.s === 'building' && <p className="describe-status" role="status">{t.describeBuilding}</p>}
      {state.s === 'ready' && (
        <>
          <p className="describe-status">{t.describeSummary(state.summary.parts, state.summary.site)}</p>
          <details>
            <summary>{t.describeSee}</summary>
            <pre>{pretty(state.text)}</pre>
          </details>
          <p className="describe-help">{send ? t.describeSendNote : noCalls ? t.describeNoCalls : t.describeCopyNote}</p>
          <div className="describe-actions">
            {send && <button type="button" className="describe-btn primary" onClick={() => { void doSend(state.text); }}>{t.describeSend}</button>}
            <button type="button" className={send ? 'describe-btn' : 'describe-btn primary'} onClick={() => { void doCopy(state.text); }}>{t.describeCopy}</button>
          </div>
        </>
      )}
      {said !== '' && <p className="describe-status" role="status">{said}</p>}
    </details>
  );
}
