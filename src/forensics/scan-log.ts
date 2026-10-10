// FeelingWise - Lightweight scan event log
// Records every post processed by the pipeline (pass, neutralize, or flag).
// This is the DENOMINATOR for all dashboard metrics — without it, we only see
// the numerator (neutralized posts) and can't compute real rates.
//
// Stored in a separate IndexedDB database to keep forensic records (heavy,
// append-only, integrity-hashed) separate from scan events (lightweight,
// purgeable, no hashing needed).

import { assertExtensionRealm } from '../storage/realm-guard';
import type { ScanEvent } from '../types/scan-event';

const DB_NAME = 'feelingwise-scans';
const DB_VERSION = 1;
const STORE_NAME = 'events';


function openDB(): Promise<IDBDatabase> {
  assertExtensionRealm(DB_NAME);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { autoIncrement: true });
        store.createIndex('timestamp', 'timestamp', { unique: false });
        store.createIndex('platform', 'platform', { unique: false });
        store.createIndex('author', 'author', { unique: false });
        store.createIndex('action', 'action', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Full-state reset support. Wipes all scan-log
 * events. Called by `resetForensicChain` so the dashboard's operational-events
 * panel (which reads scan-log via `getScanEvents`/scan-activity.ts) drops
 * to zero alongside the Chain A wipe. The popup does not read this log, and
 * it is not the count of what was read: it holds only items the pipeline
 * finished, and no comment. That count is `readToday` in storage/settings.ts. A failure rejects, so the reset can
 * tell the parent this part was not cleared; the reset settles each clear on
 * its own.
 */
export async function clearScanLog(): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).clear();
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
      // A commit that fails after the clear succeeded fires only abort; without this the reset never settles.
      tx.onabort = () => { db.close(); reject(tx.error ?? new Error('scan log clear aborted')); };
    });
  } catch (err) {
    console.warn('[FeelingWise] Scan log clear failed:', err);
    throw err;
  }
}

export async function logScanEvent(event: ScanEvent): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).add(event);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
      // A commit that fails after the add succeeded fires only abort; without this the write never settles.
      tx.onabort = () => { db.close(); reject(tx.error ?? new Error('scan log write aborted')); };
    });
  } catch (err) {
    // Non-critical: scan logging failure should never block the pipeline
    console.warn('[FeelingWise] Scan log write failed:', err);
  }
}

export async function getScanEvents(since?: string): Promise<ScanEvent[]> {
  try {
    const db = await openDB();
    const events: ScanEvent[] = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const request = tx.objectStore(STORE_NAME).getAll();
      request.onsuccess = () => { db.close(); resolve(request.result); };
      request.onerror = () => { db.close(); reject(request.error); };
    });
    if (!since) return events;
    return events.filter(e => e.timestamp >= since);
  } catch (err) {
    console.warn('[FeelingWise] Scan log read failed:', err);
    return [];
  }
}

/**
 * Purge scan events older than the given number of days.
 * Call periodically to prevent unbounded growth.
 */
export async function purgeScanEvents(olderThanDays: number): Promise<number> {
  try {
    const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).toISOString();
    const db = await openDB();

    const allEvents: ScanEvent[] = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const request = tx.objectStore(STORE_NAME).getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    // Get keys of old events
    const allKeys: IDBValidKey[] = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const request = tx.objectStore(STORE_NAME).getAllKeys();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    let purged = 0;
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    for (let i = 0; i < allEvents.length; i++) {
      if (allEvents[i].timestamp < cutoff) {
        store.delete(allKeys[i]);
        purged++;
      }
    }

    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
      // A commit that fails after the deletes succeeded fires only abort; without this the purge never settles.
      tx.onabort = () => { db.close(); reject(tx.error ?? new Error('scan log purge aborted')); };
    });

    if (purged > 0) {
      console.log(`[FeelingWise] Purged ${purged} scan events older than ${olderThanDays} days`);
    }

    return purged;
  } catch (err) {
    console.warn('[FeelingWise] Scan purge failed:', err);
    return 0;
  }
}

// The shape lives in src/types/scan-event.ts so the types layer imports nothing (PLAN-2026-09-16 item 8.6);
// every importer of this module keeps working through this re-export.
export type { ScanEvent } from '../types/scan-event';
