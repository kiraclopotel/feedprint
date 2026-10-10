// @vitest-environment jsdom
//
// Wiring audit of 13 Sep 2026, batch B, D2-3, D2-4, D2-5, D2-6: every export
// button leaves a receipt, in the card the button sits in; a restore or PIN
// failure lands in the backup card, never under the export buttons; the
// Everything card says what it holds.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

vi.mock('../../../../../src/forensics/backup', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../../src/forensics/backup')>();
  return {
    ...actual,
    getBackupHealth: vi.fn(async () => { throw new Error('no storage in this test'); }),
    mirrorBackupToWiredFolder: vi.fn(async () => 'skipped'),
  };
});
vi.mock('../../../../../src/forensics/backup-folder-wire', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../../src/forensics/backup-folder-wire')>();
  return { ...actual, getBackupFolderWireStatus: vi.fn(async () => ({ state: 'none' as const })) };
});
vi.mock('../../../../../src/forensics/exporter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../../src/forensics/exporter')>();
  return {
    ...actual,
    exportJSON: vi.fn(() => ({ filename: 'feelingwise-records-T.json', bytes: 4321 })),
    exportCSV: vi.fn(() => ({ filename: 'feelingwise-records-T.csv', bytes: 1234 })),
    exportPDF: vi.fn(async () => ({ opened: false as const, records: 3, fallback: { filename: 'feelingwise-verification-3records-T.html', bytes: 999 } })),
  };
});

import { ExportTab } from '../../../../../src/ui/dashboard/components/ExportTab';
import { I18nProvider } from '../../../../../src/i18n/react';
import { DASHBOARD_STRINGS } from '../../../../../src/i18n/dashboard-strings';
import type { RestoreForensicBackupResponse } from '../../../../../src/types/messages';
import type { ForensicRecord } from '../../../../../src/types/forensic';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const t = DASHBOARD_STRINGS.en;
const sendMessage = vi.fn<(msg: unknown) => Promise<RestoreForensicBackupResponse | undefined>>();
let host: HTMLDivElement;
let root: Root;

/**
 * A tab of its own with one flagged record, and the host to clean up after.
 *
 * The three receipt cases below pressed JSON, CSV and PDF on the shared mount,
 * which is `records: []`, so until 2026-09-19 they asserted that a success
 * receipt came back from an export over literally nothing. That is the shape
 * the tab now refuses: with nothing flagged, every export except Everything
 * built an empty file and printed a SHA-256 receipt telling the person to paste
 * the line into the message they send it with. The recommended card had refused
 * it since 2026-09-18 and the other three had not.
 *
 * The subject of those cases is WHERE a receipt appears, not whether an empty
 * export works, so they mount their own tab the way the last case in this file
 * already does. The shared mount stays empty, because three other cases in here
 * are about the nothing-to-carry state itself.
 */
function mountWithAFlaggedRecord(): { host: HTMLDivElement; root: Root } {
  const ownHost = document.createElement('div');
  document.body.appendChild(ownHost);
  const record = {
    id: 'r-1', timestamp: '2026-09-18T12:00:00.000Z', platform: 'twitter',
    originalText: 'a flagged item', originalHash: 'h', originalLength: 14,
    neutralizedText: '', author: 'someone', postUrl: '',
    techniques: [], overallScore: 7,
    userAgeCategory: 'adult', aiSource: 'cloud', feedSource: 'for-you',
    integrityHash: 'ih', chainPosition: 0, kind: 'post', verdict: 'flagged',
  } as never;
  const ownRoot = createRoot(ownHost);
  act(() => {
    ownRoot.render(createElement(I18nProvider, {
      lang: 'en',
      children: createElement(ExportTab, { records: [record], archivedCount: 250 } as never),
    }));
  });
  return { host: ownHost, root: ownRoot };
}

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
    root.render(createElement(I18nProvider, { lang: 'en', children: createElement(ExportTab, { records: [], archivedCount: 250 }) }));
  });
  await settle();
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  host.remove();
  vi.unstubAllGlobals();
});

const card = (dataExport: string): HTMLButtonElement =>
  host.querySelector(`button[data-export="${dataExport}"]`) as HTMLButtonElement;
// The court-ready card is the first .stats-card; the backup card holds the restore input.
const courtCard = (): Element => host.querySelector('.stats-card') as Element;
const backupCard = (): Element => (host.querySelector('input[type="file"][accept*="json"]') as Element).closest('.stats-card') as Element;

