// src/ui/dashboard/components/SafetyCategoriesPanel.tsx
// Surface-ID: activity-side-safety-categories
//
// Always-on safety-bucket counters for parent reassurance. The
// Dashboard's existing "Technique frequency" panel slices the top-7
// techniques by raw count, which means low-frequency-but-high-importance
// buckets (profanity, identity-slurs, dehumanization) get hidden behind
// chart-volume techniques like scapegoating + genuine-opinion.
//
// This panel exists so a parent can answer:
//   "How many swearings / slurs / racial attacks has FW shielded my
//    child from in 1 week / month / year?"
//
// Expanding a bucket reveals the distinct matched stems with
// frequency counts ("fuck × 23"). Source for each phrase:
//   • harmFloor.topEvidence (preferred — ≤60 char snippet; the matched
//     stem is unwrapped from the "N <category> tokens (<stem>)" /
//     "identity-slur match (<stems>)" wrapper the harm-floor pipeline
//     emits — src/core/harm-floor.ts signal evidence + the candidate
//     builders in src/analysis/comment-batch-scorer.ts)
//   • technique[].evidence (fallback when harmFloor absent — a raw quote)
//
// Parent-surface slur contract (F3b): identity slurs NEVER render
// verbatim in these always-visible chips. FeedCard shows verbatim slur
// text only behind an explicit per-record reveal; an aggregate chip row
// has no such consent step, so every phrase passes through
// maskSlurTerms() — the SAME shipped lexicon that produced the match
// (filterProfanity, tier 'slurs') asterisk-masks each slur token with
// the first letter kept ("n***** × 3"). Non-slur profanity stays
// verbatim (the "fuck × 23" above). Long quotes are clipped at 30 chars
// AFTER masking so a clipped tail can never leave a slur fragment.
//
// Cross-references the same bucket sources as the per-record audit
// trail at FeedCard.tsx; this panel is the aggregate over those records.

import { useMemo, useState } from 'react';
import type { ForensicRecord } from '../../../types/forensic';
import { filterProfanity } from '../../../core/profanity-filter';
import { ChevronRight } from '../../shared/icons/lucide';
import { useDashboardT, useUiLanguage } from '../../../i18n/react';
import { formatDecimal } from '../../shared/format-number';
import { isItem } from '../record-sets';

export interface SafetyCategoriesPanelProps {
  records: ForensicRecord[];
  /** Called when the user clicks "Filter to this bucket" — wire to feed filter.
   *  Passes the BucketId; the feed predicate reuses recordMatchesBucket so the
   *  filtered feed matches this panel's per-bucket count exactly. */
  onPickBucket?: (bucket: BucketId) => void;
  /** The bucket currently driving the feed filter (so the panel can show it
   *  active). null when no safety-bucket filter is applied. */
  activeBucket?: BucketId | null;
}

export type BucketId = 'swearing' | 'slurs' | 'racial' | 'extreme';

interface Bucket {
  id: BucketId;
  label: string;
  description: string;
  /** Records matching this bucket. */
  records: ForensicRecord[];
  /** Distinct matched phrases with frequency. */
  phrases: { phrase: string; count: number }[];
}

export function recordMatchesBucket(r: ForensicRecord, id: BucketId): boolean {
  const techNames = (r.techniques ?? []).map((t) => t.name);
  const dm = (r.detectionMode ?? '').toLowerCase();
  const topCat = r.harmFloor?.topCategory;
  switch (id) {
    case 'swearing':
      return (
        techNames.includes('profanity')
        || dm.startsWith('pre-rewrite-hide:profanity-tier')
        || topCat === 'profanity'
      );
    case 'slurs':
      return (
        dm.startsWith('slur:')
        || dm.startsWith('pre-rewrite-hide:identity-slur')
        || topCat === 'identity-slur'
        || (r.harmFloor?.identitySlurMatch ?? false)
      );
    case 'racial':
      return (
        dm.startsWith('dehumanization:')
        || techNames.includes('dehumanization')
      );
    case 'extreme':
      return techNames.includes('extreme-toxicity');
    default:
      // A bucket id this build does not know (a stale filter carried in from
      // an older build) matches nothing, explicitly (wiring audit 13 Sep, D2-39).
      return false;
  }
}

/** The longest phrase a chip shows; the full phrase is its tooltip and its count key. */
const PHRASE_DISPLAY_MAX = 30;

/** Clip for display only. */
export function displayPhrase(phrase: string): string {
  return phrase.length > PHRASE_DISPLAY_MAX ? phrase.slice(0, PHRASE_DISPLAY_MAX - 1) + '\u2026' : phrase;
}

