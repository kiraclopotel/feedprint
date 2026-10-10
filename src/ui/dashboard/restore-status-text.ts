// W82: the restore/backup path's parent-facing sentences, chosen by the typed
// causes backup.ts returns.
//
// backup.ts never imports the locale (W81's rule) and its English `error`,
// `keyNote` and `message` strings stay as the fallback for callers with no
// string table. This module is the other half of that route: it turns
// `reason` / `keyNoteReason` / `level` plus the interpolated `detail` into the
// string the parent actually reads. Pure so the mapping is unit-testable under
// the node test env (no @testing-library, project convention) — the same shape
// as reset-modal-status.ts.
//
// A `cause` is untranslated technical text produced outside this route
// (chain-integrity's structural reason, the download path's failure word). It
// is interpolated verbatim; translating those modules is separate work.

import type {
  BackupAssessment,
  RestoreFailureDetail,
  RestoreFailureReason,
  RestoreKeyNoteReason,
} from '../../forensics/backup';
import type { DashboardStrings } from '../../i18n/dashboard-strings';

type FailureStrings = Pick<
  DashboardStrings,
  | 'restoreSealedKeyMissing' | 'restoreSealedOtherInstall' | 'restoreSealedRecoveryRoute'
  | 'restoreNotJson' | 'restoreNotAnObject' | 'restoreMissingSchemaVersion'
  | 'restoreSchemaTooNew' | 'restoreNoRecordsArray' | 'restoreSealFormatTooNew'
  | 'restorePassphraseRequired' | 'restorePassphraseWrong' | 'restoreStructureInvalid'
  | 'restoreDeliveryPending' | 'restoreSafetyBackupFailed' | 'restoreStoreReadFailed' | 'restoreFailed'
>;

/**
 * The sentence shown when a restore is refused. Falls back to backup.ts's
 * English `error` when the cause is untyped (a crypto module's own throw), and
 * to `restoreFailed` when there is no message at all.
 */
export function restoreFailureText(
  reason: RestoreFailureReason | undefined,
  detail: RestoreFailureDetail | undefined,
  englishFallback: string | undefined,
  t: FailureStrings,
): string {
  switch (reason) {
    case 'device-key-missing':
      return `${t.restoreSealedKeyMissing} ${t.restoreSealedRecoveryRoute}`;
    case 'device-key-mismatch':
      return `${t.restoreSealedOtherInstall} ${t.restoreSealedRecoveryRoute}`;
    case 'not-json':
      return t.restoreNotJson;
    case 'not-an-object':
      return t.restoreNotAnObject;
    case 'missing-schema-version':
      return t.restoreMissingSchemaVersion;
    case 'schema-too-new':
      return t.restoreSchemaTooNew(detail?.fileVersion ?? 0, detail?.supportedVersion ?? 0);
    case 'no-records-array':
      return t.restoreNoRecordsArray;
    case 'seal-format-too-new':
      return t.restoreSealFormatTooNew(detail?.fileVersion ?? 0);
    case 'passphrase-required':
      return t.restorePassphraseRequired;
    case 'passphrase-wrong':
      return t.restorePassphraseWrong;
    case 'structure-invalid':
      return t.restoreStructureInvalid(detail?.cause ?? '');
    case 'delivery-pending':
      return t.restoreDeliveryPending(detail?.pendingCount ?? 0);
    case 'safety-backup-failed':
      return t.restoreSafetyBackupFailed(detail?.cause ?? '');
    case 'store-read-failed':
      return t.restoreStoreReadFailed(detail?.cause ?? '');
    default:
      return englishFallback ?? t.restoreFailed;
  }
}

type KeyNoteStrings = Pick<
  DashboardStrings,
  'restoreKeyNoRecords' | 'restoreKeyPassphraseNeeded' | 'restoreKeyIdentityMismatch'
>;

/**
 * The note appended to a SUCCESSFUL restore about the signing key. Each string
 * carries its own leading space, matching the English fallback's shape at the
 * call site. Returns '' when there is no note.
 */
export function restoreKeyNoteText(
  reason: RestoreKeyNoteReason | undefined,
  englishFallback: string | undefined,
  t: KeyNoteStrings,
): string {
  switch (reason) {
    case 'key-no-records':
      return t.restoreKeyNoRecords;
    case 'key-passphrase-needed':
      return t.restoreKeyPassphraseNeeded;
    case 'key-identity-mismatch':
      return t.restoreKeyIdentityMismatch;
    default:
      return englishFallback ? ` ${englishFallback}` : '';
  }
}

type HealthStrings = Pick<
  DashboardStrings,
  | 'relativeAge' | 'backupHealthFailing' | 'backupHealthNever'
  | 'backupHealthStale' | 'backupHealthInstallLockedOnly' | 'backupHealthOk'
>;

/** The backup-health line under the Export tab, chosen by assessed level. */
export function backupHealthText(health: BackupAssessment, t: HealthStrings): string {
  const age = t.relativeAge(health.ageMs ?? 0);
  switch (health.level) {
    case 'failing':
      return t.backupHealthFailing(health.cause);
    case 'never':
      return t.backupHealthNever;
    case 'stale':
      return t.backupHealthStale(age);
    case 'install-locked-only':
      return t.backupHealthInstallLockedOnly(age);
    case 'ok':
      return t.backupHealthOk(age);
    default:
      return health.message;
  }
}
