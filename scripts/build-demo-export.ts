/**
 * Build the public example exports: the full demo (written as example-export-full.html) and landing/example-export.html
 *
 * WHY THIS EXISTS
 * The forensic HTML export is already a feed viewer — self-contained,
 * scrollable, filterable, verifiable, no software required. That makes it the
 * best product demo FeelingWise owns, and until now it has only ever been
 * pointed at one family's private record.
 *
 * WHY IT IS SYNTHETIC AND NOT A SANITISED REAL CHAIN
 * The real 19,259-record export holds 9,982 distinct real author handles, 9,630
 * real post URLs and ~2.0M characters of other people's writing verbatim.
 * Blurring the handle does not anonymise it: the text is verbatim and `postUrl`
 * links home, so one paste into platform search reverses it. Anonymising hard
 * enough to be safe means regenerating every post — which is this file.
 * Decision and gate: `.brain/IDEAS_LOG.md`, 2026-08-04.
 *
 * WHAT IS REAL HERE
 * The SHAPES. Platform split, kind split, verdict split and technique frequency
 * are taken from the 10-day chain of 2026-07-25..2026-08-04. The shape is what
 * persuades; no individual post has to be real for the shape to be true.
 *
 * HOW IT ANNOUNCES ITSELF
 * A forensic product shipping a realistic-looking fake record would poison every
 * real export handed to a school or a lawyer. So the file says what it is from
 * the inside: a four-sentence notice at the very top (`topNotice`), `fwVersion`
 * and the precision line all state it, and every author handle is visibly
 * generated. The signatures are genuine over a demo key, so the built-in
 * verifier goes green — which is the point, it proves the mechanism while the
 * first paragraph states the data is invented.
 *
 * POSTS FIRST, IMPRESSIONS SECOND (rewritten 2026-09-18)
 * Until today this file drew a verdict, then a technique, then picked a TEXT to
 * fit, once per record. So one post was judged afresh every time it appeared:
 * 40 of the 44 distinct texts carried a different overallScore across their
 * repetitions and 14 carried two different verdicts, on the file whose whole
 * pitch is that the same record always reads the same way. The product does the
 * opposite — a judged text keeps its answer, which is what its cache is for.
 *
 * So the generator now builds a ROSTER: a judgement per TEXT (decided once),
 * posts that carry one of those texts plus an identity (platform, kind, author,
 * url), and then 1,500 IMPRESSIONS of those posts. An impression varies only
 * what genuinely varies between two sightings — the timestamp, the surface it
 * appeared on, and the engagement counts, which only ever go up. Everything the
 * judge decided is fixed on the post.
 *
 * Three of the export's own panels were dead because of the old shape and are
 * alive now: "popularity over time" needs a postUrl seen twice, "recurring
 * voices" needs an author on three distinct days, and the seen-before filter
 * needs a repeated content identity.
 *
 * DETERMINISM, precisely. The record content is deterministic: a seeded RNG and
 * a fixed key mean every id, timestamp, text, technique and integrityHash is
 * byte-identical across runs (verified by stripping signatures and comparing).
 * The FILE is not byte-identical, because ECDSA draws a fresh random nonce for
 * every signature, so 1,500 signatures differ on each run. That is inherent to
 * the algorithm, not a defect here, and it is why this script should be re-run
 * when the exporter or the shapes change rather than casually: each run rewrites
 * 1.6 MB in git even when nothing meaningful moved.
 *
 *   npx tsx scripts/build-demo-export.ts                  rebuild from the committed anchors
 *   npx tsx scripts/build-demo-export.ts --fetch-anchors  ask two authorities for fresh anchors first
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { attachSignedManifest, buildForensicHtmlExport } from '../src/forensics/html-export';
import { computeRecordIntegrityHash } from '../src/forensics/canonical-payload';
import { buildMethodologyBlock } from '../src/forensics/methodology';
import { buildTimeStampReq, parseTimeStampResp, verifyTimeStampToken } from '../src/forensics/rfc3161';
import type { DecisionAction, DecisionBlock, ForensicRecord, RecordMetrics } from '../src/types/forensic';
import type { ChainAnchor } from '../src/types/chain-anchor';
import { underFixedClock } from './fixed-clock';
// The decision block is derived, never written by hand: the same pure module the
// content paths call (src/content/record/decision.ts), which reads only
// core/policy/why and core/policy/table and touches no chrome.* and no settings,
// so it imports cleanly into this Node script. Restating a row here instead
// would have been a fourth copy of the policy table in a file whose whole claim
// is that the shapes are the product's own.
import { decisionForLegacy, decisionForMask, READER_DEFAULT } from '../src/content/record/decision';
// The swear mask's two halves, taken from the product rather than restated: the
// filter that writes the stars (the same call src/analysis/pipeline.ts makes,
// with no region, so the global word lists decide) and the map from an action to
// the verdict the record carries. Both are pure and touch no chrome.*.
import { maskProfanity } from '../src/core/profanity-filter';
// The block-list matcher itself, for the same reason `maskProfanity` is called
// rather than copied: the demo must show what the product would do with these
// exact sentences, not what this file asserts it would do. Pure module, no
// chrome.*, no DOM (src/core/parent-blocklist.ts:1-6).
import { matchParentBlocklist, readParentBlocklist } from '../src/core/parent-blocklist';
import { verdictFor } from '../src/core/policy/table';
import { levelOf } from '../src/types/mode';

/**
 * Independent time for the demo. Until 2026-09-17 the demo carried no anchor and its first
 * screen said "no independent time stamp", while every letter that pointed at it promised one
 * (found by the recipients' reads of the letters, PLAN-2026-09-17 section 8). The anchors are real
 * RFC 3161 tokens from two authorities over the demo chain's own hashes, fetched once with
 * `--fetch-anchors` and committed in ANCHOR_FIXTURE, because the record content is deterministic
 * (the hashes never move between runs) and a rebuild should not need the network. A rebuild checks
 * that the fixture's hashes are still the chain's; when the shapes change, fetch again.
 *
 * The authorities are the ones the extension asks (src/forensics/tsa-client.ts, TSA_ENDPOINTS),
 * listed here rather than imported because that module reaches for chrome.* through the licence
 * store and this script runs under Node. The token is verified the way the extension verifies it
 * before storing (finishAnchor there): the imprint, the nonce, the signature, and a pinned root.
 */
// Each example keeps its own committed stamps: both sign under a fixed key, so their hashes repeat.
const ANCHOR_FIXTURE = resolve(process.cwd(), 'scripts', process.env.FW_DEMO_PROFILE === 'example' ? 'example-anchors.json' : 'demo-anchors.json');
const ANCHORED_POSITIONS = [749, 1499];
const TSA_ENDPOINTS = [
  { id: 'freetsa', url: 'https://freetsa.org/tsr' },
  { id: 'digicert', url: 'http://timestamp.digicert.com' },
  { id: 'sectigo', url: 'http://timestamp.sectigo.com' },
] as const;
interface AnchorFixture { position: number; integrityHash: string; anchors: ChainAnchor[] }

async function fetchAnchor(endpoint: { id: string; url: string }, position: number, hashHex: string): Promise<ChainAnchor | null> {
  const req = buildTimeStampReq(hashHex);
  let bytes: Uint8Array;
  try {
    const resp = await fetch(endpoint.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/timestamp-query' },
      body: req.der as BodyInit,
      signal: AbortSignal.timeout(15_000),
    });
    if (!resp.ok) { console.error(`  ${endpoint.id}: http ${resp.status}`); return null; }
    bytes = new Uint8Array(await resp.arrayBuffer());
  } catch (e) {
    console.error(`  ${endpoint.id}: ${(e as Error).message}`);
    return null;
  }
  let token = bytes;
  try {
    const parsed = parseTimeStampResp(bytes);
    if (parsed.status !== 0 && parsed.status !== 1) { console.error(`  ${endpoint.id}: rejected, status ${parsed.status}`); return null; }
    if (parsed.token) token = parsed.token;
  } catch { /* a bare token; verification decides */ }
  const v = await verifyTimeStampToken(token, hashHex, req.nonceHex);
  if (!v.ok || !v.knownRootName) {
    console.error(`  ${endpoint.id}: not stored (${v.checks.filter(c => !c.ok).map(c => c.name).join(',') || v.error || 'unrecognised authority'})`);
    return null;
  }
  const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64');
  return {
    // Deterministic id and requestedAt: the fixture is committed and must not churn.
    id: `${PROFILE}-anchor-${position}-${endpoint.id}`,
    anchoredChainPosition: position,
    anchoredIntegrityHash: hashHex,
    tsaProvider: endpoint.id,
    responseB64: b64(bytes),
    tstB64: b64(token),
    generalizedTime: v.genTime,
    requestedAt: v.genTime ?? new Date().toISOString(),
    route: 'direct',
    verification: {
      ok: v.ok,
      signerSubject: v.signerSubject,
      rootCertSha256: v.rootCertSha256,
      knownRootName: v.knownRootName,
      checks: v.checks.map(c => ({ name: c.name, ok: c.ok, detail: c.detail })),
    },
  };
}

/** Two authorities per anchored position, rotated by the hash as the extension rotates them. */
async function fetchAnchors(records: ForensicRecord[], positions: readonly number[] = ANCHORED_POSITIONS): Promise<AnchorFixture[]> {
  const out: AnchorFixture[] = [];
  for (const position of positions) {
    const hash = records[position]!.integrityHash;
    const offset = parseInt(hash.slice(-2), 16) % TSA_ENDPOINTS.length;
    const anchors: ChainAnchor[] = [];
    console.log(`anchoring position ${position} (${hash.slice(0, 12)}…)`);
    for (let i = 0; i < TSA_ENDPOINTS.length && anchors.length < 2; i++) {
      const a = await fetchAnchor(TSA_ENDPOINTS[(i + offset) % TSA_ENDPOINTS.length]!, position, hash);
      if (a) { anchors.push(a); console.log(`  ${a.tsaProvider}: ${a.generalizedTime} (${a.verification?.knownRootName})`); }
    }
    if (anchors.length === 0) throw new Error(`no authority answered for position ${position}`);
    out.push({ position, integrityHash: hash, anchors });
  }
  return out;
}

/**
 * How much of the text the page carried, for one demo record.
 *
 * WHY IT IS DERIVED FROM THE HASH AND NOT FROM rnd(). Every draw from the
 * seeded generator moves the stream, so taking one here would change every
 * value drawn after it and rewrite the whole file for a field nobody asked to
 * move. This reads four hex digits of the record's own originalHash instead:
 * deterministic, reproducible, and inert with respect to everything else.
 *
 * WHY ONLY TWO OF THE FOUR VALUES APPEAR. 'cut' is set at the one share that
 * has been measured: 9.3 percent of real items end in a truncation marker and
 * 36.8 percent of them on Facebook (docs/README.md findings table, from
 * docs/research/RESEARCH-LOG.md entry 5). Everything else is 'whole'. The split
 * between 'whole' and 'folded' has never been measured and this file does not
 * invent one, because a demo carrying a made-up distribution is a demo somebody
 * eventually quotes as a finding. 'platform' is absent for the same reason.
 *
 * Added 2026-09-21, after verifier/observations.mjs was run over the published
 * demo and reported all 1,325 projected rows as "unknown" capture. The recorder
 * writes this field (src/forensics/logger.ts:138 and seven more); this
 * generator never did, so the public sample did not exercise it.
 */
function textCaptureForDemo(platform: string, originalHash: string): 'whole' | 'cut' {
  const cutShare = platform === 'facebook' ? 0.368 : 0.093;
  return parseInt(originalHash.slice(0, 4), 16) / 0x10000 < cutShare ? 'cut' : 'whole';
}

/** The committed anchors, checked against this build's hashes. */
function loadAnchors(records: ForensicRecord[]): ChainAnchor[] {
  if (!existsSync(ANCHOR_FIXTURE)) throw new Error(`${ANCHOR_FIXTURE} is missing: run with --fetch-anchors once (it asks two public time-stamp authorities)`);
  const fixture = JSON.parse(readFileSync(ANCHOR_FIXTURE, 'utf8')) as AnchorFixture[];
  for (const f of fixture) {
    const actual = records[f.position]?.integrityHash;
    if (actual !== f.integrityHash) {
      throw new Error(`the anchor over position ${f.position} was taken over ${f.integrityHash.slice(0, 12)}… and this build's record there hashes ${String(actual).slice(0, 12)}…: the record shapes changed, run with --fetch-anchors again`);
    }
  }
  return fixture.flatMap(f => f.anchors);
}

