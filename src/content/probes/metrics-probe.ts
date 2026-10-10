// FeelingWise — metrics-scope discriminating probe (diagnostic, flag-gated).
//
// BOARD 2026-08-01, open hypothesis: the metrics recheck extracted
// IDENTICAL counts (e.g. 1.5K) across different posts. The extractors are
// post-root-scoped in code, so the suspected mechanism is background-tab
// lazy-render resolving the scoping container itself to page chrome — every
// extraction then reads the same on-page count element. This probe logs, per
// metric match, exactly what was matched and whether the post root really
// contains it, so ONE live recheck run with the flag on discriminates
// wrong-container from wrong-element.
//
// Armed once at content-script init from the `metricsScopeProbe` feature flag
// (default false). When off: a single boolean check, zero logging.

import { isFeatureEnabled } from '../../storage/feature-flags';

let armed = false;

/** Read the flag once at content-script init. Failure leaves the probe off. */
export function armMetricsProbe(): void {
  void isFeatureEnabled('metricsScopeProbe')
    .then(v => { armed = v; })
    .catch(() => { armed = false; });
}

function describe(el: Element | null | undefined): string | null {
  if (!el) return null;
  const hook =
    el.getAttribute('data-e2e') ??
    el.getAttribute('data-testid') ??
    el.getAttribute('aria-label') ??
    (typeof el.className === 'string' ? el.className.slice(0, 60) : '');
  return `${el.tagName.toLowerCase()}[${hook ?? ''}]`;
}

/**
 * Log one metric-element match. `postRoot` is the container the extractor
 * believes scopes this post; `matched` is the count element it resolved.
 * `containedInPostRoot:false` (or a postRoot that describes page chrome)
 * confirms the lazy-render mis-scoping hypothesis.
 */
export function probeMetricsScope(
  platform: string,
  label: string,
  postRoot: Element | null,
  matched: Element | null,
): void {
  if (!armed) return;
  try {
    // console-text-ok: off unless a developer sets the metricsScopeProbe feature flag on their own install. It prints up
    // to 40 characters of what a count selector matched: a count such as "1.5K" when the scope is right, and post text
    // when it is not, which is the case the probe exists to find; it cannot find it without reading it.
    console.info('[FW probe] metrics-scope', {
      platform,
      label,
      matchedEl: describe(matched),
      matchedText: matched?.textContent?.trim().slice(0, 40) ?? null,
      postRootEl: describe(postRoot),
      containedInPostRoot: !!(postRoot && matched && postRoot.contains(matched)),
      hidden: document.visibilityState,
    });
  } catch { /* probe must never break extraction */ }
}
