// "Describe this page": the popup's side of the "this broke" report.
//
// A person who sees a finder miss (something still showing, something gone that should not be) can hand us a picture of how
// the page is built, with none of its words (core/dom-report/). The page builds it on request (content/dom-report/); this
// component is a quiet button on the home that opens its own page, which asks for the report, shows exactly what it
// holds, and either sends it (Feedprint, on a press, at a level that makes outside calls) or only copies it (Off, which
// has no network and never will, and Feedprint at a level that sends nothing). A page of its own, not a fold: the fold
// grew the home past the window and pushed the bottom row out of reach.
//
// The sending function is given in, never imported here: Off's bundle is checked to hold no address of ours, and this file
// is in it.

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { DOM_REPORT_REQUEST, type DomReportAnswer } from '../../core/dom-report/protocol';
import type { ReportProblem } from '../../core/dom-report/report';
import { usePopupT } from '../../i18n/react';
import { ChevronLeft, ChevronRight } from '../shared/icons/lucide';
import { SITE_NAMES } from './report-link';
import type { Platform } from '../../types/post';
import './page-button.css';
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

/** Takes everything the open page covers out of the keyboard's reach: the page's siblings at every level up to the popup's
 *  root, except the header, which stays in view above the page and keeps working. A tab panel that holds the page is a Tab
 *  stop of its own and cannot be inert (the page would go with it), so it is dropped from the order instead. Returns the
 *  way back. */
function holdKeyboard(page: HTMLElement): () => void {
  const root = page.closest('.fw-popup') ?? page.parentElement;
  const inerted: Element[] = [];
  const stops: Array<[Element, string]> = [];
  for (let node: Element | null = page; node && node !== root; node = node.parentElement) {
    for (const sibling of Array.from(node.parentElement?.children ?? [])) {
      if (sibling === node || sibling.matches('.pop-header') || sibling.hasAttribute('inert')) continue;
      sibling.setAttribute('inert', '');
      inerted.push(sibling);
    }
    const stop = node.getAttribute('tabindex');
    if (stop !== null && Number(stop) >= 0) { node.setAttribute('tabindex', '-1'); stops.push([node, stop]); }
  }
  return () => {
    inerted.forEach((n) => n.removeAttribute('inert'));
    stops.forEach(([n, stop]) => n.setAttribute('tabindex', stop));
  };
}

export function DescribePage({ tabId, send, noCalls }: DescribePageProps) {
  const t = usePopupT();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<State>({ s: 'idle' });
  const [said, setSaid] = useState('');
  // A report in flight. The flag is a ref as well as state: two presses in one tick both see the state before it updates.
  const [sending, setSending] = useState(false);
  const sendingNow = useRef(false);
  const opener = useRef<HTMLButtonElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  // The page starts under the brand header, where every other page starts, so the header never blinks away. Measured
  // before paint, and 0 where the popup has no header of that name.
  const [headTop, setHeadTop] = useState(0);
  useLayoutEffect(() => {
    if (!open) return;
    const head = document.querySelector('.pop-header');
    setHeadTop(head ? Math.max(0, Math.round(head.getBoundingClientRect().bottom)) : 0);
  }, [open]);

  // The page takes the keyboard at its way back and gives it back to the button that opened it; Escape is the way back too.
  useEffect(() => {
    if (!open) return;
    backRef.current?.focus();
    // The page is opaque over the whole home, so Tab must not land on controls nobody can see. Given back in the cleanup,
    // which runs on the way back and on any unmount while the page is open.
    const release = pageRef.current ? holdKeyboard(pageRef.current) : () => {};
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    const openedBy = opener.current;
    return () => {
      window.removeEventListener('keydown', onKey);
      release();
      openedBy?.focus();
    };
  }, [open]);

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
      const report = JSON.parse(answer.text) as { site?: string; page?: { c?: unknown[] }; layers?: Array<{ c?: unknown[] }> };
      // The page and the layers over it (a menu, a dialog): the report carries both, and the fold below shows both.
      parts = countParts(report.page) + (Array.isArray(report.layers) ? report.layers.reduce((sum, layer) => sum + countParts(layer), 0) : 0);
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
    if (!send || sendingNow.current) return;
    sendingNow.current = true;
    setSending(true);
    try {
      const result = await send(text);
      setSaid(result === 'sent' ? t.describeSent : result === 'slow' ? t.describeSlow : t.describeFailed);
      if (result === 'sent') setState({ s: 'said', text });
    } finally {
      sendingNow.current = false;
      setSending(false);
    }
  };

  return (
    <>
      <button
        ref={opener}
        type="button"
        className="fw-page-btn quiet describe-open"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <span>{t.describeTitle}</span>
        <ChevronRight size={14} className="fw-page-chev" aria-hidden={true} />
      </button>
      {open && (
        <div
          ref={pageRef}
          className="fw-subpage describe-page"
          role="dialog"
          aria-modal="true"
          aria-label={t.describeTitle}
          style={{ '--fw-subpage-top': `${headTop}px` } as CSSProperties}
        >
          <div className="settings-bar">
            <button ref={backRef} type="button" className="lnk" onClick={() => setOpen(false)}>
              <ChevronLeft size={14} aria-hidden={true} />
              {t.back}
            </button>
            <div className="title">{t.describeTitle}</div>
          </div>
          <div className="fw-subpage-body">
            <p className="describe-help">{t.describeIntro}</p>
            {(state.s === 'idle' || state.s === 'building') && (
              <div className="describe-choices">
                {([['did-not-hide', t.describeStill], ['hid-too-much', t.describeMissing], ['other', t.describeElse]] as const).map(([problem, label]) => (
                  <button key={problem} type="button" className="fw-page-btn row describe-choice" disabled={state.s === 'building'} onClick={() => { void ask(problem); }}>
                    <span>{label}</span>
                    <ChevronRight size={14} className="fw-page-chev" aria-hidden={true} />
                  </button>
                ))}
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
                  {send && <button type="button" className="describe-btn primary" disabled={sending} onClick={() => { void doSend(state.text); }}>{t.describeSend}</button>}
                  <button type="button" className={send ? 'describe-btn' : 'describe-btn primary'} onClick={() => { void doCopy(state.text); }}>{t.describeCopy}</button>
                </div>
              </>
            )}
            {said !== '' && <p className="describe-status" role="status">{said}</p>}
          </div>
        </div>
      )}
    </>
  );
}
