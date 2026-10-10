// FeelingWise — topic fingerprints + theme clustering (sequence analysis,
// slice 1 of docs/research/SEQUENCE_ANALYSIS_DESIGN.md).
//
// Groups forensic records into THEMES by the significant words they share:
// TF-IDF term fingerprints, an entity axis (capitalized tokens / hashtags /
// handles, boosted ×2 so "one politician, many videos" clusters tightly),
// and single-pass greedy agglomeration over an inverted index — near-linear,
// no pairwise N². Labels are literal words from the records, so every theme
// survives the provenance test by construction.
//
// HONESTY FRAME (read before consuming): a theme is records SHARING WORDS,
// nothing more. The output vocabulary is "your feed served N items about X"
// — never platform intent. Pass records are INCLUDED: themes describe what
// the feed SERVED, not what FW flagged. Everything here is deterministic
// (timestamp-ordered processing, fixed thresholds, ALGO_VERSION below) so a
// verifier can recompute the grouping from an export.
//
// PURE read-side: imports only types + read-side helpers. Never writes a
// record, never touches the chain, no IDB, no chrome.

import type { ForensicRecord } from '../types/forensic';
import { isExposureRecord, severityWeight } from './analytics';
import { isSystemMarkerRecord } from './system-records';
import { sha256 } from './hasher';

/** Bump when tokenization / weighting / thresholds change, or when what a
 *  theme's perDayCounts is KEYED BY changes, since a cached entry carries those
 *  keys and the grid reading them is on the reader's own days. Invalidates the
 *  sidecar cache (theme-cache, slice 4).
 *
 *  2 (2026-09-18): perDayCounts moved from a UTC cut to the caller's day key. */
export const TOPICS_ALGO_VERSION = 2;

const TOP_K = 12;
const JOIN_SIMILARITY = 0.35;
const MERGE_SIMILARITY = 0.5;
/** Clusters below this size are coincidence, not a theme (design risk #1). */
export const MIN_THEME_SIZE = 3;
const ENTITY_BOOST = 2;
const MIN_TOKEN_LEN = 3;
const LABEL_TERMS = 3;

type TermKind = 'word' | 'entity' | 'hashtag' | 'handle';

interface FingerprintTerm {
  term: string; // folded form
  weight: number;
  kind: TermKind;
}

export interface RecordFingerprint {
  recordId: string;
  terms: FingerprintTerm[]; // top-k by weight
  lang: 'en' | 'ro' | 'mixed' | 'unknown';
  timestamp: string;
  platform: string;
  flagged: boolean;
  severity: number;
}

export interface Theme {
  /** sha-256 (first 16 hex) of the sorted top centroid terms — stable across recomputes. */
  id: string;
  /** Display label: top centroid terms in their most frequent original spelling. */
  label: string;
  topTerms: FingerprintTerm[];
  /** PROVENANCE — every claim drills down to these. */
  memberRecordIds: string[];
  recordCount: number;
  dateSpan: { start: string; end: string };
  daysActive: number;
  perDayCounts: Record<string, number>;
  platforms: Record<string, number>;
  flaggedCount: number;
  severitySum: number;
  topEntities: string[];
}

// ─── Stopwords (EN + RO, stored diacritic-folded) ───────────────────────────

const EN_STOPWORDS = new Set((
  'the a an and or but if then else when while for nor not no yes of to in on at by ' +
  'from with without about into onto over under again further once here there all any ' +
  'both each few more most other some such only own same so than too very can will ' +
  'just should now this that these those is are was were be been being have has had ' +
  'having do does did doing would could may might must shall it its he she his her ' +
  'they them their what which who whom whose why how where you your yours we our ours ' +
  'me my mine him us i am dont cant wont didnt doesnt isnt arent youre theyre ive im ' +
  'get got like one two new old out up down off back still even also really going go ' +
  'know see say said make made want need think thing things way time day people good ' +
  'much many lot bit let lets via per as because before after between through during'
).split(/\s+/));

