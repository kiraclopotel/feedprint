// @vitest-environment jsdom
//
// Behavior locks on the rendered Export tab (src/ui/dashboard/components/
// ExportTab.tsx). Both used to be source-text greps on Dashboard.tsx.
//
// 1. W80: the folder-wire row states the install-locked limit between the
//    body and the picker, so a parent reads it before choosing a folder.
// 2. W81/W82: a typed restore refusal reaches the parent through
//    restore-status-text (their language), not as backup.ts's English error.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

vi.mock('../../../src/forensics/backup', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/forensics/backup')>();
  return {
    ...actual,
    getBackupHealth: vi.fn(async () => { throw new Error('no storage in this test'); }),
    mirrorBackupToWiredFolder: vi.fn(async () => 'skipped'),
  };
});
vi.mock('../../../src/forensics/backup-folder-wire', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/forensics/backup-folder-wire')>();
  return { ...actual, getBackupFolderWireStatus: vi.fn(async () => ({ state: 'none' as const })) };
});

vi.mock('../../../src/forensics/donation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/forensics/donation')>();
  return { ...actual, donateExport: vi.fn(async () => ({ kind: 'failed' as const, status: 503, detail: 'Service Unavailable' })) };
});

import { ExportTab } from '../../../src/ui/dashboard/components/ExportTab';
import { _setDonationRecipientsForTesting, donateExport } from '../../../src/forensics/donation';
import { I18nProvider } from '../../../src/i18n/react';
import { DASHBOARD_STRINGS } from '../../../src/i18n/dashboard-strings';
import { restoreFailureText } from '../../../src/ui/dashboard/restore-status-text';
import type { RestoreForensicBackupResponse } from '../../../src/types/messages';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const sendMessage = vi.fn<(msg: unknown) => Promise<RestoreForensicBackupResponse | undefined>>();
let host: HTMLDivElement;
let root: Root;

const settle = async (): Promise<void> => {
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
};

beforeEach(async () => {
  sendMessage.mockReset();
  vi.stubGlobal('chrome', { runtime: { sendMessage } });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(createElement(I18nProvider, { lang: 'en', children: createElement(ExportTab, { records: [] }) }));
  });
  await settle();
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  host.remove();
  vi.unstubAllGlobals();
});

describe('ExportTab: folder-wire copy (W80)', () => {
  it('renders body, then the install-locked limit, then the picker', () => {
    const t = DASHBOARD_STRINGS.en;
    const text = host.textContent ?? '';
    const body = text.indexOf(t.folderWireBody);
    const limit = text.indexOf(t.folderWireAutomaticLimit);
    const picker = text.indexOf(t.folderWireChoose);
    expect(body).toBeGreaterThan(-1);
    expect(limit).toBeGreaterThan(body);
    expect(picker).toBeGreaterThan(limit);
  });
});

describe('ExportTab: recovery picker takes files or a whole folder (owner, 2026-09-03)', () => {
  it('renders both buttons and a hidden folder input that Chrome reads recursively', () => {
    const t = DASHBOARD_STRINGS.en;
    const labels = Array.from(host.querySelectorAll('button')).map((b) => b.textContent);
    expect(labels).toContain(t.salvageChooseFiles);
    expect(labels).toContain(t.salvageChooseFolder);
    const inputs = Array.from(host.querySelectorAll<HTMLInputElement>('input[type="file"]'));
    const folder = inputs.filter((i) => i.hasAttribute('webkitdirectory'));
    expect(folder).toHaveLength(1);
    expect(folder[0].multiple).toBe(true);
    expect(inputs.length).toBeGreaterThanOrEqual(2);
  });
});

