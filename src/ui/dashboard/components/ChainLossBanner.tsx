// src/ui/dashboard/components/ChainLossBanner.tsx
//
// The other half of M186 (see src/forensics/chain-height-witness.ts and
// src/background/chain-height.ts). The worker writes a signed `chain-lost`
// gap marker on the new chain when a dimension reads empty after having been
// above zero, but a marker on the chain is not a sentence on the screen: the
// dashboard the person is looking at is the record that looks empty, which is
// exactly why they have no reason to trust it without this banner saying so.
//
// This component reads the witness through `statedLossFacts` and renders
// nothing when there is no stated loss: most installs, most of the time, this
// is not on the page at all. When there is a stated loss it is meant to be the
// one thing on the page a parent cannot miss or dismiss, unlike AttentionBanner
// (per-item, dismissable for the day) or ChainBanner (scoped to the Forensics
// tab): this states that evidence is gone, not that something is unverified.
//
// What it will not say: proof, tamper-proof, sealed, complete or admissible.
// The one limit it states is that the chain running now began after the loss,
// because that is true and because a banner that overclaims here would be the
// exact failure this product exists to avoid on every other screen.

import { statedLossFacts, type ChainHeightWitness } from '../../../forensics/chain-height-witness';
import { useDashboardT } from '../../../i18n/react';
import { formatUtcStamp } from '../../shared/format-time';
import { ShieldAlert } from '../../shared/icons/lucide';

export interface ChainLossBannerProps {
  /** The note from chrome.storage.local, or null when there is none yet. */
  witness: ChainHeightWitness | null;
  /**
   * Opens the Export tab, where "Restore from backup" lives. Optional so the
   * banner stays a pure status surface where no navigation is wired (a test,
   * or a surface that has no Export tab of its own).
   */
  onOpenBackup?: () => void;
}

export function ChainLossBanner({ witness, onOpenBackup }: ChainLossBannerProps) {
  const t = useDashboardT();
  const stated = statedLossFacts(witness);
  if (!stated) return null;

  return (
    <div className="chain-banner err" role="alert">
      <div className="chain-banner-shield"><ShieldAlert size={24} /></div>
      <div>
        <h2 className="chain-banner-title">{t.lossBannerHeading}</h2>
        <div className="chain-banner-desc">
          {/* Evidence: the record's own clock, named in words (t.utcStamp). */}
          <p style={{ margin: '2px 0' }}>{t.lossBannerDate(t.utcStamp(formatUtcStamp(stated.atISO)))}</p>
          {stated.heldPositions > 0 && (
            <p style={{ margin: '2px 0' }}>{t.lossBannerHeldChain(stated.heldPositions)}</p>
          )}
          {stated.heldArchivedMonths > 0 && (
            <p style={{ margin: '2px 0' }}>
              {stated.heldArchivedRecords === null
                ? t.lossBannerHeldArchivesUncounted(stated.heldArchivedMonths)
                : t.lossBannerHeldArchivesCounted(stated.heldArchivedMonths, stated.heldArchivedRecords)}
            </p>
          )}
          <p style={{ margin: '2px 0' }}>{t.lossBannerNoRecovery} {t.lossBannerBackupOnly}</p>
          <p style={{ margin: '2px 0' }}>{t.lossBannerNewChainStarted}</p>
        </div>
      </div>
      {onOpenBackup && (
        <div style={{ display: 'flex', alignItems: 'center', marginLeft: 14 }}>
          <button
            type="button"
            onClick={onOpenBackup}
            style={{
              fontSize: 12, fontWeight: 600, padding: '6px 12px', borderRadius: 'var(--fw-radius-md)',
              cursor: 'pointer', whiteSpace: 'nowrap',
              border: '1px solid var(--fw-red)', background: 'var(--fw-red)', color: 'var(--fw-bg)',
            }}
          >
            {t.lossBannerOpenBackup}
          </button>
        </div>
      )}
    </div>
  );
}