const RO_STOPWORDS = new Set((
  // stored folded (ă→a, ș→s, ț→t, î/â→i/a)
  'si sau dar daca atunci cand unde cum care cine cui ce cat cata cati cate nu da nici ' +
  'un o una unui unei unor al a ai ale lui ei lor la in pe cu de din dintre catre spre ' +
  'pana sub peste prin fara despre dupa inainte intre langa pentru asupra impotriva ' +
  'fiecare este sunt era erau fi fie ' +
  'fost fiind am ai are avem aveti au avea avut va vor fi as ar ati eu tu el ea noi voi ' +
  'ele acest aceasta acesti aceste acel acea acei acele asta aia astea alea mai foarte ' +
  'prea tot toata toti toate ceva cineva nimeni nimic orice oricine doar numai chiar ' +
  'iar insa deci totusi atat asa cam ca sa se isi iti imi ne le il o vad zic zice spune ' +
  'spus face facut fac poate trebuie acum aici acolo azi ieri maine apoi inca dupa'
).split(/\s+/));

const ALL_STOPWORDS = new Set([...EN_STOPWORDS, ...RO_STOPWORDS]);

// ─── Normalization + tokenization ────────────────────────────────────────────

/** NFD diacritic fold + lowercase ('Alegeri' / 'ALEGERI' / 'alegeri' → 'alegeri'). */
export function foldTerm(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

const URL_RE = /https?:\/\/\S+|www\.\S+/gi;
const HASHTAG_RE = /#[\p{L}\p{N}_]+/gu;
const HANDLE_RE = /@[\p{L}\p{N}_.]+/gu;
const WORD_RE = /[\p{L}][\p{L}'’-]*/gu;
const SENTENCE_END_RE = /[.!?:;\n\r]\s*$/;

export interface RawToken {
  folded: string;
  surface: string;
  kind: TermKind;
}

/**
 * Tokenize one record's combined text. Entities are tokens capitalized
 * MID-sentence in the original (sentence-initial capitals are ordinary
 * grammar); hashtags/handles are atomic. Stopwords + short + numeric
 * tokens dropped. Pure.
 */
export function tokenizeText(text: string): RawToken[] {
  const out: RawToken[] = [];
  const noUrls = text.replace(URL_RE, ' ');

  for (const m of noUrls.match(HASHTAG_RE) ?? []) {
    out.push({ folded: foldTerm(m), surface: m, kind: 'hashtag' });
  }
  for (const m of noUrls.match(HANDLE_RE) ?? []) {
    out.push({ folded: foldTerm(m), surface: m, kind: 'handle' });
  }

  // Words, tracking sentence position for the entity heuristic.
  const stripped = noUrls.replace(HASHTAG_RE, ' ').replace(HANDLE_RE, ' ');
  let prevChunk = '';
  let first = true;
  for (const chunk of stripped.split(/\s+/)) {
    if (!chunk) continue;
    const sentenceInitial = first || SENTENCE_END_RE.test(prevChunk);
    prevChunk = chunk;
    first = false;
    for (const w of chunk.match(WORD_RE) ?? []) {
      const folded = foldTerm(w);
      if (folded.length < MIN_TOKEN_LEN) continue;
      if (ALL_STOPWORDS.has(folded)) continue;
      // Mid-sentence Capitalized word (not ALL-CAPS shouting) → entity-ish.
      const isEntity =
        !sentenceInitial &&
        /^\p{Lu}/u.test(w) &&
        !/^\p{Lu}+$/u.test(w);
      out.push({ folded, surface: w, kind: isEntity ? 'entity' : 'word' });
    }
  }
  return out;
}

/** Stopword-ratio language tag — display + cluster-hygiene only. */
export function detectFingerprintLang(text: string): RecordFingerprint['lang'] {
  let en = 0;
  let ro = 0;
  for (const m of foldTerm(text).match(/[\p{L}]+/gu) ?? []) {
    if (EN_STOPWORDS.has(m)) en++;
    if (RO_STOPWORDS.has(m)) ro++;
  }
  const enReal = en >= 3;
  const roReal = ro >= 3;
  if (enReal && roReal) return 'mixed';
  if (roReal && ro > en) return 'ro';
  if (enReal && en >= ro) return 'en';
  return 'unknown';
}

// ─── Fingerprints ────────────────────────────────────────────────────────────

const ELIGIBLE_VERDICTS = new Set<string>(['flagged', 'flagged-hidden', 'pass', 'blocked']);

/** Combined analyzable text of a record (poster text + captions + what the
 *  video showed/said). */
export function recordAnalysisText(r: ForensicRecord): string {
  const vc = r.videoContext;
  return [r.originalText, r.roomCaption, vc?.description, vc?.overlayText, vc?.transcript]
    .map((t) => (t ?? '').trim())
    .filter(Boolean)
    .join('\n');
}

function isEligible(r: ForensicRecord): boolean {
  // Q38: marker records write verdict 'pass' and housekeeping originalText
  // ("[prune-marker @ ...] deleted=..."); without this filter three cap
  // prunes formed a top "theme" out of FeelingWise's own bookkeeping.
  if (isSystemMarkerRecord(r)) return false;
  if (r.verdict !== undefined && !ELIGIBLE_VERDICTS.has(r.verdict)) return false;
  return recordAnalysisText(r).length >= MIN_TOKEN_LEN;
}

interface CorpusTokens {
  record: ForensicRecord;
  text: string;
  tokens: RawToken[];
}

/**
 * Build top-k TF-IDF fingerprints for all eligible records. Two passes:
 * document frequencies first, then per-record scoring. Also returns the
 * corpus-wide most-frequent surface spelling per folded term (for labels).
 */
export function buildFingerprints(records: ForensicRecord[]): {
  fingerprints: RecordFingerprint[];
  surfaceForms: Map<string, string>;
} {
  const corpus: CorpusTokens[] = [];
  for (const r of records) {
    if (!isEligible(r)) continue;
    const text = recordAnalysisText(r);
    const tokens = tokenizeText(text);
    if (tokens.length > 0) corpus.push({ record: r, text, tokens });
  }
  // Deterministic processing order regardless of input order.
  corpus.sort((a, b) =>
    a.record.timestamp.localeCompare(b.record.timestamp) || a.record.id.localeCompare(b.record.id),
  );

  // Pass 1: document frequencies + surface-form votes.
  const df = new Map<string, number>();
  const surfaceVotes = new Map<string, Map<string, number>>();
  for (const c of corpus) {
    const seen = new Set<string>();
    for (const t of c.tokens) {
      if (!seen.has(t.folded)) {
        seen.add(t.folded);
        df.set(t.folded, (df.get(t.folded) ?? 0) + 1);
      }
      let votes = surfaceVotes.get(t.folded);
      if (!votes) surfaceVotes.set(t.folded, (votes = new Map()));
      votes.set(t.surface, (votes.get(t.surface) ?? 0) + 1);
    }
  }
  const n = corpus.length;

  // Pass 2: per-record TF-IDF, entity boost, top-k.
  const fingerprints: RecordFingerprint[] = [];
  for (const c of corpus) {
    const tf = new Map<string, { count: number; kind: TermKind }>();
    for (const t of c.tokens) {
      const cur = tf.get(t.folded);
      if (cur) {
        cur.count++;
        // Entity/hashtag/handle kind wins over plain word for the same term.
        if (cur.kind === 'word' && t.kind !== 'word') cur.kind = t.kind;
      } else {
        tf.set(t.folded, { count: 1, kind: t.kind });
      }
    }
    const terms: FingerprintTerm[] = [];
    for (const [term, { count, kind }] of tf) {
      const idf = Math.log(1 + n / (df.get(term) ?? 1));
      const boost = kind === 'word' ? 1 : ENTITY_BOOST;
      terms.push({ term, weight: count * idf * boost, kind });
    }
    terms.sort((a, b) => b.weight - a.weight || a.term.localeCompare(b.term));
    fingerprints.push({
      recordId: c.record.id,
      terms: terms.slice(0, TOP_K),
      lang: detectFingerprintLang(c.text),
      timestamp: c.record.timestamp,
      platform: c.record.platform,
      flagged: isExposureRecord(c.record),
      severity: severityWeight(c.record),
    });
  }

  const surfaceForms = new Map<string, string>();
  for (const [folded, votes] of surfaceVotes) {
    let best = '';
    let bestCount = -1;
    for (const [surface, count] of votes) {
      if (count > bestCount || (count === bestCount && surface < best)) {
        best = surface;
        bestCount = count;
      }
    }
    surfaceForms.set(folded, best);
  }
  return { fingerprints, surfaceForms };
}

// ─── Clustering ──────────────────────────────────────────────────────────────

interface Cluster {
  members: RecordFingerprint[];
  /** Sum of member term weights (centroid = sums / member count). */
  termSums: Map<string, { weight: number; kind: TermKind }>;
}

function cosine(a: Map<string, { weight: number; kind: TermKind }>, b: RecordFingerprint['terms'], aScale: number): number {
  let dot = 0;
  let bNorm = 0;
  for (const t of b) {
    bNorm += t.weight * t.weight;
    const av = a.get(t.term);
    if (av) dot += (av.weight * aScale) * t.weight;
  }
  if (dot === 0) return 0;
  let aNorm = 0;
  for (const v of a.values()) {
    const s = v.weight * aScale;
    aNorm += s * s;
  }
  return dot / (Math.sqrt(aNorm) * Math.sqrt(bNorm));
}

function centroidTop(c: Cluster, k: number): FingerprintTerm[] {
  const out: FingerprintTerm[] = [];
  for (const [term, v] of c.termSums) {
    out.push({ term, weight: v.weight / c.members.length, kind: v.kind });
  }
  out.sort((a, b) => b.weight - a.weight || a.term.localeCompare(b.term));
  return out.slice(0, k);
}

function addToCluster(c: Cluster, fp: RecordFingerprint, index: Map<string, Set<Cluster>>): void {
  c.members.push(fp);
  for (const t of fp.terms) {
    const cur = c.termSums.get(t.term);
    if (cur) {
      cur.weight += t.weight;
      if (cur.kind === 'word' && t.kind !== 'word') cur.kind = t.kind;
    } else {
      c.termSums.set(t.term, { weight: t.weight, kind: t.kind });
      let set = index.get(t.term);
      if (!set) index.set(t.term, (set = new Set()));
      set.add(c);
    }
  }
}

function clusterFingerprints(fingerprints: RecordFingerprint[]): Cluster[] {
  const clusters: Cluster[] = [];
  const index = new Map<string, Set<Cluster>>();

  for (const fp of fingerprints) {
    const candidates = new Set<Cluster>();
    for (const t of fp.terms) {
      for (const c of index.get(t.term) ?? []) candidates.add(c);
    }
    let best: Cluster | null = null;
    let bestSim = 0;
    for (const c of candidates) {
      const sim = cosine(c.termSums, fp.terms, 1 / c.members.length);
      if (sim > bestSim) {
        bestSim = sim;
        best = c;
      }
    }
    if (best && bestSim >= JOIN_SIMILARITY) {
      addToCluster(best, fp, index);
    } else {
      const c: Cluster = { members: [], termSums: new Map() };
      addToCluster(c, fp, index);
      clusters.push(c);
    }
  }

  // Merge sweep: fold clusters whose centroids overlap strongly. Candidates
  // limited to clusters sharing a top-5 centroid term — bounded, no N².
  const merged = new Set<Cluster>();
  for (let i = 0; i < clusters.length; i++) {
    const a = clusters[i];
    if (merged.has(a)) continue;
    const aTop = centroidTop(a, 5);
    for (let j = i + 1; j < clusters.length; j++) {
      const b = clusters[j];
      if (merged.has(b)) continue;
      if (!aTop.some((t) => b.termSums.has(t.term))) continue;
      const sim = cosine(a.termSums, centroidTop(b, TOP_K), 1 / a.members.length);
      if (sim >= MERGE_SIMILARITY) {
        for (const m of b.members) addToCluster(a, m, new Map());
        merged.add(b);
      }
    }
  }
  return clusters.filter((c) => !merged.has(c));
}

// ─── Theme assembly ──────────────────────────────────────────────────────────

async function themeFromCluster(
  c: Cluster,
  surfaceForms: Map<string, string>,
  dayKeyOf: (ts: string) => string,
): Promise<Theme> {
  const topTerms = centroidTop(c, 8);
  const idBasis = topTerms.slice(0, 5).map((t) => t.term).sort().join('|');
  const id = (await sha256(idBasis)).slice(0, 16);

  const label = topTerms
    .slice(0, LABEL_TERMS)
    .map((t) => surfaceForms.get(t.term) ?? t.term)
    .join(' · ');

  const perDayCounts: Record<string, number> = {};
  const platforms: Record<string, number> = {};
  let flaggedCount = 0;
  let severitySum = 0;
  let start = c.members[0].timestamp;
  let end = c.members[0].timestamp;
  for (const m of c.members) {
    const day = dayKeyOf(m.timestamp);
    perDayCounts[day] = (perDayCounts[day] ?? 0) + 1;
    platforms[m.platform] = (platforms[m.platform] ?? 0) + 1;
    if (m.flagged) flaggedCount++;
    severitySum += m.severity;
    if (m.timestamp < start) start = m.timestamp;
    if (m.timestamp > end) end = m.timestamp;
  }

  return {
    id,
    label,
    topTerms,
    memberRecordIds: c.members.map((m) => m.recordId),
    recordCount: c.members.length,
    dateSpan: { start, end },
    daysActive: Object.keys(perDayCounts).length,
    perDayCounts,
    platforms,
    flaggedCount,
    severitySum,
    topEntities: topTerms.filter((t) => t.kind !== 'word').map((t) => surfaceForms.get(t.term) ?? t.term),
  };
}

/**
 * Cluster the record set into themes. Deterministic: records are processed
 * in timestamp order regardless of input order. Clusters smaller than
 * MIN_THEME_SIZE are dropped (coincidence, not a theme). Returns themes
 * sorted by recordCount desc + a recordId → themeId assignment for the
 * session-drift consumer (slice 2).
 */
export async function buildThemes(
  records: ForensicRecord[],
  opts?: { dayKeyOf?: (ts: string) => string },
): Promise<{
  themes: Theme[];
  assignment: Map<string, string>;
  fingerprintCount: number;
}> {
  // UTC unless the caller says otherwise, because this file sits in the
  // forensics layer and must answer the same on every machine. The dashboard
  // passes localDayKey: perDayCounts is what the streak grid is INDEXED by, and
  // the grid's own seven columns are the reader's local days. Two day
  // definitions on one grid means every square is empty (2026-09-18).
  const dayKeyOf = opts?.dayKeyOf ?? ((ts: string) => ts.slice(0, 10));
  const { fingerprints, surfaceForms } = buildFingerprints(records);
  const clusters = clusterFingerprints(fingerprints).filter(
    (c) => c.members.length >= MIN_THEME_SIZE,
  );

  const themes: Theme[] = [];
  const assignment = new Map<string, string>();
  for (const c of clusters) {
    const theme = await themeFromCluster(c, surfaceForms, dayKeyOf);
    themes.push(theme);
    for (const rid of theme.memberRecordIds) assignment.set(rid, theme.id);
  }
  themes.sort((a, b) => b.recordCount - a.recordCount || b.daysActive - a.daysActive || a.id.localeCompare(b.id));
  return { themes, assignment, fingerprintCount: fingerprints.length };
}
