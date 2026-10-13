import { useEffect, useMemo, useRef, useState } from 'react';
import type { ForensicRecord } from '../../../types/forensic';
import type { RestoreForensicBackupResponse } from '../../../types/messages';
import {
  exportJSON, exportCSV, exportPDF, exportHtml, exportEverythingHtml,
  applyExportGate,
} from '../../../forensics/exporter';
import type { ExportLocale } from '../../../forensics/html-export';
import { clearSigningKeyCache } from '../../../forensics/signing';
import { getProfileName, setProfileName, PROFILE_NAME_MAX } from '../../../forensics/profile';
import { buildBackupBlob, getBackupHealth, assessBackupHealth, recordManualBackupSuccess, recordManualBackupNotSaved, saveManualBackupFile, mirrorBackupToWiredFolder, type BackupAssessment } from '../../../forensics/backup';
import { getBackupFolderWireStatus, pickBackupFolder, pickBackupFolderForRestore, requestBackupFolderPermission, clearBackupFolder, type FolderWireStatus } from '../../../forensics/backup-folder-wire';
import { getSettings } from '../../../storage/settings';
import { sealBackupJson, isSealedBackupEnvelope } from '../../../forensics/backup-envelope';
import { PASSPHRASE_MIN_LENGTH } from '../../../forensics/key-wrap';
import { useDashboardT, useUiLanguage } from '../../../i18n/react';
import { restoreFailureText, restoreKeyNoteText, backupHealthText } from '../restore-status-text';
import { FileText, FileJson, Download } from '../../shared/icons/lucide';
import { importSalvagedRecords, countSalvagedRecords, type SalvageImportResult } from '../../../forensics/salvage-store';
import { publicKeysInFileJson, rememberPublicKeys } from '../../../forensics/known-keys';
import { importIdsDigest } from '../../../forensics/import-marker';
// The popup's audit of 2026-09-18 built this and covered the popup. The four
// buttons on this tab are the most consequential in the product and were left
// on the pre-audit pattern until 2026-09-19.
import { StatusLine } from '../../shared/StatusLine';
import { scrollBehavior } from '../../shared/motion';
import { activeDonationRecipient, donateExport } from '../../../forensics/donation';

/**
 * The largest file the recovery picker will parse in the page. The owner's
 * 169 MB "everything" export needs about a gigabyte to parse and froze the
 * tab; scripts/salvage-gather.ts splits such a file into small per-key files.
 */
/**
 * Register item 15: the chain itself records that recovered records entered,
 * with a digest over exactly which ones. Routed through the SW so the write
 * sits under the shared chain-write lock. A failed marker does not undo the
 * import; it is logged, and the next export shows no IMPORT row for it.
 */
async function writeImportMarker(result: SalvageImportResult): Promise<void> {
  try {
    const idsDigest = await importIdsDigest(result.importedIds);
    const response = await chrome.runtime.sendMessage({
      type: 'IMPORT_MARKER',
      payload: {
        imported: result.imported,
        alreadyPresent: result.alreadyPresent,
        rejected: result.rejectedUnverified,
        epochs: result.epochs,
        idsDigest,
      },
    }) as { ok?: boolean; error?: string } | undefined;
    if (!response?.ok) console.warn('[FeelingWise] Import marker not written:', response?.error ?? 'no response');
  } catch (err) {
    console.warn('[FeelingWise] Import marker not written:', err);
  }
}

const SALVAGE_MAX_BYTES = 64 * 1024 * 1024;
import { setBackupRecoveryPassphrase, clearBackupRecoveryPassphrase, hasBackupRecoveryPassphrase } from '../../../forensics/backup';