describe('D2-5: a receipt per button, in the export card', () => {
  // On their own tab with one flagged record: these three press buttons the
  // shared empty mount no longer lets anyone press. See
  // mountWithAFlaggedRecord above for why that changed.
  let own: { host: HTMLDivElement; root: Root };
  const ownCard = (name: string): HTMLButtonElement =>
    own.host.querySelector(`button[data-export="${name}"]`) as HTMLButtonElement;
  const ownCourtCard = (): Element => own.host.querySelector('.stats-card') as Element;
  const ownBackupCard = (): Element =>
    (own.host.querySelector('input[type="file"][accept*="json"]') as Element).closest('.stats-card') as Element;

  beforeEach(() => { own = mountWithAFlaggedRecord(); });
  afterEach(async () => {
    await act(async () => { own.root.unmount(); });
    own.host.remove();
  });

  it('JSON and CSV print the file name and size where the buttons are', async () => {
    await act(async () => { ownCard('json').click(); });
    await settle();
    expect(ownCourtCard().textContent).toContain(t.exportSavedNote('feelingwise-records-T.json', 4321));
    await act(async () => { ownCard('csv').click(); });
    await settle();
    expect(ownCourtCard().textContent).toContain(t.exportSavedNote('feelingwise-records-T.csv', 1234));
    expect(ownCourtCard().textContent).not.toContain('feelingwise-records-T.json');
    expect(ownBackupCard().textContent).not.toContain('feelingwise-records-T.csv');
  });

  it('a blocked PDF print tab says the report went to Downloads instead', async () => {
    await act(async () => { ownCard('pdf').click(); });
    await settle();
    expect(ownCourtCard().textContent).toContain(t.pdfFallbackNote('feelingwise-verification-3records-T.html', 999));
  });

  it('and none of them can be pressed with nothing flagged', () => {
    // The gate itself, on the shared empty mount. A receipt over an empty
    // selection is the defect these cases used to demonstrate by accident.
    for (const name of ['report', 'pdf', 'json', 'csv']) {
      expect(card(name).disabled, `${name} is off with nothing flagged`).toBe(true);
    }
    expect(card('everything').disabled, 'and Everything is not, because that is when it is wanted').toBe(false);
  });
});

describe('D2-3, D2-4: the backup card keeps its own status and its own errors', () => {
  it('a PIN refusal from a restore renders in the backup card, not under the export buttons', async () => {
    sendMessage.mockResolvedValue({ ok: false, errorKind: 'pin-invalid' } as RestoreForensicBackupResponse);
    const input = host.querySelector('input[type="file"][accept*="json"]') as HTMLInputElement;
    const file = new File(['{"schemaVersion":1,"records":[]}'], 'backup.json', { type: 'application/json' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
    await settle();
    await settle();
    const err = host.querySelector('[data-fw-restore-error="1"]');
    expect(err?.textContent).toBe(t.wrongPin);
    expect(backupCard().contains(err)).toBe(true);
    expect(courtCard().textContent).not.toContain(t.wrongPin);
  });

  it('an export receipt does not touch the restore status slot', async () => {
    const own = mountWithAFlaggedRecord();
    try {
      const json = own.host.querySelector('button[data-export="json"]') as HTMLButtonElement;
      await act(async () => { json.click(); });
      await settle();
      expect(own.host.querySelector('[data-fw-export-receipt="1"]')).not.toBeNull();
      expect(own.host.textContent).not.toContain(t.restoreAnyway);
    } finally {
      await act(async () => { own.root.unmount(); });
      own.host.remove();
    }
  });
});

describe('D2-6: the Everything card says what it holds', () => {
  it('names the active chain and the archived records next to its button', () => {
    expect(card('everything').textContent).toContain(t.everythingIncludes(0, 250));
    expect(courtCard().textContent).toContain(t.exportIncludedScope);
  });
});

describe('the report card describes the file it actually makes', () => {
  // It said "the items flagged in the window chosen above". There is no window
  // control on this tab, and there never was: the export gate takes the whole
  // set the tab is given (applyExportGate(records, { minOverallScore: 0 })).
  // This is the card whose file goes to a lawyer or a researcher, so a sentence
  // implying it covers a chosen period is the worst place to leave one
  // (2026-09-17, seen on the dashboard probe's screenshot of this tab).
  it('promises no window, in any language', () => {
    for (const lang of ['en', 'ro', 'es', 'pt-BR'] as const) {
      const body = DASHBOARD_STRINGS[lang].exportChooseShowBody;
      for (const windowed of [
        'window chosen above', 'intervalul ales mai sus',
        'intervalo elegido arriba', 'período escolhido acima',
      ]) {
        expect(body, `${lang}: ${windowed}`).not.toContain(windowed);
      }
      expect(body.length).toBeGreaterThan(60);
    }
  });

  // This tab is mounted with `records: []`, so the recommended card is in its
  // nothing-to-carry state: the button is off and the body says why. It used to
  // assert the ordinary body here and passed, because until 2026-09-18 the card
  // offered to build an evidence file out of an empty selection and described
  // it as "everything flagged" while doing so.
  it('renders the nothing-to-carry body when no record is flagged', () => {
    const text = card('report').textContent ?? '';
    expect(text).toContain(t.exportNothingFlagged);
    expect(text).not.toContain(t.exportChooseShowBody);
  });

  // The ordinary body, which is what the assertion above used to be reaching
  // for. Rendered on its own tab with one flagged record, so both halves of the
  // card are held rather than only the state this file happens to mount.
  it('renders the ordinary card body once something IS flagged', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const flagged = {
      id: 'x-1', timestamp: '2026-09-18T10:00:00Z', platform: 'facebook',
      originalText: 'a post', originalHash: 'h', originalLength: 6, neutralizedText: '',
      author: '@a', postUrl: 'https://facebook.com/p/1', techniques: [], overallScore: 7,
      userAgeCategory: 'adult', aiSource: 'cloud', feedSource: 'for-you',
      integrityHash: 'h1', signature: 's', publicKeyFingerprint: 'fp',
      chainPosition: 0, kind: 'post', verdict: 'flagged',
    } as never;
    const r = createRoot(host);
    act(() => {
      r.render(createElement(I18nProvider, {
        lang: 'en',
        children: createElement(ExportTab, { records: [flagged], archivedCount: 0 } as never),
      }));
    });
    const text = host.querySelector('[data-export="report"]')?.textContent ?? '';
    expect(text).toContain(t.exportChooseShowBody);
    expect(text).not.toContain(t.exportNothingFlagged);
    act(() => { r.unmount(); });
    host.remove();
  });
});

