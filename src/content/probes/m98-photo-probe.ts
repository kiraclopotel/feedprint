// FeelingWise — M98 photo-modal DOM probe (2026-08-04).
//
// The M98 cache-identity fix (extend the permalink tree walk to the X photo
// modal) was designed and then STOPPED by its own verify pass: the walk is
// document-wide with a single first-`tabindex="-1"` pivot, and whether the
// underlay permalink DOM persists on /photo/N — and which copy holds the
// pivot — is X's implementation detail, not derivable from the repo. Guessing
// wrong mints fake reply records. This probe answers those questions from a
// real visit, content-free (counts, region booleans, href-path hashes), the
// same self-arming style as hide-chip-probe.ts. Counters ride Copy
// Diagnostics:
//   m98PhotoModalSeen        a photo-modal extract pass ran
//   m98PivotInLayers         first tabindex="-1" article sits in X's #layers portal
//   m98PivotInUnderlay       ...sits outside it (the persisting permalink page)
//   m98NoPivot               no tabindex="-1" article anywhere (walk would no-op)
//   m98MultiplePivots        more than one tabindex="-1" article present
//   m98UnderlayArticles      articles exist OUTSIDE #layers while the modal is up
// The console line adds the counts and whether the pivot's status href hash
// matches the URL's status id hash — the full input the fix design needs.

import { bumpCounter } from '../../diagnostics/diagnostics';
import { contentFreeHash } from './hide-chip-probe';

let lastRunAt = 0;
let lastSignature = '';
const MIN_INTERVAL_MS = 5_000;

function statusPathHash(href: string | null | undefined): string {
  if (!href) return 'none';
  const m = href.match(/\/status\/\d+/);
  return m ? contentFreeHash(m[0]) : 'none';
}

/** Called from the twitter adapter once per extractPosts pass on the
 *  photo-modal surface. Throttled; emits only when the observed shape
 *  changes, so a stable modal costs one line. */
export function noteTwitterPhotoSurface(doc: Document): void {
  const now = Date.now();
  if (now - lastRunAt < MIN_INTERVAL_MS) return;
  lastRunAt = now;

  const articles = Array.from(doc.querySelectorAll('article[role="article"]'));
  const layers = doc.querySelector('#layers');
  const inLayers = articles.filter((a) => layers !== null && layers.contains(a));
  const pivots = articles.filter((a) => a.getAttribute('tabindex') === '-1');
  const firstPivot = pivots[0] ?? null;
  const pivotRegion = firstPivot === null
    ? 'none'
    : layers !== null && layers.contains(firstPivot) ? 'layers' : 'underlay';
  const pivotHref = firstPivot?.querySelector('a[href*="/status/"]')?.getAttribute('href');
  const urlHash = statusPathHash(typeof location !== 'undefined' ? location.pathname : '');
  const pivotHash = statusPathHash(pivotHref);

  const signature = JSON.stringify([
    articles.length, inLayers.length, pivots.length, pivotRegion, pivotHash, urlHash,
  ]);
  if (signature === lastSignature) return;
  lastSignature = signature;

  bumpCounter('m98PhotoModalSeen');
  if (pivotRegion === 'layers') bumpCounter('m98PivotInLayers');
  else if (pivotRegion === 'underlay') bumpCounter('m98PivotInUnderlay');
  else bumpCounter('m98NoPivot');
  if (pivots.length > 1) bumpCounter('m98MultiplePivots');
  if (articles.length > inLayers.length) bumpCounter('m98UnderlayArticles');

  console.info(
    `[FW probe] m98-photo articles=${articles.length} inLayers=${inLayers.length}`
      + ` pivots=${pivots.length} pivotRegion=${pivotRegion}`
      + ` pivotMatchesUrl=${pivotHash !== 'none' && pivotHash === urlHash}`,
  );
}

/** Test-only: throttle + change-dedup state is module-lived. */
export function _resetM98PhotoProbeForTesting(): void {
  lastRunAt = 0;
  lastSignature = '';
}
