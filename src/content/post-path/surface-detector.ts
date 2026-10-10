// FeelingWise — shared platform-surface descriptor registry + matcher.
//
// Why this exists. Every engagement-tier consumer (ai-content-blocker,
// reels-blocker, interceptor) carried its own inline `PlatformDescriptor`
// table that paired a platform tag with URL pathname patterns and CSS
// container selectors. Each consumer's matcher walked that table independently.
// The shapes drifted — one consumer used `pathnamePatterns: RegExp[]`, another
// used `urlIdPattern?: RegExp`, a third used a hard-coded switch over
// `adapter.platform` returning a stamp-selector string. Adding a new platform
// surface (e.g. YouTube Shorts overlay, Facebook search wrapper, Instagram
// explore tile) meant touching every consumer.
//
// Pattern. Strategy + Composite over a single descriptor schema:
//   - SurfaceDescriptor is the unit (Strategy).
//   - SurfaceDetector is the registry + matcher (Composite — one detector,
//     many descriptors).
//   - Consumers REGISTER their descriptors at module load and QUERY the
//     detector for matches. The detector knows nothing about what each
//     consumer does with the match.
//
// What lives here vs in the consumer.
//   - HERE: platform tag, surface kind label, URL pathname pattern, CSS
//     container selectors, a dynamic-rescan hint. These are universal to
//     "find me the surface" — every consumer needs them.
//   - IN THE CONSUMER: caption / author / url selectors, hide rules,
//     forensic-write logic. These are consumer-specific behavior.
//
// State. The exported `sharedSurfaceDetector` is a module-level singleton —
// the convenient default consumers register against. Tests construct an
// isolated detector via `createSurfaceDetector()` so registrations don't
// leak across cases.

import type { Platform } from '../../types/post';

export interface SurfaceDescriptor {
  /** Identifier for the descriptor (e.g. 'ai-content-blocker:youtube:shorts-overlay'). */
  id: string;
  /** Owning platform. */
  platform: Platform;
  /** What kind of surface this is — aligns with PostKind / PlatformSurface where applicable. */
  surfaceKind: string;
  /** Pathname pattern (regex against window.location.pathname). null = matches any pathname on this platform. */
  pathnamePattern: RegExp | null;
  /** CSS selectors to find containers when this surface is active. */
  containerSelectors: string[];
  /** True if this surface rotates content via SPA-nav / dynamic loads (consumer should rescan on URL change). */
  dynamicContentRescan: boolean;
}

interface SurfaceMatch {
  descriptor: SurfaceDescriptor;
  containers: Element[];
}

export interface SurfaceDetector {
  /** Add a descriptor to the registry. Throws if id collision. */
  register(d: SurfaceDescriptor): void;
  /** All descriptors registered (frozen view). */
  list(): readonly SurfaceDescriptor[];
  /** Find descriptors matching the current URL on this platform. Pure: no DOM access. */
  matchUrl(platform: Platform, pathname: string): SurfaceDescriptor[];
  /**
   * Find descriptors matching URL + walk DOM for containers. Returns
   * SurfaceMatch[] for each descriptor that matched. A descriptor with
   * empty `containerSelectors` yields a SurfaceMatch with `containers: []`
   * — the consumer decides whether to act on URL alone (e.g. reels-blocker's
   * url-gate) or skip when no DOM containers are present.
   */
  matchAndWalk(platform: Platform, pathname: string, root?: ParentNode): SurfaceMatch[];
}

export function createSurfaceDetector(): SurfaceDetector {
  const descriptors = new Map<string, SurfaceDescriptor>();

  return {
    register(d: SurfaceDescriptor): void {
      if (descriptors.has(d.id)) {
        throw new Error(`SurfaceDetector: descriptor id collision "${d.id}"`);
      }
      descriptors.set(d.id, d);
    },

    list(): readonly SurfaceDescriptor[] {
      return Array.from(descriptors.values());
    },

    matchUrl(platform: Platform, pathname: string): SurfaceDescriptor[] {
      const out: SurfaceDescriptor[] = [];
      for (const d of descriptors.values()) {
        if (d.platform !== platform) continue;
        if (d.pathnamePattern !== null && !d.pathnamePattern.test(pathname)) continue;
        out.push(d);
      }
      return out;
    },

    matchAndWalk(platform: Platform, pathname: string, root?: ParentNode): SurfaceMatch[] {
      const matches = this.matchUrl(platform, pathname);
      const scope: ParentNode | null =
        root ?? (typeof document !== 'undefined' ? document : null);
      const out: SurfaceMatch[] = [];
      for (const descriptor of matches) {
        const containers: Element[] = [];
        if (scope && descriptor.containerSelectors.length > 0) {
          for (const sel of descriptor.containerSelectors) {
            for (const el of Array.from(scope.querySelectorAll(sel))) {
              containers.push(el);
            }
          }
        }
        out.push({ descriptor, containers });
      }
      return out;
    },
  };
}

/**
 * Default descriptor registry shared across consumers. Consumers register
 * their own descriptors at module load time. Tests can construct a fresh
 * SurfaceDetector via `createSurfaceDetector()` to avoid global state.
 */
export const sharedSurfaceDetector: SurfaceDetector = createSurfaceDetector();
