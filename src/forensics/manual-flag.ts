// FeelingWise — manual-flag forensic helper
//
// `flagPostManually` constructs and chains a forensic record for a post the
// parent saw and chose to add to evidence themselves (FW automation missed
// it OR the parent wants the post on the chain regardless of FW's verdict).
// Mirrors the chain-write pattern from `logger.ts` so the manual record
// integrates seamlessly with auto-recorded chain records:
//
//   chain-write-lock → getChainState → build partial → fingerprint → hash
//   → addRecord
//
// Per VISION §1.1 (military-grade forensic): manual-flag records get the same
// signature + chain-link guarantees as auto-detected records. A judge / CPS
// worker reading the chain can verify the manual-flag record byte-identically
// to any other.
//
// Per VISION §1.2: this is NOT a detection event — `feedSource: 'manual'` +
// `aiSource: 'local'` + `detectionMode: 'manual'` mark it so dashboards can
// distinguish "FW saw + flagged" from "parent flagged."

import { ForensicRecord } from '../types/forensic';
import { Platform } from '../types/post';
import { sha256 } from './hasher';
import { addRecord, getChainState } from './store';
import { finalizeRecord } from './record-stamp';
import { getPublicKeyFingerprint } from './signing';
import { getSettingsForAttestation } from '../storage/settings';
// Use the per-realm singleton so manual-flag shares the same lock queue
// as logger.ts and the other chain-write sites in the SW realm.
// Pre-2026-05-24 manual-flag's own `createChainWriteLock()` instance
// raced dashboard-realm concurrent writes (e.g. anchorChainHead). Audit
// A4-BLOCKER-2 closure.
import { sharedChainWriteLock as withChainWriteLock } from './chain-write-lock';
import { levelOf } from '../types/mode';

const HOST_TO_PLATFORM: Array<[RegExp, Platform]> = [
  [/(?:^|\.)twitter\.com$/, 'twitter'],
  [/(?:^|\.)x\.com$/, 'twitter'],
  [/(?:^|\.)facebook\.com$/, 'facebook'],
  [/(?:^|\.)fb\.com$/, 'facebook'],
  [/(?:^|\.)instagram\.com$/, 'instagram'],
  [/(?:^|\.)tiktok\.com$/, 'tiktok'],
  [/(?:^|\.)youtube\.com$/, 'youtube'],
  [/(?:^|\.)youtu\.be$/, 'youtube'],
  [/(?:^|\.)m\.youtube\.com$/, 'youtube'],
];

export function detectPlatformFromUrl(url: string): Platform | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    for (const [re, platform] of HOST_TO_PLATFORM) {
      if (re.test(host)) return platform;
    }
    return null;
  } catch {
    return null;
  }
}

export function extractAuthorFromUrl(url: string, platform: Platform): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname;
    switch (platform) {
      case 'twitter': {
        // /<handle>/status/<id> OR /<handle>
        const m = path.match(/^\/([^/]+)/);
        return m ? `@${m[1]}` : '';
      }
      case 'facebook': {
        // /<page_or_user>/posts/<id> OR /permalink.php?id=
        const m = path.match(/^\/([^/]+)/);
        return m && m[1] !== 'permalink.php' ? m[1] : '';
      }
      case 'instagram': {
        // /p/<id>/ or /reel/<id>/ — author not in URL; leave empty
        return '';
      }
      case 'tiktok': {
        // /@<handle>/video/<id>
        const m = path.match(/^\/@([^/]+)/);
        return m ? `@${m[1]}` : '';
      }
      case 'youtube': {
        // /watch?v=<id> or /shorts/<id> — channel not in URL; leave empty
        return '';
      }
      default:
        return '';
    }
  } catch {
    return '';
  }
}

export interface FlagPostManuallyResult {
  record: ForensicRecord;
}

export class InvalidManualFlagUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidManualFlagUrlError';
  }
}

/**
 * Construct + sign + chain a forensic record for a parent-flagged post.
 *
 * Throws `InvalidManualFlagUrlError` if the URL is malformed or doesn't
 * match a supported platform — the dashboard catches this and surfaces an
 * inline error.
 *
 * Returns the persisted record (with its assigned `chainPosition` /
 * `prevRecordHash` / `signature`) so the dashboard can update its in-memory
 * list without re-fetching the entire chain from IDB.
 */
export async function flagPostManually(
  url: string,
  reason?: string,
): Promise<FlagPostManuallyResult> {
  const trimmed = (url ?? '').trim();
  if (!trimmed) {
    throw new InvalidManualFlagUrlError('URL is required.');
  }
  const platform = detectPlatformFromUrl(trimmed);
  if (!platform) {
    throw new InvalidManualFlagUrlError(
      'URL host does not match a supported platform (X, Facebook, Instagram, TikTok, YouTube).',
    );
  }

  const author = extractAuthorFromUrl(trimmed, platform);
  const originalText = reason && reason.trim().length > 0
    ? reason.trim()
    : '[manually flagged by parent — see postUrl]';
  const originalHash = await sha256(originalText);

  const record = await withChainWriteLock(async () => {
    const chainState = await getChainState();
    // Attestation seam (Q24). originalText is parent-authored and hashed
    // above, so the fail-closed note rides in detectionMode (also inside
    // the canonical hash): a manual flag written during a storage outage
    // must not silently attest the synthetic child mode.
    const attestation = await getSettingsForAttestation();
    const activeMode = attestation.mode;
    const partial: Omit<ForensicRecord, 'integrityHash'> = {
      id: `fr-manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      platform,
      originalText,
      originalHash,
      originalLength: originalText.length,
      // Manual flags carry no FW rewrite — this is parent-authored evidence.
      neutralizedText: '',
      author,
      postUrl: trimmed,
      // No detector ran — techniques empty, score 0.
      techniques: [],
      overallScore: 0,
      userAgeCategory: levelOf(activeMode),
      aiSource: 'local',
      feedSource: 'manual',
      aiModel: undefined,
      aiProvider: undefined,
      detectionMode: attestation.readFailed ? 'manual:settings-read-failed' : 'manual',
      configSnapshot: undefined,
      prevRecordHash: chainState.prevRecordHash,
      chainPosition: chainState.nextPosition,
      chainAnchor: chainState.nextPosition === 0 ? 'genesis-v1' : undefined,
      verdict: 'flagged',
    };

    // Manual records are evidence too: a missing signing identity must reject
    // the SW request, never create a weaker active-chain entry.
    const publicKeyFingerprint = await getPublicKeyFingerprint();
    const stamped = { ...partial, publicKeyFingerprint };
    const finalRecord: ForensicRecord = await finalizeRecord(stamped);

    await addRecord(finalRecord);
    // The platform only: the post's address can carry its author's handle.
    console.info(`[FeelingWise] Forensic: manual flag recorded for a ${platform} post`);
    return finalRecord;
  });

  return { record };
}