/**
 * Two files come out of this generator.
 *
 * 'demo' is the full demo, written as example-export-full.html: ten days, 1,500 sightings, read by the AI judge, with two real
 * time stamps. 'example' (FW_DEMO_PROFILE=example, `npm run gen:example`) is
 * landing/example-export.html: one week of what an install WITHOUT a licence key writes, which is
 * most installs, since no key is sold. Every difference follows from the product's own paths:
 *   - No model reads anything. A feed item no rule acts on is written by logSkippedEvent
 *     (src/forensics/logger.ts) as verdict 'skipped', skipReason 'free-tier-no-ai', aiSource 'rules',
 *     no technique, no model. The rules above the licence check still act and still write: the
 *     household's block list, the platform's ad marker and the swear mask (src/analysis/pipeline.ts
 *     runs them before the `tierCap === 0` exit).
 *   - No comment records. Without a key a comment that no rule hides is a silent pass that writes
 *     nothing (src/content/comment-batch/flush.ts, "Free-tier / cap-reached").
 *   - A test key kept in tests/fixtures/verifier-vectors/, so a rebuild moves only its signatures. It
 *     signs invented records only, and anyone can sign under it, as under the demo's key.
 *   - Real time stamps over the middle and the last record, asked of two of the extension's
 *     authorities once with --fetch-anchors and kept in scripts/example-anchors.json. They are signed when asked,
 *     after the invented week, and the file's first paragraph says so: a stamp is never dated
 *     inside the week it covers.
 */
const PROFILE: 'demo' | 'example' = process.env.FW_DEMO_PROFILE === 'example' ? 'example' : 'demo';
const EXAMPLE = PROFILE === 'example';
// FW_DEMO_COUNT and FW_DEMO_OUT build a larger file elsewhere for load
// measurement (PLAN-2026-09-14 item 6: 10,000 records); the defaults are the
// public demo and the example.
const RECORD_COUNT = Number(process.env.FW_DEMO_COUNT ?? (EXAMPLE ? 320 : 1500));
const WINDOW_START = EXAMPLE ? Date.UTC(2026, 8, 28, 6, 41, 10) : Date.UTC(2026, 6, 25, 15, 23, 30);
const WINDOW_END = EXAMPLE ? Date.UTC(2026, 9, 4, 21, 52, 40) : Date.UTC(2026, 7, 4, 21, 12, 54);
// process.cwd(), not import.meta.dirname: tsx transpiles this to CJS and
// import.meta.dirname comes through undefined. Run from the project root.
// The full demo is written as example-export-full.html, the site's name for it: landing/demo.html is the
// site's /demo page, which a default run must never overwrite.
const OUT = process.env.FW_DEMO_OUT ?? resolve(process.cwd(), 'landing', EXAMPLE ? 'example-export.html' : 'example-export-full.html');
// The public source has no landing/ folder: say so before building, instead of failing on the write
// after a minute of work (PLAN-2026-09-16 item 2.10).
if (!existsSync(dirname(OUT))) {
  console.error(`no folder for ${OUT}: this tree has no landing/. Set FW_DEMO_OUT=<file> to write the demo elsewhere.`);
  process.exit(2);
}

