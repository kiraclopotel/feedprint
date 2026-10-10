// Weighted evidence for the pattern classifiers. Keyword and structural signals add up, each match
// inside quoted speech at a fraction of its weight. The sum is then scaled by the register the
// text is written in (a news report counts for less) and cut for a person's own feelings and for
// news attribution, and each step is written into an explanation.

import { TechniqueName } from '../../types/analysis';
import { ClassifierOutput } from './types';
import { LinguisticContext, isInsideQuote } from './linguistic-features';

export interface SignalHit {
  signalId: string;
  weight: number;
  evidence: string;          // as matched in the normalized text
  matchStart?: number;       // position in normalized text
  inQuote?: boolean;
  dampened?: boolean;
  reason?: string;
}

type SignalDetector = (ctx: LinguisticContext) => {
  hits: SignalHit[];
};

export interface SignalSpec {
  id: string;
  weight: number;
  detect: SignalDetector;
}

interface RegisterPolicy {
  // Multiplies the final score. Defaults in DEFAULT_REGISTER_POLICY.
  'news-report'?: number;
  'clickbait'?: number;
  'promotional'?: number;
  'formal'?: number;
  'conversational'?: number;
  'unknown'?: number;
}

export interface ScoringOptions {
  technique: TechniqueName;
  signals: SignalSpec[];
  // Each technique picks the features it cares about.
  structural?: (ctx: LinguisticContext) => SignalHit[];
  registerPolicy?: RegisterPolicy;
  // Multiplies by 0.2 when the writer voices their own feelings. Default true.
  dampenOnFirstPersonVulnerability?: boolean;
  // 0.3 means a match inside quotes counts 30%.
  quoteDampener?: number;
  // Default 3.
  presentThreshold?: number;
  // Default: the rounded score, 0 to 10.
  severityMap?: (rawScore: number) => number;
  // Default: defaultConfidenceMap.
  confidenceMap?: (rawScore: number, severity: number, ctx: LinguisticContext) => number;
}

export interface ScoredResult extends ClassifierOutput {
  signals: SignalHit[];      // dampened hits included
  rawScore: number;
  register: LinguisticContext['register'];
  explain: string[];
}

const DEFAULT_REGISTER_POLICY: Required<RegisterPolicy> = {
  'news-report': 0.4,
  'clickbait': 1.2,
  'promotional': 1.0,
  'formal': 0.7,
  'conversational': 0.9,
  'unknown': 1.0,
};

/**
 * Each match adds `weight`, up to maxHits (default 3). The same text counts once, case aside.
 * Matches inside quotes are marked for the scorer to dampen.
 */
export function patternSignal(
  id: string,
  weight: number,
  patterns: RegExp[],
  options: { maxHits?: number; matchAggressive?: boolean } = {},
): SignalSpec {
  const maxHits = options.maxHits ?? 3;
  return {
    id,
    weight,
    detect: (ctx) => {
      const hits: SignalHit[] = [];
      const seen = new Set<string>();
      const haystack = options.matchAggressive ? ctx.aggressive : ctx.normalized;
      for (const pat of patterns) {
        const isGlobal = pat.flags.includes('g');
        if (isGlobal) {
          pat.lastIndex = 0;
          let m;
          while ((m = pat.exec(haystack)) !== null) {
            const key = m[0].toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            hits.push({
              signalId: id,
              weight,
              evidence: m[0],
              matchStart: m.index,
              inQuote: isInsideQuote(ctx.quotedSpans, m.index),
            });
            if (hits.length >= maxHits) break;
            if (m.index === pat.lastIndex) pat.lastIndex++; // an empty match would loop forever
          }
        } else {
          const m = haystack.match(pat);
          if (m && m.index !== undefined) {
            const key = m[0].toLowerCase();
            if (!seen.has(key)) {
              seen.add(key);
              hits.push({
                signalId: id,
                weight,
                evidence: m[0],
                matchStart: m.index,
                inQuote: isInsideQuote(ctx.quotedSpans, m.index),
              });
            }
          }
        }
        if (hits.length >= maxHits) break;
      }
      return { hits };
    },
  };
}