/** Unwrap the matched stem from the harm-floor evidence wrapper. The
 *  pipeline emits "3 profanity tokens (fuck)" / "identity-slur match
 *  (nigger, spic)" — the stem list is the trailing parenthesized group
 *  (its close paren may be missing after the forensic 60-char clip).
 *  Structural evidence (caps / punctuation-rage / emoji-pile / repetition)
 *  carries no parenthesized stem and passes through whole. */
function stemFromEvidence(ev: string): string {
  const m = ev.match(/\(([^()]*)\)?\s*$/);
  const first = m?.[1]?.split(',')[0].trim();
  return first && first.length > 0 ? first : ev;
}

/** Asterisk-mask identity-slur tokens for the parent surface (header
 *  contract). Tier 'slurs' only — non-slur profanity stays verbatim, the
 *  panel's own "fuck × 23" example. Reuses the shipped lexicon via
 *  filterProfanity so this display can never drift from what the detector
 *  matched; display-only, detection is untouched. cleanText replaces each
 *  matched token with same-length asterisks; the first letter of each
 *  masked run is restored ("n*****") so distinct slurs stay tellable
 *  apart without ever spelling one out. Falls back to the fully-masked
 *  cleanText if normalization (zero-width / Cyrillic strip) changed the
 *  string length. */
function maskSlurTerms(phrase: string): string {
  const res = filterProfanity(phrase, 'teen', { tier: 'slurs' });
  if (!res.filtered) return phrase;
  const clean = res.cleanText;
  if (clean.length !== phrase.length) return clean;
  let out = '';
  for (let i = 0; i < clean.length; i++) {
    const masked = clean[i] === '*' && phrase[i] !== '*';
    const prevMasked = i > 0 && clean[i - 1] === '*' && phrase[i - 1] !== '*';
    out += masked && !prevMasked ? phrase[i] : clean[i];
  }
  return out;
}

/** Exported for tests (dashboard honesty audit F3b). */
export function extractPhrase(r: ForensicRecord): string | null {
  // harmFloor.topEvidence is a clipped (≤60 char) regex-evidence snippet —
  // unwrap the matched stem, then sanitize. The phrase is returned whole: the
  // panel counts on the whole phrase and clips only what a chip displays
  // (D2-39: clipping here merged two phrases that shared their first 30
  // characters into one count).
  const ev = r.harmFloor?.topEvidence;
  if (ev && ev.trim().length > 0) {
    return maskSlurTerms(stemFromEvidence(ev.trim()));
  }
  // Fall back to first technique's evidence if it's a string-shaped field.
  const t = r.techniques?.[0] as { evidence?: unknown } | undefined;
  if (t && typeof t.evidence === 'string' && t.evidence.trim().length > 0) {
    return maskSlurTerms(t.evidence.trim());
  }
  if (Array.isArray((t as { evidence?: unknown })?.evidence)) {
    const arr = (t as { evidence: unknown[] }).evidence;
    if (arr.length > 0 && typeof arr[0] === 'string') {
      return maskSlurTerms(arr[0] as string);
    }
  }
  return null;
}

/** Single source of truth for bucket display labels — shared with the
 *  Dashboard's active-filter chip so the panel and the chip never drift.
 *  These English labels stay STABLE (Dashboard.tsx + tests consume them);
 *  the panel itself renders localized labels via t.safetyBucketLabel /
 *  t.safetyBucketDesc, keyed by the same BucketId. */
const SAFETY_BUCKET_DEFS: { id: BucketId; label: string; description: string }[] = [
  { id: 'swearing', label: 'Swearing', description: 'Profanity FW caught and rewrote or hid.' },
  { id: 'slurs', label: 'Slurs', description: 'Identity-targeting slurs (racial, homophobic, ableist).' },
  { id: 'racial', label: 'Dehumanization', description: 'Group-targeting rhetoric (rats / vermin / "they are" framing).' },
  { id: 'extreme', label: 'Extreme toxicity', description: 'High-severity hostility crossing into harm.' },
];

export const SAFETY_BUCKET_LABELS: Record<BucketId, string> = Object.fromEntries(
  SAFETY_BUCKET_DEFS.map((d) => [d.id, d.label]),
) as Record<BucketId, string>;