describe('ExportTab: restore refusals are rendered through restore-status-text (W81/W82)', () => {
  it('a typed reason from the SW renders the localized sentence, not the English error', async () => {
    sendMessage.mockResolvedValue({
      ok: true,
      result: {
        ok: false,
        reason: 'passphrase-wrong',
        error: 'english fallback that must not render',
        recordsAdded: 0, recordsSkipped: 0, anchorsAdded: 0, feedbackRestored: 0,
        chainVerified: false, keyRestored: false,
      },
    });
    const input = host.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['{"schemaVersion":1,"records":[]}'], 'backup.json', { type: 'application/json' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
    await settle();
    await settle();

    expect(sendMessage).toHaveBeenCalledTimes(1);
    const msg = sendMessage.mock.calls[0][0] as { type: string; payload: { raw: string; force: boolean } };
    expect(msg.type).toBe('RESTORE_FORENSIC_BACKUP');
    expect(msg.payload.raw).toBe('{"schemaVersion":1,"records":[]}');
    expect(msg.payload.force).toBe(false);

    const expected = restoreFailureText('passphrase-wrong', undefined, 'english fallback that must not render', DASHBOARD_STRINGS.en);
    expect(expected).not.toContain('english fallback');
    const text = host.textContent ?? '';
    expect(text).toContain(expected);
    expect(text).not.toContain('english fallback that must not render');
  });
});

// The backup section read as a book: about 2,200 characters before its first button, and three passphrase boxes that
// read as three secrets. It says three lines above the buttons now, folds the rest, and asks for one passphrase once.
describe('ExportTab: the backup section says three lines, then asks for one passphrase', () => {
  const t = DASHBOARD_STRINGS.en;
  const card = (): Element => host.querySelector('[data-testid="backup-now"]')!.closest('.stats-card')!;
  const beforeButtons = (selector: string): Element[] => {
    const first = host.querySelector('[data-testid="backup-now"]')!;
    return Array.from(card().querySelectorAll(selector))
      .filter((el) => el.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING);
  };

  it('the three lines are what an uninstall takes, the two ways to keep a copy, and which one restores by itself', () => {
    const lead = card().querySelector('.backup-lead')!;
    expect(Array.from(lead.children).map((c) => c.textContent)).toEqual([t.backupLeadLost, t.backupLeadTwoWays, t.backupLeadByItself]);
  });

  it('everything else is under a closed fold named "How this works"', () => {
    const fold = card().querySelector('details.backup-how') as HTMLDetailsElement;
    expect(fold.open).toBe(false);
    expect(fold.querySelector('summary')?.textContent).toBe(t.backupHowTitle);
    for (const said of [t.folderWireBody, t.backupAutomaticLimit, t.recoveryPassIntro, t.passphraseNote, t.backupIntro]) {
      expect(fold.textContent).toContain(said);
    }
  });

  it('one passphrase box above the buttons, named, with why saving needs eight characters', () => {
    const boxes = beforeButtons('input[type="password"]') as HTMLInputElement[];
    expect(boxes).toHaveLength(1);
    expect(boxes[0].closest('label')?.textContent).toContain(t.backupPassLabel);
    expect(card().textContent).toContain(t.backupPassFloor(8));
  });

  it('the daily copies are offered the same passphrase by name', () => {
    expect(card().textContent).toContain(t.recoveryPassTitle);
    expect(Array.from(card().querySelectorAll('input[type="password"]')).map((i) => (i as HTMLInputElement).placeholder))
      .toEqual([t.backupPassPlaceholder, t.recoveryPassPlaceholder]);
  });

  it('the box and both passphrase refusals say the PIN is a different secret, in every language', () => {
    // The setup asks for a four-digit PIN and a restore asks for it too, so a person who types the PIN here would
    // otherwise read only "wrong passphrase" and not know which secret the box wants.
    for (const [lang, table] of Object.entries(DASHBOARD_STRINGS)) {
      for (const text of [table.backupPassLabel, table.restorePassphraseWrong, table.restorePassphraseRequired]) {
        expect(text, lang).toContain('PIN');
      }
      expect(table.restorePassphraseRequired, `${lang}: names the box`).toContain(table.backupPassPlaceholder);
    }
  });

  it('a wrong passphrase reaches the page in those words', async () => {
    sendMessage.mockResolvedValue({
      ok: true,
      result: {
        ok: false, reason: 'passphrase-wrong', error: 'english fallback',
        recordsAdded: 0, recordsSkipped: 0, anchorsAdded: 0, feedbackRestored: 0, chainVerified: false, keyRestored: false,
      },
    });
    const input = host.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['{"fwSealedBackup":1}'], 'backup.json', { type: 'application/json' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
    await settle();
    await settle();
    expect(host.textContent).toContain(t.restorePassphraseWrong);
  });

  it('a restore sends what was typed in that box, however short', async () => {
    sendMessage.mockResolvedValue(undefined);
    const box = beforeButtons('input[type="password"]')[0] as HTMLInputElement;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => { setValue.call(box, '1234'); box.dispatchEvent(new Event('input', { bubbles: true })); });
    const input = host.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['{"schemaVersion":1,"records":[]}'], 'backup.json', { type: 'application/json' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
    await settle();
    const msg = sendMessage.mock.calls[0][0] as { type: string; payload: { passphrase?: string } };
    expect(msg.type).toBe('RESTORE_FORENSIC_BACKUP');
    expect(msg.payload.passphrase).toBe('1234');
  });
});

describe('ExportTab: donation card (docs/history/2026-09/DIRECTION-2026-09-06.md, section 2a)', () => {
  const RECIPIENT = { id: 'org', name: 'Test Organisation', endpoint: 'https://donate.example.org/r', noticeUrl: 'https://example.org/notice' };
  const t = DASHBOARD_STRINGS.en;
  const buttons = (card: Element): HTMLButtonElement[] => Array.from(card.querySelectorAll('button'));

  afterEach(() => { _setDonationRecipientsForTesting(null); });

  it('renders nothing with the shipped, empty roster', () => {
    expect(host.querySelector('[data-testid="donation-card"]')).toBeNull();
    expect(host.textContent).not.toContain('Send this export to');
  });

  it('with a recipient: names them, links their notice, asks twice, and reports the outcome', async () => {
    _setDonationRecipientsForTesting([RECIPIENT]);
    await act(async () => {
      root.render(createElement(I18nProvider, { lang: 'en', children: createElement(ExportTab, { records: [] }) }));
    });
    await settle();
    const card = host.querySelector('[data-testid="donation-card"]');
    expect(card).not.toBeNull();
    expect(card!.textContent).toContain(t.donateTitle(RECIPIENT.name));
    expect(card!.querySelector('a')?.getAttribute('href')).toBe(RECIPIENT.noticeUrl);

    // First press: the confirmation with the count and the name; nothing sent yet.
    await act(async () => { buttons(card!).find((b) => b.textContent === t.donateTitle(RECIPIENT.name))!.click(); });
    expect(card!.textContent).toContain(t.donateConfirm(0, RECIPIENT.name));
    expect(donateExport).not.toHaveBeenCalled();

    // Cancel closes it without a call.
    await act(async () => { buttons(card!).find((b) => b.textContent === t.donateCancel)!.click(); });
    expect(card!.textContent).not.toContain(t.donateConfirm(0, RECIPIENT.name));
    expect(donateExport).not.toHaveBeenCalled();

    // Send calls once; the typed failure reaches the reader in their language.
    await act(async () => { buttons(card!).find((b) => b.textContent === t.donateTitle(RECIPIENT.name))!.click(); });
    await act(async () => { buttons(card!).find((b) => b.textContent === t.donateSend)!.click(); });
    await settle();
    expect(donateExport).toHaveBeenCalledTimes(1);
    expect(card!.textContent).toContain(t.donateFailed('Service Unavailable'));
  });
});