/** One hit when the test passes. */
export function booleanSignal(
  id: string,
  weight: number,
  test: (ctx: LinguisticContext) => boolean,
  evidenceExtractor?: (ctx: LinguisticContext) => string,
): SignalSpec {
  return {
    id,
    weight,
    detect: (ctx) => {
      if (test(ctx)) {
        return { hits: [{ signalId: id, weight, evidence: evidenceExtractor?.(ctx) ?? id }] };
      }
      return { hits: [] };
    },
  };
}

function defaultConfidenceMap(rawScore: number, _severity: number, ctx: LinguisticContext): number {
  // Small scores grow fast and large ones level off.
  const base = 1 - Math.exp(-rawScore * 0.22);
  let conf = 0.45 + base * 0.50;

  if (ctx.register === 'news-report') conf *= 0.75;
  if (ctx.register === 'formal') conf *= 0.90;

  return Math.max(0, Math.min(0.92, conf));
}

function defaultSeverityMap(rawScore: number): number {
  return Math.max(0, Math.min(10, Math.round(rawScore)));
}

export function score(ctx: LinguisticContext, opts: ScoringOptions): ScoredResult {
  const quoteDampener = opts.quoteDampener ?? 0.3;
  const registerPolicy = { ...DEFAULT_REGISTER_POLICY, ...(opts.registerPolicy ?? {}) };
  const presentThreshold = opts.presentThreshold ?? 3;

  const allHits: SignalHit[] = [];
  for (const spec of opts.signals) {
    const { hits } = spec.detect(ctx);
    for (const hit of hits) {
      if (hit.inQuote) {
        allHits.push({
          ...hit,
          weight: hit.weight * quoteDampener,
          dampened: true,
          reason: 'inside-quote',
        });
      } else {
        allHits.push(hit);
      }
    }
  }

  if (opts.structural) {
    allHits.push(...opts.structural(ctx));
  }

  let rawScore = allHits.reduce((acc, h) => acc + h.weight, 0);

  const regMult = registerPolicy[ctx.register] ?? 1.0;
  rawScore *= regMult;

  if ((opts.dampenOnFirstPersonVulnerability ?? true) && ctx.hasFirstPersonVulnerability) {
    rawScore *= 0.2;
  }

  // Catches news that the register reading missed.
  if (ctx.hasNewsAttribution && ctx.register !== 'news-report') {
    rawScore *= 0.6;
  }

  const severity = (opts.severityMap ?? defaultSeverityMap)(rawScore);
  const present = rawScore >= presentThreshold;
  const confidence = (opts.confidenceMap ?? defaultConfidenceMap)(rawScore, severity, ctx);

  // Quoted hits are shown as evidence only when nothing else matched.
  const sortedHits = [...allHits]
    .filter(h => !h.dampened || allHits.filter(x => !x.dampened).length === 0)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 4);
  const evidence = sortedHits.map(h => h.evidence);

  const explain: string[] = [];
  if (allHits.length > 0) {
    explain.push(`matched ${allHits.length} signal(s): ${allHits.slice(0, 5).map(h => h.signalId).join(', ')}`);
  }
  if (regMult !== 1.0) {
    explain.push(`register=${ctx.register} → ×${regMult.toFixed(2)}`);
  }
  if (ctx.hasFirstPersonVulnerability && (opts.dampenOnFirstPersonVulnerability ?? true)) {
    explain.push('first-person-vulnerability detected → ×0.2 (someone EXPRESSING feelings, not manipulating)');
  }
  if (ctx.hasNewsAttribution) {
    explain.push('news-attribution detected (e.g. "according to") → dampened');
  }
  const quotedHits = allHits.filter(h => h.dampened).length;
  if (quotedHits > 0) {
    explain.push(`${quotedHits} match(es) inside quoted speech → each ×${quoteDampener}`);
  }

  return {
    technique: opts.technique,
    present,
    severity,
    confidence,
    evidence,
    signals: allHits,
    rawScore,
    register: ctx.register,
    explain,
  };
}
