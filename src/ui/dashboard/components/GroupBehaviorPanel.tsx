// "How groups behave" panel (slice 2). One row per Facebook group the child
// saw posts from: posts seen, how many FW flagged, average severity, and the
// most common technique. Display-only; aggregates via computeGroupBehavior.
// Rendered only when at least one group post exists in the active record set.

import * as React from 'react';
import type { ForensicRecord } from '../../../types/forensic';
import { computeGroupBehavior } from './group-behavior';
import { useDashboardT } from '../../../i18n/react';
import { Users } from '../../shared/icons/lucide';

// Average-severity tier on the locked marker ramp (low 1-4, mid 5-7, high 8-10),
// driving the colour of the readout — matches FeedCard's timeline node ramp.
function severityTier(avg: number): 'hi' | 'mi' | 'lo' {
  return avg >= 8 ? 'hi' : avg >= 5 ? 'mi' : 'lo';
}

export function GroupBehaviorPanel({ records }: { records: ForensicRecord[] }) {
  const t = useDashboardT();
  const groups = React.useMemo(() => computeGroupBehavior(records), [records]);
  if (groups.length === 0) return null;

  return (
    <div className="grp-behave">
      <div className="grp-behave-head">
        <h3>{t.grpBehaveTitle}</h3>
        <p>{t.grpBehaveIntro}</p>
      </div>
      <div className="grp-row head">
        <span>{t.grpColGroup}</span>
        <span>{t.grpColPostsSeen}</span>
        <span>{t.grpColFlagged}</span>
        <span>{t.grpColAvgSeverity}</span>
        <span>{t.grpColMostCommon}</span>
      </div>
      {groups.map((g) => (
        <div className="grp-row" key={g.name}>
          <span className="grp-name"><Users size={13} />{g.name}</span>
          <span className="grp-num"><b>{g.postsSeen}</b></span>
          <span className="grp-num"><b>{g.flaggedCount}</b></span>
          {g.avgSeverity != null ? (
            <span className={'grp-sev ' + severityTier(g.avgSeverity)}>{g.avgSeverity}/10</span>
          ) : (
            <span className="grp-sev">—</span>
          )}
          {g.dominantTechnique ? (
            <span className="grp-tech"><span className="tech-dot" />{t.techniqueLabel(g.dominantTechnique)}</span>
          ) : (
            <span className="grp-tech">—</span>
          )}
        </div>
      ))}
    </div>
  );
}