// ─── Export tab ───
export function ExportTab({
  records, archivedCount = 0, inBothCount = 0, archivedCountSure = false, onRestored, restoreNotice = null, onDismissRestoreNotice, landOn = null,
  onBackupChanged,
}: {
  /**
   * Where to put the reader when this tab was opened by something else asking
   * them to do one thing (2026-09-19).
   *
   * The attention banner's backup action used to call setTab('export') and stop
   * there, with a button reading "Back up now" that backed nothing up. Found on
   * a live install 2026-09-19, where the press was reported as arriving at the
   * backup page without arriving at the backup. This tab is long, the backup
   * card is most of the way down it, and being dropped at the top of it is
   * being told to go and look.
   *
   * 'backup' scrolls the card that saves a copy into view and focuses the button
   * that does it, so the next keypress is the backup. It does NOT press it: a
   * banner is allowed to take somebody to the thing, not to act for them.
   */
  landOn?: 'backup' | null;
  /** The active chain. The report, PDF, JSON and CSV carry it; the whole record export reads the archives itself. */
  records: ForensicRecord[];
  /** Records held in the month archives, so the Everything card can say what it adds (D2-6). */
  archivedCount?: number;
  /** Of the active chain's records, how many also stand in the archives (a restore after a reset puts them in both); the line counts them once. */
  inBothCount?: number;
  /**
   * True only when `archivedCount` was read, completely, on this load. A count still on its way, or one that failed or
   * missed a month, is not a zero, so it never switches the whole-record export off.
   */
  archivedCountSure?: boolean;
  /**
   * Re-pull dashboard state after a restore replaced the record set, and hand
   * the parent the two counts. The refresh this starts unmounts this tab
   * (Dashboard.tsx:911 renders it only while the first page is loaded), so the
   * sentence that reports the restore cannot live in this component's own
   * state: it was written here and wiped by the refresh a moment later, and
   * the walk found the screen silent after a restore that worked (board line
   * c2, 14 Sep 2026).
   */
  onRestored?: (outcome: { restored: number; replaced: number }) => void;
  /** The confirmation the dashboard is holding for us, or null. */
  restoreNotice?: { restored: number; replaced: number } | null;
  /** Take it off the screen now, rather than waiting out its own timer. */
  onDismissRestoreNotice?: () => void;
  /**
   * A manual backup was written, or was not saved. The "not backed up yet" band above this tab is the dashboard's,
   * so the dashboard reads its bands again; without this it stayed, beside the line saying the copy was made,
   * until a reload (tester, 11 Oct 2026).
   */
  onBackupChanged?: () => void;
}) {
  const t = useDashboardT();
  // Exports speak the interface language: ExportLocale is ResolvedUiLanguage,
  // so every language the interface offers has an export table. Render-side
  // only — the signed payload is untouched.
  const exportLocale: ExportLocale = useUiLanguage();
  const [busy, setBusy] = useState(false);
  // The name the file names its maker by (owner 2026-09-14: an export read as
  // if nobody owned it). Sidecar key, saved on blur or Enter.
  const [profileName, setProfileNameState] = useState('');
  const [profileSavedName, setProfileSavedName] = useState<string | null>(null);
  const [profileMsg, setProfileMsg] = useState('');
  useEffect(() => {
    let alive = true;
    void getProfileName().then(n => { if (alive) { setProfileNameState(n ?? ''); setProfileSavedName(n); } });
    return () => { alive = false; };
  }, []);
  const commitProfileName = async (): Promise<void> => {
    const stored = await setProfileName(profileName);
    if (stored === profileSavedName) return;
    setProfileSavedName(stored);
    setProfileNameState(stored ?? '');
    setProfileMsg(t.profileNameSaved(stored));
  };
  // Two cards, two status slots. Export receipts and export failures render in
  // the court-ready card; restore status and restore or PIN failures in the
  // backup card. One shared slot put a restore error under the export buttons
  // and could leave "Restore anyway" armed under an export receipt (wiring
  // audit 13 Sep, D2-3, D2-4).
  const [error, setError] = useState('');
  const [exportMsg, setExportMsg] = useState('');
  // The whole-record export's current step, shown while it runs (D2-28).
  const [exportStage, setExportStage] = useState('');
  const [restoreError, setRestoreError] = useState('');
  const [restoreMsg, setRestoreMsg] = useState('');
  // How many entries the confirmation pause said the restore would replace.
  // Only a fallback: the finished restore carries the same number back.
  const [replacedCount, setReplacedCount] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  /** The button that saves a backup, so `landOn` can put the reader on it. */
  const backupBtnRef = useRef<HTMLButtonElement>(null);

  // Land where the banner said, once, after the tab has painted. `block:
  // 'center'` rather than the default, because the default puts the card's top
  // edge at the top of the viewport and the sentence explaining the backup sits
  // above it, off screen. Focus follows the scroll so the next keypress is the
  // backup and a keyboard reader is told where it landed; it is deliberately not
  // a click, because a banner takes somebody to the thing rather than acting for
  // them (2026-09-19).
  useEffect(() => {
    if (landOn !== 'backup') return;
    const btn = backupBtnRef.current;
    if (!btn) return;
    const id = window.setTimeout(() => {
      btn.scrollIntoView({ block: 'center', behavior: scrollBehavior() });
      btn.focus({ preventScroll: true });
    }, 60);
    return () => window.clearTimeout(id);
  }, [landOn]);

  // ─── Recovering records from an older export ───
  const [recoveryPass, setRecoveryPass] = useState('');
  const [recoveryActive, setRecoveryActive] = useState(false);
  const [recoveryNote, setRecoveryNote] = useState('');

  useEffect(() => {
    void hasBackupRecoveryPassphrase().then(setRecoveryActive).catch(() => {});
  }, []);

  const salvageRef = useRef<HTMLInputElement>(null);
  const salvageFolderRef = useRef<HTMLInputElement>(null);
  const [salvaging, setSalvaging] = useState(false);
  const [salvageNote, setSalvageNote] = useState('');
  const [salvagedCount, setSalvagedCount] = useState(0);

  useEffect(() => {
    void countSalvagedRecords().then(setSalvagedCount).catch(() => {});
  }, []);

  /**
   * Pull records out of whatever the user picked.
   *
   * Accepts a raw HTML export directly, not just a prepared JSON file: the
   * HTML export embeds its records as plaintext JSON, and those files are what
   * people actually have lying around. Requiring a conversion step first would
   * mean the recovery exists only for someone who can run a script.
   */
  function fileContents(name: string, text: string): { records: ForensicRecord[]; keys: unknown[] } {
    let parsed: unknown;
    if (/\.html?$/i.test(name) || text.startsWith('<!DOCTYPE html')) {
      const marker = 'id="fw-export-data"';
      const at = text.indexOf(marker);
      if (at < 0) throw new Error('this HTML file does not contain an embedded FeelingWise record set');
      const start = text.indexOf('>', at) + 1;
      const end = text.indexOf('</script>', start);
      parsed = JSON.parse(text.slice(start, end));
    } else {
      parsed = JSON.parse(text);
    }
    // The public key of the generation that signed the records travels with
    // them (an export's own key, an epoch file's key, or a keys list); kept
    // so the complete export can verify those signatures (known-keys.ts).
    const keys = publicKeysInFileJson(parsed);
    if (Array.isArray(parsed)) {
      return { records: keys.length > 0 ? [] : (parsed as ForensicRecord[]), keys };
    }
    const records = ((parsed as { records?: ForensicRecord[] }).records ?? []) as ForensicRecord[];
    return { records, keys };
  }

  /**
   * Many files in one pick (owner's live test 2026-09-03: he had selected
   * every export by hand, one at a time). Each file is read and imported on
   * its own, so one unreadable file costs only its own line; the store keys
   * by record id and groups by epoch, so overlapping exports and mixed
   * generations sort themselves out. A sealed .json backup is named as such,
   * with the door that opens it, instead of "contains no records".
   */
  async function onSalvageFile(input: HTMLInputElement): Promise<void> {
    // A folder pick hands over everything under it (subfolders included);
    // only .json and .html can be chain files, the rest is passed over with
    // one count line. A file the page cannot parse (the 169 MB "everything"
    // export) is named with the way round it instead of freezing the tab.
    const picked = Array.from(input.files ?? []);
    input.value = '';
    if (picked.length === 0) return;
    const files = picked.filter(f => /\.(json|html?)$/i.test(f.name));
    const passedOver = picked.length - files.length;
    setSalvaging(true);
    setSalvageNote('');
    const lines: string[] = [];
    let imported = 0;
    let already = 0;
    let rejected = 0;
    try {
      for (const file of files) {
        try {
          if (file.size > SALVAGE_MAX_BYTES) {
            lines.push(t.salvageTooLarge(file.name, Math.round(file.size / 1e6)));
            continue;
          }
          const text = await file.text();
          if (!/\.html?$/i.test(file.name) && !text.startsWith('<!DOCTYPE html')) {
            let parsed: unknown = null;
            try { parsed = JSON.parse(text); } catch { parsed = null; }
            if (isSealedBackupEnvelope(parsed)) {
              lines.push(t.salvageSealedBackup(file.name, parsed.keySource === 'passphrase'));
              continue;
            }
          }
          const { records, keys } = fileContents(file.name, text);
          const keysKept = await rememberPublicKeys(keys);
          if (records.length === 0) {
            lines.push(keysKept > 0 ? t.salvageKeysFile(file.name, keysKept) : t.salvageNoRecords(file.name));
            continue;
          }
          const result = await importSalvagedRecords(records);
          if (result.imported > 0) await writeImportMarker(result);
          imported += result.imported;
          already += result.alreadyPresent;
          rejected += result.rejectedUnverified;
          lines.push(t.salvageFileResult(file.name, result.imported, result.alreadyPresent, result.rejectedUnverified, result.epochs.length)
            + (keysKept > 0 ? ` ${t.salvageKeyKept}` : ''));
        } catch (err) {
          lines.push(t.salvageFileUnreadable(file.name, err instanceof Error ? err.message : String(err)));
        }
      }
      setSalvagedCount(await countSalvagedRecords());
      if (files.length > 1) lines.push(t.salvageTotal(files.length, imported, already, rejected));
      if (passedOver > 0) lines.push(t.salvageSkipped(passedOver));
      setSalvageNote(lines.join('\n'));
    } finally {
      setSalvaging(false);
    }
  }
  const [backupHealth, setBackupHealth] = useState<BackupAssessment | null>(null);
  // Raw health, kept alongside the assessed level: coverage is a fact about
  // WHAT the last copy contained, which the level ('ok' / 'stale' / 'failing')
  // has no way to express. A green "last backed up 2 hours ago" over a copy
  // missing most of the record is the same defect as an export claiming to be
  // complete.
  const [rawHealth, setRawHealth] = useState<Awaited<ReturnType<typeof getBackupHealth>> | null>(null);
  const [healthTick, setHealthTick] = useState(0);
  const [backupPass, setBackupPass] = useState('');
  const [restorePin, setRestorePin] = useState('');
  // The seal secret from a backup folder's key file, held for the restore
  // and its "Restore anyway" confirmation; cleared by a file-picker restore.
  const restoreSealSecretRef = useRef<string | null>(null);
  // Whether a parent PIN exists: the PIN field is shown only then. An adult
  // install and a fresh install have none, and a restore there asks for
  // nothing it cannot have (14 Sep 2026).
  const [pinConfigured, setPinConfigured] = useState(false);
  useEffect(() => {
    getSettings().then((s) => setPinConfigured(Boolean(s.parentPin))).catch(() => setPinConfigured(false));
  }, []);
  const [pendingRestoreText, setPendingRestoreText] = useState<string | null>(null);
  // Q36: silent folder-wired backup. Status drives the row; opening this tab
  // also mirrors the current backup into the wired folder (parent context,
  // no download UI, nothing a child sees).
  const [folderWire, setFolderWire] = useState<FolderWireStatus | null>(null);
  const [folderMsg, setFolderMsg] = useState('');
  const refreshFolderWire = async (mirror: boolean): Promise<void> => {
    // The green "written" line belongs to the mirror that wrote it. A later
    // change, re-grant or failure left it standing beside a status that no
    // longer matched (wiring audit 13 Sep, D2-29); every refresh starts clean.
    setFolderMsg('');
    const status = await getBackupFolderWireStatus();
    setFolderWire(status);
    if (mirror && status.state === 'ready') {
      const r = await mirrorBackupToWiredFolder();
      if (r === 'written') setFolderMsg(t.folderWireWritten);
      // A half-written folder says so rather than saying nothing, which is what
      // it did while the outcome was reported as 'written' (2026-09-19).
      else if (r === 'written-without-latest') setFolderMsg(t.folderWirePartial);
    }
  };

  useEffect(() => {
    let cancelled = false;
    getBackupHealth()
      .then((h) => { if (!cancelled) { setBackupHealth(assessBackupHealth(h, Date.now())); setRawHealth(h); } })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [healthTick]);

  useEffect(() => {
    // Mount-only on purpose: refreshFolderWire is re-run by its own buttons.
    void refreshFolderWire(true).catch(() => {});
  }, []);

  const filter = useMemo(() => applyExportGate(records, {
    minOverallScore: 0,
  }), [records]);
  /**
   * Nothing flagged to carry, so every export on this tab except Everything
   * would build an empty file and print a success receipt over it.
   *
   * Named once since 2026-09-19. The recommended card had this condition
   * inline and the three under "other formats" did not, so the tab refused the
   * export it marks RECOMMENDED and then offered the same empty file three
   * more ways. One name, four buttons reading it.
   */
  const nothingFlagged = filter.included.length === 0;
  /**
   * No record at all, active or archived: the whole-record file would hold 0 records under a signature and open green
   * (the tester's fresh install, 9 Oct 2026: 510,568 bytes, a SHA-256 line to paste, VERIFIED over nothing). That card
   * stays off until there is something to keep, and both cards say so. Only on a sure zero: while the archives are
   * being counted, or when the count failed or missed a month, the card stays on, and the export reads what it can.
   */
  const nothingRecorded = records.length === 0 && archivedCountSure && archivedCount === 0;

  // Donation card: present only when the build names a recipient
  // (forensics/donation.ts; the roster ships empty). Two presses on purpose,
  // the second one worded with the count and the recipient, because this is
  // the one button on the tab after which the file is no longer only here.
  const donationRecipient = activeDonationRecipient();
  const [donateConfirming, setDonateConfirming] = useState(false);
  const [donateMsg, setDonateMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const doDonate = (): void => {
    void (async () => {
      if (!donationRecipient) return;
      setBusy(true); setDonateMsg(null);
      try {
        const outcome = await donateExport(records, filter, exportLocale);
        if (outcome.kind === 'sent') {
          setDonateMsg({ ok: true, text: t.donateSent(outcome.records, donationRecipient.name, outcome.receipt) });
        } else if (outcome.kind === 'refused') {
          setDonateMsg({ ok: false, text: outcome.reason === 'nothing-to-send' ? t.donateNothing : t.donateFailed(outcome.reason) });
        } else {
          setDonateMsg({ ok: false, text: t.donateFailed(outcome.detail) });
        }
      } finally {
        setDonateConfirming(false);
        setBusy(false);
      }
    })();
  };

  const wrap = (fn: () => Promise<void> | void) => (): void => {
    void (async () => {
      setBusy(true); setError(''); setExportMsg('');
      try { await fn(); }
      catch (e) { setError(String((e as Error).message ?? e)); }
      finally { setBusy(false); }
    })();
  };
  const wrapBackup = (fn: () => Promise<void> | void) => (): void => {
    void (async () => {
      setBusy(true); setRestoreError('');
      try { await fn(); }
      catch (e) { setRestoreError(String((e as Error).message ?? e)); }
      finally { setBusy(false); }
    })();
  };

  // Save the full chain to a file the parent controls (survives uninstall).
  const doBackup = wrapBackup(async () => {
    setRestoreMsg('');
    const pass = backupPass.trim() || undefined;
    if (pass !== undefined && pass.length < PASSPHRASE_MIN_LENGTH) throw new Error(t.passphraseTooShort(PASSPHRASE_MIN_LENGTH));
    const backup = await buildBackupBlob(pass);
    // G1 (2026-08-04): with a passphrase set, the WHOLE payload ships sealed
    // (backup-envelope.ts) — not just the signing key — so the child's
    // verbatim feed history doesn't land in Downloads readable. Left empty,
    // the export stays plaintext: the parent's deliberate records-only
    // choice, spelled out by passphraseNote.
    const json = pass
      ? JSON.stringify(await sealBackupJson(JSON.stringify(backup), pass, 'passphrase'), null, 2)
      : JSON.stringify(backup, null, 2);
    // NOT-DISPLAYED: a download FILENAME, not a timestamp on a surface. It
    // stays ISO-in-UTC so backups sort by name in any file manager.
    const filename = `feelingwise-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    // This used to click a hidden anchor and record a success on the next line.
    // A click is a request, not a result: a parent who pressed Escape on the
    // Save-As dialog was recorded as having taken a backup, and the passphrase
    // stamp is a high-water mark that is never cleared, so ONE cancelled dialog
    // suppressed the warning about having no reinstall-proof copy for good.
    // Found 2026-09-19. saveManualBackupFile waits to be told the file is on
    // disk, the way the two other writers in backup.ts already do.
    const wrote = await saveManualBackupFile(json, filename);
    if (wrote !== 'complete') {
      await recordManualBackupNotSaved(wrote);
      setHealthTick((t) => t + 1);
      onBackupChanged?.();
      // Said out loud rather than left as a silent non-event: the parent
      // pressed a button and no file arrived, and the state they are in is
      // exactly the one the banner beside this is about.
      throw new Error(t.backupNotSaved(wrote));
    }
    await recordManualBackupSuccess(backup.records.length, pass !== undefined);
    setHealthTick((t) => t + 1);
    onBackupChanged?.();
  });

  // Restore a backup file: REPLACE semantics, staged + verified before any
  // write. Replacing real entries pauses for confirmation (needsConfirm) and
  // the confirmed path saves a safety backup of them to Downloads first.
  const runRestore = async (text: string, force: boolean) => {
    setBusy(true); setRestoreError(''); setRestoreMsg('');
    try {
      // The SW is the PIN gate (same as the reset modal's F2 note) where a
      // PIN is configured; the digits ride in the payload and are verified
      // against the stored hash there. The seal secret comes from a backup
      // folder's key file when the restore came from a folder (14 Sep 2026).
      const response = await chrome.runtime.sendMessage({
        type: 'RESTORE_FORENSIC_BACKUP',
        payload: {
          raw: text,
          passphrase: backupPass.trim() || undefined,
          force,
          pin: restorePin.trim() || undefined,
          sealSecret: restoreSealSecretRef.current ?? undefined,
        },
      }) as RestoreForensicBackupResponse | undefined;
      if (response?.errorKind === 'pin-required') { setRestoreError(t.restorePinRequired); return; }
      if (response?.errorKind === 'pin-invalid') { setRestoreError(t.wrongPin); return; }
      if (response?.errorKind === 'pin-not-configured') { setRestoreError(t.restorePinNotConfigured); return; }
      if (!response?.ok || !response.result) {
        throw new Error(response?.error ?? 'Backup restore was not acknowledged');
      }
      const result = response.result;
      if (result.needsConfirm) {
        setPendingRestoreText(text);
        if (typeof result.existingRealCount === 'number') setReplacedCount(result.existingRealCount);
        setRestoreMsg(
          typeof result.existingRealCount === 'number'
            ? t.restoreReplaceConfirm(result.existingRealCount)
            : (result.confirmMessage ?? t.restoreNotEmptyFallback),
        );
        return;
      }
      setPendingRestoreText(null);
      if (!result.ok) {
        // W81/W82: every refusal on this path arrives as a typed reason so the
        // parent reads it in their own language; result.error is the English
        // fallback for the causes thrown outside that route.
        setRestoreError(restoreFailureText(result.reason, result.detail, result.error, t));
        return;
      }
      if (result.keyRestored) clearSigningKeyCache();
      const chain = result.chainVerified
        ? t.restoreChainIntact
        : t.restoreChainNote(result.chainError ?? t.restoreChainFallback);
      const keyMsg = result.keyRestored
        ? t.restoreKeyRestored
        : restoreKeyNoteText(result.keyNoteReason, result.keyNote, t);
      setRestoreMsg(
        t.restoredMsg(result.recordsAdded, result.recordsSkipped, result.anchorsAdded, chain, keyMsg, result.recordsAlsoArchived),
      );
      // What it replaced: the count the restore read before it swapped the
      // chain. `replacedCount` is what the confirmation pause named on the
      // first call, for the case where a future result stops carrying it.
      onRestored?.({
        restored: result.recordsAdded,
        replaced: typeof result.existingRealCount === 'number' ? result.existingRealCount : replacedCount,
      });
    } catch (e) {
      setRestoreError(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const onRestoreFile = async (input: HTMLInputElement) => {
    const file = input.files?.[0];
    input.value = ''; // allow re-selecting the same file
    if (!file) return;
    restoreSealSecretRef.current = null;
    await runRestore(await file.text(), false);
  };

  // Restore from a backup folder (14 Sep 2026): one gesture. The folder's
  // newest copy and its key file are read together, so a fresh install or
  // another computer restores without a passphrase; the folder becomes the
  // wired folder so the copies written from now on land where the record
  // came from.
  const onRestoreFolder = async () => {
    setRestoreError(''); setRestoreMsg('');
    const picked = await pickBackupFolderForRestore();
    if (!picked.ok) {
      if (picked.reason === 'no-latest') setRestoreError(t.restoreFolderNoLatest);
      else if (picked.reason === 'unsupported') setRestoreError(t.folderWireStatusUnsupported);
      return;
    }
    restoreSealSecretRef.current = picked.sealSecret;
    await refreshFolderWire(false);
    await runRestore(picked.json, false);
  };

  return (
    <>
      <div className="stats-card full" style={{ marginTop: 16 }}>
        <h3>{t.courtReadyTitle}</h3>
        <div className="export-intro" style={{ marginTop: 4 }}>
          {t.exportIntro}
        </div>

        <div className="export-profile" style={{ marginTop: 14 }}>
          <label htmlFor="fw-profile-name" style={{ display: 'block', fontSize: 13, fontWeight: 600 }}>{t.profileNameLabel}</label>
          <input
            id="fw-profile-name"
            data-fw-profile-name="1"
            type="text"
            maxLength={PROFILE_NAME_MAX}
            value={profileName}
            placeholder={t.profileNamePlaceholder}
            autoComplete="off"
            className="dash-input"
            style={{ marginTop: 6, width: '100%', maxWidth: 360 }}
            onChange={e => { setProfileNameState(e.target.value); setProfileMsg(''); }}
            onBlur={() => { void commitProfileName(); }}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void commitProfileName(); } }}
          />
          {/* A button, because there was none (2026-09-19). The field committed
              on blur and on Enter, which both work and neither of which a
              person can see. Found on a live install 2026-09-19: a name typed,
              Enter pressed because nothing else was on offer, and no way to
              tell it had taken. Blur and Enter still commit, so nobody who learned the
              old way loses it. Disabled while the field matches what is stored,
              which makes the button say the state as well as offer the act. */}
          <button
            type="button"
            className="btn"
            data-testid="profile-name-save"
            style={{ marginTop: 8 }}
            disabled={profileName.trim() === (profileSavedName ?? '')}
            onClick={() => { void commitProfileName(); }}
          >
            {t.profileNameSave}
          </button>
          <div className="export-note" style={{ fontSize: 12, color: 'var(--fw-muted)', marginTop: 6, lineHeight: 1.5 }}>{t.profileNameHint}</div>
          {profileMsg && <div data-fw-profile-receipt="1" style={{ fontSize: 12, color: 'var(--fw-green)', marginTop: 6 }}>{profileMsg}</div>}
        </div>

        {error && <StatusLine tone="alert" className="export-note" style={{ fontSize: 12, color: 'var(--fw-red)', marginTop: 12, overflowWrap: 'anywhere' }}>{error}</StatusLine>}
        {busy && exportStage && <div data-fw-export-stage="1" role="status" aria-live="polite" style={{ fontSize: 12, color: 'var(--fw-muted)', marginTop: 12 }}>{exportStage}</div>}
        {exportMsg && <StatusLine data-fw-export-receipt="1" style={{ fontSize: 12, color: 'var(--fw-green)', marginTop: 12, lineHeight: 1.5 }}>{exportMsg}</StatusLine>}

        {/* One question, two answers, the rest folded (owner 2026-09-06: six
            formats of the same size and no way to tell which to send). */}
        <div className="export-choose">
          <div className="export-choose-q">{t.exportChooseTitle}</div>
          <div className="export-grid two">
            <button
              type="button"
              className="export-card primary"
              data-export="report"
              // Off when there is nothing flagged to carry. This card is the one
              // the tab marks RECOMMENDED, and with an empty selection it built
              // the HTML, downloaded it, and printed a SHA-256 receipt telling
              // the person to paste that line into the message they send the
              // file with. A fresh install, a just-rotated month, or a record of
              // nothing but passes and advertisements all reach it. The banner
              // on the other tab already answers this exact question the right
              // way: an enabled button there "would produce a green check or an
              // empty file over a record that may be intact" (2026-09-18).
              disabled={busy || nothingFlagged}
              onClick={wrap(async () => {
                const r = await exportHtml(records, filter, exportLocale);
                setExportMsg(t.exportReceipt(r.filename, r.bytes, r.sha256));
              })}
            >
              <div className="export-card-head">
                <div className="export-card-icon"><FileText size={20} /></div>
                {!(busy || nothingFlagged) && <span className="export-card-pill recommended">{t.pillRecommended}</span>}
              </div>
              <h4>{t.exportChooseShow}</h4>
              {/* A disabled button with no reason beside it is a worse card than
                  an enabled one that does the wrong thing: the person is left
                  guessing what they did wrong. Say the reason where they are
                  looking, and point at the file that is not empty. */}
              <p>{nothingRecorded ? t.exportNothingRecorded : filter.included.length === 0 ? t.exportNothingFlagged : t.exportChooseShowBody}</p>
            </button>

            {/* Q35: every archived month plus the active chain, one file. */}
            <button type="button" className="export-card" data-export="everything" disabled={busy || nothingRecorded} onClick={wrap(async () => {
              const r = await exportEverythingHtml(records, exportLocale, undefined, (stage, n) => setExportStage(t.everythingStage(stage, n)))
                .finally(() => setExportStage(''));
              setExportMsg(`${t.everythingExportDone(r.archivedMonths, r.totalRecords)} ${t.exportReceipt(r.receipt.filename, r.receipt.bytes, r.receipt.sha256)}`);
            })}>
              <div className="export-card-head">
                <div className="export-card-icon"><Download size={20} /></div>
              </div>
              <h4>{t.exportChooseAll}</h4>
              <p>{nothingRecorded ? t.exportNothingRecorded : t.exportChooseAllBody}</p>
              {/* What this file holds, next to the button, so the report's
                  included-of-total line below is not read as describing this
                  one too (D2-6). */}
              <p data-fw-everything-includes="1">{t.everythingIncludes(records.length, archivedCount, inBothCount)}</p>
            </button>
          </div>
          <p className="export-partial-note">{t.exportPartialNote}</p>
          <details className="export-other">
            <summary>{t.exportOtherFormats}</summary>
            {/* The same gate the recommended card above has carried since
                2026-09-18, and the reason is the same one written there: with
                nothing flagged these three built a file, downloaded it, and
                printed a success receipt over an empty selection. A fresh
                install, a just-rotated month, or a record of nothing but passes
                and advertisements all reach it, and the person is left holding
                a file they were told was their evidence.

                Only these three. The Everything card below exports the whole
                record and is right to stay enabled when nothing is flagged,
                because that is precisely when a person wants it (2026-09-19). */}
            {nothingFlagged && <p className="export-partial-note">{nothingRecorded ? t.exportNothingRecorded : t.exportNothingFlagged}</p>}
            <div className="export-grid">
              <button type="button" className="export-card" data-export="pdf" disabled={busy || nothingFlagged} onClick={wrap(async () => {
                const r = await exportPDF(records, exportLocale, filter);
                setExportMsg(r.opened ? t.pdfOpenedNote(r.records) : t.pdfFallbackNote(r.fallback.filename, r.fallback.bytes));
              })}>
                <div className="export-card-head"><div className="export-card-icon"><FileText size={20} /></div></div>
                <h4>PDF</h4>
                <p>{t.pdfCardBody}</p>
              </button>

              <button type="button" className="export-card" data-export="json" disabled={busy || nothingFlagged} onClick={wrap(() => {
                const r = exportJSON(records, filter);
                setExportMsg(t.exportSavedNote(r.filename, r.bytes));
              })}>
                <div className="export-card-head"><div className="export-card-icon"><FileJson size={20} /></div></div>
                <h4>JSON</h4>
                <p>{t.jsonCardBody}</p>
              </button>

              <button type="button" className="export-card" data-export="csv" disabled={busy || nothingFlagged} onClick={wrap(() => {
                const r = exportCSV(records, filter);
                setExportMsg(t.exportSavedNote(r.filename, r.bytes));
              })}>
                <div className="export-card-head"><div className="export-card-icon"><FileText size={20} /></div></div>
                <h4>CSV</h4>
                <p>{t.csvCardBody}</p>
              </button>
            </div>
          </details>
        </div>

        {/* Describes the report, PDF, JSON and CSV (the gated exports); the
            whole record file carries every record and says so on its own
            card (D2-6). The current-chain-only HTML card was removed 14 Sep
            2026: it was a strict subset of the whole record and read as a
            third answer to a two-answer question. */}
        <div className="export-note" style={{ marginTop: 16, fontSize: 12, color: 'var(--fw-muted)', lineHeight: 1.5 }}>
          {t.exportIncludedScope} {t.exportIncluded(filter.included.length, filter.totalSource)}
          {filter.excludedNonDetection > 0 && t.exportExcluded(filter.excludedNonDetection)}
        </div>
      </div>

      {donationRecipient && (
        <div className="stats-card full" style={{ marginTop: 16 }} data-testid="donation-card">
          <h3>{t.donateTitle(donationRecipient.name)}</h3>
          <div className="export-intro" style={{ marginTop: 4 }}>
            {t.donateBody(donationRecipient.name)}{' '}
            <a href={donationRecipient.noticeUrl} target="_blank" rel="noopener noreferrer">{t.donateNotice}</a>
          </div>
          {!donateConfirming && (
            <div style={{ marginTop: 12 }}>
              <button type="button" className="btn" disabled={busy} onClick={() => { setDonateMsg(null); setDonateConfirming(true); }}>
                {t.donateTitle(donationRecipient.name)}
              </button>
            </div>
          )}
          {donateConfirming && (
            <div className="export-note" style={{ fontSize: 12, marginTop: 12, lineHeight: 1.5 }}>
              {t.donateConfirm(filter.included.length, donationRecipient.name)}
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button type="button" className="btn" disabled={busy} onClick={doDonate}>{t.donateSend}</button>
                <button type="button" className="btn" disabled={busy} onClick={() => setDonateConfirming(false)}>{t.donateCancel}</button>
              </div>
            </div>
          )}
          {donateMsg && (
            <StatusLine tone={donateMsg.ok ? 'status' : 'alert'} className="export-note" style={{ fontSize: 12, marginTop: 12, lineHeight: 1.5, overflowWrap: 'anywhere', color: donateMsg.ok ? 'var(--fw-green)' : 'var(--fw-red)' }}>
              {donateMsg.text}
            </StatusLine>
          )}
        </div>
      )}

      <div className="stats-card full" style={{ marginTop: 16 }}>
        <h3>{t.backupRestoreTitle}</h3>
        {/* Three lines above the buttons: what an uninstall takes, the two ways to keep a copy, and which one restores by
            itself. Everything else that was here, about 2,200 characters before the first button, is under the fold,
            in the order a reader asks: what each copy is, what the passphrase does, what a restore does. */}
        <div className="export-intro backup-lead" style={{ marginTop: 4 }}>
          <div>{t.backupLeadLost}</div>
          <div>{t.backupLeadTwoWays}</div>
          <div>{t.backupLeadByItself}</div>
        </div>
        <details className="export-other backup-how">
          <summary>{t.backupHowTitle}</summary>
          <div className="export-note" style={{ fontSize: 12, color: 'var(--fw-muted)', marginTop: 8, lineHeight: 1.5 }}>{t.folderWireBody}</div>
          {/* The automatic copy is sealed under a per-install secret (backup.ts G1 fork), so it does not survive an
              uninstall unless the recovery wrap below rides in it. */}
          <div className="export-note" style={{ fontSize: 12, color: 'var(--fw-muted)', marginTop: 8, lineHeight: 1.5 }}>{t.backupAutomaticLimit}</div>
          <div className="export-note" style={{ fontSize: 12, color: 'var(--fw-muted)', marginTop: 8, lineHeight: 1.5 }}>{t.recoveryPassIntro}</div>
          <div className="export-note" style={{ fontSize: 12, color: 'var(--fw-muted)', marginTop: 8, lineHeight: 1.5 }}>{t.passphraseNote}</div>
          <div className="export-note" style={{ fontSize: 12, color: 'var(--fw-muted)', marginTop: 8, lineHeight: 1.5 }}>{t.backupIntro}</div>
        </details>

        {/* Above the three cards, not below them: the box changes what the buttons underneath do. It seals the file
            "Back up now" saves and opens the file a restore loads, and after the buttons it was met only by somebody who
            had already pressed one. One box for the one passphrase: a box to save, a box to restore and a third for the
            daily copies read as three different secrets. */}
        <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
          <label style={{ display: 'grid', gap: 4, fontSize: 12, fontWeight: 600 }}>
            {t.backupPassLabel}
            <input
              type="password"
              value={backupPass}
              onChange={(e) => setBackupPass(e.currentTarget.value)}
              placeholder={t.backupPassPlaceholder}
              data-testid="backup-passphrase"
              className="dash-input"
              style={{ fontWeight: 400 }}
            />
          </label>
          <div className="export-note" style={{ fontSize: 12, color: 'var(--fw-muted)', lineHeight: 1.5 }}>
            {t.backupPassFloor(PASSPHRASE_MIN_LENGTH)}
          </div>
          {pinConfigured && <input
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={4}
            value={restorePin}
            onChange={(e) => setRestorePin(e.currentTarget.value.replace(/\D/g, ''))}
            placeholder={t.restorePinPlaceholder}
            className="dash-input"
          />}
        </div>

        <div className="export-grid">
          <button
            type="button"
            className="export-card"
            disabled={busy}
            onClick={doBackup}
            ref={backupBtnRef}
            data-testid="backup-now"
          >
            <div className="export-card-head"><div className="export-card-icon"><Download size={20} /></div></div>
            <h4>{t.backupNowTitle}</h4>
            <p>{t.backupNowBody}</p>
          </button>

          <button type="button" className="export-card" disabled={busy} data-testid="restore-from-folder" onClick={() => { void onRestoreFolder(); }}>
            <div className="export-card-head"><div className="export-card-icon"><Download size={20} /></div></div>
            <h4>{t.restoreFolderTitle}</h4>
            <p>{t.restoreFolderBody}</p>
          </button>

          <button type="button" className="export-card" disabled={busy} onClick={() => fileRef.current?.click()}>
            <div className="export-card-head"><div className="export-card-icon"><FileJson size={20} /></div></div>
            <h4>{t.restoreTitle}</h4>
            <p>{t.restoreBody}</p>
          </button>
        </div>

        {restoreError && <div role="alert" data-fw-restore-error="1" style={{ fontSize: 12, color: 'var(--fw-red)', marginTop: 12, overflowWrap: 'anywhere' }}>{restoreError}</div>}
        {/* The restore's own confirmation. It is held by the dashboard, not by
            this component, so it survives the refresh the restore starts; it
            renders inside this card because this is where the parent just
            clicked. It leaves on the dismiss button or on the dashboard's ten
            second timer, whichever comes first. */}
        {restoreNotice && (
          <div
            role="status"
            data-fw-restore-done="1"
            style={{ fontSize: 12, color: 'var(--fw-green)', marginTop: 12, lineHeight: 1.5 }}
          >
            {t.restoreDoneNotice(restoreNotice.restored, restoreNotice.replaced)}
            {onDismissRestoreNotice && (
              <div style={{ marginTop: 8 }}>
                <button type="button" className="btn ghost" onClick={onDismissRestoreNotice}>{t.restoreDoneDismiss}</button>
              </div>
            )}
          </div>
        )}
        {restoreMsg && (
          <StatusLine className="export-note" style={{ fontSize: 12, color: pendingRestoreText ? 'var(--fw-amber)' : 'var(--fw-green)', marginTop: 12, lineHeight: 1.5 }}>
            {restoreMsg}
            {pendingRestoreText && (
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button type="button" className="btn" style={{ color: 'var(--fw-amber)' }} disabled={busy}
                  onClick={() => { void runRestore(pendingRestoreText, true); }}>{t.restoreAnyway}</button>
                <button type="button" className="btn ghost" disabled={busy}
                  onClick={() => { setPendingRestoreText(null); setRestoreMsg(''); }}>{t.cancel}</button>
              </div>
            )}
          </StatusLine>
        )}

        {backupHealth && (
          <div style={{
            fontSize: 12, marginTop: 12,
            color: backupHealth.level === 'ok' ? 'var(--fw-green)'
              : backupHealth.level === 'failing' ? 'var(--fw-red)'
              : 'var(--fw-amber)',
          }}>
            {backupHealthText(backupHealth, t)}
          </div>
        )}

        {/* Anything short of 'full' with records left out, not one named
            value. `trimBackupToFit` halves the record count when the copy is
            over the transport ceiling and marks it 'recent-records-only', a
            third value this condition did not match, so the one case where the
            automatic copy silently dropped half the chain was the one case the
            warning never printed. backup.ts counts the trimmed records into
            lastUncoveredArchived and says in a comment that doing so "keeps the
            Export tab's warning honest in both cases"; it did not, because the
            gate here asked for the other case by name (2026-09-19). */}
        {rawHealth?.lastAutoCoverage !== 'full' && (rawHealth?.lastUncoveredArchived ?? 0) > 0 && (
          <div className="export-note" style={{ fontSize: 12, marginTop: 8, color: 'var(--fw-amber)', lineHeight: 1.5 }}>
            {t.backupCoveragePartial(rawHealth?.lastUncoveredArchived ?? 0)}{' '}
            {t.backupCoverageFix}
          </div>
        )}

        {/* The fixed-name "latest" copy is a convenience, and its whole value
            is that its NAME answers which backup is newest. Until 2026-09-19
            its write outcome was discarded, so it could be days old with
            everything here green. Said in the amber the other partial states
            use, not the red: the dated copy for the same run is on disk and
            confirmed, and a sentence that reads as a lost backup would be
            worse than the silence it replaces. */}
        {rawHealth?.lastLatestCopy !== undefined && rawHealth.lastLatestCopy !== 'complete' && (
          <div className="export-note" style={{ fontSize: 12, marginTop: 8, color: 'var(--fw-amber)', lineHeight: 1.5 }}>
            {t.backupLatestCopyStale}
          </div>
        )}

        {/* Q36: silent folder-wired backup row. */}
        <div style={{ marginTop: 16, padding: '12px 14px', border: '1px solid var(--fw-border, #333)', borderRadius: 'var(--fw-radius-lg)' }}>
          <div style={{ fontWeight: 600, fontSize: 13 }}>{t.folderWireTitle}</div>
          {/* W80/W81 (2026-08-18): mirrorBackupToWiredFolder seals every folder
              file with the per-install device key (backup.ts:653-654), exactly
              like the automatic Downloads copy — which is why the body above
              names the folder copy as that same automatic copy, and why the
              install-locked limit is stated beside the picker, in W78's words,
              before the parent chooses. */}
          <div className="export-note" style={{ fontSize: 12, color: 'var(--fw-muted)', marginTop: 6, lineHeight: 1.5 }}>{t.folderWireAutomaticLimit}</div>
          <div className="export-note" style={{ fontSize: 12, marginTop: 8 }}>
            {folderWire === null ? '' :
              folderWire.state === 'ready' ? t.folderWireStatusReady(folderWire.folderName)
              : folderWire.state === 'needs-permission' ? t.folderWireStatusNeedsPerm(folderWire.folderName)
              : folderWire.state === 'unsupported' ? t.folderWireStatusUnsupported
              : t.folderWireStatusNone}
            {folderMsg && <StatusLine as="span" style={{ color: 'var(--fw-green)' }}> {folderMsg}</StatusLine>}
          </div>
          {folderWire !== null && folderWire.state !== 'unsupported' && (
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button type="button" className="btn" disabled={busy}
                onClick={() => { void (async () => { await pickBackupFolder(); await refreshFolderWire(true); })(); }}>
                {folderWire.state === 'none' ? t.folderWireChoose : t.folderWireChange}
              </button>
              {folderWire.state === 'needs-permission' && (
                <button type="button" className="btn" disabled={busy}
                  onClick={() => { void (async () => { await requestBackupFolderPermission(); await refreshFolderWire(true); })(); }}>
                  {t.folderWireAllow}
                </button>
              )}
              {folderWire.state !== 'none' && (
                <button type="button" className="btn ghost" disabled={busy}
                  onClick={() => { void (async () => { await clearBackupFolder(); setFolderMsg(''); await refreshFolderWire(false); })(); }}>
                  {t.folderWireOff}
                </button>
              )}
            </div>
          )}
        </div>


        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          style={{ display: 'none' }}
          onChange={(e) => { void onRestoreFile(e.currentTarget); }}
        />

        {/* The automatic backup is sealed under a per-install device secret, so
            it cannot be opened after a reinstall — the disaster it exists for.
            An escrow copy of that secret, wrapped under a passphrase the parent
            chooses, rides inside each file and gives it a second door. */}
        <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--fw-border)' }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>{t.recoveryPassTitle}</div>
          {recoveryActive && (
            <div className="export-note" style={{ fontSize: 12, color: 'var(--fw-green)', marginBottom: 8 }}>{t.recoveryPassActive}</div>
          )}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              type="password"
              className="dash-input"
              placeholder={t.recoveryPassPlaceholder}
              style={{ flex: '1 1 20rem', minWidth: 0 }}
              value={recoveryPass}
              onChange={(e) => setRecoveryPass(e.currentTarget.value)}
            />
            <button
              className="btn"
              disabled={recoveryPass.length < PASSPHRASE_MIN_LENGTH}
              onClick={() => {
                void setBackupRecoveryPassphrase(recoveryPass)
                  .then(() => { setRecoveryActive(true); setRecoveryPass(''); setRecoveryNote(t.recoveryPassSaved); })
                  .catch((err: unknown) => setRecoveryNote(err instanceof Error ? err.message : String(err)));
              }}
            >
              {t.recoveryPassSet}
            </button>
            {recoveryActive && (
              <button
                className="btn"
                onClick={() => {
                  void clearBackupRecoveryPassphrase()
                    .then(() => { setRecoveryActive(false); setRecoveryNote(''); })
                    .catch(() => {});
                }}
              >
                {t.recoveryPassRemove}
              </button>
            )}
          </div>
          {recoveryNote && (
            <div className="export-note" style={{ fontSize: 12, marginTop: 8, color: 'var(--fw-muted)' }}>{recoveryNote}</div>
          )}
        </div>

        {/* Recover records the app no longer holds.

            Unlike restore, this ADDS and never replaces: salvaged records are
            stored as a prior generation in their own database, so importing
            cannot touch the live chain. Every record is re-hashed on the way
            in and rejected if it does not match, because these files have been
            sitting outside the app's control. */}
        <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--fw-border)' }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>{t.recoverTitle}</div>
          <div className="export-note" style={{ fontSize: 12, color: 'var(--fw-muted)', lineHeight: 1.5, marginBottom: 8 }}>
            {t.recoverBody}
            {salvagedCount > 0 && ` ${t.recoverHeld(salvagedCount)}`}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn" onClick={() => salvageRef.current?.click()} disabled={salvaging}>
              {salvaging ? t.salvageChecking : t.salvageChooseFiles}
            </button>
            <button className="btn" onClick={() => salvageFolderRef.current?.click()} disabled={salvaging}>
              {salvaging ? t.salvageChecking : t.salvageChooseFolder}
            </button>
          </div>
          {salvageNote && (
            <div className="export-note" style={{ fontSize: 12, marginTop: 8, color: 'var(--fw-muted)', whiteSpace: 'pre-line' }}>{salvageNote}</div>
          )}
          <input
            ref={salvageRef}
            type="file"
            multiple
            accept="application/json,.json,text/html,.html"
            data-picker="salvage"
            style={{ display: 'none' }}
            onChange={(e) => { void onSalvageFile(e.currentTarget); }}
          />
          {/* A whole folder, subfolders included (picking files one by
              one misses some). webkitdirectory is what Chrome offers for
              this; it is not in React's typings, hence the spread. */}
          <input
            ref={salvageFolderRef}
            type="file"
            multiple
            style={{ display: 'none' }}
            {...({ webkitdirectory: '' } as Record<string, string>)}
            onChange={(e) => { void onSalvageFile(e.currentTarget); }}
          />
        </div>
      </div>
    </>
  );
}
