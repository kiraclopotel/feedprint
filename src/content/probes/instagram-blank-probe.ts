// FeelingWise — Instagram blank-post probe (known issue M95).
//
// Posts on Instagram were seen blank or "cut off" during fast scrolling, with six FeelingWise
// mechanisms able to do it and no repro. This probe changes nothing: for each post container in
// view that is blank (hidden by visibility or display, on itself, an ancestor or a child row, or
// with no height), it names the FeelingWise marks around it, so one live scroll can tell the
// suspects apart. It writes down style values, attribute names and short codes only: an attribute
// value is kept only for the marker attributes whose values are fixed codes, because a person may
// share the diagnostics this feeds, and a post's words or an account name must never be in them.
//
// What it cannot tell apart, said here so the reader of a log knows: suspects 1 and 2 (the AI-content
// blocker's hide, and the same hide after its tracking was capped) leave the same mark; suspect 3 (a
// provisional shield) clips a post without hiding it, so it is reported only as a shield on an
// ancestor, not as a blank; suspect 6 (a scroll restore after a dialog) leaves no mark at all.

import { isFeatureEnabled } from '../../storage/feature-flags';
import { getSettings } from '../../storage/settings';
import { bumpCounter } from '../../diagnostics/diagnostics';

interface ProbeMarker { on: 'self' | 'ancestor' | 'child'; name: string; value?: string }

export interface BlankPost {
  reason: 'visibility' | 'display' | 'ancestor-visibility' | 'ancestor-display' | 'child-display' | 'zero-height' | 'shield-ancestor';
  markers: ProbeMarker[];
  /** An ancestor carries a provisional shield, the "cut off" suspect, whether or not its inline position survived. */
  shieldedAncestor: boolean;
  /** That shield's ancestor still has the inline position the shield set (Instagram may have rewritten it). */
  shieldPositionKept: boolean;
}

/** Marker attributes whose values are fixed codes (a reason, a switch id), never page text. */
const CODE_VALUED = new Set(['data-fw-blocked', 'data-fw-block-reason', 'data-fw-hide-mode', 'data-fw-surface']);
// Code values are written by FeelingWise itself (a reason, a switch id, a route pattern such as
// "reel-surface:^\/reels\/"), never by the page, so any short value without spaces is kept.
const CODE = /^\S{1,120}$/;
// A post, and the main column: Instagram's permalink pages have no article, and there the
// AI-content blocker hides the whole main column.
const POSTS = 'article, main, [role="main"]';

function marks(el: Element, on: ProbeMarker['on']): ProbeMarker[] {
  const out: ProbeMarker[] = [];
  for (const attr of Array.from(el.attributes)) {
    if (!attr.name.startsWith('data-fw-')) continue;
    const keep = CODE_VALUED.has(attr.name) && CODE.test(attr.value);
    out.push(keep ? { on, name: attr.name, value: attr.value } : { on, name: attr.name });
  }
  return out;
}

function hiddenBy(el: HTMLElement): 'visibility' | 'display' | null {
  if (el.style.getPropertyValue('display') === 'none') return 'display';
  if (el.style.getPropertyValue('visibility') === 'hidden') return 'visibility';
  return null;
}

/** Each post container in view that FeelingWise left blank, and the marks that say which mechanism did. */
export function describeBlankPosts(root: ParentNode, inView: (el: Element) => boolean): BlankPost[] {
  const out: BlankPost[] = [];
  root.querySelectorAll<HTMLElement>(POSTS).forEach((post) => {
    if (!inView(post)) return;
    // The main column stands for a post only on a page with no article in it (a permalink page).
    if (post.tagName !== 'ARTICLE' && post.querySelector('article')) return;
    const markers: ProbeMarker[] = [...marks(post, 'self')];
    let reason: BlankPost['reason'] | null = null;
    const own = hiddenBy(post);
    if (own) reason = own;

    let shieldedAncestor = false;
    let shieldPositionKept = false;
    for (let a = post.parentElement; a && a !== document.body && a !== document.documentElement; a = a.parentElement) {
      const m = marks(a, 'ancestor');
      markers.push(...m);
      if (m.some((x) => x.name === 'data-fw-provisional-shield-token')) {
        shieldedAncestor = true;
        if (a.style.getPropertyValue('position') === 'relative') shieldPositionKept = true;
      }
      const up = hiddenBy(a);
      if (!reason && up) reason = up === 'display' ? 'ancestor-display' : 'ancestor-visibility';
    }

    post.querySelectorAll<HTMLElement>('[data-fw-block-reason], [data-fw-blocked]').forEach((child) => {
      if (child === post || !hiddenBy(child)) return;
      markers.push(...marks(child, 'child'));
      if (!reason) reason = 'child-display';
    });

    if (!reason && shieldedAncestor) reason = 'shield-ancestor';
    if (!reason) {
      const rect = post.getBoundingClientRect();
      if (rect.width > 0 && rect.height === 0 && markers.length > 0) reason = 'zero-height';
    }
    if (reason && markers.length > 0) out.push({ reason, markers, shieldedAncestor, shieldPositionKept });
  });
  return out;
}

/** In the viewport by layout; used by the live probe, while tests pass their own. */
function inViewport(el: Element): boolean {
  const r = el.getBoundingClientRect();
  return r.bottom > 0 && r.top < (typeof window !== 'undefined' ? window.innerHeight : 0);
}

// ─── The live probe, armed once at content-script init on instagram.com ───

// The switches behind the suspects: the AI-content blocker (1, 2), the Reels blocker (4), and the
// two that hide Instagram's count rows and action buttons (5, hideOrphanLabels).
const SWITCHES = ['block-ai-content', 'block-reels', 'hide-engagement-metrics', 'hide-action-buttons'] as const;
const QUIET_MS = 400;

/** Reads the igBlankProbe flag once; when it is off nothing is attached. */
export function armInstagramBlankProbe(): void {
  void isFeatureEnabled('igBlankProbe').then((on) => {
    if (!on) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    window.addEventListener('scroll', () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { void report(); }, QUIET_MS);
    }, { passive: true, capture: true });
  }).catch(() => undefined);
}

async function report(): Promise<void> {
  const hits = describeBlankPosts(document, inViewport);
  if (hits.length === 0) return;
  bumpCounter('igBlankSeen', hits.length);
  const s = await getSettings();
  const switches = Object.fromEntries(SWITCHES.map((id) => [id, s.features?.[id]?.enabled === true]));
  console.log('[FW probe] ig-blank', JSON.stringify({ mode: s.mode, switches, hits }));
}