/* ---------- deterministic RNG (mulberry32) ---------- */
let seed = 0x5eed1e;
function rnd(): number {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;
function weighted<T extends string>(table: Record<T, number>): T {
  const entries = Object.entries(table) as [T, number][];
  const total = entries.reduce((a, [, w]) => a + w, 0);
  let r = rnd() * total;
  for (const [k, w] of entries) { r -= w; if (r <= 0) return k; }
  return entries[entries.length - 1]![0];
}
const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
/** An index into `weights`, proportional to them. */
function weightedIndex(weights: readonly number[]): number {
  const total = weights.reduce((a, w) => a + w, 0);
  let r = rnd() * total;
  for (let i = 0; i < weights.length; i++) { r -= weights[i]!; if (r <= 0) return i; }
  return weights.length - 1;
}
/** Fisher-Yates on the seeded RNG, so the order is the same on every run. */
function shuffle<T>(xs: T[]): T[] {
  for (let i = xs.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [xs[i], xs[j]] = [xs[j]!, xs[i]!];
  }
  return xs;
}
/**
 * Exact counts that sum to `total`, apportioned by the table's weights
 * (largest remainder).
 *
 * The three mixes this file claims — platform, item kind and verdict — are
 * dealt out rather than drawn, because the demo's one genuinely true sentence
 * is that they come from a real chain, and a reader who measures them is
 * entitled to find the number they were told. Drawing them per record left that
 * sentence at the mercy of the seed: the first build of the roster rewrite put
 * the acted share at 10.4% against the chain's 8.5%, a 23% error on the single
 * number the file is about, with nothing wrong anywhere in the code.
 */
function quota<T extends string>(total: number, table: Record<T, number>): Record<T, number> {
  const entries = Object.entries(table) as [T, number][];
  const sum = entries.reduce((a, [, w]) => a + w, 0);
  const out = {} as Record<T, number>;
  let used = 0;
  for (const [k, w] of entries) { out[k] = Math.floor((total * w) / sum); used += out[k]; }
  const rest = entries
    .map(([k, w]) => [k, (total * w) / sum - Math.floor((total * w) / sum)] as [T, number])
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  for (let i = 0; used < total; i++, used++) out[rest[i % rest.length]![0]]++;
  return out;
}
/** `n` of the given values, dealt out and shuffled. */
function deal<T extends string>(total: number, table: Record<T, number>): T[] {
  const counts = quota(total, table);
  const out: T[] = [];
  for (const k of Object.keys(counts) as T[]) for (let i = 0; i < counts[k]; i++) out.push(k);
  return shuffle(out);
}

/* ---------- distributions, measured from the real 10-day chain ---------- */
const PLATFORM = { twitter: 12840, facebook: 4252, tiktok: 1815, instagram: 222, youtube: 130 } as const;
const KIND = { post: 10398, comment: 2764, video: 2368, image: 2123, 'top-comment': 484 } as const;
type Platform = keyof typeof PLATFORM;
type Kind = keyof typeof KIND;
/**
 * The kinds the file holds. Without a key a comment is written only when a rule hides it, and none
 * of the example household's rules is reached on the comment path (the block list and the ad
 * marker are post-path gates), so the example holds the top-level kinds only, at their measured mix.
 */
const KIND_IN_FILE = (EXAMPLE ? { post: KIND.post, video: KIND.video, image: KIND.image } : KIND) as Record<Kind, number>;
/**
 * The measured verdict split, over the items a JUDGE read.
 *
 * Paid placements are drawn separately (see AD_RATE) and are not in this table:
 * an ad is a category, never a finding (standing decision 1, 2026-09-14), it is
 * in no flag count and no severity, and the export reports it on its own row.
 * Folding it in here would have made "verdict mix" a claim about two different
 * populations at once.
 */
const VERDICT = { pass: 17417, acted: 1318 + 292 } as const;
/**
 * The techniques a FLAGGED record carries, at the frequencies measured on the
 * 10-day chain.
 *
 * `genuine-opinion` is deliberately not in this list, and was until 2026-09-17,
 * with the largest weight of all (2,081). It is not a technique: it is what the
 * judge answers when it decides an item is a real point and should NOT be
 * flagged ("if a point survives, it is an ARGUMENT or an OPINION →
 * genuine-opinion", src/ai/prompts-v2.ts). A pass here carries no techniques at
 * all, so that weight landed only on acted-on records, and the demo's own
 * summary then read "Most common techniques flagged: a real opinion, 52" — on
 * the file the letters ask a researcher to open, about the one thing a
 * researcher tests first. The measured number is kept in this note rather than
 * deleted: whether the real chain also carries that label on flagged records is
 * a question about the judge, and it belongs in a reading of a real export, not
 * in a generator.
 */
const TECHNIQUE = {
  profanity: 448, 'violence-graphic': 434, 'anger-trigger': 429,
  combined: 358, 'shame-attack': 348, 'false-urgency': 322, 'fear-appeal': 264,
  'body-comparison-priming': 225, sexual: 166, 'consumer-rapid-frame': 131,
  scapegoating: 129, 'misleading-format': 128, fomo: 94, 'drug-promotion': 70,
  'unsafe-health-experiment': 33, 'self-harm': 20, mockery: 10, 'extreme-toxicity': 8,
} as const;
type Technique = keyof typeof TECHNIQUE;

/**
 * The techniques whose items are HIDDEN behind the marker rather than softened.
 *
 * Until 2026-09-18 the verdict was drawn before the technique, so hidden was a
 * coin flip: "[hidden: self-harm content]" could be written as an ordinary
 * flagged record with that bracket as its visible, unsoftened text, and an
 * everyday swearing line could be written hidden. Whether an item is hidden is
 * a consequence of what it is, not a second draw, so the set decides it here.
 *
 * The resulting hidden share of acted records falls out of the technique
 * weights above and lands at 20%, against the 18.1% the chain measured
 * (292 of 1,610). Close enough that modelling it as a consequence costs
 * nothing and buys a file that cannot contradict itself.
 */
const HIDDEN_TECHNIQUES = new Set<Technique>([
  'violence-graphic', 'sexual', 'drug-promotion', 'unsafe-health-experiment', 'self-harm', 'extreme-toxicity',
]);

/**
 * How often a paid placement arrived, per platform.
 *
 * INVENTED, and the one number in this file that is not measured. The chain's
 * own technique table cannot separate an ad from a judge's verdict: the teen
 * pipeline writes a platform ad marker as `consumer-rapid-frame` at severity 6
 * (src/analysis/pipeline.ts, the `is_sponsored` branch), so ads and genuine
 * sales-pressure verdicts share one bucket of 131. Taking ads out of that
 * bucket would have put four ads in 1,500 items across five platforms over four
 * days, which is not a feed anybody has seen. So they are drawn as their own
 * stream, at rates chosen to sit inside what the platforms themselves publish,
 * and they displace nothing: the judged records keep the measured verdict mix
 * exactly.
 *
 * Found 2026-09-18: the file had 1,500 items, five platforms, four days and not
 * one paid placement, so the export's paid-placement row, its advertiser
 * placement reading and its ad-marker rule row all rendered as nothing at all.
 */
const AD_RATE: Record<Platform, number> = {
  twitter: 0.055, facebook: 0.075, instagram: 0.085, tiktok: 0.065, youtube: 0.04,
};

/**
 * The surface an impression arrived on, per platform.
 *
 * Every record said `feedSource: 'home'` until 2026-09-18. 'home' is not in the
 * FeedSource union (src/types/post.ts) at all, so `surfaceBucket` folded all
 * 1,500 into 'other', the file's own For You filter answered "nothing in this
 * file", and the demo could not show the one distinction the product exists to
 * record: whether the platform CHOSE to serve an item or the person went
 * looking for it.
 *
 * The weights are a model, not a measurement, and they are deliberately
 * recommendation-heavy: that is the claim the product makes about feeds, and a
 * demo that buried it would be arguing against itself. 'video' is the watch
 * surface, which is where most of a video platform's serving happens; 'manual'
 * is a record the person saved by hand and is left at zero, because nobody
 * saved anything in an invented week.
 */
const SURFACE: Record<Platform, Record<string, number>> = {
  twitter: { 'for-you': 55, following: 28, profile: 6, permalink: 5, search: 4, unknown: 2 },
  facebook: { 'for-you': 40, following: 34, permalink: 10, profile: 8, search: 5, unknown: 3 },
  instagram: { 'for-you': 45, following: 30, profile: 12, video: 8, search: 3, unknown: 2 },
  tiktok: { 'for-you': 70, following: 10, video: 12, profile: 3, search: 3, unknown: 2 },
  youtube: { video: 55, 'for-you': 25, search: 10, following: 5, permalink: 3, unknown: 2 },
};

/* ---------- synthetic voices. Invented handles, obviously generated. ---------- */
const HANDLE_A = ['quiet', 'north', 'paper', 'amber', 'salt', 'ember', 'violet', 'copper', 'wren',
  'harbour', 'lantern', 'meadow', 'cobalt', 'thistle', 'juniper', 'marble', 'rook', 'clover'];
const HANDLE_B = ['fox', 'lane', 'field', 'drift', 'cove', 'ridge', 'moth', 'pine', 'gate',
  'harbor', 'finch', 'bell', 'stone', 'hollow', 'reef', 'vale', 'crow', 'birch'];
/** Advertiser handles read like accounts, not people, and name no real trade. */
const AD_SUFFIX = ['supply', 'direct', 'studio', 'labs', 'goods', 'works', 'store', 'co'];

/**
 * How many distinct accounts the invented week contains.
 *
 * A handle per record (1,461 of them for 1,500 records, which is what this file
 * had) is not a feed, it is a directory. It also killed the export's recurring
 * voices panel, which asks for an author seen on three separate days and found
 * none. A few hundred accounts, drawn with a long tail, gives the panel
 * something true to read.
 */
const AUTHOR_COUNT = 190;
const ADVERTISER_COUNT = 14;
/** Impressions per post, on average. 1,500 impressions over roughly 620 posts. */
const IMPRESSIONS_PER_POST = 2.4;

/* Benign posts. These are the 90% that pass, and the demo is dishonest without
   them: a filter looks omniscient if you only show it the things it caught.

   Widened from 20 to 110 on 2026-09-18. The old roster put one text on up to 80
   records, and the export counts a unique post by its TEXT hash
   (export-numbers.ts, contentIdentity), so the first sentence on the page read
   "1,500 impressions of 44 posts". Every line here has to hold the same rule:
   ordinary, first person or a flat observation, no name, no place, no event, no
   brand, nothing that could be looked up, and nothing that could be mistaken for
   a sentence a real person wrote somewhere. That rule, not effort, is what caps
   this list: a bigger roster is only worth having while every line in it is
   still safely nobody's. */
const BENIGN = [
  'finally got the sourdough starter to behave. four attempts.',
  'the bus was late again so I walked. no regrets, the light was unreal.',
  'anyone else think the second season was better than the first',
  'my cat has decided the printer is her enemy and I respect the commitment',
  'three hours on this bug and it was a missing comma. three hours.',
  'took the long way home past the canal. worth it.',
  'genuinely good coffee for once, near the station, going back tomorrow',
  'reading the same paragraph over and over. brain is offline today.',
  'the tomatoes came through. absolutely nothing else did, but the tomatoes came through.',
  'watched the whole thing in one sitting and I have opinions',
  'trying to learn bass at 34 and my fingers hate me',
  'rain all week and somehow I do not mind it',
  'if anyone has a good recipe for lentils that is not soup, I am listening',
  'the library got new chairs and it has changed my entire relationship with Thursdays',
  'small win: inbox is empty. it will not last.',
  'nobody warned me that plants are a personality',
  'that album still holds up fifteen years later',
  'walked past a shop selling only buttons. thousands of buttons. how.',
  'my sister sent me a photo of a very round bird and it fixed my whole afternoon',
  'day two of trying to fix the tap. the tap is winning.',
  'put the washing out and it rained within eleven minutes. a personal record.',
  'started the puzzle in march. finished the sky today. the sky took four months.',
  'I do not understand the appeal of standing desks and I have tried, twice',
  'someone has left a perfectly good chair by the bins and I am thinking about it',
  'the neighbour has taken up the trumpet. early days for both of us.',
  'made a list of everything I was worried about and half of it was the same thing',
  'apparently I have been pronouncing it wrong for eleven years',
  'the bread did not rise but it tastes fine so we are calling it flatbread',
  'three buses at once, then none for forty minutes. the classic arrangement.',
  'finally replaced the lightbulb in the hall. it has been eight months.',
  'I like a film that trusts you to keep up',
  'took a different route to work and found an entire street I did not know existed',
  'the dog has learned which drawer the treats are in and now we have a problem',
  'made soup. put too much salt in. added a potato. crisis averted.',
  'my handwriting has got so bad I could not read my own shopping list',
  'sat outside for twenty minutes doing nothing and it was the best part of the week',
  'the kettle makes a new noise now. I have decided not to investigate.',
  'learning to say no is going about as well as you would expect',
  'got the window open for the first time this year and the house smells different',
  'I have read four pages of this book eleven times',
  'the bike has a puncture again and I am starting to take it personally',
  'someone at the shop told me the trick for keeping herbs alive. no notes, just gratitude.',
  'fell asleep on the sofa at nine and woke at two and now here we are',
  'the good pen has gone missing. all pens are now suspects.',
  'went for a swim and remembered I like swimming. this happens every year.',
  'I have cleaned the kitchen properly and now I resent anyone who enters it',
  'tried to take a photo of the moon. got a small white smudge. as tradition demands.',
  'the plan was a quiet evening and the plan is holding',
  'the coat has been on the back of the chair since february and we have made peace',
  'I have started walking the long way round on purpose and it has improved my entire week',
  'four different chargers in this drawer and not one of them fits anything I own',
  'apparently the trick with rice is to leave it alone. eleven years of stirring, wasted.',
  'woke up convinced it was a weekday. it was not. best two minutes of the month.',
  'the plant I was sure had died has put out a leaf. I have apologised to it.',
  'made a shopping list, left it at home, bought everything except what I went for',
  'my tolerance for standing in queues has fallen off a cliff and I cannot explain it',
  'the thing about a long bath is that it is never as long as you planned',
  'someone has painted their front door a colour I have been thinking about ever since',
  'a whole afternoon on the sofa with a book. no notes. this is the review.',
  'the fridge hum has changed pitch. the fridge and I are both aware of this.',
  'started a new notebook and the first page is already crossed out twice',
  'I have discovered I can cook exactly six things well and that is apparently enough',
  'the wind took the bin lid halfway down the street and I ran after it like a child',
  'finished a job I had been putting off for a month. it took nine minutes.',
  'my ability to find a lost item improves dramatically once I stop looking for it',
  'came home to a silent house and sat in it for a while before turning anything on',
  'the trick is to start before you feel like it. I have known this for years and still forget.',
  'cut my own fringe again. we are in the regret phase.',
  'I had forgotten how good it feels to write something down with an actual pen',
  'the tea went cold. made another. that one went cold too. it is one of those days.',
  'there is a cat on the wall opposite who watches me work and I have started performing for it',
  'bought the smaller size of everything and the cupboard finally shuts',
  'walked to the top and it was worth every complaint I made on the way up',
  'the socks come out of the machine in pairs and leave the drawer alone. an old mystery.',
  'I have decided to stop apologising for liking simple food',
  'it got dark at four and I took it personally',
  'the recipe said twenty minutes and it took an hour and ten. it always does.',
  'nothing went wrong today and I want that on the record',
  'moved the desk to face the window and my whole relationship with mornings changed',
  'my phone thinks I am asleep. my phone is optimistic.',
  'I keep buying the same book. three copies now. it is a good book.',
  'the bread knife has gone. every knife in this house is now under suspicion.',
  'said yes to something I would normally avoid and it was completely fine',
  'have reached the age where a good chair is genuinely exciting',
  'the walk is twenty minutes and the podcast is fifty, so I have started taking the long way',
  'spent an hour tidying one shelf and it has fixed something in my head',
  'made a list of everything I have finished this year and it was longer than I expected',
  'the milk was off and that is the whole story of my morning',
  'someone left a plant on the wall with a note saying free. reader, I took the plant.',
  'I have never once regretted going outside and I still have to argue with myself about it',
  'the trousers fit again and no, I do not know what changed',
  'turns out the noise was the pipes all along. two weeks of low-level dread, resolved.',
  'reading before bed instead of scrolling, day four, cautiously optimistic',
  'a good loaf, a sharp knife and nothing to do. the whole afternoon, sorted.',
  'I have been pronouncing my own street name the lazy way for a decade',
  'the bus driver waited for the man running and the whole bus relaxed at once',
  'put the heating on for the first time and the house made an entirely new noise',
  'I have finally learned to leave the last ten minutes of a film alone and just watch it',
  'my handwriting is best in the first paragraph and then gives up entirely',
  'ordered the same thing I always order and enjoyed it exactly as much as usual',
  'the old radio still works. everything modern in this room does not.',
  'took the batteries out of the clock because the ticking was too loud to think',
  'I have started saying no to things three weeks ahead and it feels like cheating',
  'the washing up can wait. this is a decision, not an oversight.',
  'found a receipt in a coat pocket from a day I had completely forgotten and it was a good day',
  'I am not a morning person but I am becoming a very early afternoon person',
  'the shortcut is not shorter. I have now tested this four times.',
  'a jumper with a hole in the elbow is not finished, it is broken in',
  'listened to the whole album in order for the first time in years and it is a different thing',
  'the hardest part is always putting the shoes on',
];

/* Flagged text. Mild on purpose: enough to show the mechanism, never a template
   anyone could reuse. The genuinely nasty tier is what stays hidden behind the
   marker, which is what the product does anyway. */
const FLAGGED: Record<Technique, string[]> = {
  // THE SWEARING THE SWEAR MASK MASKS. These three are the only texts in this
  // file that carry a vulgar word, and they carry one on purpose: the technique
  // is `profanity` and the path it takes is the blanket mask, which stars the
  // words the profanity list matched and leaves every other word standing.
  //
  // Until 2026-09-18 these three lines were 'rubbish', 'garbage' and 'nonsense'
  // with not one vulgar word between them, while the records built from them
  // carried detection mode `profanity-mask:4` and a full rewrite out of the
  // SOFTENED table below. The one file the public can open named the product's
  // most-used feature over three records that were not it, and showed a
  // stranger a rewrite under the mask path's own name.
  //
  // Mild on purpose, and mild is the point rather than a hedge: this file is
  // linked from the site, opened by strangers, and recorded in TEEN mode, which
  // is the mode whose whole finding was that ordinary register swearing is not
  // a harm. No slur, nothing sexual, and nothing aimed at a person or a company.
  profanity: ['the wifi dropped in the middle of the match again, this is such bullshit',
    'I am so pissed about the bus, third time this week it has not turned up',
    'my shoes are soaked and the shitty weather is not done yet, what a shit day'],
  'shame-attack': ['imagine posting this and thinking it was good',
    'delete this before more people see it', 'nobody asked, and everyone is laughing',
    'you should be embarrassed to have your name on this'],
  'anger-trigger': ['they are doing this on purpose and you are supposed to just accept it',
    'this is what they think of you. read it again.',
    'they have been getting away with it for years while you paid for it'],
  'false-urgency': ['last chance, this closes tonight and it is not coming back',
    'act now or lose access permanently, no extensions',
    'the window shuts at midnight and there is no second list'],
  'fear-appeal': ['if you do not deal with this now it will be too late',
    'most people find out when it is already too late',
    'by the time you notice the damage is already done'],
  'body-comparison-priming': ['six weeks and you could look like this too, no excuses',
    'this is what discipline looks like. what is your excuse.',
    'stop making excuses and start looking like you mean it'],
  'consumer-rapid-frame': ['only nine left at this price, do not think, just buy',
    'everyone is buying this and you are still deciding',
    'the price goes up at the weekend and it is not coming back down'],
  scapegoating: ['it is their fault your rent went up, nobody else',
    'every problem in this country traces back to one group',
    'you know exactly who is behind this and nobody will say it'],
  'misleading-format': ['BREAKING: sources confirm what we all suspected',
    'doctors do not want you to know this one thing',
    'EXCLUSIVE: the report they tried to keep quiet'],
  fomo: ['everyone was there and you missed it, again',
    'this is the last one and you will regret not going',
    'the group went without you and it was the best night of the year'],
  mockery: ['the confidence to post this is genuinely remarkable',
    'someone actually pressed send on that',
    'a truly historic contribution to the internet'],
  combined: ['this is exactly what is wrong with people now and you know it',
    'they are laughing at you and you are too slow to see it, as usual'],
  'violence-graphic': ['[hidden: description of injury]', '[hidden: graphic footage of an assault]'],
  sexual: ['[hidden: sexual pressure directed at a named person]'],
  'drug-promotion': ['[hidden: promotion of an unregulated substance]'],
  'unsafe-health-experiment': ['[hidden: unsafe medical advice presented as a challenge]'],
  'self-harm': ['[hidden: self-harm content]'],
  'extreme-toxicity': ['[hidden: sustained personal attack]'],
};

/**
 * The rewrite a softened record shows. `profanity` is deliberately absent: the
 * swear mask never rewrites, it stars the matched words in place and leaves the
 * sentence alone, and its neutralized text is produced by the product's own
 * `maskProfanity` in the roster below rather than taken from this table. A
 * profanity entry here is what made the demo show a rewrite under the mask
 * path's name (found 2026-09-18).
 */
const SOFTENED: Partial<Record<Technique, string>> = {
  'shame-attack': 'I do not think this post landed well.',
  'anger-trigger': 'I think this is deliberate and worth being annoyed about.',
  'false-urgency': 'This offer is said to be closing soon.',
  'fear-appeal': 'This suggests acting sooner rather than later.',
  'body-comparison-priming': 'This is a fitness result being presented as achievable.',
  'consumer-rapid-frame': 'This is a limited-stock sales message.',
  scapegoating: 'This blames one group for a broad problem.',
  'misleading-format': 'This is styled to look like a news report.',
  fomo: 'This is about an event you did not attend.',
  mockery: 'I do not think much of this post.',
  combined: 'I disagree with this strongly.',
};

/* Advertising copy. Flat, brandless, and naming no real product or trade, so it
   reads as a placement without resembling anybody's campaign. */
const AD_COPY = [
  'Sponsored: two weeks free, then whatever you want to pay. Cancel any time.',
  'Sponsored: the desk lamp people keep asking us about. Ships in two days.',
  'Sponsored: switch your plan in four minutes. No call, no hold music.',
  'Sponsored: the walking shoe we rebuilt from the sole up. Try a pair for 30 days.',
  'Sponsored: learn a language in the time you spend queueing. First week on us.',
  'Sponsored: insurance quotes in under a minute, without the phone call.',
  'Sponsored: a mattress you can send back. Most people do not.',
  'Sponsored: your accounts, in one place, updated every morning.',
  'Sponsored: coffee, ground the day it ships. Pause or stop whenever.',
  'Sponsored: the jacket that packs into its own pocket. Back in every size.',
];

/**
 * THE HOUSEHOLD'S OWN BLOCK LIST, and the ordinary posts it hides.
 *
 * Why this exists. Until 2026-09-18 the demo household had no rules of its own,
 * and two of the export's surfaces were therefore empty on the one file a
 * stranger can open: page one's flag-provenance row read "None. Every flag in
 * this file was made by a judge that read the item", which is true and
 * demonstrates nothing, and the numbers table's "hidden by something you set"
 * column read 0 on all five platforms. A block list is the product's headline
 * free feature and nearly every install has one, so a demo with none is
 * unrepresentative of every file a recipient will actually receive.
 *
 * What the entries are. Everyday things a person gets tired of seeing, chosen
 * to name nobody: no person, no company, no place, no event, nothing political.
 * Two single words and one two-word phrase, so the file exercises both list
 * shapes the matcher keeps apart (`words` and `phrases`,
 * src/core/parent-blocklist.ts:36-40) and both spellings of the detection mode.
 *
 * What fires them is ORDINARY TEXT. That is the whole point of the row: the
 * household's rule hid a post nobody would call harmful, and the record says so
 * in those words rather than inventing a finding. The pipeline agrees: its
 * blocklist branch builds a rule-only analysis with isManipulative false and no
 * technique, because "FeelingWise is NOT claiming this post is manipulative —
 * it never looked. It is obeying an instruction" (src/analysis/pipeline.ts:505-513).
 *
 * The rules must not appear anywhere else in this file. The gate runs FIRST, above
 * the dedup cache and above every judge call (pipeline.ts:481-524), so any other
 * text here carrying one of these tokens would be a record the product would have
 * hidden and this file shows passing. Checked against BENIGN, FLAGGED and AD_COPY
 * when the entries were chosen; check again before changing any of them.
 */
const DEMO_BLOCKLIST = {
  words: ['spoilers', 'diet'],
  phrases: ['meal prep'],
} as const;
/**
 * One ordinary post per rule, and which rule it hits. The `kind` is what
 * `matchParentBlocklist` returns for a rule on that list, and it is what the
 * detection mode carries: `blocklist:<kind>:<rule>`.
 */
const BLOCKED_BY_RULE: ReadonlyArray<{ kind: 'word' | 'phrase'; rule: string; text: string }> = [
  { kind: 'word', rule: 'spoilers', text: 'watched the finale last night and this thread is nothing but spoilers from here on, you have been warned' },
  { kind: 'word', rule: 'diet', text: 'three weeks into the new diet and the only thing I have learned is that I miss bread' },
  { kind: 'phrase', rule: 'meal prep', text: 'sunday meal prep is done, six identical containers, the fridge looks like a small shop' },
];
/**
 * How much of an eligible feed one household's rules take out.
 *
 * MODELLED, like AD_RATE above and marked the same way: nothing in the 10-day
 * chain measures it, because the chain that produced this file's shapes was
 * recorded on an install whose lists were empty. 1.4% of the items the gate can
 * see is a household with a few live rules, not a household that has banned a
 * topic outright. The records are drawn OUT of the judged pool before the
 * verdict split, exactly as the ads are, because the gate pre-empts the model
 * call entirely (pipeline.ts:494) and an item it hid was never read by a judge:
 * folding them into the split would move the one mix this file measures.
 */
const BLOCKLIST_RATE = 0.014;

const PLATFORM_HOST: Record<Platform, string> = {
  twitter: 'x.com', facebook: 'facebook.com', tiktok: 'tiktok.com',
  instagram: 'instagram.com', youtube: 'youtube.com',
};

/**
 * A post address in the shape that platform actually uses.
 *
 * Every one of the 1,500 records carried Twitter's shape until 2026-09-18,
 * including `https://youtube.com/demo/status/…` and
 * `https://tiktok.com/demo/status/…`. Anyone who works with platform data reads
 * that in a second, and once they have read it they are checking the file for
 * other things that were never looked at.
 *
 * The PATH is now each platform's own; the ID is deliberately not. Every id here
 * begins with the word `demo`, so no address in this file can resolve to
 * anybody's real post, which is the whole reason this generator exists. The
 * shape is the part a reader is being shown; the id is the part that must never
 * be plausible.
 */
function postUrlFor(platform: Platform, handle: string, n: number): string {
  const host = PLATFORM_HOST[platform];
  const user = handle.replace(/^@/, '');
  const id = `demo${String(n).padStart(7, '0')}`;
  switch (platform) {
    case 'twitter': return `https://${host}/${user}/status/${id}`;
    case 'facebook': return `https://${host}/${user}/posts/${id}`;
    case 'instagram': return `https://${host}/p/${id}/`;
    case 'tiktok': return `https://${host}/@${user}/video/${id}`;
    case 'youtube': return `https://${host}/watch?v=${id}`;
  }
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
const b64url = (b: ArrayBuffer) =>
  Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/**
 * The demo signing key, fixed and committed on purpose.
 *
 * Generating a fresh key per run made the output non-deterministic: every
 * rebuild produced 1,500 different signatures and a different fingerprint, so a
 * 1.6 MB file churned in git on every regeneration and "deterministic" was not
 * true. Fixing the key makes a rerun byte-identical.
 *
 * This private key is PUBLIC and that is safe. It signs nothing but invented
 * posts. It is not the extension's key, it never touches a real record, and a
 * real export is signed by a key generated on the family's own device that
 * never leaves it. Anyone can re-sign this demo; nobody can re-sign a real one.
 *
 * Throwaway test key, generated with Web Crypto (ECDSA P-256) in commit
 * ec352e8f; it signs only the full demo (example-export-full.html), made-up
 * records shown on the site, and was never used for a real record.
 */
const DEMO_KEY_JWK = {
  kty: 'EC', crv: 'P-256',
  d: 'y3xdnL49MGJ7_DB2kdbZEjsu5K9EvAcPnGX9X0b_6og',
  x: 'I3r0B_SNvyJ2x2strKEiVka_c1gVvmFRoNvq8Mbu_14',
  y: 'qFA6s8vE3ZlMXj_HI6U_XSwQho6wR9SBZBczD_cFKqQ',
} as const;

/**
 * THE MODE THIS FILE IS IN, and why it is not the one the card note measures.
 *
 * Every record here is judged in TEEN mode by the earlier reader
 * (openai/gpt-oss-20b), while the export's own per-card note quotes the ADULT
 * reader's accuracy. A researcher reading this file cold gets a number that
 * describes none of the records in front of them, which is what was found on
 * 2026-09-18, so the note below says so.
 *
 * That note used to repeat the figure itself, "above 89 percent". It no longer
 * does. On 2026-09-21 that figure was withdrawn after the same model on the same
 * items scored differently eighteen days apart, and a generated file that pins a
 * number goes stale the moment the number moves, silently, inside 1,500 signed
 * records nobody regenerates often. It refers to the figure now instead of
 * quoting it, and the research page carries the current one.
 *
 * The mode stays TEEN and the file now says so in its first paragraph, because
 * the alternative breaks the one thing in this file that is real. The shapes
 * here — the platform split, the kind split, the verdict split and the whole
 * technique table — were measured on a teen and child chain. The adult reader is
 * a different instrument: JUDGE-V1 on gpt-oss-120b, its own family-to-technique
 * map, no per-technique floor, a fixed confidence. Restamping these records
 * 'adult' would have made the demo's single honest claim false in order to make
 * one sentence true. The disagreement is closed by stating it, not by moving it.
 */
const DEMO_MODE = 'teen' as const;
/**
 * The conditions every demo record was made under, written into each record's
 * configSnapshot the way a real install writes it.
 *
 * The floor is MANIPULATION_SEVERITY_THRESHOLD, restated rather than imported
 * because this generator runs outside the extension bundle and importing the
 * core would drag it in. If that constant moves, this one is wrong and the demo
 * says so on its own page, which is the cheapest place for it to be wrong.
 */
const DEMO_SEVERITY_FLOOR = 6;
const DEMO_DAILY_CAP = 200;
const DEMO_ENABLED_FEATURES = [
  'block-ads',
  'block-ai-content',
  'block-reels',
  'hide-engagement-metrics',
  // The household's own word, phrase and account rules. Every mode's preset
  // ships this switch ON with three empty lists (src/storage/presets.ts:55,
  // :96, :151), so a real install always carries the id here whether or not
  // anybody typed a rule; the demo omitted it and its configSnapshot therefore
  // did not look like any install's (found 2026-09-18). This file now has
  // rules in it (DEMO_BLOCKLIST), so the switch being on is also load-bearing:
  // `activeParentBlocklist` returns the empty list when the toggle is off, and
  // a blocklist record under a snapshot that says the feature was off would be
  // the file contradicting itself.
  'parent-blocklist',
  'soften-swearing',
  'strip-emojis',
];
/**
 * Whether the household in this file stars vulgar words on anything that stays
 * visible. Read off DEMO_ENABLED_FEATURES rather than restated, because the
 * decision block's `household.mask` and the configSnapshot two fields below
 * must never be able to disagree: `blanketProfanitySoften` (src/analysis/
 * pipeline.ts) is exactly `soften-swearing` enabled or strictLanguage, and this
 * file has no strictLanguage.
 */
const DEMO_MASK = DEMO_ENABLED_FEATURES.includes('soften-swearing');
const DEMO_JUDGE_MODEL = 'openai/gpt-oss-20b';
const DEMO_JUDGE_PROVIDER = 'groq';

/** One judgement, decided once for a text and carried by every post that uses it. */
interface Judgement {
  text: string;
  /**
   * The rewrite the product produced, and EMPTY on every path that produced
   * none. Only two paths hold anything: the rewrite path
   * (src/content/post-path/result-apply.ts:547, `neutralized.rewrittenText`)
   * and the swear mask, which reaches the same line with the starred sentence.
   * A pass, a hide, a collapse, an advertisement and a household-rule hide are
   * all written with '' by their own writers (logger.ts:95 and :726,
   * result-apply.ts:879 and :923). Filling it with the post's own text is a
   * claim that a rewrite exists, and the field is the only place a reader can
   * ask that question, so this file may never guess it.
   */
  neutralized: string;
  verdict: 'pass' | 'masked' | 'flagged' | 'flagged-hidden' | 'skipped';
  /** Only on a skipped record: the gate that declined, as logSkippedEvent writes it. */
  skipReason?: string;
  technique: Technique | null;
  severity: number;
  confidence: number;
  overallScore: number;
  aiSource: ForensicRecord['aiSource'];
  /**
   * The judge that read the text, and who served it. ABSENT on every
   * rules-sourced judgement, because that is what the product writes: each of
   * the four rule paths short-circuits with no `aiMeta`, and both record
   * writers spell the fields `result.aiMeta?.model` / `?.provider`
   * (src/content/post-path/result-apply.ts:578-579 for the mask,
   * :938-939 for the blocklist, the slur and the teen ad marker), while the
   * blocked-category writer passes them literally undefined
   * (src/forensics/logger.ts:755-756). Both routes leave the key off the record.
   *
   * Until 2026-09-18 this file wrote `aiModel: 'fw-harm-floor-regex-v1'` with
   * `aiProvider: 'fw-rules'` on the swear-mask records and
   * `aiModel: 'fw-ad-marker-v1'` on the ads. No such instrument exists in the
   * product and none of them ran: no model reads an item on those paths, which
   * is the reason they are free and the reason `aiSource` says 'rules'. The
   * export's own "models used" row (src/forensics/html-export.ts:605) collected
   * those two names and told a reader this file was produced by three models.
   */
  aiModel?: string;
  aiProvider?: string;
  detectionMode: string;
  /**
   * What stands behind the technique, carried onto `techniques[0].why`.
   *
   * The logger builds this field from the analysis's own technique evidence:
   * every entry trimmed, the empty ones dropped, the rest joined with '; '
   * (src/forensics/logger.ts:332-337). So `why` is never free text, it is
   * whatever the path that fired put in `evidence`, and each path puts
   * something different:
   *   ad marker     the fixed string 'platform sponsored/ad marker'
   *                 (src/analysis/pipeline.ts, the is_sponsored branch).
   *   swear mask    the profanity list's own matched terms
   *                 (pipeline.ts, `evidence: profanityResult.matches`), taken
   *                 here from `maskProfanity` rather than typed out, the same
   *                 way the starred sentence and the match count already are.
   *   block list    NOTHING, and not because it was skipped: the gate names no
   *                 technique at all, so the record carries an empty techniques
   *                 array and there is no entry for a why to sit on.
   *   a judged item the JUDGING MODEL'S OWN one-line reason, verbatim
   *                 (src/core/neutralizer.ts:1672 and :1696,
   *                 `evidence: [aiTechnique.reason ?? '']`). No model read
   *                 anything in this file, so there is no reason to carry and
   *                 the field stays absent. Writing a sentence here would be
   *                 this generator forging a model's words, and the export
   *                 renders the field under the heading "Model's stated
   *                 reason" (src/i18n/export-strings.ts:312), which is the one
   *                 claim a demo may never make.
   */
  why?: string;
  originalHash: string;
  /** Paid placement: the platform's own ad marker, never a harm finding. */
  paid: boolean;
}

/**
 * WHY THE PRODUCT ACTED, on the records this file says it acted on.
 *
 * Until 2026-09-18 not one of the 1,500 records carried a `decision` block or a
 * `reader`, so the export's own why-line (the `fw-decision` div, which names the
 * policy row in its own words, the action, and who was declared at the keyboard)
 * rendered on nothing at all. The part of the export that explains WHY was
 * invisible in the one file the public can open.
 *
 * The block is DERIVED, by the same `decisionForLegacy` the content paths call,
 * from the facts the record already states: its detection mode, its technique,
 * its severity, and what the page ended up showing. Nothing here names a row.
 *
 * What is deliberately NOT written, because this file measured none of it:
 *   - `judge`, `reading` and `descriptor` stay null (decisionForLegacy writes
 *     them null). The demo's judgements carry no instrument id, hash, charge,
 *     family, effect or intent, and filling them would forge a reading.
 *   - `descriptorV1` is never added: nothing in this file measured an effect.
 *   - no block at all where `whyFor` names no row. That is the product's own
 *     behaviour and this module's own rule: a record without `decision` states
 *     nothing, and stating nothing beats inventing.
 *
 * A RAIL IS ONLY WRITTEN WHERE THE RECORD ITSELF SAYS ONE FIRED. `whyFor` maps
 * the technique `consumer-rapid-frame` to R4, the sponsored rail, because in the
 * teen pipeline that technique is what the platform's ad marker writes
 * (src/analysis/pipeline.ts, the `is_sponsored` branch). In this file the two
 * populations are separate by construction: the ads are drawn on their own
 * stream and say `sponsored-ad`, while a judged sales-pressure record says
 * `combined-detect-neutralize` and had no ad marker on it. Writing `rails:
 * [sponsored]` on the second would be the file asserting that a deterministic
 * gate fired when none did, against its own standing decision that an ad is a
 * category and never a finding. So a rail row survives only when the record's
 * own detection mode is the one that names that rail; otherwise no block. The
 * same guard is what admits the R1 rows added on 2026-09-18: the household's own
 * block-list records say `blocklist:<kind>:<rule>` in their own detection mode,
 * so the rail they carry is one the record itself states.
 */
function decisionForDemoJudgement(j: Judgement): DecisionBlock | undefined {
  // Nothing decided a skipped item, and logSkippedEvent writes no decision block.
  if (j.verdict === 'skipped') return undefined;
  // THE SWEAR MASK TAKES ITS OWN BUILDER, as it does in the product
  // (src/content/post-path/result-apply.ts branches on exactly this prefix).
  // `whyFor` returns null for every profanity detection mode ON PURPOSE: the
  // table says swearing is never a hide, so no row can be named from the
  // technique. That means `decisionForLegacy` would write no block at all and
  // the mask records would be the only acted records in the file with nothing
  // saying why. `decisionForMask` is the honest answer: row D1, nothing charged,
  // action allow, applied mask, household.mask true, because what starred the
  // words was the household's own swearing setting and not a finding.
  if (j.detectionMode.startsWith('profanity-mask')) return decisionForMask(DEMO_MODE, READER_DEFAULT);
  // What the page ended up showing. An ad is collapsed behind its marker, a
  // hidden technique is hidden, and everything else acted on carries a rewrite,
  // which is a soften. Each of these is what `verdictFor` (src/core/policy/
  // table.ts) maps back to the verdict the record already carries, so the card
  // cannot contradict itself: collapse and hide are 'flagged-hidden', soften is
  // 'flagged'.
  const applied: DecisionAction = j.paid ? 'collapse'
    : j.verdict === 'flagged-hidden' ? 'hide'
      : j.verdict === 'flagged' ? 'soften'
        : 'allow';
  const d = decisionForLegacy({
    mode: DEMO_MODE,
    detectionMode: j.detectionMode,
    techniques: j.technique ? [j.technique] : [],
    severity: j.overallScore,
    applied,
    mask: DEMO_MASK,
  });
  if (!d) return undefined;
  // The detection modes that themselves assert a deterministic gate, in the
  // words `whyFor` reads them by. Any other mode reaching a rail row means the
  // row came from the technique name alone; see the note above.
  //
  // The one route that could do that was closed in the product the same day
  // this guard was written: `whyFor` mapped the technique consumer-rapid-frame
  // to R4, the sponsored rail, so a judged sales-pressure post was recorded as
  // an advertisement and counted in the export's paid-placement column. It maps
  // to J6, commercial pressure, since 2026-09-18. The guard stays because it
  // decides a property of the FILE, that no row here claims a gate the record
  // does not name, and a file should not depend on a mapping table staying
  // right somewhere else.
  const railStated = j.detectionMode.startsWith('sponsored-ad')
    || j.detectionMode.startsWith('slur:')
    || j.detectionMode.startsWith('blocklist:')
    || j.detectionMode.startsWith('coded-harm:');
  if (d.rails.length > 0 && !railStated) return undefined;
  return d;
}

/** One post: an identity plus the judgement its text carries. */
interface Post {
  judgement: Judgement;
  platform: Platform;
  kind: Kind;
  author: string;
  postUrl: string;
  accountType?: 'advertiser';
  /** Engagement at the first sighting, and how fast it moved after it. */
  metricsBase: { likes: number; views: number; replies: number; shares: number };
  metricsRate: number;
}

const EXAMPLE_KEY = resolve(process.cwd(), 'tests', 'fixtures', 'verifier-vectors', 'example-key.json');
// The made-at time each committed example already carried when its clock was fixed.
const MADE_AT = EXAMPLE ? '2026-10-07T05:05:03.812Z' : '2026-10-07T05:05:01.526Z';

async function exampleFixtureKey(): Promise<{ privateKey: CryptoKey; publicJwk: JsonWebKey }> {
  const { privateJwk, publicJwk } = JSON.parse(readFileSync(EXAMPLE_KEY, 'utf8')) as { privateJwk: JsonWebKey; publicJwk: JsonWebKey };
  const privateKey = await crypto.subtle.importKey('jwk', privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  return { privateKey, publicJwk };
}

async function main() {
  // The example signs under a fixture key, as the full demo and the checker's vectors do, so a
  // rebuild moves only its signatures and a wording change can be read in its diff. A key made fresh
  // on every run also moved the file's hash, which the site's picture record pins, on every rebuild.
  // The key is a test key for invented records: anyone can sign under it, as under the demo's.
  const exampleKey = EXAMPLE ? await exampleFixtureKey() : null;
  const privateKey = exampleKey
    ? exampleKey.privateKey
    : await crypto.subtle.importKey(
      'jwk', { ...DEMO_KEY_JWK, key_ops: ['sign'], ext: true },
      { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'],
    );
  const publicJwk = exampleKey ? exampleKey.publicJwk : DEMO_KEY_JWK;
  const jwk: JsonWebKey = { kty: 'EC', crv: 'P-256', x: publicJwk.x, y: publicJwk.y };
  const fingerprint = (await sha256Hex(`${jwk.x}|${jwk.y}`)).slice(0, 16);
  const kp = { privateKey };

  /* ---------- 1. the judgement roster: one answer per text ---------- */
  // The severity floors the file's own methodology block prints, read from the
  // same builder that renders them, so a reader who cross-checks a flagged
  // record against the table two screens below finds it at or above its floor.
  // Restating them here would have been a third copy of a table that already
  // has a drift test over two.
  const methodology = buildMethodologyBlock(
    (JSON.parse(readFileSync(resolve(process.cwd(), 'manifest.json'), 'utf8')) as { version: string }).version,
  );
  const floors = methodology.thresholds.postSeverityFloorByTechniqueAndMode;
  const floorOf = (t: Technique): number => floors[t]?.[DEMO_MODE] ?? methodology.thresholds.defaultPostSeverityFloor;

  const judgements = new Map<string, Judgement>();
  const judge = async (
    text: string,
    fields: Omit<Judgement, 'text' | 'originalHash'>,
  ): Promise<Judgement> => {
    const j: Judgement = { ...fields, text, originalHash: await sha256Hex(text) };
    judgements.set(text, j);
    return j;
  };

  const benignJudgements: Judgement[] = [];
  for (const text of BENIGN) {
    // Without a key the pipeline leaves at `pre-llm-free-tier-no-ai` and the record says so,
    // field for field as logSkippedEvent writes it: no rewrite, no technique, no score, no model,
    // aiSource 'rules' (the gate that declined is a rule), and the reason in two places.
    if (EXAMPLE) {
      benignJudgements.push(await judge(text, {
        neutralized: '',
        verdict: 'skipped',
        skipReason: 'free-tier-no-ai',
        technique: null,
        severity: 0,
        confidence: 0,
        overallScore: 0,
        aiSource: 'rules',
        detectionMode: 'skip:free-tier-no-ai',
        paid: false,
      }));
      continue;
    }
    benignJudgements.push(await judge(text, {
      // NO REWRITE ON A PASS. A pass record is written by `logPassEvent`, whose
      // input type carries no neutralized text at all and which hardcodes the
      // empty string (src/forensics/logger.ts:95, read end to end 2026-09-18):
      // "Pass records carry no neutralization, the post is unchanged on the
      // page". This generator wrote the post's own text into the field on all
      // 1,291 of its pass records, so the one file the public can open showed a
      // rewrite the product never produced on six records in seven. The card
      // renders the same either way: the reading view falls back to
      // originalText when the field is empty, and its `softened` test is
      // already false when the two strings are equal
      // (src/forensics/html-export-scripts.ts:1304-1306).
      neutralized: '',
      verdict: 'pass',
      technique: null,
      severity: 0,
      confidence: 0,
      // A pass carries no score, here and in the product: neutralizer.ts writes
      // overallScore 0 on every item it does not fire on. This generator used to
      // draw int(0,15) per record, on a 0..10 field, which is how one benign text
      // came to carry sixteen different scores (found 2026-09-18).
      overallScore: 0,
      aiSource: 'cloud',
      aiModel: DEMO_JUDGE_MODEL,
      aiProvider: DEMO_JUDGE_PROVIDER,
      detectionMode: 'pass:post-llm-not-manipulative',
      paid: false,
    }));
  }

  // The swear mask only runs where the household asked for it
  // (`blanketProfanitySoften`, src/analysis/pipeline.ts: child always, teen and
  // adult only on the soften-swearing switch). This file is teen, so its
  // profanity records exist only because DEMO_ENABLED_FEATURES carries that
  // switch, and `decisionForMask` writes household.mask true unconditionally.
  // If the switch is ever taken out of the list the two would disagree in
  // silence, so the build stops instead.
  if (!DEMO_MASK) {
    throw new Error('the demo masks swearing: remove the profanity records too, or put soften-swearing back in DEMO_ENABLED_FEATURES');
  }

  const flaggedByTechnique = new Map<Technique, Judgement[]>();
  for (const technique of Object.keys(TECHNIQUE) as Technique[]) {
    const hidden = HIDDEN_TECHNIQUES.has(technique);
    // Rules-only records are the deterministic path: no network call happened.
    // The severity is the one the methodology block states for that path, so
    // the file agrees with its own table.
    //
    // ONE technique is on this side, not two. Until 2026-09-18 `extreme-toxicity`
    // was here as well, and the record it produced was a shape the product
    // cannot make: technique 'extreme-toxicity' at severity 9 under detection
    // mode `slur:9`. Read both gates end to end that day:
    //   the SLUR gate (src/analysis/pipeline.ts:596-605) stamps technique
    //     'profanity' at severity 9, confidence 0.98, and its mode is
    //     `slur:<matches.length>`, the MATCH COUNT, never the severity;
    //   the DEHUMANIZATION gate (pipeline.ts:803-815) is the one that stamps
    //     'extreme-toxicity' at severity 9, confidence 0.98, and its mode is
    //     `dehumanization:<matches.length>`.
    // So the old record wore one gate's technique under the other gate's name
    // with a count that was a severity. Nothing shipped it, because the roster
    // drew no extreme-toxicity record at the measured weight of 8, and a weight
    // change would have.
    //
    // WHY IT IS NOT REWRITTEN AS A DEHUMANIZATION RECORD. That gate's own two
    // fields cannot be produced here honestly. Its mode carries the number of
    // spans `detectDehumanization` matched and its evidence is a VERBATIM CLIP
    // of the matching span (src/core/dehumanization-filter.ts:663-668 and
    // clipEvidence), so a record that names it either runs the detector over a
    // text that really fires it, or invents both. A text that really fires it is
    // a target noun plus an extermination verb, or an identity group plus "are"
    // plus a target noun (PATTERN_A/B/C in that file): every firing sentence is
    // a genocide slogan aimed at a group. This file is linked from the site and
    // opened by strangers, and its own rule for flagged text is that the mild
    // tier is written out and the nasty tier stays behind the marker, never a
    // template anyone could reuse. So the gate is not demonstrated rather than
    // faked.
    //
    // WHAT IS WRITTEN INSTEAD is the other producer of the same technique, and
    // the one that fits this text: `extreme-toxicity` is a LAYER-1 CLASSIFIER
    // for coordinated harassment, pile-ons, doxxing prep and mass-report
    // brigading (src/core/techniques/extreme-toxicity.ts:1-14). An L1 technique
    // the judge confirms reaches the record by name through the ordinary judged
    // path (src/core/neutralizer.ts:1656-1675), which is where every other
    // hidden technique in this file already comes from. No deterministic gate is
    // asserted, no match count is invented, and no clipped slur or slogan has to
    // be carried to stand behind it.
    const byRules = technique === 'profanity';
    const out: Judgement[] = [];
    for (const text of FLAGGED[technique]) {
      const floor = floorOf(technique);
      // THE BLANKET SWEAR MASK, written the way src/analysis/pipeline.ts writes
      // it and not the way a name suggested. Read end to end on 2026-09-18:
      // the pipeline calls `maskProfanity(post.text)` for the starred text,
      // stamps technique 'profanity' at a FIXED severity 4 with confidence 0.95,
      // and returns `profanity-mask:<matches.length>`, the MATCH COUNT, never
      // the severity. This generator wrote `profanity-mask:<severity>` over
      // texts with no vulgar word and a rewrite from the SOFTENED table, so the
      // suffix, the text and the neutralized text were all wrong together.
      //
      // The stars are not written here. `maskProfanity` is called, so the demo
      // shows the string the product would show for that exact sentence; a
      // hand-typed starred form would be this file asserting an output it did
      // not produce, which is the defect one level up.
      const mask = technique === 'profanity' ? maskProfanity(text) : null;
      const severity = technique === 'profanity'
        ? methodology.thresholds.profanityFilterSeverity
        : hidden ? int(Math.max(floor, 6), 9) : int(floor, Math.min(9, floor + 2));
      out.push(await judge(text, {
        // Three paths, three answers, and only two of them hold a rewrite.
        //   mask    the starred sentence the product would show. The rewrite
        //           path writes `neutralized.rewrittenText`
        //           (src/content/post-path/result-apply.ts:547) and the mask
        //           reaches it with `rewrittenText: masked`
        //           (src/analysis/pipeline.ts, the maskProfanity branch).
        //   hidden  NOTHING. A hide or a collapse is recorded by the branch at
        //           src/content/post-path/result-apply.ts:923, which writes
        //           `neutralizedText: ''` in as many words: no rewrite was
        //           produced for an item that was removed, and the placeholder
        //           the page shows is generated client-side and is not part of
        //           the canonical chain. This generator wrote the post's own
        //           text there, so every hidden record in the public demo
        //           carried a rewrite that never existed (found 2026-09-18,
        //           the fourth of that family in this file).
        //   soften  the rewrite from the SOFTENED table, which is what the
        //           rewrite path really holds.
        neutralized: mask ? mask.masked : hidden ? '' : (SOFTENED[technique] ?? text),
        // `verdictFor('mask')` is 'masked' (src/core/policy/table.ts). A mask is
        // not a flag and is not a pass: the item was changed on the page, and
        // the export's own counting rule (forensics/flag-provenance.ts) reads
        // 'masked' as decided and on the clean side. Saying 'flagged' here made
        // the swear mask wear the judge's coat in the page-one flag count.
        verdict: mask ? verdictFor('mask') : hidden ? 'flagged-hidden' : 'flagged',
        technique,
        severity,
        confidence: byRules ? 0.95 : 0.55 + rnd() * 0.4,
        // 0..10, the scale the product writes (neutralizer.ts overallScore =
        // verdict.severity). This generator multiplied it by ten until
        // 2026-09-18, so every acted record in the demo claimed a score the
        // field does not carry.
        overallScore: severity,
        aiSource: byRules ? 'rules' : 'cloud',
        // Named only where a model read the item; see the Judgement fields.
        ...(byRules ? {} : { aiModel: DEMO_JUDGE_MODEL, aiProvider: DEMO_JUDGE_PROVIDER }),
        // `profanity-mask:<n>` carries the MATCH COUNT, which is what the
        // pipeline puts there. The `slur:<severity>` branch that used to sit
        // beside it is gone with the extreme-toxicity record it wrote; see the
        // note on `byRules` above.
        detectionMode: mask ? `profanity-mask:${mask.matches.length}` : 'combined-detect-neutralize',
        // What stands behind the technique. The mask path has a real answer and
        // it is the filter's own: the pipeline passes `profanityResult.matches`
        // as the technique evidence and the logger joins it with '; '. The same
        // call produces it here that produced the stars and the count, so the
        // words in the record are the words the product matched. Every other
        // record in this loop is a judged one, whose evidence is the model's own
        // reason and which this file cannot have: no why, rather than a
        // sentence written by a generator under the heading "Model's stated
        // reason". See the Judgement field.
        ...(mask ? { why: mask.matches.join('; ') } : {}),
        paid: false,
      }));
    }
    flaggedByTechnique.set(technique, out);
  }

  // Paid placements, written the way the teen pipeline writes them: the ad
  // marker justifies a category, the record is collapsed, and the severity 6 it
  // carries is ignored by every count because isPaidPlacement excludes it
  // (src/forensics/paid-placement.ts).
  const adJudgements: Judgement[] = [];
  for (const text of AD_COPY) {
    adJudgements.push(await judge(text, {
      // An ad is collapsed, never rewritten, and every writer on the path says
      // so with the empty string. Teen and child return action 'collapse' with
      // detection mode 'sponsored-ad' (src/analysis/pipeline.ts:680-686), which
      // the content side records through the ordinary hide/collapse branch at
      // src/content/post-path/result-apply.ts:923 (`neutralizedText: ''`). The
      // adult variant splits off at result-apply.ts:831 and writes the same
      // empty field from both of its own exits: the blocked-category record
      // (src/forensics/logger.ts:726, "Blocked records have no rewrite, the
      // post is hidden, not replaced") and the pass it writes when the hide did
      // not land (result-apply.ts:879). This generator wrote the advertisement
      // copy into the field instead, so all 74 paid placements in the public
      // demo claimed a rewrite (found 2026-09-18).
      neutralized: '',
      verdict: 'flagged-hidden',
      technique: 'consumer-rapid-frame',
      severity: 6,
      confidence: 0.99,
      overallScore: 6,
      aiSource: 'rules',
      // No model read an ad: the platform's own marker did. The two fields stay
      // off the record, as they do on every rules path (see the Judgement fields).
      detectionMode: 'sponsored-ad',
      // What the gate puts behind the technique, verbatim: the teen/child
      // is_sponsored branch builds its analysis with
      // `evidence: ['platform sponsored/ad marker']` (src/analysis/pipeline.ts)
      // and the logger carries that onto `techniques[0].why`. A real teen
      // record therefore says in one line what the ad column says in a number,
      // and all 74 paid placements in this file said nothing until 2026-09-18.
      // It is a fixed string the gate holds, not a reason anybody reasoned, so
      // it is the one why in this file that can be written out.
      why: 'platform sponsored/ad marker',
      paid: true,
    }));
  }

  // The household's own rules, written the way the pipeline writes a hit
  // (src/analysis/pipeline.ts:496-524, read end to end 2026-09-18):
  //   analysis  ruleAnalysis({ confidence: 1, action: 'hide' }) with NO
  //             technique, which is isManipulative false, overallScore 0, an
  //             empty techniques array and no primaryTechnique
  //             (src/core/analysis-result.ts:36-45).
  //   mode      `blocklist:${hit.kind}:${hit.rule}`, the rule spelled as the
  //             matcher normalised it, because a record that says a word rule
  //             hid this without naming the word is not evidence.
  //   aiSource  'rules': the gate is above the cache and above every model call.
  //   model     absent, both fields, as on every rules path.
  //   why       none, and not by omission: `why` sits on a technique entry
  //             (src/forensics/logger.ts:332-337) and this gate names no
  //             technique, so there is no entry for one to sit on. A rule that
  //             hid a post without reading it has nothing to say about it.
  //   rewrite   none. The hide path writes `neutralizedText: ''`
  //             (src/content/post-path/result-apply.ts:923, re-read 2026-09-18
  //             after the line moved); there is no
  //             rewritten text to show for an item that was removed.
  // The verdict is not chosen here either: `decisionForLegacy` returns row R1
  // with action hide in every mode (src/core/policy/table.ts:108), the page
  // applied it, and the logger maps applied 'hide' to 'flagged-hidden'
  // (src/forensics/logger.ts:393-395), which is what `verdictFor` says and
  // what this file already writes for the other hidden populations.
  //
  // The mode is taken from the MATCHER's own answer, never from the literal in
  // BLOCKED_BY_RULE: the rule in the record is the rule the matcher compared,
  // already normalised, and a hand-written one could drift from it silently.
  const demoBlocklist = readParentBlocklist({
    words: [...DEMO_BLOCKLIST.words],
    phrases: [...DEMO_BLOCKLIST.phrases],
    accounts: [],
  });
  const blocklistJudgements: Judgement[] = [];
  for (const entry of BLOCKED_BY_RULE) {
    const hit = matchParentBlocklist(demoBlocklist, entry.text);
    if (!hit || hit.kind !== entry.kind || hit.rule !== entry.rule) {
      throw new Error(`the household's list does not hide "${entry.text}" on ${entry.kind} ${entry.rule}: the matcher answered ${hit ? `${hit.kind}/${hit.rule}` : 'nothing'}`);
    }
    blocklistJudgements.push(await judge(entry.text, {
      neutralized: '',
      verdict: 'flagged-hidden',
      technique: null,
      severity: 0,
      confidence: 1,
      overallScore: 0,
      aiSource: 'rules',
      detectionMode: `blocklist:${hit.kind}:${hit.rule}`,
      paid: false,
    }));
  }
  // And nothing else in the file may match. The gate runs above the cache and
  // above every model call, so a benign, flagged or advertising text carrying
  // one of the household's words is a record the product would have hidden and
  // this file shows passing, the file arguing with itself about its own
  // headline feature. Checked over every text the roster holds, so adding a
  // sentence later cannot open the hole quietly.
  for (const text of [...BENIGN, ...Object.values(FLAGGED).flat(), ...AD_COPY]) {
    const stray = matchParentBlocklist(demoBlocklist, text);
    if (stray) throw new Error(`"${text}" matches the household's own rule ${stray.kind} ${stray.rule}, so the product would have hidden it: change the text or the rule`);
  }

  /* ---------- 2. the accounts ---------- */
  const handles = new Set<string>();
  while (handles.size < AUTHOR_COUNT) handles.add(`@${pick(HANDLE_A)}_${pick(HANDLE_B)}${int(2, 89)}`);
  const authors = [...handles];
  // A long tail: a handful of accounts fill most of the week, most appear once
  // or twice, which is the shape of anybody's feed.
  const authorWeights = authors.map((_, i) => 1 / Math.pow(i + 1, 0.65));
  const advertisers = new Set<string>();
  while (advertisers.size < ADVERTISER_COUNT) advertisers.add(`@${pick(HANDLE_A)}${pick(HANDLE_B)}_${pick(AD_SUFFIX)}`);
  const adAccounts = [...advertisers];

  /* ---------- 3. the impression plan ---------- */
  // Each slot is one sighting: which platform, which kind, and whether it was a
  // paid placement. The judgement is NOT decided here; the slot only says which
  // shelf of the roster to take a post from.
  type Slot = { platform: Platform; kind: Kind; paid: boolean; blocked: boolean; acted: boolean };
  const platformOf = deal(RECORD_COUNT, PLATFORM);
  const kindOf = deal(RECORD_COUNT, KIND_IN_FILE);
  const slots: Slot[] = platformOf.map((platform, i) => ({ platform, kind: kindOf[i]!, paid: false, blocked: false, acted: false }));

  // Paid placements, per platform, over the items a platform can sell:
  // comments are not sold, so an ad is a top-level item.
  for (const platform of Object.keys(PLATFORM) as Platform[]) {
    const eligible = slots
      .map((s, i) => (s.platform === platform && (s.kind === 'post' || s.kind === 'video' || s.kind === 'image') ? i : -1))
      .filter(i => i >= 0);
    const n = Math.round(eligible.length * AD_RATE[platform]);
    for (const i of shuffle(eligible).slice(0, n)) slots[i]!.paid = true;
  }

  // The household's own rules, over the items the gate that writes
  // `blocklist:` can see. That gate is the POST path's (src/analysis/
  // pipeline.ts:496) and it is the only writer of that detection mode in the
  // product; the DOM-side word filter hides on the same rules but writes no
  // record at all (src/content/engagement/word-filter.ts). So the same three
  // top-level kinds the ads use, for a different reason: not what a platform
  // sells, but what this gate is reached for.
  for (const platform of Object.keys(PLATFORM) as Platform[]) {
    const eligible = slots
      .map((s, i) => (s.platform === platform && !s.paid && (s.kind === 'post' || s.kind === 'video' || s.kind === 'image') ? i : -1))
      .filter(i => i >= 0);
    const n = Math.round(eligible.length * BLOCKLIST_RATE);
    for (const i of shuffle(eligible).slice(0, n)) slots[i]!.blocked = true;
  }

  // The judged records, at the measured split. Paid placements and the
  // household's own hides are outside both sides of it: an ad was never read by
  // a judge, and neither was an item the block list took out before the call.
  const judged = slots.map((s, i) => (s.paid || s.blocked ? -1 : i)).filter(i => i >= 0);
  // Without a key the only one of those acts that still happens is the swear mask, a rule; every
  // other acted record in the measured split came from the judge, which does not run. So the example
  // keeps the mask's own share of the acted records and nothing else.
  const techniqueTotal = (Object.values(TECHNIQUE) as number[]).reduce((a, b) => a + b, 0);
  const actedCount = EXAMPLE
    ? Math.round((judged.length * VERDICT.acted * TECHNIQUE.profanity) / ((VERDICT.pass + VERDICT.acted) * techniqueTotal))
    : Math.round((judged.length * VERDICT.acted) / (VERDICT.pass + VERDICT.acted));
  for (const i of shuffle(judged.slice()).slice(0, actedCount)) slots[i]!.acted = true;

  /* ---------- 4. the posts ---------- */
  // One post per shelf-load of impressions, so a post is served more than once,
  // as a feed serves it. Everything the judge decided lives here and is read by
  // every impression of it unchanged.
  let urlCounter = 1000000;
  const bucketSlots = new Map<string, number[]>();
  slots.forEach((s, i) => {
    const key = `${s.platform}|${s.kind}|${s.paid ? 'ad' : s.blocked ? 'blocked' : s.acted ? 'acted' : 'pass'}`;
    const list = bucketSlots.get(key);
    if (list) list.push(i); else bucketSlots.set(key, [i]);
  });

  const postOfSlot: Post[] = new Array(RECORD_COUNT);
  for (const [key, indices] of [...bucketSlots.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const [platform, kind, klass] = key.split('|') as [Platform, Kind, 'ad' | 'blocked' | 'acted' | 'pass'];
    const wanted = Math.max(1, Math.min(indices.length, Math.round(indices.length / IMPRESSIONS_PER_POST)));
    const posts: Post[] = [];
    for (let p = 0; p < wanted; p++) {
      let judgement: Judgement;
      if (klass === 'ad') judgement = pick(adJudgements);
      else if (klass === 'blocked') judgement = pick(blocklistJudgements);
      else if (klass === 'acted') judgement = pick(flaggedByTechnique.get(EXAMPLE ? 'profanity' : weighted(TECHNIQUE))!);
      else judgement = pick(benignJudgements);
      const author = klass === 'ad' ? pick(adAccounts) : authors[weightedIndex(authorWeights)]!;
      posts.push({
        judgement,
        platform,
        kind,
        author,
        postUrl: postUrlFor(platform, author, urlCounter++),
        ...(klass === 'ad' ? { accountType: 'advertiser' as const } : {}),
        metricsBase: {
          likes: int(0, 3400),
          views: int(40, 210000),
          replies: int(0, 170),
          shares: int(0, 260),
        },
        // How fast the counts move per hour after the first sighting. A post
        // that is served again has been alive in the meantime.
        metricsRate: 0.004 + rnd() * 0.09,
      });
    }
    // Allocate the shelf's impressions: every post is served at least once, the
    // rest go to a few posts far more often than to the many, which is what a
    // recommender does.
    const postWeights = posts.map((_, i) => 1 / Math.pow(i + 1, 0.8));
    const allocation: number[] = posts.map((_, i) => i);
    while (allocation.length < indices.length) allocation.push(weightedIndex(postWeights));
    shuffle(allocation);
    indices.forEach((slotIndex, k) => { postOfSlot[slotIndex] = posts[allocation[k]!]!; });
  }

  /* ---------- 5. the clock ---------- */
  // SITTINGS, not a uniform scatter. 1500 timestamps spread evenly across ten
  // days put a mean of nine minutes between records, which is a browsing
  // pattern no person has: every record became its own stretch, and page one's
  // attendance row — which exists to say how much of a file was served to
  // nobody — could only report that nothing was long enough to judge. A demo
  // whose strongest claim is "open it and check it yourself" should not model
  // reading as a Poisson process.
  //
  // So: sittings of 25 to 120 records, each a burst of a screenful landing
  // together and then a pause while it is read, with hours between sittings.
  // The shape is what a person produces, so the attendance measure judges it
  // and reports it attended — which is the true answer for invented ordinary
  // browsing, and the answer that shows a reader what the row does.
  // Deterministic: rnd() is the same seeded generator the rest of the file uses.
  const stamps: number[] = [];
  let cursor = WINDOW_START;
  // The example says "a week", and the pauses below are capped at about six hours, which packs 320
  // records into under a day. So it shares its records out over the seven days instead: two or three
  // sittings a day between 07:00 and 22:00 UTC, kept inside the window. The demo keeps the loop below
  // unchanged, so its hashes do not move.
  if (EXAMPLE) {
    const firstDay = Date.UTC(2026, 8, 28);
    const DAYS = 7;
    for (let d = 0; d < DAYS; d++) {
      const onDay = Math.floor(RECORD_COUNT / DAYS) + (d < RECORD_COUNT % DAYS ? 1 : 0);
      const from = Math.max(firstDay + d * 86_400_000 + 7 * 3_600_000, WINDOW_START);
      const to = Math.min(firstDay + d * 86_400_000 + 22 * 3_600_000, WINDOW_END - 3_600_000);
      const sittings = 2 + Math.floor(rnd() * 2);
      let left = onDay;
      for (let s = 0; s < sittings; s++) {
        const n = s === sittings - 1 ? left : Math.round(onDay / sittings);
        left -= n;
        let at = from + Math.floor(((s + rnd() * 0.8) / sittings) * (to - from));
        for (let i = 0; i < n; i++) {
          stamps.push(at);
          at += i % 4 === 0 ? 4_000 + Math.floor(rnd() * 26_000) : 120 + Math.floor(rnd() * 900);
        }
      }
    }
  }
  while (stamps.length < RECORD_COUNT) {
    const sitting = 25 + Math.floor(rnd() * 96);
    for (let i = 0; i < sitting && stamps.length < RECORD_COUNT; i++) {
      stamps.push(cursor);
      // A screenful renders together; then a few seconds while it is read.
      cursor += i % 4 === 0 ? 4_000 + Math.floor(rnd() * 26_000) : 120 + Math.floor(rnd() * 900);
    }
    // Away for a while. Kept under the remaining window so the last sitting
    // still lands inside it.
    const left = WINDOW_END - cursor;
    const remaining = RECORD_COUNT - stamps.length;
    cursor += remaining > 0 && left > 0
      ? Math.min(Math.floor(left / Math.max(1, Math.ceil(remaining / 70))), 20 * 60_000 + Math.floor(rnd() * 6 * 60 * 60_000))
      : 0;
  }
  stamps.sort((a, b) => a - b);

  /* ---------- 6. the impressions ---------- */
  // Engagement counts are read off the page at the moment of the sighting, so
  // the second sighting of a post shows the counts it had by then. Measured
  // from the post's FIRST sighting in this file, so a reader who opens the
  // popularity panel on a repeated post sees numbers that only go up.
  const firstSeen = new Map<Post, number>();
  slots.forEach((_, i) => {
    const post = postOfSlot[i]!;
    if (!firstSeen.has(post)) firstSeen.set(post, stamps[i]!);
  });

  const records: ForensicRecord[] = [];
  let prevHash = '';

  for (let i = 0; i < RECORD_COUNT; i++) {
    const post = postOfSlot[i]!;
    const j = post.judgement;
    const hours = (stamps[i]! - firstSeen.get(post)!) / 3_600_000;
    const grow = (n: number) => Math.round(n * (1 + post.metricsRate * hours));
    const isComment = post.kind === 'comment' || post.kind === 'top-comment';
    // The two documented shapes of RecordMetrics (src/types/forensic.ts): post,
    // video and caption records carry the post-shaped keys, comment and reply
    // records the comment-shaped ones. This generator used to write a `replies`
    // key, which is in neither shape and is read by nothing.
    const metrics: RecordMetrics = isComment
      ? { likes: grow(post.metricsBase.likes), reply_count: grow(post.metricsBase.replies), views: grow(post.metricsBase.views) }
      : {
        primary_likes: grow(post.metricsBase.likes),
        comments_count: grow(post.metricsBase.replies),
        shares: grow(post.metricsBase.shares),
        views: grow(post.metricsBase.views),
      };

    const decision = decisionForDemoJudgement(j);

    const base = {
      id: `demo-${String(i + 1).padStart(5, '0')}`,
      timestamp: new Date(stamps[i]!).toISOString(),
      platform: post.platform as ForensicRecord['platform'],
      originalText: j.text,
      originalHash: j.originalHash,
      originalLength: j.text.length,
      textCapture: textCaptureForDemo(post.platform, j.originalHash),
      neutralizedText: j.neutralized,
      author: post.author,
      postUrl: post.postUrl,
      // `why` is spread, not defaulted: the logger omits the key when the path
      // supplied no evidence rather than writing an empty string, so records
      // without a rationale hash exactly as they did before the field existed
      // (src/forensics/logger.ts:325-337). The judged records in this file are
      // in that state honestly — no model read them, so no model said why.
      techniques: j.technique
        ? [{ name: j.technique, severity: j.severity, confidence: j.confidence, ...(j.why ? { why: j.why } : {}) }]
        : [],
      overallScore: j.overallScore,
      // The example is today's install, which signs the level name (logger.ts modeToAgeCategory);
      // the demo keeps the old id its measured shapes were recorded under.
      userAgeCategory: EXAMPLE ? levelOf(DEMO_MODE) : DEMO_MODE,
      aiSource: j.aiSource,
      // The surface, which is a fact about the SIGHTING and not about the post:
      // the same item reaches a person through For You once and through a
      // profile the next time.
      feedSource: weighted(SURFACE[post.platform]) as ForensicRecord['feedSource'],
      // Spread, like accountType and decision below, so a rules-sourced record
      // is written with the keys ABSENT rather than present-and-undefined. Both
      // forms hash the same (the canonical payload drops an undefined key) and
      // only one of them reads as "not recorded" to somebody looking at the
      // JSON; the product reaches the same place from the other side, by
      // passing `result.aiMeta?.model` on a path that has no aiMeta.
      ...(j.aiModel ? { aiModel: j.aiModel } : {}),
      ...(j.aiProvider ? { aiProvider: j.aiProvider } : {}),
      detectionMode: j.detectionMode,
      ...(j.skipReason ? { skipReason: j.skipReason } : {}),
      prevRecordHash: prevHash,
      // Positions start at ZERO, as a real install's do. Numbering from 1 made
      // the demo claim one record was missing before its own first record:
      // coverageFromRecords reads firstPosition 1 as missingBefore 1, and once
      // the verifier began consulting that arithmetic (2026-09-08) the public
      // demo read PARTIALLY VERIFIED. The genesis record of every real chain
      // sits at 0 — the owner's own file runs 0 to 5,961.
      chainPosition: i,
      // The marker every writer in the product stamps on the record that opens
      // a chain, and the one record in this file that opens one. All six record
      // writers spell it the same way, `chainState.nextPosition === 0 ?
      // 'genesis-v1' : undefined` (src/forensics/logger.ts:114, :373, :496,
      // :591, :670, :769, and manual-flag.ts:170), so a real export's position-0
      // record always carries it and this file's did not.
      //
      // It changes no hash and no verdict. The canonical payload excludes
      // chainAnchor by name, because its presence on a genesis record and its
      // absence on a legacy one must not move the integrity hash
      // (src/forensics/canonical-payload.ts:34-35, :62), and the public checker
      // says the same from the outside: "an advisory label; ignored by the
      // checker" (verifier/FORMAT.md:72). The only value any reader branches on
      // is 'pre-rekey', which relegates a record from the chain walk
      // (chain-integrity.ts:215). What it buys is a file whose first record is
      // recognisable as a first record.
      ...(i === 0 ? { chainAnchor: 'genesis-v1' } : {}),
      verdict: j.verdict as ForensicRecord['verdict'],
      kind: post.kind as ForensicRecord['kind'],
      publicKeyFingerprint: fingerprint,
      metrics,
      // The settings the app was running under, which a real record carries and
      // the demo carried on none of its 1500 (found 2026-09-18, when the page's
      // own sentence was rewritten from "1500 without a configuration snapshot"
      // into one a stranger could read). That sentence then said, truthfully,
      // that the whole file could not say what its settings were, which is a
      // thing about the demo and reads as a thing about the product.
      //
      // The values are the ones the comment path really writes:
      // MANIPULATION_SEVERITY_THRESHOLD as the floor, the mode this file is
      // recorded in, and the daily cap. enabledFeatures is the top-level grid
      // only, as the field's docblock says.
      configSnapshot: {
        mode: EXAMPLE ? levelOf(DEMO_MODE) : DEMO_MODE,
        threshold: DEMO_SEVERITY_FLOOR,
        dailyCap: DEMO_DAILY_CAP,
        enabledFeatures: DEMO_ENABLED_FEATURES,
      } as ForensicRecord['configSnapshot'],
      ...(post.accountType ? { accountType: post.accountType } : {}),
      // Why the product acted, and who was declared at the keyboard. Spread the
      // same way as accountType above, so a record with no nameable row is
      // written with the keys ABSENT rather than present-and-undefined: the
      // canonical payload drops an absent key, and the record then says "not
      // stated" rather than carrying an empty claim. The reader goes with the
      // block because half the rendered line is the reader.
      ...(decision ? { decision, reader: READER_DEFAULT } : {}),
    };

    const integrityHash = await computeRecordIntegrityHash(base as never);
    const sig = await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' }, kp.privateKey,
      new TextEncoder().encode(integrityHash),
    );
    records.push({ ...base, integrityHash, signature: b64url(sig) } as ForensicRecord);
    prevHash = integrityHash;
  }

  // Independent time over the chain's own hashes (see ANCHOR_FIXTURE above).
  let anchors: ChainAnchor[];
  // The week example's stamps were taken when they were asked for, after the invented week, and the
  // file's first paragraph says so; a stamp is never dated inside the week.
  if (process.argv.includes('--fetch-anchors')) {
    const fixture = await fetchAnchors(records, EXAMPLE ? [Math.floor(RECORD_COUNT / 2) - 1, RECORD_COUNT - 1] : ANCHORED_POSITIONS);
    writeFileSync(ANCHOR_FIXTURE, JSON.stringify(fixture, null, 2) + '\n', 'utf8');
    console.log(`wrote ${ANCHOR_FIXTURE}`);
    anchors = fixture.flatMap(f => f.anchors);
  } else {
    anchors = loadAnchors(records);
  }

  // "Made at" is the authority-signed time over this chain's own head, not the
  // clock of whoever ran the script. buildMethodologyBlock stamps new Date(),
  // which would churn 1.6 MB in git on every run and would also let the file
  // claim a making time nothing in it can support. The anchor time is real,
  // deterministic between runs, and is the moment this chain was witnessed.
  const anchoredAt = anchors.map(a => a.generalizedTime).filter((t): t is string => !!t).sort().pop();
  if (anchoredAt) methodology.generatedAt = anchoredAt;
  const stampDay = anchoredAt
    ? new Date(anchoredAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
    : '';
  const SERVICE_NAME: Record<string, string> = { freetsa: 'FreeTSA', digicert: 'DigiCert', sectigo: 'Sectigo' };
  const services = [...new Set(anchors.map(a => SERVICE_NAME[a.tsaProvider] ?? a.tsaProvider))];
  const stampedBy = services.length > 1 ? `${services.slice(0, -1).join(', ')} and ${services[services.length - 1]}` : services.join('');

  const html = buildForensicHtmlExport(records, EXAMPLE ? {
    fwVersion: 'FeelingWise EXAMPLE EXPORT: every post and handle in this file is invented',
    publicKeyJwk: jwk,
    publicKeyFingerprint: fingerprint,
    locale: 'en',
    anchors,
    methodology,
    keyOrigins: [{ fingerprint, origin: 'generated-storage-empty', at: new Date(WINDOW_START - 60_000).toISOString() }],
    topNotice:
      'This is an example file. Every post, handle, link and engagement count in it was written by a '
      + 'generator, and nothing in it happened to anybody. It is what Feedprint writes in a week on an '
      + 'install with no licence key: no AI reads anything, so most entries say the feed served an item '
      + 'and nothing judged it, and the rest name the rule that acted. The signatures and the hash chain '
      + 'are genuine, under a test key published with the source of this example, so the check below passes the '
      + 'way it passes on a real record. The time stamps are real too: the public time-stamp services of '
      + `${stampedBy} signed the chain at two points on ${stampDay}, after the invented week, so they show `
      + 'these entries existed by that day, not on the days they name. A real install asks for its stamps '
      + 'while it records, so they fall inside its week. Read it for what the format does, never as '
      + 'evidence about a person.',
    precisionDisclosure:
      'EXAMPLE FILE. Not a real record and not anyone\'s data. The text, the handles, the links and the '
      + 'counts are generated; the mix of platforms and of posts, videos and images follows a genuine 10-day record. The install '
      + 'in this file holds no licence key and is set to Moderate, so no model read any entry. An entry that '
      + 'says the item was skipped was served by the feed and judged by nothing. The entries that say more '
      + 'were acted on by a fixed rule: the platform\'s own ad marker, the household\'s block list (the words '
      + 'spoilers and diet, and the phrase meal prep; the format has no field for a household\'s rules, so the '
      + 'list is named here) and the swear mask, which stars vulgar words and changes nothing else. There are '
      + 'no comments, because without a key Feedprint writes a comment only when a rule hides it. The '
      + 'signatures are real over a key made for this file, so the check below genuinely passes.',
  } : {
    fwVersion: 'FeelingWise DEMO EXPORT: every post and handle in this file is invented',
    publicKeyJwk: jwk,
    publicKeyFingerprint: fingerprint,
    locale: 'en',
    anchors,
    // "Under what criteria was this identified": the verbatim model
    // instructions, the pins and the thresholds. Every real export passes this
    // (src/forensics/exporter.ts) and the demo passed none until 2026-09-18, so
    // the collapsible section the file advertises in its own signed wording
    // rendered as an empty string — on the file the letters hand to a
    // researcher of AI classification, about the first thing such a reader
    // opens.
    methodology,
    // The demo key exists because this script made it; without the row page one said
    // "not recorded: the key predates the origin ledger" of a file made fresh.
    keyOrigins: [{ fingerprint, origin: 'generated-storage-empty', at: new Date(WINDOW_START - 60_000).toISOString() }],
    // The first paragraph of the file, above the feed. A blind reader reached
    // the sixth card before the file told them what it was, because the only
    // sentence that said so sat 250 cards down under the label "FeelingWise
    // precision disclosure" (found 2026-09-18).
    topNotice:
      'This is a demonstration file. Every post, handle, link and engagement count in it was '
      + 'written by a generator, and nothing in it happened to anybody. What is real is the '
      + 'machinery: the signatures, the hash chain and the two independent time stamps are '
      + 'genuine, so the check below passes exactly as it passes on a real record. Read it for '
      + 'what the format does, never as evidence about a person.',
    precisionDisclosure:
      'DEMO FILE. Not a real record and not anyone\'s data. The text and the handles are '
      + 'generated. What is real is the shape: the platform mix, the item mix, the verdict mix '
      + 'over judged items and the technique frequency are taken from a genuine 10-day record of '
      + '19,259 entries. The roster of invented sentences is small, so one sentence appears under '
      + 'several invented accounts; a sentence keeps one judgement everywhere it appears, which is '
      + 'what the product\'s own cache does. Three things here are modelled rather than measured and are marked as such '
      + 'in the generator: how often a paid placement arrived, which surface an item arrived '
      + 'on, and how much of the feed the household\'s own rules took out. The household in this file keeps a block '
      + 'list, which is what nearly every install has and what this file had none of until 18 September 2026: the '
      + 'words spoilers and diet, and the phrase meal prep. The format has no field for a household\'s rules, so the '
      + 'list is named here, and every record it hid names the rule that fired and carries no finding, because '
      + 'nothing read those posts. Every record was judged in Teen mode by the earlier reader, so the accuracy figure '
      + 'quoted on each card is the Adult reader\'s and describes nothing in this file. The '
      + 'signatures are real over a demo key, so the check below genuinely passes and you can '
      + 'watch the mechanism work on data that belongs to nobody.',
  });

  // The exporter builds a file you download, so it carries no canonical or share
  // card — correct for a private record, wrong the moment it is served from the
  // site. tests/unit/public-copy-claims.test.ts caught exactly that. Injected
  // here rather than in the exporter, because a real family's export must never
  // claim a feelingwise.org canonical.
  const head = EXAMPLE ? `
<link rel="canonical" href="https://feelingwise.org/example-export" />
<meta property="og:type" content="website" />
<meta property="og:url" content="https://feelingwise.org/example-export" />
<meta property="og:title" content="FeelingWise | A week of Feedprint with no key, and nobody's data in it" />
<meta property="og:description" content="An example record you can check yourself in the browser. The posts and handles are invented." />
<meta property="og:image" content="https://feelingwise.org/share-card.png" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="description" content="A working Feedprint export you can open and verify: one invented week on an install with no licence key." />
</head>` : `
<link rel="canonical" href="https://feelingwise.org/example-export-full" />
<meta property="og:type" content="website" />
<meta property="og:url" content="https://feelingwise.org/example-export-full" />
<meta property="og:title" content="FeelingWise | A week of a real record, with nobody's data in it" />
<meta property="og:description" content="1,500 entries you can check yourself in the browser. The shapes are real, the posts and handles are invented." />
<meta property="og:image" content="https://feelingwise.org/share-card.png" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="description" content="A working FeelingWise export you can open and verify. 1,500 entries, real distribution, invented content." />
</head>`;
  // The signed manifest (evidence-gap register item 6), under the demo key,
  // so the file reads VERIFIED and not PARTIALLY VERIFIED: the demo shows the
  // mechanism the way a real export from today's build has it. Attached before
  // the head injection because the manifest digests the payload and the
  // rendered provenance rows, neither of which the head touches.
  const signed = await attachSignedManifest(html, async (hash) =>
    b64url(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, kp.privateKey, new TextEncoder().encode(hash))));
  if (signed === html) throw new Error('the manifest was not attached');
  const withHead = signed.replace('</head>', head);
  if (withHead === signed) throw new Error('could not inject head tags: no </head> in export output');

  writeFileSync(OUT, withHead, 'utf8');
  const acted = records.filter(r => r.verdict !== 'pass' && r.accountType !== 'advertiser').length;
  const posts = new Set(records.map(r => r.postUrl));
  console.log(`wrote ${OUT}`);
  console.log(`  impressions ${records.length} of ${posts.size} posts, ${judgements.size} distinct texts`);
  console.log(`  acted on ${acted}, hidden ${records.filter(r => r.verdict === 'flagged-hidden' && r.accountType !== 'advertiser').length}, paid placements ${records.filter(r => r.accountType === 'advertiser').length}`);
  console.log(`  hidden by the household's own rules ${records.filter(r => (r.detectionMode ?? '').startsWith('blocklist:')).length}`);
  console.log(`  demo key fingerprint ${fingerprint}`);
  console.log(`  size ${(withHead.length / 1024 / 1024).toFixed(2)} MB`);
}

underFixedClock(MADE_AT, main).catch((e) => { console.error(e); process.exit(1); });