function computeBuckets(records: ForensicRecord[]): Bucket[] {
  const defs = SAFETY_BUCKET_DEFS;
  return defs.map((def) => {
    const matched = records.filter((r) => recordMatchesBucket(r, def.id));
    const phraseCounts: Record<string, number> = {};
    for (const r of matched) {
      const p = extractPhrase(r);
      if (!p) continue;
      const norm = p.toLowerCase();
      phraseCounts[norm] = (phraseCounts[norm] ?? 0) + 1;
    }
    const phrases = Object.entries(phraseCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([phrase, count]) => ({ phrase, count }));
    return { ...def, records: matched, phrases };
  });
}

export function SafetyCategoriesPanel({ records, onPickBucket, activeBucket }: SafetyCategoriesPanelProps) {
  const t = useDashboardT();
  const lang = useUiLanguage();
  const buckets = useMemo(() => computeBuckets(records), [records]);
  const [expanded, setExpanded] = useState<BucketId | null>(null);
  /**
   * Content records only, the same denominator the rest of the dashboard uses
   * (2026-09-19). It was records.length.
   *
   * recordMatchesBucket reads techniques, detectionMode and harmFloor, and an
   * environment reading or a system marker carries none of those. So they could
   * never be in any bucket's numerator and always sat in its denominator, and
   * every share on this panel read lower than it is. One profanity record
   * beside nine room summaries showed 10.0%, where the honest answer over the
   * content there was one of one.
   *
   * isBalanceContent is overview-data's, which is StatisticsTab's, which the
   * account ledger's header calls the rule the panel, the Overview and
   * Statistics must never disagree on. This panel was the one disagreeing.
   */
  const totalRecords = records.filter(isItem).length;
  const hasAny = buckets.some((b) => b.records.length > 0);

  return (
    <div className="side-panel">
      <div className="side-panel-header">
        <h3>{t.safetyTitle}</h3>
        <span className="hint">{t.safetyHint}</span>
      </div>
      {!hasAny ? (
        <div className="muted" style={{ fontSize: 12 }}>
          {t.safetyEmpty}
        </div>
      ) : (
        buckets.map((b) => {
          const label = t.safetyBucketLabel[b.id];
          const isExpanded = expanded === b.id;
          const pct = totalRecords > 0 ? Math.round((b.records.length / totalRecords) * 1000) / 10 : 0;
          const isFilterActive = activeBucket === b.id;
          return (
            <div key={b.id} className="safety-bucket">
              <button
                type="button"
                className={'bar-row' + (isFilterActive ? ' active' : '')}
                onClick={() => setExpanded(isExpanded ? null : b.id)}
                style={{
                  background: 'transparent', border: 0, width: '100%',
                  cursor: 'pointer', textAlign: 'left',
                  display: 'flex', alignItems: 'center', gap: 6,
                }}
                title={t.safetyBucketDesc[b.id]}
                aria-expanded={isExpanded}
              >
                <ChevronRight
                  size={11}
                  style={{
                    transform: isExpanded ? 'rotate(90deg)' : 'none',
                    transition: 'transform 120ms ease',
                  }}
                />
                <span className="bar-label" style={{ flex: 1 }}>{label}</span>
                <span className="bar-count">{b.records.length}</span>
                <span className="muted" style={{ fontSize: 12, minWidth: 36, textAlign: 'right' }}>
                  {formatDecimal(pct, lang, 1)}%
                </span>
              </button>
              {/* The filter is on the row itself, not behind the expand that
                  shows phrases: the two are unrelated, and a parent looking for
                  "show only these" had no reason to open the phrase list
                  (wiring audit 13 Sep, D2-38). */}
              {onPickBucket && b.records.length > 0 && (
                <div style={{ paddingLeft: 18 }}>
                  <button
                    type="button"
                    className={'chip' + (isFilterActive ? ' active' : '')}
                    style={{ fontSize: 12, marginBottom: 6, cursor: 'pointer' }}
                    onClick={() => onPickBucket(b.id)}
                    title={isFilterActive
                      ? t.safetyClearFilterTip(label)
                      : t.safetyShowOnlyTip(label)}
                  >
                    {isFilterActive ? t.safetyClearFilter(label) : t.safetyFilterTo(label)}
                  </button>
                </div>
              )}
              {isExpanded && (
                <div style={{ paddingLeft: 18, marginBottom: 8 }}>
                  {b.phrases.length === 0 ? (
                    <div className="muted" style={{ fontSize: 12 }}>
                      {t.safetyNoPhrases}
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {b.phrases.map((p) => (
                        <span
                          key={p.phrase}
                          className="chip"
                          style={{ fontSize: 12, cursor: 'default' }}
                          title={t.safetyPhraseTip(p.count, p.phrase)}
                        >
                          {displayPhrase(p.phrase)} <strong style={{ marginLeft: 4 }}>×{p.count}</strong>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
