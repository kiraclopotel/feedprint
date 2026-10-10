// Two ways the dashboard told a person something untrue about their record.
//
// COUNTED TWICE. `allRecords` is the list every counting panel reads, and it
// was archived months concatenated with the active chain, no de-duplication.
// The exporter, two directories away, does exactly that de-duplication and its
// comment says why: archive-on-evict writes a record to its month archive
// BEFORE deleting it from the active chain, deliberately, so an interruption
// leaves a duplicate rather than a hole.
//
// A RESTORE makes that systematic instead of rare.
// `replaceBackupStateUnderChainLock` retires the whole outgoing chain into the
// month archives and then writes the backup's records into the active store,
// so every record the backup shares with the chain it replaced sits in both
// places. After recovering from a disaster, the one moment a person reads
// these numbers hardest, items seen, flagged and hidden, sessions, per-account
// rows and the rhythm map all roughly doubled, and the exported file disagreed
// with the screen about the same record.
//
// A REFUSED RESET READ AS A PARTIAL ONE. `resetForensicChain` refuses rather
// than throwing when it cannot archive the outgoing chain first, returning a
// result with every flag false. The service worker wrapped that unconditionally
// as ok:true, so the modal called onSuccess and printed the partial-reset
// sentence: "your record was reset, these parts lagged", over a chain nothing
// had touched. `reset-modal-status.ts` says outright that a marker failure
// "never reaches this path". It did. And `archiveFailedReason`, the store's
// explanation, had no reader anywhere in the tree.
//
// Found 2026-09-19 by a read-only scan of the ways the record can be lost and
// the numbers a person reads about it. Both verified against the code that
// contradicts them.

import { describe, expect, it } from 'vitest';
import { resetModalStatusLine } from '../../../../src/ui/dashboard/reset-modal-status';
import { DASHBOARD_STRINGS } from '../../../../src/i18n/dashboard-strings';
import { readSource } from '../../../helpers/read-source';

const LANGS = ['en', 'ro', 'es', 'pt-BR'] as const;

describe('the record is counted once and a refusal says so (2026-09-19)', () => {
  describe('counted once', () => {
    it('the list every panel reads drops a record it already holds', () => {
      const src = readSource('src/ui/dashboard/Dashboard.tsx');
      const from = src.indexOf('const allRecords = useMemo(');
      expect(from, 'the list is where this expects it').toBeGreaterThan(0);
      const body = src.slice(from, src.indexOf('}, [archiveRecords, records]);', from));
      expect(body, 'by id').toContain('const seen = new Set<string>();');
      expect(body, 'and the archived copy wins, as in the exporter').toContain('[...archiveRecords, ...records].filter');
    });

    it('it drops it the same way and for the same reason the exporter does', () => {
      // The two must not drift: a recipient walking the exported chain and a
      // parent reading the screen have to be looking at one record.
      const exporter = readSource('src/forensics/exporter.ts');
      expect(exporter, 'the exporter still de-duplicates').toContain('const seen = new Set<string>();');
      expect(exporter, 'and still says why').toContain('is therefore in both lists');
    });

    it('the all-time count no longer adds a record to itself', () => {
      const src = readSource('src/ui/dashboard/Dashboard.tsx');
      expect(src).toContain('const wholeRecordCount = archivedRecordCount + records.length - duplicatedInBoth;');
      // And it says plainly that the correction covers the loaded months only,
      // because an unloaded month contributes a count and not its ids.
      expect(src).toContain('correction available here rather than a complete one');
    });
  });

  describe('a refusal says so', () => {
    it('the store still refuses rather than half-resetting', () => {
      // The behaviour this rests on. If the store ever starts clearing before
      // it has archived, the message below is the wrong one.
      const store = readSource('src/forensics/store.ts');
      expect(store).toContain('resetForensicChain refused: could not archive the current chain');
      expect(store).toContain('resetMarkerWritten: false,');
    });

    it('the worker no longer reports a refusal as a reset that happened', () => {
      const sw = readSource('src/background/service-worker.ts');
      expect(sw).toContain('if (!result.resetMarkerWritten) {');
      expect(sw, 'named, not merely failed').toContain("errorKind: 'reset-refused',");
      expect(sw, "and the store's own reason finally has a reader").toContain('result.archiveFailedReason');
    });

    it('the modal tells the two apart', () => {
      const modal = readSource('src/ui/dashboard/components/ResetChainConfirmModal.tsx');
      expect(modal).toContain("response.errorKind === 'reset-refused' ? 'reset-refused' : 'reset-failed'");
    });

    it('and every language says the record is still there', () => {
      for (const lang of LANGS) {
        const t = DASHBOARD_STRINGS[lang] as unknown as { resetRefused: string; resetFailed: string };
        const line = resetModalStatusLine('reset-refused', false, t as never);
        expect(line, `${lang} has its own sentence`).toBe(t.resetRefused);
        expect(line, `${lang} is not the failure sentence`).not.toBe(t.resetFailed);
        expect(t.resetRefused.length, `${lang} says something`).toBeGreaterThan(40);
        expect(t.resetRefused, lang).not.toContain('—');
      }
    });

    it('a reset that really happened is still a success', () => {
      // The other side: this must not turn every reset into an error.
      const t = DASHBOARD_STRINGS.en as unknown as { resetFailed: string; resetRefused: string };
      expect(resetModalStatusLine(null, false, t as never), 'no error, not busy, nothing to say').toBe('');
    });
  });
});
