// FeelingWise — silent folder-wired backup (wiring Q36, layer 2).
//
// The parent names a folder ONCE (a real directory picker, any path on any
// drive), the handle persists in IndexedDB, and from then on backups are
// mirrored into that folder silently: no download, no bubble, nothing a
// child sees or can cancel. This runs only in parent-facing extension pages
// (the dashboard) because the directory picker and write permission live in
// page context; the service worker's Downloads auto-backup (layer 1, made
// quiet via downloadQuietly) remains the always-on baseline.
//
// Permission reality, stated plainly: Chrome remembers the granted
// read/write permission for extension origins, but a browser restart MAY
// drop it back to prompt. getBackupFolderWireStatus surfaces exactly that
// as 'needs-permission', and the Export tab shows a one-click re-allow.
// The picker and the re-allow both REQUIRE a user gesture by browser rule;
// nothing here can (or should) bypass that.
//
// File System Access types are declared minimally below rather than pulling
// lib.dom variants that drift across TS versions.

import { assertExtensionRealm } from '../storage/realm-guard';

interface FsaPermissionHandle {
  queryPermission?: (d: { mode: 'readwrite' }) => Promise<'granted' | 'denied' | 'prompt'>;
  requestPermission?: (d: { mode: 'readwrite' }) => Promise<'granted' | 'denied' | 'prompt'>;
}
interface FsaWritable { write(data: string | Blob): Promise<void>; close(): Promise<void> }
interface FsaFileHandle { createWritable(): Promise<FsaWritable>; getFile(): Promise<{ text(): Promise<string> }> }

/**
 * The two fixed names a wired folder carries beside the dated copies
 * (14 Sep 2026): the newest whole record, always under one name, and the key
 * that opens every automatic copy in the folder. Together they make the
 * folder restore on its own on a fresh install or another computer.
 */
export const LATEST_BACKUP_FILENAME = 'feelingwise-latest.json';
export const RESTORE_KEY_FILENAME = 'feelingwise-restore.key';

/** The key file's text: one JSON object, so a stranger who opens it sees what it is. */
export function restoreKeyFileContents(sealSecret: string): string {
  return JSON.stringify({
    fwRestoreKey: 1,
    note: 'FeelingWise: this key opens the automatic backup copies in this folder. Keep it with them.',
    secret: sealSecret,
  }, null, 2);
}

/** The seal secret inside a key file's text, or null when it is not one. Pure. */
export function parseRestoreKeyFile(text: string): string | null {
  try {
    const obj = JSON.parse(text) as { fwRestoreKey?: unknown; secret?: unknown };
    return obj && obj.fwRestoreKey === 1 && typeof obj.secret === 'string' && obj.secret.length > 0 ? obj.secret : null;
  } catch {
    return null;
  }
}
interface FsaDirectoryHandle extends FsaPermissionHandle {
  name: string;
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<FsaFileHandle>;
  getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<FsaDirectoryHandle>;
}

const DB_NAME = 'feelingwise-backup-folder';
const STORE = 'handles';
const KEY = 'backup-dir';

