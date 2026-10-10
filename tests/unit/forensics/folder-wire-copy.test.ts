// W80 (2026-08-18) locked the folder-wire copy to the fact of that day: the
// folder's files were sealed to the install and died with it. Since 14 Sep
// 2026 the folder carries its own key file and a fixed-name newest copy, and
// restores on its own after a reinstall or on another computer; the copy has
// to say that, name the files by their real names, and name the button that
// does it, in every locale, and the two surfaces (the folder row and the
// restore card) have to agree on the button's name.
import { describe, expect, it } from 'vitest';

import { LATEST_BACKUP_FILENAME, RESTORE_KEY_FILENAME } from '../../../src/forensics/backup-folder-wire';
import { DASHBOARD_STRINGS } from '../../../src/i18n/dashboard-strings';

describe('the folder-wire copy says the folder restores on its own', () => {
  it('names the two fixed files by their real names, in every locale', () => {
    for (const locale of ['en', 'ro', 'es', 'pt-BR'] as const) {
      const t = DASHBOARD_STRINGS[locale];
      expect(t.folderWireBody, `${locale}: body names the newest copy`).toContain(LATEST_BACKUP_FILENAME);
      expect(t.folderWireBody, `${locale}: body names the key file`).toContain(RESTORE_KEY_FILENAME);
      expect(t.backupAutomaticLimit, `${locale}: the Downloads note names the newest copy`).toContain(LATEST_BACKUP_FILENAME);
      expect(t.restoreFolderNoLatest, `${locale}: the no-latest error names the file`).toContain(LATEST_BACKUP_FILENAME);
    }
  });

  it('names the restore button the same way on the folder row and on the card, and never says the files die with the install', () => {
    for (const locale of ['en', 'ro', 'es', 'pt-BR'] as const) {
      const t = DASHBOARD_STRINGS[locale];
      expect(t.folderWireAutomaticLimit, `${locale}: the folder row names the button`).toContain(t.restoreFolderTitle);
      for (const gone of ['locked to the FeelingWise install', 'open only there', 'se deschid numai acolo', 'solo se abren ahí', 'só abrem ali']) {
        expect(t.folderWireAutomaticLimit, `${locale}: no longer says "${gone}"`).not.toContain(gone);
      }
    }
  });
});
