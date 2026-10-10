// The single builder for every `configSnapshot` on every record.
//
// Before this existed the object literal was repeated at 13 emit sites, which
// is why adding one field to it was a 13-site change. Key order is fixed here:
// `JSON.stringify` in `computeRecordIntegrityHash` is order-sensitive, and one
// builder means every record of a given shape hashes over the same key order.
//
// Until 2.5.0 this builder also stamped `videoUnderstanding` /
// `imageUnderstanding`, the state the two media start gates had reached. Those
// pipelines were removed (see landing/updates.html 2.5.0), so no new record
// carries the fields. `ConfigSnapshot` still declares them, because records
// written by earlier versions do and the export and verifier read them.

import { levelOf, type Mode } from '../../types/mode';
import type { FeatureId, FeatureToggles } from '../../storage/settings';
import { receiptsRuns } from '../../storage/switch-scope';
import type { ConfigSnapshot } from '../../types/forensic';

/**
 * `mode` is passed in rather than read here. Each caller already holds the mode
 * the record was JUDGED under, and re-reading settings at stamp time would
 * record a mode switch that happened after the verdict.
 */
export function buildConfigSnapshot(
  mode: Mode,
  threshold: number,
  dailyCap: number,
  features?: FeatureToggles,
  settingsReadFailed?: boolean,
): ConfigSnapshot {
  return {
    mode: levelOf(mode),
    threshold,
    dailyCap,
    // Honest-provenance marker (D3): true only when the snapshot's settings
    // came from the synthetic fail-closed fallback (storage unreadable, no
    // cached snapshot), so the record says "settings unreadable, protected at
    // maximum" instead of attesting a child install. Same additive contract
    // as the field below: absent on real settings and on legacy records.
    ...(settingsReadFailed ? { settingsReadFailed: true } : {}),
    // Optional by the same contract: present only when the caller could supply
    // the judged-under grid, absent otherwise, so a record written without it
    // hashes exactly as it did before the field existed. Sorted for a
    // deterministic hash regardless of grid key order.
    ...(features
      ? {
          // A switch Receipts no longer runs is never named as live, whatever the install stored.
          enabledFeatures: Object.entries(features)
            .filter(([id, f]) => !!f?.enabled && receiptsRuns(id as FeatureId))
            .map(([id]) => id)
            .sort(),
        }
      : {}),
  };
}