function openHandleDb(): Promise<IDBDatabase> {
  assertExtensionRealm(DB_NAME);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function readStoredHandle(): Promise<FsaDirectoryHandle | null> {
  try {
    const db = await openHandleDb();
    const handle = await new Promise<unknown>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return (handle as FsaDirectoryHandle) ?? null;
  } catch {
    return null;
  }
}

async function writeStoredHandle(handle: FsaDirectoryHandle | null): Promise<void> {
  const db = await openHandleDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    if (handle === null) tx.objectStore(STORE).delete(KEY);
    else tx.objectStore(STORE).put(handle, KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export type FolderWireStatus =
  | { state: 'unsupported' }
  | { state: 'none' }
  | { state: 'ready'; folderName: string }
  | { state: 'needs-permission'; folderName: string };

function pickerAvailable(): boolean {
  return typeof (globalThis as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function';
}

/** Parent gesture: open the OS directory picker and persist the handle. */
export async function pickBackupFolder(): Promise<FolderWireStatus> {
  if (!pickerAvailable()) return { state: 'unsupported' };
  try {
    const picker = (globalThis as unknown as {
      showDirectoryPicker: (o: { mode: 'readwrite'; id?: string }) => Promise<FsaDirectoryHandle>;
    }).showDirectoryPicker;
    const handle = await picker({ mode: 'readwrite', id: 'fw-backup-folder' });
    await writeStoredHandle(handle);
    return { state: 'ready', folderName: handle.name };
  } catch {
    // Cancelled picker or denied permission — nothing stored, nothing changed.
    return (await getBackupFolderWireStatus());
  }
}

export async function clearBackupFolder(): Promise<void> {
  await writeStoredHandle(null);
}

export async function getBackupFolderWireStatus(): Promise<FolderWireStatus> {
  if (!pickerAvailable() && typeof indexedDB === 'undefined') return { state: 'unsupported' };
  const handle = await readStoredHandle();
  if (!handle) return pickerAvailable() ? { state: 'none' } : { state: 'unsupported' };
  try {
    const perm = await handle.queryPermission?.({ mode: 'readwrite' });
    if (perm === 'granted') return { state: 'ready', folderName: handle.name };
    return { state: 'needs-permission', folderName: handle.name };
  } catch {
    return { state: 'needs-permission', folderName: handle.name };
  }
}

/** Parent gesture: re-request write permission on the stored handle. */
export async function requestBackupFolderPermission(): Promise<boolean> {
  const handle = await readStoredHandle();
  if (!handle?.requestPermission) return false;
  try {
    return (await handle.requestPermission({ mode: 'readwrite' })) === 'granted';
  } catch {
    return false;
  }
}

/**
 * Silent write of one backup payload into the wired folder. Returns a
 * truthful outcome instead of throwing; 'no-permission' and 'no-folder' let
 * the caller fall back to the Downloads path without guessing.
 */
export async function writeBackupToWiredFolder(
  json: string,
  filename: string,
): Promise<{ ok: true } | { ok: false; reason: 'no-folder' | 'no-permission' | 'write-failed' }> {
  const status = await getBackupFolderWireStatus();
  if (status.state === 'none' || status.state === 'unsupported') return { ok: false, reason: 'no-folder' };
  if (status.state === 'needs-permission') return { ok: false, reason: 'no-permission' };
  const handle = await readStoredHandle();
  if (!handle) return { ok: false, reason: 'no-folder' };
  try {
    const file = await handle.getFileHandle(filename, { create: true });
    const writable = await file.createWritable();
    await writable.write(json);
    await writable.close();
    return { ok: true };
  } catch {
    return { ok: false, reason: 'write-failed' };
  }
}

export type FolderRestoreRead =
  | { ok: true; folderName: string; json: string; sealSecret: string | null }
  | { ok: false; reason: 'unsupported' | 'cancelled' | 'no-latest' };

/**
 * Parent gesture: pick a backup folder and read what a restore needs from it
 * (14 Sep 2026): the newest copy under its fixed name and the key file beside
 * it. The picked folder becomes the wired folder, so the copies written from
 * now on land where the record came from. A folder with dated copies but no
 * fixed-name file (written before this date) answers 'no-latest', and the
 * file picker is the way in for those.
 */
export async function pickBackupFolderForRestore(): Promise<FolderRestoreRead> {
  if (!pickerAvailable()) return { ok: false, reason: 'unsupported' };
  let handle: FsaDirectoryHandle;
  try {
    const picker = (globalThis as unknown as {
      showDirectoryPicker: (o: { mode: 'readwrite'; id?: string }) => Promise<FsaDirectoryHandle>;
    }).showDirectoryPicker;
    handle = await picker({ mode: 'readwrite', id: 'fw-backup-folder' });
  } catch {
    return { ok: false, reason: 'cancelled' };
  }
  let json: string;
  try {
    json = await (await (await handle.getFileHandle(LATEST_BACKUP_FILENAME)).getFile()).text();
  } catch {
    return { ok: false, reason: 'no-latest' };
  }
  let sealSecret: string | null = null;
  try {
    sealSecret = parseRestoreKeyFile(await (await (await handle.getFileHandle(RESTORE_KEY_FILENAME)).getFile()).text());
  } catch {
    // No key file: the copy may still open with a recovery passphrase or on the install that wrote it.
  }
  try { await writeStoredHandle(handle); } catch { /* the restore does not depend on the wiring */ }
  return { ok: true, folderName: handle.name, json, sealSecret };
}
